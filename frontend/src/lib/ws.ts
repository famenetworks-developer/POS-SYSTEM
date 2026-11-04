// Realtime WebSocket client with automatic reconnection and event listeners

type EventCallback = (data: any) => void;

const websocketBaseUrl = () => {
  const configured = import.meta.env.VITE_WS_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

class RealtimeHub {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectTimer: any = null;
  private branchId: string = '';
  private token: string = '';
  // False after disconnect() so a deliberate close (e.g. logout) does not reconnect.
  private active = false;

  // branchId may be empty (e.g. super admin, who has no branch); the user still gets their personal events.
  public connect(branchId: string) {
    this.active = true;
    const branchChanged = branchId !== this.branchId;
    this.branchId = branchId;
    this.token = localStorage.getItem('restoflow_token') || '';

    if (!this.token) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (!branchChanged) return;
      // Rejoin with the new branch straight away instead of waiting for the reconnect timer.
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
      this.emit('connection', false);
    }

    const wsUrl = `${websocketBaseUrl()}?token=${encodeURIComponent(this.token)}&branch_id=${encodeURIComponent(branchId)}`;
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emit('connection', true);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { event: eventName, data } = payload;
          if (eventName) this.emit(eventName, data);
        } catch (e) {
          console.error('[WS] Parse error', e);
        }
      };

      this.ws.onclose = () => {
        this.emit('connection', false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.active) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active) {
        this.connect(this.branchId);
      }
    }, 3000);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  public isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public subscribe(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  public disconnect() {
    this.active = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsHub = new RealtimeHub();
