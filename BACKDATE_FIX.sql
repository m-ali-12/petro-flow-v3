-- ================================================================
-- BACKDATE FIX — Allow inserting transactions with custom dates
-- ================================================================
-- PURPOSE: Jab system naya start hota hai to pichle mahine ka
--          record add karne ke liye created_at override karna
--          zaroori hai. Yeh script transactions table mein 
--          created_at column ko insert-friendly banata hai.
-- ================================================================
-- STEP 1: Make sure created_at allows being set on INSERT
-- (By default Supabase allows this, but confirm column is correct)

ALTER TABLE public.transactions 
  ALTER COLUMN created_at SET DEFAULT now();

-- STEP 2: Make sure RLS INSERT policy allows created_at override
-- (No special change needed — Supabase lets authenticated users
--  insert any value into created_at by default)

-- STEP 3: Add 'updated_at' column if missing (optional but good practice)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'transactions' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.transactions 
      ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();
  END IF;
END $$;

-- STEP 4: Verify transactions table columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'transactions'
ORDER BY ordinal_position;

DO $$
BEGIN
  RAISE NOTICE '✅ Backdate Fix Applied! Ab aap pichli tarikhon ke records insert kar saktey hain.';
END $$;
