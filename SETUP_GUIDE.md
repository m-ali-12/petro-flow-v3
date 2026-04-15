# PetroFlow — Fix Guide
## Three Issues Resolved

---

## ✅ Issue 1: Role-Based Authentication

### What was wrong
`auth.js` had authentication **fully disabled** (commented out). Anyone could access the system without logging in.

### What was fixed
| File | Change |
|------|--------|
| `js/auth.js` | **Completely rewritten** — active auth with 4 roles |
| `js/login.js` | Updated to check profile status before redirecting |
| `signup.html` | New signup — creates profile with `status: pending` |
| `admin-panel.html` | **New page** — approve/reject/manage all users |

### Role Hierarchy

```
super_admin  ← Can do everything + assign super_admin role + approve admins
    │
   admin  ← Can manage managers/employees, edit prices, view all reports
    │
  manager  ← Can enter transactions, view reports, manage cash deposits
    │
 employee  ← Basic data entry only (daily readings, transactions)
```

### How it works
1. User signs up → profile created with `status = 'pending'`
2. They see "Account Pending Approval" screen after login
3. Admin/Super Admin goes to **Admin Panel** → approves them and sets their role
4. User can now login normally

### First-time Setup (IMPORTANT)
After running `MIGRATION.sql`, you need one super admin to start:

```sql
-- Run in Supabase SQL Editor after creating your account via signup.html
UPDATE user_profiles
SET role = 'super_admin', status = 'active'
WHERE email = 'your-email@example.com';
```

---

## ✅ Issue 2: Date-Wise Entry (From April + Previous Months)

### What was wrong
Daily Readings page had no "All Time" or "Since April" filter option. Profit/Loss page also lacked these options.

### What was fixed
| File | Change |
|------|--------|
| `daily-readings.html` | Added **"April 2026 Se"** and **"Tamam Entries"** period options |
| `js/daily-readings.js` | Added `since_april` and `all_time` cases to `getRange()` |
| `profit-loss.html` | Same two new period options added + date range logic |

### New Filter Options
- **Aaj** — Today only
- **Is Hafte** — This week
- **Is Mahine** — Current month (default)
- **Pichle Mahine** — Last month
- **April 2026 Se** ← **NEW** — From April 1, 2026 to today
- **Is Saal** — Full year
- **Tamam Entries** ← **NEW** — From 2020-01-01 (all records)
- **Custom Range** — Pick any date range

---

## ✅ Issue 3: Cash Deposit in Bank (Multiple Banks, Daily)

### What was created
This feature **did not exist** in the project. Completely new module built from scratch.

| File | Description |
|------|-------------|
| `bank-deposits.html` | Full bank deposit management page |
| `js/bank-deposits.js` | Complete logic — CRUD, pagination, summary cards |
| `MIGRATION.sql` | Database tables: `banks` + `cash_deposits` |

### Features
- **Multiple banks** — Add HBL, MCB, UBL, ABL, NBP, or any custom bank
- **Daily deposits** — Record date, bank, amount, deposited-by, reference slip, notes
- **Bank-wise summary** — Visual progress bars showing each bank's share
- **Date filtering** — Filter deposits by date range and bank
- **Statistics** — Today's total, this month's total, deposit count, active banks
- **Permission-controlled** — Only managers and above can add deposits

### Pre-seeded Banks
The migration automatically adds 5 common Pakistani banks:
- HBL (Habib Bank)
- MCB (Muslim Commercial)
- UBL (United Bank)
- ABL (Allied Bank)
- NBP (National Bank)

You can add/edit/delete banks from the Bank Deposits page.

---

## 🚀 Deployment Steps

### Step 1 — Run Supabase Migration
1. Go to Supabase Dashboard → SQL Editor
2. Open `MIGRATION.sql`
3. Click **Run**

### Step 2 — Promote Your Super Admin
```sql
UPDATE user_profiles
SET role = 'super_admin', status = 'active'
WHERE email = 'YOUR_EMAIL_HERE';
```

### Step 3 — Deploy to Vercel
```bash
# If using Vercel CLI
vercel --prod

# Or connect GitHub repo in Vercel dashboard and it auto-deploys
```

### Step 4 — Create Other Users
1. Go to `signup.html`
2. Each user registers and selects their role
3. You (super admin) go to **Admin Panel** and approve them

---

## 🔐 Permission Reference

| Feature | Employee | Manager | Admin | Super Admin |
|---------|----------|---------|-------|-------------|
| View Dashboard | ✅ | ✅ | ✅ | ✅ |
| Daily Readings | ✅ | ✅ | ✅ | ✅ |
| Transactions Entry | ✅ | ✅ | ✅ | ✅ |
| View Customers | ✅ | ✅ | ✅ | ✅ |
| Cash Deposits (Bank) | ❌ | ✅ | ✅ | ✅ |
| View Reports | ❌ | ✅ | ✅ | ✅ |
| Edit Fuel Prices | ❌ | ❌ | ✅ | ✅ |
| Manage Settings | ❌ | ❌ | ✅ | ✅ |
| Approve Users | ❌ | ❌ | ✅ | ✅ |
| Assign Super Admin Role | ❌ | ❌ | ❌ | ✅ |
| Delete Transactions | ❌ | ❌ | ❌ | ✅ |

---

## 📋 New Pages Summary

| Page | URL | Access |
|------|-----|--------|
| Login | `login.html` | Public |
| Sign Up | `signup.html` | Public |
| **Admin Panel** | `admin-panel.html` | Admin + Super Admin |
| **Bank Deposits** | `bank-deposits.html` | Manager and above |

---

## 🗄️ New Database Tables

```sql
user_profiles     -- Role, status, approval for each user
banks             -- Bank accounts (HBL, MCB, etc.)
cash_deposits     -- Daily cash deposits per bank
v_daily_bank_summary  -- View: daily totals per bank
```
