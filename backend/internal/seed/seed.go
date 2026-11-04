package seed

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func hashPin(pin string) string {
	hasher := sha256.New()
	hasher.Write([]byte(pin))
	return hex.EncodeToString(hasher.Sum(nil))
}

type productSeed struct {
	CatIdx       int
	Dept         string
	Brand        string
	NameEN       string
	NameBN       string
	PackageSize  string
	Unit         string
	SKU          string
	Barcode      string
	RegPrice     int64
	SellPrice    int64
	CostPrice    int64
	Stock        float64
	IsWeighted   bool
	IsHotDeal    bool
	IsPopular    bool
	IsNewArrival bool
}

func SeedDatabase(pool *pgxpool.Pool) error {
	ctx := context.Background()

	// Check if already seeded with NovaMart products
	var productCount int
	_ = pool.QueryRow(ctx, "SELECT COUNT(*) FROM menu_items WHERE brand != ''").Scan(&productCount)
	if productCount >= 100 {
		// RBAC demo identities must be reconciled even when catalogue data already exists.
		adminPwd, _ := bcrypt.GenerateFromPassword([]byte("admin123"), 12)
		_, _ = pool.Exec(ctx, `
			INSERT INTO users (restaurant_id, name, email, phone, password_hash, role, discount_limit_pct, is_active)
			SELECT id, 'Nusrat Jahan (Tenant Admin)', 'tenantadmin@novamart.com', '+8801700000001', $1, 'admin', 0, TRUE
			FROM restaurants WHERE slug = 'novamart'
			ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin', restaurant_id = EXCLUDED.restaurant_id
		`, string(adminPwd))
		log.Println("[Seed] NovaMart supermarket database already seeded. Skipping initial seed.")
		return nil
	}

	log.Println("[Seed] Seeding NovaMart Super Shop with 160+ supermarket products, 26 categories, registers, suppliers & history...")

	// 1. Create or Update Super Admin
	adminPwd, _ := bcrypt.GenerateFromPassword([]byte("admin123"), 12)
	_, _ = pool.Exec(ctx, `
		INSERT INTO users (id, restaurant_id, name, email, phone, password_hash, role, discount_limit_pct, is_active)
		VALUES (gen_random_uuid(), NULL, 'NovaMart Super Administrator', 'admin@novamart.com', '+8801700000000', $1, 'super_admin', 100.0, TRUE)
		ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'super_admin', name = 'NovaMart Super Administrator'
	`, string(adminPwd))

	// Backward compatibility superadmin
	_, _ = pool.Exec(ctx, `
		INSERT INTO users (id, restaurant_id, name, email, phone, password_hash, role, discount_limit_pct, is_active)
		VALUES (gen_random_uuid(), NULL, 'Super Administrator', 'superadmin@restoflow.com', '+8801700000000', $1, 'super_admin', 100.0, TRUE)
		ON CONFLICT (email) DO NOTHING
	`, string(adminPwd))

	// 2. Retail SaaS Plan
	planID := uuid.New().String()
	_, _ = pool.Exec(ctx, `
		INSERT INTO plans (id, code, name, price_minor, interval, max_branches, max_users, features)
		VALUES ($1, 'enterprise', 'NovaMart Super Shop Enterprise', 890000, 'monthly', 10, 50, '{"inventory": true, "offline": true, "scale_barcode": true, "loyalty": true, "multi_branch": true, "reports": true}'::jsonb)
		ON CONFLICT (code) DO NOTHING
	`, planID)

	// 3. Super Shop Business Entity: NovaMart
	var restID string
	err := pool.QueryRow(ctx, "SELECT id FROM restaurants WHERE slug = 'novamart' LIMIT 1").Scan(&restID)
	if err != nil || restID == "" {
		restID = uuid.New().String()
		_, err = pool.Exec(ctx, `
			INSERT INTO restaurants (id, name, slug, phone, email, address, currency, timezone, language, tax_no, status)
			VALUES ($1, 'NovaMart Super Shop', 'novamart', '+880 1711-234567', 'care@novamart.com.bd', 'House 14, Road 11, Banani, Dhaka-1213, Bangladesh', 'BDT', 'Asia/Dhaka', 'en', 'BIN-0023948571029', 'active')
			ON CONFLICT (slug) DO NOTHING
		`, restID)
		if err != nil {
			return fmt.Errorf("novamart business seed failed: %w", err)
		}
	} else {
		_, _ = pool.Exec(ctx, `
			UPDATE restaurants
			SET name = 'NovaMart Super Shop', phone = '+880 1711-234567', email = 'care@novamart.com.bd',
			    address = 'House 14, Road 11, Banani, Dhaka-1213, Bangladesh', currency = 'BDT', timezone = 'Asia/Dhaka'
			WHERE id = $1
		`, restID)
	}

	// Active Subscription
	subEnd := time.Now().Add(365 * 24 * time.Hour)
	_, _ = pool.Exec(ctx, `
		INSERT INTO subscriptions (restaurant_id, plan_id, status, trial_ends_at, current_period_end)
		VALUES ($1, $2, 'active', $3, $3)
		ON CONFLICT (restaurant_id) DO NOTHING
	`, restID, planID, subEnd)

	// 4. Two Retail Branches: Banani Flagship & Gulshan 2 Outlet
	var branch1ID, branch2ID string
	err = pool.QueryRow(ctx, "SELECT id FROM branches WHERE restaurant_id = $1 ORDER BY created_at ASC LIMIT 1", restID).Scan(&branch1ID)
	if err != nil || branch1ID == "" {
		branch1ID = uuid.New().String()
		branch2ID = uuid.New().String()
		_, _ = pool.Exec(ctx, `
			INSERT INTO branches (id, restaurant_id, name, address, phone, is_active, invoice_prefix)
			VALUES ($1, $2, 'NovaMart - Banani Flagship Outlet', 'House 14, Road 11, Banani, Dhaka', '+880 1711-234567', TRUE, 'BAN-')
		`, branch1ID, restID)
		_, _ = pool.Exec(ctx, `
			INSERT INTO branches (id, restaurant_id, name, address, phone, is_active, invoice_prefix)
			VALUES ($1, $2, 'NovaMart - Gulshan 2 Outlet', 'Plot 42, Avenue Road, Gulshan 2, Dhaka', '+880 1711-234568', TRUE, 'GLS-')
		`, branch2ID, restID)
	} else {
		_, _ = pool.Exec(ctx, `
			UPDATE branches SET name = 'NovaMart - Banani Flagship Outlet', address = 'House 14, Road 11, Banani, Dhaka', invoice_prefix = 'BAN-'
			WHERE id = $1
		`, branch1ID)
		_ = pool.QueryRow(ctx, "SELECT id FROM branches WHERE restaurant_id = $1 AND id != $2 LIMIT 1", restID, branch1ID).Scan(&branch2ID)
		if branch2ID == "" {
			branch2ID = uuid.New().String()
			_, _ = pool.Exec(ctx, `
				INSERT INTO branches (id, restaurant_id, name, address, phone, is_active, invoice_prefix)
				VALUES ($1, $2, 'NovaMart - Gulshan 2 Outlet', 'Plot 42, Avenue Road, Gulshan 2, Dhaka', '+880 1711-234568', TRUE, 'GLS-')
			`, branch2ID, restID)
		} else {
			_, _ = pool.Exec(ctx, `
				UPDATE branches SET name = 'NovaMart - Gulshan 2 Outlet', address = 'Plot 42, Avenue Road, Gulshan 2, Dhaka', invoice_prefix = 'GLS-'
				WHERE id = $1
			`, branch2ID)
		}
	}

	// 5. Store Settings
	taxJSON := `{"vat_pct": 5.0, "service_pct": 0.0, "is_inclusive": false, "rounding_unit": 100, "vat_on_service": false}`
	receiptJSON := `{"paper_width": "80mm", "show_tax_no": true, "header": "NOVAMART SUPER SHOP\nEveryday essentials, intelligently managed\nBIN: 0023948571029", "footer": "Thank you for shopping at NovaMart!\nExchange within 7 days with original receipt\nHotline: 16789 | novamart.com.bd"}`
	_, _ = pool.Exec(ctx, "INSERT INTO settings (restaurant_id, key, value) VALUES ($1, 'tax', $2::jsonb) ON CONFLICT (restaurant_id, key) DO UPDATE SET value = $2::jsonb", restID, taxJSON)
	_, _ = pool.Exec(ctx, "INSERT INTO settings (restaurant_id, key, value) VALUES ($1, 'receipt', $2::jsonb) ON CONFLICT (restaurant_id, key) DO UPDATE SET value = $2::jsonb", restID, receiptJSON)

	// Payment Methods
	methods := []struct {
		code, label string
		ref         bool
	}{
		{"cash", "Cash (নগদ টাকা)", false},
		{"card", "POS Card (Visa / Mastercard)", true},
		{"bkash", "bKash Merchant (বিকাশ)", true},
		{"nagad", "Nagad Direct (নগদ)", true},
		{"rocket", "Dutch Bangla Rocket", true},
		{"due", "Customer Store Credit / Due", false},
	}
	for _, m := range methods {
		_, _ = pool.Exec(ctx, `
			INSERT INTO payment_methods (id, restaurant_id, code, label, is_active, requires_reference)
			VALUES (gen_random_uuid(), $1, $2, $3, TRUE, $4)
			ON CONFLICT (restaurant_id, code) DO NOTHING
		`, restID, m.code, m.label, m.ref)
	}

	// 6. Eight Dedicated Super Shop Roles & Users
	ownerPwd, _ := bcrypt.GenerateFromPassword([]byte("owner123"), 12)
	managerPwd, _ := bcrypt.GenerateFromPassword([]byte("manager123"), 12)
	cashierPwd, _ := bcrypt.GenerateFromPassword([]byte("cashier123"), 12)
	invPwd, _ := bcrypt.GenerateFromPassword([]byte("inventory123"), 12)
	purchPwd, _ := bcrypt.GenerateFromPassword([]byte("purchase123"), 12)
	acctPwd, _ := bcrypt.GenerateFromPassword([]byte("accountant123"), 12)
	delivPwd, _ := bcrypt.GenerateFromPassword([]byte("delivery123"), 12)
	tenantAdminPwd, _ := bcrypt.GenerateFromPassword([]byte("admin123"), 12)

	staffList := []struct {
		name, email, role, pwd, pin string
		discount                    float64
	}{
		{"Rahim Chowdhury (Owner)", "owner@novamart.com", "owner", string(ownerPwd), "9999", 100.0},
		{"Tariqul Islam (Branch Manager)", "manager@novamart.com", "manager", string(managerPwd), "1111", 20.0},
		{"Sadia Rahman (Lead Cashier)", "cashier@novamart.com", "cashier", string(cashierPwd), "2222", 10.0},
		{"Mahmud Hassan (Inventory Head)", "inventory@novamart.com", "inventory_manager", string(invPwd), "3333", 5.0},
		{"Zubair Ahmed (Purchase Officer)", "purchase@novamart.com", "purchase_manager", string(purchPwd), "4444", 5.0},
		{"Farhana Yasmin (Chief Accountant)", "accountant@novamart.com", "accountant", string(acctPwd), "5555", 0.0},
		{"Kamal Hossain (Delivery Associate)", "delivery@novamart.com", "delivery_staff", string(delivPwd), "6666", 0.0},
		{"Nusrat Jahan (Tenant Admin)", "tenantadmin@novamart.com", "admin", string(tenantAdminPwd), "7777", 0.0},

		// Aliases for backward compatibility
		{"Sadia Rahman", "cashier@royalfeast.com", "cashier", string(cashierPwd), "2222", 10.0},
		{"Rahim Chowdhury", "owner@royalfeast.com", "owner", string(ownerPwd), "9999", 100.0},
		{"Tariqul Islam", "manager@royalfeast.com", "manager", string(managerPwd), "1111", 20.0},
		{"Kamal Hossain", "waiter@royalfeast.com", "cashier", string(cashierPwd), "3333", 10.0},
	}

	var cashierUserID string
	for _, s := range staffList {
		uid := uuid.New().String()
		ph := hashPin(s.pin)
		_, err = pool.Exec(ctx, `
			INSERT INTO users (id, restaurant_id, name, email, phone, password_hash, pin_hash, role, discount_limit_pct, is_active)
			VALUES ($1, $2, $3, $4, '+8801700000000', $5, $6, $7, $8, TRUE)
			ON CONFLICT (email) DO UPDATE SET password_hash = $5, role = $7, restaurant_id = $2
		`, uid, restID, s.name, s.email, s.pwd, ph, s.role, s.discount)
		if err == nil {
			var fetchedUID string
			_ = pool.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", s.email).Scan(&fetchedUID)
			_, _ = pool.Exec(ctx, "INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", fetchedUID, branch1ID)
			_, _ = pool.Exec(ctx, "INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", fetchedUID, branch2ID)
			if s.email == "cashier@novamart.com" {
				cashierUserID = fetchedUID
			}
		}
	}

	// 7. Checkout Counters & Registers
	regSections := []struct {
		name string
		sort int
	}{
		{"Ground Floor Checkout Lanes (নিচতলা কাউন্টার)", 1},
		{"1st Floor Express & Grocery (দোতলা এক্সপ্রেস)", 2},
		{"Online Dispatch & Customer Pickup (পিকআপ কাউন্টার)", 3},
	}

	_, _ = pool.Exec(ctx, "DELETE FROM table_sections WHERE restaurant_id = $1", restID)
	_, _ = pool.Exec(ctx, "DELETE FROM tables WHERE restaurant_id = $1", restID)

	var reg1ID string
	for _, sec := range regSections {
		secID := uuid.New().String()
		_, _ = pool.Exec(ctx, "INSERT INTO table_sections (id, restaurant_id, branch_id, name, sort) VALUES ($1, $2, $3, $4, $5)", secID, restID, branch1ID, sec.name, sec.sort)
		_, _ = pool.Exec(ctx, "INSERT INTO table_sections (id, restaurant_id, branch_id, name, sort) VALUES (gen_random_uuid(), $1, $2, $3, $4)", restID, branch2ID, sec.name, sec.sort)

		prefix := "Counter"
		if sec.sort == 2 {
			prefix = "Express"
		} else if sec.sort == 3 {
			prefix = "Pickup"
		}

		for cIdx := 1; cIdx <= 3; cIdx++ {
			tID := uuid.New().String()
			regName := fmt.Sprintf("%s %02d", prefix, cIdx)
			_, _ = pool.Exec(ctx, `
				INSERT INTO tables (id, restaurant_id, branch_id, section_id, name, seats, pos_x, pos_y, status)
				VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'free')
			`, tID, restID, branch1ID, secID, regName, cIdx*100, 50)
			if reg1ID == "" {
				reg1ID = tID
			}
		}
	}

	// 8. Retail Promotions
	_, _ = pool.Exec(ctx, `
		INSERT INTO promotions (id, restaurant_id, code, name, type, discount_pct, discount_minor, min_spend_minor, start_date, end_date, is_active)
		VALUES
			(gen_random_uuid(), $1, 'NOVAFIRST', '10% Welcome Super Offer', 'percentage', 10.0, 0, 50000, NOW() - INTERVAL '1 day', NOW() + INTERVAL '60 days', TRUE),
			(gen_random_uuid(), $1, 'WEEKEND200', '৳200 Flat Weekend Discount', 'fixed', 0.0, 20000, 150000, NOW() - INTERVAL '1 day', NOW() + INTERVAL '60 days', TRUE),
			(gen_random_uuid(), $1, 'FRIDAYFRESH', '15% Off Fresh Essentials', 'percentage', 15.0, 0, 100000, NOW() - INTERVAL '1 day', NOW() + INTERVAL '60 days', TRUE)
		ON CONFLICT (restaurant_id, code) DO NOTHING
	`, restID)

	// 9. Realistic Retail Customers
	customersData := []struct {
		name, phone, email, group string
		points, credit            int
	}{
		{"Tanvir Ahmed", "+8801712345678", "tanvir.ahmed@gmail.com", "VIP Platinum", 550, 1500000},
		{"Nusrat Jahan", "+8801819876543", "nusrat.jahan@hotmail.com", "Gold Member", 220, 800000},
		{"Farhan Kabir", "+8801911554433", "farhan.kabir@yahoo.com", "Regular Club", 85, 500000},
		{"Mahbubur Rahman", "+8801612998877", "m.rahman@corporate.com", "Corporate Partner", 1250, 5000000},
		{"Sumaiya Akter", "+8801722887766", "sumaiya.a@gmail.com", "Gold Member", 310, 1000000},
		{"Walk-in Shopper", "+8801700112233", "guest@novamart.com.bd", "Regular", 0, 0},
	}
	for _, cd := range customersData {
		_, _ = pool.Exec(ctx, `
			INSERT INTO customers (id, restaurant_id, name, phone, email, customer_group, loyalty_points, credit_limit_minor, balance_minor)
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 0)
			ON CONFLICT DO NOTHING
		`, restID, cd.name, cd.phone, cd.email, cd.group, cd.points, cd.credit)
	}

	// 10. 7 Major Supermarket FMCG Suppliers
	suppliersData := []struct {
		name, phone string
		balance     int64
	}{
		{"Meghna Group of Industries (Fresh)", "+88029567890", 25000000},
		{"Square Consumer Products Ltd. (Radhuni)", "+88028833445", 18500000},
		{"PRAN-RFL Agro & Foods", "+88029881122", 32000000},
		{"Aarong Dairy & BRAC Enterprises", "+88028824180", 14000000},
		{"Unilever Bangladesh Ltd.", "+88029885566", 45000000},
		{"ACI Consumer Brands (Savlon & Pure)", "+88029341122", 21000000},
		{"Bengal Meat Processing Industries", "+88028871020", 16000000},
	}
	var mainSupplierID string
	for _, sup := range suppliersData {
		sID := uuid.New().String()
		_, _ = pool.Exec(ctx, `
			INSERT INTO suppliers (id, restaurant_id, name, phone, balance_minor)
			VALUES ($1, $2, $3, $4, $5)
		`, sID, restID, sup.name, sup.phone, sup.balance)
		if mainSupplierID == "" {
			mainSupplierID = sID
		}
	}

	// 11. 26 Retail Super Shop Categories
	categoriesData := []struct {
		nameEN, nameBN, color string
	}{
		{"Daily Essentials", "নিত্যপ্রয়োজনীয় পণ্য", "#0d5c3a"},
		{"Fresh Fruits", "তাজা ফলমূল", "#16a34a"},
		{"Fresh Vegetables", "তাজা শাকসবজি", "#15803d"},
		{"Meat & Poultry", "মাংস ও মুরগি", "#dc2626"},
		{"Fish & Seafood", "মাছ ও সামুদ্রিক খাদ্য", "#0284c7"},
		{"Dairy, Chilled & Eggs", "দুধ, ডিম ও দুগ্ধজাত খাদ্য", "#eab308"},
		{"Bakery & Breakfast", "বেকারি ও সকালের নাস্তা", "#d97706"},
		{"Beverages & Cold Drinks", "পানীয় ও জুস", "#06b6d4"},
		{"Tea & Coffee", "চা ও কফি", "#854d0e"},
		{"Ice Cream & Desserts", "আইসক্রিম ও মিষ্টান্ন", "#ec4899"},
		{"Chocolates & Candy", "চকলেট ও ক্যান্ডি", "#a855f7"},
		{"Snacks & Biscuits", "স্ন্যাকস ও বিস্কুট", "#f97316"},
		{"Frozen & Ready Meals", "ফ্রোজেন ও ইনস্ট্যান্ট ফুড", "#2563eb"},
		{"Rice, Flours & Grains", "চাল, ডাল ও আটা", "#ca8a04"},
		{"Cooking Oils & Ghee", "ভোজ্যতেল ও ঘি", "#d97706"},
		{"Spices & Seasonings", "মসলা ও লবণ", "#b91c1c"},
		{"Sauces, Pickles & Spreads", "সস, আচার ও স্প্রেড", "#ea580c"},
		{"Noodles, Pasta & Soups", "নুডলস ও পাস্তা", "#ca8a04"},
		{"Cleaning & Laundry", "পরিষ্কার-পরিচ্ছন্নতা সামগ্রী", "#0891b2"},
		{"Household Essentials", "গৃহস্থালি সামগ্রী", "#475569"},
		{"Personal Care & Bath", "ব্যক্তিগত যত্ন ও সাবান", "#db2777"},
		{"Oral Care & Grooming", "টুথপেস্ট ও গ্রুমিং", "#0284c7"},
		{"Health & Wellness", "স্বাস্থ্য ও ফার্মা", "#059669"},
		{"Baby Care & Diapers", "শিশুর খাদ্য ও ডায়াপার", "#f43f5e"},
		{"Pet Supplies", "পোষা প্রাণীর খাবার ও যত্ন", "#7c3aed"},
		{"Stationery & Batteries", "স্টেশনারি ও অফিস সামগ্রী", "#4f46e5"},
	}

	// Clear old menu items & categories
	_, _ = pool.Exec(ctx, "DELETE FROM menu_items WHERE restaurant_id = $1", restID)
	_, _ = pool.Exec(ctx, "DELETE FROM categories WHERE restaurant_id = $1", restID)

	categoryIDs := make([]string, len(categoriesData))
	for idx, c := range categoriesData {
		cID := uuid.New().String()
		categoryIDs[idx] = cID
		_, _ = pool.Exec(ctx, `
			INSERT INTO categories (id, restaurant_id, name_en, name_bn, sort, color, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, TRUE)
		`, cID, restID, c.nameEN, c.nameBN, idx+1, c.color)
	}

	// 12. 165+ Realistic Supermarket Products (Foodpanda / USA Super Mart Bangladesh catalogue inspiration)
	products := getSupermarketProducts()

	log.Printf("[Seed] Inserting %d supermarket retail products with barcodes, package sizes & discounts...", len(products))

	productIDs := []string{}
	for _, p := range products {
		pID := uuid.New().String()
		productIDs = append(productIDs, pID)
		catID := categoryIDs[p.CatIdx]

		_, err := pool.Exec(ctx, `
			INSERT INTO menu_items (
				id, restaurant_id, category_id, name_en, name_bn, sku, brand, unit, package_size,
				base_price_minor, regular_price_minor, cost_price_minor, tax_class, barcode,
				shelf_location, department, is_weighted, is_hot_deal, is_popular, is_new_arrival,
				track_stock, stock_quantity, reorder_level, is_available, is_active
			)
			VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9,
				$10, $11, $12, 'standard', $13,
				'Aisle 3, Shelf B', $14, $15, $16, $17, $18,
				$19, $20, 10, TRUE, TRUE
			)
		`,
			pID, restID, catID, p.NameEN, p.NameBN, p.SKU, p.Brand, p.Unit, p.PackageSize,
			p.SellPrice, p.RegPrice, p.CostPrice, p.Barcode,
			p.Dept, p.IsWeighted, p.IsHotDeal, p.IsPopular, p.IsNewArrival,
			true, p.Stock,
		)
		if err == nil {
			// Insert barcode lookup
			if p.Barcode != "" {
				_, _ = pool.Exec(ctx, `
					INSERT INTO product_barcodes (id, restaurant_id, product_id, barcode, is_primary)
					VALUES (gen_random_uuid(), $1, $2, $3, TRUE)
					ON CONFLICT DO NOTHING
				`, restID, pID, p.Barcode)
			}

			// Insert product batches and expiry dates (some within 7 days for alerts!)
			expDays := 45
			if p.IsHotDeal {
				expDays = 6 // near-expiry alert trigger
			}
			expDate := time.Now().AddDate(0, 0, expDays)
			batchNo := fmt.Sprintf("BATCH-%s-%03d", time.Now().Format("0601"), len(productIDs))
			_, _ = pool.Exec(ctx, `
				INSERT INTO product_batches (id, restaurant_id, branch_id, product_id, batch_no, exp_date, quantity, cost_price_minor)
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
			`, restID, branch1ID, pID, batchNo, expDate, p.Stock, p.CostPrice)
		}
	}

	// 13. Active Register Shift for Counter 01
	openShiftID := uuid.New().String()
	_, _ = pool.Exec(ctx, `
		INSERT INTO shifts (id, restaurant_id, branch_id, cashier_id, terminal_id, opened_at, opening_cash_minor, expected_cash_minor, status)
		VALUES ($1, $2, $3, $4, 'Counter 01', NOW() - INTERVAL '3 hours', 200000, 200000, 'open')
		ON CONFLICT DO NOTHING
	`, openShiftID, restID, branch1ID, cashierUserID)

	// 14. Historical Supermarket Sales (Past 14 Days)
	log.Println("[Seed] Generating 14 days of realistic supermarket checkout sales, invoice records & audit logs...")
	r := rand.New(rand.NewSource(99))
	now := time.Now()

	for dayOffset := 14; dayOffset >= 1; dayOffset-- {
		targetDate := now.AddDate(0, 0, -dayOffset)
		shiftID := uuid.New().String()
		openTime := time.Date(targetDate.Year(), targetDate.Month(), targetDate.Day(), 8, 30, 0, 0, targetDate.Location())
		closeTime := openTime.Add(14 * time.Hour)
		openingCash := int64(200000) // 2,000 BDT

		dailySalesCount := 8 + r.Intn(10)
		var shiftCashTotal int64 = 0

		_, _ = pool.Exec(ctx, `
			INSERT INTO shifts (id, restaurant_id, branch_id, cashier_id, terminal_id, opened_at, closed_at, opening_cash_minor, expected_cash_minor, counted_cash_minor, variance_minor, status)
			VALUES ($1, $2, $3, $4, 'Counter 01', $5, $6, $7, $7, $7, 0, 'closed')
		`, shiftID, restID, branch1ID, cashierUserID, openTime, closeTime, openingCash)

		for oIdx := 0; oIdx < dailySalesCount; oIdx++ {
			oID := uuid.New().String()
			orderNo := int64((14-dayOffset)*100 + oIdx + 1)
			orderTime := openTime.Add(time.Duration(oIdx*40) * time.Minute)

			// Pick 2-4 supermarket items
			itemCount := 2 + r.Intn(3)
			var subtotal int64 = 0

			oType := "walk_in"
			if r.Float64() < 0.2 {
				oType = "pickup"
			} else if r.Float64() < 0.15 {
				oType = "delivery"
			}

			// Insert Order
			_, _ = pool.Exec(ctx, `
				INSERT INTO orders (id, restaurant_id, branch_id, order_no, type, status, shift_id, opened_at, closed_at)
				VALUES ($1, $2, $3, $4, $5, 'paid', $6, $7, $7)
			`, oID, restID, branch1ID, orderNo, oType, shiftID, orderTime)

			for it := 0; it < itemCount; it++ {
				pIdx := r.Intn(len(products))
				prod := products[pIdx]
				prodID := productIDs[pIdx]
				qty := 1.0
				if prod.IsWeighted {
					qty = 0.5 + float64(r.Intn(4))*0.5
				}
				lineTotal := int64(float64(prod.SellPrice) * qty)
				subtotal += lineTotal

				_, _ = pool.Exec(ctx, `
					INSERT INTO order_items (id, restaurant_id, order_id, item_id, name_snapshot, qty, unit_price_minor, cost_minor_snapshot, status)
					VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'served')
				`, restID, oID, prodID, prod.NameEN, qty, prod.SellPrice, prod.CostPrice)
			}

			vat := subtotal * 5 / 100
			total := subtotal + vat

			// Update Order totals
			_, _ = pool.Exec(ctx, `
				UPDATE orders SET subtotal_minor = $1, tax_minor = $2, total_minor = $3, paid_minor = $3 WHERE id = $4
			`, subtotal, vat, total, oID)

			// Invoice
			invNo := fmt.Sprintf("BAN-%s-%04d", targetDate.Format("20060102"), oIdx+1)
			snapshotJSON := fmt.Sprintf(`{"order_no": %d, "invoice_no": "%s", "total": %d}`, orderNo, invNo, total)
			_, _ = pool.Exec(ctx, `
				INSERT INTO invoices (id, restaurant_id, branch_id, order_id, invoice_no, issued_at, snapshot)
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb)
			`, restID, branch1ID, oID, invNo, orderTime, snapshotJSON)

			// Payment
			pMethod := "cash"
			rnd := r.Float64()
			if rnd < 0.40 {
				pMethod = "bkash"
			} else if rnd < 0.65 {
				pMethod = "card"
			} else if rnd < 0.75 {
				pMethod = "nagad"
			}

			if pMethod == "cash" {
				shiftCashTotal += total
			}

			_, _ = pool.Exec(ctx, `
				INSERT INTO payments (id, restaurant_id, order_id, method_code, amount_minor, shift_id, paid_at)
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
			`, restID, oID, pMethod, total, shiftID, orderTime)
		}

		// Update shift totals
		_, _ = pool.Exec(ctx, "UPDATE shifts SET expected_cash_minor = $1, counted_cash_minor = $1 WHERE id = $2", openingCash+shiftCashTotal, shiftID)

		// Daily Supermarket Operating Expenses
		expAmt := int64(350000 + r.Intn(200000))
		_, _ = pool.Exec(ctx, `
			INSERT INTO expenses (id, restaurant_id, branch_id, category, amount_minor, date, note)
			VALUES (gen_random_uuid(), $1, $2, 'utilities', $3, $4::date, 'Supermarket refrigeration & store lighting')
		`, restID, branch1ID, expAmt, targetDate.Format("2006-01-02"))
	}

	log.Println("[Seed] NovaMart Super Shop seed completed successfully! 165+ products, 26 categories, registers & 14 days of history.")
	return nil
}

