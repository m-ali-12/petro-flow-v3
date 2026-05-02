-- ================================================================
-- PetroFlow — GO Company Account Final Fix
-- Run this ONCE in Supabase SQL Editor, then redeploy/upload the files.
-- Fixes:
-- 1. Account No. 10 as GO Company account
-- 2. Initial credit / credit limit columns
-- 3. b2b_company_id vs tenant company_id confusion
-- 4. Repayment/return rows not showing
-- 5. Summary, stock, member usage, expense views
-- 6. Missing columns used by frontend
-- ================================================================

BEGIN;

-- ---------------------------------------------------------------
-- Safety helper
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_company()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT company_id FROM public.user_profiles WHERE user_id = auth.uid());
END;
$$;

-- ---------------------------------------------------------------
-- Customer / account fields
-- ---------------------------------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_company BOOLEAN DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'regular';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_opening_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_closing_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_posting_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_document_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_document_no TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_reference_no TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_doc_type TEXT DEFAULT 'OP';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_description TEXT;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_credit NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_expense_also BOOLEAN DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure Account No. 10 exists and is treated as the GO company account.
DO $$
DECLARE
  v_user UUID;
  v_tenant UUID;
BEGIN
  SELECT user_id, company_id INTO v_user, v_tenant
  FROM public.user_profiles
  WHERE status = 'active'
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE sr_no = 10) THEN
    INSERT INTO public.customers (
      sr_no, name, category, balance, is_company, user_id, company_id,
      account_type, credit_limit, initial_credit, company_name, is_expense_also
    ) VALUES (
      10, 'GO Company cc', 'Company', 0, true, v_user, v_tenant,
      'company', 0, 0, 'GO Company cc', false
    );
  ELSE
    UPDATE public.customers
    SET name = COALESCE(NULLIF(name,''), 'GO Company cc'),
        company_name = 'GO Company cc',
        category = 'Company',
        is_company = true,
        account_type = 'company',
        company_id = COALESCE(company_id, v_tenant),
        user_id = COALESCE(user_id, v_user),
        updated_at = now()
    WHERE sr_no = 10;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- Company transaction tables: separate b2b customer id from tenant company id
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  b2b_company_id BIGINT REFERENCES public.customers(id),
  company_id UUID DEFAULT public.get_my_company(),
  member_id BIGINT REFERENCES public.customers(id),
  txn_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  charges NUMERIC(14,2) DEFAULT 0,
  fuel_type TEXT,
  liters NUMERIC(12,3),
  unit_price NUMERIC(10,2),
  payment_mode TEXT,
  reference_no TEXT,
  txn_date DATE DEFAULT CURRENT_DATE,
  description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- If old schema had company_id BIGINT, rename it to b2b_company_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_transactions'
      AND column_name='company_id' AND data_type IN ('bigint','integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='company_transactions' AND column_name='b2b_company_id'
    ) THEN
      ALTER TABLE public.company_transactions RENAME COLUMN company_id TO b2b_company_id;
    END IF;
  END IF;
END $$;
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT REFERENCES public.customers(id);
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS net_amount NUMERIC(14,2) GENERATED ALWAYS AS (COALESCE(amount,0) + COALESCE(charges,0)) STORED;

