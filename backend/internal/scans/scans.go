package scans

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/middleware"
	"restoflow/internal/platform"
)

const (
	maxCodeLength   = 512
	maxFormatLength = 40
	defaultLimit    = 50
	maxLimit        = 200
)

type ScanLog struct {
	ID          string    `json:"id"`
	BranchID    *string   `json:"branch_id"`
	UserID      *string   `json:"user_id"`
	UserName    string    `json:"user_name"`
	Code        string    `json:"code"`
	Format      string    `json:"format"`
	ProductID   *string   `json:"product_id"`
	ProductName *string   `json:"product_name"`
	PriceMinor  *int64    `json:"price_minor"`
	Found       bool      `json:"found"`
	ScannedAt   time.Time `json:"scanned_at"`
}

type ScanService struct {
	pool *pgxpool.Pool
	hub  *platform.WSHub
}

func NewScanService(pool *pgxpool.Pool, hub *platform.WSHub) *ScanService {
	return &ScanService{pool: pool, hub: hub}
}

const scanLogColumns = `id, branch_id, user_id, user_name, code, format, product_id, product_name, price_minor, found, scanned_at`

func scanRow(row interface{ Scan(dest ...any) error }, l *ScanLog) error {
	return row.Scan(&l.ID, &l.BranchID, &l.UserID, &l.UserName, &l.Code, &l.Format,
		&l.ProductID, &l.ProductName, &l.PriceMinor, &l.Found, &l.ScannedAt)
}

func (s *ScanService) MountRoutes(r chi.Router) {
	// Same roles as the /scan page (super_admin always passes RequireRole).
	r.Group(func(sr chi.Router) {
		sr.Use(middleware.RequireRole("cashier"))

		// Record a scan. Product name and price are read from the database, not trusted from the client.
		sr.Post("/scans", func(w http.ResponseWriter, req *http.Request) {
			claims := middleware.GetUserClaims(req.Context())
			restID := claims.RestaurantID

			var body struct {
				Code      string `json:"code"`
				Format    string `json:"format"`
				BranchID  string `json:"branch_id"`
				ProductID string `json:"product_id"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
				return
			}
			body.Code = strings.TrimSpace(body.Code)
			body.Format = strings.TrimSpace(body.Format)
			if body.Code == "" || len(body.Code) > maxCodeLength {
				middleware.JSONError(w, http.StatusBadRequest, "INVALID_CODE", "code must be 1-512 characters", nil)
				return
			}
			if len(body.Format) > maxFormatLength {
				body.Format = body.Format[:maxFormatLength]
			}

			var l ScanLog
			err := scanRow(s.pool.QueryRow(req.Context(), `
				WITH product AS (
					SELECT id, name_en, base_price_minor FROM menu_items
					WHERE $5 <> '' AND id::text = $5 AND restaurant_id::text = $1
				), branch AS (
					SELECT id FROM branches
					WHERE $4 <> '' AND id::text = $4 AND restaurant_id::text = $1
				)
				INSERT INTO scan_logs (restaurant_id, branch_id, user_id, user_name, code, format, product_id, product_name, price_minor, found)
				SELECT NULLIF($1, '')::uuid,
				       (SELECT id FROM branch),
				       u.id, u.name, $2, $3,
				       (SELECT id FROM product),
				       (SELECT name_en FROM product),
				       (SELECT base_price_minor FROM product),
				       EXISTS (SELECT 1 FROM product)
				FROM users u WHERE u.id::text = $6
				RETURNING `+scanLogColumns,
				restID, body.Code, body.Format, body.BranchID, body.ProductID, claims.UserID), &l)
			if err != nil {
				middleware.JSONError(w, http.StatusInternalServerError, "SCAN_LOG_FAILED", "Could not record scan", nil)
				return
			}

			// Live activity: the scanner's own devices, plus every super admin.
			s.hub.BroadcastUser(claims.UserID, "scan.logged", l)
			if claims.Role != "super_admin" {
				s.hub.BroadcastToRoom(platform.PlatformRoom, "scan.logged", l)
			}
			middleware.JSONSuccess(w, http.StatusCreated, l, nil)
		})

		// List recent scans: super admins see every scan, everyone else sees their own.
		sr.Get("/scans", func(w http.ResponseWriter, req *http.Request) {
			claims := middleware.GetUserClaims(req.Context())
			limit := defaultLimit
			if v, err := strconv.Atoi(req.URL.Query().Get("limit")); err == nil && v > 0 {
				limit = min(v, maxLimit)
			}

			query := `SELECT ` + scanLogColumns + ` FROM scan_logs WHERE user_id::text = $1 ORDER BY scanned_at DESC LIMIT $2`
			args := []any{claims.UserID, limit}
			if claims.Role == "super_admin" {
				query = `SELECT ` + scanLogColumns + ` FROM scan_logs ORDER BY scanned_at DESC LIMIT $1`
				args = []any{limit}
			}

			rows, err := s.pool.Query(req.Context(), query, args...)
			if err != nil {
				middleware.JSONError(w, http.StatusInternalServerError, "SCAN_LOG_FAILED", "Could not load scans", nil)
				return
			}
			defer rows.Close()

			logs := []ScanLog{}
			for rows.Next() {
				var l ScanLog
				if err := scanRow(rows, &l); err != nil {
					middleware.JSONError(w, http.StatusInternalServerError, "SCAN_LOG_FAILED", "Could not load scans", nil)
					return
				}
				logs = append(logs, l)
			}
			middleware.JSONSuccess(w, http.StatusOK, logs, nil)
		})
	})
}
