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
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS name TEXT;
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
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_opening_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_closing_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_posting_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_document_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_document_no TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_reference_no TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_doc_type TEXT DEFAULT 'OP';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS initial_description TEXT;

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


-- 7A) Ensure customers.id can be used safely as FK target.
-- Some old databases imported customers without PRIMARY KEY/UNIQUE on id.
-- Foreign keys require the referenced column to be unique.
DO $$
DECLARE
  has_dup BOOLEAN := FALSE;
  has_unique BOOLEAN := FALSE;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='id') THEN

    -- Fill any NULL ids without touching existing ids.
    IF EXISTS (SELECT 1 FROM public.customers WHERE id IS NULL) THEN
      WITH numbered AS (
        SELECT ctid, COALESCE((SELECT MAX(id) FROM public.customers),0) + ROW_NUMBER() OVER () AS new_id
        FROM public.customers
        WHERE id IS NULL
      )
      UPDATE public.customers c
      SET id = numbered.new_id
      FROM numbered
      WHERE c.ctid = numbered.ctid;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.customers GROUP BY id HAVING COUNT(*) > 1 LIMIT 1
    ) INTO has_dup;

    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname='public'
        AND rel.relname='customers'
        AND con.contype IN ('p','u')
        AND con.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid='public.customers'::regclass AND attname='id')
        ]::smallint[]
    ) INTO has_unique;

    IF NOT has_dup AND NOT has_unique THEN
      BEGIN
        ALTER TABLE public.customers ALTER COLUMN id SET NOT NULL;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'customers.id NOT NULL skipped: %', SQLERRM;
      END;

      BEGIN
        ALTER TABLE public.customers ADD CONSTRAINT customers_id_unique_for_fk UNIQUE (id);
        RAISE NOTICE 'Added UNIQUE constraint on customers.id for FK support';
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      WHEN OTHERS THEN
        RAISE NOTICE 'customers.id unique constraint skipped: %', SQLERRM;
      END;
    ELSIF has_dup THEN
      RAISE NOTICE 'customers.id has duplicate values, FK creation will be skipped until duplicates are cleaned';
    END IF;
  END IF;
END $$;


-- 7B) Re-apply core FKs after customers.id UNIQUE safety check
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    BEGIN
      ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_customer_id_fkey;
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'transactions FK re-apply skipped: %', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_advances')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    BEGIN
      ALTER TABLE public.cash_advances DROP CONSTRAINT IF EXISTS cash_advances_customer_id_fkey;
      ALTER TABLE public.cash_advances
        ADD CONSTRAINT cash_advances_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'cash_advances FK re-apply skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- 8) Optional company account FK fixes if tables exist
-- Each FK is isolated so one old table cannot stop the whole project patch.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_transactions') THEN
    BEGIN
      ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT;
      ALTER TABLE public.company_transactions DROP CONSTRAINT IF EXISTS company_transactions_b2b_company_id_fkey;
      ALTER TABLE public.company_transactions ADD CONSTRAINT company_transactions_b2b_company_id_fkey
        FOREIGN KEY (b2b_company_id) REFERENCES public.customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'company_transactions b2b FK skipped: %', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_repayments') THEN
    BEGIN
      ALTER TABLE public.company_repayments ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT;
      ALTER TABLE public.company_repayments DROP CONSTRAINT IF EXISTS company_repayments_b2b_company_id_fkey;
      ALTER TABLE public.company_repayments ADD CONSTRAINT company_repayments_b2b_company_id_fkey
        FOREIGN KEY (b2b_company_id) REFERENCES public.customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'company_repayments b2b FK skipped: %', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='member_card_usage') THEN
    BEGIN
      ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS b2b_company_id BIGINT;
      ALTER TABLE public.member_card_usage DROP CONSTRAINT IF EXISTS member_card_usage_b2b_company_id_fkey;
      ALTER TABLE public.member_card_usage ADD CONSTRAINT member_card_usage_b2b_company_id_fkey
        FOREIGN KEY (b2b_company_id) REFERENCES public.customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'member_card_usage b2b FK skipped: %', SQLERRM;
    END;
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



-- =============================================================
-- EXTRA FINAL PATCH v2: admin invites, customer add, RLS, safe tanks
-- Run-safe: this section is safe to run again.
-- =============================================================

-- Core company/profile compatibility
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Khalid & Sons Petroleum',
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'employee',
  status TEXT DEFAULT 'pending',
  company_id UUID REFERENCES public.companies(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'employee';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);

CREATE TABLE IF NOT EXISTS public.staff_invites (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'employee',
  status TEXT DEFAULT 'pending',
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.staff_invites ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.staff_invites ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.staff_invites ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'employee';
ALTER TABLE public.staff_invites ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.staff_invites ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id);
ALTER TABLE public.staff_invites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_staff_invites_email ON public.staff_invites(lower(email));
CREATE INDEX IF NOT EXISTS idx_staff_invites_company ON public.staff_invites(company_id);

-- Helper functions used by RLS and defaults
CREATE OR REPLACE FUNCTION public.get_my_company()
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.check_is_super_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'super_admin');
$$;

