-- Centralized tenant RBAC and approval workflow foundations.
-- Additive only: existing users, orders, refunds, stock and purchases are preserved.

CREATE TABLE IF NOT EXISTS permissions (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role TEXT NOT NULL,
    permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role, permission_code)
);

INSERT INTO permissions (code, description) VALUES
 ('sales.create','Process sales'), ('sales.view_own','View own sales'),
 ('sales.view_branch','View assigned branch sales'), ('sales.view_all','View all tenant sales'),
 ('refunds.request','Request refunds'), ('refunds.approve','Approve refunds'),
 ('discounts.request','Request discounts'), ('discounts.approve','Approve discounts'),
 ('voids.request','Request voids'), ('voids.approve','Approve voids'),
 ('inventory.view','View inventory'), ('inventory.adjust','Adjust inventory'),
 ('inventory.transfer','Transfer stock'), ('purchases.view','View purchases'),
 ('purchases.create','Create purchase orders'), ('purchases.approve','Approve purchase orders'),
 ('suppliers.manage','Manage suppliers'), ('reports.inventory','View inventory reports'),
 ('reports.purchase','View purchase reports'), ('reports.branch_sales','View branch sales reports'),
 ('reports.financial','View strategic financial reports'), ('users.manage','Manage staff accounts'),
 ('roles.manage','Assign approved roles'), ('settings.manage','Manage tenant settings'),
 ('audit.view','View tenant audit logs'), ('shifts.own','Manage own shifts'),
 ('shifts.manage','Manage branch shifts'), ('registers.manage','Manage registers'),
 ('customers.manage','Manage customers'), ('fulfillment.manage','Manage fulfillment'),
 ('platform.manage','Manage platform tenants')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, permission_code) VALUES
 ('owner','sales.create'),('owner','sales.view_all'),('owner','refunds.approve'),('owner','discounts.approve'),('owner','voids.approve'),
 ('owner','inventory.view'),('owner','inventory.adjust'),('owner','inventory.transfer'),('owner','purchases.view'),('owner','purchases.create'),
 ('owner','purchases.approve'),('owner','suppliers.manage'),('owner','reports.inventory'),('owner','reports.purchase'),('owner','reports.branch_sales'),
 ('owner','reports.financial'),('owner','users.manage'),('owner','roles.manage'),('owner','settings.manage'),('owner','audit.view'),
 ('owner','shifts.manage'),('owner','registers.manage'),('owner','customers.manage'),('owner','fulfillment.manage'),
 ('admin','sales.view_all'),('admin','inventory.view'),('admin','purchases.view'),('admin','reports.inventory'),('admin','reports.purchase'),
 ('admin','users.manage'),('admin','roles.manage'),('admin','settings.manage'),('admin','audit.view'),('admin','registers.manage'),
 ('manager','sales.view_branch'),('manager','refunds.approve'),('manager','discounts.approve'),('manager','voids.approve'),
 ('manager','inventory.view'),('manager','purchases.view'),('manager','purchases.approve'),('manager','reports.branch_sales'),
 ('manager','shifts.manage'),('manager','registers.manage'),('manager','customers.manage'),('manager','fulfillment.manage'),
 ('cashier','sales.create'),('cashier','sales.view_own'),('cashier','refunds.request'),('cashier','discounts.request'),
 ('cashier','voids.request'),('cashier','shifts.own'),('cashier','customers.manage'),
 ('inventory_manager','inventory.view'),('inventory_manager','inventory.adjust'),('inventory_manager','inventory.transfer'),
 ('inventory_manager','reports.inventory'),('inventory_manager','purchases.view'),
 ('purchase_manager','inventory.view'),('purchase_manager','purchases.view'),('purchase_manager','purchases.create'),
 ('purchase_manager','suppliers.manage'),('purchase_manager','reports.purchase'),
 ('accountant','reports.financial'),('accountant','audit.view'),
 ('delivery_staff','fulfillment.manage'),('super_admin','platform.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('refund','return','discount','void','purchase','stock_adjustment')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','executed')),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    requested_by UUID NOT NULL REFERENCES users(id),
    decided_by UUID REFERENCES users(id),
    reason TEXT NOT NULL,
    decision_note TEXT,
    amount_minor BIGINT NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_scope ON approval_requests(restaurant_id, branch_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS approval_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ;

ALTER TABLE refunds
    ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id) ON DELETE SET NULL;

INSERT INTO settings (restaurant_id, key, value)
SELECT id, 'approval_limits', '{"purchase_minor":5000000,"stock_adjustment_qty":100,"cashier_discount_pct":10}'::jsonb
FROM restaurants
ON CONFLICT (restaurant_id, key) DO NOTHING;

