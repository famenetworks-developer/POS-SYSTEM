package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/audit"
	"restoflow/internal/billing"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
	"restoflow/internal/platform"
)

type OrderService struct {
	pool  *pgxpool.Pool
	hub   *platform.WSHub
	audit *audit.AuditService
}

func NewOrderService(pool *pgxpool.Pool, hub *platform.WSHub, audit *audit.AuditService) *OrderService {
	return &OrderService{pool: pool, hub: hub, audit: audit}
}

type CreateOrderRequest struct {
	ID          string               `json:"id,omitempty"` // client-supplied UUID for offline support
	BranchID    string               `json:"branch_id"`
	Type        string               `json:"type"` // dine_in, takeaway, delivery
	TableID     *string              `json:"table_id,omitempty"`
	CustomerID  *string              `json:"customer_id,omitempty"`
	Notes       string               `json:"notes,omitempty"`
	ShiftID     *string              `json:"shift_id,omitempty"`
	DeliveryFee int64                `json:"delivery_fee,omitempty"`
	CouponCode  string               `json:"coupon_code,omitempty"` // checked and priced by the server
	Items       []CreateOrderItemReq `json:"items"`
}

type CreateOrderItemReq struct {
	ItemID        *string              `json:"item_id,omitempty"`
	VariantID     *string              `json:"variant_id,omitempty"`
	NameSnapshot  string               `json:"name_snapshot"`
	Qty           float64              `json:"qty"`
	UnitPrice     int64                `json:"unit_price_minor"`
	DiscountMinor int64                `json:"discount_minor,omitempty"`
	Note          string               `json:"note,omitempty"`
	Addons        []CreateItemAddonReq `json:"addons,omitempty"`
}

type CreateItemAddonReq struct {
	AddonID      *string `json:"addon_id,omitempty"`
	NameSnapshot string  `json:"name_snapshot"`
	PriceMinor   int64   `json:"price_minor"`
	Qty          int     `json:"qty"`
}

type PayRequest struct {
	Payments []struct {
		MethodCode  string `json:"method_code"`
		AmountMinor int64  `json:"amount_minor"`
		Reference   string `json:"reference,omitempty"`
	} `json:"payments"`
	CashReceived int64 `json:"cash_received,omitempty"`
}

func (s *OrderService) getNextCounter(ctx context.Context, tx pgx.Tx, branchID, counterName string) (int64, error) {
	var val int64
	if counterName == "order_no" {
		query := `
			INSERT INTO counters (branch_id, name, date, value)
			VALUES ($1, $2, '1970-01-01', (SELECT COALESCE(MAX(order_no), 0) + 1 FROM orders WHERE branch_id = $1))
			ON CONFLICT (branch_id, name, date)
			DO UPDATE SET value = GREATEST(counters.value + 1, (SELECT COALESCE(MAX(order_no), 0) + 1 FROM orders WHERE branch_id = $1))
			RETURNING value
		`
		err := tx.QueryRow(ctx, query, branchID, counterName).Scan(&val)
		return val, err
	}
	query := `
		INSERT INTO counters (branch_id, name, date, value)
		VALUES ($1, $2, CURRENT_DATE, 1)
		ON CONFLICT (branch_id, name, date)
		DO UPDATE SET value = counters.value + 1
		RETURNING value
	`
	err := tx.QueryRow(ctx, query, branchID, counterName).Scan(&val)
	return val, err
}

// PaymentError is a payment the server refuses (short, zero, unknown method...).
type PaymentError struct{ Message string }

func (e *PaymentError) Error() string { return e.Message }

// validatePayments checks that the customer pays the full amount due, no more and no less,
// with the store's active payment methods, and that cash handed over covers the cash part.
func validatePayments(ctx context.Context, tx pgx.Tx, restID string, req PayRequest, dueMinor int64) error {
	if dueMinor <= 0 {
		if len(req.Payments) > 0 {
			return &PaymentError{"Nothing is due on this sale"}
		}
		return nil
	}
	if len(req.Payments) == 0 {
		return &PaymentError{fmt.Sprintf("Payment of ৳%.2f is required", float64(dueMinor)/100)}
	}

	active := map[string]bool{}
	rows, err := tx.Query(ctx, "SELECT code FROM payment_methods WHERE restaurant_id = $1 AND is_active = TRUE", restID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var code string
		if rows.Scan(&code) == nil {
			active[code] = true
		}
	}
	rows.Close()

	var sum, cashMinor int64
	for _, p := range req.Payments {
		if p.AmountMinor <= 0 {
			return &PaymentError{"Each payment amount must be more than ৳0"}
		}
		if !active[p.MethodCode] {
			return &PaymentError{fmt.Sprintf("Payment method %q is not available", p.MethodCode)}
		}
		sum += p.AmountMinor
		if p.MethodCode == "cash" {
			cashMinor += p.AmountMinor
		}
	}
	if sum < dueMinor {
		return &PaymentError{fmt.Sprintf("The customer must pay the full ৳%.2f; only ৳%.2f was entered", float64(dueMinor)/100, float64(sum)/100)}
	}
	if sum > dueMinor {
		return &PaymentError{fmt.Sprintf("Payments of ৳%.2f are more than the ৳%.2f due", float64(sum)/100, float64(dueMinor)/100)}
	}
	if req.CashReceived > 0 && req.CashReceived < cashMinor {
		return &PaymentError{fmt.Sprintf("Cash received ৳%.2f is less than the ৳%.2f cash due", float64(req.CashReceived)/100, float64(cashMinor)/100)}
	}
	return nil
}

// CouponError is a coupon problem the cashier can act on (expired, used up, minimum spend...).
type CouponError struct{ Message string }

func (e *CouponError) Error() string { return e.Message }

type coupon struct {
	id, code, typ        string
	pct                  float64
	fixedMinor, minSpend int64
}

type loyaltyRule struct {
	PointsPerUnit        int   `json:"points_per_unit"`
	DiscountMinorPerUnit int64 `json:"discount_minor_per_unit"`
	AutoRedeem           bool  `json:"auto_redeem"`
}

func getLoyaltyRule(ctx context.Context, tx pgx.Tx, restID string) loyaltyRule {
	rule := loyaltyRule{PointsPerUnit: 100, DiscountMinorPerUnit: 5000, AutoRedeem: true}
	var raw []byte
	if err := tx.QueryRow(ctx, "SELECT value FROM settings WHERE restaurant_id=$1 AND key='loyalty'", restID).Scan(&raw); err == nil {
		var saved loyaltyRule
		if json.Unmarshal(raw, &saved) == nil && saved.PointsPerUnit > 0 && saved.DiscountMinorPerUnit > 0 {
			rule = saved
		}
	}
	return rule
}

func calculateLoyaltyRedemption(availablePoints int, amountAfterOtherDiscounts int64, rule loyaltyRule) (int, int64) {
	if !rule.AutoRedeem || availablePoints < 1 || amountAfterOtherDiscounts < 1 || rule.PointsPerUnit < 1 || rule.DiscountMinorPerUnit < 1 {
		return 0, 0
	}
	units := availablePoints / rule.PointsPerUnit
	maxUnits := int(amountAfterOtherDiscounts / rule.DiscountMinorPerUnit)
	if units > maxUnits {
		units = maxUnits
	}
	if units < 1 {
		return 0, 0
	}
	return units * rule.PointsPerUnit, int64(units) * rule.DiscountMinorPerUnit
}

