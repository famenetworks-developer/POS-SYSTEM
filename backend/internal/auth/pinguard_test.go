package auth

import (
	"testing"
	"time"
)

func TestPINGuardLocksAfterFiveFailures(t *testing.T) {
	g := newPINGuard()
	now := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
	for i := 1; i < maxPINFailures; i++ {
		if g.recordFailure("b1", now.Add(time.Duration(i)*time.Second)) {
			t.Fatalf("locked after only %d failures", i)
		}
	}
	if !g.recordFailure("b1", now.Add(10*time.Second)) {
		t.Fatal("expected a lockout on the 5th failure")
	}
	if g.blockedFor("b1", now.Add(time.Minute)) == 0 {
		t.Fatal("branch should be blocked")
	}
	if g.blockedFor("b2", now.Add(time.Minute)) != 0 {
		t.Fatal("other branches must not be blocked")
	}
	if g.blockedFor("b1", now.Add(10*time.Second+pinLockout+time.Second)) != 0 {
		t.Fatal("block should end after the lockout period")
	}
}

func TestPINGuardForgetsOldFailures(t *testing.T) {
	g := newPINGuard()
	now := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
	for i := 0; i < maxPINFailures-1; i++ {
		g.recordFailure("b1", now)
	}
	// Failures older than the window no longer count.
	if g.recordFailure("b1", now.Add(pinWindow+time.Minute)) {
		t.Fatal("old failures should have expired")
	}
}
