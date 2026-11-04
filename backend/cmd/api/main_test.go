package main

import (
	"testing"

	"restoflow/internal/middleware"
)

func TestJWTParseValidatesSignatureAndClaims(t *testing.T) {
	const accessSecret = "test-access-secret-that-is-long-enough-123"
	accessToken, _, err := middleware.GenerateTokens(
		"user-id",
		"restaurant-id",
		"user@example.com",
		"cashier",
		0,
		accessSecret,
		"test-refresh-secret-that-is-long-enough-456",
	)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	claims := &middleware.UserClaims{}
	valid, err := jwtParse(accessToken, claims, accessSecret)
	if err != nil || !valid {
		t.Fatalf("expected valid token, valid=%v err=%v", valid, err)
	}
	if claims.UserID != "user-id" || claims.RestaurantID != "restaurant-id" {
		t.Fatalf("claims were not parsed: %#v", claims)
	}

	valid, _ = jwtParse(accessToken, &middleware.UserClaims{}, "wrong-secret")
	if valid {
		t.Fatal("token signed with another secret must be rejected")
	}

	valid, _ = jwtParse("", &middleware.UserClaims{}, accessSecret)
	if valid {
		t.Fatal("empty token must be rejected")
	}
}
