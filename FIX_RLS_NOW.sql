-- ================================================================
-- PetroFlow — COMPLETE RLS FIX
-- Fixes: infinite recursion in user_profiles + all other tables
-- Run this ONCE in Supabase SQL Editor
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- PART 1: Fix user_profiles (the root cause of login failure)
-- ────────────────────────────────────────────────────────────────

-- Drop every existing policy on user_profiles
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'user_profiles' LOOP
    EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.user_profiles';
  END LOOP;
END $$;

-- Create a SECURITY DEFINER function to get current user's role
-- This runs as superuser so it bypasses RLS — no recursion possible
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Simple own-row policy (no sub-query, no recursion)
CREATE POLICY "up_own_all"
  ON public.user_profiles
  FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin can read/update ALL profiles (uses definer function — no recursion)
CREATE POLICY "up_admin_select"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (public.get_my_role() IN ('admin','super_admin'));

CREATE POLICY "up_admin_update"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING  (public.get_my_role() IN ('admin','super_admin'));


-- ────────────────────────────────────────────────────────────────
-- PART 2: Helper function to check if current user is active
-- Used by all other tables (also SECURITY DEFINER → no recursion)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_above()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND role IN ('manager','admin','super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_above()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND role IN ('admin','super_admin')
  );
$$;


-- ────────────────────────────────────────────────────────────────
-- PART 3: Fix ALL other tables using the helper functions
-- (These use public.is_active_user() — a definer func, no recursion)
-- ────────────────────────────────────────────────────────────────

-- Helper macro: drop all policies for a table
CREATE OR REPLACE FUNCTION public._drop_all_policies(tbl TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = tbl LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, tbl);
  END LOOP;
END $$;

-- settings
SELECT public._drop_all_policies('settings');
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_active" ON public.settings FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- tanks
SELECT public._drop_all_policies('tanks');
ALTER TABLE public.tanks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tanks_active" ON public.tanks FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- customers
SELECT public._drop_all_policies('customers');
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_active" ON public.customers FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- transactions
SELECT public._drop_all_policies('transactions');
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions_active" ON public.transactions FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- expense_categories
SELECT public._drop_all_policies('expense_categories');
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_cat_read" ON public.expense_categories FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY "expense_cat_write" ON public.expense_categories FOR ALL TO authenticated
  USING (public.is_admin_or_above()) WITH CHECK (public.is_admin_or_above());

-- banks
SELECT public._drop_all_policies('banks');
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "banks_read" ON public.banks FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY "banks_write" ON public.banks FOR ALL TO authenticated
  USING (public.is_manager_or_above()) WITH CHECK (public.is_manager_or_above());

-- cash_deposits
SELECT public._drop_all_policies('cash_deposits');
ALTER TABLE public.cash_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deposits_read" ON public.cash_deposits FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY "deposits_write" ON public.cash_deposits FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY "deposits_modify" ON public.cash_deposits FOR UPDATE TO authenticated
  USING (public.is_admin_or_above());
CREATE POLICY "deposits_delete" ON public.cash_deposits FOR DELETE TO authenticated
  USING (public.is_admin_or_above());

-- stock_purchases
SELECT public._drop_all_policies('stock_purchases');
ALTER TABLE public.stock_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_purch_active" ON public.stock_purchases FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- stock_entries
SELECT public._drop_all_policies('stock_entries');
ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_entries_active" ON public.stock_entries FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- shops
SELECT public._drop_all_policies('shops');
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shops_active" ON public.shops FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- rent_payments
SELECT public._drop_all_policies('rent_payments');
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rent_active" ON public.rent_payments FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- mobil_products
SELECT public._drop_all_policies('mobil_products');
ALTER TABLE public.mobil_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mobil_prod_active" ON public.mobil_products FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- mobil_product_prices
SELECT public._drop_all_policies('mobil_product_prices');
ALTER TABLE public.mobil_product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mobil_prices_active" ON public.mobil_product_prices FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- mobil_arrivals
SELECT public._drop_all_policies('mobil_arrivals');
ALTER TABLE public.mobil_arrivals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mobil_arr_active" ON public.mobil_arrivals FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- mobil_sales
SELECT public._drop_all_policies('mobil_sales');
ALTER TABLE public.mobil_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mobil_sales_active" ON public.mobil_sales FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- company_transactions
SELECT public._drop_all_policies('company_transactions');
ALTER TABLE public.company_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co_txn_active" ON public.company_transactions FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- member_card_usage
SELECT public._drop_all_policies('member_card_usage');
ALTER TABLE public.member_card_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcu_active" ON public.member_card_usage FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- company_repayments
SELECT public._drop_all_policies('company_repayments');
ALTER TABLE public.company_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co_repay_active" ON public.company_repayments FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- cash_advances
SELECT public._drop_all_policies('cash_advances');
ALTER TABLE public.cash_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "advances_active" ON public.cash_advances FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- Handle any other UNRESTRICTED tables visible in screenshot
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'daily_reports','expense_types','mobil_customers','mobil_stock',
    'mobil_transactions','price_history'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_active" ON public.%I', tbl, tbl);
      EXECUTE format(
        'CREATE POLICY "%s_active" ON public.%I FOR ALL TO authenticated
         USING (public.is_active_user()) WITH CHECK (public.is_active_user())',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- Clean up helper function (no longer needed)
DROP FUNCTION IF EXISTS public._drop_all_policies(TEXT);


-- ────────────────────────────────────────────────────────────────
-- PART 4: Verify — should show 5 policies for user_profiles
-- and all other tables should now have RLS enabled
-- ────────────────────────────────────────────────────────────────
SELECT
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
