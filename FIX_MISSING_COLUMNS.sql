-- ================================================================
-- MISSING COLUMNS FIX — Daily Readings Error Fix
-- ================================================================
-- Error: "column transactions.liters does not exist"
-- Yeh columns transactions table mein missing the.
-- DATABASE_SETUP.sql mein yeh add nahi the.
-- ================================================================

DO $$
BEGIN
  -- liters column (daily readings mein total liters bika)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='transactions' AND column_name='liters') THEN
    ALTER TABLE public.transactions ADD COLUMN liters NUMERIC(14,3);
    RAISE NOTICE 'Added: liters';
  END IF;

  -- unit_price column (rate per liter)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='transactions' AND column_name='unit_price') THEN
    ALTER TABLE public.transactions ADD COLUMN unit_price NUMERIC(14,2);
    RAISE NOTICE 'Added: unit_price';
  END IF;

  -- charges column (yeh amount ka alias tha purane code mein)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='transactions' AND column_name='charges') THEN
    ALTER TABLE public.transactions ADD COLUMN charges NUMERIC(14,2) DEFAULT 0;
    RAISE NOTICE 'Added: charges';
  END IF;

  -- entry_method column (machine_reading vs manual)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='transactions' AND column_name='entry_method') THEN
    ALTER TABLE public.transactions ADD COLUMN entry_method TEXT;
    RAISE NOTICE 'Added: entry_method';
  END IF;

  -- payment_method column (Cash / Bank / etc)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='transactions' AND column_name='payment_method') THEN
    ALTER TABLE public.transactions ADD COLUMN payment_method TEXT;
    RAISE NOTICE 'Added: payment_method';
  END IF;

  -- cash_advance_id column (for cash advance linkage)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='transactions' AND column_name='cash_advance_id') THEN
    ALTER TABLE public.transactions ADD COLUMN cash_advance_id BIGINT;
    RAISE NOTICE 'Added: cash_advance_id';
  END IF;

END $$;

-- Verify all columns now exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'transactions'
ORDER BY ordinal_position;

DO $$
BEGIN
  RAISE NOTICE '✅ All missing columns added! Daily Readings error fix ho gaya.';
END $$;
