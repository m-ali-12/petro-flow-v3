# 🚀 PetroFlow — Final Setup & Fix Guide

This guide contains everything you need to run the fixed and upgraded PetroFlow system.

## 🏁 Post-Deployment (Vercel/Live) — CRITICAL

If you have deployed your app to Vercel (e.g., `https://your-app.vercel.app`), you **MUST** update your Supabase settings, otherwise email confirmation links will take you to `localhost:3000` (Error: This site can't be reached).

### 🚀 Update Supabase Authentication URL

1.  Open your [Supabase Dashboard](https://supabase.com/dashboard).
2.  Go to **Authentication** (Sidebar) → **URL Configuration**.
3.  **Site URL**: Change `http://localhost:3000` to your **LIVE LINK** (e.g., `https://petro-flow-v3.vercel.app/`).
4.  **Redirect URLs**: Add your live link followed by `/**` (e.g., `https://petro-flow-v3.vercel.app/**`).
5.  Click **Save**.

---

## 🔗 Role-Based Direct Links
Use these links to access the specific dashboard for each role:

| Role          | Direct Link | Purpose |
|---------------|-------------|---------|
| **Super Admin** | `/admin` | System Settings, User Approvals, Profits |
| **Admin**       | `/admin` | General Management & Pricing |
| **Manager**     | `/manager` | Daily Khata, Customers, Reports |
| **Employee**    | `/employee` | Daily Readings, Sale/Vasooli Entry |

---

## 🛠️ Step 1: Database Setup (CRITICAL)
If you see **400 Bad Request** or **404 Not Found** for data, you MUST run the new SQL script.

1. Go to your [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql).
2. Open the file `DATABASE_SETUP.sql` from this project.
3. Copy the **entire content** and paste it into the Supabase SQL Editor.
4. Click **Run**.
5. This creates all tables and fixes the "Infinite Redirect" and "Permission Denied" errors.

---

## 📧 Step 2: Gmail Rate Limit Fix
If emails (Signup/Forgot Password) are not sending, follow the `GMAIL_RATE_LIMIT_FIX.md` guide.
1. You must use a **Google App Password**.
2. Configure it in Supabase > Authentication > SMTP.

---

## 🔐 Step 3: Promote Yourself to Super Admin
After you sign up on the site, you won't have access until you are approved. Run this in Supabase SQL Editor:

```sql
UPDATE user_profiles
SET role = 'super_admin', status = 'active'
WHERE email = 'your-email@example.com';
```

---

## ✅ Fixed Issues Summary

### 1. 🔄 Infinite Redirect Loop
Fixed by adding a session synchronization layer in `auth.js`. The app now waits for the Supabase session to be fully loaded before redirecting.

### 2. 🚫 400 Bad Request (RLS Errors)
Fixed by implementing **Security Definer** functions in PostgreSQL. This prevents the "Infinite Recursion" error where the database keeps checking the role of the user checking the role.

### 3. 📂 Folder Reorganization
The project is now cleanly split into folders:
- `/admin`: Settings, Pump Profile, User Management.
- `/manager`: Khata, Customers, Reports.
- `/employee`: Transactions, Mobil Stock, Daily Readings.

### 4. 📝 Transaction Fixes
Cleaned up `transactions-COMPLETE-vok.js`. Removed 3000 lines of old commented code and synchronized it with the new auth system.

### 5. 🖼️ Missing Assets (404)
Fixed logo paths. Standardized image locations in `/assets`.

---

## 📋 Permission Reference

| Feature | Employee | Manager | Admin | Super Admin |
|---------|----------|---------|-------|-------------|
| Sale/Vasooli Entry | ✅ | ✅ | ✅ | ✅ |
| View Customers | ✅ | ✅ | ✅ | ✅ |
| Bank Deposits | ❌ | ✅ | ✅ | ✅ |
| Fuel Price Editing | ❌ | ❌ | ✅ | ✅ |
| User Approvals | ❌ | ❌ | ✅ | ✅ |
| Delete Everything | ❌ | ❌ | ❌ | ✅ |
