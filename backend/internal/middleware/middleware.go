package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

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
			allowed = roleAllowed(claims.Role, "owner")
		case path == "/reports/profit-loss" || path == "/audit-logs":
			allowed = roleAllowed(claims.Role, "owner", "accountant")
		case path == "/reports/dashboard" || path == "/reports/exceptions":
			allowed = roleAllowed(claims.Role, "owner", "manager")
		case path == "/expenses" || strings.HasPrefix(path, "/expenses/"):
			allowed = roleAllowed(claims.Role, "owner", "accountant")
		case path == "/settings" || path == "/restaurant" || path == "/branches":
			allowed = !write || roleAllowed(claims.Role, "owner")
		case strings.HasPrefix(path, "/inventory-items") || strings.HasPrefix(path, "/stock") || strings.HasPrefix(path, "/recipes"):
			if write {
				allowed = roleAllowed(claims.Role, "owner", "inventory_manager")
			} else {
				allowed = roleAllowed(claims.Role, "owner", "manager", "inventory_manager")
			}
		case strings.HasPrefix(path, "/suppliers") || strings.HasPrefix(path, "/purchase-orders"):
			if write {
				allowed = roleAllowed(claims.Role, "owner", "purchase_manager")
			} else {
				allowed = roleAllowed(claims.Role, "owner", "manager", "purchase_manager")
			}
		case path == "/categories" || strings.HasPrefix(path, "/items"):
			allowed = !write || roleAllowed(claims.Role, "owner", "inventory_manager")
		case strings.HasPrefix(path, "/orders"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
			if strings.HasSuffix(path, "/refund") || strings.HasSuffix(path, "/cancel") {
				allowed = roleAllowed(claims.Role, "owner", "manager")
			}
		case strings.HasPrefix(path, "/shifts"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
		case strings.HasPrefix(path, "/table"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier") && (!write || roleAllowed(claims.Role, "owner", "manager"))
		case strings.HasPrefix(path, "/deliveries") || strings.HasPrefix(path, "/kots"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "delivery_staff")
		case strings.HasPrefix(path, "/customers"):
			allowed = roleAllowed(claims.Role, "owner", "manager", "cashier")
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
