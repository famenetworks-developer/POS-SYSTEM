# NovaMart POS - Production Operations Runbook

## 1. System Overview
- **Backend:** Go 1.22+ API & WebSocket Server (`cmd/api/main.go`) on port `8080`
- **Worker:** Go Background Cron & Jobs Worker (`cmd/worker/main.go`)
- **Frontend:** React 18/19 SPA/PWA on port `5173` (Dev) / `80` (Nginx Prod)
- **Database:** PostgreSQL 15+ (`restoflow` database)
- **Cache / Messaging:** Redis 7+

---

## 2. PostgreSQL Backup & Restore Procedures

### 2.1 Automated Daily Backup
Schedule via crontab:
```bash
0 2 * * * pg_dump -U restoflow -h localhost -Fc restoflow > /var/backups/restoflow/restoflow_$(date +\%Y\%m\%d_\%H\%M\%S).dump
# Retain backups for 14 days
find /var/backups/restoflow -name "*.dump" -mtime +14 -delete
```

### 2.2 Point-in-Time Restore Drill
```bash
# 1. Stop API instances to avoid write contention
docker compose stop api worker

# 2. Drop and recreate database
dropdb -U restoflow -h localhost restoflow
createdb -U restoflow -h localhost restoflow

# 3. Restore from binary dump
pg_restore -U restoflow -h localhost -d restoflow /var/backups/restoflow/restoflow_20261011_020000.dump

# 4. Restart services
docker compose start api worker
```

---

## 3. Secret Rotation Procedures

### 3.1 JWT Secret Rotation
NovaMart uses separate access-token and refresh-token secrets:
1. Generate new 256-bit keys:
   ```bash
   openssl rand -hex 32
   ```
2. Update `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in environment variables.
3. Perform rolling restart of the API cluster:
   ```bash
   docker compose up -d --no-deps api
   ```
4. Existing access and refresh tokens become invalid after rotation. Plan a maintenance window and require users to sign in again.

---

## 4. Scaling Worker & API Instances

### 4.1 Horizontal API Scaling
The Go API server is stateless (session state is stored in JWT tokens and PostgreSQL).
To scale out API instances behind Nginx / Load Balancer:
```bash
docker compose up -d --scale api=4
```

### 4.2 Background Worker Scaling
The bundled worker runs hourly PostgreSQL maintenance jobs (subscription status and low-stock audits). Run a single worker instance unless distributed job locking is added. Redis is provisioned for future queue/cache integration but is not currently used by the Go services.

---

## 5. Troubleshooting: Stuck Offline Sync Queue

### 5.1 Symptom
Terminal indicates pending items in the offline queue that fail to reconcile on reconnect, or return conflicts.

### 5.2 Resolution Steps
1. Navigate to **Sync Center** in the POS terminal interface (`/pos` -> Status bar -> Outbox).
2. Inspect the failed operation details and the `last_error` payload.
3. If an idempotency collision occurred, check `outbox_sync_log` on the database:
   ```sql
   SELECT * FROM outbox_sync_log WHERE idempotency_key = '<KEY>';
   ```
4. To force re-sync of pending queue from the terminal console:
   ```javascript
   await window.restoflowSyncEngine.triggerSync();
   ```
5. If an order was already settled by another cashier, click **Resolve / Discard** in the Sync Center to clear the local IndexedDB queue.
