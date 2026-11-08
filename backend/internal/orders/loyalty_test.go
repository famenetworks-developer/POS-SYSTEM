package orders

import "testing"

func TestCalculateLoyaltyRedemption(t *testing.T) {
	rule := loyaltyRule{PointsPerUnit: 100, DiscountMinorPerUnit: 5000, AutoRedeem: true}
	tests := []struct {
		name         string
		points       int
		amountMinor  int64
		rule         loyaltyRule
		wantPoints   int
		wantDiscount int64
	}{
		{"complete units", 250, 20000, rule, 200, 10000},
		{"partial unit is retained", 99, 20000, rule, 0, 0},
		{"invoice cap retains excess points", 1000, 12000, rule, 200, 10000},
		{"amount after coupon is used", 300, 5000, rule, 100, 5000},
		{"too little payable amount", 300, 4999, rule, 0, 0},
		{"disabled", 300, 20000, loyaltyRule{PointsPerUnit: 100, DiscountMinorPerUnit: 5000, AutoRedeem: false}, 0, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			points, discount := calculateLoyaltyRedemption(test.points, test.amountMinor, test.rule)
			if points != test.wantPoints || discount != test.wantDiscount {
				t.Fatalf("got (%d, %d), want (%d, %d)", points, discount, test.wantPoints, test.wantDiscount)
			}
		})
	}
}
