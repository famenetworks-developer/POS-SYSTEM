DELETE FROM settings WHERE key = 'loyalty';
ALTER TABLE orders DROP COLUMN IF EXISTS loyalty_points_earned;
ALTER TABLE orders DROP COLUMN IF EXISTS loyalty_discount_minor;
ALTER TABLE orders DROP COLUMN IF EXISTS loyalty_points_redeemed;
