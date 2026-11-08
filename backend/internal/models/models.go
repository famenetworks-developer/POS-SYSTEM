package models

import (
	"time"
)

type Restaurant struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Phone     string    `json:"phone"`
	Email     string    `json:"email"`
	Address   string    `json:"address"`
	LogoURL   string    `json:"logo_url"`
	Currency  string    `json:"currency"`
	Timezone  string    `json:"timezone"`
	Language  string    `json:"language"`
	TaxNo     string    `json:"tax_no"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Branch struct {
	ID            string    `json:"id"`
	RestaurantID  string    `json:"restaurant_id"`
	Name          string    `json:"name"`
	Address       string    `json:"address"`
	Phone         string    `json:"phone"`
	IsActive      bool      `json:"is_active"`
	InvoicePrefix string    `json:"invoice_prefix"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type User struct {
	ID               string     `json:"id"`
	RestaurantID     *string    `json:"restaurant_id,omitempty"`
	Name             string     `json:"name"`
	Email            string     `json:"email"`
	Phone            string     `json:"phone"`
	PasswordHash     string     `json:"-"`
	PinHash          *string    `json:"-"`
	Role             string     `json:"role"`
	DiscountLimitPct float64    `json:"discount_limit_pct"`
	IsActive         bool       `json:"is_active"`
	LastLoginAt      *time.Time `json:"last_login_at,omitempty"`
	BranchIDs        []string   `json:"branch_ids,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type Station struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	BranchID     string    `json:"branch_id"`
	Name         string    `json:"name"`
	PrinterID    string    `json:"printer_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type Category struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	NameEN       string    `json:"name_en"`
	NameBN       string    `json:"name_bn"`
	Sort         int       `json:"sort"`
	Color        string    `json:"color"`
	StationID    *string   `json:"station_id,omitempty"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
}

type ItemVariant struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	ItemID       string    `json:"item_id"`
	Name         string    `json:"name"`
	PriceMinor   int64     `json:"price_minor"`
	SKU          string    `json:"sku"`
	CreatedAt    time.Time `json:"created_at"`
}

type AddonGroup struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	Name         string    `json:"name"`
	Min          int       `json:"min"`
	Max          int       `json:"max"`
	Addons       []Addon   `json:"addons,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type Addon struct {
	ID              string    `json:"id"`
	RestaurantID    string    `json:"restaurant_id"`
	GroupID         string    `json:"group_id"`
	Name            string    `json:"name"`
	PriceMinor      int64     `json:"price_minor"`
	InventoryItemID *string   `json:"inventory_item_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type MenuItem struct {
	ID                string         `json:"id"`
	RestaurantID      string         `json:"restaurant_id"`
	CategoryID        string         `json:"category_id"`
	CategoryName      string         `json:"category_name,omitempty"`
	NameEN            string         `json:"name_en"`
	NameBN            string         `json:"name_bn"`
	SKU               string         `json:"sku"`
	Brand             string         `json:"brand"`
	Unit              string         `json:"unit"`
	PackageSize       string         `json:"package_size"`
	BasePriceMinor    int64          `json:"base_price_minor"`
	RegularPriceMinor int64          `json:"regular_price_minor"`
	CostPriceMinor    int64          `json:"cost_price_minor"`
	TaxClass          string         `json:"tax_class"`
	ImageURL          string         `json:"image_url"`
	IsAvailable       bool           `json:"is_available"`
	IsActive          bool           `json:"is_active"`
	IsWeighted        bool           `json:"is_weighted"`
	IsHotDeal         bool           `json:"is_hot_deal"`
	IsPopular         bool           `json:"is_popular"`
	IsNewArrival      bool           `json:"is_new_arrival"`
	TrackStock        bool           `json:"track_stock"`
	StockQuantity     float64        `json:"stock_quantity"`
	ReorderLevel      float64        `json:"reorder_level"`
	Barcode           string         `json:"barcode"`
	ShelfLocation     string         `json:"shelf_location"`
	Department        string         `json:"department"`
	Barcodes          []string       `json:"barcodes,omitempty"`
	Batches           []ProductBatch `json:"batches,omitempty"`
	Variants          []ItemVariant  `json:"variants,omitempty"`
	AddonGroups       []AddonGroup   `json:"addon_groups,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

type TableSection struct {
	ID           string `json:"id"`
	RestaurantID string `json:"restaurant_id"`
	BranchID     string `json:"branch_id"`
	Name         string `json:"name"`
	Sort         int    `json:"sort"`
}

type Table struct {
	ID             string    `json:"id"`
	RestaurantID   string    `json:"restaurant_id"`
	BranchID       string    `json:"branch_id"`
	SectionID      *string   `json:"section_id,omitempty"`
	SectionName    string    `json:"section_name,omitempty"`
	Name           string    `json:"name"`
	Seats          int       `json:"seats"`
	PosX           int       `json:"pos_x"`
	PosY           int       `json:"pos_y"`
	Status         string    `json:"status"` // free, occupied, bill_requested, cleaning, reserved
	CurrentOrderID *string   `json:"current_order_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Customer struct {
	ID               string    `json:"id"`
	RestaurantID     string    `json:"restaurant_id"`
	Name             string    `json:"name"`
	Phone            string    `json:"phone"`
	Email            string    `json:"email"`
	Address          string    `json:"address"`
	Notes            string    `json:"notes"`
	CustomerGroup    string    `json:"customer_group"`
	LoyaltyPoints    int       `json:"loyalty_points"`
	CreditLimitMinor int64     `json:"credit_limit_minor"`
	BalanceMinor     int64     `json:"balance_minor"`
	CreatedAt        time.Time `json:"created_at"`
}

type Order struct {
	ID                    string      `json:"id"`
	RestaurantID          string      `json:"restaurant_id"`
	BranchID              string      `json:"branch_id"`
	OrderNo               int64       `json:"order_no"`
	TokenNo               *int64      `json:"token_no,omitempty"`
	Type                  string      `json:"type"` // dine_in, takeaway, delivery
	TableID               *string     `json:"table_id,omitempty"`
	TableName             string      `json:"table_name,omitempty"`
	CustomerID            *string     `json:"customer_id,omitempty"`
	CustomerName          string      `json:"customer_name,omitempty"`
	WaiterID              *string     `json:"waiter_id,omitempty"`
	WaiterName            string      `json:"waiter_name,omitempty"`
	Status                string      `json:"status"` // draft, placed, in_progress, served, billed, paid, cancelled, refunded
	SubtotalMinor         int64       `json:"subtotal_minor"`
	DiscountMinor         int64       `json:"discount_minor"`
	LoyaltyPointsRedeemed int         `json:"loyalty_points_redeemed"`
	LoyaltyDiscountMinor  int64       `json:"loyalty_discount_minor"`
	LoyaltyPointsEarned   int         `json:"loyalty_points_earned"`
	ServiceChargeMinor    int64       `json:"service_charge_minor"`
	TaxMinor              int64       `json:"tax_minor"`
	DeliveryFeeMinor      int64       `json:"delivery_fee_minor"`
	RoundOffMinor         int64       `json:"round_off_minor"`
	TotalMinor            int64       `json:"total_minor"`
	PaidMinor             int64       `json:"paid_minor"`
	Notes                 string      `json:"notes"`
	ShiftID               *string     `json:"shift_id,omitempty"`
	Items                 []OrderItem `json:"items,omitempty"`
	Payments              []Payment   `json:"payments,omitempty"`
	OpenedAt              time.Time   `json:"opened_at"`
	ClosedAt              *time.Time  `json:"closed_at,omitempty"`
}

type OrderItem struct {
	ID                string           `json:"id"`
	RestaurantID      string           `json:"restaurant_id"`
	OrderID           string           `json:"order_id"`
	ItemID            *string          `json:"item_id,omitempty"`
	VariantID         *string          `json:"variant_id,omitempty"`
	NameSnapshot      string           `json:"name_snapshot"`
	Qty               float64          `json:"qty"`
	UnitPriceMinor    int64            `json:"unit_price_minor"`
	DiscountMinor     int64            `json:"discount_minor"`
	TaxMinor          int64            `json:"tax_minor"`
	CostMinorSnapshot int64            `json:"cost_minor_snapshot"`
	Note              string           `json:"note"`
	Status            string           `json:"status"` // pending, preparing, ready, served, cancelled
	KotID             *string          `json:"kot_id,omitempty"`
	VoidedBy          *string          `json:"voided_by,omitempty"`
	VoidReason        string           `json:"void_reason,omitempty"`
	Addons            []OrderItemAddon `json:"addons,omitempty"`
	CreatedAt         time.Time        `json:"created_at"`
}

type OrderItemAddon struct {
	ID           string  `json:"id"`
	OrderItemID  string  `json:"order_item_id"`
	AddonID      *string `json:"addon_id,omitempty"`
	NameSnapshot string  `json:"name_snapshot"`
	PriceMinor   int64   `json:"price_minor"`
	Qty          int     `json:"qty"`
}

type KOT struct {
	ID           string      `json:"id"`
	RestaurantID string      `json:"restaurant_id"`
	OrderID      string      `json:"order_id"`
	BranchID     string      `json:"branch_id"`
	StationID    *string     `json:"station_id,omitempty"`
	StationName  string      `json:"station_name,omitempty"`
	BatchNo      int         `json:"batch_no"`
	OrderNo      int64       `json:"order_no,omitempty"`
	TableName    string      `json:"table_name,omitempty"`
	WaiterName   string      `json:"waiter_name,omitempty"`
	Items        []OrderItem `json:"items,omitempty"`
	PrintedAt    *time.Time  `json:"printed_at,omitempty"`
	CreatedBy    *string     `json:"created_by,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
}

type Payment struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	OrderID      string    `json:"order_id"`
	MethodCode   string    `json:"method_code"`
	AmountMinor  int64     `json:"amount_minor"`
	Reference    string    `json:"reference"`
	ReceivedBy   *string   `json:"received_by,omitempty"`
	ShiftID      *string   `json:"shift_id,omitempty"`
	PaidAt       time.Time `json:"paid_at"`
}