-- Auto-create a company for active admins who still have no company_id
DO $$
DECLARE r RECORD; new_cid UUID;
BEGIN
  FOR r IN SELECT user_id, COALESCE(full_name,email,'Khalid & Sons') AS nm FROM public.user_profiles WHERE role IN ('admin','super_admin') AND company_id IS NULL LOOP
    INSERT INTO public.companies(name, owner_id) VALUES ('Khalid & Sons Petroleum', r.user_id) RETURNING id INTO new_cid;
    UPDATE public.user_profiles SET company_id = new_cid, status = COALESCE(NULLIF(status,''),'active') WHERE user_id = r.user_id;
  END LOOP;
END $$;

-- Make new customer/transaction records auto-attach to logged-in user's company when possible
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['customers','transactions','cash_advances','tanks','stock_entries','banks','cash_deposits','company_transactions','company_repayments','member_card_usage','mobil_sales','mobil_arrivals','shops','rent_payments','settings','expense_categories'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl AND column_name='company_id') THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.get_my_company()', tbl);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'default company_id skipped for %: %', tbl, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- Staff invite RLS: allow admins/managers to invite within company and invited users to be found during signup
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_invites_select_v2 ON public.staff_invites;
DROP POLICY IF EXISTS staff_invites_insert_v2 ON public.staff_invites;
DROP POLICY IF EXISTS staff_invites_update_v2 ON public.staff_invites;
DROP POLICY IF EXISTS staff_invites_delete_v2 ON public.staff_invites;
CREATE POLICY staff_invites_select_v2 ON public.staff_invites FOR SELECT TO authenticated
USING (
  public.check_is_super_admin()
  OR company_id IS NULL
  OR company_id = public.get_my_company()
  OR lower(email) = lower(COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()),''))
);
CREATE POLICY staff_invites_insert_v2 ON public.staff_invites FOR INSERT TO authenticated
WITH CHECK (
  public.check_is_super_admin()
  OR company_id IS NULL
  OR company_id = public.get_my_company()
);
CREATE POLICY staff_invites_update_v2 ON public.staff_invites FOR UPDATE TO authenticated
USING (public.check_is_super_admin() OR company_id IS NULL OR company_id = public.get_my_company())
WITH CHECK (public.check_is_super_admin() OR company_id IS NULL OR company_id = public.get_my_company());
CREATE POLICY staff_invites_delete_v2 ON public.staff_invites FOR DELETE TO authenticated
USING (public.check_is_super_admin() OR company_id IS NULL OR company_id = public.get_my_company());

-- Customer/operations RLS: works with old NULL company records and new company records
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['customers','transactions','cash_advances','tanks','stock_entries','banks','cash_deposits'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_compat_all_v2', tbl);
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl AND column_name='company_id') THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.check_is_super_admin() OR company_id IS NULL OR company_id = public.get_my_company()) WITH CHECK (public.check_is_super_admin() OR company_id IS NULL OR company_id = public.get_my_company())', tbl || '_compat_all_v2', tbl);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl || '_compat_all_v2', tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Customers extra columns for registration UI
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Regular';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_company BOOLEAN DEFAULT FALSE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.customers ALTER COLUMN company_id SET DEFAULT public.get_my_company();

-- Tanks final compatibility. Fixes: column "name" does not exist.
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS name TEXT;
UPDATE public.tanks SET name = COALESCE(name, fuel_type || ' Tank') WHERE name IS NULL;

-- Trigger for invited staff signup. Safe to replace.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  target_company_id UUID;
  target_role TEXT;
  target_full_name TEXT;
  inv_id BIGINT;
BEGIN
  target_full_name := NEW.raw_user_meta_data->>'full_name';
  target_role      := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');

  SELECT id, company_id, role INTO inv_id, target_company_id, target_role
  FROM public.staff_invites
  WHERE lower(email) = lower(NEW.email)
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.user_profiles (user_id, email, full_name, role, status, company_id)
  VALUES (
    NEW.id,
    NEW.email,
    target_full_name,
    target_role,
    CASE WHEN target_role IN ('admin','super_admin') AND target_company_id IS NULL THEN 'active' ELSE 'active' END,
    target_company_id
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    role = COALESCE(EXCLUDED.role, public.user_profiles.role),
    company_id = COALESCE(EXCLUDED.company_id, public.user_profiles.company_id),
    status = COALESCE(NULLIF(public.user_profiles.status,''), EXCLUDED.status);

  IF target_role IN ('admin','super_admin') AND target_company_id IS NULL THEN
    INSERT INTO public.companies (name, owner_id)
    VALUES ('Khalid & Sons Petroleum', NEW.id)
    RETURNING id INTO target_company_id;
    UPDATE public.user_profiles SET company_id = target_company_id, status = 'active' WHERE user_id = NEW.id;
  END IF;

  IF inv_id IS NOT NULL THEN
    UPDATE public.staff_invites SET status='accepted' WHERE id = inv_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';

-- Done
SELECT 'PetroFlow final fix v3 completed successfully' AS status;

-- Force PostgREST/Supabase schema cache refresh
NOTIFY pgrst, 'reload schema';


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
