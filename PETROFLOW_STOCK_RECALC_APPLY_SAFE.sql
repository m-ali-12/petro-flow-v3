-- PETROFLOW STOCK RECALC APPLY SAFE
-- Safe apply: NO DELETE, NO TRUNCATE, NO DROP.
-- This only UPDATES tanks.current_stock based on stock receiving minus sales.
-- Run PREVIEW file first. Run this file only if preview result looks correct.

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
), calc AS (
  SELECT
    tb.id AS tank_id,
    GREATEST(0, COALESCE(r.received_liters,0) - COALESCE(s.sold_liters,0))::NUMERIC AS new_stock
  FROM tank_base tb
  LEFT JOIN received r ON r.tank_id = tb.id
  LEFT JOIN sold s ON s.tank_id = tb.id
), updated AS (
  UPDATE public.tanks t
     SET current_stock = ROUND(c.new_stock,3),
         last_updated = NOW()
    FROM calc c
   WHERE t.id = c.tank_id
   RETURNING t.id, t.fuel_type, t.current_stock
)
SELECT id AS tank_id, fuel_type, current_stock AS updated_current_stock
FROM updated
ORDER BY fuel_type;
