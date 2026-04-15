-- =============================================================
-- PetroFlow — Supabase Migration Script
-- Run this in Supabase Dashboard → SQL Editor
-- Covers:
--   1. user_profiles  (role-based auth)
--   2. banks          (multiple bank accounts)
--   3. cash_deposits  (daily cash deposit per bank)
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. USER PROFILES TABLE
--    Stores role, full_name, status for every auth user
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  full_name    TEXT,
  role         TEXT NOT NULL DEFAULT 'employee'
                CHECK (role IN ('super_admin','admin','manager','employee')),
  status       TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','rejected')),
  approved_by  UUID REFERENCES auth.users(id),
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_status  ON user_profiles(status);

-- Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read their own profile
CREATE POLICY "user_profiles_select_own"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Admins and super_admins can read all profiles
CREATE POLICY "user_profiles_select_admin"
  ON user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.role IN ('admin','super_admin')
        AND up.status = 'active'
    )
  );

-- Any authenticated user can insert their own profile (on signup)
CREATE POLICY "user_profiles_insert_own"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admins can update profiles (for approval/role changes)
CREATE POLICY "user_profiles_update_admin"
  ON user_profiles FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.role IN ('admin','super_admin')
        AND up.status = 'active'
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 2. BANKS TABLE
--    Stores bank accounts the pump deposits cash into
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banks (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  account_number TEXT,
  branch         TEXT,
  color          TEXT DEFAULT 'primary',
  is_active      BOOLEAN DEFAULT TRUE,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banks_active ON banks(is_active);

ALTER TABLE banks ENABLE ROW LEVEL SECURITY;

-- All active users can read banks
CREATE POLICY "banks_select_active_users"
  ON banks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid() AND up.status = 'active'
    )
  );

-- Only managers and above can insert/update/delete banks
CREATE POLICY "banks_write_managers"
  ON banks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.role IN ('manager','admin','super_admin')
        AND up.status = 'active'
    )
  );

-- Seed common Pakistani banks (optional — remove if you want to add manually)
INSERT INTO banks (name, color) VALUES
  ('HBL (Habib Bank)',          'primary'),
  ('MCB (Muslim Commercial)',   'danger'),
  ('UBL (United Bank)',         'success'),
  ('ABL (Allied Bank)',         'warning'),
  ('NBP (National Bank)',       'info')
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 3. CASH DEPOSITS TABLE
--    Daily cash deposits to specific banks
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_deposits (
  id           BIGSERIAL PRIMARY KEY,
  deposit_date DATE NOT NULL,
  bank_id      BIGINT NOT NULL REFERENCES banks(id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  deposited_by TEXT,
  reference    TEXT,          -- slip number, reference ID etc.
  note         TEXT,
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cash_deposits_date    ON cash_deposits(deposit_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_bank    ON cash_deposits(bank_id);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_created ON cash_deposits(created_at DESC);

ALTER TABLE cash_deposits ENABLE ROW LEVEL SECURITY;

-- All active users can view deposits
CREATE POLICY "cash_deposits_select"
  ON cash_deposits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid() AND up.status = 'active'
    )
  );

-- Managers and above can insert deposits
CREATE POLICY "cash_deposits_insert"
  ON cash_deposits FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.role IN ('manager','admin','super_admin')
        AND up.status = 'active'
    )
  );

-- Admins can update/delete deposits
CREATE POLICY "cash_deposits_modify_admin"
  ON cash_deposits FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.role IN ('admin','super_admin')
        AND up.status = 'active'
    )
  );

CREATE POLICY "cash_deposits_delete_admin"
  ON cash_deposits FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.role IN ('admin','super_admin')
        AND up.status = 'active'
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 4. HELPER VIEW — Daily deposit summary per bank
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_daily_bank_summary AS
SELECT
  cd.deposit_date,
  b.name          AS bank_name,
  b.color         AS bank_color,
  COUNT(*)        AS deposit_count,
  SUM(cd.amount)  AS total_amount
FROM cash_deposits cd
JOIN banks b ON b.id = cd.bank_id
GROUP BY cd.deposit_date, b.id, b.name, b.color
ORDER BY cd.deposit_date DESC, total_amount DESC;


-- ─────────────────────────────────────────────────────────────
-- 5. INITIAL SUPER ADMIN SETUP
--    After running this script, manually insert your super admin:
--
--    1. Create account via signup.html (choose any role — it gets overridden)
--    2. Then run this in SQL editor (replace the email):
--
-- UPDATE user_profiles
-- SET role = 'super_admin', status = 'active'
-- WHERE email = 'your-admin-email@example.com';
--
-- ─────────────────────────────────────────────────────────────

-- Confirmation
SELECT 'Migration complete. Tables created: user_profiles, banks, cash_deposits' AS result;
