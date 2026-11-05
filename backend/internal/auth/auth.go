package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"restoflow/internal/audit"
	"restoflow/internal/config"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
)

type AuthService struct {
	pool  *pgxpool.Pool
	cfg   *config.Config
	audit *audit.AuditService
}

func NewAuthService(pool *pgxpool.Pool, cfg *config.Config, audit *audit.AuditService) *AuthService {
	return &AuthService{pool: pool, cfg: cfg, audit: audit}
}

type RegisterRequest struct {
	RestaurantName string `json:"restaurant_name"`
	OwnerName      string `json:"owner_name"`
	Email          string `json:"email"`
	Phone          string `json:"phone"`
	Password       string `json:"password"`
	Currency       string `json:"currency"`
	Timezone       string `json:"timezone"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type PINLoginRequest struct {
	BranchID string `json:"branch_id"`
	PIN      string `json:"pin"`
}

type CreateUserRequest struct {
	Name             string   `json:"name"`
	Email            string   `json:"email"`
	Phone            string   `json:"phone"`
	Password         string   `json:"password"`
	PIN              string   `json:"pin"`
	Role             string   `json:"role"`
	DiscountLimitPct float64  `json:"discount_limit_pct"`
	BranchIDs        []string `json:"branch_ids"`
}

func hashString(s string) string {
	hasher := sha256.New()
	hasher.Write([]byte(s))
	return hex.EncodeToString(hasher.Sum(nil))
}

func (s *AuthService) Register(ctx context.Context, req RegisterRequest) (map[string]interface{}, error) {
	if strings.TrimSpace(req.RestaurantName) == "" || strings.TrimSpace(req.Email) == "" || strings.TrimSpace(req.Password) == "" {
		return nil, fmt.Errorf("restaurant_name, email and password are required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Check existing email
	var exists bool
	err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)", strings.ToLower(req.Email)).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, fmt.Errorf("email already in use")
	}

	// 1. Create Restaurant
	currency := req.Currency
	if currency == "" {
		currency = s.cfg.DefaultCurrency
	}
	tz := req.Timezone
	if tz == "" {
		tz = s.cfg.DefaultTimezone
	}
	slug := strings.ToLower(strings.ReplaceAll(req.RestaurantName, " ", "-")) + fmt.Sprintf("-%d", time.Now().Unix()%10000)

	var restID string
	err = tx.QueryRow(ctx, `
		INSERT INTO restaurants (name, slug, email, phone, currency, timezone, language, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'en', 'active')
		RETURNING id
	`, req.RestaurantName, slug, strings.ToLower(req.Email), req.Phone, currency, tz).Scan(&restID)
	if err != nil {
		return nil, fmt.Errorf("failed to create restaurant: %w", err)
	}

	// 2. Create Default Branch (Main Branch)
	var branchID string
	err = tx.QueryRow(ctx, `
		INSERT INTO branches (restaurant_id, name, phone, is_active, invoice_prefix)
		VALUES ($1, 'Main Branch', $2, TRUE, 'INV-')
		RETURNING id
	`, restID, req.Phone).Scan(&branchID)
	if err != nil {
		return nil, fmt.Errorf("failed to create branch: %w", err)
	}

	// 3. Hash password
	pwdHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return nil, err
	}

	// 4. Create Owner User
	var userID string
	err = tx.QueryRow(ctx, `
		INSERT INTO users (restaurant_id, name, email, phone, password_hash, role, discount_limit_pct, is_active)
		VALUES ($1, $2, $3, $4, $5, 'owner', 100.0, TRUE)
		RETURNING id
	`, restID, req.OwnerName, strings.ToLower(req.Email), req.Phone, string(pwdHash)).Scan(&userID)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Assign owner to main branch
	_, err = tx.Exec(ctx, "INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)", userID, branchID)
	if err != nil {
		return nil, err
	}

	// 5. Ensure Starter / Trial Plan exists and create 14-day trial subscription
	var planID string
	err = tx.QueryRow(ctx, "SELECT id FROM plans WHERE code = 'starter' LIMIT 1").Scan(&planID)
	if err == pgx.ErrNoRows {
		err = tx.QueryRow(ctx, `
			INSERT INTO plans (code, name, price_minor, interval, max_branches, max_users, features)
			VALUES ('starter', 'Starter Trial Plan', 0, 'monthly', 3, 10, '{"inventory": true, "offline": true, "reports": true}'::jsonb)
			RETURNING id
		`).Scan(&planID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get/create plan: %w", err)
	}

	trialEnd := time.Now().Add(14 * 24 * time.Hour)
	_, err = tx.Exec(ctx, `
		INSERT INTO subscriptions (restaurant_id, plan_id, status, trial_ends_at, current_period_end)
		VALUES ($1, $2, 'trial', $3, $3)
	`, restID, planID, trialEnd)
	if err != nil {
		return nil, fmt.Errorf("failed to create subscription: %w", err)
	}

	// 6. Default Settings (Tax, Service charge, receipt layout)
	taxSettingsJSON := `{"vat_pct": 15.0, "service_pct": 5.0, "is_inclusive": false, "rounding_unit": 100, "vat_on_service": true}`
	receiptSettingsJSON := `{"paper_width": "80mm", "show_tax_no": true, "header": "Welcome to ` + req.RestaurantName + `", "footer": "Thank you for dining with us! Please come again."}`
	_, _ = tx.Exec(ctx, "INSERT INTO settings (restaurant_id, key, value) VALUES ($1, 'tax', $2::jsonb)", restID, taxSettingsJSON)
	_, _ = tx.Exec(ctx, "INSERT INTO settings (restaurant_id, key, value) VALUES ($1, 'receipt', $2::jsonb)", restID, receiptSettingsJSON)

	// 7. Default Payment Methods
	defaultMethods := []struct {
		code, label string
		ref         bool
	}{
		{"cash", "Cash", false},
		{"card", "Credit/Debit Card", true},
		{"bkash", "bKash", true},
		{"nagad", "Nagad", true},
		{"rocket", "Rocket", true},
	}
	for _, m := range defaultMethods {
		_, _ = tx.Exec(ctx, `
			INSERT INTO payment_methods (restaurant_id, code, label, is_active, requires_reference)
			VALUES ($1, $2, $3, TRUE, $4)
		`, restID, m.code, m.label, m.ref)
	}

	// 8. Create default Table Section
	var secID string
	_ = tx.QueryRow(ctx, "INSERT INTO table_sections (restaurant_id, branch_id, name, sort) VALUES ($1, $2, 'Main Dining', 1) RETURNING id", restID, branchID).Scan(&secID)
	if secID != "" {
		for i := 1; i <= 6; i++ {
			_, _ = tx.Exec(ctx, `
				INSERT INTO tables (restaurant_id, branch_id, section_id, name, seats, status)
				VALUES ($1, $2, $3, $4, 4, 'free')
			`, restID, branchID, secID, fmt.Sprintf("Table %d", i))
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// Generate JWT tokens
	accessToken, refreshToken, err := middleware.GenerateTokens(userID, restID, strings.ToLower(req.Email), "owner", 100.0, s.cfg.JWTAccessSecret, s.cfg.JWTRefreshSecret)
	if err != nil {
		return nil, err
	}

	// Store refresh token
	refreshHash := hashString(refreshToken)
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, refreshHash, time.Now().Add(30*24*time.Hour))

	s.audit.Log(ctx, "REGISTER", "restaurant", &restID, nil, map[string]string{"name": req.RestaurantName, "owner": req.OwnerName}, "", "")

	return map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user": map[string]interface{}{
			"id":                 userID,
			"name":               req.OwnerName,
			"email":              strings.ToLower(req.Email),
			"role":               "owner",
			"restaurant_id":      restID,
			"discount_limit_pct": 100.0,
		},
		"restaurant": map[string]interface{}{
			"id":       restID,
			"name":     req.RestaurantName,
			"currency": currency,
			"timezone": tz,
			"status":   "active",
		},
		"branch": map[string]interface{}{
			"id":   branchID,
			"name": "Main Branch",
		},
	}, nil
}

func (s *AuthService) Login(ctx context.Context, email, password string) (map[string]interface{}, error) {
	var user models.User
	var restID *string
	var pinHash *string
	var lastLogin *time.Time

	query := `
		SELECT id, restaurant_id, name, email, phone, password_hash, pin_hash, role, discount_limit_pct, is_active, last_login_at
		FROM users
		WHERE email = $1
	`
	err := s.pool.QueryRow(ctx, query, strings.ToLower(email)).Scan(
		&user.ID, &restID, &user.Name, &user.Email, &user.Phone, &user.PasswordHash, &pinHash, &user.Role, &user.DiscountLimitPct, &user.IsActive, &lastLogin,
	)
	if err != nil {
		return nil, fmt.Errorf("invalid email or password")
	}

	if !user.IsActive {
		return nil, fmt.Errorf("account is deactivated")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid email or password")
	}

	var restaurant models.Restaurant
	var branches []models.Branch

	rid := ""
	if restID != nil {
		rid = *restID
		_ = s.pool.QueryRow(ctx, "SELECT id, name, slug, currency, timezone, status FROM restaurants WHERE id = $1", rid).Scan(
			&restaurant.ID, &restaurant.Name, &restaurant.Slug, &restaurant.Currency, &restaurant.Timezone, &restaurant.Status,
		)

		rows, err := s.pool.Query(ctx, "SELECT id, restaurant_id, name, phone, is_active, invoice_prefix FROM branches WHERE restaurant_id = $1 AND is_active = TRUE", rid)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var b models.Branch
				if err := rows.Scan(&b.ID, &b.RestaurantID, &b.Name, &b.Phone, &b.IsActive, &b.InvoicePrefix); err == nil {
					branches = append(branches, b)
				}
			}
		}
	}

	now := time.Now()
	_, _ = s.pool.Exec(ctx, "UPDATE users SET last_login_at = $1 WHERE id = $2", now, user.ID)

	accessToken, refreshToken, err := middleware.GenerateTokens(user.ID, rid, user.Email, user.Role, user.DiscountLimitPct, s.cfg.JWTAccessSecret, s.cfg.JWTRefreshSecret)
	if err != nil {
		return nil, err
	}

	refreshHash := hashString(refreshToken)
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, refreshHash, time.Now().Add(30*24*time.Hour))

	return map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user": map[string]interface{}{
			"id":                 user.ID,
			"name":               user.Name,
			"email":              user.Email,
			"role":               user.Role,
			"restaurant_id":      rid,
			"discount_limit_pct": user.DiscountLimitPct,
		},
		"restaurant": restaurant,
		"branches":   branches,
	}, nil
}

func (s *AuthService) PINLogin(ctx context.Context, req PINLoginRequest) (map[string]interface{}, error) {
	if req.BranchID == "" || req.PIN == "" {
		return nil, fmt.Errorf("branch_id and pin are required")
	}

	// Find user belonging to this branch with this PIN
	pinHash := hashString(req.PIN)
	var user models.User
	var restID *string
	var storedPinHash *string

	query := `
		SELECT u.id, u.restaurant_id, u.name, u.email, u.role, u.discount_limit_pct, u.is_active, u.pin_hash
		FROM users u
		JOIN user_branches ub ON u.id = ub.user_id
		WHERE ub.branch_id = $1 AND u.pin_hash = $2 AND u.is_active = TRUE
		LIMIT 1
	`
	err := s.pool.QueryRow(ctx, query, req.BranchID, pinHash).Scan(
		&user.ID, &restID, &user.Name, &user.Email, &user.Role, &user.DiscountLimitPct, &user.IsActive, &storedPinHash,
	)
	if err != nil {
		return nil, fmt.Errorf("invalid PIN for selected branch")
	}

	rid := ""
	if restID != nil {
		rid = *restID
	}

	accessToken, refreshToken, err := middleware.GenerateTokens(user.ID, rid, user.Email, user.Role, user.DiscountLimitPct, s.cfg.JWTAccessSecret, s.cfg.JWTRefreshSecret)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user": map[string]interface{}{
			"id":                 user.ID,
			"name":               user.Name,
			"email":              user.Email,
			"role":               user.Role,
			"restaurant_id":      rid,
			"discount_limit_pct": user.DiscountLimitPct,
		},
		"branch_id": req.BranchID,
	}, nil
}

func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (map[string]interface{}, error) {
	tokenHash := hashString(refreshToken)
	var userID string
	var expiresAt time.Time
	var revokedAt *time.Time

	err := s.pool.QueryRow(ctx, `
		SELECT user_id, expires_at, revoked_at
		FROM refresh_tokens
		WHERE token_hash = $1
	`, tokenHash).Scan(&userID, &expiresAt, &revokedAt)
	if err != nil || revokedAt != nil || time.Now().After(expiresAt) {
		return nil, fmt.Errorf("invalid or expired refresh token")
	}

	// Revoke old token (rotation)
	_, _ = s.pool.Exec(ctx, "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", tokenHash)

	var user models.User
	var restID *string
	err = s.pool.QueryRow(ctx, `
		SELECT id, restaurant_id, name, email, role, discount_limit_pct, is_active
		FROM users
		WHERE id = $1
	`, userID).Scan(&user.ID, &restID, &user.Name, &user.Email, &user.Role, &user.DiscountLimitPct, &user.IsActive)
	if err != nil || !user.IsActive {
		return nil, fmt.Errorf("user no longer active")
	}

	rid := ""
	if restID != nil {
		rid = *restID
	}

	newAccess, newRefresh, err := middleware.GenerateTokens(user.ID, rid, user.Email, user.Role, user.DiscountLimitPct, s.cfg.JWTAccessSecret, s.cfg.JWTRefreshSecret)
	if err != nil {
		return nil, err
	}

	newHash := hashString(newRefresh)
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, newHash, time.Now().Add(30*24*time.Hour))

	return map[string]interface{}{
		"access_token":  newAccess,
		"refresh_token": newRefresh,
	}, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	tokenHash := hashString(refreshToken)
	_, err := s.pool.Exec(ctx, "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", tokenHash)
	return err
}

func (s *AuthService) CreateUser(ctx context.Context, restID string, req CreateUserRequest) (*models.User, error) {
	pwdHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return nil, err
	}

	var pinHash *string
	if req.PIN != "" {
		ph := hashString(req.PIN)
		pinHash = &ph
	}

	var user models.User
	query := `
		INSERT INTO users (restaurant_id, name, email, phone, password_hash, pin_hash, role, discount_limit_pct, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
		RETURNING id, restaurant_id, name, email, phone, role, discount_limit_pct, is_active, created_at, updated_at
	`
	err = s.pool.QueryRow(ctx, query, restID, req.Name, strings.ToLower(req.Email), req.Phone, string(pwdHash), pinHash, req.Role, req.DiscountLimitPct).Scan(
		&user.ID, &user.RestaurantID, &user.Name, &user.Email, &user.Phone, &user.Role, &user.DiscountLimitPct, &user.IsActive, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	for _, bid := range req.BranchIDs {
		_, _ = s.pool.Exec(ctx, "INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", user.ID, bid)
	}

	s.audit.Log(ctx, "CREATE_USER", "user", &user.ID, nil, user, "", "")
	return &user, nil
}

func (s *AuthService) ListUsers(ctx context.Context, restID string) ([]models.User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, restaurant_id, name, email, phone, role, discount_limit_pct, is_active, last_login_at, created_at, updated_at
		FROM users
		WHERE restaurant_id = $1
		ORDER BY created_at DESC
	`, restID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.RestaurantID, &u.Name, &u.Email, &u.Phone, &u.Role, &u.DiscountLimitPct, &u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt); err == nil {
			users = append(users, u)
		}
	}
	return users, nil
}

