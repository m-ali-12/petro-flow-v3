-- =============================================================
-- PETROFLOW DIR EXPENSE KHATA DB - IMPROVED SAFE
-- Purpose: ensure Dir Expense / Owner Expense ledger table exists.
-- Safety: This file does NOT delete existing customers, transactions,
-- banks, stock, salary, or direct expense data.
-- Note: The improved frontend stores clear UI options using existing safe
-- DB entry_type values:
--   Credit / Cash Given        -> cash_given
--   Vasooli / Payment Received -> cash_received
--   Owner Advance Received     -> cash_received + expense_category marker
--   Return Owner Advance       -> cash_given + expense_category marker
-- This avoids changing DB check constraints again.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.direct_expense_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type TEXT NOT NULL CHECK (
    entry_type IN (
      'cash_given',
      'cash_received',
      'bank_transfer_to_owner',
      'bank_transfer_from_owner',
      'expense_settled'
    )
  ),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_mode TEXT DEFAULT 'cash',
  bank_id BIGINT REFERENCES public.banks(id),
  to_bank_id BIGINT REFERENCES public.banks(id),
  expense_category TEXT,
  reference_no TEXT,
  note TEXT,
  cash_deposit_id BIGINT,
  transaction_id BIGINT,
  created_by UUID REFERENCES auth.users(id),
  company_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.cash_deposits
  ADD COLUMN IF NOT EXISTS direct_expense_id BIGINT;

ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS direct_expense_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_direct_expense_entries_date ON public.direct_expense_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_direct_expense_entries_type ON public.direct_expense_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_direct_expense_entries_bank ON public.direct_expense_entries(bank_id);
CREATE INDEX IF NOT EXISTS idx_direct_expense_entries_to_bank ON public.direct_expense_entries(to_bank_id);
CREATE INDEX IF NOT EXISTS idx_direct_expense_entries_company ON public.direct_expense_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_direct_expense_entries_category ON public.direct_expense_entries(expense_category);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_direct_expense ON public.cash_deposits(direct_expense_id);
CREATE INDEX IF NOT EXISTS idx_transactions_direct_expense ON public.transactions(direct_expense_id);

ALTER TABLE public.direct_expense_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'direct_expense_entries'
      AND policyname = 'direct_expense_entries_all_authenticated'
  ) THEN
    CREATE POLICY direct_expense_entries_all_authenticated
      ON public.direct_expense_entries
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.direct_expense_entries IS 'Dir Expense / Owner Expense ledger: credit/cash given, vasooli, owner advance, advance return, bank transfers, and expense settlements.';
COMMENT ON COLUMN public.direct_expense_entries.entry_type IS 'DB values: cash_given, cash_received, bank_transfer_to_owner, bank_transfer_from_owner, expense_settled. UI maps advance options using expense_category markers.';
COMMENT ON COLUMN public.direct_expense_entries.expense_category IS 'For expense_settled this is the expense category. For advance options frontend stores Owner Advance Received or Owner Advance Return markers.';

SELECT
  'dir_expense_improved_db_ready' AS status,
  COUNT(*) AS existing_dir_expense_rows
FROM public.direct_expense_entries;
