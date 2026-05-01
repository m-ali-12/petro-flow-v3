-- FIX FOR COMPANY ACCOUNT (Credit Fuel Finance)
-- Based on user request: Sr# 10 is the company account.
UPDATE public.customers 
SET category = 'Company', 
    is_company = true
WHERE sr_no = 10;

-- Optional: Ensure it's not hidden if it was marked as Owner (though it's Regular in import script)
UPDATE public.customers 
SET category = 'Company'
WHERE sr_no = 10 AND category = 'Owner';

-- Verify update
SELECT id, sr_no, name, category, is_company FROM public.customers WHERE sr_no = 10;