CREATE TABLE IF NOT EXISTS public.company_repayments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  b2b_company_id BIGINT REFERENCES public.customers(id),
  company_id UUID DEFAULT public.get_my_company(),
  company_txn_id BIGINT REFERENCES public.company_transactions(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_mode TEXT DEFAULT 'cash',
  reference_no TEXT,
  payment_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  verified BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_repayments'
      AND column_name='company_id' AND data_type IN ('bigint','integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='company_repayments' AND column_name='b2b_company_id'
    ) THEN
      ALTER TABLE public.company_repayments RENAME COLUMN company_id TO b2b_company_id;
    END IF;
  END IF;
END $$;
ALTER TABLE public.company_repayments ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT REFERENCES public.customers(id);
ALTER TABLE public.company_repayments ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
ALTER TABLE public.company_repayments ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS public.member_card_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  b2b_company_id BIGINT REFERENCES public.customers(id),
  company_id UUID DEFAULT public.get_my_company(),
  member_id BIGINT REFERENCES public.customers(id),
  company_txn_id BIGINT REFERENCES public.company_transactions(id) ON DELETE SET NULL,
  fuel_type TEXT,
  liters NUMERIC(12,3),
  unit_price NUMERIC(10,2),
  stock_value NUMERIC(14,2) DEFAULT 0,
  atm_charges NUMERIC(14,2) DEFAULT 0,
  misc_charges NUMERIC(14,2) DEFAULT 0,
  total_charges NUMERIC(14,2) DEFAULT 0,
  usage_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='member_card_usage'
      AND column_name='company_id' AND data_type IN ('bigint','integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='member_card_usage' AND column_name='b2b_company_id'
    ) THEN
      ALTER TABLE public.member_card_usage RENAME COLUMN company_id TO b2b_company_id;
    END IF;
  END IF;
END $$;
ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT REFERENCES public.customers(id);
ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS atm_charges NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS misc_charges NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS stock_value NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS total_charges NUMERIC(14,2) DEFAULT 0;

-- ---------------------------------------------------------------
-- Stock tables missing frontend columns
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_purchases (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  company_id UUID DEFAULT public.get_my_company(),
  b2b_company_id BIGINT REFERENCES public.customers(id),
  company_txn_id BIGINT REFERENCES public.company_transactions(id) ON DELETE SET NULL,
  fuel_type TEXT NOT NULL,
  liters NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(10,2) DEFAULT 0,
  charges NUMERIC(14,2) DEFAULT 0,
  total_amount NUMERIC(14,2) DEFAULT 0,
  invoice_no TEXT,
  truck_no TEXT,
  supplier TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.stock_purchases ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
ALTER TABLE public.stock_purchases ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT REFERENCES public.customers(id);
ALTER TABLE public.stock_purchases ADD COLUMN IF NOT EXISTS company_txn_id BIGINT REFERENCES public.company_transactions(id) ON DELETE SET NULL;
ALTER TABLE public.stock_purchases ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.stock_purchases ADD COLUMN IF NOT EXISTS supplier TEXT;

ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS price_per_liter NUMERIC(10,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS truck_number TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS net_payable NUMERIC(14,2);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS purchase_date DATE DEFAULT CURRENT_DATE;

-- Expense columns used by company account expense ledger
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS expense_type TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS expense_account TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS charges NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0;

-- Backfill relationships for rows saved by previous broken JS
UPDATE public.company_transactions ct
SET b2b_company_id = c.id
FROM public.customers c
WHERE c.sr_no = 10 AND ct.b2b_company_id IS NULL;

UPDATE public.company_repayments cr
SET b2b_company_id = c.id
FROM public.customers c
WHERE c.sr_no = 10 AND cr.b2b_company_id IS NULL;

UPDATE public.member_card_usage mcu
SET b2b_company_id = c.id
FROM public.customers c
WHERE c.sr_no = 10 AND mcu.b2b_company_id IS NULL;

UPDATE public.stock_purchases sp
SET b2b_company_id = c.id
FROM public.customers c
WHERE c.sr_no = 10 AND sp.b2b_company_id IS NULL;

-- Backfill tenant company_id from user profile
UPDATE public.company_transactions t SET company_id = p.company_id
FROM public.user_profiles p
WHERE t.user_id = p.user_id AND t.company_id IS NULL;
UPDATE public.company_repayments t SET company_id = p.company_id
FROM public.user_profiles p
WHERE t.user_id = p.user_id AND t.company_id IS NULL;
UPDATE public.member_card_usage t SET company_id = p.company_id
FROM public.user_profiles p
WHERE t.user_id = p.user_id AND t.company_id IS NULL;
UPDATE public.stock_purchases t SET company_id = p.company_id
FROM public.user_profiles p
WHERE t.user_id = p.user_id AND t.company_id IS NULL;
UPDATE public.stock_entries t SET company_id = p.company_id
FROM public.user_profiles p
WHERE t.user_id = p.user_id AND t.company_id IS NULL;

-- Normalize member usage computed values
UPDATE public.member_card_usage
SET stock_value = COALESCE(stock_value, 0) + CASE WHEN COALESCE(stock_value, 0) = 0 THEN COALESCE(liters,0) * COALESCE(unit_price,0) ELSE 0 END,
    total_charges = COALESCE(total_charges,0) + CASE WHEN COALESCE(total_charges, 0) = 0 THEN COALESCE(atm_charges,0) + COALESCE(misc_charges,0) ELSE 0 END;

-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_transactions') THEN
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS document_no TEXT;
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS posting_date DATE;
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS document_date DATE;
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS opening_date DATE;
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS closing_date DATE;
    ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS doc_type TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_company_txn_b2b ON public.company_transactions(b2b_company_id);
CREATE INDEX IF NOT EXISTS idx_company_txn_tenant ON public.company_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_company_txn_date ON public.company_transactions(txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_company_repay_b2b ON public.company_repayments(b2b_company_id);
CREATE INDEX IF NOT EXISTS idx_member_card_b2b ON public.member_card_usage(b2b_company_id);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_b2b ON public.stock_purchases(b2b_company_id);

-- ---------------------------------------------------------------
-- RLS: keep strict tenant isolation where company_id exists
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._petro_apply_isolation(tbl TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS petro_isolation_policy ON public.%I', tbl);
  EXECUTE format('CREATE POLICY petro_isolation_policy ON public.%I FOR ALL TO authenticated USING (
    (SELECT role FROM public.user_profiles WHERE user_id = auth.uid()) = ''super_admin''
    OR company_id = public.get_my_company()
  ) WITH CHECK (
    (SELECT role FROM public.user_profiles WHERE user_id = auth.uid()) = ''super_admin''
    OR company_id = public.get_my_company()
    OR company_id IS NULL
  )', tbl);
END $$;

SELECT public._petro_apply_isolation('customers');
SELECT public._petro_apply_isolation('transactions');
SELECT public._petro_apply_isolation('stock_entries');
SELECT public._petro_apply_isolation('stock_purchases');
SELECT public._petro_apply_isolation('company_transactions');
SELECT public._petro_apply_isolation('company_repayments');
SELECT public._petro_apply_isolation('member_card_usage');

-- ---------------------------------------------------------------
-- Views expected by frontend
-- ---------------------------------------------------------------
DROP VIEW IF EXISTS public.v_company_account_summary CASCADE;
CREATE OR REPLACE VIEW public.v_company_account_summary AS
WITH acct AS (
  SELECT * FROM public.customers WHERE sr_no = 10 LIMIT 1
), txn AS (
  SELECT
    b2b_company_id,
    COALESCE(SUM(CASE WHEN direction='out' AND txn_type IN ('stock_purchase','member_usage') THEN amount ELSE 0 END),0) AS total_stock_purchased,
    COALESCE(SUM(CASE WHEN direction='out' THEN charges ELSE 0 END),0) AS total_charges,
    COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS total_repaid
  FROM public.company_transactions
  GROUP BY b2b_company_id
), exp AS (
  SELECT
    COALESCE(SUM(CASE WHEN c.is_expense_also = true THEN t.amount ELSE 0 END),0) AS total_linked_expenses,
    COALESCE(SUM(t.amount),0) AS grand_total_expenses
  FROM public.transactions t
  LEFT JOIN public.customers c ON c.id = t.customer_id
  WHERE t.transaction_type = 'Expense'
)
SELECT
  a.id,
  a.name,
  COALESCE(a.company_name, a.name, 'GO Company cc') AS company_name,
  a.sr_no,
  a.company_id AS tenant_id,
  COALESCE(a.credit_limit,0) AS credit_limit,
  COALESCE(a.initial_credit,0) AS initial_credit,
  COALESCE(txn.total_stock_purchased,0) AS total_stock_purchased,
  COALESCE(txn.total_charges,0) AS total_charges,
  COALESCE(txn.total_repaid,0) AS total_repaid,
  COALESCE(exp.total_linked_expenses,0) AS total_linked_expenses,
  COALESCE(exp.grand_total_expenses,0) AS grand_total_expenses,
  (COALESCE(a.initial_credit,0) + COALESCE(txn.total_stock_purchased,0) + COALESCE(txn.total_charges,0) - COALESCE(txn.total_repaid,0)) AS net_payable_to_company,
  GREATEST(0, COALESCE(a.credit_limit,0) - (COALESCE(a.initial_credit,0) + COALESCE(txn.total_stock_purchased,0) + COALESCE(txn.total_charges,0) - COALESCE(txn.total_repaid,0))) AS remaining_credit_limit
FROM acct a
LEFT JOIN txn ON txn.b2b_company_id = a.id
CROSS JOIN exp;

DROP VIEW IF EXISTS public.v_stock_by_fuel CASCADE;
CREATE OR REPLACE VIEW public.v_stock_by_fuel AS
SELECT
  b2b_company_id,
  company_id,
  fuel_type,
  COUNT(*) AS purchase_count,
  COALESCE(SUM(liters),0) AS total_liters,
  COALESCE(AVG(NULLIF(unit_price,0)),0) AS avg_unit_price,
  COALESCE(SUM(COALESCE(total_amount, COALESCE(liters,0) * COALESCE(unit_price,0))),0) AS total_value,
  COALESCE(SUM(charges),0) AS total_charges,
  COALESCE(SUM(COALESCE(total_amount, COALESCE(liters,0) * COALESCE(unit_price,0)) + COALESCE(charges,0)),0) AS total_net_payable
FROM public.stock_purchases
GROUP BY b2b_company_id, company_id, fuel_type;

DROP VIEW IF EXISTS public.v_member_usage_summary CASCADE;
CREATE OR REPLACE VIEW public.v_member_usage_summary AS
SELECT
  mcu.b2b_company_id,
  mcu.company_id,
  m.id AS member_id,
  m.name AS member_name,
  m.sr_no AS member_no,
  MAX(mcu.fuel_type) AS fuel_type,
  COUNT(mcu.id) AS usage_count,
  COALESCE(SUM(mcu.liters),0) AS total_liters,
  COALESCE(SUM(COALESCE(mcu.stock_value, COALESCE(mcu.liters,0) * COALESCE(mcu.unit_price,0))),0) AS stock_value,
  COALESCE(SUM(COALESCE(mcu.total_charges,0) + COALESCE(mcu.atm_charges,0) + COALESCE(mcu.misc_charges,0)),0) AS total_charges,
  COALESCE(SUM(COALESCE(mcu.stock_value, COALESCE(mcu.liters,0) * COALESCE(mcu.unit_price,0)) + COALESCE(mcu.total_charges,0) + COALESCE(mcu.atm_charges,0) + COALESCE(mcu.misc_charges,0)),0) AS grand_total
FROM public.member_card_usage mcu
LEFT JOIN public.customers m ON m.id = mcu.member_id
GROUP BY mcu.b2b_company_id, mcu.company_id, m.id, m.name, m.sr_no;

DROP VIEW IF EXISTS public.v_expense_ledger CASCADE;
CREATE OR REPLACE VIEW public.v_expense_ledger AS
SELECT
  t.id,
  t.created_at AS expense_date,
  t.amount,
  t.description,
  t.notes,
  t.transaction_type,
  t.fuel_type,
  t.user_id,
  t.company_id,
  t.expense_type AS category,
  t.expense_account AS paid_from,
  c.name AS account_name,
  c.sr_no AS account_no,
  COALESCE(c.is_expense_also,false) AS is_expense_also
FROM public.transactions t
LEFT JOIN public.customers c ON c.id = t.customer_id
WHERE t.transaction_type = 'Expense'
ORDER BY t.created_at DESC;

COMMIT;

-- After running this SQL:
-- 1. Redeploy/upload repaired files.
-- 2. Hard refresh browser with Ctrl + Shift + R.
-- 3. Open company-account.html and test Initial Credit, Repayment, Print Statement.
