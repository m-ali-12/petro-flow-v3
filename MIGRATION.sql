-- =============================================================
-- PetroFlow — COMPLETE DATABASE MIGRATION v2
-- New Supabase project: petro v2
-- Run ALL of this in Supabase SQL Editor in ONE go
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- STEP 0: Extensions
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- TABLE 1: USER PROFILES (Auth + Roles)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  full_name    TEXT,
  role         TEXT NOT NULL DEFAULT 'employee'
                 CHECK (role IN ('super_admin','admin','manager','employee')),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','active','rejected')),
  approved_by  UUID REFERENCES auth.users(id),
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_status  ON public.user_profiles(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email   ON public.user_profiles(email);

-- RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- DROP old policies if re-running
DROP POLICY IF EXISTS "profiles_select_own"          ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_select_admin"        ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_insert_own"          ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_select_own"     ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_select_admin"   ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert_own"     ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_admin"   ON public.user_profiles;

-- ✅ SELECT: user can always read their OWN row (needed right after login)
CREATE POLICY "profiles_select_own"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- ✅ SELECT: admin/super_admin can read ALL rows
CREATE POLICY "profiles_select_admin"
  ON public.user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin','super_admin')
        AND p.status = 'active'
    )
  );

-- ✅ INSERT: any authenticated user can create their own profile (on signup)
CREATE POLICY "profiles_insert_own"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ✅ UPDATE: admin/super_admin can update any profile (for approval)
--           also user can update their own non-sensitive fields
CREATE POLICY "profiles_update_own_or_admin"
  ON public.user_profiles FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin','super_admin')
        AND p.status = 'active'
    )
  );


-- =============================================================
-- TABLE 2: SETTINGS (Fuel prices, pump info)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id),
  pump_name       TEXT DEFAULT 'Khalid & Sons Petroleum',
  pump_address    TEXT,
  pump_phone      TEXT,
  petrol_price    NUMERIC(10,2) DEFAULT 276.50,
  diesel_price    NUMERIC(10,2) DEFAULT 289.75,
  price_history   JSONB DEFAULT '[]'::JSONB,
  mobil_history   JSONB DEFAULT '[]'::JSONB,
  car_mobil_price NUMERIC(10,2) DEFAULT 0,
  open_mobil_price NUMERIC(10,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_all_active" ON public.settings;
CREATE POLICY "settings_all_active"
  ON public.settings FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
  );

-- Insert default settings row
INSERT INTO public.settings (pump_name, petrol_price, diesel_price, price_history)
VALUES (
  'Khalid & Sons Petroleum',
  276.50,
  289.75,
  '[{"date":"2026-04-01","petrol":276.50,"diesel":289.75,"updated_by":"System"}]'::JSONB
) ON CONFLICT DO NOTHING;


-- =============================================================
-- TABLE 3: TANKS (Petrol / Diesel / Mobil storage)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.tanks (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id),
  name          TEXT NOT NULL,
  fuel_type     TEXT NOT NULL CHECK (fuel_type IN ('Petrol','Diesel','Car Mobil','Open Mobil')),
  capacity      NUMERIC(14,2) DEFAULT 25000,
  current_stock NUMERIC(14,2) DEFAULT 0,
  last_updated  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tanks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tanks_all_active" ON public.tanks;
CREATE POLICY "tanks_all_active"
  ON public.tanks FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
  );

-- Default tanks
INSERT INTO public.tanks (name, fuel_type, capacity, current_stock) VALUES
  ('Petrol Tank 1',  'Petrol',     25000, 0),
  ('Diesel Tank 1',  'Diesel',     25000, 0),
  ('Car Mobil Tank', 'Car Mobil',   1000, 0),
  ('Open Mobil Tank','Open Mobil',  1000, 0)
ON CONFLICT DO NOTHING;


-- =============================================================
-- TABLE 4: CUSTOMERS (Udhaar / Credit customers)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id),
  sr_no      INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL,
  phone      TEXT,
  category   TEXT DEFAULT 'Regular',
  balance    NUMERIC(14,2) DEFAULT 0,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_user_id ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_sr_no   ON public.customers(sr_no);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_all_active" ON public.customers;
CREATE POLICY "customers_all_active"
  ON public.customers FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
  );

-- Default owner customer (sr_no=0)
INSERT INTO public.customers (sr_no, name, category, balance)
VALUES (0, 'Owner / Cash', 'Owner', 0)
ON CONFLICT DO NOTHING;


