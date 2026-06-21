-- =============================================================
-- PetroFlow Employee Salary Logic FINAL SAFE FIX
-- Safe to run in Supabase SQL Editor.
-- Non-destructive safe file. Existing rows stay safe.
-- Purpose:
--   1) Monthly salary is credited/payable once per employee/month.
--   2) Any cash/bank payment up to monthly salary is Salary Pay.
--   3) Any amount above monthly salary is Advanced Payment.
--   4) Advance Return / Recovery clears employee advance.
--   5) Existing wrong advance rows are safely adjusted by UPDATE/INSERT only.
-- =============================================================

-- Required columns. Existing data stays safe.
ALTER TABLE IF EXISTS public.employees
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS public.employee_salary_payments
  ADD COLUMN IF NOT EXISTS advance_month TEXT,
  ADD COLUMN IF NOT EXISTS auto_split_group TEXT,
  ADD COLUMN IF NOT EXISTS entry_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS balance_effect NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Old advance rows get their target salary month recorded.
UPDATE public.employee_salary_payments
SET advance_month = salary_month,
    updated_at = NOW()
WHERE advance_month IS NULL
  AND payment_type IN ('advance','debit');

-- Correct balance_effect convention:
--   credit/payable and advance_return = plus
--   salary_pay, advance, debit = minus
UPDATE public.employee_salary_payments
SET balance_effect = CASE
    WHEN payment_type IN ('credit','advance_return') THEN COALESCE(amount,0)
    WHEN payment_type IN ('salary_pay','advance','debit') THEN -COALESCE(amount,0)
    ELSE 0
  END,
  is_advance = CASE WHEN payment_type = 'advance' THEN TRUE ELSE FALSE END,
  updated_at = NOW()
WHERE payment_type IN ('credit','advance_return','salary_pay','advance','debit');

-- If old data has an advance payment while salary for that month is still unpaid,
-- convert the required part of that advance into Salary Pay and keep only the extra as Advance.
DO $$
DECLARE
  m RECORD;
  a RECORD;
  remaining_salary NUMERIC;
  split_group TEXT;
BEGIN
  FOR m IN
    SELECT
      e.id AS employee_id,
      e.name AS employee_name,
      COALESCE(e.salary,0) AS monthly_salary,
      p.salary_month,
      COALESCE(SUM(CASE WHEN p.payment_type = 'salary_pay' THEN COALESCE(p.amount,0) ELSE 0 END),0) AS salary_paid
    FROM public.employees e
    JOIN public.employee_salary_payments p ON p.employee_id = e.id
    WHERE COALESCE(p.entry_status,'active') = 'active'
      AND p.salary_month IS NOT NULL
      AND COALESCE(e.salary,0) > 0
    GROUP BY e.id, e.name, e.salary, p.salary_month
  LOOP
    remaining_salary := GREATEST(0, COALESCE(m.monthly_salary,0) - COALESCE(m.salary_paid,0));

    IF remaining_salary > 0 THEN
      FOR a IN
        SELECT *
        FROM public.employee_salary_payments
        WHERE employee_id = m.employee_id
          AND salary_month = m.salary_month
          AND payment_type IN ('advance','debit')
          AND COALESCE(entry_status,'active') = 'active'
          AND COALESCE(amount,0) > 0
        ORDER BY payment_date, id
      LOOP
        EXIT WHEN remaining_salary <= 0;
        split_group := COALESCE(a.auto_split_group, 'salary-advance-fix-' || a.id::TEXT);

        IF COALESCE(a.amount,0) <= remaining_salary THEN
          -- Whole advance row should actually be salary pay.
          UPDATE public.employee_salary_payments
          SET payment_type = 'salary_pay',
              is_advance = FALSE,
              advance_month = NULL,
              balance_effect = -COALESCE(amount,0),
              auto_split_group = split_group,
              note = CONCAT(COALESCE(note,''), CASE WHEN COALESCE(note,'') <> '' THEN ' | ' ELSE '' END,
                            'Auto corrected: counted as salary pay within monthly salary limit'),
              updated_at = NOW()
          WHERE id = a.id;

          remaining_salary := remaining_salary - COALESCE(a.amount,0);
        ELSE
          -- Part of this row is salary pay; remaining stays as advance.
          UPDATE public.employee_salary_payments
          SET amount = COALESCE(a.amount,0) - remaining_salary,
              balance_effect = -(COALESCE(a.amount,0) - remaining_salary),
              is_advance = TRUE,
              advance_month = COALESCE(advance_month, salary_month),
              auto_split_group = split_group,
              note = CONCAT(COALESCE(note,''), CASE WHEN COALESCE(note,'') <> '' THEN ' | ' ELSE '' END,
                            'Auto corrected: extra over salary kept as advance'),
              updated_at = NOW()
          WHERE id = a.id;

          INSERT INTO public.employee_salary_payments
            (employee_id, employee_name, salary_month, payment_date, payment_type, is_advance,
             balance_effect, amount, bank_id, payment_mode, reference, note,
             advance_month, auto_split_group, entry_status, created_by, created_at, updated_at)
          VALUES
            (a.employee_id, COALESCE(a.employee_name, m.employee_name), a.salary_month, a.payment_date, 'salary_pay', FALSE,
             -remaining_salary, remaining_salary, a.bank_id, a.payment_mode, a.reference,
             CONCAT('Auto corrected salary part from advance entry #', a.id),
             NULL, split_group, 'active', a.created_by, NOW(), NOW());

          remaining_salary := 0;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Ensure each employee/month with any salary payment/advance has monthly salary payable credit.
