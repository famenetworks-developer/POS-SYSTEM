package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequireAppAccess(t *testing.T) {
	tests := []struct {
		name, role, method, path string
		want                     int
	}{
		{"owner dashboard", "owner", http.MethodGet, "/api/v1/reports/dashboard", http.StatusNoContent},
		{"manager dashboard", "manager", http.MethodGet, "/api/v1/reports/dashboard", http.StatusNoContent},
		{"cashier cannot see dashboard", "cashier", http.MethodGet, "/api/v1/reports/dashboard", http.StatusForbidden},
		{"accountant profit loss", "accountant", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusNoContent},
		{"manager cannot see profit loss", "manager", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusForbidden},
		{"inventory can adjust stock", "inventory_manager", http.MethodPost, "/api/v1/stock/adjust", http.StatusNoContent},
		{"manager inventory is read only", "manager", http.MethodPost, "/api/v1/stock/adjust", http.StatusForbidden},
		{"purchase can receive PO", "purchase_manager", http.MethodPost, "/api/v1/purchase-orders/abc/receive", http.StatusNoContent},
		{"cashier cannot refund", "cashier", http.MethodPost, "/api/v1/orders/abc/refund", http.StatusForbidden},
		{"manager must use approval workflow", "manager", http.MethodPost, "/api/v1/orders/abc/refund", http.StatusForbidden},
		{"owner manages staff", "owner", http.MethodPost, "/api/v1/users", http.StatusNoContent},
		{"system admin cannot read business staff", "super_admin", http.MethodGet, "/api/v1/users", http.StatusForbidden},
		{"system admin platform", "super_admin", http.MethodGet, "/api/v1/admin/restaurants", http.StatusNoContent},
		{"owner cannot enter platform", "owner", http.MethodGet, "/api/v1/admin/restaurants", http.StatusForbidden},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
			req := httptest.NewRequest(tt.method, tt.path, nil)
			ctx := context.WithValue(req.Context(), UserContextKey, &UserClaims{Role: tt.role, UserID: "user-1"})
			res := httptest.NewRecorder()
			RequireAppAccess(next).ServeHTTP(res, req.WithContext(ctx))
			if res.Code != tt.want {
				t.Fatalf("status = %d, want %d", res.Code, tt.want)
			}
		})
	}
}
