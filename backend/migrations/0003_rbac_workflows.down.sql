ALTER TABLE refunds DROP COLUMN IF EXISTS approval_request_id, DROP COLUMN IF EXISTS requested_by;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS expected_at, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS created_by;
DELETE FROM settings WHERE key = 'approval_limits';
DROP TABLE IF EXISTS approval_status_history;
DROP TABLE IF EXISTS approval_requests;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