-- This prevents paid salary from looking like advance when no manual credit row exists.
WITH months AS (
  SELECT
    p.employee_id,
    p.salary_month,
    MIN(p.payment_date) AS first_date,
    COALESCE(SUM(CASE WHEN p.payment_type = 'credit' THEN COALESCE(p.amount,0) ELSE 0 END),0) AS credit_total
  FROM public.employee_salary_payments p
  WHERE COALESCE(p.entry_status,'active') = 'active'
    AND p.salary_month IS NOT NULL
  GROUP BY p.employee_id, p.salary_month
), needed AS (
  SELECT
    e.id AS employee_id,
    e.name AS employee_name,
    m.salary_month,
    COALESCE(m.first_date, CURRENT_DATE) AS first_date,
    GREATEST(0, COALESCE(e.salary,0) - COALESCE(m.credit_total,0)) AS amount_needed
  FROM months m
  JOIN public.employees e ON e.id = m.employee_id
  WHERE COALESCE(e.salary,0) > COALESCE(m.credit_total,0)
)
INSERT INTO public.employee_salary_payments
  (employee_id, employee_name, salary_month, payment_date, payment_type, is_advance,
   balance_effect, amount, bank_id, payment_mode, reference, note,
   advance_month, auto_split_group, entry_status, created_at, updated_at)
SELECT
  employee_id,
  employee_name,
  salary_month,
  first_date,
  'credit',
  FALSE,
  amount_needed,
  amount_needed,
  NULL,
  'Ledger Credit',
  'AUTO-' || salary_month,
  'Auto monthly salary payable for ' || salary_month,
  NULL,
  'monthly-salary-credit-' || employee_id::TEXT || '-' || salary_month,
  'active',
  NOW(),
  NOW()
FROM needed
WHERE amount_needed > 0;

-- Recalculate employee balances after correction.
-- Balance meaning:
--   positive = payable/credit due to employee
--   negative = advance outstanding from employee
WITH calc AS (
  SELECT
    e.id AS employee_id,
    COALESCE(e.opening_balance,0) + COALESCE(SUM(
      CASE
        WHEN p.payment_type IN ('credit','advance_return') THEN COALESCE(p.amount,0)
        WHEN p.payment_type IN ('salary_pay','advance','debit') THEN -COALESCE(p.amount,0)
        ELSE 0
      END
    ),0) AS new_balance
  FROM public.employees e
  LEFT JOIN public.employee_salary_payments p
    ON p.employee_id = e.id
   AND COALESCE(p.entry_status,'active') = 'active'
  GROUP BY e.id, e.opening_balance
)
UPDATE public.employees e
SET balance = calc.new_balance,
    updated_at = NOW()
FROM calc
WHERE e.id = calc.employee_id;

CREATE INDEX IF NOT EXISTS idx_salary_payments_advance_month
  ON public.employee_salary_payments(advance_month);
CREATE INDEX IF NOT EXISTS idx_salary_payments_auto_split_group
  ON public.employee_salary_payments(auto_split_group);
CREATE INDEX IF NOT EXISTS idx_salary_payments_entry_status
  ON public.employee_salary_payments(entry_status);

-- Preview after fix.
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.salary AS monthly_salary,
  e.balance AS current_balance,
  CASE WHEN e.balance >= 0 THEN 'Payable/Credit' ELSE 'Advance Outstanding' END AS balance_status
FROM public.employees e
ORDER BY e.name;
