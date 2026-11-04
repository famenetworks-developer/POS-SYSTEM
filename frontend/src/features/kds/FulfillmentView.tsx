import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { wsHub } from '../../lib/ws';
import { formatMoney } from '../../lib/money';
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  AlertCircle,
  Volume2,
  ShoppingBag,
  Layers,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

export const FulfillmentView: React.FC = () => {
  const { restaurant, activeBranch } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedTab, setSelectedTab] = useState<'all' | 'delivery' | 'pickup'>('all');
  const [now, setNow] = useState<number>(Date.now());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');

  const playChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {
      console.warn('Audio chime unavailable:', e);
    }
  };

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const data = await api.get(`/orders?branch_id=${activeBranch?.id || ''}`);
      setOrders(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const interval = setInterval(() => setNow(Date.now()), 15000);

    const unsubOrder = wsHub.subscribe('order.created', (order: any) => {
      setOrders((prev) => [order, ...prev]);
      playChime();
    });

    return () => {
      clearInterval(interval);
      unsubOrder();
    };
  }, [activeBranch]);

  const fulfillmentOrders = orders.filter((order) =>
    ['delivery', 'pickup'].includes(order.type) && !['delivered', 'cancelled', 'refunded'].includes(order.status)
  );

  const filtered = fulfillmentOrders.filter((o) => {
    if (selectedTab === 'delivery') return o.type === 'delivery';
    if (selectedTab === 'pickup') return o.type === 'pickup';
    return true;
  });

  const nextStatus = (order: any) => {
    if (order.status === 'picking') return 'packed';
    if (order.status === 'packed') return order.type === 'delivery' ? 'dispatched' : 'delivered';
    if (order.status === 'dispatched') return 'delivered';
    return 'picking';
  };

  const actionLabel = (order: any) => {
    const status = nextStatus(order);
    if (status === 'picking') return 'Start picking';
    if (status === 'packed') return 'Mark packed';
    if (status === 'dispatched') return 'Dispatch order';
    return 'Mark delivered';
  };

  const advanceOrder = async (order: any) => {
    const status = nextStatus(order);
    setUpdatingOrderId(order.id);
    setActionError('');
    try {
      await api.patch(`/orders/${order.id}/status`, { status });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item));
    } catch (error: any) {
      setActionError(error?.message || 'Could not update the order. Please try again.');
    } finally {
      setUpdatingOrderId('');
    }
  };

  return (
    <div className="app-content-height flex-1 flex flex-col bg-[#F8FAFC] overflow-hidden">
      {/* Top Header Bar */}
      <div className="p-4 bg-white border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold border border-[#C6E6D2]">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-[#0F172A]">Order Fulfillment & Picking Station</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-[#0D5C3A]">
                LIVE AISLE PICKING
              </span>
            </div>
            <p className="text-xs text-[#64748B]">
              Fulfill customer home delivery and in-store click & collect grocery orders
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-[#F1F5F9] p-1 rounded-xl text-xs font-bold text-[#475569]">
            <button
              onClick={() => setSelectedTab('all')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedTab === 'all' ? 'bg-white text-[#0D5C3A] shadow-xs' : 'hover:text-[#0D5C3A]'
              }`}
            >
              All Orders ({fulfillmentOrders.length})
            </button>
            <button
              onClick={() => setSelectedTab('delivery')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                selectedTab === 'delivery' ? 'bg-white text-[#0D5C3A] shadow-xs' : 'hover:text-[#0D5C3A]'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Home Delivery</span>
            </button>
            <button
              onClick={() => setSelectedTab('pickup')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                selectedTab === 'pickup' ? 'bg-white text-[#0D5C3A] shadow-xs' : 'hover:text-[#0D5C3A]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>In-Store Pickup</span>
            </button>
          </div>

          <button
            type="button"
            onClick={loadOrders}
            aria-label="Refresh fulfillment orders"
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#475569]"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {actionError && (
          <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {actionError}
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#94A3B8]">
            <Package className="w-12 h-12 text-[#CBD5E1] mb-2" />
            <p className="text-sm font-bold text-[#64748B]">No pending delivery or pickup orders in queue.</p>
            <p className="text-xs text-[#94A3B8] mt-1">Orders created at POS or online will appear here automatically.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((o) => {
              const elapsedMins = Math.floor((now - new Date(o.opened_at).getTime()) / 60000);
              const isUrgent = elapsedMins > 20;

              return (
                <div
                  key={o.id}
                  className={`bg-white border rounded-2xl p-4 shadow-sm flex flex-col justify-between transition-all ${
                    isUrgent ? 'border-amber-400 ring-2 ring-amber-100' : 'border-[#E2E8F0]'
                  }`}
                >
                  <div>
                    {/* Top status */}
                    <div className="flex items-center justify-between pb-2.5 border-b border-[#F1F5F9]">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-xs text-[#0F172A]">Order #{o.order_no}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#E6F4EA] text-[#0D5C3A]">
                          {o.status || (o.type === 'delivery' ? 'Home Delivery' : 'Store Pickup')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-[#64748B]">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{elapsedMins}m ago</span>
                      </div>
                    </div>

                    {/* Customer info */}
                    <div className="py-2.5 space-y-1 text-xs">
                      <div className="font-bold text-[#0F172A] flex items-center justify-between">
                        <span>{o.customer_name || 'Walk-in Shopper'}</span>
                        <span className="text-[#0D5C3A] font-black">
                          {formatMoney(o.total_minor, restaurant?.currency)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#64748B] flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-[#94A3B8]" />
                        <span>Banani Flagship Store Floor</span>
                      </div>
                    </div>

                    {/* Picking Checklist Note */}
                    <div className="p-2.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-[11px] text-[#475569] space-y-1">
                      <div className="font-bold text-[#0F172A] flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-[#0D5C3A]" />
                        <span>Grocery Picking List</span>
                      </div>
                      <p className="text-[10px] text-[#64748B]">
                        Pick items from designated aisles and scan at packing station.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 mt-3 border-t border-[#F1F5F9] flex gap-2">
                    <button
                      type="button"
                      onClick={() => advanceOrder(o)}
                      disabled={updatingOrderId === o.id}
                      className="flex-1 min-h-[44px] py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-xs flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-wait"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{updatingOrderId === o.id ? 'Updating...' : actionLabel(o)}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
export default FulfillmentView;