-- =============================================================
-- TABLE 5: TRANSACTIONS (All sales, credits, expenses, vasooli)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id),
  customer_id      BIGINT REFERENCES public.customers(id),
  tank_id          BIGINT REFERENCES public.tanks(id),
  transaction_type TEXT NOT NULL,
  -- CashSale | Credit | Debit | Expense | Vasooli | CashAdvance | MobilSale | StockIn
  fuel_type        TEXT,
  liters           NUMERIC(12,3),
  unit_price       NUMERIC(10,2),
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  charges          NUMERIC(14,2) DEFAULT 0,
  payment_mode     TEXT DEFAULT 'Cash',
  entry_method     TEXT DEFAULT 'manual',
  -- manual | machine_reading | import
  description      TEXT,
  notes            TEXT,
  reference_no     TEXT,
  month            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id         ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id     ON public.transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type            ON public.transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at      ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_fuel_type       ON public.transactions(fuel_type);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions_all_active" ON public.transactions;
CREATE POLICY "transactions_all_active"
  ON public.transactions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
  );


-- =============================================================
-- TABLE 6: EXPENSE CATEGORIES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  icon       TEXT DEFAULT '💸',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_cat_select_active" ON public.expense_categories;
CREATE POLICY "expense_cat_select_active"
  ON public.expense_categories FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
  );

DROP POLICY IF EXISTS "expense_cat_write_admin" ON public.expense_categories;
CREATE POLICY "expense_cat_write_admin"
  ON public.expense_categories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin','super_admin')
        AND p.status = 'active'
    )
  );

-- Seed expense categories
INSERT INTO public.expense_categories (name, icon) VALUES
  ('Salary',            '👷'),
  ('Electricity Bill',  '⚡'),
  ('Water Bill',        '💧'),
  ('Fuel for Generator','⛽'),
  ('Maintenance',       '🔧'),
  ('Bank Charges',      '🏦'),
  ('Mobile/Internet',   '📱'),
  ('Office Supplies',   '📋'),
  ('Transport',         '🚛'),
  ('Security',          '🔒'),
  ('Rent',              '🏠'),
  ('Miscellaneous',     '📌'),
  ('Oil Filter',        '🛢️'),
  ('Water Service',     '🚿'),
  ('Commission',        '💰')
ON CONFLICT (name) DO NOTHING;


-- =============================================================
-- TABLE 7: BANKS (Multiple bank accounts)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.banks (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  account_number TEXT,
  branch         TEXT,
  color          TEXT DEFAULT 'primary',
  is_active      BOOLEAN DEFAULT TRUE,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "banks_select_active"  ON public.banks;
DROP POLICY IF EXISTS "banks_write_managers" ON public.banks;
CREATE POLICY "banks_select_active"
  ON public.banks FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
  );
CREATE POLICY "banks_write_managers"
  ON public.banks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('manager','admin','super_admin')
        AND p.status = 'active'
    )
  );

-- Seed common Pakistani banks
INSERT INTO public.banks (name, color) VALUES
  ('HBL (Habib Bank)',          'primary'),
  ('MCB (Muslim Commercial)',   'danger'),
  ('UBL (United Bank)',         'success'),
  ('ABL (Allied Bank)',         'warning'),
  ('NBP (National Bank)',       'info'),
  ('Meezan Bank',               'success'),
  ('Bank Alfalah',              'primary'),
  ('Faysal Bank',               'warning')
ON CONFLICT DO NOTHING;


-- =============================================================
-- TABLE 8: CASH DEPOSITS (Daily bank deposits)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.cash_deposits (
  id           BIGSERIAL PRIMARY KEY,
  deposit_date DATE NOT NULL,
  bank_id      BIGINT NOT NULL REFERENCES public.banks(id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  deposited_by TEXT,
  reference    TEXT,
  note         TEXT,
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_deposits_date    ON public.cash_deposits(deposit_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_bank    ON public.cash_deposits(bank_id);

ALTER TABLE public.cash_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deposits_select_active"      ON public.cash_deposits;
DROP POLICY IF EXISTS "deposits_insert_managers"    ON public.cash_deposits;
DROP POLICY IF EXISTS "deposits_modify_admin"       ON public.cash_deposits;
DROP POLICY IF EXISTS "deposits_delete_admin"       ON public.cash_deposits;
CREATE POLICY "deposits_select_active"
  ON public.cash_deposits FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));
CREATE POLICY "deposits_insert_managers"
  ON public.cash_deposits FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid() AND p.role IN ('manager','admin','super_admin') AND p.status = 'active'
  ));
