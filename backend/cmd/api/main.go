package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/golang-jwt/jwt/v5"
	"restoflow/internal/audit"
	"restoflow/internal/auth"
	"restoflow/internal/config"
	"restoflow/internal/inventory"
	"restoflow/internal/menu"
	"restoflow/internal/middleware"
	"restoflow/internal/orders"
	"restoflow/internal/platform"
	"restoflow/internal/platform_admin"
	"restoflow/internal/reports"
	"restoflow/internal/scans"
	"restoflow/internal/seed"
	"restoflow/internal/settings"
	"restoflow/internal/shifts"
	"restoflow/internal/sync"
	"restoflow/internal/tables"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[Main] Invalid configuration: %v", err)
	}
	log.Printf("[Main] Starting RestoFlow API server in %s mode on port %s", cfg.AppEnv, cfg.Port)

	// Connect to Database
	db, err := platform.NewDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[Main] Failed to connect to DB: %v", err)
	}
	defer db.Close()

	if err := platform.ApplyMigrations(context.Background(), db.Pool, cfg.MigrationsDir); err != nil {
		log.Fatalf("[Main] Failed to apply database migrations: %v", err)
	}

	// Demo data is enabled by default only in development.
	if cfg.SeedDemoData {
		if err := seed.SeedDatabase(db.Pool); err != nil {
			log.Printf("[Main] Seed notice: %v", err)
		}
	}

	// Realtime WebSocket Hub
	wsHub := platform.NewWSHub()
	platform.ConfigureWSOrigins(cfg.CorsOrigins)
	go wsHub.Run()

	// Audit Service
	auditService := audit.NewAuditService(db.Pool)

	// Domain Services
	authService := auth.NewAuthService(db.Pool, cfg, auditService)
	settingsService := settings.NewSettingsService(db.Pool, auditService)
	menuService := menu.NewMenuService(db.Pool, wsHub, auditService)
	tableService := tables.NewTableService(db.Pool, wsHub, auditService)
	orderService := orders.NewOrderService(db.Pool, wsHub, auditService)
	shiftService := shifts.NewShiftService(db.Pool, wsHub, auditService)
	inventoryService := inventory.NewInventoryService(db.Pool, auditService)
	reportService := reports.NewReportService(db.Pool)
	platformAdminService := platform_admin.NewPlatformAdminService(db.Pool, cfg, auditService)
	syncService := sync.NewSyncService(db.Pool, orderService)
	scanService := scans.NewScanService(db.Pool, wsHub)

	// Root Router
	r := chi.NewRouter()

	// Global Middlewares
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(chimiddleware.Logger)
	allowCredentials := len(cfg.CorsOrigins) > 0 && !(len(cfg.CorsOrigins) == 1 && cfg.CorsOrigins[0] == "*")
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CorsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID", "Idempotency-Key"},
		ExposedHeaders:   []string{"Link", "X-Request-ID"},
		AllowCredentials: allowCredentials,
		MaxAge:           300,
	}))

	// Health and Readiness checks
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"status": "healthy", "service": "restoflow-api"}, nil)
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Pool.Ping(r.Context()); err != nil {
			middleware.JSONError(w, http.StatusServiceUnavailable, "NOT_READY", "Database unreachable", nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"status": "ready"}, nil)
	})

	// Realtime WebSocket route: /ws?token=JWT&branch_id=UUID
	r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
		tokenStr := req.URL.Query().Get("token")
		branchID := req.URL.Query().Get("branch_id")
		claims := &middleware.UserClaims{}
		if valid, err := jwtParse(tokenStr, claims, cfg.JWTAccessSecret); err != nil || !valid {
			middleware.JSONError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Invalid or expired token", nil)
			return
		}

		if branchID != "" {
			var branchAllowed bool
			err := db.Pool.QueryRow(req.Context(), `
				SELECT EXISTS (
					SELECT 1 FROM branches
					WHERE id::text = $1 AND restaurant_id::text = $2 AND is_active = TRUE
				)
			`, branchID, claims.RestaurantID).Scan(&branchAllowed)
			if err != nil || !branchAllowed {
				middleware.JSONError(w, http.StatusForbidden, "INVALID_BRANCH", "Branch is not available to this tenant", nil)
				return
			}
		}

		platform.ServeWS(wsHub, w, req, claims.RestaurantID, branchID, claims.UserID, claims.Role == "super_admin")
	})

	// API v1 Sub-Router
	r.Route("/api/v1", func(v1 chi.Router) {
		// Public auth endpoints
		authService.MountRoutes(v1)

		// Protected endpoints
		v1.Group(func(pr chi.Router) {
			pr.Use(middleware.Auth(cfg.JWTAccessSecret))

			settingsService.MountRoutes(pr)
			menuService.MountRoutes(pr)
			tableService.MountRoutes(pr)
			orderService.MountRoutes(pr)
			shiftService.MountRoutes(pr)
			inventoryService.MountRoutes(pr)
			reportService.MountRoutes(pr)
			platformAdminService.MountRoutes(pr)
			syncService.MountRoutes(pr)
			scanService.MountRoutes(pr)
		})
	})

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("[Main] REST & WebSocket server listening on http://localhost:%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Main] Server error: %v", err)
		}
	}()

	// Graceful shutdown handling
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[Main] Shutting down server gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[Main] Server shutdown forced: %v", err)
	}
	log.Println("[Main] Server exited cleanly.")
}

func jwtParse(tokenStr string, claims *middleware.UserClaims, secret string) (bool, error) {
	if tokenStr == "" {
		return false, jwt.ErrTokenMalformed
	}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(secret), nil
	})
	return err == nil && token.Valid, err
}
