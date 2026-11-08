package inventory

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/audit"
	"restoflow/internal/billing"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
	"restoflow/internal/platform"
)

type InventoryService struct {
	pool  *pgxpool.Pool
	audit *audit.AuditService
}

func NewInventoryService(pool *pgxpool.Pool, audit *audit.AuditService) *InventoryService {
	return &InventoryService{pool: pool, audit: audit}
}

func (s *InventoryService) MountRoutes(r chi.Router) {
	// Inventory Items
	r.Get("/inventory-items", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, name, unit, min_level, category, avg_cost_minor, created_at
			FROM inventory_items
			WHERE restaurant_id = $1
			ORDER BY name ASC
		`, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.InventoryItem
		for rows.Next() {
			var it models.InventoryItem
			if err := rows.Scan(&it.ID, &it.RestaurantID, &it.Name, &it.Unit, &it.MinLevel, &it.Category, &it.AvgCostMinor, &it.CreatedAt); err == nil {
				list = append(list, it)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Post("/inventory-items", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body models.InventoryItem
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		cat := body.Category
		if cat == "" {
			cat = "raw"
		}
		var it models.InventoryItem
		err := s.pool.QueryRow(req.Context(), `
			INSERT INTO inventory_items (restaurant_id, name, unit, min_level, category, avg_cost_minor)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, restaurant_id, name, unit, min_level, category, avg_cost_minor, created_at
		`, restID, body.Name, body.Unit, body.MinLevel, cat, body.AvgCostMinor).Scan(
			&it.ID, &it.RestaurantID, &it.Name, &it.Unit, &it.MinLevel, &it.Category, &it.AvgCostMinor, &it.CreatedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, it, nil)
	})

	// Recipes
	r.Get("/recipes", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		menuItemID := req.URL.Query().Get("menu_item_id")

		query := `
			SELECT r.id, r.restaurant_id, r.menu_item_id, r.variant_id, r.inventory_item_id,
			       i.name, i.unit, r.qty_per_portion, r.waste_pct
			FROM recipes r
			JOIN inventory_items i ON r.inventory_item_id = i.id
			WHERE r.restaurant_id = $1
		`
		var rows ioCloserRows
		var err error
		if menuItemID != "" {
			query += " AND r.menu_item_id = $2"
			rows, err = s.pool.Query(req.Context(), query, restID, menuItemID)
		} else {
			rows, err = s.pool.Query(req.Context(), query, restID)
		}
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.Recipe
		for rows.Next() {
			var rec models.Recipe
			if err := rows.Scan(&rec.ID, &rec.RestaurantID, &rec.MenuItemID, &rec.VariantID, &rec.InventoryItemID, &rec.ItemName, &rec.Unit, &rec.QtyPerPortion, &rec.WastePct); err == nil {
				list = append(list, rec)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Post("/recipes", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body models.Recipe
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		var recID string
		err := s.pool.QueryRow(req.Context(), `
			INSERT INTO recipes (restaurant_id, menu_item_id, variant_id, inventory_item_id, qty_per_portion, waste_pct)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id
		`, restID, body.MenuItemID, body.VariantID, body.InventoryItemID, body.QtyPerPortion, body.WastePct).Scan(&recID)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, map[string]string{"id": recID}, nil)
	})

	// Current Stock and Valuation
	r.Get("/stock", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")

		query := `
			SELECT i.id, i.name, i.unit, i.min_level, i.category, i.avg_cost_minor,
			       COALESCE(bs.quantity, 0) as on_hand
			FROM inventory_items i
			LEFT JOIN branch_stock bs ON i.id = bs.inventory_item_id AND ($2 = '' OR bs.branch_id = $2::uuid)
			WHERE i.restaurant_id = $1
			ORDER BY i.name ASC
		`
		rows, err := s.pool.Query(req.Context(), query, restID, branchID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var stockList []models.InventoryItem
		var totalValuationMinor int64 = 0

		for rows.Next() {
			var it models.InventoryItem
			if err := rows.Scan(&it.ID, &it.Name, &it.Unit, &it.MinLevel, &it.Category, &it.AvgCostMinor, &it.CurrentStock); err == nil {
				if it.CurrentStock > 0 {
					totalValuationMinor += int64(it.CurrentStock * float64(it.AvgCostMinor))
				}
				stockList = append(stockList, it)
			}
		}

		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"items":                 stockList,
			"total_valuation_minor": totalValuationMinor,
		}, nil)
	})

	// Manual Movements / Adjustments / Wastage
	r.Post("/stock/adjust", func(w http.ResponseWriter, req *http.Request) {
		s.handleStockMovement(w, req, "adjustment")
	})

	r.Post("/stock/wastage", func(w http.ResponseWriter, req *http.Request) {
		s.handleStockMovement(w, req, "wastage")
	})

	// Suppliers
	r.Get("/suppliers", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), "SELECT id, restaurant_id, name, COALESCE(phone, ''), balance_minor, created_at FROM suppliers WHERE restaurant_id = $1 ORDER BY name ASC", restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.Supplier
		for rows.Next() {
			var sp models.Supplier
			if err := rows.Scan(&sp.ID, &sp.RestaurantID, &sp.Name, &sp.Phone, &sp.BalanceMinor, &sp.CreatedAt); err == nil {
				list = append(list, sp)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Post("/suppliers", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body models.Supplier
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		var sp models.Supplier
		err := s.pool.QueryRow(req.Context(), `
			INSERT INTO suppliers (restaurant_id, name, phone, balance_minor)
			VALUES ($1, $2, $3, 0)
			RETURNING id, restaurant_id, name, phone, balance_minor, created_at
		`, restID, body.Name, body.Phone).Scan(&sp.ID, &sp.RestaurantID, &sp.Name, &sp.Phone, &sp.BalanceMinor, &sp.CreatedAt)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, sp, nil)
	})

	// Purchase Orders
	r.Post("/purchase-orders", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		var body struct {
			BranchID   string     `json:"branch_id"`
			SupplierID string     `json:"supplier_id"`
			ExpectedAt *time.Time `json:"expected_at"`
			Lines      []struct {
				InventoryItemID string  `json:"inventory_item_id"`
				Qty             float64 `json:"qty"`
				UnitCostMinor   int64   `json:"unit_cost_minor"`
			} `json:"lines"`
		}
		if json.NewDecoder(req.Body).Decode(&body) != nil || body.BranchID == "" || body.SupplierID == "" || len(body.Lines) == 0 {
			middleware.JSONError(w, 400, "INVALID_BODY", "Branch, supplier and at least one line are required", nil)
			return
		}
		var allowedBranch, validSupplier bool
		_ = s.pool.QueryRow(req.Context(), `SELECT EXISTS(SELECT 1 FROM branches b WHERE b.id::text=$1 AND b.restaurant_id::text=$2 AND ($3='owner' OR EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id=$4 AND ub.branch_id=b.id)))`, body.BranchID, restID, claims.Role, claims.UserID).Scan(&allowedBranch)
		_ = s.pool.QueryRow(req.Context(), "SELECT EXISTS(SELECT 1 FROM suppliers WHERE id::text=$1 AND restaurant_id::text=$2)", body.SupplierID, restID).Scan(&validSupplier)
		if !allowedBranch || !validSupplier {
			middleware.JSONError(w, 403, "SCOPE_FORBIDDEN", "Branch or supplier is outside your authorized scope", nil)
			return
		}
		var total int64
		for _, line := range body.Lines {
			if line.Qty <= 0 || line.UnitCostMinor < 0 {
				middleware.JSONError(w, 400, "INVALID_LINE", "Quantities and costs must be valid", nil)
				return
			}
			total += int64(line.Qty * float64(line.UnitCostMinor))
		}
		var threshold int64 = 5000000
		_ = s.pool.QueryRow(req.Context(), "SELECT COALESCE((value->>'purchase_minor')::bigint,5000000) FROM settings WHERE restaurant_id=$1 AND key='approval_limits'", restID).Scan(&threshold)
		status := "approved"
		if total > threshold && claims.Role != "owner" {
			status = "pending_approval"
		}
		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, 500, "DB_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())
		var poID string
		err = tx.QueryRow(req.Context(), `INSERT INTO purchase_orders(restaurant_id,branch_id,supplier_id,status,total_minor,created_by,approved_by,approved_at,expected_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $4='approved' THEN $6::uuid END,CASE WHEN $4='approved' THEN NOW() END,$7) RETURNING id`, restID, body.BranchID, body.SupplierID, status, total, claims.UserID, body.ExpectedAt).Scan(&poID)
		if err != nil {
			middleware.JSONError(w, 400, "CREATE_FAILED", err.Error(), nil)
			return
		}
		for _, line := range body.Lines {
			tag, lineErr := tx.Exec(req.Context(), `INSERT INTO purchase_order_lines(purchase_order_id,inventory_item_id,qty,unit_cost_minor) SELECT $1,i.id,$3,$4 FROM inventory_items i WHERE i.id::text=$2 AND i.restaurant_id::text=$5`, poID, line.InventoryItemID, line.Qty, line.UnitCostMinor, restID)
			if lineErr != nil || tag.RowsAffected() != 1 {
				middleware.JSONError(w, 400, "INVALID_ITEM", "Purchase line item does not belong to this business", nil)
				return
			}
		}
		if status == "pending_approval" {
			var approvalID string
			payload, _ := json.Marshal(map[string]interface{}{"purchase_order_id": poID})
			err = tx.QueryRow(req.Context(), `INSERT INTO approval_requests(restaurant_id,branch_id,type,entity_type,entity_id,requested_by,reason,amount_minor,payload) VALUES($1,$2,'purchase','purchase_order',$3,$4,'Purchase exceeds approval threshold',$5,$6) RETURNING id`, restID, body.BranchID, poID, claims.UserID, total, payload).Scan(&approvalID)
			if err == nil {
				_, _ = tx.Exec(req.Context(), "INSERT INTO approval_status_history(approval_request_id,to_status,changed_by,note) VALUES($1,'pending',$2,'Purchase threshold approval required')", approvalID, claims.UserID)
			}
		}
		if err = tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, 500, "COMMIT_FAILED", err.Error(), nil)
			return
		}
		s.audit.Log(req.Context(), "CREATE_PO", "purchase_order", &poID, nil, map[string]interface{}{"status": status, "total_minor": total}, "", "")
		middleware.JSONSuccess(w, 201, map[string]interface{}{"id": poID, "status": status, "total_minor": total}, nil)
	})

	r.Get("/purchase-orders", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")
		rows, err := s.pool.Query(req.Context(), `
			SELECT po.id, po.restaurant_id, po.branch_id, po.supplier_id, s.name, po.status, po.total_minor, po.created_at
			FROM purchase_orders po
			JOIN suppliers s ON po.supplier_id = s.id
			WHERE po.restaurant_id = $1 AND ($2 = '' OR po.branch_id = $2::uuid)
			ORDER BY po.created_at DESC
		`, restID, branchID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.PurchaseOrder
		for rows.Next() {
			var po models.PurchaseOrder
			if err := rows.Scan(&po.ID, &po.RestaurantID, &po.BranchID, &po.SupplierID, &po.SupplierName, &po.Status, &po.TotalMinor, &po.CreatedAt); err == nil {
				list = append(list, po)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Post("/purchase-orders/{id}/receive", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		poID := chi.URLParam(req, "id")

		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "TX_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())

		var branchID, supplierID, status string
		var totalMinor int64
		err = tx.QueryRow(req.Context(), "SELECT branch_id, supplier_id, status, total_minor FROM purchase_orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE", poID, restID).Scan(&branchID, &supplierID, &status, &totalMinor)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
			return
		}

		if status == "received" {
			middleware.JSONError(w, http.StatusBadRequest, "ALREADY_RECEIVED", "Purchase order is already received", nil)
			return
		}
		if status != "approved" && status != "partially_received" {
			middleware.JSONError(w, http.StatusForbidden, "PO_NOT_APPROVED", "Purchase order must be approved before receiving stock", nil)
			return
		}

		// Process lines
		rows, err := tx.Query(req.Context(), "SELECT id, inventory_item_id, qty, unit_cost_minor FROM purchase_order_lines WHERE purchase_order_id = $1", poID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_LINES_FAILED", err.Error(), nil)
			return
		}
		type poLine struct {
			lineID   string
			invID    string
			qty      float64
			unitCost int64
		}
		var lines []poLine
		for rows.Next() {
			var l poLine
			if err := rows.Scan(&l.lineID, &l.invID, &l.qty, &l.unitCost); err == nil {
				lines = append(lines, l)
			}
		}
		rows.Close()

		for _, l := range lines {
			// Update on-hand branch stock
			_, _ = tx.Exec(req.Context(), `
				INSERT INTO branch_stock (branch_id, inventory_item_id, quantity)
				VALUES ($1, $2, $3)
				ON CONFLICT (branch_id, inventory_item_id)
				DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity
			`, branchID, l.invID, l.qty)

			// Record stock movement
			_, _ = tx.Exec(req.Context(), `
				INSERT INTO stock_movements (restaurant_id, branch_id, inventory_item_id, type, qty, unit_cost_minor, ref_type, ref_id, reason, created_by)
				VALUES ($1, $2, $3, 'purchase', $4, $5, 'po', $6, 'Goods received', $7)
			`, restID, branchID, l.invID, l.qty, l.unitCost, poID, claims.UserID)

			// Recalculate weighted average cost (Appendix A.4)
			var curQty float64
			var curAvgCost int64
			_ = tx.QueryRow(req.Context(), "SELECT COALESCE(quantity, 0) FROM branch_stock WHERE branch_id = $1 AND inventory_item_id = $2", branchID, l.invID).Scan(&curQty)
			_ = tx.QueryRow(req.Context(), "SELECT avg_cost_minor FROM inventory_items WHERE id = $1", l.invID).Scan(&curAvgCost)

			newAvgCost := billing.WeightedAverageCost(curQty, curAvgCost, l.qty, l.unitCost)
			_, _ = tx.Exec(req.Context(), "UPDATE inventory_items SET avg_cost_minor = $1 WHERE id = $2", newAvgCost, l.invID)

			_, _ = tx.Exec(req.Context(), "UPDATE purchase_order_lines SET received_qty = qty WHERE id = $1", l.lineID)
		}

		// Update supplier payable
		_, _ = tx.Exec(req.Context(), "UPDATE suppliers SET balance_minor = balance_minor + $1 WHERE id = $2", totalMinor, supplierID)

		// Mark PO received
		_, _ = tx.Exec(req.Context(), "UPDATE purchase_orders SET status = 'received' WHERE id = $1", poID)

		if err := tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "COMMIT_FAILED", err.Error(), nil)
			return
		}

		s.audit.Log(req.Context(), "RECEIVE_PO", "purchase_order", &poID, nil, map[string]interface{}{"status": "received", "total": totalMinor}, "", "")
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"message": "purchase order received and stock updated"}, nil)
	})

	// Operating Expenses
	r.Get("/expenses", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")
		rows, err := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, branch_id, category, amount_minor, date, COALESCE(note, ''), created_at
			FROM expenses
			WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid)
			ORDER BY date DESC, created_at DESC
		`, restID, branchID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.Expense
		for rows.Next() {
			var e models.Expense
			var d time.Time
			if err := rows.Scan(&e.ID, &e.RestaurantID, &e.BranchID, &e.Category, &e.AmountMinor, &d, &e.Note, &e.CreatedAt); err == nil {
				e.Date = d.Format("2006-01-02")
				list = append(list, e)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Post("/expenses", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		var body struct {
			BranchID    string `json:"branch_id"`
			Category    string `json:"category"`
			AmountMinor int64  `json:"amount_minor"`
			Date        string `json:"date"`
			Note        string `json:"note"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		expDate := body.Date
		if expDate == "" {
			expDate = time.Now().In(platform.StoreLocation(req.Context(), s.pool, restID)).Format("2006-01-02")
		}

		expID := uuid.New().String()
		_, err := s.pool.Exec(req.Context(), `
			INSERT INTO expenses (id, restaurant_id, branch_id, category, amount_minor, date, note, created_by)
			VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
		`, expID, restID, body.BranchID, body.Category, body.AmountMinor, expDate, body.Note, claims.UserID)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}

		s.audit.Log(req.Context(), "CREATE_EXPENSE", "expense", &expID, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusCreated, map[string]interface{}{"id": expID, "amount": body.AmountMinor}, nil)
	})
}

type ioCloserRows interface {
	Next() bool
	Scan(...interface{}) error
	Close()
}

func (s *InventoryService) handleStockMovement(w http.ResponseWriter, req *http.Request, movementType string) {
	restID := middleware.GetRestaurantID(req.Context())
	claims := middleware.GetUserClaims(req.Context())

	var body struct {
		BranchID        string  `json:"branch_id"`
		InventoryItemID string  `json:"inventory_item_id"`
		Qty             float64 `json:"qty"`
		Reason          string  `json:"reason"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
		return
	}
	if body.Reason == "" {
		middleware.JSONError(w, http.StatusBadRequest, "REASON_REQUIRED", "Reason is required for manual stock movement", nil)
		return
	}

	qtyDelta := body.Qty
	if movementType == "wastage" && qtyDelta > 0 {
		qtyDelta = -qtyDelta
	}

	var curCost int64
	_ = s.pool.QueryRow(req.Context(), "SELECT avg_cost_minor FROM inventory_items WHERE id = $1", body.InventoryItemID).Scan(&curCost)

	// Record movement
	mID := uuid.New().String()
	_, err := s.pool.Exec(req.Context(), `
		INSERT INTO stock_movements (id, restaurant_id, branch_id, inventory_item_id, type, qty, unit_cost_minor, reason, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, mID, restID, body.BranchID, body.InventoryItemID, movementType, qtyDelta, curCost, body.Reason, claims.UserID)
	if err != nil {
		middleware.JSONError(w, http.StatusInternalServerError, "MOVEMENT_FAILED", err.Error(), nil)
		return
	}

	// Update branch stock
	_, _ = s.pool.Exec(req.Context(), `
		INSERT INTO branch_stock (branch_id, inventory_item_id, quantity)
		VALUES ($1, $2, $3)
		ON CONFLICT (branch_id, inventory_item_id)
		DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity
	`, body.BranchID, body.InventoryItemID, qtyDelta)

	s.audit.Log(req.Context(), "STOCK_MOVEMENT_"+movementType, "inventory_item", &body.InventoryItemID, nil, body, "", "")
	middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{"id": mID, "qty": qtyDelta}, nil)
}