type Shift struct {
	ID                string         `json:"id"`
	RestaurantID      string         `json:"restaurant_id"`
	BranchID          string         `json:"branch_id"`
	CashierID         string         `json:"cashier_id"`
	CashierName       string         `json:"cashier_name,omitempty"`
	TerminalID        string         `json:"terminal_id"`
	OpenedAt          time.Time      `json:"opened_at"`
	ClosedAt          *time.Time     `json:"closed_at,omitempty"`
	OpeningCashMinor  int64          `json:"opening_cash_minor"`
	ExpectedCashMinor int64          `json:"expected_cash_minor"`
	CountedCashMinor  int64          `json:"counted_cash_minor"`
	VarianceMinor     int64          `json:"variance_minor"`
	Note              string         `json:"note"`
	Status            string         `json:"status"` // open, closed
	CashMovements     []CashMovement `json:"cash_movements,omitempty"`
}

type CashMovement struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	ShiftID      string    `json:"shift_id"`
	Type         string    `json:"type"` // in, out
	AmountMinor  int64     `json:"amount_minor"`
	Reason       string    `json:"reason"`
	CreatedAt    time.Time `json:"created_at"`
}

type InventoryItem struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	Name         string    `json:"name"`
	Unit         string    `json:"unit"`
	MinLevel     float64   `json:"min_level"`
	Category     string    `json:"category"`
	AvgCostMinor int64     `json:"avg_cost_minor"`
	CurrentStock float64   `json:"current_stock,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type Recipe struct {
	ID              string  `json:"id"`
	RestaurantID    string  `json:"restaurant_id"`
	MenuItemID      string  `json:"menu_item_id"`
	VariantID       *string `json:"variant_id,omitempty"`
	InventoryItemID string  `json:"inventory_item_id"`
	ItemName        string  `json:"item_name,omitempty"`
	Unit            string  `json:"unit,omitempty"`
	QtyPerPortion   float64 `json:"qty_per_portion"`
	WastePct        float64 `json:"waste_pct"`
}

type StockMovement struct {
	ID              string    `json:"id"`
	RestaurantID    string    `json:"restaurant_id"`
	BranchID        string    `json:"branch_id"`
	InventoryItemID string    `json:"inventory_item_id"`
	ItemName        string    `json:"item_name,omitempty"`
	Unit            string    `json:"unit,omitempty"`
	Type            string    `json:"type"`
	Qty             float64   `json:"qty"`
	UnitCostMinor   int64     `json:"unit_cost_minor"`
	RefType         string    `json:"ref_type"`
	RefID           *string   `json:"ref_id,omitempty"`
	Reason          string    `json:"reason"`
	CreatedBy       *string   `json:"created_by,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type Supplier struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	Name         string    `json:"name"`
	Phone        string    `json:"phone"`
	BalanceMinor int64     `json:"balance_minor"`
	CreatedAt    time.Time `json:"created_at"`
}

