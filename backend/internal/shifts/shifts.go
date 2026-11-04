package shifts

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/audit"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
	"restoflow/internal/platform"
)

type ShiftService struct {
	pool  *pgxpool.Pool
	hub   *platform.WSHub
	audit *audit.AuditService
}

func NewShiftService(pool *pgxpool.Pool, hub *platform.WSHub, audit *audit.AuditService) *ShiftService {
	return &ShiftService{pool: pool, hub: hub, audit: audit}
}

func (s *ShiftService) MountRoutes(r chi.Router) {
	r.Post("/shifts/open", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())

		var body struct {
			BranchID         string `json:"branch_id"`
			TerminalID       string `json:"terminal_id"`
			OpeningCashMinor int64  `json:"opening_cash_minor"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		terminal := body.TerminalID
		if terminal == "" {
			terminal = "default"
		}

		// Check if open shift already exists for this cashier
		var existingID string
		err := s.pool.QueryRow(req.Context(), `
			SELECT id FROM shifts
			WHERE branch_id = $1 AND cashier_id = $2 AND status = 'open'
			LIMIT 1
		`, body.BranchID, claims.UserID).Scan(&existingID)
		if err == nil && existingID != "" {
			middleware.JSONError(w, http.StatusBadRequest, "SHIFT_ALREADY_OPEN", "You already have an active open shift on this branch", nil)
			return
		}

		shiftID := uuid.New().String()
		var shift models.Shift
		err = s.pool.QueryRow(req.Context(), `
			INSERT INTO shifts (id, restaurant_id, branch_id, cashier_id, terminal_id, opening_cash_minor, expected_cash_minor, status, opened_at)
			VALUES ($1, $2, $3, $4, $5, $6, $6, 'open', NOW())
			RETURNING id, restaurant_id, branch_id, cashier_id, terminal_id, opening_cash_minor, expected_cash_minor, counted_cash_minor, variance_minor, status, opened_at
		`, shiftID, restID, body.BranchID, claims.UserID, terminal, body.OpeningCashMinor).Scan(
			&shift.ID, &shift.RestaurantID, &shift.BranchID, &shift.CashierID, &shift.TerminalID,
			&shift.OpeningCashMinor, &shift.ExpectedCashMinor, &shift.CountedCashMinor, &shift.VarianceMinor,
			&shift.Status, &shift.OpenedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "OPEN_SHIFT_FAILED", err.Error(), nil)
			return
		}

		s.hub.BroadcastBranch(body.BranchID, "shift.updated", shift)
		s.audit.Log(req.Context(), "OPEN_SHIFT", "shift", &shiftID, nil, shift, "", "")
		middleware.JSONSuccess(w, http.StatusCreated, shift, nil)
	})

	r.Post("/shifts/{id}/cash-movements", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		shiftID := chi.URLParam(req, "id")
		var permitted bool
		_ = s.pool.QueryRow(req.Context(), `SELECT EXISTS (
			SELECT 1 FROM shifts WHERE id = $1 AND restaurant_id = $2
			AND ($3 <> 'cashier' OR cashier_id::text = $4)
		)`, shiftID, restID, claims.Role, claims.UserID).Scan(&permitted)
		if !permitted {
			middleware.JSONError(w, http.StatusForbidden, "SHIFT_FORBIDDEN", "You may only manage your own shift", nil)
			return
		}

		var body struct {
			Type        string `json:"type"` // in, out
			AmountMinor int64  `json:"amount_minor"`
			Reason      string `json:"reason"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		if body.Reason == "" || body.AmountMinor <= 0 {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_FIELDS", "Amount and reason are required", nil)
			return
		}

		movementID := uuid.New().String()
		_, err := s.pool.Exec(req.Context(), `
			INSERT INTO cash_movements (id, restaurant_id, shift_id, type, amount_minor, reason, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
		`, movementID, restID, shiftID, body.Type, body.AmountMinor, body.Reason)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "RECORD_MOVEMENT_FAILED", err.Error(), nil)
			return
		}

		// Update expected cash
		delta := body.AmountMinor
		if body.Type == "out" {
			delta = -delta
		}
		_, _ = s.pool.Exec(req.Context(), "UPDATE shifts SET expected_cash_minor = expected_cash_minor + $1 WHERE id = $2", delta, shiftID)

		middleware.JSONSuccess(w, http.StatusCreated, map[string]interface{}{"id": movementID, "type": body.Type, "amount": body.AmountMinor}, nil)
	})

	r.Post("/shifts/{id}/close", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		shiftID := chi.URLParam(req, "id")

		var body struct {
			CountedCashMinor int64  `json:"counted_cash_minor"`
			Note             string `json:"note"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		var expectedCash int64
		var branchID string
		err := s.pool.QueryRow(req.Context(), `
			SELECT expected_cash_minor, branch_id FROM shifts
			WHERE id = $1 AND restaurant_id = $2 AND status = 'open'
			AND ($3 <> 'cashier' OR cashier_id::text = $4)
		`, shiftID, restID, claims.Role, claims.UserID).Scan(&expectedCash, &branchID)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "SHIFT_NOT_FOUND_OR_CLOSED", err.Error(), nil)
			return
		}

		variance := body.CountedCashMinor - expectedCash
		// Key business rule 6.3: "Closing a shift is blocked if the cash variance reason is missing when variance is not zero."
		if variance != 0 && body.Note == "" {
			middleware.JSONError(w, http.StatusBadRequest, "VARIANCE_REASON_REQUIRED", fmt.Sprintf("Cash variance of %d poisha detected. A detailed explanation note is required.", variance), nil)
			return
		}

		now := time.Now()
		_, err = s.pool.Exec(req.Context(), `
			UPDATE shifts
			SET status = 'closed', counted_cash_minor = $1, variance_minor = $2, note = $3, closed_at = $4
			WHERE id = $5
		`, body.CountedCashMinor, variance, body.Note, now, shiftID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "CLOSE_FAILED", err.Error(), nil)
			return
		}

		s.hub.BroadcastBranch(branchID, "shift.updated", map[string]interface{}{
			"shift_id": shiftID,
			"status":   "closed",
			"variance": variance,
		})

		s.audit.Log(req.Context(), "CLOSE_SHIFT", "shift", &shiftID, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"id":             shiftID,
			"status":         "closed",
			"expected_cash":  expectedCash,
			"counted_cash":   body.CountedCashMinor,
			"variance_minor": variance,
		}, nil)
	})

	r.Get("/shifts", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		branchID := req.URL.Query().Get("branch_id")

		query := `
			SELECT s.id, s.restaurant_id, s.branch_id, s.cashier_id, u.name, s.terminal_id,
			       s.opening_cash_minor, s.expected_cash_minor, s.counted_cash_minor, s.variance_minor,
			       COALESCE(s.note, ''), s.status, s.opened_at, s.closed_at
			FROM shifts s
			JOIN users u ON s.cashier_id = u.id
			WHERE s.restaurant_id = $1 AND ($2 = '' OR s.branch_id = $2::uuid)
			  AND ($3 <> 'cashier' OR s.cashier_id::text = $4)
			ORDER BY s.opened_at DESC
			LIMIT 50
		`
		rows, err := s.pool.Query(req.Context(), query, restID, branchID, claims.Role, claims.UserID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.Shift
		for rows.Next() {
			var sh models.Shift
			if err := rows.Scan(
				&sh.ID, &sh.RestaurantID, &sh.BranchID, &sh.CashierID, &sh.CashierName, &sh.TerminalID,
				&sh.OpeningCashMinor, &sh.ExpectedCashMinor, &sh.CountedCashMinor, &sh.VarianceMinor,
				&sh.Note, &sh.Status, &sh.OpenedAt, &sh.ClosedAt,
			); err == nil {
				list = append(list, sh)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Get("/shifts/{id}/report", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		shiftID := chi.URLParam(req, "id")

		var sh models.Shift
		err := s.pool.QueryRow(req.Context(), `
			SELECT s.id, s.restaurant_id, s.branch_id, s.cashier_id, u.name, s.terminal_id,
			       s.opening_cash_minor, s.expected_cash_minor, s.counted_cash_minor, s.variance_minor,
			       COALESCE(s.note, ''), s.status, s.opened_at, s.closed_at
			FROM shifts s
			JOIN users u ON s.cashier_id = u.id
			WHERE s.id = $1 AND s.restaurant_id = $2
			  AND ($3 <> 'cashier' OR s.cashier_id::text = $4)
		`, shiftID, restID, claims.Role, claims.UserID).Scan(
			&sh.ID, &sh.RestaurantID, &sh.BranchID, &sh.CashierID, &sh.CashierName, &sh.TerminalID,
			&sh.OpeningCashMinor, &sh.ExpectedCashMinor, &sh.CountedCashMinor, &sh.VarianceMinor,
			&sh.Note, &sh.Status, &sh.OpenedAt, &sh.ClosedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
			return
		}

		// Payment breakdown
		rows, _ := s.pool.Query(req.Context(), `
			SELECT method_code, COUNT(*), SUM(amount_minor)
			FROM payments
			WHERE shift_id = $1
			GROUP BY method_code
		`, shiftID)

		paymentBreakdown := make(map[string]map[string]interface{})
		if rows != nil {
			for rows.Next() {
				var code string
				var count int
				var sum int64
				if err := rows.Scan(&code, &count, &sum); err == nil {
					paymentBreakdown[code] = map[string]interface{}{
						"count":        count,
						"amount_minor": sum,
					}
				}
			}
			rows.Close()
		}

		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"shift":             sh,
			"payment_breakdown": paymentBreakdown,
		}, nil)
	})
}