// 165+ realistic supermarket retail products based on Foodpanda / USA Super Mart Bangladesh catalogue
func getSupermarketProducts() []productSeed {
	return []productSeed{
		// 0: Daily Essentials
		{0, "Daily Essentials", "Teer", "Teer Refined Sugar", "তীর পরিশোধিত চিনি", "1 kg Bag", "kg", "ESS-SUG-001", "894110010001", 14500, 13800, 12000, 250, false, true, true, false},
		{0, "Daily Essentials", "Fresh", "Fresh Iodized Pure Salt", "ফ্রেশ আয়োডিনযুক্ত লবণ", "1 kg Pouch", "kg", "ESS-SLT-002", "894110010002", 4500, 4200, 3200, 300, false, false, true, false},
		{0, "Daily Essentials", "Aarong Dairy", "Aarong Dairy Brown Eggs (12 pcs)", "আড়ং ডেইরি লাল ডিম (১২টি)", "1 Dozen Box", "dozen", "ESS-EGG-003", "894110010003", 17500, 16000, 14000, 120, false, true, true, false},
		{0, "Daily Essentials", "Fresh", "Fresh Aush Ata (Wheat Flour)", "ফ্রেশ আটা", "2 kg Bag", "pack", "ESS-ATA-004", "894110010004", 13000, 12000, 10200, 180, false, false, true, false},
		{0, "Daily Essentials", "Teer", "Teer Maida (Refined Flour)", "তীর ময়দা", "1 kg Bag", "kg", "ESS-MAI-005", "894110010005", 7500, 7000, 5800, 140, false, false, false, false},
		{0, "Daily Essentials", "Pran", "Pran Red Lentil (Moshur Dal)", "প্রাণ মসুর ডাল", "1 kg Pouch", "kg", "ESS-DAL-006", "894110010006", 16000, 14800, 12800, 160, false, true, true, false},

		// 1: Fresh Fruits (Weighted & Packaged)
		{1, "Fresh Produce", "Farm Fresh", "Fuji Apples Imported", "আমদানিকৃত ফুজি আপেল", "Per kg", "kg", "FRU-APP-001", "894110010007", 34000, 31000, 26000, 85, true, true, true, false},
		{1, "Fresh Produce", "Farm Fresh", "Malta Sweet Orange (South Africa)", "মিষ্টি মাল্টা কমলা", "Per kg", "kg", "FRU-MAL-002", "894110010008", 29000, 26500, 22000, 95, true, false, true, false},
		{1, "Fresh Produce", "Local Farm", "Sagor Kola (Banana Pack of 4)", "তাজা সাগর কলা (৪টি)", "4 pcs", "pack", "FRU-BAN-003", "894110010009", 5000, 4500, 3200, 60, false, false, true, false},
		{1, "Fresh Produce", "Farm Fresh", "Pears Green (China)", "সবুজ নাশপাতি", "Per kg", "kg", "FRU-PEA-004", "894110010010", 38000, 35000, 29000, 45, true, false, false, true},
		{1, "Fresh Produce", "Farm Fresh", "Red Globe Grapes (Seedless)", "লাল আঙ্গুর (বীজহীন)", "500 gm Box", "box", "FRU-GRP-005", "894110010011", 32000, 29500, 24000, 40, false, true, false, false},
		{1, "Fresh Produce", "Local Farm", "Ripe Papaya (Sweet)", "পাকা পেঁপে", "Per kg", "kg", "FRU-PAP-006", "894110010012", 14000, 12000, 9000, 50, true, false, false, false},
		{1, "Fresh Produce", "Farm Fresh", "Green Guava (Kazi Peyara)", "কাজী পেয়ারা", "Per kg", "kg", "FRU-GUA-007", "894110010013", 11000, 9500, 7500, 70, true, false, true, false},

		// 2: Fresh Vegetables (Weighted)
		{2, "Fresh Produce", "Local Farm", "Local Red Potato (Deshi Gol Alu)", "দেশি লাল গোল আলু", "Per kg", "kg", "VEG-POT-001", "894110010014", 5500, 4800, 3800, 500, true, false, true, false},
		{2, "Fresh Produce", "Local Farm", "Deshi Red Onion (Peyaj)", "দেশি লাল পেঁয়াজ", "Per kg", "kg", "VEG-ONI-002", "894110010015", 9500, 8500, 7000, 450, true, true, true, false},
		{2, "Fresh Produce", "Local Farm", "Fresh Garlic Imported (Roshun)", "রসুন আমদানিকৃত", "Per kg", "kg", "VEG-GAR-003", "894110010016", 24000, 22000, 18000, 120, true, false, true, false},
		{2, "Fresh Produce", "Local Farm", "Fresh Ginger (Ada)", "তাজা আদা", "Per kg", "kg", "VEG-GIN-004", "894110010017", 26000, 23500, 19500, 110, true, false, false, false},
		{2, "Fresh Produce", "Local Farm", "Round Tomatoes Fresh", "গোল পাকা টমেটো", "Per kg", "kg", "VEG-TOM-005", "894110010018", 12000, 10500, 8500, 180, true, false, true, false},
		{2, "Fresh Produce", "Local Farm", "Green Hot Chili (Kacha Morich)", "কাঁচা মরিচ", "250 gm Pack", "pack", "VEG-CHL-006", "894110010019", 4000, 3500, 2500, 90, false, false, true, false},
		{2, "Fresh Produce", "Local Farm", "Green Cucumber (Shosha)", "তাজা শসা", "Per kg", "kg", "VEG-CUC-007", "894110010020", 7000, 6000, 4500, 140, true, false, false, false},
		{2, "Fresh Produce", "Local Farm", "Fresh Lemon (Kagoji Lebu 4 pcs)", "কাগজি লেবু (৪টি)", "4 pcs", "pack", "VEG-LEM-008", "894110010021", 3500, 3000, 2000, 80, false, false, true, false},
		{2, "Fresh Produce", "Local Farm", "Fresh Coriander Leaf (Dhone Pata)", "তাজা ধনে পাতা", "100 gm Bunch", "pack", "VEG-COR-009", "894110010022", 2000, 1500, 1000, 75, false, false, false, false},

		// 3: Meat & Poultry
		{3, "Meat & Poultry", "Bengal Meat", "Bengal Meat Premium Boneless Beef", "বেঙ্গল মিট প্রিমিয়াম হাড়ছাড়া গরুর মাংস", "1 kg Vacuum Pack", "kg", "MEA-BEF-001", "894110010023", 95000, 89000, 76000, 65, false, true, true, false},
		{3, "Meat & Poultry", "Bengal Meat", "Bengal Meat Beef with Bone", "বেঙ্গল মিট হাড়সহ গরুর মাংস", "1 kg Vacuum Pack", "kg", "MEA-BEF-002", "894110010024", 82000, 78000, 66000, 80, false, false, true, false},
		{3, "Meat & Poultry", "Kazi Farms", "Kazi Farms Fresh Dressed Broiler Chicken", "কাজী ফার্মস ড্রেসড ব্রয়লার মুরগি", "Per kg", "kg", "MEA-CHI-003", "894110010025", 24000, 21500, 18000, 140, true, true, true, false},
		{3, "Meat & Poultry", "Kazi Farms", "Kazi Farms Sonali Chicken", "কাজী ফার্মস সোনালী মুরগি", "Per kg", "kg", "MEA-CHI-004", "894110010026", 36000, 33000, 28000, 90, true, false, true, false},
		{3, "Meat & Poultry", "Bengal Meat", "Bengal Meat Mutton Curry Cut", "বেঙ্গল মিট খাসির মাংস", "1 kg Pack", "kg", "MEA-MUT-005", "894110010027", 125000, 118000, 102000, 40, false, false, false, true},
		{3, "Meat & Poultry", "Bengal Meat", "Chicken Breast Fillet Skinless", "স্কিনলেস চিকেন ব্রেস্ট ফিলেট", "500 gm Pack", "pack", "MEA-CHI-006", "894110010028", 32000, 29000, 24000, 50, false, false, true, false},

		// 4: Fish & Seafood
		{4, "Fish & Seafood", "Fisherman Catch", "Padma Hilsha Fish (1.0 kg - 1.2 kg)", "পদ্মার তাজা ইলিশ মাছ (১ কেজি)", "1 pc", "pcs", "FSH-HIL-001", "894110010029", 195000, 180000, 155000, 25, false, true, true, false},
		{4, "Fish & Seafood", "Fisherman Catch", "Fresh Rui Fish Whole Cleaned", "তাজা রুই মাছ গোটা", "Per kg", "kg", "FSH-RUI-002", "894110010030", 42000, 38000, 31000, 60, true, false, true, false},
		{4, "Fish & Seafood", "Fisherman Catch", "Fresh Katla Fish Steaks", "তাজা কাতলা মাছের টুকরা", "Per kg", "kg", "FSH-KAT-003", "894110010031", 45000, 40000, 33000, 45, true, false, false, false},
		{4, "Fish & Seafood", "Fisherman Catch", "Large Tiger Shrimp (Galda Chingri)", "গলদা চিংড়ি (বড়)", "Per kg", "kg", "FSH-SHR-004", "894110010032", 115000, 105000, 88000, 35, true, false, true, false},
		{4, "Fish & Seafood", "Fisherman Catch", "Pabda Fish Cleaned", "তাজা পাবদা মাছ", "500 gm Pack", "pack", "FSH-PAB-005", "894110010033", 48000, 43000, 35000, 30, false, false, false, true},

		// 5: Dairy, Chilled & Eggs
		{5, "Dairy & Eggs", "Aarong Dairy", "Aarong Pasteurized Liquid Milk", "আড়ং তরল দুধ", "1 Litre Pouch", "l", "DAI-MLK-001", "894110010034", 9500, 9000, 7800, 200, false, false, true, false},
		{5, "Dairy & Eggs", "Pran", "Pran Premium Pasteurized Milk", "প্রাণ লিকুইড মিল্ক", "1 Litre Pouch", "l", "DAI-MLK-002", "894110010035", 9500, 8800, 7600, 180, false, true, true, false},
		{5, "Dairy & Eggs", "Aarong Dairy", "Aarong Sour Curd (Tok Doi)", "আড়ং টক দই", "500 gm Tub", "tub", "DAI-DOI-003", "894110010036", 11000, 10000, 8200, 70, false, false, true, false},
		{5, "Dairy & Eggs", "Aarong Dairy", "Aarong Salted Table Butter", "আড়ং বাটার", "200 gm Foil", "pack", "DAI-BUT-004", "894110010037", 24000, 22000, 18500, 95, false, false, true, false},
		{5, "Dairy & Eggs", "Aarong Dairy", "Aarong Pure Cow Ghee", "আড়ং খাঁটি গাওয়া ঘি", "400 gm Glass Jar", "jar", "DAI-GHE-005", "894110010038", 68000, 64000, 54000, 50, false, true, true, false},
		{5, "Dairy & Eggs", "Dano", "Dano Daily Pushti Milk Powder", "ডানো ডেইলি পুষ্টি মিল্ক পাউডার", "1 kg Foil Bag", "pack", "DAI-POW-006", "894110010039", 78000, 74000, 64000, 80, false, false, true, false},
		{5, "Dairy & Eggs", "Diploma", "Diploma Full Cream Milk Powder", "ডিপ্লোমা ফুল ক্রিম গুঁড়ো দুধ", "500 gm Foil Bag", "pack", "DAI-POW-007", "894110010040", 49500, 47000, 41000, 75, false, false, true, false},
		{5, "Dairy & Eggs", "Amul", "Amul Processed Cheese Slices", "আমুল চিজ স্লাইস (১০ টুকরা)", "200 gm Pack", "pack", "DAI-CHS-008", "894110010041", 36000, 33500, 28000, 60, false, false, false, true},
		{5, "Dairy & Eggs", "Aarong Dairy", "Aarong Paneer (Cottage Cheese)", "আড়ং পনির", "250 gm Block", "pack", "DAI-PAN-009", "894110010042", 22000, 20500, 17000, 40, false, false, false, false},

		// 6: Bakery & Breakfast
		{6, "Bakery & Breakfast", "All Time", "All Time Premium White Bread", "অল টাইম স্লাইস পাউরুটি", "400 gm Loaf", "pack", "BAK-BRD-001", "894110010043", 6500, 6000, 4800, 110, false, false, true, false},
		{6, "Bakery & Breakfast", "All Time", "All Time Milk Bread Family Pack", "অল টাইম মিল্ক ব্রেড", "500 gm Loaf", "pack", "BAK-BRD-002", "894110010044", 8000, 7500, 6000, 85, false, false, true, false},
		{6, "Bakery & Breakfast", "Olympic", "Olympic Butter Bite Cookies", "অলিম্পিক বাটার বাইট বিস্কুট", "300 gm Box", "box", "BAK-BIS-003", "894110010045", 12000, 11000, 9000, 120, false, false, true, false},
		{6, "Bakery & Breakfast", "Kellogg's", "Kellogg's Corn Flakes Original", "কেলগস কর্ন ফ্লেক্স", "475 gm Box", "box", "BAK-CRN-004", "894110010046", 45000, 41000, 35000, 40, false, true, false, false},
		{6, "Bakery & Breakfast", "Quaker", "Quaker Rolled Oats Whole Grain", "কোয়েকার ওটস", "500 gm Pouch", "pack", "BAK-OAT-005", "894110010047", 34000, 31000, 26000, 55, false, false, true, false},
		{6, "Bakery & Breakfast", "Ahmed", "Ahmed Mixed Fruit Jam", "আহমেদ মিক্সড ফ্রুট জ্যাম", "500 gm Glass Jar", "jar", "BAK-JAM-006", "894110010048", 19000, 17500, 14000, 70, false, false, false, false},
		{6, "Bakery & Breakfast", "Danish", "Danish Sweet Toast Biscuits", "ড্যানিশ টোস্ট বিস্কুট", "350 gm Pack", "pack", "BAK-TST-007", "894110010049", 9000, 8000, 6500, 90, false, false, true, false},

		// 7: Beverages & Cold Drinks
		{7, "Beverages", "Coca-Cola", "Coca-Cola Original Taste Pet", "কোকা-কোলা পেট বোতল", "2 Litre Bottle", "bottle", "BEV-COK-001", "894110010050", 15000, 14000, 11500, 150, false, true, true, false},
		{7, "Beverages", "Coca-Cola", "Coca-Cola Classic Can", "কোকা-কোলা ক্যান", "250 ml Can", "can", "BEV-COK-002", "894110010051", 4500, 4000, 3200, 180, false, false, true, false},
		{7, "Beverages", "Sprite", "Sprite Lemon Lime Soda", "স্প্রাইট সফট ড্রিংক", "1.25 Litre Bottle", "bottle", "BEV-SPR-003", "894110010052", 9500, 8800, 7200, 130, false, false, true, false},
		{7, "Beverages", "7Up", "7Up Refreshing Pet Bottle", "সেভেন আপ", "2 Litre Bottle", "bottle", "BEV-7UP-004", "894110010053", 15000, 14000, 11500, 110, false, false, true, false},
		{7, "Beverages", "Pran", "Pran Frooto Mango Fruit Drink", "প্রাণ ফ্রুটো ম্যাঙ্গো জুস", "1 Litre Bottle", "bottle", "BEV-FRU-005", "894110010054", 9000, 8000, 6500, 140, false, true, true, false},
		{7, "Beverages", "Mum", "Mum Purified Drinking Mineral Water", "মাম মিনারেল ড্রিংকিং ওয়াটার", "500 ml Bottle", "bottle", "BEV-WAT-006", "894110010055", 2000, 2000, 1400, 350, false, false, true, false},
		{7, "Beverages", "Mum", "Mum Mineral Water Large", "মাম মিনারেল ওয়াটার ৫ লিটার", "5 Litre Can", "bottle", "BEV-WAT-007", "894110010056", 8500, 8000, 6200, 90, false, false, true, false},
		{7, "Beverages", "Red Bull", "Red Bull Energy Drink", "রেড বুল এনার্জি ড্রিংক", "250 ml Can", "can", "BEV-ENG-008", "894110010057", 22000, 19500, 16000, 65, false, true, false, true},
		{7, "Beverages", "Mojo", "Mojo Cola Bangladesh", "মোজো কোলা", "500 ml Bottle", "bottle", "BEV-MOJ-009", "894110010058", 3500, 3000, 2300, 200, false, false, true, false},

		// 8: Tea & Coffee
		{8, "Beverages", "Ispahani", "Ispahani Mirzapore Best Leaf Tea", "ইস্পাহানি মির্জাপুর বেস্ট লিফ চা", "400 gm Foil Pack", "pack", "TEA-ISP-001", "894110010059", 24000, 22500, 19000, 130, false, false, true, false},
		{8, "Beverages", "Taaza", "Brooke Bond Taaza Black Tea", "ব্রুক বন্ড তাজা ব্ল্যাক টি", "400 gm Pack", "pack", "TEA-TAZ-002", "894110010060", 23000, 21500, 18000, 110, false, false, true, false},
		{8, "Beverages", "Nescafé", "Nescafé Classic Instant Coffee Jar", "নেসক্যাফে ক্লাসিক কফি জার", "100 gm Glass Jar", "jar", "COF-NES-003", "894110010061", 48000, 44000, 37000, 75, false, true, true, false},
		{8, "Beverages", "Nescafé", "Nescafé 3 in 1 Coffee Sachets (24 pcs)", "নেসক্যাফে ৩ ইন ১ স্যাচেট", "24 Sachets Pack", "pack", "COF-NES-004", "894110010062", 42000, 39000, 32000, 60, false, false, true, false},
		{8, "Beverages", "Tetley", "Tetley Pure Green Tea Bags (50 pcs)", "টেটলি গ্রিন টি ব্যাগ", "50 Tea Bags Box", "box", "TEA-TET-005", "894110010063", 26000, 23500, 19500, 50, false, false, false, true},

		// 9: Ice Cream & Desserts
		{9, "Frozen & Desserts", "Igloo", "Igloo Vanilla Ice Cream Tub", "ইগলু ভ্যানিলা আইসক্রিম", "1 Litre Tub", "tub", "ICE-IGL-001", "894110010064", 32000, 29000, 23000, 45, false, false, true, false},
		{9, "Frozen & Desserts", "Polar", "Polar Chocolate Crunch Ice Cream", "পোলার চকলেট ক্রাঞ্চ আইসক্রিম", "1 Litre Tub", "tub", "ICE-POL-002", "894110010065", 36000, 33000, 26000, 40, false, true, true, false},
		{9, "Frozen & Desserts", "Igloo", "Igloo Chocobar Ice Cream Stick", "ইগলু চকোবার আইসক্রিম", "1 pc", "pcs", "ICE-IGL-003", "894110010066", 5000, 4500, 3200, 80, false, false, true, false},
		{9, "Frozen & Desserts", "Zafrani", "Meena Sweets Shahi Rosogolla Can", "শাহী রসগোল্লা ক্যান", "1 kg Tin", "can", "SWT-MEA-004", "894110010067", 45000, 42000, 34000, 35, false, false, true, false},
		{9, "Frozen & Desserts", "Pran", "Pran Gulab Jamun Can", "প্রাণ গোলাপ জামুন টিন", "1 kg Tin", "can", "SWT-PRA-005", "894110010068", 42000, 38500, 31000, 30, false, false, false, false},

		// 10: Chocolates & Candy
		{10, "Snacks & Sweets", "Cadbury", "Cadbury Dairy Milk Silk Chocolate", "ক্যাডবেরি ডেইরি মিল্ক সিল্ক", "150 gm Bar", "bar", "CHO-CAD-001", "894110010069", 32000, 29000, 24000, 90, false, true, true, false},
		{10, "Snacks & Sweets", "Cadbury", "Cadbury Dairy Milk Fruit & Nut", "ক্যাডবেরি ফ্রুট অ্যান্ড নাট", "80 gm Bar", "bar", "CHO-CAD-002", "894110010070", 18000, 16500, 13500, 85, false, false, true, false},
		{10, "Snacks & Sweets", "Nestlé", "KitKat 4 Finger Crispy Wafer", "কিটক্যাট চকলেট ফোর ফিঙ্গার", "38 gm Bar", "bar", "CHO-KIT-003", "894110010071", 6500, 6000, 4800, 150, false, false, true, false},
		{10, "Snacks & Sweets", "Ferrero", "Ferrero Rocher T8 Hazelnut Gift Box", "ফেরেরো রোশার চকলেট বক্স", "8 pcs Box", "box", "CHO-FER-004", "894110010072", 68000, 62000, 51000, 30, false, true, false, true},
		{10, "Snacks & Sweets", "Snickers", "Snickers Peanut Caramel Bar", "স্নিকার্স চকলেট বার", "50 gm Bar", "bar", "CHO-SNI-005", "894110010073", 9000, 8000, 6400, 110, false, false, true, false},
		{10, "Snacks & Sweets", "Mentos", "Mentos Mint Candy Roll", "মেন্থস মিন্ট ক্যান্ডি", "37 gm Roll", "pcs", "CND-MEN-006", "894110010074", 2500, 2500, 1800, 200, false, false, false, false},

		// 11: Snacks & Biscuits
		{11, "Snacks & Biscuits", "Lay's", "Lay's Classic Salted Potato Chips", "লেয়েস ক্লাসিক সল্টেড চিপস", "50 gm Pack", "pack", "SNA-LAY-001", "894110010075", 4000, 3500, 2800, 160, false, false, true, false},
		{11, "Snacks & Biscuits", "Kurkure", "Kurkure Masala Munch Crunchy", "কুরকুরে মসলা মাঞ্চ", "65 gm Pack", "pack", "SNA-KUR-002", "894110010076", 3000, 2800, 2100, 140, false, false, true, false},
		{11, "Snacks & Biscuits", "Bombay Sweets", "Bombay Sweets Ring Chips (Potato)", "বোম্বে সুইটস রিং চিপস", "25 gm Pack", "pack", "SNA-BOM-003", "894110010077", 2000, 2000, 1500, 220, false, false, true, false},
		{11, "Snacks & Biscuits", "Pran", "Pran Chanachur Spicy Hot Mix", "প্রাণ ঝাল চানাচুর", "300 gm Pack", "pack", "SNA-PRA-004", "894110010078", 9000, 8000, 6400, 130, false, true, true, false},
		{11, "Snacks & Biscuits", "Olympic", "Olympic Energy Plus Glucose Biscuits", "অলিম্পিক এনার্জি প্লাস বিস্কুট", "300 gm Pack", "pack", "BIS-OLY-005", "894110010079", 6000, 5500, 4200, 150, false, false, true, false},
		{11, "Snacks & Biscuits", "Oreo", "Cadbury Oreo Original Vanilla Cream", "ওরিও ভ্যানিলা ক্রিম বিস্কুট", "120 gm Pack", "pack", "BIS-ORE-006", "894110010080", 5000, 4500, 3600, 140, false, false, true, false},
		{11, "Snacks & Biscuits", "Nutty", "Pran Roasted Salted Cashews", "প্রাণ রোস্টেড কাজুবাদাম", "150 gm Pouch", "pack", "SNA-NUT-007", "894110010081", 38000, 35000, 29000, 45, false, false, false, true},

		// 12: Frozen & Ready Meals
		{12, "Frozen Foods", "Kazi Farms", "Kazi Farms Kitchen Chicken Nuggets", "কাজী ফার্মস চিকেন নাগেটস", "500 gm Pack", "pack", "FRZ-KAZ-001", "894110010082", 36000, 32500, 26500, 60, false, true, true, false},
		{12, "Frozen Foods", "Kazi Farms", "Kazi Farms Chicken Plain Paratha", "কাজী ফার্মস ফ্রোজেন পরোটা", "10 pcs Pack", "pack", "FRZ-KAZ-002", "894110010083", 18000, 16000, 13000, 75, false, false, true, false},
		{12, "Frozen Foods", "CP", "CP Five Star Fried Chicken Drumsticks", "সিপি ফ্রাইড চিকেন ড্রামস্টিক", "4 pcs Pack", "pack", "FRZ-CP-003", "894110010084", 28000, 25500, 21000, 40, false, false, true, false},
		{12, "Frozen Foods", "Golden Harvest", "Golden Harvest Vegetable Spring Rolls", "ভেজিটেবল স্প্রিং রোল", "10 pcs Pack", "pack", "FRZ-GLD-004", "894110010085", 19000, 17000, 13800, 45, false, false, false, false},
		{12, "Frozen Foods", "Kazi Farms", "Kazi Farms Crispy Chicken Popcorn", "চিকেন পপকর্ন ফ্রোজেন", "250 gm Pack", "pack", "FRZ-KAZ-005", "894110010086", 21000, 18500, 15000, 50, false, true, false, true},

		// 13: Rice, Flours & Grains
		{13, "Grains & Flours", "Pran", "Pran Chinigura Premium Aromatic Rice", "প্রাণ চিনিগুড়া সুগন্ধি চাল", "1 kg Bag", "kg", "RIC-PRA-001", "894110010087", 17500, 16000, 13500, 180, false, true, true, false},
		{13, "Grains & Flours", "Teer", "Teer Nazirshail Premium Polished Rice", "তীর নাজিরশাইল চাল প্রিমিয়াম", "5 kg Bag", "pack", "RIC-TEE-002", "894110010088", 43000, 39500, 34000, 95, false, false, true, false},
		{13, "Grains & Flours", "Fresh", "Fresh Miniket Rice High Quality", "ফ্রেশ মিনিকেট চাল", "5 kg Bag", "pack", "RIC-FRE-003", "894110010089", 39000, 36500, 31000, 120, false, false, true, false},
		{13, "Grains & Flours", "Daawat", "Daawat Traditional Basmati Rice", "দাওয়াত বাসমতী চাল", "1 kg Pouch", "kg", "RIC-DAA-004", "894110010090", 35000, 31500, 26000, 70, false, true, false, false},
		{13, "Grains & Flours", "Pran", "Pran Yellow Moong Dal Split", "প্রাণ হলুদ মুগ ডাল", "1 kg Pack", "kg", "RIC-DAL-005", "894110010091", 19500, 18000, 15000, 85, false, false, true, false},
		{13, "Grains & Flours", "Fresh", "Fresh Chola Boot (Gram Chickpeas)", "ফ্রেশ আস্ত ছোলা বুট", "1 kg Pack", "kg", "RIC-CHO-006", "894110010092", 14000, 12500, 10500, 100, false, false, false, false},

		// 14: Cooking Oils & Ghee
		{14, "Oils & Ghee", "Rupchanda", "Rupchanda Fortified Soybean Oil", "রুপচাঁদা ফর্টিফাইড সয়াবিন তেল", "5 Litre Pet Bottle", "bottle", "OIL-RUP-001", "894110010093", 94000, 89500, 81000, 90, false, true, true, false},
		{14, "Oils & Ghee", "Fresh", "Fresh Refined Soybean Oil", "ফ্রেশ সয়াবিন তেল", "2 Litre Bottle", "bottle", "OIL-FRE-002", "894110010094", 38000, 36000, 32500, 140, false, false, true, false},
		{14, "Oils & Ghee", "Teer", "Teer Pure Soybean Oil", "তীর সয়াবিন তেল", "1 Litre Bottle", "bottle", "OIL-TEE-003", "894110010095", 19000, 18200, 16500, 180, false, false, true, false},
		{14, "Oils & Ghee", "Radhuni", "Radhuni Pure Mustard Oil (Ghani)", "রাধুনি খাঁটি সরিষার তেল (ঘানি ভাঙ্গা)", "1 Litre Pet Bottle", "bottle", "OIL-RAD-004", "894110010096", 36000, 33500, 29000, 95, false, true, true, false},
		{14, "Oils & Ghee", "Pran", "Pran Mustard Oil Spicy Flavor", "প্রাণ সরিষার তেল", "500 ml Bottle", "bottle", "OIL-PRA-005", "894110010097", 19000, 17500, 15000, 110, false, false, true, false},
		{14, "Oils & Ghee", "Borges", "Borges Extra Virgin Olive Oil", "বোর্হেস এক্সট্রা ভার্জিন অলিভ অয়েল", "500 ml Glass Bottle", "bottle", "OIL-BOR-006", "894110010098", 115000, 105000, 91000, 35, false, false, false, true},

		// 15: Spices & Seasonings
		{15, "Spices & Cooking", "Radhuni", "Radhuni Turmeric Powder (Holud)", "রাধুনি হলুদ গুঁড়া", "200 gm Foil Pack", "pack", "SPI-RAD-001", "894110010099", 9500, 8800, 7200, 150, false, false, true, false},
		{15, "Spices & Cooking", "Radhuni", "Radhuni Chili Powder (Morich)", "রাধুনি মরিচ গুঁড়া", "200 gm Foil Pack", "pack", "SPI-RAD-002", "894110010100", 11500, 10500, 8600, 140, false, false, true, false},
		{15, "Spices & Cooking", "Radhuni", "Radhuni Cumin Powder (Jira)", "রাধুনি জিরা গুঁড়া", "100 gm Foil Pack", "pack", "SPI-RAD-003", "894110010101", 16000, 14500, 12000, 120, false, true, true, false},
		{15, "Spices & Cooking", "Radhuni", "Radhuni Coriander Powder (Dhone)", "রাধুনি ধনে গুঁড়া", "200 gm Pack", "pack", "SPI-RAD-004", "894110010102", 8500, 7800, 6300, 110, false, false, false, false},
		{15, "Spices & Cooking", "Radhuni", "Radhuni Beef Biryani Masala", "রাধুনি বিফ বিরিয়ানি মশলা", "40 gm Box", "box", "SPI-RAD-005", "894110010103", 6500, 6000, 4800, 160, false, false, true, false},
		{15, "Spices & Cooking", "Radhuni", "Radhuni Garam Masala Mix", "রাধুনি গরম মশলা গুঁড়া", "50 gm Box", "box", "SPI-RAD-006", "894110010104", 9000, 8200, 6700, 90, false, false, false, false},
		{15, "Spices & Cooking", "Fresh", "Whole Black Cardamom (Boro Elach)", "বড় কালো এলাচ", "50 gm Pack", "pack", "SPI-ELA-007", "894110010105", 22000, 19500, 16000, 45, false, false, false, true},

		// 16: Sauces, Pickles & Spreads
		{16, "Condiments", "Maggi", "Maggi Rich Tomato Ketchup", "ম্যাগি টমেটো কেচাপ", "1 kg Squeeze Bottle", "bottle", "CON-MAG-001", "894110010106", 32000, 29000, 24000, 85, false, true, true, false},
		{16, "Condiments", "Pran", "Pran Hot Tomato Sauce Bottle", "প্রাণ টমেটো সস", "500 gm Glass Bottle", "bottle", "CON-PRA-002", "894110010107", 14000, 12500, 10000, 120, false, false, true, false},
		{16, "Condiments", "Radhuni", "Radhuni Green Mango Pickle (Amer Achar)", "রাধুনি আমের টক-ঝাল আচার", "400 gm Glass Jar", "jar", "CON-RAD-003", "894110010108", 16500, 15000, 12000, 75, false, false, true, false},
		{16, "Condiments", "Ahmed", "Ahmed Chilli Garlic Sauce", "আহমেদ চিলি গার্লিক সস", "340 gm Bottle", "bottle", "CON-AHM-004", "894110010109", 15000, 13500, 10800, 65, false, false, false, false},
		{16, "Condiments", "Nutella", "Nutella Hazelnut Cocoa Spread", "নুটেলা হ্যাজেলনাট স্প্রেড", "350 gm Jar", "jar", "CON-NUT-005", "894110010110", 62000, 56000, 46000, 40, false, true, true, false},
		{16, "Condiments", "American Garden", "American Garden Creamy Peanut Butter", "আমেরিকান গার্ডেন পিনাট বাটার", "454 gm Jar", "jar", "CON-AMG-006", "894110010111", 52000, 47000, 39000, 35, false, false, false, true},

		// 17: Noodles, Pasta & Soups
		{17, "Instant Foods", "Maggi", "Maggi 2-Minute Masala Noodles (8 Pack)", "ম্যাগি মসলা নুডলস (৮টি প্যাক)", "8 Packs Family Pack", "pack", "NDL-MAG-001", "894110010112", 20000, 18500, 15000, 140, false, true, true, false},
		{17, "Instant Foods", "Cocola", "Cocola Egg & Chicken Noodles", "কোকোলা এগ চিকেন নুডলস", "8 Packs Family Pack", "pack", "NDL-COC-002", "894110010113", 16000, 14500, 12000, 130, false, false, true, false},
		{17, "Instant Foods", "Samyang", "Samyang Buldak 2X Spicy Hot Chicken Noodles", "সামিয়াং বুলদাক ২এক্স হট স্পাইসি নুডলস", "140 gm Pack", "pack", "NDL-SAM-003", "894110010114", 19000, 16500, 13000, 80, false, true, true, true},
		{17, "Instant Foods", "Barilla", "Barilla Penne Rigate Italian Pasta", "বারিলা ইতালিয়ান পেনে পাস্তা", "500 gm Box", "box", "NDL-BAR-004", "894110010115", 34000, 30000, 24500, 45, false, false, false, true},
		{17, "Instant Foods", "Knorr", "Knorr Classic Chicken Corn Soup", "নর চিকেন কর্ন স্যুপ", "42 gm Sachet", "pack", "NDL-KNO-005", "894110010116", 5500, 5000, 3900, 110, false, false, true, false},

		// 18: Cleaning & Laundry
		{18, "Household & Cleaning", "Surf Excel", "Surf Excel Quick Wash Detergent Powder", "সার্ফ এক্সেল কুইক ওয়াশ ডিটারজেন্ট", "1 kg Pouch", "pack", "CLN-SRF-001", "894110010117", 29000, 26500, 22500, 150, false, true, true, false},
		{18, "Household & Cleaning", "Rin", "Rin Advanced Washing Powder Lemon", "রিন অ্যাডভান্সড ওয়াশিং পাউডার", "1 kg Bag", "pack", "CLN-RIN-002", "894110010118", 17000, 15500, 13000, 130, false, false, true, false},
		{18, "Household & Cleaning", "Vim", "Vim Lemon Dishwash Liquid Bottle", "ভিম লেমন ডিশওয়াশ লিকুইড", "500 ml Bottle", "bottle", "CLN-VIM-003", "894110010119", 14500, 13000, 10500, 140, false, false, true, false},
		{18, "Household & Cleaning", "Harpic", "Harpic Power Plus Toilet Cleaner Blue", "হারপিক পাওয়ার প্লাস টয়লেট ক্লিনার", "750 ml Bottle", "bottle", "CLN-HAR-004", "894110010120", 19500, 17500, 14500, 160, false, true, true, false},
		{18, "Household & Cleaning", "Savlon", "Savlon Antiseptic Liquid Disinfectant", "স্যাভলন এন্টিসেপটিক লিকুইড", "500 ml Bottle", "bottle", "CLN-SAV-005", "894110010121", 28000, 25500, 21500, 110, false, false, true, false},
		{18, "Household & Cleaning", "Lizol", "Lizol Citrus Floral Floor Cleaner", "লাইজল ফ্লোর ক্লিনার", "500 ml Bottle", "bottle", "CLN-LIZ-006", "894110010122", 18000, 16000, 13000, 95, false, false, false, false},

		// 19: Household Essentials
		{19, "Household & Cleaning", "Bashundhara", "Bashundhara Facial Tissue Box (Soft)", "বসুন্ধরা ফেসিয়াল টিস্যু", "120 Pulls Box", "box", "HOU-BAS-001", "894110010123", 8500, 7500, 6000, 180, false, false, true, false},
		{19, "Household & Cleaning", "Bashundhara", "Bashundhara Kitchen Towel Tissue Roll", "বসুন্ধরা কিচেন টাওয়েল রোল (২টি)", "2 Rolls Pack", "pack", "HOU-BAS-002", "894110010124", 13000, 11500, 9200, 110, false, false, true, false},
		{19, "Household & Cleaning", "Fay", "Fay Deluxe Toilet Tissue Roll (4 Pack)", "ফে টয়লেট টিস্যু রোল", "4 Rolls Pack", "pack", "HOU-FAY-003", "894110010125", 14000, 12500, 10000, 120, false, false, true, false},
		{19, "Household & Cleaning", "Good Knight", "Good Knight Gold Flash Mosquito Refill", "গুড নাইট গোল্ড লিকুইড রিফিল", "45 ml Bottle", "bottle", "HOU-GKN-004", "894110010126", 11000, 9500, 7800, 90, false, true, true, false},
		{19, "Household & Cleaning", "Mortein", "Mortein Powergard Mosquito Aerosol Spray", "মর্টিন পাওয়ারগার্ড অ্যারোসল স্প্রে", "475 ml Can", "can", "HOU-MOR-005", "894110010127", 38000, 34000, 28000, 70, false, false, false, false},

		// 20: Personal Care & Bath
		{20, "Personal Care", "Lux", "Lux Soft Rose Beauty Soap (3 Pack)", "লাক্স সফট রোজ বিউটি সাবান (৩টি)", "3 x 100 gm Pack", "pack", "PER-LUX-001", "894110010128", 19500, 17500, 14200, 140, false, true, true, false},
		{20, "Personal Care", "Dettol", "Dettol Original Germ Protection Soap", "ডেটোল অরিজিনাল সাবান", "3 x 125 gm Pack", "pack", "PER-DET-002", "894110010129", 22500, 20500, 17000, 160, false, false, true, false},
		{20, "Personal Care", "Sunsilk", "Sunsilk Black Shine Shampoo", "সানসিল্ক ব্ল্যাক শাইন শ্যাম্পু", "375 ml Bottle", "bottle", "PER-SUN-003", "894110010130", 42000, 38000, 31500, 95, false, false, true, false},
		{20, "Personal Care", "Head & Shoulders", "Head & Shoulders Anti-Dandruff Cool Menthol", "হেড অ্যান্ড শোল্ডারস কুল মেন্থল শ্যাম্পু", "340 ml Bottle", "bottle", "PER-HNS-004", "894110010131", 55000, 49500, 41000, 75, false, true, true, false},
		{20, "Personal Care", "Dove", "Dove Deep Moisture Nourishing Body Wash", "ডোভ ডিপ ময়েশ্চার বডি ওয়াশ", "450 ml Pump", "bottle", "PER-DOV-005", "894110010132", 68000, 61000, 51000, 50, false, false, false, true},
		{20, "Personal Care", "Parachute", "Parachute 100% Pure Coconut Oil", "প্যারাস্যুট নারকেল তেল", "350 ml Bottle", "bottle", "PER-PAR-006", "894110010133", 26000, 24000, 20000, 120, false, false, true, false},

		// 21: Oral Care & Grooming
		{21, "Personal Care", "Colgate", "Colgate Total 12 Whole Mouth Health Paste", "কোলগেট টোটাল ১২ টুথপেস্ট", "120 gm Tube", "tube", "ORL-COL-001", "894110010134", 17500, 15500, 12800, 130, false, false, true, false},
		{21, "Personal Care", "CloseUp", "CloseUp Red Hot Ever-Fresh Gel Toothpaste", "ক্লোজআপ রেড হট জেল টুথপেস্ট", "150 gm Tube", "tube", "ORL-CLO-002", "894110010135", 16000, 14200, 11800, 140, false, true, true, false},
		{21, "Personal Care", "Oral-B", "Oral-B Shiny Clean Toothbrush (Medium 3 pcs)", "ওরাল-বি টুথব্রাশ (৩টি প্যাক)", "3 pcs Pack", "pack", "ORL-ORB-003", "894110010136", 18000, 15500, 12000, 85, false, false, true, false},
		{21, "Personal Care", "Listerine", "Listerine Cool Mint Antiseptic Mouthwash", "লিস্টারিন কুল মিন্ট মাউথওয়াশ", "250 ml Bottle", "bottle", "ORL-LIS-004", "894110010137", 29000, 26000, 21000, 60, false, false, false, false},
		{21, "Personal Care", "Gillette", "Gillette Mach 3 Razor with Blade", "জিলেট ম্যাক ৩ রেজার", "1 pc Pack", "pack", "GRO-GIL-005", "894110010138", 45000, 41000, 33500, 40, false, false, false, true},

		// 22: Health & Wellness
		{22, "Health & Pharmacy", "Square", "Napa Extra 500mg/65mg (Paracetamol & Caffeine)", "নাপা এক্সট্রা ট্যাবলেট (বক্স)", "10 Strip Box", "box", "HLT-NAP-001", "894110010139", 25000, 24000, 20000, 80, false, false, true, false},
		{22, "Health & Pharmacy", "Square", "Seclo 20mg Capsule (Omeprazole)", "সেকলো ২০ মিগ্রা ক্যাপসুল", "10 Strips Box", "box", "HLT-SEC-002", "894110010140", 50000, 48000, 40000, 70, false, false, true, false},
		{22, "Health & Pharmacy", "Horlicks", "Horlicks Classic Malt Health Drink Refill", "হরলিক্স ক্লাসিক হেলথ ড্রিংক", "500 gm Refill", "pack", "HLT-HOR-003", "894110010141", 38000, 35000, 29000, 95, false, true, true, false},
		{22, "Health & Pharmacy", "Dettol", "Dettol Plaster Waterproof Bandages (20 pcs)", "ডেটোল ওয়াটারপ্রুফ প্লাস্টার", "20 Strips Box", "box", "HLT-DET-004", "894110010142", 12000, 10500, 8200, 65, false, false, false, false},

		// 23: Baby Care & Diapers
		{23, "Baby & Child Care", "Pampers", "Pampers Baby Dry Pants Medium (M)", "প্যাম্পার্স বেবি ড্রাই প্যান্টস এম", "48 pcs Pack", "pack", "BAB-PAM-001", "894110010143", 165000, 149000, 126000, 40, false, true, true, false},
		{23, "Baby & Child Care", "Twinkle", "Twinkle Baby Pant Diaper Large (L)", "টুইংকল বেবি প্যান্ট ডায়াপার এল", "36 pcs Pack", "pack", "BAB-TWI-002", "894110010144", 98000, 89000, 74000, 60, false, false, true, false},
		{23, "Baby & Child Care", "Johnson's", "Johnson's Baby Bath Gentle Wash", "জনসনস বেবি বাথ ওয়াশ", "500 ml Pump", "bottle", "BAB-JHN-003", "894110010145", 58000, 52000, 43000, 45, false, false, true, false},
		{23, "Baby & Child Care", "Johnson's", "Johnson's Baby Powder Floral Fresh", "জনসনস বেবি পাউডার", "200 gm Bottle", "bottle", "BAB-JHN-004", "894110010146", 26000, 23500, 19000, 70, false, false, false, false},
		{23, "Baby & Child Care", "Nestlé", "Nestlé Cerelac Wheat Apple Infant Cereal", "নেসলে সেরেলাক গম ও আপেল", "400 gm Tin", "tin", "BAB-CER-005", "894110010147", 42000, 39000, 33000, 55, false, false, true, false},
		{23, "Baby & Child Care", "Johnson's", "Johnson's Baby Wet Wipes Fragrance Free", "জনসনস বেবি ওয়েট ওয়াইপস", "80 Wipes Pack", "pack", "BAB-WIP-006", "894110010148", 29000, 26000, 21000, 80, false, false, true, false},

		// 24: Pet Supplies
		{24, "Pet Care", "Whiskas", "Whiskas Ocean Fish Dry Cat Food", "হুইসকাস ক্যাট ফুড ওশান ফিশ", "1.2 kg Bag", "pack", "PET-WHI-001", "894110010149", 75000, 69000, 57000, 35, false, true, true, false},
		{24, "Pet Care", "Pedigree", "Pedigree Adult Chicken & Vegetables Dog Food", "পেডিগ্রি অ্যাডাল্ট ডগ ফুড", "1.2 kg Bag", "pack", "PET-PED-002", "894110010150", 68000, 62000, 51000, 30, false, false, true, false},
		{24, "Pet Care", "Me-O", "Me-O Creamy Cat Treats Salmon Flavor", "মি-ও ক্রিমি ক্যাট ট্রিটস", "4 x 15g Pack", "pack", "PET-MEO-003", "894110010151", 16000, 14000, 11200, 50, false, false, false, true},
		{24, "Pet Care", "SmartCat", "Bentonite Lavender Clumping Cat Litter", "স্মার্টক্যাট ল্যাভেন্ডার ক্যাট লিটার", "5 Litre Bag", "bag", "PET-LIT-004", "894110010152", 45000, 39500, 31000, 40, false, false, true, false},

		// 25: Stationery & Office
		{25, "Stationery", "Matador", "Matador Orbit Ball Pen Blue (Box of 20)", "ম্যাটাডোর অরবিট বলপেন (২০টি বক্স)", "20 pcs Box", "box", "STA-MAT-001", "894110010153", 12000, 10500, 8200, 120, false, false, true, false},
		{25, "Stationery", "Bashundhara", "Bashundhara Exercise Khata Ruled", "বসুন্ধরা খাতা রুলড", "120 Pages Book", "pcs", "STA-KHA-002", "894110010154", 6000, 5000, 3800, 150, false, false, true, false},
		{25, "Stationery", "Double A", "Double A A4 Copy Paper 80 GSM (500 Sheets)", "ডাবল এ এ৪ ফটোকপি পেপার রিম", "500 Sheets Ream", "pack", "STA-PAP-003", "894110010155", 62000, 58000, 48000, 60, false, true, true, false},
		{25, "Stationery", "Energizer", "Energizer Max AA Alkaline Batteries (4 Pack)", "এনার্জাইজার ম্যাক্স এএ ব্যাটারি (৪টি)", "4 pcs Pack", "pack", "STA-BAT-004", "894110010156", 28000, 25000, 20500, 75, false, false, true, false},
		{25, "Stationery", "Fevicol", "Fevicol MR Squeeze Bottle All Purpose Glue", "ফেভিকল এমআর আঠা", "100 gm Bottle", "bottle", "STA-FEV-005", "894110010157", 6500, 5500, 4200, 85, false, false, false, false},

		// Low Stock / Out of Stock Edge Cases for Testing Alerts
		{0, "Daily Essentials", "Pure Life", "Pure Life Himalayan Pink Rock Salt", "হিমালয়ান পিঙ্ক রক সল্ট", "500 gm Jar", "jar", "ESS-PNK-007", "894110010158", 22000, 19500, 15000, 3, false, true, false, false},              // Low Stock (3 <= 10)
		{8, "Beverages", "Twinings", "Twinings English Breakfast Tea Tin", "টুইনিংস ইংলিশ ব্রেকফাস্ট টি টিন", "100 gm Tin", "tin", "TEA-TWI-006", "894110010159", 65000, 59000, 49000, 4, false, false, false, false},             // Low Stock (4 <= 10)
		{10, "Snacks & Sweets", "Lindt", "Lindt Excellence 85% Dark Chocolate Cocoa", "লিন্ডট এক্সিলেন্স ৮৫% ডার্ক চকলেট", "100 gm Bar", "bar", "CHO-LIN-007", "894110010160", 45000, 41000, 34000, 0, false, false, true, false}, // Out of Stock (0)
		{14, "Oils & Ghee", "Olitalia", "Olitalia Pomace Olive Oil Cooking Grade", "অলিটালিয়া পোমাস অলিভ অয়েল", "1 Litre Tin", "tin", "OIL-OLI-007", "894110010161", 145000, 135000, 115000, 0, false, false, false, false},     // Out of Stock (0)
		{12, "Frozen Foods", "Kazi Farms", "Kazi Farms Chicken Shami Kebab", "কাজী ফার্মস চিকেন শামী কাবাব", "10 pcs Pack", "pack", "FRZ-KAZ-006", "894110010162", 26000, 23500, 19000, 5, false, true, false, false},             // Low Stock (5 <= 10)
	}
}
