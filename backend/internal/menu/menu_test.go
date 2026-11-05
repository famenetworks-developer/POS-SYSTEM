package menu

import (
	"testing"

	"restoflow/internal/models"
)

func TestRedactPurchaseCosts(t *testing.T) {
	base := []models.MenuItem{{ID: "product-1", CostPriceMinor: 12500}}

	cashierItems := append([]models.MenuItem(nil), base...)
	cashierItems = redactPurchaseCosts("cashier", cashierItems)
	if cashierItems[0].CostPriceMinor != 0 {
		t.Fatalf("cashier cost = %d, want 0", cashierItems[0].CostPriceMinor)
	}

	managerItems := append([]models.MenuItem(nil), base...)
	managerItems = redactPurchaseCosts("manager", managerItems)
	if managerItems[0].CostPriceMinor != 12500 {
		t.Fatalf("manager cost = %d, want 12500", managerItems[0].CostPriceMinor)
	}
}
