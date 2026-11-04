package approvals

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"restoflow/internal/audit"
	"restoflow/internal/middleware"
)

type Service struct {
	pool  *pgxpool.Pool
	audit *audit.AuditService
}

func New(pool *pgxpool.Pool, auditService *audit.AuditService) *Service {
	return &Service{pool: pool, audit: auditService}
}

func (s *Service) MountRoutes(r chi.Router) {
	r.Get("/approvals", s.list)
	r.Post("/orders/{id}/refund-request", s.requestRefund)
	r.Post("/orders/{id}/discount-request", s.requestDiscount)
	r.Post("/orders/{id}/void-request", s.requestVoid)
	r.Post("/approvals/{id}/decision", s.decide)
}

func (s *Service) list(w http.ResponseWriter, req *http.Request) {
	c := middleware.GetUserClaims(req.Context())
	status := req.URL.Query().Get("status")
	rows, err := s.pool.Query(req.Context(), `
		SELECT a.id,a.branch_id,a.type,a.status,a.entity_type,a.entity_id,a.requested_by,
		       COALESCE(a.decided_by::text,''),a.reason,COALESCE(a.decision_note,''),a.amount_minor,a.payload,a.requested_at,a.decided_at
		FROM approval_requests a
		WHERE a.restaurant_id=$1 AND ($2='' OR a.status=$2)
		AND ($3 IN ('owner','admin') OR EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id::text=$4 AND ub.branch_id=a.branch_id))
		AND ($3 <> 'cashier' OR a.requested_by::text=$4)
		ORDER BY a.requested_at DESC LIMIT 100`, c.RestaurantID, status, c.Role, c.UserID)
	if err != nil {
		middleware.JSONError(w, 500, "FETCH_FAILED", err.Error(), nil)
		return
	}
	defer rows.Close()
	list := []map[string]interface{}{}
	for rows.Next() {
		var id, branch, typ, st, entity, requester, decider, reason, note string
		var entityID *string
		var amount int64
		var payload json.RawMessage
		var at time.Time
		var decided *time.Time
		if rows.Scan(&id, &branch, &typ, &st, &entity, &entityID, &requester, &decider, &reason, &note, &amount, &payload, &at, &decided) == nil {
			list = append(list, map[string]interface{}{"id": id, "branch_id": branch, "type": typ, "status": st, "entity_type": entity, "entity_id": entityID, "requested_by": requester, "decided_by": decider, "reason": reason, "decision_note": note, "amount_minor": amount, "payload": payload, "requested_at": at, "decided_at": decided})
		}
	}
	middleware.JSONSuccess(w, 200, list, nil)
}

func (s *Service) createOrderRequest(w http.ResponseWriter, req *http.Request, typ string) {
	c := middleware.GetUserClaims(req.Context())
	orderID := chi.URLParam(req, "id")
	var body struct {
		AmountMinor     int64   `json:"amount_minor"`
		DiscountPercent float64 `json:"discount_percent"`
		Reason          string  `json:"reason"`
		Restock         bool    `json:"restock"`
	}
	if json.NewDecoder(req.Body).Decode(&body) != nil || body.Reason == "" {
		middleware.JSONError(w, 400, "INVALID_REQUEST", "A reason is required", nil)
		return
	}
	var branchID, status string
	var total int64
	if err := s.pool.QueryRow(req.Context(), "SELECT branch_id,status,total_minor FROM orders WHERE id=$1 AND restaurant_id=$2", orderID, c.RestaurantID).Scan(&branchID, &status, &total); err != nil {
		middleware.JSONError(w, 404, "ORDER_NOT_FOUND", "Order was not found", nil)
		return
	}
	if typ == "refund" && status != "paid" {
		middleware.JSONError(w, 400, "NOT_REFUNDABLE", "Only paid orders can be refunded", nil)
		return
	}
	if body.AmountMinor <= 0 {
		body.AmountMinor = total
	}
	payload, _ := json.Marshal(map[string]interface{}{"restock": body.Restock, "discount_percent": body.DiscountPercent})
	var id string
	err := s.pool.QueryRow(req.Context(), `INSERT INTO approval_requests(restaurant_id,branch_id,type,entity_type,entity_id,requested_by,reason,amount_minor,payload) VALUES($1,$2,$3,'order',$4,$5,$6,$7,$8) RETURNING id`, c.RestaurantID, branchID, typ, orderID, c.UserID, body.Reason, body.AmountMinor, payload).Scan(&id)
	if err != nil {
		middleware.JSONError(w, 400, "REQUEST_FAILED", err.Error(), nil)
		return
	}
	_, _ = s.pool.Exec(req.Context(), "INSERT INTO approval_status_history(approval_request_id,to_status,changed_by,note) VALUES($1,'pending',$2,$3)", id, c.UserID, body.Reason)
	s.audit.Log(req.Context(), "REQUEST_"+typ, "approval_request", &id, nil, body, "", "")
	middleware.JSONSuccess(w, 201, map[string]interface{}{"id": id, "status": "pending"}, nil)
}
func (s *Service) requestRefund(w http.ResponseWriter, r *http.Request) {
	s.createOrderRequest(w, r, "refund")
}
func (s *Service) requestDiscount(w http.ResponseWriter, r *http.Request) {
	s.createOrderRequest(w, r, "discount")
}
func (s *Service) requestVoid(w http.ResponseWriter, r *http.Request) {
	s.createOrderRequest(w, r, "void")
}

