package main

import (
	"context"
	"log"
	"time"

	"restoflow/internal/config"
	"restoflow/internal/platform"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[Worker] Invalid configuration: %v", err)
	}
	log.Printf("[Worker] Starting RestoFlow background worker...")

	db, err := platform.NewDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[Worker] Failed to connect to DB: %v", err)
	}
	defer db.Close()

	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	// Initial run
	runJobs(db)

	for range ticker.C {
		runJobs(db)
	}
}

func runJobs(db *platform.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	log.Println("[Worker] Running scheduled maintenance jobs...")

	// 1. Subscription grace period check
	res, err := db.Pool.Exec(ctx, `
		UPDATE subscriptions
		SET status = 'past_due'
		WHERE status = 'trial' AND trial_ends_at < NOW()
	`)
	if err == nil {
		log.Printf("[Worker] Subscription check completed: %d updated", res.RowsAffected())
	}

	// 2. Low-stock scan
	rows, err := db.Pool.Query(ctx, `
		SELECT i.name, COALESCE(bs.quantity, 0), i.min_level
		FROM inventory_items i
		JOIN branch_stock bs ON i.id = bs.inventory_item_id
		WHERE bs.quantity <= i.min_level
	`)
	if err == nil {
		defer rows.Close()
		lowCount := 0
		for rows.Next() {
			lowCount++
		}
		log.Printf("[Worker] Low stock audit completed: %d items below minimum", lowCount)
	}
}
