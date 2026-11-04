package platform

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // Non-browser POS clients do not always send Origin.
		}
		if wsAllowAllOrigins {
			return true
		}
		return wsAllowedOrigins[origin]
	},
}

var (
	wsAllowedOrigins  = map[string]bool{}
	wsAllowAllOrigins bool
)

func ConfigureWSOrigins(origins []string) {
	wsAllowedOrigins = make(map[string]bool, len(origins))
	wsAllowAllOrigins = false
	for _, origin := range origins {
		if origin == "*" {
			wsAllowAllOrigins = true
			continue
		}
		wsAllowedOrigins[origin] = true
	}
}

type WSEvent struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
	Ts    string      `json:"ts"`
}

type Client struct {
	Hub          *WSHub
	Conn         *websocket.Conn
	Send         chan []byte
	RestaurantID string
	BranchID     string
}

type WSHub struct {
	clients    map[*Client]bool
	rooms      map[string]map[*Client]bool
	broadcast  chan broadcastMessage
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

type broadcastMessage struct {
	room string
	data []byte
}

func NewWSHub() *WSHub {
	return &WSHub{
		clients:    make(map[*Client]bool),
		rooms:      make(map[string]map[*Client]bool),
		broadcast:  make(chan broadcastMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			if client.RestaurantID != "" {
				restRoom := "restaurant:" + client.RestaurantID
				if h.rooms[restRoom] == nil {
					h.rooms[restRoom] = make(map[*Client]bool)
				}
				h.rooms[restRoom][client] = true
			}
			if client.BranchID != "" {
				branchRoom := "branch:" + client.BranchID
				if h.rooms[branchRoom] == nil {
					h.rooms[branchRoom] = make(map[*Client]bool)
				}
				h.rooms[branchRoom][client] = true
			}
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
				for _, clients := range h.rooms {
					delete(clients, client)
				}
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			if clients, ok := h.rooms[msg.room]; ok {
				for client := range clients {
					select {
					case client.Send <- msg.data:
					default:
						close(client.Send)
						delete(h.clients, client)
						delete(clients, client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *WSHub) BroadcastToRoom(room string, event string, data interface{}) {
	payload, err := json.Marshal(WSEvent{
		Event: event,
		Data:  data,
		Ts:    time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		log.Printf("[WS] Failed to marshal event: %v", err)
		return
	}
	h.broadcast <- broadcastMessage{
		room: room,
		data: payload,
	}
}

func (h *WSHub) BroadcastRestaurant(restaurantID, event string, data interface{}) {
	h.BroadcastToRoom("restaurant:"+restaurantID, event, data)
}

func (h *WSHub) BroadcastBranch(branchID, event string, data interface{}) {
	h.BroadcastToRoom("branch:"+branchID, event, data)
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()
	c.Conn.SetReadLimit(512)
	_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, _, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func ServeWS(hub *WSHub, w http.ResponseWriter, r *http.Request, restaurantID, branchID string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade error: %v", err)
		return
	}
	client := &Client{
		Hub:          hub,
		Conn:         conn,
		Send:         make(chan []byte, 256),
		RestaurantID: restaurantID,
		BranchID:     branchID,
	}
	hub.register <- client

	go client.WritePump()
	go client.ReadPump()
}