type PurchaseOrder struct {
	ID           string              `json:"id"`
	RestaurantID string              `json:"restaurant_id"`
	BranchID     string              `json:"branch_id"`
	SupplierID   string              `json:"supplier_id"`
	SupplierName string              `json:"supplier_name,omitempty"`
	Status       string              `json:"status"` // draft, ordered, partially_received, received, cancelled
	TotalMinor   int64               `json:"total_minor"`
	Lines        []PurchaseOrderLine `json:"lines,omitempty"`
	CreatedAt    time.Time           `json:"created_at"`
}

type PurchaseOrderLine struct {
	ID              string  `json:"id"`
	PurchaseOrderID string  `json:"purchase_order_id"`
	InventoryItemID string  `json:"inventory_item_id"`
	ItemName        string  `json:"item_name,omitempty"`
	Unit            string  `json:"unit,omitempty"`
	Qty             float64 `json:"qty"`
	UnitCostMinor   int64   `json:"unit_cost_minor"`
	ReceivedQty     float64 `json:"received_qty"`
}

type Expense struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	BranchID     string    `json:"branch_id"`
	Category     string    `json:"category"`
	AmountMinor  int64     `json:"amount_minor"`
	Date         string    `json:"date"`
	Note         string    `json:"note"`
	CreatedBy    *string   `json:"created_by,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type AuditLog struct {
	ID           string      `json:"id"`
	RestaurantID *string     `json:"restaurant_id,omitempty"`
	UserID       *string     `json:"user_id,omitempty"`
	UserName     string      `json:"user_name,omitempty"`
	Action       string      `json:"action"`
	Entity       string      `json:"entity"`
	EntityID     *string     `json:"entity_id,omitempty"`
	Before       interface{} `json:"before,omitempty"`
	After        interface{} `json:"after,omitempty"`
	IP           string      `json:"ip"`
	Device       string      `json:"device"`
	CreatedAt    time.Time   `json:"created_at"`
}

type Plan struct {
	ID          string                 `json:"id"`
	Code        string                 `json:"code"`
	Name        string                 `json:"name"`
	PriceMinor  int64                  `json:"price_minor"`
	Interval    string                 `json:"interval"`
	MaxBranches int                    `json:"max_branches"`
	MaxUsers    int                    `json:"max_users"`
	Features    map[string]interface{} `json:"features"`
	CreatedAt   time.Time              `json:"created_at"`
}

type Subscription struct {
	ID               string     `json:"id"`
	RestaurantID     string     `json:"restaurant_id"`
	RestaurantName   string     `json:"restaurant_name,omitempty"`
	PlanID           string     `json:"plan_id"`
	PlanName         string     `json:"plan_name,omitempty"`
	PlanCode         string     `json:"plan_code,omitempty"`
	Status           string     `json:"status"` // trial, active, past_due, suspended, cancelled
	TrialEndsAt      *time.Time `json:"trial_ends_at,omitempty"`
	CurrentPeriodEnd *time.Time `json:"current_period_end,omitempty"`
	GraceUntil       *time.Time `json:"grace_until,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type PaymentMethod struct {
	ID                string    `json:"id"`
	RestaurantID      string    `json:"restaurant_id"`
	Code              string    `json:"code"`
	Label             string    `json:"label"`
	IsActive          bool      `json:"is_active"`
	RequiresReference bool      `json:"requires_reference"`
	CreatedAt         time.Time `json:"created_at"`
}

