-- SQL Patch to shift all recent "Opening Balance" transactions to January 2026
-- Run this in your Supabase SQL Editor

UPDATE public.transactions
SET 
  created_at = '2026-01-31 23:59:59+00',
  description = 'Opening Balance (January 2026) — Pichla pending'
WHERE 
  description LIKE 'Opening Balance%' 
  AND created_at >= '2026-04-01' -- Target entries made recently
  AND transaction_type = 'Credit';

-- Verify the change
SELECT id, customer_id, amount, created_at, description 
FROM public.transactions 
WHERE description LIKE '%January 2026%'
ORDER BY created_at DESC;
