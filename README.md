# NovaMart Super Shop POS

Multi-branch supermarket POS and retail management platform built with Go, PostgreSQL, React, TypeScript, Vite, and Nginx.

## Features

- Fast barcode-based checkout, weighted products, coupons, split tender, hold/resume carts
- Fulfillment picking and dispatch workflow
- Mobile aisle assistant and price checker
- Product, inventory, sales, customer, supplier, staff, shift, and reporting administration
- Integer minor-unit money calculations (1 BDT = 100 poisha)
- PostgreSQL-backed multi-tenant data and automatic versioned migrations
- WebSocket updates and offline browser storage

## Requirements

### Docker deployment

- Docker Engine / Docker Desktop with Compose

### Local development

- Go 1.26+
- Node.js 20.19+ or 22.12+
- PostgreSQL 15+

## Environment setup

The real `.env` is intentionally ignored by Git.

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD`, `COMPOSE_DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`.
3. Set `CORS_ORIGINS` to the public site URL (or a comma-separated list of trusted URLs).
4. Keep the password embedded in `COMPOSE_DATABASE_URL` URL-safe, or percent-encode reserved characters.

Generate separate JWT secrets with a cryptographically secure generator, for example:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Never commit `.env` or use the example placeholder secrets in production.

## Run the complete stack with Docker

```bash
docker compose config
docker compose up -d --build
docker compose ps
```

Open `http://localhost` (or the host/port configured by `WEB_PORT`). The API readiness endpoint is `http://localhost:8080/ready` by default.

On startup, the API connects to PostgreSQL, applies every unapplied `backend/migrations/*.up.sql` migration transactionally, records it in `schema_migrations`, and then seeds demo data when needed. The worker starts only after the API and database are healthy.

To stop the application without deleting its database:

```bash
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete the PostgreSQL and Redis volumes.

## Local development

Configure the local `DATABASE_URL` and `MIGRATIONS_DIR=migrations` in the root `.env`, then run:

```powershell
# Terminal 1
cd backend
go run ./cmd/api

# Terminal 2
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` and `/ws` to `http://localhost:8080`, so the frontend works without hardcoded production hosts. Open `http://localhost:5173` (or the next free Vite port).

## Verification

```powershell
cd backend
go test ./...

cd ..\frontend
npm run lint
npm run build

cd ..
powershell -ExecutionPolicy Bypass -File .\test_e2e.ps1
```

Health endpoints:

- `GET /health`: API process is running
- `GET /ready`: API can reach PostgreSQL

## Demo accounts

Demo credentials are for non-production environments only. Change or remove seeded credentials before exposing a production system.

They are created only when `SEED_DEMO_DATA=true`; Docker production defaults this setting to `false`.

| Role | Email | Password | PIN |
| --- | --- | --- | --- |
| Super Admin | `admin@novamart.com` | `admin123` | — |
| Store Owner | `owner@novamart.com` | `owner123` | `0000` |
| Branch Manager | `manager@novamart.com` | `manager123` | `1111` |
| Lead Cashier | `cashier@novamart.com` | `cashier123` | `2222` |
| Inventory Head | `inventory@novamart.com` | `inventory123` | `5555` |
| Purchase Officer | `purchase@novamart.com` | `purchase123` | `6666` |
| Chief Accountant | `accountant@novamart.com` | `accountant123` | `7777` |
| Delivery Associate | `delivery@novamart.com` | `delivery123` | `8888` |

## Production checklist

- Use unique PostgreSQL and JWT secrets and store them in the hosting platform's secret manager.
- Set `CORS_ORIGINS` to trusted HTTPS origin(s); do not use `*` for public production deployments.
- Terminate TLS at a reverse proxy or managed load balancer.
- Change/remove demo accounts and credentials.
- Back up the PostgreSQL volume and test restores.
- Run `docker compose config`, tests, lint, and the production build before release.
- Confirm `/ready`, login, checkout, receipt, inventory adjustment, and CSV export after deployment.

Operational backup and restore guidance is in `docs/runbook.md`.
