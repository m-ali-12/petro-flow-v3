-- =============================================================
-- PetroFlow Complete Final Fix
-- Run this once in Supabase SQL Editor after deploying the ZIP.
-- Fixes: transaction/customer joins, cash advance joins, balance audit,
-- stock tank update compatibility, bank deposit tracking, GO account support.
-- =============================================================

-- 1) Core relationship fixes for PostgREST joins
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_customer_id_fkey;
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'transactions FK skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_advances')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    ALTER TABLE public.cash_advances DROP CONSTRAINT IF EXISTS cash_advances_customer_id_fkey;
    ALTER TABLE public.cash_advances
      ADD CONSTRAINT cash_advances_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cash_advances FK skipped: %', SQLERRM;
END $$;

-- 2) Transactions audit/compatibility columns
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS charges NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_before NUMERIC(14,2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS customer_balance_before NUMERIC(14,2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS customer_balance_after NUMERIC(14,2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_effect NUMERIC(14,2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS fuel_type TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_mode TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS entry_method TEXT DEFAULT 'manual';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS reference_no TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cash_advance_id BIGINT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cash_deposit_id BIGINT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS expense_type TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS expense_account TEXT;

UPDATE public.transactions
SET amount = COALESCE(NULLIF(amount,0), charges, 0),
    charges = COALESCE(NULLIF(charges,0), amount, 0)
WHERE COALESCE(amount,0) = 0 OR COALESCE(charges,0) = 0;

CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON public.transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_cash_deposit_id ON public.transactions(cash_deposit_id);

-- 3) Cash advance table compatibility
CREATE TABLE IF NOT EXISTS public.cash_advances (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  customer_id BIGINT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT,
  description TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  advance_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS company_id UUID;
CREATE INDEX IF NOT EXISTS idx_cash_advances_customer_id ON public.cash_advances(customer_id);
CREATE INDEX IF NOT EXISTS idx_cash_advances_date ON public.cash_advances(advance_date DESC);

-- 4) Tanks compatibility. JS no longer requires unique on_conflict, but this improves consistency.
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS capacity NUMERIC(14,2) DEFAULT 25000;
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS current_stock NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_tanks_company_fuel ON public.tanks(company_id, fuel_type);
CREATE INDEX IF NOT EXISTS idx_tanks_fuel_type ON public.tanks(fuel_type);

INSERT INTO public.tanks (name, fuel_type, capacity, current_stock)
SELECT 'Petrol Tank 1', 'Petrol', 25000, 0
WHERE NOT EXISTS (SELECT 1 FROM public.tanks WHERE fuel_type='Petrol');
INSERT INTO public.tanks (name, fuel_type, capacity, current_stock)
SELECT 'Diesel Tank 1', 'Diesel', 25000, 0
WHERE NOT EXISTS (SELECT 1 FROM public.tanks WHERE fuel_type='Diesel');

-- 5) Stock entries compatibility between old/new column names
CREATE TABLE IF NOT EXISTS public.stock_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  fuel_type TEXT,
  liters NUMERIC(12,3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS price_per_liter NUMERIC(10,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS truck_number TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS net_payable NUMERIC(14,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS purchase_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS charges NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS notes TEXT;
-- Old names retained where older code/reports expect them
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS invoice_no TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS truck_no TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS entry_date DATE DEFAULT CURRENT_DATE;

UPDATE public.stock_entries SET
  price_per_liter = COALESCE(price_per_liter, unit_price),
  unit_price = COALESCE(unit_price, price_per_liter),
  total_amount = COALESCE(total_amount, total_cost),
  total_cost = COALESCE(total_cost, total_amount),
  invoice_number = COALESCE(invoice_number, invoice_no),
  invoice_no = COALESCE(invoice_no, invoice_number),
  truck_number = COALESCE(truck_number, truck_no),
  truck_no = COALESCE(truck_no, truck_number),
  purchase_date = COALESCE(purchase_date, entry_date),
  entry_date = COALESCE(entry_date, purchase_date),
  net_payable = COALESCE(net_payable, total_amount + COALESCE(charges,0));

CREATE INDEX IF NOT EXISTS idx_stock_entries_fuel ON public.stock_entries(fuel_type);
CREATE INDEX IF NOT EXISTS idx_stock_entries_date ON public.stock_entries(purchase_date DESC);

-- 6) Bank deposit compatibility
CREATE TABLE IF NOT EXISTS public.banks (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  account_number TEXT,
  branch TEXT,
  color TEXT DEFAULT 'primary',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.banks ADD COLUMN IF NOT EXISTS company_id UUID;

CREATE TABLE IF NOT EXISTS public.cash_deposits (
  id BIGSERIAL PRIMARY KEY,
  deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  bank_id BIGINT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deposited_by TEXT,
  reference TEXT,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.cash_deposits ADD COLUMN IF NOT EXISTS company_id UUID;
CREATE INDEX IF NOT EXISTS idx_cash_deposits_date ON public.cash_deposits(deposit_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_bank ON public.cash_deposits(bank_id);

-- 7) Customer/GO account compatibility
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_credit NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_company BOOLEAN DEFAULT FALSE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS account_type TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_id UUID;

INSERT INTO public.customers (sr_no, name, category, balance, initial_credit, credit_limit, is_company, account_type)
SELECT 10, 'GO Company cc', 'Company', 0, 0, 0, TRUE, 'supplier_credit'
WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE sr_no = 10);

UPDATE public.customers
SET name = 'GO Company cc', company_name = 'GO Company cc', is_company = TRUE, account_type = 'supplier_credit'
WHERE sr_no = 10;

-- 8) Optional company account FK fixes if tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_transactions') THEN
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT;
    ALTER TABLE public.company_transactions DROP CONSTRAINT IF EXISTS company_transactions_b2b_company_id_fkey;
    ALTER TABLE public.company_transactions ADD CONSTRAINT company_transactions_b2b_company_id_fkey
      FOREIGN KEY (b2b_company_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_repayments') THEN
    ALTER TABLE public.company_repayments ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT;
    ALTER TABLE public.company_repayments DROP CONSTRAINT IF EXISTS company_repayments_b2b_company_id_fkey;
    ALTER TABLE public.company_repayments ADD CONSTRAINT company_repayments_b2b_company_id_fkey
      FOREIGN KEY (b2b_company_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='member_card_usage') THEN
    ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT;
    ALTER TABLE public.member_card_usage DROP CONSTRAINT IF EXISTS member_card_usage_b2b_company_id_fkey;
    ALTER TABLE public.member_card_usage ADD CONSTRAINT member_card_usage_b2b_company_id_fkey
      FOREIGN KEY (b2b_company_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 9) Helpful view for balance audit in reports
CREATE OR REPLACE VIEW public.v_transaction_balance_audit AS
SELECT
  t.id,
  t.created_at,
  t.customer_id,
  c.sr_no,
  c.name AS customer_name,
  t.transaction_type,
  COALESCE(NULLIF(t.charges,0), t.amount, 0) AS amount,
  t.balance_before,
  t.balance_after,
  t.description
FROM public.transactions t
LEFT JOIN public.customers c ON c.id = t.customer_id
ORDER BY t.created_at DESC, t.id DESC;

-- Done
SELECT 'PetroFlow final fix completed successfully' AS status;

-- Force PostgREST/Supabase schema cache refresh
NOTIFY pgrst, 'reload schema';
