-- PETROFLOW STOCK RECALC PREVIEW ONLY
-- Safe preview: NO DELETE, NO TRUNCATE, NO DROP, NO UPDATE.
-- Purpose: show what tank stock SHOULD be based on stock receiving minus sales.

CREATE OR REPLACE FUNCTION public.petro_safe_jsonb(p_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN p_text::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN '{}'::jsonb;
END;
$$;

WITH tank_base AS (
  SELECT id, fuel_type, company_id, COALESCE(current_stock,0)::NUMERIC AS current_stock
  FROM public.tanks
  WHERE fuel_type IN ('Petrol','Diesel')
), received AS (
  SELECT
    tb.id AS tank_id,
    COALESCE(SUM(COALESCE(se.liters,0)),0)::NUMERIC AS received_liters
  FROM tank_base tb
  LEFT JOIN public.stock_entries se
    ON se.fuel_type = tb.fuel_type
   AND (se.company_id = tb.company_id OR se.company_id IS NULL OR tb.company_id IS NULL)
  GROUP BY tb.id
), sold AS (
  SELECT
    tb.id AS tank_id,
    COALESCE(SUM(
      CASE
        WHEN tr.transaction_type = 'CashSale'
         AND tr.entry_method = 'machine_reading'
        THEN COALESCE(
          NULLIF((public.petro_safe_jsonb(tr.description)->>'stock_deducted_liters'), '')::NUMERIC,
          NULLIF((public.petro_safe_jsonb(tr.description)->>'cash_liters'), '')::NUMERIC,
          GREATEST(
            0,
            COALESCE(NULLIF((public.petro_safe_jsonb(tr.description)->>'gross'), '')::NUMERIC, tr.amount, tr.charges, 0)
            - COALESCE(NULLIF((public.petro_safe_jsonb(tr.description)->>'udhaar'), '')::NUMERIC, 0)
          ) / NULLIF(COALESCE(NULLIF((public.petro_safe_jsonb(tr.description)->>'rate'), '')::NUMERIC, tr.unit_price, 0), 0),
          tr.liters,
          0
        )
        WHEN tr.transaction_type IN ('Credit','AdvanceUsed','CashSale')
        THEN COALESCE(tr.liters, COALESCE(tr.amount, tr.charges, 0) / NULLIF(tr.unit_price,0), 0)
        ELSE 0
      END
    ),0)::NUMERIC AS sold_liters
  FROM tank_base tb
  LEFT JOIN public.transactions tr
    ON tr.fuel_type = tb.fuel_type
   AND tr.transaction_type IN ('CashSale','Credit','AdvanceUsed')
   AND (tr.company_id = tb.company_id OR tr.company_id IS NULL OR tb.company_id IS NULL)
  GROUP BY tb.id
)
SELECT
  tb.id AS tank_id,
  tb.fuel_type,
  ROUND(tb.current_stock,3) AS current_stock_now,
  ROUND(COALESCE(r.received_liters,0),3) AS total_received_liters,
  ROUND(COALESCE(s.sold_liters,0),3) AS total_sold_liters,
  ROUND(GREATEST(0, COALESCE(r.received_liters,0) - COALESCE(s.sold_liters,0)),3) AS calculated_stock_should_be,
  ROUND(GREATEST(0, COALESCE(r.received_liters,0) - COALESCE(s.sold_liters,0)) - tb.current_stock,3) AS difference_if_applied
FROM tank_base tb
LEFT JOIN received r ON r.tank_id = tb.id
LEFT JOIN sold s ON s.tank_id = tb.id
ORDER BY tb.fuel_type;
