-- =========================================================
-- PetroFlow Employee Salary 3-Option Flow Safe DB Fix
-- Options used by app:
-- 1) salary_pay      = Salary (Regular Monthly)
-- 2) advance         = Advanced Salary (Credit)
-- 3) advance_return  = Repay Advanced Salary (Vasooli)
--
-- Safe notes:
-- - This file keeps existing records safe.
-- - Old legacy rows are kept and only hidden from the new 3-option UI.
-- - Old legacy Credit/Payable rows are only marked as entry_status = 'void'
--   so the new 3-option page ignores them. Data remains in DB.
-- =========================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.employee_salary_payments
  ADD COLUMN IF NOT EXISTS advance_month TEXT,
  ADD COLUMN IF NOT EXISTS auto_split_group TEXT,
  ADD COLUMN IF NOT EXISTS entry_status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS balance_effect NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.cash_deposits
  ADD COLUMN IF NOT EXISTS salary_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_month TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS salary_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_month TEXT;

-- Mark old auto payable / manual credit-debit employee rows as legacy/void.
-- They are not removed; the new page filters them out.
UPDATE public.employee_salary_payments
SET
  entry_status = 'void',
  updated_at = NOW(),
  note = COALESCE(note, '') || CASE
    WHEN COALESCE(note, '') ILIKE '%legacy hidden from 3-option salary flow%' THEN ''
    ELSE ' | Legacy hidden from 3-option salary flow'
  END
WHERE payment_type IN ('credit', 'debit')
  AND COALESCE(entry_status, 'active') <> 'void';

-- Make sure only real advance entries carry advance_month.
UPDATE public.employee_salary_payments
SET advance_month = COALESCE(advance_month, salary_month), updated_at = NOW()
WHERE payment_type = 'advance'
  AND COALESCE(entry_status, 'active') <> 'void'
  AND advance_month IS NULL;

-- Refresh balance_effect according to the new 3-option logic.
-- Salary is normal expense only: no employee balance effect.
-- Advance salary increases outstanding advance: negative balance.
-- Repay/vasooli decreases outstanding advance: positive effect.
UPDATE public.employee_salary_payments
SET
  balance_effect = CASE
    WHEN payment_type = 'advance' THEN -COALESCE(amount, 0)
    WHEN payment_type = 'advance_return' THEN COALESCE(amount, 0)
    ELSE 0
  END,
  updated_at = NOW()
WHERE COALESCE(entry_status, 'active') <> 'void';

-- Recalculate each employee's advance balance from active advance/vasooli rows only.
-- Negative balance = employee has outstanding advance.
-- Zero balance = advance is clear.
UPDATE public.employees e
SET
  balance = COALESCE(x.balance, 0),
  updated_at = NOW()
FROM (
  SELECT
    employee_id,
    SUM(CASE
      WHEN payment_type = 'advance' THEN -COALESCE(amount, 0)
      WHEN payment_type = 'advance_return' THEN COALESCE(amount, 0)
      ELSE 0
    END) AS balance
  FROM public.employee_salary_payments
  WHERE COALESCE(entry_status, 'active') <> 'void'
    AND payment_type IN ('advance', 'advance_return')
  GROUP BY employee_id
) x
WHERE e.id = x.employee_id;

-- Employees with no active advance rows should be clear.
UPDATE public.employees e
SET balance = 0, updated_at = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.employee_salary_payments p
  WHERE p.employee_id = e.id
    AND COALESCE(p.entry_status, 'active') <> 'void'
    AND p.payment_type IN ('advance', 'advance_return')
);

COMMENT ON COLUMN public.employee_salary_payments.payment_type IS 'Allowed app values: salary_pay, advance, advance_return. Legacy credit/debit rows are ignored by the new 3-option UI.';
COMMENT ON COLUMN public.employee_salary_payments.advance_month IS 'Month against which advanced salary was given.';
COMMENT ON COLUMN public.employees.balance IS 'New salary flow: negative means outstanding advanced salary; zero means clear.';

-- Quick check result
SELECT
  e.id AS employee_id,
  e.name,
  e.salary AS monthly_salary,
  e.balance AS advance_balance_signed,
  CASE WHEN e.balance < 0 THEN ABS(e.balance) ELSE 0 END AS outstanding_advance
FROM public.employees e
ORDER BY e.name;
