package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv           string
	Port             string
	DatabaseURL      string
	JWTAccessSecret  string
	JWTRefreshSecret string
	CorsOrigins      []string
	DefaultCurrency  string
	DefaultTimezone  string
	MigrationsDir    string
	SeedDemoData     bool
}

func Load() (*Config, error) {
	_ = godotenv.Load("../.env")
	_ = godotenv.Load(".env")

	appEnv := getEnvDefault("APP_ENV", "development")

	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = os.Getenv("PORT")
	}
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		if strings.EqualFold(appEnv, "production") {
			return nil, fmt.Errorf("DATABASE_URL is required in production")
		}
		dbURL = "postgres://postgres:postgres@localhost:5433/restoflow?sslmode=disable"
	}

	accessSecret := os.Getenv("JWT_ACCESS_SECRET")
	if accessSecret == "" {
		accessSecret = "restoflow-super-secret-jwt-access-key-2026"
	}

	refreshSecret := os.Getenv("JWT_REFRESH_SECRET")
	if refreshSecret == "" {
		refreshSecret = "restoflow-super-secret-jwt-refresh-key-2026"
	}

	corsStr := os.Getenv("CORS_ORIGINS")
	var origins []string
	if corsStr != "" {
		for _, origin := range strings.Split(corsStr, ",") {
			if trimmed := strings.TrimSpace(origin); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
	} else {
		origins = []string{"*"}
	}

	currency := os.Getenv("DEFAULT_CURRENCY")
	if currency == "" {
		currency = "BDT"
	}

	tz := os.Getenv("DEFAULT_TIMEZONE")
	if tz == "" {
		tz = "Asia/Dhaka"
	}

	seedDefault := !strings.EqualFold(appEnv, "production")
	seedDemoData, err := strconv.ParseBool(getEnvDefault("SEED_DEMO_DATA", strconv.FormatBool(seedDefault)))
	if err != nil {
		return nil, fmt.Errorf("SEED_DEMO_DATA must be true or false")
	}

	cfg := &Config{
		AppEnv:           appEnv,
		Port:             port,
		DatabaseURL:      dbURL,
		JWTAccessSecret:  accessSecret,
		JWTRefreshSecret: refreshSecret,
		CorsOrigins:      origins,
		DefaultCurrency:  currency,
		DefaultTimezone:  tz,
		MigrationsDir:    getEnvDefault("MIGRATIONS_DIR", "migrations"),
		SeedDemoData:     seedDemoData,
	}

	if strings.EqualFold(cfg.AppEnv, "production") {
		accessLower := strings.ToLower(cfg.JWTAccessSecret)
		refreshLower := strings.ToLower(cfg.JWTRefreshSecret)
		if len(cfg.JWTAccessSecret) < 32 || strings.Contains(accessLower, "change") || strings.Contains(accessLower, "replace") || strings.Contains(accessLower, "example") || cfg.JWTAccessSecret == "restoflow-super-secret-jwt-access-key-2026" {
			return nil, fmt.Errorf("JWT_ACCESS_SECRET must be a unique production secret of at least 32 characters")
		}
		if len(cfg.JWTRefreshSecret) < 32 || strings.Contains(refreshLower, "change") || strings.Contains(refreshLower, "replace") || strings.Contains(refreshLower, "example") || cfg.JWTRefreshSecret == "restoflow-super-secret-jwt-refresh-key-2026" {
			return nil, fmt.Errorf("JWT_REFRESH_SECRET must be a unique production secret of at least 32 characters")
		}
	}

	return cfg, nil
}

func getEnvDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