// findCoupon returns the store's usable coupon with this code: active, within its dates,
// and not used up. The row is locked so concurrent sales count uses correctly.
func findCoupon(ctx context.Context, tx pgx.Tx, restID, code string) (*coupon, error) {
	var c coupon
	var usageLimit, usedCount int
	err := tx.QueryRow(ctx, `
		SELECT id::text, code, type, discount_pct::float8, discount_minor, min_spend_minor, usage_limit, used_count
		FROM promotions
		WHERE restaurant_id = $1 AND UPPER(code) = UPPER($2) AND is_active = TRUE
		  AND NOW() BETWEEN start_date AND end_date
		FOR UPDATE
	`, restID, code).Scan(&c.id, &c.code, &c.typ, &c.pct, &c.fixedMinor, &c.minSpend, &usageLimit, &usedCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &CouponError{"Coupon code is invalid or expired"}
	}
	if err != nil {
		return nil, err
	}
	if usageLimit > 0 && usedCount >= usageLimit {
		return nil, &CouponError{"This coupon has been used up"}
	}
	return &c, nil
}

// ErrNoOpenShift is returned when someone tries to sell or take a payment without an open shift.
var ErrNoOpenShift = errors.New("open a shift before selling: no open shift for you at this branch")

// openShiftID returns the user's open shift at the branch, or nil when they have none.
// Sales and their cash are linked to this shift so its expected cash stays correct.
func openShiftID(ctx context.Context, tx pgx.Tx, restID, branchID, userID string) *string {
	var id string
	err := tx.QueryRow(ctx, `
		SELECT id::text FROM shifts
		WHERE restaurant_id = $1 AND branch_id::text = $2 AND cashier_id::text = $3 AND status = 'open'
		ORDER BY opened_at DESC
		LIMIT 1
	`, restID, branchID, userID).Scan(&id)
	if err != nil {
		return nil
	}
	return &id
}