CREATE POLICY "deposits_modify_admin"
  ON public.cash_deposits FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid() AND p.role IN ('admin','super_admin') AND p.status = 'active'
  ));
CREATE POLICY "deposits_delete_admin"
  ON public.cash_deposits FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid() AND p.role IN ('admin','super_admin') AND p.status = 'active'
  ));


-- =============================================================
-- TABLE 9: STOCK PURCHASES (Fuel tanker arrivals)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.stock_purchases (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id),
  tank_id       BIGINT REFERENCES public.tanks(id),
  fuel_type     TEXT NOT NULL,
  liters        NUMERIC(12,3) NOT NULL,
  unit_price    NUMERIC(10,2),
  charges       NUMERIC(14,2) DEFAULT 0,
  total_amount  NUMERIC(14,2),
  invoice_no    TEXT,
  truck_no      TEXT,
  supplier      TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.stock_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_purchases_all_active" ON public.stock_purchases;
CREATE POLICY "stock_purchases_all_active"
  ON public.stock_purchases FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 10: STOCK ENTRIES (Manual stock adjustments)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.stock_entries (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id),
  tank_id     BIGINT REFERENCES public.tanks(id),
  fuel_type   TEXT,
  entry_type  TEXT DEFAULT 'purchase',
  liters      NUMERIC(12,3),
  unit_price  NUMERIC(10,2),
  charges     NUMERIC(14,2) DEFAULT 0,
  total_cost  NUMERIC(14,2),
  invoice_no  TEXT,
  truck_no    TEXT,
  entry_date  DATE DEFAULT CURRENT_DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_entries_all_active" ON public.stock_entries;
CREATE POLICY "stock_entries_all_active"
  ON public.stock_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 11: SHOPS (Rent management)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.shops (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id),
  shop_name     TEXT NOT NULL,
  tenant_name   TEXT,
  phone         TEXT,
  monthly_rent  NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_day       INTEGER DEFAULT 1,
  start_date    DATE,
  notes         TEXT,
  status        TEXT DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shops_all_active" ON public.shops;
CREATE POLICY "shops_all_active"
  ON public.shops FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 12: RENT PAYMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.rent_payments (
  id           BIGSERIAL PRIMARY KEY,
  shop_id      BIGINT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  rent_month   INTEGER NOT NULL CHECK (rent_month BETWEEN 1 AND 12),
  rent_year    INTEGER NOT NULL,
  amount_due   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid  NUMERIC(12,2),
  due_date     DATE,
  paid_date    DATE,
  status       TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Paid','Partial','Waived')),
  payment_mode TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, rent_month, rent_year)
);

ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rent_payments_all_active" ON public.rent_payments;
CREATE POLICY "rent_payments_all_active"
  ON public.rent_payments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 13: MOBIL PRODUCTS (Oil products inventory)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.mobil_products (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  grade       TEXT,
  volume_ml   INTEGER,
  category    TEXT DEFAULT 'Car Mobil',
  current_stock INTEGER DEFAULT 0,
  sale_price  NUMERIC(10,2) DEFAULT 0,
  cost_price  NUMERIC(10,2) DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mobil_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobil_products_all_active" ON public.mobil_products;
CREATE POLICY "mobil_products_all_active"
  ON public.mobil_products FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 14: MOBIL PRODUCT PRICES (Price history)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.mobil_product_prices (
  id             BIGSERIAL PRIMARY KEY,
  product_id     BIGINT NOT NULL REFERENCES public.mobil_products(id) ON DELETE CASCADE,
  sale_price     NUMERIC(10,2) NOT NULL,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mobil_product_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobil_prices_all_active" ON public.mobil_product_prices;
CREATE POLICY "mobil_prices_all_active"
  ON public.mobil_product_prices FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 15: MOBIL ARRIVALS (Stock in for mobil products)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.mobil_arrivals (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id),
  product_id   BIGINT REFERENCES public.mobil_products(id),
  product_name TEXT,
  category     TEXT,
  supplier     TEXT,
  quantity     INTEGER NOT NULL,
  rate         NUMERIC(10,2),
  total_cost   NUMERIC(14,2),
  arrival_date DATE DEFAULT CURRENT_DATE,
  invoice_no   TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mobil_arrivals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobil_arrivals_all_active" ON public.mobil_arrivals;
CREATE POLICY "mobil_arrivals_all_active"
  ON public.mobil_arrivals FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 16: MOBIL SALES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.mobil_sales (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id),
  customer_id   BIGINT REFERENCES public.customers(id),
  customer_name TEXT,
  product_id    BIGINT REFERENCES public.mobil_products(id),
  product_name  TEXT,
  category      TEXT,
  quantity      INTEGER NOT NULL,
  rate          NUMERIC(10,2),
  total_amount  NUMERIC(14,2),
  payment_type  TEXT DEFAULT 'Cash',
  sale_date     DATE DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mobil_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobil_sales_all_active" ON public.mobil_sales;
CREATE POLICY "mobil_sales_all_active"
  ON public.mobil_sales FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 17: COMPANY ACCOUNTS (B2B / Corporate customers)
-- =============================================================
-- customers table already created above — adding extra columns below

-- Add company fields to customers if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='credit_limit') THEN
    ALTER TABLE public.customers ADD COLUMN credit_limit NUMERIC(14,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='company_name') THEN
    ALTER TABLE public.customers ADD COLUMN company_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='is_company') THEN
    ALTER TABLE public.customers ADD COLUMN is_company BOOLEAN DEFAULT FALSE;
  END IF;
