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
		// Owner: complete tenant/business control, but never the platform console.
		{"owner dashboard", "owner", http.MethodGet, "/api/v1/reports/dashboard", http.StatusNoContent},
		{"owner profit and loss", "owner", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusNoContent},
		{"owner manages staff", "owner", http.MethodPost, "/api/v1/users", http.StatusNoContent},
		{"owner cannot enter platform", "owner", http.MethodGet, "/api/v1/admin/restaurants", http.StatusForbidden},

		// Manager: daily operations, product/pricing, shifts, reports and approvals.
		{"manager dashboard", "manager", http.MethodGet, "/api/v1/reports/dashboard", http.StatusNoContent},
		{"manager manages products", "manager", http.MethodPost, "/api/v1/items", http.StatusNoContent},
		{"manager manages shifts", "manager", http.MethodGet, "/api/v1/shifts", http.StatusNoContent},
		{"manager approves refund", "manager", http.MethodPost, "/api/v1/orders/abc/refund", http.StatusNoContent},
		{"manager cannot see profit loss", "manager", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusForbidden},
		{"manager cannot change settings", "manager", http.MethodPatch, "/api/v1/settings", http.StatusForbidden},

		// Cashier: checkout, customers and own shift; no confidential back office data.
		{"cashier processes sales", "cashier", http.MethodPost, "/api/v1/orders", http.StatusNoContent},
		{"cashier uses own shifts", "cashier", http.MethodGet, "/api/v1/shifts", http.StatusNoContent},
		{"cashier cannot see dashboard", "cashier", http.MethodGet, "/api/v1/reports/dashboard", http.StatusForbidden},
		{"cashier cannot see profit loss", "cashier", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusForbidden},
		{"cashier cannot adjust inventory", "cashier", http.MethodPost, "/api/v1/stock/adjust", http.StatusForbidden},
		{"cashier cannot manage staff", "cashier", http.MethodGet, "/api/v1/users", http.StatusForbidden},
		{"cashier cannot read system settings", "cashier", http.MethodGet, "/api/v1/settings", http.StatusForbidden},
		{"cashier cannot export purchase costs", "cashier", http.MethodGet, "/api/v1/items/export", http.StatusForbidden},

		// Inventory: catalogue and stock only.
		{"accountant profit loss", "accountant", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusNoContent},
		{"inventory can adjust stock", "inventory_manager", http.MethodPost, "/api/v1/stock/adjust", http.StatusNoContent},
		{"inventory manages products", "inventory_manager", http.MethodPost, "/api/v1/items", http.StatusNoContent},
		{"inventory cannot see profit", "inventory_manager", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusForbidden},
		{"inventory cannot see cash shifts", "inventory_manager", http.MethodGet, "/api/v1/shifts", http.StatusForbidden},
		{"manager inventory is read only", "manager", http.MethodPost, "/api/v1/stock/adjust", http.StatusForbidden},

		// Purchase: suppliers, purchase orders and receiving; no sales/cash controls.
		{"purchase can receive PO", "purchase_manager", http.MethodPost, "/api/v1/purchase-orders/abc/receive", http.StatusNoContent},
		{"purchase manages suppliers", "purchase_manager", http.MethodPost, "/api/v1/suppliers", http.StatusNoContent},
		{"purchase cannot see cash shifts", "purchase_manager", http.MethodGet, "/api/v1/shifts", http.StatusForbidden},
		{"purchase cannot see profit", "purchase_manager", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusForbidden},

		// Tenant admin: software configuration, identities and terminals, not business finance.
		{"admin manages users", "admin", http.MethodPost, "/api/v1/users", http.StatusNoContent},
		{"admin manages settings", "admin", http.MethodPatch, "/api/v1/settings", http.StatusNoContent},
		{"admin manages terminals", "admin", http.MethodPost, "/api/v1/tables", http.StatusNoContent},
		{"admin cannot see dashboard", "admin", http.MethodGet, "/api/v1/reports/dashboard", http.StatusForbidden},
		{"admin cannot see profit", "admin", http.MethodGet, "/api/v1/reports/profit-loss", http.StatusForbidden},
		{"admin cannot process sales", "admin", http.MethodPost, "/api/v1/orders", http.StatusForbidden},
		{"admin cannot adjust inventory", "admin", http.MethodPost, "/api/v1/stock/adjust", http.StatusForbidden},
		{"admin cannot read product costs", "admin", http.MethodGet, "/api/v1/items", http.StatusForbidden},
		{"admin cannot read supplier finances", "admin", http.MethodGet, "/api/v1/suppliers", http.StatusForbidden},
		{"tenant admin cannot enter platform", "admin", http.MethodGet, "/api/v1/admin/restaurants", http.StatusForbidden},

		{"cashier cannot refund", "cashier", http.MethodPost, "/api/v1/orders/abc/refund", http.StatusForbidden},
		{"system admin cannot read business staff", "super_admin", http.MethodGet, "/api/v1/users", http.StatusForbidden},
		{"system admin platform", "super_admin", http.MethodGet, "/api/v1/admin/restaurants", http.StatusNoContent},
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
