package menu

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/audit"
	"restoflow/internal/middleware"
	"restoflow/internal/models"
	"restoflow/internal/platform"
)

type MenuService struct {
	pool  *pgxpool.Pool
	hub   *platform.WSHub
	audit *audit.AuditService
}

func NewMenuService(pool *pgxpool.Pool, hub *platform.WSHub, audit *audit.AuditService) *MenuService {
	return &MenuService{pool: pool, hub: hub, audit: audit}
}

// Cashiers need catalogue prices to sell products, but purchase cost is
// confidential business data and must never be included in their responses.
func redactPurchaseCosts(role string, items []models.MenuItem) []models.MenuItem {
	if role != "cashier" {
		return items
	}
	for i := range items {
		items[i].CostPriceMinor = 0
	}
	return items
}

func (s *MenuService) ListCategories(ctx context.Context, restID string) ([]models.Category, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, restaurant_id, name_en, COALESCE(name_bn, ''), sort, COALESCE(color, '#0d5c3a'), station_id, is_active, created_at
		FROM categories
		WHERE restaurant_id = $1 AND is_active = TRUE
		ORDER BY sort ASC, name_en ASC
	`, restID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Category
	for rows.Next() {
		var c models.Category
		if err := rows.Scan(&c.ID, &c.RestaurantID, &c.NameEN, &c.NameBN, &c.Sort, &c.Color, &c.StationID, &c.IsActive, &c.CreatedAt); err == nil {
			list = append(list, c)
		}
	}
	return list, nil
}

func (s *MenuService) ListItems(ctx context.Context, restID string, categoryID string) ([]models.MenuItem, error) {
	query := `
		SELECT m.id, m.restaurant_id, m.category_id, c.name_en, m.name_en, COALESCE(m.name_bn, ''),
		       COALESCE(m.sku, ''), m.base_price_minor, m.tax_class, COALESCE(m.image_url, ''),
		       m.is_available, m.is_active,
		       COALESCE(m.brand, ''), COALESCE(m.unit, 'pcs'), COALESCE(m.package_size, '1 pc'),
		       COALESCE(m.regular_price_minor, m.base_price_minor), COALESCE(m.cost_price_minor, 0),
		       COALESCE(m.is_weighted, FALSE), COALESCE(m.is_hot_deal, FALSE),
		       COALESCE(m.is_popular, FALSE), COALESCE(m.is_new_arrival, FALSE),
		       COALESCE(m.track_stock, TRUE), COALESCE(m.stock_quantity, 100),
		       COALESCE(m.reorder_level, 10), COALESCE(m.barcode, ''),
		       COALESCE(m.shelf_location, ''), COALESCE(m.department, 'General'),
		       m.created_at, m.updated_at
		FROM menu_items m
		JOIN categories c ON m.category_id = c.id
		WHERE m.restaurant_id = $1 AND m.is_active = TRUE
	`
	var rows pgx.Rows
	var err error
	if categoryID != "" {
		query += " AND m.category_id = $2 ORDER BY m.name_en ASC"
		rows, err = s.pool.Query(ctx, query, restID, categoryID)
	} else {
		query += " ORDER BY c.sort ASC, m.name_en ASC"
		rows, err = s.pool.Query(ctx, query, restID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.MenuItem
	for rows.Next() {
		var it models.MenuItem
		if err := rows.Scan(
			&it.ID, &it.RestaurantID, &it.CategoryID, &it.CategoryName, &it.NameEN, &it.NameBN,
			&it.SKU, &it.BasePriceMinor, &it.TaxClass, &it.ImageURL, &it.IsAvailable, &it.IsActive,
			&it.Brand, &it.Unit, &it.PackageSize,
			&it.RegularPriceMinor, &it.CostPriceMinor,
			&it.IsWeighted, &it.IsHotDeal, &it.IsPopular, &it.IsNewArrival,
			&it.TrackStock, &it.StockQuantity, &it.ReorderLevel,
			&it.Barcode, &it.ShelfLocation, &it.Department,
			&it.CreatedAt, &it.UpdatedAt,
		); err == nil {
			// Fetch variants
			var variants []models.ItemVariant
			vRows, _ := s.pool.Query(ctx, `
				SELECT id, restaurant_id, item_id, name, price_minor, COALESCE(sku, ''), created_at
				FROM item_variants WHERE item_id = $1 ORDER BY price_minor ASC
			`, it.ID)
			if vRows != nil {
				for vRows.Next() {
					var v models.ItemVariant
					if err := vRows.Scan(&v.ID, &v.RestaurantID, &v.ItemID, &v.Name, &v.PriceMinor, &v.SKU, &v.CreatedAt); err == nil {
						variants = append(variants, v)
					}
				}
				vRows.Close()
			}
			it.Variants = variants

			// Fetch secondary barcodes
			var barcodes []string
			if it.Barcode != "" {
				barcodes = append(barcodes, it.Barcode)
			}
			bRows, _ := s.pool.Query(ctx, "SELECT barcode FROM product_barcodes WHERE product_id = $1", it.ID)
			if bRows != nil {
				for bRows.Next() {
					var bCode string
					if err := bRows.Scan(&bCode); err == nil && bCode != it.Barcode {
						barcodes = append(barcodes, bCode)
					}
				}
				bRows.Close()
			}
			it.Barcodes = barcodes

			items = append(items, it)
		}
	}
	return items, nil
}

// CodeSuggestion is one type-ahead match. Code is the barcode or SKU that matched the typed prefix.
type CodeSuggestion struct {
	ProductID      string `json:"product_id"`
	NameEN         string `json:"name_en"`
	Code           string `json:"code"`
	CodeType       string `json:"code_type"` // "barcode" or "sku"
	BasePriceMinor int64  `json:"base_price_minor"`
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// SuggestByCode returns active products whose main barcode, extra barcode or SKU starts with prefix
// (case-insensitive), one row per product, ordered by the matched code.
func (s *MenuService) SuggestByCode(ctx context.Context, restID, prefix string, limit int) ([]CodeSuggestion, error) {
	pattern := likeEscaper.Replace(prefix) + "%"
	rows, err := s.pool.Query(ctx, `
		SELECT product_id, name_en, code, code_type, base_price_minor FROM (
			SELECT DISTINCT ON (m.id)
			       m.id::text AS product_id, m.name_en, m.base_price_minor,
			       CASE WHEN m.barcode ILIKE $2 THEN m.barcode
			            WHEN pb.barcode IS NOT NULL THEN pb.barcode
			            ELSE m.sku END AS code,
			       CASE WHEN m.barcode ILIKE $2 OR pb.barcode IS NOT NULL THEN 'barcode' ELSE 'sku' END AS code_type
			FROM menu_items m
			LEFT JOIN product_barcodes pb
			       ON pb.product_id = m.id AND pb.restaurant_id = $1 AND pb.barcode ILIKE $2
			WHERE m.restaurant_id = $1 AND m.is_active = TRUE
			  AND (m.barcode ILIKE $2 OR pb.barcode IS NOT NULL OR m.sku ILIKE $2)
			ORDER BY m.id, pb.is_primary DESC NULLS LAST, pb.barcode
		) matches
		ORDER BY code, name_en
		LIMIT $3`, restID, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	suggestions := []CodeSuggestion{}
	for rows.Next() {
		var sg CodeSuggestion
		if err := rows.Scan(&sg.ProductID, &sg.NameEN, &sg.Code, &sg.CodeType, &sg.BasePriceMinor); err != nil {
			return nil, err
		}
		suggestions = append(suggestions, sg)
	}
	return suggestions, rows.Err()
}

// querier is satisfied by both *pgxpool.Pool and pgx.Tx.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// codeOwner returns the name of another active product in the store that already uses code as its
// barcode, extra barcode or SKU (all three are matched by a scan), or "" when the code is free.
func codeOwner(ctx context.Context, q querier, restID, code, excludeID string) (string, error) {
	var name string
	err := q.QueryRow(ctx, `
		SELECT m.name_en FROM menu_items m
		WHERE m.restaurant_id = $1 AND m.is_active = TRUE AND m.id::text <> $3
		  AND (m.barcode = $2 OR m.sku = $2 OR EXISTS (
		        SELECT 1 FROM product_barcodes pb WHERE pb.product_id = m.id AND pb.barcode = $2))
		LIMIT 1`, restID, code, excludeID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return name, err
}

// codesAvailable writes a 409 response and returns false when the barcode or SKU is already used by
// another product, so one scan can never match two products. excludeID is the product being edited.
func codesAvailable(ctx context.Context, w http.ResponseWriter, q querier, restID, excludeID, barcode, sku string) bool {
	for _, c := range []struct{ field, label, code string }{
		{"barcode", "Barcode", barcode},
		{"sku", "SKU", sku},
	} {
		if c.code == "" {
			continue
		}
		owner, err := codeOwner(ctx, q, restID, c.code, excludeID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "CODE_CHECK_FAILED", "Could not check the product codes", nil)
			return false
		}
		if owner != "" {
			middleware.JSONError(w, http.StatusConflict, "DUPLICATE_CODE",
				fmt.Sprintf("%s %s is already used by %q", c.label, c.code, owner),
				map[string]string{"field": c.field, "code": c.code, "product": owner})
			return false
		}
	}
	return true
}

// isUniqueViolation reports a unique-index error (e.g. two people saving the same barcode at once).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func duplicateCodeError(w http.ResponseWriter) {
	middleware.JSONError(w, http.StatusConflict, "DUPLICATE_CODE", "This barcode is already used by another product", nil)
}

func (s *MenuService) GetItemByBarcode(ctx context.Context, restID, barcode string) (*models.MenuItem, error) {
	cleanBarcode := strings.TrimSpace(barcode)
	if cleanBarcode == "" {
		return nil, fmt.Errorf("barcode is empty")
	}

	query := `
		SELECT m.id, m.restaurant_id, m.category_id, c.name_en, m.name_en, COALESCE(m.name_bn, ''),
		       COALESCE(m.sku, ''), m.base_price_minor, m.tax_class, COALESCE(m.image_url, ''),
		       m.is_available, m.is_active,
		       COALESCE(m.brand, ''), COALESCE(m.unit, 'pcs'), COALESCE(m.package_size, '1 pc'),
		       COALESCE(m.regular_price_minor, m.base_price_minor), COALESCE(m.cost_price_minor, 0),
		       COALESCE(m.is_weighted, FALSE), COALESCE(m.is_hot_deal, FALSE),
		       COALESCE(m.is_popular, FALSE), COALESCE(m.is_new_arrival, FALSE),
		       COALESCE(m.track_stock, TRUE), COALESCE(m.stock_quantity, 100),
		       COALESCE(m.reorder_level, 10), COALESCE(m.barcode, ''),
		       COALESCE(m.shelf_location, ''), COALESCE(m.department, 'General'),
		       m.created_at, m.updated_at
		FROM menu_items m
		JOIN categories c ON m.category_id = c.id
		LEFT JOIN product_barcodes pb ON m.id = pb.product_id
		WHERE m.restaurant_id = $1 AND m.is_active = TRUE AND (m.barcode = $2 OR pb.barcode = $2 OR m.sku = $2)
		LIMIT 1
	`
	var it models.MenuItem
	err := s.pool.QueryRow(ctx, query, restID, cleanBarcode).Scan(
		&it.ID, &it.RestaurantID, &it.CategoryID, &it.CategoryName, &it.NameEN, &it.NameBN,
		&it.SKU, &it.BasePriceMinor, &it.TaxClass, &it.ImageURL, &it.IsAvailable, &it.IsActive,
		&it.Brand, &it.Unit, &it.PackageSize,
		&it.RegularPriceMinor, &it.CostPriceMinor,
		&it.IsWeighted, &it.IsHotDeal, &it.IsPopular, &it.IsNewArrival,
		&it.TrackStock, &it.StockQuantity, &it.ReorderLevel,
		&it.Barcode, &it.ShelfLocation, &it.Department,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &it, nil
}

func (s *MenuService) ToggleAvailability(ctx context.Context, restID, itemID string, isAvailable bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE menu_items SET is_available = $1, updated_at = NOW()
		WHERE id = $2 AND restaurant_id = $3
	`, isAvailable, itemID, restID)
	if err != nil {
		return err
	}

	s.hub.BroadcastRestaurant(restID, "product.availability", map[string]interface{}{
		"item_id":      itemID,
		"is_available": isAvailable,
	})
	s.audit.Log(ctx, "TOGGLE_AVAILABILITY", "product", &itemID, nil, map[string]bool{"is_available": isAvailable}, "", "")
	return nil
}

