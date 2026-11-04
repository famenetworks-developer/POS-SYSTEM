package reports

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
)

type ReportService struct {
	pool *pgxpool.Pool
}

func NewReportService(pool *pgxpool.Pool) *ReportService {
	return &ReportService{pool: pool}
}

func (s *ReportService) MountRoutes(r chi.Router) {
	// Dashboard KPIs
	r.Get("/reports/dashboard", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")

		// 1. Today sales and orders
		var todaySalesMinor int64 = 0
		var todayOrders int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(total_minor), 0), COUNT(*)
			FROM orders
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND status = 'paid' AND opened_at >= CURRENT_DATE
		`, restID, branchID).Scan(&todaySalesMinor, &todayOrders)

		var todayAvgBillMinor int64 = 0
		if todayOrders > 0 {
			todayAvgBillMinor = todaySalesMinor / todayOrders
		}

		// 2. Month sales
		var monthSalesMinor int64 = 0
		var monthOrders int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(total_minor), 0), COUNT(*)
			FROM orders
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND status = 'paid' AND opened_at >= date_trunc('month', CURRENT_DATE)
		`, restID, branchID).Scan(&monthSalesMinor, &monthOrders)

		// 3. Month Net Profit (Revenue net - COGS - Expenses)
		var monthVATMinor int64 = 0
		var monthRefundsMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(tax_minor), 0)
			FROM orders
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND status = 'paid' AND opened_at >= date_trunc('month', CURRENT_DATE)
		`, restID, branchID).Scan(&monthVATMinor)

		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(r.amount_minor), 0)
			FROM refunds r
			JOIN orders o ON r.order_id = o.id
			WHERE r.restaurant_id = $1 AND ($2 = '' OR o.branch_id = $2::uuid)
			  AND r.created_at >= date_trunc('month', CURRENT_DATE)
		`, restID, branchID).Scan(&monthRefundsMinor)

		monthRevenueNet := monthSalesMinor - monthVATMinor - monthRefundsMinor

		// COGS
		var monthCOGSMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(oi.qty * oi.cost_minor_snapshot), 0)::bigint
			FROM order_items oi
			JOIN orders o ON oi.order_id = o.id
			WHERE o.restaurant_id = $1 AND ($2 = '' OR o.branch_id = $2::uuid)
			  AND o.status = 'paid' AND o.opened_at >= date_trunc('month', CURRENT_DATE)
			  AND oi.status != 'cancelled'
		`, restID, branchID).Scan(&monthCOGSMinor)

		// Wastage value
		var monthWastageMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(ABS(qty) * unit_cost_minor), 0)::bigint
			FROM stock_movements
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND type = 'wastage' AND created_at >= date_trunc('month', CURRENT_DATE)
		`, restID, branchID).Scan(&monthWastageMinor)
		monthCOGSMinor += monthWastageMinor

		// Expenses
		var monthExpensesMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(amount_minor), 0)
			FROM expenses
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND date >= date_trunc('month', CURRENT_DATE)::date
		`, restID, branchID).Scan(&monthExpensesMinor)

		monthGrossProfit := monthRevenueNet - monthCOGSMinor
		monthNetProfit := monthGrossProfit - monthExpensesMinor

		var monthMarginPct float64 = 0
		if monthRevenueNet > 0 {
			monthMarginPct = float64(monthNetProfit) / float64(monthRevenueNet) * 100.0
		}

		// 4. Top selling items
		rows, _ := s.pool.Query(req.Context(), `
			SELECT oi.name_snapshot, SUM(oi.qty) as total_qty, SUM(oi.qty * oi.unit_price_minor)::bigint as total_rev
			FROM order_items oi
			JOIN orders o ON oi.order_id = o.id
			WHERE o.restaurant_id = $1 AND ($2 = '' OR o.branch_id = $2::uuid)
			  AND o.status = 'paid' AND oi.status != 'cancelled'
			GROUP BY oi.name_snapshot
			ORDER BY total_rev DESC
			LIMIT 5
		`, restID, branchID)

		type topItem struct {
			Name     string  `json:"name"`
			Qty      float64 `json:"qty"`
			RevMinor int64   `json:"rev_minor"`
		}
		var topItems []topItem
		if rows != nil {
			for rows.Next() {
				var ti topItem
				if err := rows.Scan(&ti.Name, &ti.Qty, &ti.RevMinor); err == nil {
					topItems = append(topItems, ti)
				}
			}
			rows.Close()
		}

		// 5. Low stock alerts
		stockRows, _ := s.pool.Query(req.Context(), `
			SELECT i.id, i.name, i.unit, i.min_level, COALESCE(bs.quantity, 0) as on_hand
			FROM inventory_items i
			LEFT JOIN branch_stock bs ON i.id = bs.inventory_item_id AND ($2 = '' OR bs.branch_id = $2::uuid)
			WHERE i.restaurant_id = $1 AND COALESCE(bs.quantity, 0) <= i.min_level
			LIMIT 6
		`, restID, branchID)

		type lowStockItem struct {
			ID       string  `json:"id"`
			Name     string  `json:"name"`
			Unit     string  `json:"unit"`
			MinLevel float64 `json:"min_level"`
			OnHand   float64 `json:"on_hand"`
		}
		var lowStock []lowStockItem
		if stockRows != nil {
			for stockRows.Next() {
				var ls lowStockItem
				if err := stockRows.Scan(&ls.ID, &ls.Name, &ls.Unit, &ls.MinLevel, &ls.OnHand); err == nil {
					lowStock = append(lowStock, ls)
				}
			}
			stockRows.Close()
		}

		// 6. Payment mix breakdown
		payRows, _ := s.pool.Query(req.Context(), `
			SELECT p.method_code, SUM(p.amount_minor)::bigint
			FROM payments p
			JOIN orders o ON p.order_id = o.id
			WHERE p.restaurant_id = $1 AND ($2 = '' OR o.branch_id = $2::uuid)
			  AND p.paid_at >= date_trunc('month', CURRENT_DATE)
			GROUP BY p.method_code
		`, restID, branchID)

		type payMix struct {
			Method string `json:"method"`
			Amount int64  `json:"amount_minor"`
		}
		var paymentMix []payMix
		if payRows != nil {
			for payRows.Next() {
				var pm payMix
				if err := payRows.Scan(&pm.Method, &pm.Amount); err == nil {
					paymentMix = append(paymentMix, pm)
				}
			}
			payRows.Close()
		}

		// 7. Recent 7-day sales trend
		trendRows, _ := s.pool.Query(req.Context(), `
			SELECT to_char(opened_at, 'YYYY-MM-DD') as day, SUM(total_minor)::bigint, COUNT(*)
			FROM orders
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND status = 'paid' AND opened_at >= CURRENT_DATE - INTERVAL '6 days'
			GROUP BY day
			ORDER BY day ASC
		`, restID, branchID)

		type trendDay struct {
			Day    string `json:"day"`
			Sales  int64  `json:"sales_minor"`
			Orders int    `json:"orders"`
		}
		var trend []trendDay
		if trendRows != nil {
			for trendRows.Next() {
				var td trendDay
				if err := trendRows.Scan(&td.Day, &td.Sales, &td.Orders); err == nil {
					trend = append(trend, td)
				}
			}
			trendRows.Close()
		}

		result := map[string]interface{}{
			"today_sales_minor":    todaySalesMinor,
			"today_orders":         todayOrders,
			"today_avg_bill_minor": todayAvgBillMinor,
			"month_sales_minor":    monthSalesMinor,
			"month_orders":         monthOrders,
			"month_revenue_net":    monthRevenueNet,
			"month_cogs_minor":     monthCOGSMinor,
			"month_gross_profit":   monthGrossProfit,
			"month_expenses_minor": monthExpensesMinor,
			"month_net_profit":     monthNetProfit,
			"month_margin_pct":     monthMarginPct,
			"top_items":            topItems,
			"low_stock":            lowStock,
			"payment_mix":          paymentMix,
			"sales_trend":          trend,
		}
		// Branch managers get operational sales data, not Owner-level P&L.
		if middleware.GetUserClaims(req.Context()).Role == "manager" {
			delete(result, "month_cogs_minor")
			delete(result, "month_gross_profit")
			delete(result, "month_expenses_minor")
			delete(result, "month_net_profit")
			delete(result, "month_margin_pct")
		}
		middleware.JSONSuccess(w, http.StatusOK, result, nil)
	})

	// Profit & Loss Report
	r.Get("/reports/profit-loss", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")
		startDate := req.URL.Query().Get("start_date")
		endDate := req.URL.Query().Get("end_date")

		if startDate == "" {
			startDate = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
		}
		if endDate == "" {
			endDate = time.Now().Format("2006-01-02")
		}

		var grossSalesMinor int64 = 0
		var vatMinor int64 = 0
		var ordersCount int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(total_minor), 0), COALESCE(SUM(tax_minor), 0), COUNT(*)
			FROM orders
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND status = 'paid'
			  AND opened_at >= $3::date AND opened_at < ($4::date + INTERVAL '1 day')
		`, restID, branchID, startDate, endDate).Scan(&grossSalesMinor, &vatMinor, &ordersCount)

		var refundsMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(r.amount_minor), 0)
			FROM refunds r
			JOIN orders o ON r.order_id = o.id
			WHERE r.restaurant_id = $1 AND ($2 = '' OR o.branch_id = $2::uuid)
			  AND r.created_at >= $3::date AND r.created_at < ($4::date + INTERVAL '1 day')
		`, restID, branchID, startDate, endDate).Scan(&refundsMinor)

		revenueNet := grossSalesMinor - vatMinor - refundsMinor

		var cogsMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(oi.qty * oi.cost_minor_snapshot), 0)::bigint
			FROM order_items oi
			JOIN orders o ON oi.order_id = o.id
			WHERE o.restaurant_id = $1 AND ($2 = '' OR o.branch_id = $2::uuid)
			  AND o.status = 'paid'
			  AND o.opened_at >= $3::date AND o.opened_at < ($4::date + INTERVAL '1 day')
			  AND oi.status != 'cancelled'
		`, restID, branchID, startDate, endDate).Scan(&cogsMinor)

		var wastageMinor int64 = 0
		_ = s.pool.QueryRow(req.Context(), `
			SELECT COALESCE(SUM(ABS(qty) * unit_cost_minor), 0)::bigint
			FROM stock_movements
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND type = 'wastage'
			  AND created_at >= $3::date AND created_at < ($4::date + INTERVAL '1 day')
		`, restID, branchID, startDate, endDate).Scan(&wastageMinor)
		cogsMinor += wastageMinor

		grossProfit := revenueNet - cogsMinor

		// Operating Expenses breakdown
		expRows, _ := s.pool.Query(req.Context(), `
			SELECT category, SUM(amount_minor)::bigint
			FROM expenses
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			  AND date >= $3::date AND date <= $4::date
			GROUP BY category
		`, restID, branchID, startDate, endDate)

		var totalExpensesMinor int64 = 0
		expensesBreakdown := make(map[string]int64)
		if expRows != nil {
			for expRows.Next() {
				var cat string
				var amt int64
				if err := expRows.Scan(&cat, &amt); err == nil {
					expensesBreakdown[cat] = amt
					totalExpensesMinor += amt
				}
			}
			expRows.Close()
		}

		netProfit := grossProfit - totalExpensesMinor
		var marginPct float64 = 0
		if revenueNet > 0 {
			marginPct = float64(netProfit) / float64(revenueNet) * 100.0
		}

		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"start_date":         startDate,
			"end_date":           endDate,
			"gross_sales_minor":  grossSalesMinor,
			"vat_minor":          vatMinor,
			"refunds_minor":      refundsMinor,
			"revenue_net_minor":  revenueNet,
			"cogs_minor":         cogsMinor,
			"wastage_minor":      wastageMinor,
			"gross_profit_minor": grossProfit,
			"expenses_minor":     totalExpensesMinor,
			"expenses_breakdown": expensesBreakdown,
			"net_profit_minor":   netProfit,
			"margin_pct":         marginPct,
			"orders_count":       ordersCount,
		}, nil)
	})

	// Exceptions Report (Voids, Discounts, Refunds)
	r.Get("/reports/exceptions", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), `
			SELECT a.action, a.entity, a.entity_id, COALESCE(u.name, 'System'), a.after, a.created_at
			FROM audit_logs a
			LEFT JOIN users u ON a.user_id = u.id
			WHERE a.restaurant_id = $1
			  AND a.action IN ('APPLY_DISCOUNT', 'REFUND', 'VOID_ITEM', 'CANCEL_ORDER')
			ORDER BY a.created_at DESC
			LIMIT 100
		`, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		type exceptionItem struct {
			Action    string      `json:"action"`
			Entity    string      `json:"entity"`
			EntityID  *string     `json:"entity_id"`
			StaffName string      `json:"staff_name"`
			Details   interface{} `json:"details"`
			CreatedAt time.Time   `json:"created_at"`
		}
		var list []exceptionItem
		for rows.Next() {
			var it exceptionItem
			var afterJSON []byte
			if err := rows.Scan(&it.Action, &it.Entity, &it.EntityID, &it.StaffName, &afterJSON, &it.CreatedAt); err == nil {
				if len(afterJSON) > 0 {
					_ = json.Unmarshal(afterJSON, &it.Details)
				}
				list = append(list, it)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	// Audit Logs Search
	r.Get("/audit-logs", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		action := req.URL.Query().Get("action")
		entity := req.URL.Query().Get("entity")

		query := `
			SELECT a.id, a.user_id, COALESCE(u.name, 'System'), a.action, a.entity, a.entity_id,
			       a.before, a.after, COALESCE(a.ip, ''), COALESCE(a.device, ''), a.created_at
			FROM audit_logs a
			LEFT JOIN users u ON a.user_id = u.id
			WHERE a.restaurant_id = $1
		`
		var rows pgxRowsClose
		var err error
		if action != "" {
			query += " AND a.action = $2 ORDER BY a.created_at DESC LIMIT 100"
			rows, err = s.pool.Query(req.Context(), query, restID, action)
		} else if entity != "" {
			query += " AND a.entity = $2 ORDER BY a.created_at DESC LIMIT 100"
			rows, err = s.pool.Query(req.Context(), query, restID, entity)
		} else {
			query += " ORDER BY a.created_at DESC LIMIT 100"
			rows, err = s.pool.Query(req.Context(), query, restID)
		}

		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var logs []models.AuditLog
		for rows.Next() {
			var l models.AuditLog
			var bJSON, aJSON []byte
			if err := rows.Scan(&l.ID, &l.UserID, &l.UserName, &l.Action, &l.Entity, &l.EntityID, &bJSON, &aJSON, &l.IP, &l.Device, &l.CreatedAt); err == nil {
				if len(bJSON) > 0 {
					_ = json.Unmarshal(bJSON, &l.Before)
				}
				if len(aJSON) > 0 {
					_ = json.Unmarshal(aJSON, &l.After)
				}
				logs = append(logs, l)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, logs, nil)
	})
}

type pgxRowsClose interface {
	Next() bool
	Scan(...interface{}) error
	Close()
}
