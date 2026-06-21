-- PETROFLOW DAILY CREDIT RECONCILIATION PREVIEW
-- Safe preview only: NO DELETE, NO TRUNCATE, NO DROP, NO UPDATE.
-- Purpose: show whether Daily Reading credit amount matches customer-wise Credit / AdvanceUsed transactions.

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

WITH daily_credit AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Karachi')::DATE AS sale_date,
    fuel_type,
    COUNT(*) AS daily_reading_rows,
    ROUND(COALESCE(SUM(COALESCE(NULLIF(public.petro_safe_jsonb(description)->>'udhaar','')::NUMERIC, 0)),0),2) AS daily_credit_amount,
    ROUND(COALESCE(SUM(COALESCE(
      NULLIF(public.petro_safe_jsonb(description)->>'credit_liters_machine','')::NUMERIC,
      COALESCE(NULLIF(public.petro_safe_jsonb(description)->>'udhaar','')::NUMERIC, 0)
        / NULLIF(COALESCE(NULLIF(public.petro_safe_jsonb(description)->>'rate','')::NUMERIC, unit_price, 0),0),
      0
    )),0),3) AS daily_credit_liters
  FROM public.transactions
  WHERE transaction_type = 'CashSale'
    AND entry_method = 'machine_reading'
    AND fuel_type IN ('Petrol','Diesel')
  GROUP BY 1,2
), customer_credit AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Karachi')::DATE AS sale_date,
    fuel_type,
    COUNT(*) AS customer_credit_rows,
    ROUND(COALESCE(SUM(COALESCE(charges, amount, 0)),0),2) AS customer_credit_amount,
    ROUND(COALESCE(SUM(COALESCE(
      liters,
      COALESCE(charges, amount, 0) / NULLIF(unit_price,0),
      0
    )),0),3) AS customer_credit_liters
  FROM public.transactions
  WHERE transaction_type IN ('Credit','AdvanceUsed')
    AND fuel_type IN ('Petrol','Diesel')
  GROUP BY 1,2
), combined AS (
  SELECT
    COALESCE(d.sale_date, c.sale_date) AS sale_date,
    COALESCE(d.fuel_type, c.fuel_type) AS fuel_type,
    COALESCE(d.daily_reading_rows,0) AS daily_reading_rows,
    COALESCE(c.customer_credit_rows,0) AS customer_credit_rows,
    COALESCE(d.daily_credit_amount,0) AS daily_credit_amount,
    COALESCE(c.customer_credit_amount,0) AS customer_credit_amount,
    COALESCE(d.daily_credit_liters,0) AS daily_credit_liters,
    COALESCE(c.customer_credit_liters,0) AS customer_credit_liters
  FROM daily_credit d
  FULL OUTER JOIN customer_credit c
    ON c.sale_date = d.sale_date
   AND c.fuel_type = d.fuel_type
)
SELECT
  sale_date,
  fuel_type,
  daily_reading_rows,
  customer_credit_rows,
  daily_credit_amount,
  customer_credit_amount,
  ROUND(daily_credit_amount - customer_credit_amount,2) AS pending_amount,
  daily_credit_liters,
  customer_credit_liters,
  ROUND(daily_credit_liters - customer_credit_liters,3) AS pending_liters,
  CASE
    WHEN daily_credit_amount <= 2 AND customer_credit_amount <= 2 THEN 'Cash Only / Clear'
    WHEN daily_credit_amount <= 2 AND customer_credit_amount > 2 THEN 'Unlinked Credit Sale'
    WHEN customer_credit_amount <= 2 THEN 'Pending Credit'
    WHEN customer_credit_amount > daily_credit_amount + 2 THEN 'Over Credit'
    WHEN ABS(daily_credit_amount - customer_credit_amount) <= 2
     AND ABS(daily_credit_liters - customer_credit_liters) <= GREATEST(0.1, daily_credit_liters * 0.001) THEN 'Matched'
    ELSE 'Partial / Check Liters'
  END AS status
FROM combined
ORDER BY sale_date DESC, fuel_type;