func (s *Service) decide(w http.ResponseWriter, req *http.Request) {
	c := middleware.GetUserClaims(req.Context())
	if c.Role != "owner" && c.Role != "manager" {
		middleware.JSONError(w, 403, "FORBIDDEN", "Only a Manager or Owner can decide requests", nil)
		return
	}
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	_ = json.NewDecoder(req.Body).Decode(&body)
	if body.Decision != "approved" && body.Decision != "rejected" {
		middleware.JSONError(w, 400, "INVALID_DECISION", "Decision must be approved or rejected", nil)
		return
	}
	tx, err := s.pool.Begin(req.Context())
	if err != nil {
		middleware.JSONError(w, 500, "DB_ERROR", err.Error(), nil)
		return
	}
	defer tx.Rollback(req.Context())
	id := chi.URLParam(req, "id")
	var branchID, typ, status, entity string
	var entityID *string
	var requester, reason string
	var amount int64
	var payload []byte
	err = tx.QueryRow(req.Context(), `SELECT branch_id,type,status,entity_type,entity_id,requested_by,reason,amount_minor,payload FROM approval_requests WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`, id, c.RestaurantID).Scan(&branchID, &typ, &status, &entity, &entityID, &requester, &reason, &amount, &payload)
	if err != nil || status != "pending" {
		middleware.JSONError(w, 409, "NOT_PENDING", "Approval request is not pending", nil)
		return
	}
	if c.Role == "manager" {
		var ok bool
		_ = tx.QueryRow(req.Context(), "SELECT EXISTS(SELECT 1 FROM user_branches WHERE user_id=$1 AND branch_id=$2)", c.UserID, branchID).Scan(&ok)
		if !ok {
			middleware.JSONError(w, 403, "BRANCH_FORBIDDEN", "This request is outside your assigned branches", nil)
			return
		}
	}
	if body.Decision == "approved" && entityID != nil {
		if entity == "order" {
			err = s.executeOrder(tx, typ, *entityID, c.RestaurantID, c.UserID, requester, reason, amount, payload, id)
		}
		if entity == "purchase_order" && typ == "purchase" {
			_, err = tx.Exec(req.Context(), "UPDATE purchase_orders SET status='approved',approved_by=$1,approved_at=NOW() WHERE id=$2 AND restaurant_id=$3 AND status='pending_approval'", c.UserID, *entityID, c.RestaurantID)
		}
		if entity == "product" && typ == "stock_adjustment" {
			var p struct {
				BranchID  string  `json:"branch_id"`
				ProductID string  `json:"product_id"`
				Type      string  `json:"type"`
				QtyChange float64 `json:"qty_change"`
				Reason    string  `json:"reason"`
			}
			_ = json.Unmarshal(payload, &p)
			if p.Reason == "" || p.QtyChange == 0 {
				err = fmt.Errorf("invalid stock adjustment payload")
			} else {
				_, err = tx.Exec(req.Context(), "UPDATE menu_items SET stock_quantity=GREATEST(0,stock_quantity+$1),updated_at=NOW() WHERE id=$2 AND restaurant_id=$3", p.QtyChange, p.ProductID, c.RestaurantID)
				if err == nil {
					_, err = tx.Exec(req.Context(), `INSERT INTO stock_adjustments(restaurant_id,branch_id,product_id,type,qty_change,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, c.RestaurantID, p.BranchID, p.ProductID, p.Type, p.QtyChange, p.Reason, requester)
				}
			}
		}
		if err != nil {
			middleware.JSONError(w, 400, "EXECUTION_FAILED", err.Error(), nil)
			return
		}
	}
	final := body.Decision
	if body.Decision == "approved" {
		final = "executed"
	}
	_, err = tx.Exec(req.Context(), "UPDATE approval_requests SET status=$1,decided_by=$2,decision_note=$3,decided_at=NOW(),executed_at=CASE WHEN $1='executed' THEN NOW() ELSE NULL END WHERE id=$4", final, c.UserID, body.Note, id)
	if err != nil {
		middleware.JSONError(w, 500, "UPDATE_FAILED", err.Error(), nil)
		return
	}
	_, _ = tx.Exec(req.Context(), "INSERT INTO approval_status_history(approval_request_id,from_status,to_status,changed_by,note) VALUES($1,'pending',$2,$3,$4)", id, final, c.UserID, body.Note)
	if err = tx.Commit(req.Context()); err != nil {
		middleware.JSONError(w, 500, "COMMIT_FAILED", err.Error(), nil)
		return
	}
	s.audit.Log(req.Context(), "DECIDE_APPROVAL", "approval_request", &id, map[string]string{"status": "pending"}, map[string]string{"status": final}, "", "")
	middleware.JSONSuccess(w, 200, map[string]string{"id": id, "status": final}, nil)
}

func (s *Service) executeOrder(tx pgx.Tx, typ, orderID, restID, approver, requester, reason string, amount int64, raw []byte, approvalID string) error {
	ctx := context.Background()
	switch typ {
	case "refund":
		var total int64
		if err := tx.QueryRow(ctx, "SELECT total_minor FROM orders WHERE id=$1 AND restaurant_id=$2 AND status='paid'", orderID, restID).Scan(&total); err != nil {
			return err
		}
		if amount <= 0 || amount > total {
			return fmt.Errorf("refund amount exceeds the paid order total")
		}
		var payload struct {
			Restock bool `json:"restock"`
		}
		_ = json.Unmarshal(raw, &payload)
		refundID := uuid.New().String()
		if _, err := tx.Exec(ctx, `INSERT INTO refunds(id,restaurant_id,order_id,amount_minor,reason,approved_by,restock,requested_by,approval_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, refundID, restID, orderID, amount, reason, approver, payload.Restock, requester, approvalID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE orders SET status='refunded' WHERE id=$1", orderID); err != nil {
			return err
		}
		if payload.Restock {
			_, err := tx.Exec(ctx, `UPDATE menu_items m SET stock_quantity=m.stock_quantity+x.qty,updated_at=NOW() FROM (SELECT item_id,SUM(qty) qty FROM order_items WHERE order_id=$1 AND item_id IS NOT NULL GROUP BY item_id)x WHERE m.id=x.item_id`, orderID)
			if err != nil {
				return err
			}
		}
	case "void":
		_, err := tx.Exec(ctx, "UPDATE orders SET status='cancelled' WHERE id=$1 AND restaurant_id=$2 AND status NOT IN ('paid','refunded')", orderID, restID)
		return err
	case "discount":
		var payload struct {
			DiscountPercent float64 `json:"discount_percent"`
		}
		_ = json.Unmarshal(raw, &payload)
		if payload.DiscountPercent <= 0 || payload.DiscountPercent > 100 {
			return fmt.Errorf("invalid discount percentage")
		}
		_, err := tx.Exec(ctx, `UPDATE orders SET discount_minor=ROUND(subtotal_minor*$1/100.0),total_minor=GREATEST(0,total_minor-ROUND(subtotal_minor*$1/100.0)+discount_minor) WHERE id=$2 AND restaurant_id=$3`, payload.DiscountPercent, orderID, restID)
		return err
	}
	return nil
}