type ProductBatch struct {
	ID             string    `json:"id"`
	RestaurantID   string    `json:"restaurant_id"`
	BranchID       string    `json:"branch_id"`
	ProductID      string    `json:"product_id"`
	ProductName    string    `json:"product_name,omitempty"`
	BatchNo        string    `json:"batch_no"`
	MfgDate        *string   `json:"mfg_date,omitempty"`
	ExpDate        string    `json:"exp_date"`
	Quantity       float64   `json:"quantity"`
	CostPriceMinor int64     `json:"cost_price_minor"`
	CreatedAt      time.Time `json:"created_at"`
}

type Promotion struct {
	ID            string    `json:"id"`
	RestaurantID  string    `json:"restaurant_id"`
	Code          string    `json:"code"`
	Name          string    `json:"name"`
	Type          string    `json:"type"`
	DiscountPct   float64   `json:"discount_pct"`
	DiscountMinor int64     `json:"discount_minor"`
	MinSpendMinor int64     `json:"min_spend_minor"`
	StartDate     time.Time `json:"start_date"`
	EndDate       time.Time `json:"end_date"`
	IsActive      bool      `json:"is_active"`
	UsageLimit    int       `json:"usage_limit"`
	UsedCount     int       `json:"used_count"`
	CreatedAt     time.Time `json:"created_at"`
}

