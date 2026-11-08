package platform

import (
	"context"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

// rowQuerier is satisfied by *pgxpool.Pool and pgx.Tx.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// DefaultTimezone is used when a store has no valid time zone set.
func DefaultTimezone() string {
	if tz := os.Getenv("DEFAULT_TIMEZONE"); tz != "" {
		if _, err := time.LoadLocation(tz); err == nil {
			return tz
		}
	}
	return "Asia/Dhaka"
}

// StoreLocation returns the store's time zone (Settings → Time zone, stored in
// restaurants.timezone). Business dates such as the invoice day, "today" on the
// dashboard and report periods are all worked out in this zone, never in the
// server's or database's own clock.
func StoreLocation(ctx context.Context, q rowQuerier, restID string) *time.Location {
	var tz string
	_ = q.QueryRow(ctx, "SELECT COALESCE(timezone, '') FROM restaurants WHERE id::text = $1", restID).Scan(&tz)
	if loc, err := time.LoadLocation(tz); err == nil && tz != "" {
		return loc
	}
	loc, _ := time.LoadLocation(DefaultTimezone())
	return loc
}

// StartOfDay is local midnight of t's day in loc.
func StartOfDay(t time.Time, loc *time.Location) time.Time {
	t = t.In(loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
}

// StartOfMonth is local midnight on the 1st of t's month in loc.
func StartOfMonth(t time.Time, loc *time.Location) time.Time {
	t = t.In(loc)
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, loc)
}
