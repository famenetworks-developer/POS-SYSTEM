package billing

import (
	"math"
)

type CalcItem struct {
	UnitPriceMinor int64
	AddonsTotal    int64
	Qty            float64
	LineDiscount   int64
}

type BillInput struct {
	Items             []CalcItem
	DiscountPercent   float64
	DiscountFixed     int64
	ServiceChargePct  float64
	VatPct            float64
	DeliveryFee       int64
	IsTaxInclusive    bool
	VatOnServiceCharge bool // whether VAT base includes service charge
	RoundingUnit      int64 // e.g. 1 or 100
}

type BillBreakdown struct {
	SubtotalMinor      int64 `json:"subtotal_minor"`
	OrderDiscountMinor int64 `json:"discount_minor"`
	TaxableBaseMinor   int64 `json:"taxable_base_minor"`
	ServiceChargeMinor int64 `json:"service_charge_minor"`
	TaxMinor           int64 `json:"tax_minor"`
	DeliveryFeeMinor   int64 `json:"delivery_fee_minor"`
	PreRoundTotalMinor int64 `json:"pre_round_total_minor"`
	RoundOffMinor      int64 `json:"round_off_minor"`
	TotalMinor         int64 `json:"total_minor"`
}

func RoundHalfUp(val float64) int64 {
	return int64(math.Floor(val + 0.5))
}

func CalculateBill(input BillInput) BillBreakdown {
	var subtotal int64 = 0

	for _, item := range input.Items {
		itemUnitTotal := item.UnitPriceMinor + item.AddonsTotal
		lineTotal := RoundHalfUp(float64(itemUnitTotal)*item.Qty) - item.LineDiscount
		if lineTotal < 0 {
			lineTotal = 0
		}
		subtotal += lineTotal
	}

	var orderDiscount int64 = 0
	if input.DiscountPercent > 0 {
		orderDiscount = RoundHalfUp(float64(subtotal) * input.DiscountPercent / 100.0)
	} else if input.DiscountFixed > 0 {
		orderDiscount = input.DiscountFixed
	}

	if orderDiscount > subtotal {
		orderDiscount = subtotal
	}

	taxableBase := subtotal - orderDiscount
	if taxableBase < 0 {
		taxableBase = 0
	}

	serviceCharge := int64(0)
	if input.ServiceChargePct > 0 {
		serviceCharge = RoundHalfUp(float64(taxableBase) * input.ServiceChargePct / 100.0)
	}

	var vat int64 = 0
	if input.IsTaxInclusive {
		// Inclusive tax mode: prices already contain VAT; vat = round(base * vat_pct / (100 + vat_pct))
		if input.VatPct > 0 {
			vat = RoundHalfUp(float64(taxableBase) * input.VatPct / (100.0 + input.VatPct))
		}
	} else {
		// Exclusive tax mode
		vatBase := taxableBase
		if input.VatOnServiceCharge || input.VatOnServiceCharge == false {
			// Per spec Appendix A.1: vat = round((taxable_base + service_charge) * vat_pct / 100)
			vatBase = taxableBase + serviceCharge
		}
		if input.VatPct > 0 {
			vat = RoundHalfUp(float64(vatBase) * input.VatPct / 100.0)
		}
	}

	preRoundTotal := taxableBase + serviceCharge + vat + input.DeliveryFee
	if preRoundTotal < 0 {
		preRoundTotal = 0
	}

	total := preRoundTotal
	roundingUnit := input.RoundingUnit
	if roundingUnit <= 0 {
		roundingUnit = 1
	}

	if roundingUnit > 1 {
		total = RoundHalfUp(float64(preRoundTotal)/float64(roundingUnit)) * roundingUnit
	}
	roundOff := total - preRoundTotal

	return BillBreakdown{
		SubtotalMinor:      subtotal,
		OrderDiscountMinor: orderDiscount,
		TaxableBaseMinor:   taxableBase,
		ServiceChargeMinor: serviceCharge,
		TaxMinor:           vat,
		DeliveryFeeMinor:   input.DeliveryFee,
		PreRoundTotalMinor: preRoundTotal,
		RoundOffMinor:      roundOff,
		TotalMinor:         total,
	}
}

// CalculateChange calculates change due
func CalculateChange(cashReceived int64, amountDueInCash int64) int64 {
	diff := cashReceived - amountDueInCash
	if diff < 0 {
		return 0
	}
	return diff
}

// WeightedAverageCost calculates new weighted average cost
// new_avg_cost = (old_qty * old_avg_cost + received_qty * unit_cost) / (old_qty + received_qty)
func WeightedAverageCost(oldQty float64, oldAvgCost int64, receivedQty float64, unitCost int64) int64 {
	totalQty := oldQty + receivedQty
	if totalQty <= 0 {
		return unitCost
	}
	newCost := (oldQty*float64(oldAvgCost) + receivedQty*float64(unitCost)) / totalQty
	return RoundHalfUp(newCost)
}

// CouponDiscount is the discount a coupon gives on a subtotal (all minor units).
// Percentage coupons round half up; fixed coupons give their amount. The discount
// never exceeds the subtotal. Other coupon types (e.g. "bogo") give nothing here.
func CouponDiscount(subtotalMinor int64, couponType string, discountPct float64, fixedMinor int64) int64 {
	var discount int64
	switch couponType {
	case "percentage":
		discount = RoundHalfUp(float64(subtotalMinor) * discountPct / 100.0)
	case "fixed":
		discount = fixedMinor
	}
	if discount < 0 {
		return 0
	}
	if discount > subtotalMinor {
		return subtotalMinor
	}
	return discount
}
