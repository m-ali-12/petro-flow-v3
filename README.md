# ⛽ PetroFlow v3 — Component & URL Guide

Welcome to the **PetroFlow v3** technical documentation! Yeh file system ke har ek component, uske maqsad (purpose), working, aur exact Vercel URLs ko define karti hai taa ke aap easily copy-paste karke seedha apna kaam ya testing check kar sakein.

*(Note: Niche diye gaye sab URLs aapki live Vercel website `petro-flow-v3.vercel.app` ke hain. Agar aap localhost par kaam kar rahe hain tou shuru ka hissa `http://localhost:5500` se replace kar lein).*

---

## 1. 📊 Main Dashboard
* **Purpose:** System ka main summary view. Yahan par daily ki overall performance, quick links, aur pending tasks jese `Overdue Rent` ya `Low Stock` warnings dikhai deti hain.
* **How it works:** Yeh page baaqi sab tables (transactions, tanks, rent, customers) se live daily data ikhata karta hai aur metrics (Current Stock, Today's Sale, Expenses) banata hai.
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/index
  ```
  *(Ya simply `https://petro-flow-v3.vercel.app/` kyun k Vercel index ko default map karta hai)*

---

## 2. 👥 Customers Management (General & Classification)
* **Purpose:** Pump par aane walay tamam customers ka record rakhna. Isme Regular, Company, Member aur Owner ki classification ki jati hai.
* **How it works:** Aap naya customer add karte hain aur uski **Category** set karte hain. Jab aap kisi ko "Company" set karte hain tou system automatically usko B2B Module (`company-account`) ke liye active kardeta hai. 
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/manager/customers
  ```

---

## 3. 🏢 Company Accounts (B2B Module)
* **Purpose:** Barey corporate clients, unke sub-members (trucks/drivers), bulk fuel stock purchase, aur unki billing aur repayments manage karna.
* **How it works:** Jab bhi koi company stock kharedti hai, tou is page se uski bulk entry ki jati hai. Is module ka apna alag `company_transactions` table hai jo company ka specific net balance aur un ke cards ki daily usage track/bill karta hai.
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/manager/company-account
  ```

---

## 4. 📒 Khata (Ledger & Daily Sales)
* **Purpose:** Daily petrol/diesel aur mobil oil ki parchi (sales) add krna aur maheemay ka detail Khata maintain karna. 
* **How it works:** Regular customers aur maalik ke daily cash ya udhaar ki entry is page par lagti hai. Ye transactions se related hai (cash sale, credit sale, expense, advance).
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/manager/khata
  ```

---

## 5. 🏪 Shop Rent Management
* **Purpose:** Petrol pump ki zameen / plaza mein mojud dukanon ka mahana kiraya (Shop Rent) control karna.
* **How it works:** Aap shops register karte hain aur unka rent day set krte hain. Har maheene system automatically un sab par "Pending Rent" chahar deta hai. Aap unki bulk fee receive karte hain aur pending/paid report print nikalte ho. (Yeh database ko bilkul independently handle karta hai `rent_payments` aur `shops` ki tables).
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/manager/rent
  ```

---

## 6. 🏦 Bank Deposits & Tracking
* **Purpose:** Pump ka jama shuda cash jo daily ya weakly basis par selected bank accounts mein jamah hota hai uski details rakhna.
* **How it works:** Jab owner bank jaker cash daalta hai tou system me date k hisaab se deposit add hojata hai taa ke mahine k end me system ye match karle ke system ka Total Cash aur Bank me mojood Cash hisaab me barabar araha hai ya nahi.
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/manager/bank-deposits
  ```

---

## 7. 📈 Reports (Views Engine)
* **Purpose:** Pure business ki overview, Ledger checking, aur Mahinay ki complete report nikalna.
* **How it works:** Supabase Database mein mojood **Views** (jese `v_expense_ledger`, `v_company_account_summary`, `v_stock_by_fuel`) ko istemaal karte hue browser ke side par heavily calculations avoid karke directly ready-made report print krwata ha.
* **Exact URL:** 
  ```text
  https://petro-flow-v3.vercel.app/manager/reports
  ```

---

## 8. 🔐 Authentication (Login & Signup)
* **Purpose:** System ko secure rakhna taake sirf authorized Admin aur Staff accounts hi petrol pump ke internal data files/ledgers tak ponnch sakein.
* **How it works:** Supabase Auth system `auth.users` istemaal hota ha. Naye banday Signup krtay han tou role 'Pending' set kr dia jata ha, jab koi Admin usko Approve karta hai tabhi woh baaqi features use krskta ha.
* **Exact URLs:** 
  ```text
  https://petro-flow-v3.vercel.app/login
  https://petro-flow-v3.vercel.app/signup
  ```

---

### Tips for Quick Access:
Agar aapko testing krni ho aur bar bar menus mei dhondna mushkil lgay, tou is `README.md` module se direct Exact URL uthayein aur browser mein Paste+Enter kardein, seedhe aapki screen khul jayegi bina kisi masle ke!