type RetailDelivery struct {
	ID               string    `json:"id"`
	RestaurantID     string    `json:"restaurant_id"`
	BranchID         string    `json:"branch_id"`
	OrderID          string    `json:"order_id"`
	OrderNo          int64     `json:"order_no,omitempty"`
	CustomerID       *string   `json:"customer_id,omitempty"`
	RecipientName    string    `json:"recipient_name"`
	RecipientPhone   string    `json:"recipient_phone"`
	DeliveryAddress  string    `json:"delivery_address"`
	DeliveryZone     string    `json:"delivery_zone"`
	DeliveryFeeMinor int64     `json:"delivery_fee_minor"`
	Status           string    `json:"status"` // ordered, picking, packed, out_for_delivery, delivered, cancelled
	StaffID          *string   `json:"staff_id,omitempty"`
	StaffName        string    `json:"staff_name,omitempty"`
	Notes            string    `json:"notes"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type StockAdjustment struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	BranchID     string    `json:"branch_id"`
	ProductID    string    `json:"product_id"`
	ProductName  string    `json:"product_name,omitempty"`
	Type         string    `json:"type"` // damage, expiry, recount, shrinkage, return_restock
	QtyChange    float64   `json:"qty_change"`
	Reason       string    `json:"reason"`
	CreatedBy    *string   `json:"created_by,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type StockTransfer struct {
	ID             string              `json:"id"`
	RestaurantID   string              `json:"restaurant_id"`
	FromBranchID   string              `json:"from_branch_id"`
	FromBranchName string              `json:"from_branch_name,omitempty"`
	ToBranchID     string              `json:"to_branch_id"`
	ToBranchName   string              `json:"to_branch_name,omitempty"`
	Status         string              `json:"status"` // pending, in_transit, completed, cancelled
	Notes          string              `json:"notes"`
	CreatedBy      *string             `json:"created_by,omitempty"`
	Lines          []StockTransferLine `json:"lines,omitempty"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
}

type StockTransferLine struct {
	ID          string  `json:"id"`
	TransferID  string  `json:"transfer_id"`
	ProductID   string  `json:"product_id"`
	ProductName string  `json:"product_name,omitempty"`
	Qty         float64 `json:"qty"`
	ReceivedQty float64 `json:"received_qty"`
}
