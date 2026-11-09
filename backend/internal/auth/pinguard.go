package auth

import (
	"sync"
	"time"
)

// PIN login attempt limit: after maxPINFailures wrong PINs at one branch within pinWindow,
// PIN login at that branch is blocked for pinLockout. A 4-digit PIN has only 10,000
// possibilities, so without a limit it can be guessed in minutes. Email login is unaffected.
const (
	maxPINFailures = 5
	pinWindow      = 15 * time.Minute
	pinLockout     = 15 * time.Minute
)

type pinGuard struct {
	mu       sync.Mutex
	failures map[string][]time.Time // branch ID -> times of recent wrong PINs
	locked   map[string]time.Time   // branch ID -> blocked until
}

func newPINGuard() *pinGuard {
	return &pinGuard{failures: map[string][]time.Time{}, locked: map[string]time.Time{}}
}

// blockedFor returns how long PIN login at the branch is still blocked (0 = not blocked).
func (g *pinGuard) blockedFor(branchID string, now time.Time) time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	if until, ok := g.locked[branchID]; ok {
		if now.Before(until) {
			return until.Sub(now)
		}
		delete(g.locked, branchID)
	}
	return 0
}

// recordFailure notes a wrong PIN and starts a lockout once the limit is reached.
// It returns true when this failure triggered the lockout.
func (g *pinGuard) recordFailure(branchID string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	recent := g.failures[branchID][:0]
	for _, t := range g.failures[branchID] {
		if now.Sub(t) < pinWindow {
			recent = append(recent, t)
		}
	}
	recent = append(recent, now)
	if len(recent) >= maxPINFailures {
		g.locked[branchID] = now.Add(pinLockout)
		delete(g.failures, branchID)
		return true
	}
	g.failures[branchID] = recent
	return false
}
