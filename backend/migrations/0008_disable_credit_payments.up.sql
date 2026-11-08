-- The store never sells on credit: the customer always pays the full amount at the till.
-- The "due" method is switched off (kept, not deleted, so old records still resolve).
UPDATE payment_methods SET is_active = FALSE WHERE code IN ('due', 'credit', 'store_credit');
