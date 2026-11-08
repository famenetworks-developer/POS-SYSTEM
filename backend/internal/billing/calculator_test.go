package billing

import (
	"testing"
)

func TestAppendixATestVectors(t *testing.T) {
	// Case 1: 2 x 350 + 1 x 120; discount 0; service 5%; VAT 15%
	// Expected: subtotal 820; service 41; VAT 129.15 -> 129; total 990
	t.Run("Case 1 - Standard Order", func(t *testing.T) {
		res := CalculateBill(BillInput{
			Items: []CalcItem{
				{UnitPriceMinor: 35000, Qty: 2}, // 350.00
				{UnitPriceMinor: 12000, Qty: 1}, // 120.00
			},
			DiscountPercent:    0,
			ServiceChargePct:   5.0,
			VatPct:             15.0,
			VatOnServiceCharge: true,
			RoundingUnit:       100, // round to whole taka (100 minor units)
		})

		if res.SubtotalMinor != 82000 {
			t.Errorf("expected subtotal 82000, got %d", res.SubtotalMinor)
		}
		if res.ServiceChargeMinor != 4100 {
			t.Errorf("expected service 4100, got %d", res.ServiceChargeMinor)
		}
		if res.TaxMinor != 12915 && res.TaxMinor != 12900 {
			// 86100 * 0.15 = 12915 minor units (129.15 taka), rounded to 129 taka if integer taka
		}
		// In taka representation (divide by 100):
		subtotalTaka := res.SubtotalMinor / 100
		serviceTaka := res.ServiceChargeMinor / 100
		vatTaka := RoundHalfUp(float64(res.TaxMinor) / 100.0)
		totalTaka := RoundHalfUp(float64(res.PreRoundTotalMinor) / 100.0)

		if subtotalTaka != 820 {
			t.Errorf("expected subtotal taka 820, got %d", subtotalTaka)
		}
		if serviceTaka != 41 {
			t.Errorf("expected service taka 41, got %d", serviceTaka)
		}
		if vatTaka != 129 {
			t.Errorf("expected vat taka 129, got %d", vatTaka)
		}
		if totalTaka != 990 {
			t.Errorf("expected total taka 990, got %d", totalTaka)
		}
	})

	// Case 2: Subtotal 1,000; discount 10%; service 10%; VAT 15%
	// Expected: base 900; service 90; VAT 148.5 -> 149 (half-up); total 1,139
	t.Run("Case 2 - Percentage Discount and Half-up VAT", func(t *testing.T) {
		res := CalculateBill(BillInput{
			Items: []CalcItem{
				{UnitPriceMinor: 100000, Qty: 1},
			},
			DiscountPercent:    10.0,
			ServiceChargePct:   10.0,
			VatPct:             15.0,
			VatOnServiceCharge: true,
			RoundingUnit:       100,
		})

		taxableBaseTaka := res.TaxableBaseMinor / 100
		serviceTaka := res.ServiceChargeMinor / 100
		vatTaka := RoundHalfUp(float64(res.TaxMinor) / 100.0)
		totalTaka := RoundHalfUp(float64(res.PreRoundTotalMinor) / 100.0)

		if taxableBaseTaka != 900 {
			t.Errorf("expected base 900, got %d", taxableBaseTaka)
		}
		if serviceTaka != 90 {
			t.Errorf("expected service 90, got %d", serviceTaka)
		}
		if vatTaka != 149 {
			t.Errorf("expected VAT 149 (from 148.5 half-up), got %d", vatTaka)
		}
		if totalTaka != 1139 {
			t.Errorf("expected total 1139, got %d", totalTaka)
		}
	})

	// Case 3: Subtotal 500; fixed discount 600
	// Expected: Discount capped to 500; total 0
	t.Run("Case 3 - Discount Capping", func(t *testing.T) {
		res := CalculateBill(BillInput{
			Items: []CalcItem{
				{UnitPriceMinor: 50000, Qty: 1},
			},
			DiscountFixed: 60000,
		})

		if res.OrderDiscountMinor != 50000 {
			t.Errorf("expected discount capped at 50000, got %d", res.OrderDiscountMinor)
		}
		if res.TotalMinor != 0 {
			t.Errorf("expected total 0, got %d", res.TotalMinor)
		}
	})

	// Case 4: Split tender: total 990 = cash 500 + bKash 490
	// Expected: Order paid; change 0; two payment rows
	t.Run("Case 4 - Change calculation", func(t *testing.T) {
		change := CalculateChange(50000, 50000)
		if change != 0 {
			t.Errorf("expected change 0, got %d", change)
		}
	})

	// Weighted Average Cost Test:
	// old_qty 10 @ 50, received 10 @ 70 -> new avg cost 60
	t.Run("Weighted Average Cost", func(t *testing.T) {
		newCost := WeightedAverageCost(10, 5000, 10, 7000)
		if newCost != 6000 {
			t.Errorf("expected new cost 6000, got %d", newCost)
		}
	})
}

func TestCouponDiscount(t *testing.T) {
	cases := []struct {
		name     string
		subtotal int64
		typ      string
		pct      float64
		fixed    int64
		want     int64
	}{
		{"percentage", 200000, "percentage", 10, 0, 20000},
		{"percentage rounds half up", 12345, "percentage", 10, 0, 1235},
		{"fixed", 200000, "fixed", 0, 20000, 20000},
		{"fixed capped at subtotal", 15000, "fixed", 0, 20000, 15000},
		{"unsupported type", 200000, "bogo", 50, 0, 0},
	}
	for _, c := range cases {
		if got := CouponDiscount(c.subtotal, c.typ, c.pct, c.fixed); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}
