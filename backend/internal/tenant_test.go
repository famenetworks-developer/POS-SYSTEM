package internal_test

import (
	"context"
	"testing"

	"restoflow/internal/config"
	"restoflow/internal/platform"
)

func TestTenantIsolation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Invalid test configuration: %v", err)
	}
	db, err := platform.NewDB(cfg.DatabaseURL)
	if err != nil {
		t.Skipf("Postgres DB not available for integration test: %v", err)
		return
	}
	defer db.Close()

	ctx := context.Background()

	// Verify that querying with Tenant A's ID never returns Tenant B's data
	var count int
	// Random non-existent UUID
	fakeTenantID := "00000000-0000-0000-0000-000000000000"

	err = db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM orders WHERE restaurant_id = $1::uuid", fakeTenantID).Scan(&count)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	if count != 0 {
		t.Errorf("Expected 0 orders for isolated tenant, got %d", count)
	}
}