func (s *MenuService) MountRoutes(r chi.Router) {
	// Categories
	r.Get("/categories", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		cats, err := s.ListCategories(req.Context(), restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, cats, nil)
	})

	r.Post("/categories", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body models.Category
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		var c models.Category
		err := s.pool.QueryRow(req.Context(), `
			INSERT INTO categories (restaurant_id, name_en, name_bn, sort, color, station_id, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, TRUE)
			RETURNING id, restaurant_id, name_en, COALESCE(name_bn, ''), sort, color, station_id, is_active, created_at
		`, restID, body.NameEN, body.NameBN, body.Sort, body.Color, body.StationID).Scan(
			&c.ID, &c.RestaurantID, &c.NameEN, &c.NameBN, &c.Sort, &c.Color, &c.StationID, &c.IsActive, &c.CreatedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, c, nil)
	})

	// Products / Items
	r.Get("/items", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		catID := req.URL.Query().Get("category_id")
		items, err := s.ListItems(req.Context(), restID, catID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		items = redactPurchaseCosts(middleware.GetUserClaims(req.Context()).Role, items)
		middleware.JSONSuccess(w, http.StatusOK, items, nil)
	})

	// Instant Barcode Scan Lookup (Fast POS integration)
	r.Get("/items/barcode/{code}", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		code := chi.URLParam(req, "code")
		item, err := s.GetItemByBarcode(req.Context(), restID, code)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", "Product with barcode not found", nil)
			return
		}
		if middleware.GetUserClaims(req.Context()).Role == "cashier" {
			item.CostPriceMinor = 0
		}
		middleware.JSONSuccess(w, http.StatusOK, item, nil)
	})

	// Type-ahead for the scan page: products whose barcode (main or extra) or SKU starts with q.
	r.Get("/items/suggest", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		q := strings.TrimSpace(req.URL.Query().Get("q"))
		if q == "" {
			middleware.JSONSuccess(w, http.StatusOK, []CodeSuggestion{}, nil)
			return
		}
		limit := 8
		if n, err := strconv.Atoi(req.URL.Query().Get("limit")); err == nil && n > 0 && n <= 20 {
			limit = n
		}
		suggestions, err := s.SuggestByCode(req.Context(), restID, q, limit)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "SUGGEST_FAILED", "Could not load suggestions", nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, suggestions, nil)
	})

	// Multi-criteria Product Search
	r.Get("/items/search", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		query := strings.ToLower(strings.TrimSpace(req.URL.Query().Get("q")))
		if query == "" {
			items, _ := s.ListItems(req.Context(), restID, "")
			items = redactPurchaseCosts(middleware.GetUserClaims(req.Context()).Role, items)
			middleware.JSONSuccess(w, http.StatusOK, items, nil)
			return
		}

		qPattern := "%" + query + "%"
		sqlQuery := `
			SELECT m.id, m.restaurant_id, m.category_id, c.name_en, m.name_en, COALESCE(m.name_bn, ''),
			       COALESCE(m.sku, ''), m.base_price_minor, m.tax_class, COALESCE(m.image_url, ''),
			       m.is_available, m.is_active,
			       COALESCE(m.brand, ''), COALESCE(m.unit, 'pcs'), COALESCE(m.package_size, '1 pc'),
			       COALESCE(m.regular_price_minor, m.base_price_minor), COALESCE(m.cost_price_minor, 0),
			       COALESCE(m.is_weighted, FALSE), COALESCE(m.is_hot_deal, FALSE),
			       COALESCE(m.is_popular, FALSE), COALESCE(m.is_new_arrival, FALSE),
			       COALESCE(m.track_stock, TRUE), COALESCE(m.stock_quantity, 100),
			       COALESCE(m.reorder_level, 10), COALESCE(m.barcode, ''),
			       COALESCE(m.shelf_location, ''), COALESCE(m.department, 'General'),
			       m.created_at, m.updated_at
			FROM menu_items m
			JOIN categories c ON m.category_id = c.id
			WHERE m.restaurant_id = $1 AND m.is_active = TRUE
			  AND (
				LOWER(m.name_en) LIKE $2 OR
				LOWER(m.name_bn) LIKE $2 OR
				LOWER(m.sku) LIKE $2 OR
				m.barcode LIKE $2 OR
				LOWER(m.brand) LIKE $2 OR
				LOWER(m.department) LIKE $2
			  )
			ORDER BY m.is_popular DESC, m.name_en ASC
			LIMIT 60
		`
		rows, err := s.pool.Query(req.Context(), sqlQuery, restID, qPattern)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "SEARCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var results []models.MenuItem
		for rows.Next() {
			var it models.MenuItem
			if err := rows.Scan(
				&it.ID, &it.RestaurantID, &it.CategoryID, &it.CategoryName, &it.NameEN, &it.NameBN,
				&it.SKU, &it.BasePriceMinor, &it.TaxClass, &it.ImageURL, &it.IsAvailable, &it.IsActive,
				&it.Brand, &it.Unit, &it.PackageSize,
				&it.RegularPriceMinor, &it.CostPriceMinor,
				&it.IsWeighted, &it.IsHotDeal, &it.IsPopular, &it.IsNewArrival,
				&it.TrackStock, &it.StockQuantity, &it.ReorderLevel,
				&it.Barcode, &it.ShelfLocation, &it.Department,
				&it.CreatedAt, &it.UpdatedAt,
			); err == nil {
				results = append(results, it)
			}
		}
		results = redactPurchaseCosts(middleware.GetUserClaims(req.Context()).Role, results)
		middleware.JSONSuccess(w, http.StatusOK, results, nil)
	})

	// Create Product
	r.Post("/items", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body struct {
			CategoryID        string               `json:"category_id"`
			NameEN            string               `json:"name_en"`
			NameBN            string               `json:"name_bn"`
			SKU               string               `json:"sku"`
			Brand             string               `json:"brand"`
			Unit              string               `json:"unit"`
			PackageSize       string               `json:"package_size"`
			BasePriceMinor    int64                `json:"base_price_minor"`
			RegularPriceMinor int64                `json:"regular_price_minor"`
			CostPriceMinor    int64                `json:"cost_price_minor"`
			TaxClass          string               `json:"tax_class"`
			ImageURL          string               `json:"image_url"`
			Barcode           string               `json:"barcode"`
			ShelfLocation     string               `json:"shelf_location"`
			Department        string               `json:"department"`
			IsWeighted        bool                 `json:"is_weighted"`
			IsHotDeal         bool                 `json:"is_hot_deal"`
			IsPopular         bool                 `json:"is_popular"`
			IsNewArrival      bool                 `json:"is_new_arrival"`
			TrackStock        bool                 `json:"track_stock"`
			StockQuantity     float64              `json:"stock_quantity"`
			ReorderLevel      float64              `json:"reorder_level"`
			Variants          []models.ItemVariant `json:"variants"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		body.Barcode = strings.TrimSpace(body.Barcode)
		body.SKU = strings.TrimSpace(body.SKU)
		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "TX_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())

		if !codesAvailable(req.Context(), w, tx, restID, "", body.Barcode, body.SKU) {
			return
		}

		taxClass := body.TaxClass
		if taxClass == "" {
			taxClass = "standard"
		}
		unit := body.Unit
		if unit == "" {
			unit = "pcs"
		}
		regPrice := body.RegularPriceMinor
		if regPrice == 0 {
			regPrice = body.BasePriceMinor
		}

		var itemID string
		err = tx.QueryRow(req.Context(), `
			INSERT INTO menu_items (
				restaurant_id, category_id, name_en, name_bn, sku, brand, unit, package_size,
				base_price_minor, regular_price_minor, cost_price_minor, tax_class, image_url,
				barcode, shelf_location, department, is_weighted, is_hot_deal, is_popular, is_new_arrival,
				track_stock, stock_quantity, reorder_level, is_available, is_active
			)
			VALUES (
				$1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8,
				$9, $10, $11, $12, $13,
				$14, $15, $16, $17, $18, $19, $20,
				$21, $22, $23, TRUE, TRUE
			)
			RETURNING id
		`,
			restID, body.CategoryID, body.NameEN, body.NameBN, body.SKU, body.Brand, unit, body.PackageSize,
			body.BasePriceMinor, regPrice, body.CostPriceMinor, taxClass, body.ImageURL,
			body.Barcode, body.ShelfLocation, body.Department, body.IsWeighted, body.IsHotDeal, body.IsPopular, body.IsNewArrival,
			body.TrackStock, body.StockQuantity, body.ReorderLevel,
		).Scan(&itemID)
		if isUniqueViolation(err) {
			duplicateCodeError(w)
			return
		}
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CREATE_FAILED", err.Error(), nil)
			return
		}

		if body.Barcode != "" {
			_, _ = tx.Exec(req.Context(), `
				INSERT INTO product_barcodes (restaurant_id, product_id, barcode, is_primary)
				VALUES ($1, $2, $3, TRUE)
				ON CONFLICT (restaurant_id, barcode) DO NOTHING
			`, restID, itemID, body.Barcode)
		}

		for _, v := range body.Variants {
			_, _ = tx.Exec(req.Context(), `
				INSERT INTO item_variants (restaurant_id, item_id, name, price_minor, sku)
				VALUES ($1, $2, $3, $4, NULLIF($5, ''))
			`, restID, itemID, v.Name, v.PriceMinor, v.SKU)
		}

		if err := tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "COMMIT_ERROR", err.Error(), nil)
			return
		}
		// Open scan pages refresh their barcode list.
		s.hub.BroadcastRestaurant(restID, "product.changed", map[string]string{"item_id": itemID, "action": "created"})
		middleware.JSONSuccess(w, http.StatusCreated, map[string]interface{}{"id": itemID, "name": body.NameEN}, nil)
	})

	// Update Product
	r.Put("/items/{id}", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		itemID := chi.URLParam(req, "id")

		var body struct {
			CategoryID        string  `json:"category_id"`
			NameEN            string  `json:"name_en"`
			NameBN            string  `json:"name_bn"`
			SKU               string  `json:"sku"`
			Brand             string  `json:"brand"`
			Unit              string  `json:"unit"`
			PackageSize       string  `json:"package_size"`
			BasePriceMinor    int64   `json:"base_price_minor"`
			RegularPriceMinor int64   `json:"regular_price_minor"`
			CostPriceMinor    int64   `json:"cost_price_minor"`
			Barcode           string  `json:"barcode"`
			ShelfLocation     string  `json:"shelf_location"`
			Department        string  `json:"department"`
			IsWeighted        bool    `json:"is_weighted"`
			IsHotDeal         bool    `json:"is_hot_deal"`
			IsPopular         bool    `json:"is_popular"`
			IsNewArrival      bool    `json:"is_new_arrival"`
			TrackStock        bool    `json:"track_stock"`
			StockQuantity     float64 `json:"stock_quantity"`
			ReorderLevel      float64 `json:"reorder_level"`
			IsAvailable       bool    `json:"is_available"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		body.Barcode = strings.TrimSpace(body.Barcode)
		body.SKU = strings.TrimSpace(body.SKU)
		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "TX_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())

		if !codesAvailable(req.Context(), w, tx, restID, itemID, body.Barcode, body.SKU) {
			return
		}

		tag, err := tx.Exec(req.Context(), `
			UPDATE menu_items SET
				category_id = $1, name_en = $2, name_bn = $3, sku = NULLIF($4, ''), brand = $5,
				unit = $6, package_size = $7, base_price_minor = $8, regular_price_minor = $9,
				cost_price_minor = $10, barcode = $11, shelf_location = $12, department = $13,
				is_weighted = $14, is_hot_deal = $15, is_popular = $16, is_new_arrival = $17,
				track_stock = $18, stock_quantity = $19, reorder_level = $20, is_available = $21,
				updated_at = NOW()
			WHERE id = $22 AND restaurant_id = $23
		`,
			body.CategoryID, body.NameEN, body.NameBN, body.SKU, body.Brand,
			body.Unit, body.PackageSize, body.BasePriceMinor, body.RegularPriceMinor,
			body.CostPriceMinor, body.Barcode, body.ShelfLocation, body.Department,
			body.IsWeighted, body.IsHotDeal, body.IsPopular, body.IsNewArrival,
			body.TrackStock, body.StockQuantity, body.ReorderLevel, body.IsAvailable,
			itemID, restID,
		)
		if isUniqueViolation(err) {
			duplicateCodeError(w)
			return
		}
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error(), nil)
			return
		}
		if tag.RowsAffected() == 0 {
			middleware.JSONError(w, http.StatusNotFound, "NOT_FOUND", "Product not found", nil)
			return
		}

		// The old main barcode must stop matching this product once it is changed or removed.
		if _, err := tx.Exec(req.Context(), `
			DELETE FROM product_barcodes
			WHERE restaurant_id = $1 AND product_id = $2 AND is_primary = TRUE AND barcode <> $3
		`, restID, itemID, body.Barcode); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error(), nil)
			return
		}
		if body.Barcode != "" {
			if _, err := tx.Exec(req.Context(), `
				INSERT INTO product_barcodes (restaurant_id, product_id, barcode, is_primary)
				VALUES ($1, $2, $3, TRUE)
				ON CONFLICT (restaurant_id, barcode) DO NOTHING
			`, restID, itemID, body.Barcode); err != nil {
				middleware.JSONError(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error(), nil)
				return
			}
		}

		if err := tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "COMMIT_ERROR", err.Error(), nil)
			return
		}
		s.hub.BroadcastRestaurant(restID, "product.changed", map[string]string{"item_id": itemID, "action": "updated"})
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"status": "updated"}, nil)
	})

	r.Patch("/items/{id}/availability", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		itemID := chi.URLParam(req, "id")
		var body struct {
			IsAvailable bool `json:"is_available"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		if err := s.ToggleAvailability(req.Context(), restID, itemID, body.IsAvailable); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{"id": itemID, "is_available": body.IsAvailable}, nil)
	})

	// CSV Export
	r.Get("/items/export", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		items, err := s.ListItems(req.Context(), restID, "")
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "EXPORT_FAILED", err.Error(), nil)
			return
		}

		buf := new(bytes.Buffer)
		writer := csv.NewWriter(buf)
		_ = writer.Write([]string{"Department", "Category", "Brand", "NameEN", "NameBN", "SKU", "Barcode", "Unit", "PackageSize", "RegularPrice", "SellingPrice", "CostPrice", "Stock", "Available"})

		for _, it := range items {
			_ = writer.Write([]string{
				it.Department,
				it.CategoryName,
				it.Brand,
				it.NameEN,
				it.NameBN,
				it.SKU,
				it.Barcode,
				it.Unit,
				it.PackageSize,
				fmt.Sprintf("%.2f", float64(it.RegularPriceMinor)/100.0),
				fmt.Sprintf("%.2f", float64(it.BasePriceMinor)/100.0),
				fmt.Sprintf("%.2f", float64(it.CostPriceMinor)/100.0),
				fmt.Sprintf("%.2f", it.StockQuantity),
				strconv.FormatBool(it.IsAvailable),
			})
		}
		writer.Flush()

		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=novamart_products.csv")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buf.Bytes())
	})

	// Promotions & Coupons
	r.Get("/promotions", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		rows, err := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, code, name, type, discount_pct, discount_minor, min_spend_minor, start_date, end_date, is_active, usage_limit, used_count, created_at
			FROM promotions
			WHERE restaurant_id = $1 AND is_active = TRUE
			ORDER BY code ASC
		`, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "PROMOTIONS_FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var promos []models.Promotion
		for rows.Next() {
			var p models.Promotion
			if err := rows.Scan(
				&p.ID, &p.RestaurantID, &p.Code, &p.Name, &p.Type, &p.DiscountPct, &p.DiscountMinor,
				&p.MinSpendMinor, &p.StartDate, &p.EndDate, &p.IsActive, &p.UsageLimit, &p.UsedCount, &p.CreatedAt,
			); err == nil {
				promos = append(promos, p)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, promos, nil)
	})

	r.Post("/promotions/validate", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body struct {
			Code        string `json:"code"`
			SubtotalBDT int64  `json:"subtotal_minor"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		cleanCode := strings.ToUpper(strings.TrimSpace(body.Code))
		var promo models.Promotion
		err := s.pool.QueryRow(req.Context(), `
			SELECT id, restaurant_id, code, name, type, discount_pct, discount_minor, min_spend_minor, start_date, end_date, is_active, usage_limit, used_count, created_at
			FROM promotions
			WHERE restaurant_id = $1 AND UPPER(code) = $2 AND is_active = TRUE
			  AND NOW() BETWEEN start_date AND end_date
		`, restID, cleanCode).Scan(
			&promo.ID, &promo.RestaurantID, &promo.Code, &promo.Name, &promo.Type, &promo.DiscountPct, &promo.DiscountMinor,
			&promo.MinSpendMinor, &promo.StartDate, &promo.EndDate, &promo.IsActive, &promo.UsageLimit, &promo.UsedCount, &promo.CreatedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusNotFound, "INVALID_PROMO", "Coupon code is invalid or expired", nil)
			return
		}

		if body.SubtotalBDT < promo.MinSpendMinor {
			middleware.JSONError(w, http.StatusBadRequest, "MIN_SPEND_NOT_MET", fmt.Sprintf("Minimum spend required: ৳%.2f", float64(promo.MinSpendMinor)/100.0), nil)
			return
		}

		var discountMinor int64 = 0
		if promo.Type == "percentage" {
			discountMinor = int64(float64(body.SubtotalBDT) * (promo.DiscountPct / 100.0))
		} else {
			discountMinor = promo.DiscountMinor
		}

		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"valid":          true,
			"code":           promo.Code,
			"name":           promo.Name,
			"discount_minor": discountMinor,
		}, nil)
	})

	// Retail Deliveries & Fulfilment
	r.Get("/deliveries", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")
		status := req.URL.Query().Get("status")

		query := `
			SELECT d.id, d.restaurant_id, d.branch_id, d.order_id, o.order_no, d.customer_id,
			       d.recipient_name, d.recipient_phone, d.delivery_address, COALESCE(d.delivery_zone, ''),
			       d.delivery_fee_minor, d.status, d.staff_id, COALESCE(u.name, ''), COALESCE(d.notes, ''),
			       d.created_at, d.updated_at
			FROM retail_deliveries d
			JOIN orders o ON d.order_id = o.id
			LEFT JOIN users u ON d.staff_id = u.id
			WHERE d.restaurant_id = $1 AND ($2 = '' OR d.branch_id = $2::uuid) AND ($3 = '' OR d.status = $3)
			ORDER BY d.created_at DESC
		`
		rows, err := s.pool.Query(req.Context(), query, restID, branchID, status)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_DELIVERIES_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.RetailDelivery
		for rows.Next() {
			var d models.RetailDelivery
			if err := rows.Scan(
				&d.ID, &d.RestaurantID, &d.BranchID, &d.OrderID, &d.OrderNo, &d.CustomerID,
				&d.RecipientName, &d.RecipientPhone, &d.DeliveryAddress, &d.DeliveryZone,
				&d.DeliveryFeeMinor, &d.Status, &d.StaffID, &d.StaffName, &d.Notes,
				&d.CreatedAt, &d.UpdatedAt,
			); err == nil {
				list = append(list, d)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Patch("/deliveries/{id}/status", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		deliveryID := chi.URLParam(req, "id")
		var body struct {
			Status  string  `json:"status"` // ordered, picking, packed, out_for_delivery, delivered, cancelled
			StaffID *string `json:"staff_id,omitempty"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		_, err := s.pool.Exec(req.Context(), `
			UPDATE retail_deliveries
			SET status = $1, staff_id = COALESCE($2, staff_id), updated_at = NOW()
			WHERE id = $3 AND restaurant_id = $4
		`, body.Status, body.StaffID, deliveryID, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "STATUS_UPDATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusOK, map[string]string{"status": body.Status}, nil)
	})

	// Stock Adjustments (Wastage, Damage, Recount, Expiry)
	r.Get("/stock/adjustments", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")

		query := `
			SELECT a.id, a.restaurant_id, a.branch_id, a.product_id, m.name_en, a.type, a.qty_change, COALESCE(a.reason, ''), a.created_by, a.created_at
			FROM stock_adjustments a
			JOIN menu_items m ON a.product_id = m.id
			WHERE a.restaurant_id = $1 AND ($2 = '' OR a.branch_id = $2::uuid)
			ORDER BY a.created_at DESC
			LIMIT 100
		`
		rows, err := s.pool.Query(req.Context(), query, restID, branchID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var list []models.StockAdjustment
		for rows.Next() {
			var sa models.StockAdjustment
			if err := rows.Scan(&sa.ID, &sa.RestaurantID, &sa.BranchID, &sa.ProductID, &sa.ProductName, &sa.Type, &sa.QtyChange, &sa.Reason, &sa.CreatedBy, &sa.CreatedAt); err == nil {
				list = append(list, sa)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, list, nil)
	})

	r.Post("/stock/adjustments", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		claims := middleware.GetUserClaims(req.Context())
		var body struct {
			BranchID  string  `json:"branch_id"`
			ProductID string  `json:"product_id"`
			Type      string  `json:"type"` // damage, expiry, recount, shrinkage, return_restock
			QtyChange float64 `json:"qty_change"`
			Reason    string  `json:"reason"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}
		if strings.TrimSpace(body.Reason) == "" || body.QtyChange == 0 {
			middleware.JSONError(w, http.StatusBadRequest, "REASON_REQUIRED", "A non-zero adjustment and reason are required", nil)
			return
		}
		var branchAllowed bool
		_ = s.pool.QueryRow(req.Context(), `SELECT EXISTS(SELECT 1 FROM branches b WHERE b.id::text=$1 AND b.restaurant_id::text=$2 AND ($3='owner' OR EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id::text=$4 AND ub.branch_id=b.id)))`, body.BranchID, restID, claims.Role, claims.UserID).Scan(&branchAllowed)
		if !branchAllowed {
			middleware.JSONError(w, http.StatusForbidden, "BRANCH_FORBIDDEN", "This branch is outside your assigned scope", nil)
			return
		}
		var threshold float64 = 100
		_ = s.pool.QueryRow(req.Context(), "SELECT COALESCE((value->>'stock_adjustment_qty')::numeric,100) FROM settings WHERE restaurant_id=$1 AND key='approval_limits'", restID).Scan(&threshold)
		absQty := body.QtyChange
		if absQty < 0 {
			absQty = -absQty
		}
		if absQty > threshold && claims.Role != "owner" {
			payload, _ := json.Marshal(body)
			var requestID string
			err := s.pool.QueryRow(req.Context(), `INSERT INTO approval_requests(restaurant_id,branch_id,type,entity_type,entity_id,requested_by,reason,payload) VALUES($1,$2,'stock_adjustment','product',$3,$4,$5,$6) RETURNING id`, restID, body.BranchID, body.ProductID, claims.UserID, body.Reason, payload).Scan(&requestID)
			if err != nil {
				middleware.JSONError(w, http.StatusBadRequest, "REQUEST_FAILED", err.Error(), nil)
				return
			}
			_, _ = s.pool.Exec(req.Context(), "INSERT INTO approval_status_history(approval_request_id,to_status,changed_by,note) VALUES($1,'pending',$2,$3)", requestID, claims.UserID, body.Reason)
			s.audit.Log(req.Context(), "REQUEST_STOCK_ADJUSTMENT", "approval_request", &requestID, nil, body, "", "")
			middleware.JSONSuccess(w, http.StatusAccepted, map[string]string{"id": requestID, "status": "pending_approval"}, nil)
			return
		}

		tx, err := s.pool.Begin(req.Context())
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "DB_ERROR", err.Error(), nil)
			return
		}
		defer tx.Rollback(req.Context())

		// Update product stock
		_, err = tx.Exec(req.Context(), `
			UPDATE menu_items
			SET stock_quantity = GREATEST(0, stock_quantity + $1), updated_at = NOW()
			WHERE id = $2 AND restaurant_id = $3
		`, body.QtyChange, body.ProductID, restID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "STOCK_UPDATE_FAILED", err.Error(), nil)
			return
		}

		adjID := uuid.New().String()
		_, err = tx.Exec(req.Context(), `
			INSERT INTO stock_adjustments (id, restaurant_id, branch_id, product_id, type, qty_change, reason, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, adjID, restID, body.BranchID, body.ProductID, body.Type, body.QtyChange, body.Reason, claims.UserID)
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "ADJUSTMENT_INSERT_FAILED", err.Error(), nil)
			return
		}

		if err := tx.Commit(req.Context()); err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "COMMIT_FAILED", err.Error(), nil)
			return
		}
		s.audit.Log(req.Context(), "STOCK_ADJUSTMENT", "stock_adjustment", &adjID, nil, body, "", "")
		middleware.JSONSuccess(w, http.StatusCreated, map[string]string{"id": adjID, "status": "recorded"}, nil)
	})

	// Customers
	r.Get("/customers", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		search := strings.TrimSpace(req.URL.Query().Get("q"))

		query := `
			SELECT id, restaurant_id, name, COALESCE(phone, ''), COALESCE(email, ''), COALESCE(address, ''), COALESCE(notes, ''),
			       COALESCE(customer_group, 'Regular'), COALESCE(loyalty_points, 0), credit_limit_minor, balance_minor, created_at
			FROM customers
			WHERE restaurant_id = $1
		`
		var rows pgx.Rows
		var err error
		if search != "" {
			query += " AND (name ILIKE $2 OR phone LIKE $2) ORDER BY name ASC"
			rows, err = s.pool.Query(req.Context(), query, restID, "%"+search+"%")
		} else {
			query += " ORDER BY name ASC"
			rows, err = s.pool.Query(req.Context(), query, restID)
		}
		if err != nil {
			middleware.JSONError(w, http.StatusInternalServerError, "FETCH_CUSTOMERS_FAILED", err.Error(), nil)
			return
		}
		defer rows.Close()

		var customers []models.Customer
		for rows.Next() {
			var cu models.Customer
			if err := rows.Scan(
				&cu.ID, &cu.RestaurantID, &cu.Name, &cu.Phone, &cu.Email, &cu.Address, &cu.Notes,
				&cu.CustomerGroup, &cu.LoyaltyPoints, &cu.CreditLimitMinor, &cu.BalanceMinor, &cu.CreatedAt,
			); err == nil {
				customers = append(customers, cu)
			}
		}
		middleware.JSONSuccess(w, http.StatusOK, customers, nil)
	})

	r.Post("/customers", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		var body struct {
			Name             string `json:"name"`
			Phone            string `json:"phone"`
			Email            string `json:"email,omitempty"`
			Address          string `json:"address,omitempty"`
			CustomerGroup    string `json:"customer_group,omitempty"`
			CreditLimitMinor int64  `json:"credit_limit_minor,omitempty"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "INVALID_BODY", err.Error(), nil)
			return
		}

		cGroup := body.CustomerGroup
		if cGroup == "" {
			cGroup = "Regular"
		}

		var cu models.Customer
		err := s.pool.QueryRow(req.Context(), `
			INSERT INTO customers (restaurant_id, name, phone, email, address, customer_group, credit_limit_minor)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, restaurant_id, name, COALESCE(phone, ''), COALESCE(email, ''), COALESCE(address, ''), COALESCE(notes, ''),
			          COALESCE(customer_group, 'Regular'), COALESCE(loyalty_points, 0), credit_limit_minor, balance_minor, created_at
		`, restID, body.Name, body.Phone, body.Email, body.Address, cGroup, body.CreditLimitMinor).Scan(
			&cu.ID, &cu.RestaurantID, &cu.Name, &cu.Phone, &cu.Email, &cu.Address, &cu.Notes,
			&cu.CustomerGroup, &cu.LoyaltyPoints, &cu.CreditLimitMinor, &cu.BalanceMinor, &cu.CreatedAt,
		)
		if err != nil {
			middleware.JSONError(w, http.StatusBadRequest, "CUSTOMER_CREATE_FAILED", err.Error(), nil)
			return
		}
		middleware.JSONSuccess(w, http.StatusCreated, cu, nil)
	})

	// POS Bootstrap (One-call complete load for cashiers and offline IndexedDB cache)
	r.Get("/pos/bootstrap", func(w http.ResponseWriter, req *http.Request) {
		restID := middleware.GetRestaurantID(req.Context())
		branchID := req.URL.Query().Get("branch_id")

		categories, _ := s.ListCategories(req.Context(), restID)
		items, _ := s.ListItems(req.Context(), restID, "")
		items = redactPurchaseCosts(middleware.GetUserClaims(req.Context()).Role, items)

		// Checkout Registers / Counters (mapped to tables table)
		var sections []models.TableSection
		secRows, _ := s.pool.Query(req.Context(), "SELECT id, restaurant_id, branch_id, name, sort FROM table_sections WHERE restaurant_id = $1 AND ($2 = '' OR branch_id = $2::uuid) ORDER BY sort ASC", restID, branchID)
		if secRows != nil {
			for secRows.Next() {
				var s models.TableSection
				if err := secRows.Scan(&s.ID, &s.RestaurantID, &s.BranchID, &s.Name, &s.Sort); err == nil {
					sections = append(sections, s)
				}
			}
			secRows.Close()
		}

		var tables []models.Table
		tblRows, _ := s.pool.Query(req.Context(), `
			SELECT t.id, t.restaurant_id, t.branch_id, t.section_id, COALESCE(s.name, ''), t.name, t.seats, t.pos_x, t.pos_y, t.status, t.current_order_id, t.created_at, t.updated_at
			FROM tables t
			LEFT JOIN table_sections s ON t.section_id = s.id
			WHERE t.restaurant_id = $1 AND ($2 = '' OR t.branch_id = $2::uuid)
			ORDER BY t.name ASC
		`, restID, branchID)
		if tblRows != nil {
			for tblRows.Next() {
				var tb models.Table
				if err := tblRows.Scan(&tb.ID, &tb.RestaurantID, &tb.BranchID, &tb.SectionID, &tb.SectionName, &tb.Name, &tb.Seats, &tb.PosX, &tb.PosY, &tb.Status, &tb.CurrentOrderID, &tb.CreatedAt, &tb.UpdatedAt); err == nil {
					tables = append(tables, tb)
				}
			}
			tblRows.Close()
		}

		// Settings & Payment methods
		var methods []models.PaymentMethod
		mRows, _ := s.pool.Query(req.Context(), "SELECT id, restaurant_id, code, label, is_active, requires_reference, created_at FROM payment_methods WHERE restaurant_id = $1 AND is_active = TRUE", restID)
		if mRows != nil {
			for mRows.Next() {
				var pm models.PaymentMethod
				if err := mRows.Scan(&pm.ID, &pm.RestaurantID, &pm.Code, &pm.Label, &pm.IsActive, &pm.RequiresReference, &pm.CreatedAt); err == nil {
					methods = append(methods, pm)
				}
			}
			mRows.Close()
		}

		settingsMap := make(map[string]interface{})
		stRows, _ := s.pool.Query(req.Context(), "SELECT key, value FROM settings WHERE restaurant_id = $1 AND key IN ('tax','receipt')", restID)
		if stRows != nil {
			for stRows.Next() {
				var k string
				var v []byte
				if err := stRows.Scan(&k, &v); err == nil {
					var val interface{}
					_ = json.Unmarshal(v, &val)
					settingsMap[k] = val
				}
			}
			stRows.Close()
		}

		// Customers for POS quick selector
		var customers []models.Customer
		cRows, _ := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, name, COALESCE(phone, ''), COALESCE(email, ''), COALESCE(address, ''), COALESCE(notes, ''),
			       COALESCE(customer_group, 'Regular'), COALESCE(loyalty_points, 0), credit_limit_minor, balance_minor, created_at
			FROM customers WHERE restaurant_id = $1 ORDER BY name ASC LIMIT 50
		`, restID)
		if cRows != nil {
			for cRows.Next() {
				var cu models.Customer
				if err := cRows.Scan(
					&cu.ID, &cu.RestaurantID, &cu.Name, &cu.Phone, &cu.Email, &cu.Address, &cu.Notes,
					&cu.CustomerGroup, &cu.LoyaltyPoints, &cu.CreditLimitMinor, &cu.BalanceMinor, &cu.CreatedAt,
				); err == nil {
					customers = append(customers, cu)
				}
			}
			cRows.Close()
		}

		// Active Promotions
		var promotions []models.Promotion
		pRows, _ := s.pool.Query(req.Context(), `
			SELECT id, restaurant_id, code, name, type, discount_pct, discount_minor, min_spend_minor, start_date, end_date, is_active, usage_limit, used_count, created_at
			FROM promotions WHERE restaurant_id = $1 AND is_active = TRUE AND NOW() BETWEEN start_date AND end_date
		`, restID)
		if pRows != nil {
			for pRows.Next() {
				var p models.Promotion
				if err := pRows.Scan(
					&p.ID, &p.RestaurantID, &p.Code, &p.Name, &p.Type, &p.DiscountPct, &p.DiscountMinor,
					&p.MinSpendMinor, &p.StartDate, &p.EndDate, &p.IsActive, &p.UsageLimit, &p.UsedCount, &p.CreatedAt,
				); err == nil {
					promotions = append(promotions, p)
				}
			}
			pRows.Close()
		}

		middleware.JSONSuccess(w, http.StatusOK, map[string]interface{}{
			"categories":      categories,
			"items":           items,
			"sections":        sections,
			"tables":          tables,
			"registers":       tables,
			"payment_methods": methods,
			"settings":        settingsMap,
			"customers":       customers,
			"promotions":      promotions,
		}, nil)
	})
}
