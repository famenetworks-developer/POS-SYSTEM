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

  public connect(branchId: string) {
    this.branchId = branchId;
    this.token = localStorage.getItem('restoflow_token') || '';

    if (!this.token) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = `${websocketBaseUrl()}?token=${encodeURIComponent(this.token)}&branch_id=${encodeURIComponent(branchId)}`;
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Connected
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { event: eventName, data } = payload;
          if (eventName && this.listeners.has(eventName)) {
            this.listeners.get(eventName)!.forEach((cb) => cb(data));
          }
        } catch (e) {
          console.error('[WS] Parse error', e);
        }
      };

      this.ws.onclose = () => {
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
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.branchId) {
        this.connect(this.branchId);
      }
    }, 3000);
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
