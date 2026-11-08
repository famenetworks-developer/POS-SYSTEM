import React, { useState } from 'react';
import { Order, Restaurant, Branch } from '../../types';
import { formatMoney } from '../../lib/money';
import { Printer, X, CheckCircle2, ShoppingBag } from 'lucide-react';

interface ReceiptModalProps {
  order: Order;
  restaurant: Restaurant | null;
  branch: Branch | null;
  invoiceNo?: string;
  changeDue?: number;
  onClose: () => void;
  onNewSale?: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  order,
  restaurant,
  branch,
  invoiceNo,
  changeDue,
  onClose,
  onNewSale,
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');

  const handlePrint = () => {
    window.print();
  };

  const invNumber = invoiceNo || `BAN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${order.order_no}`;
  const otherDiscountMinor = Math.max(0, order.discount_minor - (order.loyalty_discount_minor || 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm animate-fade-in overflow-hidden">
      <div className="bg-white border border-[#E3E6E8] rounded-xl shadow-2xl w-full max-w-[480px] overflow-hidden flex flex-col h-auto max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]">
        {/* Header toolbar */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 border-b border-[#E3E6E8] bg-white">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#0F172A]">Format:</span>
            <div className="flex rounded-lg bg-[#E2E8F0] p-0.5">
              <button
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                  paperWidth === '80mm' ? 'bg-[#0D5C3A] text-white shadow-sm' : 'text-[#475569] hover:text-[#0D5C3A]'
                }`}
              >
                80mm
              </button>
              <button
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                  paperWidth === '58mm' ? 'bg-[#0D5C3A] text-white shadow-sm' : 'text-[#475569] hover:text-[#0D5C3A]'
                }`}
              >
                58mm
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thermal Receipt Preview Area */}
        <div className="receipt-scroll-area flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 flex items-start justify-center bg-[#F3F4F6]">
          <div
            id="printable-receipt"
            className={`${
              paperWidth === '80mm' ? 'w-[80mm] p-3' : 'w-[58mm] p-2'
            } max-w-full shrink-0 bg-white text-black shadow-md rounded-sm text-left font-mono text-[11px] leading-tight overflow-hidden`}
          >
            {/* Header */}
            <div className="text-center pb-2 border-b border-dashed border-gray-400">
              <h2 className="text-base font-black tracking-tight uppercase text-black font-sans">
                {restaurant?.name || 'NOVAMART SUPER SHOP'}
              </h2>
              <p className="text-[10px] font-semibold text-gray-700 mt-0.5 uppercase tracking-wide">
                Premium Super Shop
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5 font-sans">
                {branch?.name || 'Banani Flagship Outlet'}
              </p>
              {branch?.address && <p className="text-[9px] text-gray-600">{branch.address}</p>}
              {branch?.phone && <p className="text-[9px] text-gray-600">Hotline: {branch.phone}</p>}
              <p className="text-[10px] font-bold text-gray-900 mt-1">
                BIN/VAT: {restaurant?.tax_no || 'BIN-0023948571029'}
              </p>
            </div>

            {/* Metadata */}
            <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
              <div className="flex justify-between font-bold">
                <span>INVOICE:</span>
                <span className="text-right break-all pl-3">{invNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span className="text-right pl-3">{new Date(order.opened_at || Date.now()).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Sales Mode:</span>
                <span className="capitalize font-bold text-right pl-3">{order.type === 'walk_in' ? 'Walk-in Sale' : order.type === 'pickup' ? 'Store Pickup' : 'Home Delivery'}</span>
              </div>
              {order.table_name && (
                <div className="flex justify-between">
                  <span>Register:</span>
                  <span className="font-bold text-right pl-3">{order.table_name}</span>
                </div>
              )}
              {order.waiter_name && (
                <div className="flex justify-between">
                  <span>Cashier:</span>
                  <span className="text-right pl-3">{order.waiter_name}</span>
                </div>
              )}
              {order.customer_name && (
                <div className="flex justify-between border-t border-dotted border-gray-300 pt-0.5 mt-0.5 font-medium">
                  <span>Customer:</span>
                  <span className="text-right pl-3 truncate max-w-[60%]">{order.customer_name}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-gray-400 text-[10px]">
              <div className="flex justify-between font-bold border-b border-gray-400 pb-1 mb-1">
                <span>ITEM / SKU</span>
                <span>PRICE</span>
              </div>
              {order.items?.map((it, idx) => {
                const lineTotal = it.qty * it.unit_price_minor - it.discount_minor;
                return (
                  <div key={idx} className="py-1 border-b border-dotted border-gray-200 last:border-0">
                    <div className="font-bold text-[11px] truncate">
                      {it.name_snapshot}
                    </div>
                    <div className="flex justify-between text-gray-700 text-[10px] mt-0.5">
                      <span>
                        {it.qty} x {formatMoney(it.unit_price_minor, restaurant?.currency)}
                      </span>
                      <span className="font-bold text-black">{formatMoney(lineTotal, restaurant?.currency)}</span>
                    </div>
                    {it.discount_minor > 0 && (
                      <div className="text-[9px] text-red-600">
                        Discount: -{formatMoney(it.discount_minor, restaurant?.currency)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Totals Breakdown */}
            <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-1">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatMoney(order.subtotal_minor, restaurant?.currency)}</span>
              </div>
              {otherDiscountMinor > 0 && (
                <div className="flex justify-between text-red-600 font-semibold">
                  <span>Promotion Discount:</span>
                  <span>-{formatMoney(otherDiscountMinor, restaurant?.currency)}</span>
                </div>
              )}
              {order.loyalty_discount_minor > 0 && (
                <div className="flex justify-between text-[#0D5C3A] font-semibold">
                  <span>Loyalty ({order.loyalty_points_redeemed} pts):</span>
                  <span>-{formatMoney(order.loyalty_discount_minor, restaurant?.currency)}</span>
                </div>
              )}
              {order.tax_minor > 0 && (
                <div className="flex justify-between">
                  <span>VAT / Tax (5%):</span>
                  <span>{formatMoney(order.tax_minor, restaurant?.currency)}</span>
                </div>
              )}
              {order.delivery_fee_minor > 0 && (
                <div className="flex justify-between">
                  <span>Delivery Fee:</span>
                  <span>{formatMoney(order.delivery_fee_minor, restaurant?.currency)}</span>
                </div>
              )}
              {order.round_off_minor !== 0 && (
                <div className="flex justify-between text-[9px] text-gray-600">
                  <span>Rounding:</span>
                  <span>{formatMoney(order.round_off_minor, restaurant?.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs font-black border-t border-gray-400 pt-1 mt-1 font-sans">
                <span>NET PAYABLE:</span>
                <span>{formatMoney(order.total_minor, restaurant?.currency)}</span>
              </div>
            </div>

            {order.customer_name && (order.loyalty_points_redeemed > 0 || order.loyalty_points_earned > 0) && (
              <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
                {order.loyalty_points_redeemed > 0 && <div className="flex justify-between"><span>Points Redeemed:</span><span className="font-bold">-{order.loyalty_points_redeemed}</span></div>}
                {order.loyalty_points_earned > 0 && <div className="flex justify-between"><span>Points Earned:</span><span className="font-bold">+{order.loyalty_points_earned}</span></div>}
              </div>
            )}

            {/* Payments & Change */}
            <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
              {order.payments && order.payments.length > 0 ? (
                order.payments.map((p, pIdx) => (
                  <div key={pIdx} className="flex justify-between font-semibold">
                    <span className="uppercase">Tendered ({p.method_code}):</span>
                    <span>{formatMoney(p.amount_minor, restaurant?.currency)}</span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between font-semibold">
                  <span>Tendered:</span>
                  <span>{formatMoney(order.paid_minor || order.total_minor, restaurant?.currency)}</span>
                </div>
              )}
              {changeDue !== undefined && changeDue > 0 && (
                <div className="flex justify-between font-bold text-black border-t border-dotted border-gray-300 pt-0.5 mt-0.5">
                  <span>Change Returned:</span>
                <span className="tabular-nums text-right pl-3">{formatMoney(changeDue, restaurant?.currency)}</span>
                </div>
              )}
            </div>

            {/* Barcode Simulation & Policy Footer */}
            <div className="text-center pt-3 text-[9px] text-gray-700 space-y-1">
              <div className="tracking-widest font-mono text-center font-bold text-xs py-1 border border-black inline-block px-3">
                *{invNumber}*
              </div>
              <p className="font-bold text-black mt-1">Thank you for shopping at NovaMart!</p>
              <p>Exchange within 7 days with original invoice</p>
              <p className="text-[8px] text-gray-500">Everyday essentials, intelligently managed</p>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="shrink-0 px-3 sm:px-4 py-3 border-t border-[#E3E6E8] bg-white grid grid-cols-[1fr_auto] items-center gap-2 sm:gap-3">
          <button
            onClick={() => {
              if (onNewSale) onNewSale();
              onClose();
            }}
            className="min-w-0 flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-lg text-xs font-bold text-[#E21B70] bg-[#FFF0F6] hover:bg-[#FFEBF3] transition-colors whitespace-nowrap"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Start New Sale</span>
          </button>
          <div className="flex items-center justify-end gap-1.5 sm:gap-2">
            <button
              onClick={onClose}
              className="px-2.5 sm:px-3.5 py-2.5 rounded-lg text-xs font-semibold text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
            >
              Close
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-lg text-xs font-bold bg-[#E21B70] hover:bg-[#C91661] text-white transition-colors whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>Print Receipt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
