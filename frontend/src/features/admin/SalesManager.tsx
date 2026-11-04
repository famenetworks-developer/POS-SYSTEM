import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { ReceiptModal } from '../../components/ui/ReceiptModal';
import {
  Receipt,
  Search,
  RotateCcw,
  Printer,
  Calendar,
  Filter,
  CheckCircle2,
  AlertCircle,
  X,
  CreditCard,
  DollarSign,
  User,
  ShoppingBag,
} from 'lucide-react';

export const SalesManager: React.FC = () => {
  const { restaurant, activeBranch } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Receipt Modal
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<any>(null);

  // Refund Modal
  const [showRefundModal, setShowRefundModal] = useState<boolean>(false);
  const [refundOrder, setRefundOrder] = useState<any>(null);
  const [refundReason, setRefundReason] = useState<string>('Customer Product Return');
  const [restockItems, setRestockItems] = useState<boolean>(true);
  const [isSubmittingRefund, setIsSubmittingRefund] = useState<boolean>(false);

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
  }, [activeBranch]);

  const handleOpenReceipt = async (orderId: string) => {
    try {
      const res = await api.get(`/orders/${orderId}/receipt`);
      if (res && res.order) {
        setSelectedReceiptOrder(res.order);
      }
    } catch (e: any) {
      alert('Failed to load receipt: ' + e.message);
    }
  };

  const handleExecuteRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundOrder) return;
    setIsSubmittingRefund(true);
    try {
      await api.post(`/orders/${refundOrder.id}/refund`, {
        amount_minor: refundOrder.total_minor,
        reason: refundReason,
        restock: restockItems,
      });
      setShowRefundModal(false);
      setRefundOrder(null);
      await loadOrders();
      alert('Order returned & refunded successfully. Stock has been restored.');
    } catch (e: any) {
      alert('Refund failed: ' + e.message);
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    const matchSearch =
      !search ||
      (o.order_no && o.order_no.toString().includes(search)) ||
      (o.id && o.id.toLowerCase().includes(search.toLowerCase())) ||
      (o.customer_name && o.customer_name.toLowerCase().includes(search.toLowerCase()));

    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              Cashier Invoices & Receipts
            </span>
            <span className="text-xs text-[#64748B]">• {orders.length} Invoices recorded</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Sales & Invoices</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            View completed retail checkouts, reprint 80mm tax receipts, and process customer product returns
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Order #, Invoice #, or Customer Name..."
              aria-label="Search sales and invoices"
            className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
          />
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto text-xs font-bold">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              statusFilter === 'all'
                ? 'bg-[#0D5C3A] text-white shadow-sm'
                : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
            }`}
          >
            All Invoices
          </button>
          <button
            onClick={() => setStatusFilter('paid')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              statusFilter === 'paid'
                ? 'bg-[#0D5C3A] text-white shadow-sm'
                : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
            }`}
          >
            Paid Only
          </button>
          <button
            onClick={() => setStatusFilter('refunded')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              statusFilter === 'refunded'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
            }`}
          >
            Refunded
          </button>
        </div>
      </div>

      {/* Orders / Invoices Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[850px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-4">Invoice / Order #</th>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Checkout Counter</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Total Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#94A3B8] text-xs">
                    No sales invoices found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => {
                  const isPaid = o.status === 'paid';
                  const isRefunded = o.status === 'refunded';

                  return (
                    <tr key={o.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                          <Receipt className="w-3.5 h-3.5 text-[#0D5C3A]" />
                          <span>Order #{o.order_no}</span>
                        </div>
                        <div className="text-[10px] text-[#94A3B8] font-mono">{o.id.slice(0, 8)}...</div>
                      </td>

                      <td className="py-3 px-4 text-[#475569]">
                        {new Date(o.opened_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>

                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#F1F5F9] text-[#475569] uppercase">
                          {o.type === 'walk_in' ? 'Walk-in' : o.type === 'pickup' ? 'Pickup' : 'Home Delivery'}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-semibold text-[#0F172A]">
                        {o.table_name || 'Counter 01'}
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-bold text-[#0F172A]">{o.customer_name || 'Walk-in Shopper'}</span>
                      </td>

                      <td className="py-3 px-4 font-black text-xs text-[#0D5C3A]">
                        {formatMoney(o.total_minor, restaurant?.currency)}
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${
                            isPaid
                              ? 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                              : isRefunded
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {o.status.toUpperCase()}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenReceipt(o.id)}
                            className="p-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E6F4EA] text-[#475569] hover:text-[#0D5C3A] font-bold text-[11px] border border-[#E2E8F0] transition-all flex items-center gap-1"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Receipt</span>
                          </button>

                          {isPaid && (
                            <button
                              onClick={() => {
                                setRefundOrder(o);
                                setShowRefundModal(true);
                              }}
                              className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] border border-rose-200 transition-all flex items-center gap-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Refund</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Process Return & Refund */}
      {showRefundModal && refundOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[#0F172A]">Process Return & Refund</h3>
                  <p className="text-xs text-[#64748B]">Order #{refundOrder.order_no}</p>
                </div>
              </div>
              <button
                onClick={() => setShowRefundModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteRefund} className="space-y-3.5">
              <div className="bg-rose-50 p-3 rounded-xl border border-rose-200 flex justify-between items-center text-xs">
                <span className="font-bold text-rose-900">Total Refund Amount:</span>
                <span className="text-base font-black text-rose-700">
                  {formatMoney(refundOrder.total_minor, restaurant?.currency)}
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Return Reason *</label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                >
                  <option value="Customer Product Return">Customer Returned Product (Unopened)</option>
                  <option value="Damaged / Defective Packaging">Damaged or Leaking Package</option>
                  <option value="Wrong Item Scanned by Cashier">Wrong Item Scanned by Cashier</option>
                  <option value="Price Discrepancy">Price Discrepancy / Shelf Tag Mismatch</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-[#0F172A] cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={restockItems}
                  onChange={(e) => setRestockItems(e.target.checked)}
                  className="rounded text-[#0D5C3A] focus:ring-[#0D5C3A]"
                />
                <span>Automatically restock items back into grocery inventory</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CBD5E1] text-xs font-bold text-[#64748B] hover:bg-[#F1F5F9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRefund}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black shadow-sm disabled:opacity-50"
                >
                  {isSubmittingRefund ? 'Processing...' : 'Confirm Return & Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 80mm Receipt Modal Preview */}
      {selectedReceiptOrder && (
        <ReceiptModal
          order={selectedReceiptOrder}
          restaurant={restaurant}
          branch={activeBranch}
          invoiceNo={`INV-${selectedReceiptOrder.id.slice(0, 8).toUpperCase()}`}
          onClose={() => setSelectedReceiptOrder(null)}
        />
      )}
    </div>
  );
};
export default SalesManager;
