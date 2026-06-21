# 📧 Gmail Rate Limit & SMTP Fix Guide

If you are seeing "Rate Limit Exceeded" or emails are not sending from Supabase Auth, follow these steps.

## 🛠️ The Issue
Google recently restricted standard Gmail passwords for third-party apps. To use Gmail with Supabase for authentication, you **MUST** use an "App Password".

---

## ⚡ Step 1: Create a Google App Password
1. Go to your [Google Account Settings](https://myaccount.google.com/).
2. Select **Security** from the left menu.
3. Under "How you sign in to Google," make sure **2-Step Verification** is turned ON.
4. Search for **"App Passwords"** in the top search bar.
5. Enter a name (e.g., `PetroFlow Supabase`) and click **Create**.
6. **COPY THE 16-CHARACTER CODE** (e.g., `abcd efgh ijkl mnop`). This is your new SMTP password.

---

## ⚡ Step 2: Configure Supabase SMTP
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to **Project Settings** > **Auth**.
3. Scroll down to **SMTP Settings**.
4. Enable **External SMTP Provider**.
5. Fill in these details:
   - **Sender email**: Your Gmail address (e.g., `test@gmail.com`).
   - **Sender name**: `PetroFlow System`.
   - **SMTP Host**: `smtp.gmail.com`.
   - **SMTP Port**: `587`.
   - **SMTP User**: Your Gmail address.
   - **SMTP Password**: The **App Password** you created in Step 1 (no spaces).
6. Click **Save**.

---

## 🚀 Step 3: Increase Rate Limits
1. In Supabase Dashboard, go to **Auth** > **Rate Limits**.
2. Increase the "Confirm Email" and "Password Reset" limits if needed.
3. **Note**: Gmail itself has a daily limit of 500-2000 emails. If your pump sends more, use **SendGrid** or **Resend**.

---

## ✅ Step 4: Verify
Try to "Sign Up" a new user or use "Forgot Password" on the PetroFlow login page. The email should arrive instantly without any rate limit errors.
