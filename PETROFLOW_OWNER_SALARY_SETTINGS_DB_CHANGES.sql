-- =============================================================
-- PetroFlow Owner/Customer Khata + Employee Salary + Settings DB Changes
-- Run this file in Supabase SQL Editor before using the updated project.
-- Existing data is NOT deleted.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Customer/Owner khata required columns
-- Balance convention used by the app:
-- Normal Customer: + = Udhaar, - = Advance
-- Owner/Cash:      + = Cash/Credit available, - = Debit/Outflow
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS public.customers
  ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_customers_category ON public.customers(category);
CREATE INDEX IF NOT EXISTS idx_customers_balance ON public.customers(balance);

-- -------------------------------------------------------------
-- 2) Bank finance / cash_deposits extensions
-- transaction_type values used by app:
-- deposit, credit, transfer, payment, salary_pay, expense
-- Deposit and transfer are balance movements, NOT profit/loss income.
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS public.cash_deposits
  ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'deposit',
  ADD COLUMN IF NOT EXISTS to_bank_id BIGINT REFERENCES public.banks(id),
  ADD COLUMN IF NOT EXISTS party_name TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_month TEXT,
  ADD COLUMN IF NOT EXISTS salary_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.cash_deposits
SET transaction_type = 'deposit'
WHERE transaction_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_deposits_transaction_type ON public.cash_deposits(transaction_type);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_to_bank ON public.cash_deposits(to_bank_id);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_salary_month ON public.cash_deposits(salary_month);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_salary_payment_id ON public.cash_deposits(salary_payment_id);

-- -------------------------------------------------------------
-- 3) Employee master account
-- Employee balance convention:
-- + = Payable/Credit to employee, - = Advance/Debit already taken
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  phone       TEXT,
  salary      NUMERIC(14,2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  account_note TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees(name);
CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_balance ON public.employees(balance);

-- -------------------------------------------------------------
-- 4) Employee salary/account payment history
-- payment_type values: salary_pay, advance, credit, debit
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_salary_payments (
  id             BIGSERIAL PRIMARY KEY,
  employee_id    BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  employee_name  TEXT,
  salary_month   TEXT NOT NULL,
  payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_type   TEXT NOT NULL DEFAULT 'salary_pay',
  is_advance     BOOLEAN NOT NULL DEFAULT FALSE,
  balance_effect NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  bank_id        BIGINT REFERENCES public.banks(id),
  payment_mode   TEXT DEFAULT 'Cash',
  reference      TEXT,
  note           TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.employee_salary_payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'salary_pay',
  ADD COLUMN IF NOT EXISTS is_advance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS balance_effect NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_salary_payments_employee ON public.employee_salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_month ON public.employee_salary_payments(salary_month);
CREATE INDEX IF NOT EXISTS idx_salary_payments_date ON public.employee_salary_payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_salary_payments_bank ON public.employee_salary_payments(bank_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_type ON public.employee_salary_payments(payment_type);

-- -------------------------------------------------------------
-- 5) Transactions optional linkage columns used by finance/salary/owner logic
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS charges NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cash_deposit_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS employee_id BIGINT,
  ADD COLUMN IF NOT EXISTS salary_month TEXT,
  ADD COLUMN IF NOT EXISTS bank_id BIGINT,
  ADD COLUMN IF NOT EXISTS to_bank_id BIGINT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS customer_category TEXT,
  ADD COLUMN IF NOT EXISTS linked_table TEXT,
  ADD COLUMN IF NOT EXISTS linked_id BIGINT,
  ADD COLUMN IF NOT EXISTS payment_month TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS entry_method TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON public.transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_transaction_type ON public.transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_cash_deposit_id ON public.transactions(cash_deposit_id);
CREATE INDEX IF NOT EXISTS idx_transactions_salary_payment_id ON public.transactions(salary_payment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_employee_id ON public.transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_transactions_salary_month ON public.transactions(salary_month);
CREATE INDEX IF NOT EXISTS idx_transactions_entry_method ON public.transactions(entry_method);

-- -------------------------------------------------------------
-- 6) Settings: fuel/mobil 15-day price history and tank update support
-- -------------------------------------------------------------
ALTER TABLE IF EXISTS public.settings
  ADD COLUMN IF NOT EXISTS price_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mobil_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS petrol_price NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diesel_price NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS car_mobil_price NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_mobil_price NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS public.tanks
  ADD COLUMN IF NOT EXISTS capacity NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- -------------------------------------------------------------
-- 7) RLS policies for new employee tables
-- -------------------------------------------------------------
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

