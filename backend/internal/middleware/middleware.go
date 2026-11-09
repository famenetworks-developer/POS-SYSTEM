package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EnforceBranchScope validates branch identifiers against server-side user
// assignments. It never accepts a frontend role or tenant assertion.
func EnforceBranchScope(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := GetUserClaims(r.Context())
			if claims == nil || roleAllowed(claims.Role, "owner", "admin", "accountant", "super_admin") {
				next.ServeHTTP(w, r)
				return
			}
			branchID := r.URL.Query().Get("branch_id")
			if branchID != "" {
				var allowed bool
				_ = pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM user_branches ub JOIN branches b ON b.id=ub.branch_id WHERE ub.user_id=$1 AND ub.branch_id::text=$2 AND b.restaurant_id::text=$3)`, claims.UserID, branchID, claims.RestaurantID).Scan(&allowed)
				if !allowed {
					JSONError(w, http.StatusForbidden, "BRANCH_FORBIDDEN", "This branch is not assigned to your account", nil)
					return
				}
			}
			parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1"), "/"), "/")
			if len(parts) >= 2 && parts[0] == "orders" {
				if _, err := uuid.Parse(parts[1]); err == nil {
					var allowed bool
					_ = pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM orders o WHERE o.id::text=$1 AND o.restaurant_id::text=$2 AND EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id::text=$3 AND ub.branch_id=o.branch_id) AND ($4<>'cashier' OR o.waiter_id::text=$3))`, parts[1], claims.RestaurantID, claims.UserID, claims.Role).Scan(&allowed)
					if !allowed {
						JSONError(w, 403, "ORDER_SCOPE_FORBIDDEN", "This order is outside your assigned scope", nil)
						return
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func permissionForRequest(r *http.Request) []string {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	write := r.Method != http.MethodGet && r.Method != http.MethodHead
	switch {
	case strings.HasPrefix(path, "/admin/"):
		return []string{"platform.manage"}
	case strings.HasPrefix(path, "/users"):
		return []string{"users.manage"}
	case path == "/reports/profit-loss":
		return []string{"reports.financial"}
	case path == "/reports/dashboard" || path == "/reports/exceptions":
		return []string{"reports.branch_sales", "reports.financial"}
	case path == "/audit-logs":
		return []string{"audit.view"}
	case path == "/settings" || path == "/restaurant":
		if write {
			return []string{"settings.manage"}
		}
	case strings.HasPrefix(path, "/inventory-items") || strings.HasPrefix(path, "/stock") || strings.HasPrefix(path, "/recipes"):
		if write {
			return []string{"inventory.adjust"}
		}
		return []string{"inventory.view"}
	case strings.HasPrefix(path, "/suppliers"):
		if write {
			return []string{"suppliers.manage"}
		}
		return []string{"purchases.view"}
	case strings.HasPrefix(path, "/purchase-orders"):
		if write {
			return []string{"purchases.create"}
		}
		return []string{"purchases.view"}
	case strings.HasSuffix(path, "/refund-request"):
		return []string{"refunds.request"}
	case strings.HasSuffix(path, "/discount-request"):
		return []string{"discounts.request"}
	case strings.HasSuffix(path, "/void-request"):
		return []string{"voids.request"}
	case strings.HasSuffix(path, "/refund"):
		return []string{"refunds.approve"}
	case strings.HasPrefix(path, "/orders"):
		if write {
			return []string{"sales.create", "refunds.approve", "discounts.approve", "voids.approve"}
		}
		return []string{"sales.view_own", "sales.view_branch", "sales.view_all"}
	case strings.HasPrefix(path, "/shifts"):
		return []string{"shifts.own", "shifts.manage"}
	case strings.HasPrefix(path, "/table"):
		if write {
			return []string{"registers.manage"}
		}
	case strings.HasPrefix(path, "/customers"):
		return []string{"customers.manage"}
	case strings.HasPrefix(path, "/deliveries") || strings.HasPrefix(path, "/kots"):
		return []string{"fulfillment.manage"}
	}
	return nil
}

// RequirePermission resolves role grants from the database on every protected
// request, so token claims cannot broaden access after a role is changed.
func RequirePermission(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			needed := permissionForRequest(r)
			if len(needed) == 0 {
				next.ServeHTTP(w, r)
				return
			}
			claims := GetUserClaims(r.Context())
			var role string
			var active bool
			if err := pool.QueryRow(r.Context(), "SELECT role,is_active FROM users WHERE id=$1", claims.UserID).Scan(&role, &active); err != nil || !active {
				JSONError(w, http.StatusUnauthorized, "ACCOUNT_INACTIVE", "Account is not active", nil)
				return
			}
			var allowed bool
			_ = pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM role_permissions WHERE role=$1 AND permission_code=ANY($2))", role, needed).Scan(&allowed)
			if !allowed {
				JSONError(w, http.StatusForbidden, "PERMISSION_DENIED", "Your role does not include the required permission", map[string]interface{}{"required_any": needed})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func roleAllowed(role string, roles ...string) bool {
	for _, allowed := range roles {
		if role == allowed {
			return true
		}
	}
	return false
}

// RequireAppAccess is the API-side RBAC boundary. UI visibility is only a
// convenience; this middleware is the authority for protected business data.
func RequireAppAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		claims := GetUserClaims(r.Context())
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		write := r.Method != http.MethodGet && r.Method != http.MethodHead
		allowed := true

		switch {
		case strings.HasPrefix(path, "/admin/"):
			allowed = roleAllowed(claims.Role, "super_admin")
		case path == "/users" || strings.HasPrefix(path, "/users/"):
			allowed = roleAllowed(claims.Role, "owner", "admin")
		case path == "/reports/profit-loss":
			allowed = roleAllowed(claims.Role, "owner", "accountant")
		case path == "/audit-logs":
			allowed = roleAllowed(claims.Role, "owner", "admin", "accountant")
		case path == "/reports/dashboard" || path == "/reports/exceptions":
			allowed = roleAllowed(claims.Role, "owner", "manager")
		case path == "/expenses" || strings.HasPrefix(path, "/expenses/"):
			allowed = roleAllowed(claims.Role, "owner", "accountant")
		case path == "/restaurant/timezone":
			// Managers may set the store time zone, but not the other store settings.
			allowed = roleAllowed(claims.Role, "owner", "admin", "manager")
		case path == "/settings":
			allowed = roleAllowed(claims.Role, "owner", "admin")
		case path == "/restaurant" || path == "/branches":
			allowed = !write || roleAllowed(claims.Role, "owner", "admin")
		case strings.HasPrefix(path, "/inventory-items") || strings.HasPrefix(path, "/stock") || strings.HasPrefix(path, "/recipes"):
			if write {
				allowed = roleAllowed(claims.Role, "owner", "inventory_manager")
			} else {
				allowed = roleAllowed(claims.Role, "owner", "manager", "inventory_manager", "purchase_manager")
			}
		case strings.HasPrefix(path, "/suppliers") || strings.HasPrefix(path, "/purchase-orders"):
			if write {
				allowed = roleAllowed(claims.Role, "owner", "purchase_manager")
			} else {
				allowed = roleAllowed(claims.Role, "owner", "manager", "purchase_manager")
			}
		case path == "/items/export":
			allowed = roleAllowed(claims.Role, "owner", "manager", "inventory_manager", "purchase_manager")
		case path == "/categories" || strings.HasPrefix(path, "/items"):
			allowed = (!write && roleAllowed(claims.Role, "owner", "manager", "cashier", "inventory_manager", "purchase_manager")) || (write && roleAllowed(claims.Role, "owner", "manager", "inventory_manager"))
		case strings.HasPrefix(path, "/orders"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
			if strings.HasSuffix(path, "/refund") || strings.HasSuffix(path, "/cancel") {
				allowed = roleAllowed(claims.Role, "owner", "manager")
			}
		case strings.HasPrefix(path, "/shifts"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
		case strings.HasPrefix(path, "/table"):
			allowed = roleAllowed(claims.Role, "owner", "admin", "manager", "cashier") && (!write || roleAllowed(claims.Role, "owner", "admin", "manager"))
		case strings.HasPrefix(path, "/deliveries") || strings.HasPrefix(path, "/kots"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "delivery_staff")
		case strings.HasPrefix(path, "/customers"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
		case strings.HasPrefix(path, "/pos/basket"):
			// The shared checkout basket belongs to cashiers only.
			allowed = roleAllowed(claims.Role, "cashier")
		case strings.HasPrefix(path, "/sync") || path == "/pos/bootstrap" || strings.HasPrefix(path, "/promotions"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
		}

		if !allowed {
			JSONError(w, http.StatusForbidden, "FORBIDDEN", "This position is not permitted to perform this action", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type contextKey string

const (
	UserContextKey      contextKey = "user_claims"
	RequestIDContextKey contextKey = "request_id"
)

type UserClaims struct {
	UserID           string  `json:"user_id"`
	RestaurantID     string  `json:"restaurant_id"`
	Email            string  `json:"email"`
	Role             string  `json:"role"`
	DiscountLimitPct float64 `json:"discount_limit_pct"`
	jwt.RegisteredClaims
}

type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

func JSONError(w http.ResponseWriter, status int, code, message string, details interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{
		Error: ErrorDetail{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}

func JSONSuccess(w http.ResponseWriter, status int, data interface{}, meta interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := map[string]interface{}{
		"data": data,
	}
	if meta != nil {
		resp["meta"] = meta
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = uuid.New().String()
		}
		w.Header().Set("X-Request-ID", reqID)
		ctx := context.WithValue(r.Context(), RequestIDContextKey, reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func Auth(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			tokenStr := ""

			if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			} else if queryToken := r.URL.Query().Get("token"); queryToken != "" {
				// Allow token in query params for WebSockets
				tokenStr = queryToken
			}

			if tokenStr == "" {
				JSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authorization token", nil)
				return
			}

			claims := &UserClaims{}
			token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
				if t.Method != jwt.SigningMethodHS256 {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				JSONError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Invalid or expired token", nil)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireRole(allowedRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(UserContextKey).(*UserClaims)
			if !ok || claims == nil {
				JSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", nil)
				return
			}

			// Super Admin has bypass for all actions
			if claims.Role == "super_admin" {
				next.ServeHTTP(w, r)
				return
			}

			for _, role := range allowedRoles {
				if claims.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			JSONError(w, http.StatusForbidden, "FORBIDDEN", "Insufficient permissions for role: "+claims.Role, nil)
		})
	}
}

func GetUserClaims(ctx context.Context) *UserClaims {
	claims, ok := ctx.Value(UserContextKey).(*UserClaims)
	if !ok {
		return nil
	}
	return claims
}

func GetRestaurantID(ctx context.Context) string {
	claims := GetUserClaims(ctx)
	if claims != nil {
		return claims.RestaurantID
	}
	return ""
}

func GenerateTokens(userID, restaurantID, email, role string, discountLimit float64, accessSecret, refreshSecret string) (string, string, error) {
	accessClaims := UserClaims{
		UserID:           userID,
		RestaurantID:     restaurantID,
		Email:            email,
		Role:             role,
		DiscountLimitPct: discountLimit,
		RegisteredClaims: jwt.RegisteredClaims{
			// A unique ID makes every token different, even two issued in the same second.
			ID:        uuid.New().String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString([]byte(accessSecret))
	if err != nil {
		return "", "", err
	}

	refreshClaims := UserClaims{
		UserID:           userID,
		RestaurantID:     restaurantID,
		Email:            email,
		Role:             role,
		DiscountLimitPct: discountLimit,
		RegisteredClaims: jwt.RegisteredClaims{
			// Unique per token: refresh tokens are stored and revoked by hash, so two refresh
			// tokens issued in the same second must never be identical.
			ID:        uuid.New().String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	refreshToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString([]byte(refreshSecret))
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}
