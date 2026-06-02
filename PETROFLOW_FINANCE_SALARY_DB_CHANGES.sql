-- =============================================================
-- PetroFlow Finance + Employee Salary DB Changes
-- Run this file in Supabase SQL Editor before using the new pages.
-- It only adds required tables/columns. Existing data is not deleted.
-- =============================================================

-- 1) Extend existing bank finance table so it can handle more than deposits.
ALTER TABLE public.cash_deposits
  ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'deposit',
  ADD COLUMN IF NOT EXISTS to_bank_id BIGINT REFERENCES public.banks(id),
  ADD COLUMN IF NOT EXISTS party_name TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_month TEXT,
  ADD COLUMN IF NOT EXISTS salary_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill old deposit rows so old records remain visible as Deposit.
UPDATE public.cash_deposits
SET transaction_type = 'deposit'
WHERE transaction_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_deposits_transaction_type ON public.cash_deposits(transaction_type);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_to_bank ON public.cash_deposits(to_bank_id);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_salary_month ON public.cash_deposits(salary_month);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_salary_payment_id ON public.cash_deposits(salary_payment_id);

-- 2) Employee master table.
CREATE TABLE IF NOT EXISTS public.employees (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  phone       TEXT,
  salary      NUMERIC(14,2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees(name);
CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(status);

-- 3) Employee salary payment history.
CREATE TABLE IF NOT EXISTS public.employee_salary_payments (
  id             BIGSERIAL PRIMARY KEY,
  employee_id    BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  employee_name  TEXT,
  salary_month   TEXT NOT NULL, -- YYYY-MM
  payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  bank_id        BIGINT REFERENCES public.banks(id),
  payment_mode   TEXT DEFAULT 'Cash',
  reference      TEXT,
  note           TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_payments_employee ON public.employee_salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_month ON public.employee_salary_payments(salary_month);
CREATE INDEX IF NOT EXISTS idx_salary_payments_date ON public.employee_salary_payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_salary_payments_bank ON public.employee_salary_payments(bank_id);

-- 4) Optional transaction columns used by finance/salary inserts.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS cash_deposit_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_month TEXT,
  ADD COLUMN IF NOT EXISTS bank_id BIGINT,
  ADD COLUMN IF NOT EXISTS to_bank_id BIGINT,
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_cash_deposit_id ON public.transactions(cash_deposit_id);
CREATE INDEX IF NOT EXISTS idx_transactions_salary_payment_id ON public.transactions(salary_payment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_employee_id ON public.transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_transactions_salary_month ON public.transactions(salary_month);

-- 5) RLS policies for new employee salary tables.
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_salary_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employees_read_active" ON public.employees;
DROP POLICY IF EXISTS "employees_write_managers" ON public.employees;
DROP POLICY IF EXISTS "salary_payments_read_active" ON public.employee_salary_payments;
DROP POLICY IF EXISTS "salary_payments_write_managers" ON public.employee_salary_payments;

CREATE POLICY "employees_read_active"
  ON public.employees FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.status = 'active'
    )
  );

CREATE POLICY "employees_write_managers"
  ON public.employees FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('manager','admin','super_admin')
        AND p.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('manager','admin','super_admin')
        AND p.status = 'active'
    )
  );

CREATE POLICY "salary_payments_read_active"
  ON public.employee_salary_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.status = 'active'
    )
  );

CREATE POLICY "salary_payments_write_managers"
  ON public.employee_salary_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('manager','admin','super_admin')
        AND p.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('manager','admin','super_admin')
        AND p.status = 'active'
    )
  );

-- 6) Helpful comments for allowed bank finance transaction_type values.
COMMENT ON COLUMN public.cash_deposits.transaction_type IS
'Allowed app values: deposit, credit, transfer, payment, salary_pay, expense';
COMMENT ON COLUMN public.employee_salary_payments.salary_month IS
'Salary month in YYYY-MM format.';