func (s *OrderService) CreateOrder(ctx context.Context, restID, waiterID string, req CreateOrderRequest) (*models.Order, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// The shift is decided by the server, never taken from the request. No open shift, no sale.
	req.ShiftID = openShiftID(ctx, tx, restID, req.BranchID, waiterID)
	if req.ShiftID == nil {
		return nil, ErrNoOpenShift
	}

	orderID := req.ID
	if orderID == "" {
		orderID = uuid.New().String()
	}

	orderNo, err := s.getNextCounter(ctx, tx, req.BranchID, "order_no")
	if err != nil {
		return nil, fmt.Errorf("failed to generate order_no: %w", err)
	}

	var tokenNo *int64
	if req.Type == "takeaway" || req.Type == "delivery" {
		tNo, err := s.getNextCounter(ctx, tx, req.BranchID, "token_no")
		if err == nil {
			tokenNo = &tNo
		}
	}

	orderType := req.Type
	if orderType == "" {
		orderType = "walk_in"
	} else if orderType == "dine_in" {
		orderType = "walk_in"
	}

	// Insert order
	var order models.Order
	insertOrderQuery := `
		INSERT INTO orders (id, restaurant_id, branch_id, order_no, token_no, type, table_id, customer_id, waiter_id, status, delivery_fee_minor, notes, shift_id, opened_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::uuid, 'draft', $10, $11, $12, NOW())
		RETURNING id, restaurant_id, branch_id, order_no, token_no, type, table_id, customer_id, waiter_id, status, subtotal_minor, discount_minor, loyalty_points_redeemed, loyalty_discount_minor, loyalty_points_earned, service_charge_minor, tax_minor, delivery_fee_minor, round_off_minor, total_minor, paid_minor, notes, shift_id, opened_at
	`
	err = tx.QueryRow(ctx, insertOrderQuery,
		orderID, restID, req.BranchID, orderNo, tokenNo, orderType, req.TableID, req.CustomerID, waiterID, req.DeliveryFee, req.Notes, req.ShiftID,
	).Scan(
		&order.ID, &order.RestaurantID, &order.BranchID, &order.OrderNo, &order.TokenNo, &order.Type, &order.TableID, &order.CustomerID, &order.WaiterID,
		&order.Status, &order.SubtotalMinor, &order.DiscountMinor, &order.LoyaltyPointsRedeemed, &order.LoyaltyDiscountMinor, &order.LoyaltyPointsEarned, &order.ServiceChargeMinor, &order.TaxMinor, &order.DeliveryFeeMinor, &order.RoundOffMinor,
		&order.TotalMinor, &order.PaidMinor, &order.Notes, &order.ShiftID, &order.OpenedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert order: %w", err)
	}

	// Insert order items
	var orderItems []models.OrderItem
	var calcItems []billing.CalcItem

	for _, item := range req.Items {
		itemUUID := uuid.New().String()
		qty := item.Qty
		if qty <= 0 {
			qty = 1
		}

		// Lookup cost snapshot from recipe/item if possible
		var costSnapshot int64 = 0
		if item.ItemID != nil {
			_ = tx.QueryRow(ctx, `
				SELECT COALESCE(SUM(r.qty_per_portion * i.avg_cost_minor), 0)::bigint
				FROM recipes r
				JOIN inventory_items i ON r.inventory_item_id = i.id
				WHERE r.menu_item_id = $1
			`, *item.ItemID).Scan(&costSnapshot)
		}

		var oItem models.OrderItem
		itemQuery := `
			INSERT INTO order_items (id, restaurant_id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_minor, discount_minor, cost_minor_snapshot, note, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
			RETURNING id, restaurant_id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_minor, discount_minor, tax_minor, cost_minor_snapshot, note, status, created_at
		`
		err = tx.QueryRow(ctx, itemQuery,
			itemUUID, restID, orderID, item.ItemID, item.VariantID, item.NameSnapshot, qty, item.UnitPrice, item.DiscountMinor, costSnapshot, item.Note,
		).Scan(
			&oItem.ID, &oItem.RestaurantID, &oItem.OrderID, &oItem.ItemID, &oItem.VariantID, &oItem.NameSnapshot, &oItem.Qty, &oItem.UnitPriceMinor,
			&oItem.DiscountMinor, &oItem.TaxMinor, &oItem.CostMinorSnapshot, &oItem.Note, &oItem.Status, &oItem.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to insert order item: %w", err)
		}

		var addonsTotal int64 = 0
		var orderItemAddons []models.OrderItemAddon
		for _, ad := range item.Addons {
			var oAddon models.OrderItemAddon
			adUUID := uuid.New().String()
			adQty := ad.Qty
			if adQty <= 0 {
				adQty = 1
			}
			addonsTotal += ad.PriceMinor * int64(adQty)

			err = tx.QueryRow(ctx, `
				INSERT INTO order_item_addons (id, order_item_id, addon_id, name_snapshot, price_minor, qty)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING id, order_item_id, addon_id, name_snapshot, price_minor, qty
			`, adUUID, itemUUID, ad.AddonID, ad.NameSnapshot, ad.PriceMinor, adQty).Scan(
				&oAddon.ID, &oAddon.OrderItemID, &oAddon.AddonID, &oAddon.NameSnapshot, &oAddon.PriceMinor, &oAddon.Qty,
			)
			if err == nil {
				orderItemAddons = append(orderItemAddons, oAddon)
			}
		}
		oItem.Addons = orderItemAddons
		orderItems = append(orderItems, oItem)

		calcItems = append(calcItems, billing.CalcItem{
			UnitPriceMinor: item.UnitPrice,
			AddonsTotal:    addonsTotal,
			Qty:            qty,
			LineDiscount:   item.DiscountMinor,
		})
	}
	order.Items = orderItems

	// Read tax settings to calculate initial bill
	var taxJSON []byte
	var vatPct float64 = 15.0
	var servicePct float64 = 5.0
	var isInclusive bool = false
	var vatOnService bool = true

	_ = tx.QueryRow(ctx, "SELECT value FROM settings WHERE restaurant_id = $1 AND key = 'tax'", restID).Scan(&taxJSON)
	if len(taxJSON) > 0 {
		var ts struct {
			VatPct       float64 `json:"vat_pct"`
			ServicePct   float64 `json:"service_pct"`
			IsInclusive  bool    `json:"is_inclusive"`
			VatOnService bool    `json:"vat_on_service"`
		}
		if err := json.Unmarshal(taxJSON, &ts); err == nil {
			vatPct = ts.VatPct
			servicePct = ts.ServicePct
			isInclusive = ts.IsInclusive
			vatOnService = ts.VatOnService
		}
	}

	// Coupon: the server checks it and works out the discount from the real subtotal.
	var promotionID, couponCode *string
	var couponDiscount int64
	if code := strings.TrimSpace(req.CouponCode); code != "" {
		c, err := findCoupon(ctx, tx, restID, code)
		if err != nil {
			return nil, err
		}
		subtotal := billing.CalculateBill(billing.BillInput{Items: calcItems, RoundingUnit: 1}).SubtotalMinor
		if subtotal < c.minSpend {
			return nil, &CouponError{fmt.Sprintf("Coupon %s needs a minimum spend of ৳%.2f", c.code, float64(c.minSpend)/100)}
		}
		couponDiscount = billing.CouponDiscount(subtotal, c.typ, c.pct, c.fixedMinor)
		promotionID, couponCode = &c.id, &c.code
	}

	// Automatically use complete redemption units for the selected customer. The
	// final point deduction is transactional at payment time.
	var loyaltyPointsRedeemed int
	var loyaltyDiscount int64
	if req.CustomerID != nil && *req.CustomerID != "" {
		rule := getLoyaltyRule(ctx, tx, restID)
		if rule.AutoRedeem {
			var availablePoints int
			if err := tx.QueryRow(ctx, "SELECT loyalty_points FROM customers WHERE id=$1 AND restaurant_id=$2", *req.CustomerID, restID).Scan(&availablePoints); err != nil {
				return nil, fmt.Errorf("customer not found: %w", err)
			}
			subtotal := billing.CalculateBill(billing.BillInput{Items: calcItems, RoundingUnit: 1}).SubtotalMinor
			loyaltyPointsRedeemed, loyaltyDiscount = calculateLoyaltyRedemption(availablePoints, subtotal-couponDiscount, rule)
		}
	}

	bill := billing.CalculateBill(billing.BillInput{
		Items:              calcItems,
		DiscountPercent:    0,
		DiscountFixed:      couponDiscount + loyaltyDiscount,
		ServiceChargePct:   servicePct,
		VatPct:             vatPct,
		DeliveryFee:        req.DeliveryFee,
		IsTaxInclusive:     isInclusive,
		VatOnServiceCharge: vatOnService,
		RoundingUnit:       100,
	})

	// Update order totals
	updateTotalsQuery := `
		UPDATE orders
		SET subtotal_minor = $1, discount_minor = $2, service_charge_minor = $3, tax_minor = $4,
		    round_off_minor = $5, total_minor = $6, promotion_id = $8::uuid, coupon_code = $9,
		    loyalty_points_redeemed = $10, loyalty_discount_minor = $11
		WHERE id = $7
	`
	if _, err := tx.Exec(ctx, updateTotalsQuery,
		bill.SubtotalMinor, bill.OrderDiscountMinor, bill.ServiceChargeMinor, bill.TaxMinor, bill.RoundOffMinor, bill.TotalMinor, orderID,
		promotionID, couponCode, loyaltyPointsRedeemed, loyaltyDiscount,
	); err != nil {
		return nil, fmt.Errorf("failed to save order totals: %w", err)
	}
	order.SubtotalMinor = bill.SubtotalMinor
	order.DiscountMinor = bill.OrderDiscountMinor
	order.LoyaltyPointsRedeemed = loyaltyPointsRedeemed
	order.LoyaltyDiscountMinor = loyaltyDiscount
	order.ServiceChargeMinor = bill.ServiceChargeMinor
	order.TaxMinor = bill.TaxMinor
	order.RoundOffMinor = bill.RoundOffMinor
	order.TotalMinor = bill.TotalMinor

	// If dine_in with table, mark table occupied
	if req.TableID != nil && *req.TableID != "" {
		_, _ = tx.Exec(ctx, "UPDATE tables SET status = 'occupied', current_order_id = $1, updated_at = NOW() WHERE id = $2", orderID, *req.TableID)
		s.hub.BroadcastBranch(req.BranchID, "table.updated", map[string]interface{}{
			"table_id": *req.TableID,
			"status":   "occupied",
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// Broadcast websocket event
	s.hub.BroadcastBranch(req.BranchID, "order.created", order)

	return &order, nil
}

func (s *OrderService) SendKOT(ctx context.Context, restID, userID, orderID string) (*models.KOT, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var branchID string
	var tableID *string
	var orderNo int64
	var orderStatus string

	err = tx.QueryRow(ctx, "SELECT branch_id, table_id, order_no, status FROM orders WHERE id = $1 AND restaurant_id = $2", orderID, restID).Scan(
		&branchID, &tableID, &orderNo, &orderStatus,
	)
	if err != nil {
		return nil, fmt.Errorf("order not found: %w", err)
	}

	var tableName string
	if tableID != nil {
		_ = tx.QueryRow(ctx, "SELECT name FROM tables WHERE id = $1", *tableID).Scan(&tableName)
	}

	var waiterName string
	_ = tx.QueryRow(ctx, "SELECT name FROM users WHERE id = $1", userID).Scan(&waiterName)

	// Determine next batch_no
	var lastBatch int
	_ = tx.QueryRow(ctx, "SELECT COALESCE(MAX(batch_no), 0) FROM kots WHERE order_id = $1", orderID).Scan(&lastBatch)
	batchNo := lastBatch + 1

	kotID := uuid.New().String()
	insertKOT := `
		INSERT INTO kots (id, restaurant_id, order_id, branch_id, batch_no, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at
	`
	var kot models.KOT
	kot.ID = kotID
	kot.RestaurantID = restID
	kot.OrderID = orderID
	kot.BranchID = branchID
	kot.BatchNo = batchNo
	kot.OrderNo = orderNo
	kot.TableName = tableName
	kot.WaiterName = waiterName
	kot.CreatedBy = &userID

	err = tx.QueryRow(ctx, insertKOT, kotID, restID, orderID, branchID, batchNo, userID).Scan(&kot.ID, &kot.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create KOT: %w", err)
	}

	// Attach unsent items to this KOT
	rows, err := tx.Query(ctx, `
		UPDATE order_items
		SET kot_id = $1, status = 'pending'
		WHERE order_id = $2 AND (kot_id IS NULL OR status = 'pending')
		RETURNING id, item_id, variant_id, name_snapshot, qty, unit_price_minor, note, status, created_at
	`, kotID, orderID)
	if err != nil {
		return nil, fmt.Errorf("failed to update items for KOT: %w", err)
	}
	defer rows.Close()

	var kotItems []models.OrderItem
	for rows.Next() {
		var it models.OrderItem
		if err := rows.Scan(&it.ID, &it.ItemID, &it.VariantID, &it.NameSnapshot, &it.Qty, &it.UnitPriceMinor, &it.Note, &it.Status, &it.CreatedAt); err == nil {
			it.OrderID = orderID
			it.KotID = &kotID
			kotItems = append(kotItems, it)
		}
	}
	kot.Items = kotItems

	// Advance order status to in_progress if currently draft or placed
	if orderStatus == "draft" || orderStatus == "placed" {
		_, _ = tx.Exec(ctx, "UPDATE orders SET status = 'in_progress' WHERE id = $1", orderID)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// Broadcast KOT created event for KDS & kitchen printers
	s.hub.BroadcastBranch(branchID, "kot.created", kot)
	s.audit.Log(ctx, "SEND_KOT", "kot", &kotID, nil, kot, "", "")

	return &kot, nil
}

func (s *OrderService) UpdateKOTItemStatus(ctx context.Context, restID, itemID, newStatus, reason string) error {
	// Status flow: pending -> preparing -> ready -> served (cancelled allowed with reason)
	var orderID string
	var branchID string

	err := s.pool.QueryRow(ctx, `
		UPDATE order_items
		SET status = $1,
		    void_reason = CASE WHEN $1 = 'cancelled' THEN $2 ELSE void_reason END
		WHERE id = $3 AND restaurant_id = $4
		RETURNING order_id
	`, newStatus, reason, itemID, restID).Scan(&orderID)
	if err != nil {
		return fmt.Errorf("failed to update item status: %w", err)
	}

	_ = s.pool.QueryRow(ctx, "SELECT branch_id FROM orders WHERE id = $1", orderID).Scan(&branchID)

	s.hub.BroadcastBranch(branchID, "kot.item_status", map[string]interface{}{
		"item_id":  itemID,
		"order_id": orderID,
		"status":   newStatus,
		"reason":   reason,
	})

	return nil
}

func (s *OrderService) Pay(ctx context.Context, restID, userID, orderID string, req PayRequest) (map[string]interface{}, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var branchID string
	var tableID *string
	var shiftID *string
	var totalMinor int64
	var paidMinor int64
	var orderNo int64
	var status string
	var promotionID *string
	var customerID *string
	var loyaltyPointsRedeemed int
	var loyaltyDiscountMinor int64

	err = tx.QueryRow(ctx, `
		SELECT branch_id, table_id, shift_id, total_minor, paid_minor, order_no, status, promotion_id::text,
		       customer_id::text, loyalty_points_redeemed, loyalty_discount_minor
		FROM orders
		WHERE id = $1 AND restaurant_id = $2
		FOR UPDATE
	`, orderID, restID).Scan(&branchID, &tableID, &shiftID, &totalMinor, &paidMinor, &orderNo, &status, &promotionID, &customerID, &loyaltyPointsRedeemed, &loyaltyDiscountMinor)
	if err != nil {
		return nil, fmt.Errorf("order not found: %w", err)
	}

	if status == "paid" {
		return nil, fmt.Errorf("order is already paid")
	}
	// The customer pays the full amount due: no less, no more.
	if err := validatePayments(ctx, tx, restID, req, totalMinor-paidMinor); err != nil {
		return nil, err
	}

	// Cash goes into the drawer of whoever takes the payment, so they must have an open shift.
	payerShift := openShiftID(ctx, tx, restID, branchID, userID)
	if payerShift == nil {
		return nil, ErrNoOpenShift
	}
	shiftID = payerShift

	// Lock the customer balance before accepting payment. This prevents two tills
	// from spending the same loyalty points concurrently.
	if loyaltyPointsRedeemed > 0 {
		if customerID == nil || *customerID == "" {
			return nil, fmt.Errorf("loyalty redemption requires a customer")
		}
		var availablePoints int
		if err := tx.QueryRow(ctx, "SELECT loyalty_points FROM customers WHERE id=$1 AND restaurant_id=$2 FOR UPDATE", *customerID, restID).Scan(&availablePoints); err != nil {
			return nil, fmt.Errorf("failed to verify customer loyalty points: %w", err)
		}
		if availablePoints < loyaltyPointsRedeemed {
			return nil, fmt.Errorf("customer loyalty balance changed; recreate the sale to use the current balance")
		}
	}

	// A coupon counts as used when the sale is paid, within its usage limit.
	if promotionID != nil {
		tag, err := tx.Exec(ctx, `
			UPDATE promotions SET used_count = used_count + 1
			WHERE id = $1 AND restaurant_id = $2 AND (usage_limit <= 0 OR used_count < usage_limit)
		`, *promotionID, restID)
		if err != nil {
			return nil, fmt.Errorf("failed to record coupon use: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil, &CouponError{"This coupon has been used up"}
		}
	}

	var invoicePrefix string
	_ = tx.QueryRow(ctx, "SELECT invoice_prefix FROM branches WHERE id = $1", branchID).Scan(&invoicePrefix)
	if invoicePrefix == "" {
		invoicePrefix = "INV-"
	}

	// Gap-free invoice number generated using counters table with SELECT ... FOR UPDATE
	invoiceSeq, err := s.getNextCounter(ctx, tx, branchID, "invoice_no")
	if err != nil {
		return nil, fmt.Errorf("failed to allocate invoice counter: %w", err)
	}
	invoiceNo := fmt.Sprintf("%s%s-%04d", invoicePrefix, time.Now().Format("20060102"), invoiceSeq)

	// Record payments
	var totalPaidNow int64 = 0
	var paymentRecords []models.Payment

	for _, p := range req.Payments {
		if p.AmountMinor <= 0 {
			return nil, fmt.Errorf("payment amount must be positive")
		}
		pID := uuid.New().String()
		var pay models.Payment
		err = tx.QueryRow(ctx, `
			INSERT INTO payments (id, restaurant_id, order_id, method_code, amount_minor, reference, received_by, shift_id, paid_at)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::uuid, NULLIF($8, '')::uuid, NOW())
			RETURNING id, restaurant_id, order_id, method_code, amount_minor, reference, received_by, shift_id, paid_at
		`, pID, restID, orderID, p.MethodCode, p.AmountMinor, p.Reference, userID, shiftID).Scan(
			&pay.ID, &pay.RestaurantID, &pay.OrderID, &pay.MethodCode, &pay.AmountMinor, &pay.Reference, &pay.ReceivedBy, &pay.ShiftID, &pay.PaidAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to record payment: %w", err)
		}
		totalPaidNow += p.AmountMinor
		paymentRecords = append(paymentRecords, pay)

		// Update shift expected cash if paid with cash
		if p.MethodCode == "cash" && shiftID != nil {
			_, _ = tx.Exec(ctx, `
				UPDATE shifts
				SET expected_cash_minor = expected_cash_minor + $1
				WHERE id = $2
			`, p.AmountMinor, *shiftID)
		}
	}
	if totalPaidNow != totalMinor-paidMinor {
		return nil, fmt.Errorf("payment total must equal the invoice balance of %d", totalMinor-paidMinor)
	}

	newPaidMinor := paidMinor + totalPaidNow
	orderStatus := "paid"
	now := time.Now()

	// Update order to paid
	_, err = tx.Exec(ctx, `
		UPDATE orders
		SET status = $1, paid_minor = $2, closed_at = $3, shift_id = COALESCE(shift_id, $5::uuid)
		WHERE id = $4
	`, orderStatus, newPaidMinor, now, orderID, shiftID)
	if err != nil {
		return nil, fmt.Errorf("failed to update order status: %w", err)
	}

	// Free table if dine-in
	if tableID != nil && *tableID != "" {
		_, _ = tx.Exec(ctx, "UPDATE tables SET status = 'free', current_order_id = NULL, updated_at = NOW() WHERE id = $1", *tableID)
		s.hub.BroadcastBranch(branchID, "table.updated", map[string]interface{}{
			"table_id": *tableID,
			"status":   "free",
		})
	}

	// Deduct stock automatically from recipes (FR-INV-3)
	recipeRows, err := tx.Query(ctx, `
		SELECT r.inventory_item_id, (r.qty_per_portion * oi.qty * (1.0 + r.waste_pct / 100.0)) as deduct_qty, i.avg_cost_minor
		FROM order_items oi
		JOIN recipes r ON oi.item_id = r.menu_item_id
		JOIN inventory_items i ON r.inventory_item_id = i.id
		WHERE oi.order_id = $1 AND oi.status != 'cancelled'
	`, orderID)
	if err == nil {
		type stockDeduct struct {
			invID    string
			qty      float64
			unitCost int64
		}
		var deductions []stockDeduct
		for recipeRows.Next() {
			var d stockDeduct
			if err := recipeRows.Scan(&d.invID, &d.qty, &d.unitCost); err == nil {
				deductions = append(deductions, d)
			}
		}
		recipeRows.Close()

		for _, d := range deductions {
			// Insert stock movement
			if _, smErr := tx.Exec(ctx, `
				INSERT INTO stock_movements (restaurant_id, branch_id, inventory_item_id, type, qty, unit_cost_minor, ref_type, ref_id, reason, created_by)
				VALUES ($1, $2, $3, 'sale', $4, $5, 'order', $6::uuid, 'Auto sale deduction', NULLIF($7, '')::uuid)
			`, restID, branchID, d.invID, -d.qty, d.unitCost, orderID, userID); smErr != nil {
				fmt.Printf("[Pay] stock movement insert error: %v\n", smErr)
				return nil, fmt.Errorf("failed to insert stock movement: %w", smErr)
			}

			// Update branch on-hand stock
			if _, bsErr := tx.Exec(ctx, `
				INSERT INTO branch_stock (branch_id, inventory_item_id, quantity)
				VALUES ($1, $2, $3)
				ON CONFLICT (branch_id, inventory_item_id)
				DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity
			`, branchID, d.invID, -d.qty); bsErr != nil {
				fmt.Printf("[Pay] branch stock update error: %v\n", bsErr)
				return nil, fmt.Errorf("failed to update branch stock: %w", bsErr)
			}
		}
	}

	// Retail product direct stock deduction
	itRows, itErr := tx.Query(ctx, `
		SELECT item_id, qty
		FROM order_items
		WHERE order_id = $1 AND status != 'cancelled' AND item_id IS NOT NULL
	`, orderID)
	if itErr == nil {
		type saleLine struct {
			itemID string
			qty    float64
		}
		var sLines []saleLine
		for itRows.Next() {
			var sl saleLine
			if scanErr := itRows.Scan(&sl.itemID, &sl.qty); scanErr == nil {
				sLines = append(sLines, sl)
			}
		}
		itRows.Close()

		for _, sl := range sLines {
			_, _ = tx.Exec(ctx, `
				UPDATE menu_items
				SET stock_quantity = GREATEST(0, stock_quantity - $1), updated_at = NOW()
				WHERE id = $2 AND restaurant_id = $3
			`, sl.qty, sl.itemID, restID)
		}
	}

	// Redeem the saved points and award new points (1 point per 100 BDT) in the
	// same transaction as payment, so customer balances and invoices cannot drift.
	loyaltyPointsEarned := 0
	if customerID != nil && *customerID != "" {
		loyaltyPointsEarned = int(totalMinor / 10000)
		_, err = tx.Exec(ctx, `
			UPDATE customers
			SET loyalty_points = loyalty_points - $1 + $2
			WHERE id = $3 AND restaurant_id = $4 AND loyalty_points >= $1
		`, loyaltyPointsRedeemed, loyaltyPointsEarned, *customerID, restID)
		if err != nil {
			return nil, fmt.Errorf("failed to update loyalty balance: %w", err)
		}
		_, err = tx.Exec(ctx, "UPDATE orders SET loyalty_points_earned=$1 WHERE id=$2", loyaltyPointsEarned, orderID)
		if err != nil {
			return nil, fmt.Errorf("failed to save earned loyalty points: %w", err)
		}
	}

	// Create invoice record
	snapshotJSON, _ := json.Marshal(map[string]interface{}{
		"order_id":                orderID,
		"order_no":                orderNo,
		"invoice_no":              invoiceNo,
		"total":                   totalMinor,
		"loyalty_points_redeemed": loyaltyPointsRedeemed,
		"loyalty_discount_minor":  loyaltyDiscountMinor,
		"loyalty_points_earned":   loyaltyPointsEarned,
		"payments":                paymentRecords,
		"paid_at":                 now,
	})
	invoiceID := uuid.New().String()
	if _, invErr := tx.Exec(ctx, `
		INSERT INTO invoices (id, restaurant_id, branch_id, order_id, invoice_no, issued_at, snapshot)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
	`, invoiceID, restID, branchID, orderID, invoiceNo, now, snapshotJSON); invErr != nil {
		fmt.Printf("[Pay] invoice insert error: %v\n", invErr)
		return nil, fmt.Errorf("failed to insert invoice: %w", invErr)
	}

	if err := tx.Commit(ctx); err != nil {
		fmt.Printf("[Pay] commit error: %v\n", err)
		return nil, err
	}

	changeDue := billing.CalculateChange(req.CashReceived, totalMinor)

	s.hub.BroadcastBranch(branchID, "order.updated", map[string]interface{}{
		"order_id":   orderID,
		"status":     "paid",
		"invoice_no": invoiceNo,
	})

	s.audit.Log(ctx, "PAY_ORDER", "order", &orderID, nil, map[string]interface{}{
		"invoice_no": invoiceNo,
		"total":      totalMinor,
		"payments":   paymentRecords,
	}, "", "")

	return map[string]interface{}{
		"order_id":                orderID,
		"invoice_no":              invoiceNo,
		"status":                  "paid",
		"total_minor":             totalMinor,
		"paid_minor":              newPaidMinor,
		"change_due":              changeDue,
		"payments":                paymentRecords,
		"loyalty_points_redeemed": loyaltyPointsRedeemed,
		"loyalty_discount_minor":  loyaltyDiscountMinor,
		"loyalty_points_earned":   loyaltyPointsEarned,
	}, nil
}

func (s *OrderService) GetOrderDetails(ctx context.Context, restID, orderID string) (*models.Order, error) {
	var o models.Order
	query := `
		SELECT o.id, o.restaurant_id, o.branch_id, o.order_no, o.token_no, o.type, o.table_id, COALESCE(t.name, ''),
		       o.customer_id, COALESCE(c.name, ''), o.waiter_id, COALESCE(u.name, ''), o.status,
		       o.subtotal_minor, o.discount_minor, o.loyalty_points_redeemed, o.loyalty_discount_minor, o.loyalty_points_earned,
		       o.service_charge_minor, o.tax_minor, o.delivery_fee_minor,
		       o.round_off_minor, o.total_minor, o.paid_minor, COALESCE(o.notes, ''), o.shift_id, o.opened_at, o.closed_at
		FROM orders o
		LEFT JOIN tables t ON o.table_id = t.id
		LEFT JOIN customers c ON o.customer_id = c.id
		LEFT JOIN users u ON o.waiter_id = u.id
		WHERE o.id = $1 AND o.restaurant_id = $2
	`
	err := s.pool.QueryRow(ctx, query, orderID, restID).Scan(
		&o.ID, &o.RestaurantID, &o.BranchID, &o.OrderNo, &o.TokenNo, &o.Type, &o.TableID, &o.TableName,
		&o.CustomerID, &o.CustomerName, &o.WaiterID, &o.WaiterName, &o.Status,
		&o.SubtotalMinor, &o.DiscountMinor, &o.LoyaltyPointsRedeemed, &o.LoyaltyDiscountMinor, &o.LoyaltyPointsEarned, &o.ServiceChargeMinor, &o.TaxMinor, &o.DeliveryFeeMinor,
		&o.RoundOffMinor, &o.TotalMinor, &o.PaidMinor, &o.Notes, &o.ShiftID, &o.OpenedAt, &o.ClosedAt,
	)
	if err != nil {
		return nil, err
	}

	// Fetch items
	rows, err := s.pool.Query(ctx, `
		SELECT id, restaurant_id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_minor, discount_minor, tax_minor, cost_minor_snapshot, COALESCE(note, ''), status, kot_id, voided_by, void_reason, created_at
		FROM order_items
		WHERE order_id = $1
		ORDER BY created_at ASC
	`, orderID)
	if err == nil {
		defer rows.Close()
		var items []models.OrderItem
		for rows.Next() {
			var it models.OrderItem
			var voidReason *string
			if err := rows.Scan(&it.ID, &it.RestaurantID, &it.OrderID, &it.ItemID, &it.VariantID, &it.NameSnapshot, &it.Qty, &it.UnitPriceMinor, &it.DiscountMinor, &it.TaxMinor, &it.CostMinorSnapshot, &it.Note, &it.Status, &it.KotID, &it.VoidedBy, &voidReason, &it.CreatedAt); err == nil {
				if voidReason != nil {
					it.VoidReason = *voidReason
				}
				// Fetch addons
				adRows, _ := s.pool.Query(ctx, "SELECT id, order_item_id, addon_id, name_snapshot, price_minor, qty FROM order_item_addons WHERE order_item_id = $1", it.ID)
				if adRows != nil {
					var addons []models.OrderItemAddon
					for adRows.Next() {
						var ad models.OrderItemAddon
						if err := adRows.Scan(&ad.ID, &ad.OrderItemID, &ad.AddonID, &ad.NameSnapshot, &ad.PriceMinor, &ad.Qty); err == nil {
							addons = append(addons, ad)
						}
					}
					adRows.Close()
					it.Addons = addons
				}
				items = append(items, it)
			}
		}
		o.Items = items
	}

	// Fetch payments
	pRows, err := s.pool.Query(ctx, "SELECT id, restaurant_id, order_id, method_code, amount_minor, reference, received_by, shift_id, paid_at FROM payments WHERE order_id = $1", orderID)
	if err == nil {
		defer pRows.Close()
		var payments []models.Payment
		for pRows.Next() {
			var p models.Payment
			if err := pRows.Scan(&p.ID, &p.RestaurantID, &p.OrderID, &p.MethodCode, &p.AmountMinor, &p.Reference, &p.ReceivedBy, &p.ShiftID, &p.PaidAt); err == nil {
				payments = append(payments, p)
			}
		}
		o.Payments = payments
	}

	return &o, nil
}

func (s *OrderService) MountRoutes(r chi.Router) {
	r.Post("/orders", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		var body CreateOrderRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		if claims.Role != "owner" && claims.Role != "admin" {
			var allowed bool
			_ = s.pool.QueryRow(req.Context(), "SELECT EXISTS(SELECT 1 FROM user_branches WHERE user_id=$1 AND branch_id::text=$2)", claims.UserID, body.BranchID).Scan(&allowed)
			if !allowed {
				middleware.JSONError(w, http.StatusForbidden, "BRANCH_FORBIDDEN", "This branch is not assigned to your account", nil)
				return
			}
		}

		order, err := s.CreateOrder(req.Context(), restID, claims.UserID, body)
		if errors.Is(err, ErrNoOpenShift) {
			middleware.JSONError(w, http.StatusConflict, "SHIFT_REQUIRED", "Open a shift before selling.", nil)
			return
		}
		var couponErr *CouponError
		if errors.As(err, &couponErr) {
			middleware.JSONError(w, http.StatusBadRequest, "COUPON_INVALID", couponErr.Message, nil)
			return
		}
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "ORDER_CREATION_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, order, nil)
	})

	r.Get("/orders/{id}", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		orderID := chi.URLParam(req, "id")
		order, err := s.GetOrderDetails(req.Context(), restID, orderID)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, order, nil)
	})

	r.Get("/orders", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		branchID := req.URL.Query().Get("branch_id")
		status := req.URL.Query().Get("status")

		query := `
			SELECT o.id, o.restaurant_id, o.branch_id, o.order_no, o.token_no, o.type, o.table_id, COALESCE(t.name, ''),
			       o.customer_id, COALESCE(c.name, ''), o.status, o.total_minor, o.paid_minor, o.opened_at, o.closed_at
			FROM orders o
			LEFT JOIN tables t ON o.table_id = t.id
			LEFT JOIN customers c ON o.customer_id = c.id
			WHERE o.restaurant_id = $1
			  AND ($2 = '' OR o.branch_id::text = $2)
			  AND ($3 IN ('owner','admin','accountant') OR EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id::text=$4 AND ub.branch_id=o.branch_id))
			  AND ($3 <> 'cashier' OR o.waiter_id::text=$4)
			  AND ($5 = '' OR o.status=$5)
		`
		query += " ORDER BY o.opened_at DESC LIMIT 50"
		var rows pgx.Rows
		rows, err := s.pool.Query(req.Context(), query, restID, branchID, claims.Role, claims.UserID, status)

		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var orders []models.Order
		for rows.Next() {
			var o models.Order
			if err := rows.Scan(
				&o.ID, &o.RestaurantID, &o.BranchID, &o.OrderNo, &o.TokenNo, &o.Type, &o.TableID, &o.TableName,
				&o.CustomerID, &o.CustomerName, &o.Status, &o.TotalMinor, &o.PaidMinor, &o.OpenedAt, &o.ClosedAt,
			); err == nil {
				orders = append(orders, o)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, orders, nil)
	})

	r.Post("/orders/{id}/send-kot", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		orderID := chi.URLParam(req, "id")

		kot, err := s.SendKOT(req.Context(), restID, claims.UserID, orderID)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "KOT_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, kot, nil)
	})

	r.Post("/orders/{id}/request-bill", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		orderID := chi.URLParam(req, "id")

		var branchID string
		var tableID *string
		err := s.pool.QueryRow(req.Context(), `
			UPDATE orders SET status = 'billed' WHERE id = $1 AND restaurant_id = $2
			RETURNING branch_id, table_id
		`, orderID, restID).Scan(&branchID, &tableID)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error(), nil)
			return
		}

		if tableID != nil && *tableID != "" {
			_, _ = s.pool.Exec(req.Context(), "UPDATE tables SET status = 'bill_requested' WHERE id = $1", *tableID)
			s.hub.BroadcastBranch(branchID, "table.updated", map[string]interface{}{
				"table_id": *tableID,
				"status":   "bill_requested",
			})
		}
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"message": "bill requested"}, nil)
	})

	r.Post("/orders/{id}/discount", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		orderID := chi.URLParam(req, "id")

		var body struct {
			DiscountPercent float64 `json:"discount_percent"`
			DiscountFixed   int64   `json:"discount_fixed_minor"`
			Reason          string  `json:"reason"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		// Enforce discount limits by role
		if body.DiscountPercent > claims.DiscountLimitPct && claims.Role != "owner" && claims.Role != "super_admin" {
			middleware.JSONError(w, http.StatusForbidden, "DISCOUNT_LIMIT_EXCEEDED", fmt.Sprintf("Discount %.1f%% exceeds user limit of %.1f%%", body.DiscountPercent, claims.DiscountLimitPct), nil)
			return
		}

		// Recalculate bill
		order, err := s.GetOrderDetails(req.Context(), restID, orderID)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
			return
		}

		var calcItems []billing.CalcItem
		for _, it := range order.Items {
			if it.Status != "cancelled" {
				calcItems = append(calcItems, billing.CalcItem{
					UnitPriceMinor: it.UnitPriceMinor,
					Qty:            it.Qty,
					LineDiscount:   it.DiscountMinor,
				})
			}
		}

		bill := billing.CalculateBill(billing.BillInput{
			Items:              calcItems,
			DiscountPercent:    body.DiscountPercent,
			DiscountFixed:      body.DiscountFixed,
			ServiceChargePct:   5.0,
			VatPct:             15.0,
			DeliveryFee:        order.DeliveryFeeMinor,
			IsTaxInclusive:     false,
			VatOnServiceCharge: true,
			RoundingUnit:       100,
		})

		_, err = s.pool.Exec(req.Context(), `
			UPDATE orders
			SET subtotal_minor = $1, discount_minor = $2, service_charge_minor = $3, tax_minor = $4,
			    round_off_minor = $5, total_minor = $6
			WHERE id = $7
		`, bill.SubtotalMinor, bill.OrderDiscountMinor, bill.ServiceChargeMinor, bill.TaxMinor, bill.RoundOffMinor, bill.TotalMinor, orderID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error(), nil)
			return
		}

		s.audit.Log(req.Context(), "APPLY_DISCOUNT", "order", &orderID, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusOK, bill, nil)
	})

	r.Get("/orders/{id}/bill", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		orderID := chi.URLParam(req, "id")

		order, err := s.GetOrderDetails(req.Context(), restID, orderID)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
			return
		}

		var calcItems []billing.CalcItem
		for _, it := range order.Items {
			if it.Status != "cancelled" {
				calcItems = append(calcItems, billing.CalcItem{
					UnitPriceMinor: it.UnitPriceMinor,
					Qty:            it.Qty,
					LineDiscount:   it.DiscountMinor,
				})
			}
		}

		bill := billing.CalculateBill(billing.BillInput{
			Items:              calcItems,
			DiscountPercent:    0,
			DiscountFixed:      order.DiscountMinor,
			ServiceChargePct:   5.0,
			VatPct:             15.0,
			DeliveryFee:        order.DeliveryFeeMinor,
			IsTaxInclusive:     false,
			VatOnServiceCharge: true,
			RoundingUnit:       100,
		})

		middleware.JSONSuccess(w, http.StatusOK, bill, nil)
	})

	r.Get("/orders/{id}/receipt", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		orderID := chi.URLParam(req, "id")

		order, err := s.GetOrderDetails(req.Context(), restID, orderID)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
			return
		}

		var invNo string
		_ = s.pool.QueryRow(req.Context(), "SELECT invoice_no FROM invoices WHERE order_id = $1", orderID).Scan(&invNo)

		// Audit receipt reprint if already closed
		if order.Status == "paid" {
			claims := middleware.GetUserClaims(req.Context())
			s.audit.Log(req.Context(), "REPRINT_RECEIPT", "order", &orderID, nil, map[string]string{"user_id": claims.UserID}, "", "")
		}

		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"order":      order,
			"invoice_no": invNo,
		}, nil)
	})

	// Process Return and Refund
	r.Post("/orders/{id}/refund", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		orderID := chi.URLParam(req, "id")

		var body struct {
			AmountMinor int64  `json:"amount_minor"`
			Reason      string `json:"reason"`
			Restock     bool   `json:"restock"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "DB_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())

		refundID := uuid.New().String()
		_, err = tx.Exec(req.Context(), `
			INSERT INTO refunds (id, restaurant_id, order_id, amount_minor, reason, approved_by, restock)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, refundID, restID, orderID, body.AmountMinor, body.Reason, claims.UserID, body.Restock)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "REFUND_FAILED", err.Error(), nil)
			return
		}

		// Update order status
		_, _ = tx.Exec(req.Context(), "UPDATE orders SET status = 'refunded' WHERE id = $1", orderID)

		// Restock items if requested
		if body.Restock {
			rows, rErr := tx.Query(req.Context(), "SELECT item_id, qty FROM order_items WHERE order_id = $1 AND item_id IS NOT NULL", orderID)
			if rErr == nil {
				type rItem struct {
					id  string
					qty float64
				}
				var itemsToRestock []rItem
				for rows.Next() {
					var ri rItem
					if err := rows.Scan(&ri.id, &ri.qty); err == nil {
						itemsToRestock = append(itemsToRestock, ri)
					}
				}
				rows.Close()

				for _, ri := range itemsToRestock {
					_, _ = tx.Exec(req.Context(), `
						UPDATE menu_items SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2
					`, ri.qty, ri.id)
				}
			}
		}

		if err := tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "COMMIT_FAILED", err.Error(), nil)
			return
		}

		s.audit.Log(req.Context(), "REFUND_ORDER", "order", &orderID, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{"refund_id": refundID, "status": "refunded", "amount_minor": body.AmountMinor}, nil)
	})

	r.Post("/orders/{id}/items", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		orderID := chi.URLParam(req, "id")

		var body struct {
			Items []CreateOrderItemReq `json:"items"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "DB_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())

		for _, itemReq := range body.Items {
			itemId := uuid.Must(uuid.NewV7()).String()
			_, err = tx.Exec(req.Context(), `
				INSERT INTO order_items (id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_minor, discount_minor, tax_minor, cost_minor_snapshot, note, status)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
			`, itemId, orderID, itemReq.ItemID, itemReq.VariantID, itemReq.NameSnapshot, itemReq.Qty, itemReq.UnitPrice, itemReq.DiscountMinor, 0, 0, itemReq.Note)
			if err != nil {
				middleware.JSONError(w, http.StatusInternalServerError, "ITEM_INSERT_FAILED", err.Error(), nil)
				return
			}
		}

		if err := tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "COMMIT_FAILED", err.Error(), nil)
			return
		}

		updatedOrder, _ := s.GetOrderDetails(req.Context(), restID, orderID)
		middleware.JSONSuccess(w, http.StatusOK, updatedOrder, nil)
	})

	r.Patch("/orders/{id}/status", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		orderID := chi.URLParam(req, "id")

		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", "A status is required", nil)
			return
		}

		allowedStatuses := map[string]bool{
			"picking": true, "packed": true, "dispatched": true, "delivered": true,
		}
		if !allowedStatuses[body.Status] {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_STATUS", "Unsupported fulfillment status", nil)
			return
		}

		var branchID string
		var updatedStatus string
		err := s.pool.QueryRow(req.Context(), `
			UPDATE orders
			SET status = $1,
				closed_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE closed_at END
			WHERE id = $2 AND restaurant_id = $3 AND type IN ('delivery', 'pickup')
			RETURNING branch_id::text, status
		`, body.Status, orderID, restID).Scan(&branchID, &updatedStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			middleware.JSONError(w, http.StatusNotFound, "ORDER_NOT_FOUND", "Fulfillment order not found", nil)
			return
		}
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "STATUS_UPDATE_FAILED", err.Error(), nil)
			return
		}

		s.audit.Log(req.Context(), "UPDATE_FULFILLMENT_STATUS", "order", &orderID, nil, map[string]string{
			"status": body.Status, "updated_by": claims.UserID,
		}, "", "")
		s.hub.BroadcastBranch(branchID, "order.fulfillment_status", map[string]string{"id": orderID, "status": body.Status})
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"id": orderID, "status": updatedStatus}, nil)
	})

	r.Post("/orders/{id}/cancel", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		orderID := chi.URLParam(req, "id")

		var body struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(req.Body).Decode(&body)

		_, err := s.pool.Exec(req.Context(), `
			UPDATE orders SET status = 'cancelled' WHERE id = $1 AND restaurant_id = $2
		`, orderID, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "CANCEL_FAILED", err.Error(), nil)
			return
		}

		s.audit.Log(req.Context(), "CANCEL_ORDER", "order", &orderID, nil, map[string]string{"reason": body.Reason, "cancelled_by": claims.UserID}, "", "")
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"status": "cancelled"}, nil)
	})

	r.Post("/orders/{id}/pay", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		orderID := chi.URLParam(req, "id")

		var body PayRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		res, err := s.Pay(req.Context(), restID, claims.UserID, orderID, body)
		var payErr *PaymentError
		if errors.As(err, &payErr) {
			middleware.JSONError(w, http.StatusBadRequest, "PAYMENT_INVALID", payErr.Message, nil)
			return
		}
		if errors.Is(err, ErrNoOpenShift) {
			middleware.JSONError(w, http.StatusConflict, "SHIFT_REQUIRED", "Open a shift before taking payment.", nil)
			return
		}
		var couponErr *CouponError
		if errors.As(err, &couponErr) {
			middleware.JSONError(w, http.StatusBadRequest, "COUPON_INVALID", couponErr.Message, nil)
			return
		}
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "PAYMENT_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, res, nil)
	})

	// KDS endpoints
	r.Get("/kots", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")
		status := req.URL.Query().Get("status")

		query := `
			SELECT k.id, k.restaurant_id, k.order_id, k.branch_id, k.station_id, k.batch_no,
			       o.order_no, COALESCE(t.name, ''), COALESCE(u.name, ''), k.created_at
			FROM kots k
			JOIN orders o ON k.order_id = o.id
			LEFT JOIN tables t ON o.table_id = t.id
			LEFT JOIN users u ON k.created_by = u.id
			WHERE k.restaurant_id = $1 AND ($2 = '' OR k.branch_id = $2::uuid)
			ORDER BY k.created_at ASC
		`
		rows, err := s.pool.Query(req.Context(), query, restID, branchID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var kots []models.KOT
		for rows.Next() {
			var k models.KOT
			if err := rows.Scan(
				&k.ID, &k.RestaurantID, &k.OrderID, &k.BranchID, &k.StationID, &k.BatchNo,
				&k.OrderNo, &k.TableName, &k.WaiterName, &k.CreatedAt,
			); err == nil {
				// Fetch items for this KOT
				itRows, _ := s.pool.Query(req.Context(), `
					SELECT id, item_id, name_snapshot, qty, unit_price_minor, note, status, created_at
					FROM order_items
					WHERE kot_id = $1 AND ($2 = '' OR status = $2)
				`, k.ID, status)
				if itRows != nil {
					var items []models.OrderItem
					for itRows.Next() {
						var it models.OrderItem
						if err := itRows.Scan(&it.ID, &it.ItemID, &it.NameSnapshot, &it.Qty, &it.UnitPriceMinor, &it.Note, &it.Status, &it.CreatedAt); err == nil {
							items = append(items, it)
						}
					}
					itRows.Close()
					k.Items = items
				}
				// If status filter is passed and no items match, skip
				if status == "" || len(k.Items) > 0 {
					kots = append(kots, k)
				}
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, kots, nil)
	})

	r.Patch("/kots/items/{id}/status", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		itemID := chi.URLParam(req, "id")
		var body struct {
			Status string `json:"status"` // pending, preparing, ready, served, cancelled
			Reason string `json:"reason,omitempty"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		if err := s.UpdateKOTItemStatus(req.Context(), restID, itemID, body.Status, body.Reason); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{"item_id": itemID, "status": body.Status}, nil)
	})
}
