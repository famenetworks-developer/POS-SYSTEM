-- Barcode scan activity log for the /scan page.
-- Product name and price are snapshots taken at scan time, so later edits don't rewrite history.
CREATE TABLE IF NOT EXISTS scan_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE, -- NULL for super admin scans
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT '',
    product_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
    product_name TEXT,
    price_minor BIGINT,
    found BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_restaurant_time ON scan_logs (restaurant_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_user_time ON scan_logs (user_id, scanned_at DESC);
