package settings

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/audit"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
)

type SettingsService struct {
	pool  *pgxpool.Pool
	audit *audit.AuditService
}

func NewSettingsService(pool *pgxpool.Pool, audit *audit.AuditService) *SettingsService {
	return &SettingsService{pool: pool, audit: audit}
}

func (s *SettingsService) MountRoutes(r chi.Router) {
	r.Get("/restaurant", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var rest models.Restaurant
		err := s.pool.QueryRow(req.Context(), `
			SELECT id, name, slug, phone, email, address, logo_url, currency, timezone, language, tax_no, status, created_at, updated_at
			FROM restaurants WHERE id = $1
		`, restID).Scan(
			&rest.ID, &rest.Name, &rest.Slug, &rest.Phone, &rest.Email, &rest.Address, &rest.LogoURL,
			&rest.Currency, &rest.Timezone, &rest.Language, &rest.TaxNo, &rest.Status, &rest.CreatedAt, &rest.UpdatedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", "Restaurant not found", nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, rest, nil)
	})

	r.Patch("/restaurant", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body map[string]interface{}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		// Update fields
		if name, ok := body["name"].(string); ok && name != "" {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET name = $1 WHERE id = $2", name, restID)
		}
		if phone, ok := body["phone"].(string); ok {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET phone = $1 WHERE id = $2", phone, restID)
		}
		if address, ok := body["address"].(string); ok {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET address = $1 WHERE id = $2", address, restID)
		}
		if logoURL, ok := body["logo_url"].(string); ok {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET logo_url = $1 WHERE id = $2", logoURL, restID)
		}
		if currency, ok := body["currency"].(string); ok && currency != "" {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET currency = $1 WHERE id = $2", currency, restID)
		}
		if tz, ok := body["timezone"].(string); ok && tz != "" {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET timezone = $1 WHERE id = $2", tz, restID)
		}
		if taxNo, ok := body["tax_no"].(string); ok {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET tax_no = $1 WHERE id = $2", taxNo, restID)
		}
		if lang, ok := body["language"].(string); ok && lang != "" {
			_, _ = s.pool.Exec(req.Context(), "UPDATE restaurants SET language = $1 WHERE id = $2", lang, restID)
		}

		s.audit.Log(req.Context(), "UPDATE_RESTAURANT", "restaurant", &restID, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"message": "restaurant updated"}, nil)
	})

	r.Get("/settings", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), "SELECT key, value FROM settings WHERE restaurant_id = $1", restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		settingsMap := make(map[string]interface{})
		for rows.Next() {
			var k string
			var v []byte
			if err := rows.Scan(&k, &v); err == nil {
				var val interface{}
				_ = json.Unmarshal(v, &val)
				settingsMap[k] = val
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, settingsMap, nil)
	})

	r.Patch("/settings", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body map[string]interface{}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		for k, v := range body {
			valJSON, _ := json.Marshal(v)
			query := `
				INSERT INTO settings (restaurant_id, key, value, updated_at)
				VALUES ($1, $2, $3::jsonb, NOW())
				ON CONFLICT (restaurant_id, key)
				DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
			`
			_, _ = s.pool.Exec(req.Context(), query, restID, k, valJSON)
		}

		s.audit.Log(req.Context(), "UPDATE_SETTINGS", "settings", nil, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"message": "settings updated"}, nil)
	})

	// Branches
	r.Get("/branches", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		rows, err := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, name, address, phone, is_active, invoice_prefix, created_at, updated_at
			FROM branches b WHERE restaurant_id = $1
			AND ($2 IN ('owner','admin','accountant') OR EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id=$3 AND ub.branch_id=b.id))
			ORDER BY created_at ASC
		`, restID, claims.Role, claims.UserID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var branches []models.Branch
		for rows.Next() {
			var b models.Branch
			if err := rows.Scan(&b.ID, &b.RestaurantID, &b.Name, &b.Address, &b.Phone, &b.IsActive, &b.InvoicePrefix, &b.CreatedAt, &b.UpdatedAt); err == nil {
				branches = append(branches, b)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, branches, nil)
	})

	r.Post("/branches", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body models.Branch
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		prefix := body.InvoicePrefix
		if prefix == "" {
			prefix = "INV-"
		}
		var b models.Branch
		err := s.pool.QueryRow(req.Context(), `
			INSERT INTO branches (restaurant_id, name, address, phone, is_active, invoice_prefix)
			VALUES ($1, $2, $3, $4, TRUE, $5)
			RETURNING id, restaurant_id, name, address, phone, is_active, invoice_prefix, created_at, updated_at
		`, restID, body.Name, body.Address, body.Phone, prefix).Scan(
			&b.ID, &b.RestaurantID, &b.Name, &b.Address, &b.Phone, &b.IsActive, &b.InvoicePrefix, &b.CreatedAt, &b.UpdatedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, b, nil)
	})

	// Payment Methods
	r.Get("/payment-methods", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, code, label, is_active, requires_reference, created_at
			FROM payment_methods WHERE restaurant_id = $1 ORDER BY code ASC
		`, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var methods []models.PaymentMethod
		for rows.Next() {
			var m models.PaymentMethod
			if err := rows.Scan(&m.ID, &m.RestaurantID, &m.Code, &m.Label, &m.IsActive, &m.RequiresReference, &m.CreatedAt); err == nil {
				methods = append(methods, m)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, methods, nil)
	})

	// Kitchen Stations
	r.Get("/stations", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, branch_id, name, printer_id, created_at
			FROM stations WHERE restaurant_id = $1 ORDER BY name ASC
		`, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var stations []models.Station
		for rows.Next() {
			var st models.Station
			var pid *string
			if err := rows.Scan(&st.ID, &st.RestaurantID, &st.BranchID, &st.Name, &pid, &st.CreatedAt); err == nil {
				if pid != nil {
					st.PrinterID = *pid
				}
				stations = append(stations, st)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, stations, nil)
	})
}