END $$;


-- =============================================================
-- TABLE 18: COMPANY TRANSACTIONS (for company-account.html)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.company_transactions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id),
  company_id   BIGINT REFERENCES public.customers(id),
  member_id    BIGINT REFERENCES public.customers(id),
  txn_type     TEXT NOT NULL,
  -- stock_purchase | member_usage | repayment | atm_charge | expense
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  charges      NUMERIC(14,2) DEFAULT 0,
  fuel_type    TEXT,
  liters       NUMERIC(12,3),
  unit_price   NUMERIC(10,2),
  payment_mode TEXT,
  reference_no TEXT,
  txn_date     DATE DEFAULT CURRENT_DATE,
  description  TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_txn_company ON public.company_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_company_txn_date    ON public.company_transactions(txn_date DESC);

ALTER TABLE public.company_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "co_txn_all_active" ON public.company_transactions;
CREATE POLICY "co_txn_all_active"
  ON public.company_transactions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 19: MEMBER CARD USAGE
-- =============================================================
CREATE TABLE IF NOT EXISTS public.member_card_usage (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id),
  company_id      BIGINT REFERENCES public.customers(id),
  member_id       BIGINT REFERENCES public.customers(id),
  company_txn_id  BIGINT REFERENCES public.company_transactions(id),
  fuel_type       TEXT,
  liters          NUMERIC(12,3),
  unit_price      NUMERIC(10,2),
  stock_value     NUMERIC(14,2),
  total_charges   NUMERIC(14,2) DEFAULT 0,
  usage_date      DATE DEFAULT CURRENT_DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.member_card_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "member_card_all_active" ON public.member_card_usage;
CREATE POLICY "member_card_all_active"
  ON public.member_card_usage FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 20: COMPANY REPAYMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.company_repayments (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id),
  company_id      BIGINT REFERENCES public.customers(id),
  company_txn_id  BIGINT REFERENCES public.company_transactions(id),
  amount          NUMERIC(14,2) NOT NULL,
  payment_mode    TEXT DEFAULT 'Cash',
  reference_no    TEXT,
  payment_date    DATE DEFAULT CURRENT_DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.company_repayments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "co_repay_all_active" ON public.company_repayments;
CREATE POLICY "co_repay_all_active"
  ON public.company_repayments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- TABLE 21: CASH ADVANCES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.cash_advances (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id),
  customer_id  BIGINT REFERENCES public.customers(id),
  amount       NUMERIC(14,2) NOT NULL,
  description  TEXT,
  advance_date DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.cash_advances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "advances_all_active" ON public.cash_advances;
CREATE POLICY "advances_all_active"
  ON public.cash_advances FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.status = 'active'));


-- =============================================================
-- VIEWS
-- =============================================================

-- Daily bank deposit summary
CREATE OR REPLACE VIEW public.v_daily_bank_summary AS
SELECT
  cd.deposit_date,
  b.name         AS bank_name,
  b.color        AS bank_color,
  COUNT(*)       AS deposit_count,
  SUM(cd.amount) AS total_amount