-- -------------------------------------------------------------
-- 8) Optional helper functions for old data reconciliation.
-- These functions are created only; they are NOT automatically executed.
-- Run SELECT public.recalculate_customer_owner_balances(); only after backup
-- if old customer/owner balances need to be rebuilt from transactions.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_customer_owner_balances()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.customers SET balance = 0;

  UPDATE public.customers c
  SET balance = COALESCE(x.new_balance, 0)
  FROM (
    SELECT
      t.customer_id,
      SUM(
        CASE
          WHEN lower(COALESCE(c2.category,'')) = 'owner' THEN
            CASE
              WHEN t.transaction_type = 'CashSale' THEN COALESCE(t.amount, t.charges, 0)
              WHEN t.transaction_type = 'BankDeposit' THEN -COALESCE(t.amount, t.charges, 0)
              WHEN t.transaction_type = 'BankCredit' THEN COALESCE(t.amount, t.charges, 0)
              WHEN t.transaction_type IN ('BankPayment','SalaryPay','Expense','EmployeeAdvance','EmployeeDebit') THEN -COALESCE(t.amount, t.charges, 0)
              WHEN t.transaction_type = 'Debit' THEN COALESCE(t.amount, t.charges, 0)
              ELSE 0
            END
          ELSE
            CASE
              WHEN t.transaction_type = 'Credit' THEN COALESCE(t.amount, t.charges, 0)
              WHEN t.transaction_type = 'Debit'
                   AND (COALESCE(t.description,'') ILIKE '%payment%' OR t.payment_month IS NOT NULL)
                THEN -COALESCE(t.amount, t.charges, 0)
              WHEN t.transaction_type = 'Advance' THEN -COALESCE(t.amount, t.charges, 0)
              ELSE 0
            END
        END
      ) AS new_balance
    FROM public.transactions t
    JOIN public.customers c2 ON c2.id = t.customer_id
    WHERE t.customer_id IS NOT NULL
    GROUP BY t.customer_id
  ) x
  WHERE c.id = x.customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_employee_balances()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.employees SET balance = COALESCE(opening_balance,0);

  UPDATE public.employees e
  SET balance = COALESCE(e.opening_balance,0) + COALESCE(x.new_balance,0)
  FROM (
    SELECT employee_id,
      SUM(CASE
        WHEN payment_type = 'credit' THEN amount
        WHEN payment_type IN ('salary_pay','advance','debit') THEN -amount
        ELSE 0
      END) AS new_balance
    FROM public.employee_salary_payments
    GROUP BY employee_id
  ) x
  WHERE e.id = x.employee_id;
END;
$$;

COMMENT ON COLUMN public.cash_deposits.transaction_type IS 'Allowed app values: deposit, credit, transfer, payment, salary_pay, expense';
COMMENT ON COLUMN public.employee_salary_payments.payment_type IS 'Allowed app values: salary_pay, advance, credit, debit';
COMMENT ON COLUMN public.settings.price_history IS 'Fuel rate history. App validates fixed ranges: 1-15 and 16-month end.';
COMMENT ON COLUMN public.settings.mobil_history IS 'Mobil rate history. App validates fixed ranges: 1-15 and 16-month end.';
