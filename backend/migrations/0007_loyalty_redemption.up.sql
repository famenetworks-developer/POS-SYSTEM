-- Persist automatic loyalty redemption on each sale for auditing and receipt reprints.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_discount_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER NOT NULL DEFAULT 0;

INSERT INTO settings (restaurant_id, key, value)
SELECT id, 'loyalty', '{"points_per_unit":100,"discount_minor_per_unit":5000,"auto_redeem":true}'::jsonb
FROM restaurants
ON CONFLICT (restaurant_id, key) DO NOTHING;