FROM public.cash_deposits cd
JOIN public.banks b ON b.id = cd.bank_id
GROUP BY cd.deposit_date, b.id, b.name, b.color
ORDER BY cd.deposit_date DESC, total_amount DESC;

-- Stock balance by fuel type
CREATE OR REPLACE VIEW public.v_stock_by_fuel AS
SELECT fuel_type, SUM(current_stock) AS total_stock, SUM(capacity) AS total_capacity
FROM public.tanks
GROUP BY fuel_type;

-- Mobil products with current stock
CREATE OR REPLACE VIEW public.v_mobil_products_current AS
SELECT
  mp.*,
  COALESCE(mpp.sale_price, mp.sale_price) AS current_sale_price
FROM public.mobil_products mp
LEFT JOIN LATERAL (
  SELECT sale_price FROM public.mobil_product_prices
  WHERE product_id = mp.id
  ORDER BY effective_date DESC LIMIT 1
) mpp ON TRUE
WHERE mp.is_active = TRUE;

-- Mobil stock balance
CREATE OR REPLACE VIEW public.v_mobil_stock_balance AS
SELECT
  mp.id, mp.name, mp.grade, mp.category, mp.volume_ml,
  COALESCE(SUM(CASE WHEN ma.id IS NOT NULL THEN ma.quantity ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN ms.id IS NOT NULL THEN ms.quantity ELSE 0 END), 0) AS stock_balance
FROM public.mobil_products mp
LEFT JOIN public.mobil_arrivals ma ON ma.product_id = mp.id
LEFT JOIN public.mobil_sales    ms ON ms.product_id = mp.id
GROUP BY mp.id, mp.name, mp.grade, mp.category, mp.volume_ml;

-- Company account summary
CREATE OR REPLACE VIEW public.v_company_account_summary AS
SELECT
  c.id, c.name, c.sr_no, c.credit_limit, c.balance,
  COALESCE(SUM(CASE WHEN ct.direction='out' AND ct.txn_type='stock_purchase' THEN ct.amount ELSE 0 END),0) AS total_stock_purchased,
  COALESCE(SUM(CASE WHEN ct.direction='out' THEN ct.charges ELSE 0 END),0) AS total_charges,
  COALESCE(SUM(CASE WHEN ct.direction='in'  THEN ct.amount ELSE 0 END),0) AS total_repaid
FROM public.customers c
LEFT JOIN public.company_transactions ct ON ct.company_id = c.id
WHERE c.is_company = TRUE
GROUP BY c.id, c.name, c.sr_no, c.credit_limit, c.balance;

-- Expense ledger
CREATE OR REPLACE VIEW public.v_expense_ledger AS
SELECT
  t.id, t.created_at, t.amount, t.description, t.notes,
  t.transaction_type, t.fuel_type, t.user_id,
  c.name AS customer_name
FROM public.transactions t
LEFT JOIN public.customers c ON c.id = t.customer_id
WHERE t.transaction_type IN ('Expense','CashAdvance','Vasooli','Debit');

-- Member usage summary
CREATE OR REPLACE VIEW public.v_member_usage_summary AS
SELECT
  m.id AS member_id, m.name AS member_name,
  co.name AS company_name,
  COUNT(mcu.id) AS usage_count,
  COALESCE(SUM(mcu.liters),0) AS total_liters,
  COALESCE(SUM(mcu.stock_value),0) AS total_value,
  COALESCE(SUM(mcu.total_charges),0) AS total_charges
FROM public.customers m
JOIN public.member_card_usage mcu ON mcu.member_id = m.id
JOIN public.customers co ON co.id = mcu.company_id
GROUP BY m.id, m.name, co.name;


-- =============================================================
-- SUPER ADMIN SETUP
-- After running this script:
-- 1. Sign up at signup.html with your email
-- 2. Run this query (replace email):
--
-- UPDATE public.user_profiles
-- SET role = 'super_admin', status = 'active'
-- WHERE email = 'your-email@example.com';
--
-- =============================================================

SELECT
  'Migration complete! Tables: ' ||
  string_agg(table_name, ', ' ORDER BY table_name) AS result
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'user_profiles','settings','tanks','customers','transactions',
    'expense_categories','banks','cash_deposits','stock_purchases',
    'stock_entries','shops','rent_payments','mobil_products',
    'mobil_product_prices','mobil_arrivals','mobil_sales',
    'company_transactions','member_card_usage','company_repayments','cash_advances'
  );