// Handlers mounting
func (s *AuthService) MountRoutes(r chi.Router) {
	r.Post("/auth/register", func(w http.ResponseWriter, req *http.Request) {
		var body RegisterRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		res, err := s.Register(req.Context(), body)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "REGISTRATION_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, res, nil)
	})

	r.Post("/auth/login", func(w http.ResponseWriter, req *http.Request) {
		var body LoginRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		res, err := s.Login(req.Context(), body.Email, body.Password)
		if err != nil {
			middleware.JSONError(w, http.StatusUnauthorized, "LOGIN_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, res, nil)
	})

	r.Post("/auth/pin-login", func(w http.ResponseWriter, req *http.Request) {
		var body PINLoginRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		res, err := s.PINLogin(req.Context(), body)
		if err != nil {
			middleware.JSONError(w, http.StatusUnauthorized, "PIN_LOGIN_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, res, nil)
	})

	r.Post("/auth/refresh", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		res, err := s.RefreshToken(req.Context(), body.RefreshToken)
		if err != nil {
			middleware.JSONError(w, http.StatusUnauthorized, "REFRESH_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, res, nil)
	})

	r.Post("/auth/logout", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = json.NewDecoder(req.Body).Decode(&body)
		_ = s.Logout(req.Context(), body.RefreshToken)
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"message": "logged out"}, nil)
	})

	// Protected endpoints
	r.Group(func(pr chi.Router) {
		pr.Use(middleware.Auth(s.cfg.JWTAccessSecret))
		pr.Use(middleware.RequireAppAccess)
		pr.Use(middleware.RequirePermission(s.pool))
		pr.Use(middleware.EnforceBranchScope(s.pool))

		pr.Get("/me", func(w http.ResponseWriter, req *http.Request) {
			claims := middleware.GetUserClaims(req.Context())
			var user models.User
			var rest models.Restaurant

			_ = s.pool.QueryRow(req.Context(), `
				SELECT id, restaurant_id, name, email, phone, role, discount_limit_pct, is_active
				FROM users WHERE id = $1
			`, claims.UserID).Scan(&user.ID, &user.RestaurantID, &user.Name, &user.Email, &user.Phone, &user.Role, &user.DiscountLimitPct, &user.IsActive)

			if claims.RestaurantID != "" {
				_ = s.pool.QueryRow(req.Context(), "SELECT id, name, slug, currency, timezone, language, tax_no, status FROM restaurants WHERE id = $1", claims.RestaurantID).Scan(
					&rest.ID, &rest.Name, &rest.Slug, &rest.Currency, &rest.Timezone, &rest.Language, &rest.TaxNo, &rest.Status,
				)
			}

			middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
				"user":       user,
				"restaurant": rest,
			}, nil)
		})

		pr.Get("/users", func(w http.ResponseWriter, req *http.Request) {
			restID := middleware.GetRestaurantID(req.Context())
			users, err := s.ListUsers(req.Context(), restID)
			if err != nil {
				middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
				return
			}
			middleware.JSONSuccess(w, http.StatusOK, users, nil)
		})

		pr.Post("/users", func(w http.ResponseWriter, req *http.Request) {
			restID := middleware.GetRestaurantID(req.Context())
			claims := middleware.GetUserClaims(req.Context())
			var body CreateUserRequest
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
				return
			}
			allowedRoles := map[string]bool{"manager": true, "cashier": true, "inventory_manager": true, "purchase_manager": true, "accountant": true, "delivery_staff": true}
			if claims.Role == "owner" {
				allowedRoles["admin"] = true
			}
			if !allowedRoles[body.Role] {
				middleware.JSONError(w, http.StatusForbidden, "ROLE_ESCALATION_BLOCKED", "You cannot assign this role", nil)
				return
			}
			for _, branchID := range body.BranchIDs {
				var valid bool
				_ = s.pool.QueryRow(req.Context(), "SELECT EXISTS(SELECT 1 FROM branches WHERE id::text = $1 AND restaurant_id::text = $2)", branchID, restID).Scan(&valid)
				if !valid {
					middleware.JSONError(w, http.StatusBadRequest, "INVALID_BRANCH", "A selected branch does not belong to this business", nil)
					return
				}
			}
			user, err := s.CreateUser(req.Context(), restID, body)
			if err != nil {
				middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
				return
			}
			middleware.JSONSuccess(w, http.StatusCreated, user, nil)
		})

		pr.Patch("/users/{id}/status", func(w http.ResponseWriter, req *http.Request) {
			restID := middleware.GetRestaurantID(req.Context())
			claims := middleware.GetUserClaims(req.Context())
			targetID := chi.URLParam(req, "id")
			var body struct {
				IsActive bool `json:"is_active"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
				return
			}
			if targetID == claims.UserID {
				middleware.JSONError(w, http.StatusForbidden, "SELF_MODIFICATION_BLOCKED", "You cannot disable your own account", nil)
				return
			}
			var targetRole string
			if err := s.pool.QueryRow(req.Context(), "SELECT role FROM users WHERE id = $1 AND restaurant_id = $2", targetID, restID).Scan(&targetRole); err != nil {
				middleware.JSONError(w, http.StatusNotFound, "USER_NOT_FOUND", "User was not found", nil)
				return
			}
			if targetRole == "owner" || targetRole == "super_admin" || (claims.Role == "admin" && targetRole == "admin") {
				middleware.JSONError(w, http.StatusForbidden, "PROTECTED_ACCOUNT", "This account cannot be modified by your role", nil)
				return
			}
			_, err := s.pool.Exec(req.Context(), "UPDATE users SET is_active = $1 WHERE id = $2 AND restaurant_id = $3", body.IsActive, targetID, restID)
			if err != nil {
				middleware.JSONError(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error(), nil)
				return
			}
			s.audit.Log(req.Context(), "TOGGLE_USER_STATUS", "user", &targetID, nil, body, "", "")
			middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{"id": targetID, "is_active": body.IsActive}, nil)
		})
	})
}
