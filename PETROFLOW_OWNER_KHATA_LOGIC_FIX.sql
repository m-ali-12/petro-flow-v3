-- =============================================================
-- PetroFlow Owner Khata Logic Fix
-- Run this file in Supabase SQL Editor after deploying the updated ZIP.
-- Purpose:
-- 1) Owner account is treated as a proper customer khata.
--    Positive balance = Udhaar/Baqi, Negative balance = Advance.
-- 2) Daily reading cash, bank deposit, bank transfer, salary cash movement
--    must NOT auto-change Owner khata.
-- 3) Vasooli/payment is NOT profit. It is recovery of old udhaar.
-- 4) AdvanceUsed is counted in khata balance because it consumes advance.
-- =============================================================

-- 1) Make customer balance-at-date function follow the corrected khata rule.
CREATE OR REPLACE FUNCTION public.get_customer_balance_at(cust_id BIGINT, target_date TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plus  NUMERIC := 0;
    v_minus NUMERIC := 0;
BEGIN
    -- Plus side: customer/owner took fuel/cash on credit OR old advance was used.
    SELECT COALESCE(SUM(COALESCE(charges, amount, 0)), 0)
      INTO v_plus
    FROM public.transactions
    WHERE customer_id = cust_id
      AND transaction_type IN ('Credit', 'Advance', 'AdvanceUsed')
      AND created_at < target_date;

    -- Minus side: customer/owner paid money. Extra payment naturally makes balance negative/advance.
    SELECT COALESCE(SUM(COALESCE(charges, amount, 0)), 0)
      INTO v_minus
    FROM public.transactions
    WHERE customer_id = cust_id
      AND transaction_type = 'Debit'
      AND created_at < target_date;

    RETURN v_plus - v_minus;
END;
$$;

-- 2) Helper to calculate khata balance from transaction history.
--    This does NOT include CashSale, BankDeposit, BankTransfer, SalaryPay, Expense.
CREATE OR REPLACE FUNCTION public.petro_customer_khata_balance(cust_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN transaction_type IN ('Credit', 'Advance', 'AdvanceUsed') THEN COALESCE(charges, amount, 0)
      WHEN transaction_type = 'Debit' THEN -COALESCE(charges, amount, 0)
      ELSE 0
    END
  ), 0)
  FROM public.transactions
  WHERE customer_id = cust_id;
$$;

-- 3) One-time cleaner for the previous wrong Owner/Cash logic.
--    It reverses only the movements that were wrongly added to Owner balance:
--    daily machine CashSale, bank finance movements, and employee salary cash movements.
--    It does NOT rebuild all customers, so manual opening balances of other customers remain safe.
CREATE OR REPLACE FUNCTION public.fix_owner_balance_wrong_cash_movements()
RETURNS TABLE (
  owner_id BIGINT,
  owner_name TEXT,
  wrong_delta NUMERIC,
  old_balance NUMERIC,
  new_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner RECORD;
  v_wrong NUMERIC := 0;
  v_old NUMERIC := 0;
  v_new NUMERIC := 0;
BEGIN
  SELECT id, name, COALESCE(balance, 0) AS balance
    INTO v_owner
  FROM public.customers
  WHERE lower(COALESCE(category, '')) = 'owner'
  ORDER BY COALESCE(sr_no, 999999), id
  LIMIT 1;

  IF v_owner.id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      -- Previous update wrongly added daily cash reading into Owner/Cash balance.
      WHEN transaction_type = 'CashSale'
           AND COALESCE(entry_method, '') = 'machine_reading'
        THEN COALESCE(charges, amount, 0)

      -- Previous bank finance logic wrongly treated Owner as cash/till account.
      WHEN transaction_type = 'BankDeposit'
           AND COALESCE(entry_method, '') = 'bank_finance'
        THEN -COALESCE(charges, amount, 0)
      WHEN transaction_type = 'BankCredit'
           AND COALESCE(entry_method, '') = 'bank_finance'
        THEN COALESCE(charges, amount, 0)
      WHEN transaction_type IN ('BankPayment', 'Expense')
           AND COALESCE(entry_method, '') = 'bank_finance'
        THEN -COALESCE(charges, amount, 0)

      -- Previous salary page wrongly reduced Owner balance for employee cash outflow.
      WHEN transaction_type IN ('SalaryPay', 'EmployeeAdvance', 'EmployeeDebit')
           AND COALESCE(entry_method, '') = 'employee_salary'
        THEN -COALESCE(charges, amount, 0)

      ELSE 0
    END
  ), 0)
    INTO v_wrong
  FROM public.transactions
  WHERE customer_id = v_owner.id;

  v_old := COALESCE(v_owner.balance, 0);
  v_new := v_old - COALESCE(v_wrong, 0);

  UPDATE public.customers
     SET balance = v_new
   WHERE id = v_owner.id;

  owner_id := v_owner.id;
  owner_name := v_owner.name;
  wrong_delta := COALESCE(v_wrong, 0);
  old_balance := v_old;
  new_balance := v_new;
  RETURN NEXT;
END;
$$;

-- 4) Run this once to correct Owner balance after the previous version.
--    It is safe to run multiple times only if no old wrong transactions are still linked to Owner.
--    If you are unsure, run SELECT only first and check wrong_delta.
SELECT * FROM public.fix_owner_balance_wrong_cash_movements();

-- 5) Optional check query: see all owner khata transactions after cleanup.
-- SELECT t.id, t.created_at, t.transaction_type, t.amount, t.charges, t.description
-- FROM public.transactions t
-- JOIN public.customers c ON c.id = t.customer_id
-- WHERE lower(COALESCE(c.category, '')) = 'owner'
-- ORDER BY t.created_at DESC;
