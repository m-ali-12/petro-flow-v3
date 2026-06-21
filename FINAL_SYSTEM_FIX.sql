-- ================================================================
-- PetroFlow — FINAL COMPANY ACCOUNT & MULTI-TENANCY FIX (v2)
-- 1. Fix Company Account (Sr# 10)
-- 2. Ensure tenant columns (company_id UUID)
-- 3. Fix RLS policies for STRICT isolation
-- 4. Update reporting views (Fixing b2b_company_id join)
-- ================================================================

BEGIN;

-- 1. Fix Company Account (Sr# 10)
UPDATE public.customers 
SET category = 'Company', 
    is_company = true,
    account_type = 'company'
WHERE sr_no = 10;

-- 2. Ensure tenant columns (UUID) exist
-- Note: DATABASE_SETUP.sql renames BIGINT company_id -> b2b_company_id
-- and adds new UUID company_id for isolation.
DO $$
BEGIN
  -- company_transactions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='company_transactions' AND column_name='company_id' AND data_type='bigint') THEN
    ALTER TABLE public.company_transactions RENAME COLUMN company_id TO b2b_company_id;
  END IF;
  ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();

  -- company_repayments
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='company_repayments' AND column_name='company_id' AND data_type='bigint') THEN
    ALTER TABLE public.company_repayments RENAME COLUMN company_id TO b2b_company_id;
  END IF;
  ALTER TABLE public.company_repayments ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();

  -- member_card_usage
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='member_card_usage' AND column_name='company_id' AND data_type='bigint') THEN
    ALTER TABLE public.member_card_usage RENAME COLUMN company_id TO b2b_company_id;
  END IF;
  ALTER TABLE public.member_card_usage ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();

  -- cash_advances
  ALTER TABLE public.cash_advances ADD COLUMN IF NOT EXISTS company_id UUID DEFAULT public.get_my_company();
END $$;

-- 3. Populate missing tenant IDs from user_profiles
UPDATE public.company_transactions t SET company_id = p.company_id 
FROM public.user_profiles p WHERE t.user_id = p.user_id AND t.company_id IS NULL;

UPDATE public.company_repayments t SET company_id = p.company_id 
FROM public.user_profiles p WHERE t.user_id = p.user_id AND t.company_id IS NULL;

UPDATE public.member_card_usage t SET company_id = p.company_id 
FROM public.user_profiles p WHERE t.user_id = p.user_id AND t.company_id IS NULL;

UPDATE public.cash_advances t SET company_id = p.company_id 
FROM public.user_profiles p WHERE t.user_id = p.user_id AND t.company_id IS NULL;

-- 4. Fix RLS Policies for STRICT Isolation
CREATE OR REPLACE FUNCTION public._apply_strict_isolation(tbl TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS isolation_policy ON public.%I', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "%s_active" ON public.%I', tbl, tbl);
  EXECUTE format('DROP POLICY IF EXISTS "co_txn_all_active" ON public.%I', tbl);
  
  EXECUTE format('CREATE POLICY isolation_policy ON public.%I FOR ALL TO authenticated USING (
    (SELECT role FROM public.user_profiles WHERE user_id = auth.uid()) = ''super_admin''
    OR company_id = (SELECT company_id FROM public.user_profiles WHERE user_id = auth.uid())
  )', tbl);
END $$;

SELECT public._apply_strict_isolation('customers');
SELECT public._apply_strict_isolation('transactions');
SELECT public._apply_strict_isolation('tanks');
SELECT public._apply_strict_isolation('banks');
SELECT public._apply_strict_isolation('stock_entries');
SELECT public._apply_strict_isolation('stock_purchases');
SELECT public._apply_strict_isolation('company_transactions');
SELECT public._apply_strict_isolation('company_repayments');
SELECT public._apply_strict_isolation('member_card_usage');
SELECT public._apply_strict_isolation('cash_advances');

-- 5. Update Reporting Views (Fixing the Join)
DROP VIEW IF EXISTS public.v_company_account_summary CASCADE;
CREATE OR REPLACE VIEW public.v_company_account_summary AS
SELECT 
  c.id, c.name, c.sr_no, c.company_id AS tenant_id,
  COALESCE(SUM(ct.amount), 0) AS total_amount,
  COALESCE(SUM(cr.amount), 0) AS total_repayments,
  COALESCE(SUM(ct.amount), 0) - COALESCE(SUM(cr.amount), 0) AS balance
FROM public.customers c
LEFT JOIN public.company_transactions ct ON ct.b2b_company_id = c.id
LEFT JOIN public.company_repayments cr ON cr.b2b_company_id = c.id
WHERE c.is_company = true
GROUP BY c.id, c.name, c.sr_no, c.company_id;

COMMIT;
