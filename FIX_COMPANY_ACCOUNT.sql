UPDATE public.customers 
SET category = 'Company', 
    is_company = true,
    account_type = 'company'
WHERE sr_no = 10;
