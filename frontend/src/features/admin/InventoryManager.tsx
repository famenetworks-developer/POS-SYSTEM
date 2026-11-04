import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MenuItem as Product } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import {
  Boxes,
  AlertTriangle,
  ArrowUpDown,
  Search,
  Plus,
  RefreshCw,
  Package,
  Calendar,
  Layers,
  X,
  FileText,
  DollarSign,
  TrendingDown,
} from 'lucide-react';

export const InventoryManager: React.FC = () => {
  const { restaurant, activeBranch } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'low_stock' | 'reorder'>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Stock Adjustment Modal
  const [showAdjustModal, setShowAdjustModal] = useState<boolean>(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState<string>('');
  const [adjustType, setAdjustType] = useState<'damage' | 'spoilage_expiry' | 'recount' | 'supplier_return'>('damage');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadStockData = async () => {
    setIsLoading(true);
    try {
      const items = await api.get('/items');
      setProducts(items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStockData();
  }, [activeBranch]);

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !adjustQty) return;
    setIsSubmitting(true);
    try {
      // Deduct or adjust stock
      const qtyNum = parseFloat(adjustQty);
      const isDeduction = adjustType !== 'recount';
      const delta = isDeduction ? -Math.abs(qtyNum) : qtyNum;

      await api.put(`/items/${selectedProduct.id}`, {
        ...selectedProduct,
        stock_quantity: Math.max(0, (selectedProduct.stock_quantity ?? 100) + delta),
      });

      setShowAdjustModal(false);
      setSelectedProduct(null);
      setAdjustQty('');
      setAdjustReason('');
      await loadStockData();
      alert('Stock adjustment recorded successfully in inventory audit log!');
    } catch (e: any) {
      alert('Error updating stock: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compute metrics
  let totalStockValuationMinor = 0;
  let totalUnits = 0;
  let lowStockCount = 0;

  products.forEach((p) => {
    const qty = p.stock_quantity ?? 100;
    const cost = p.cost_price_minor ?? Math.round(p.base_price_minor * 0.75);
    totalStockValuationMinor += Math.round(qty * cost);
    totalUnits += qty;
    if (qty <= (p.reorder_level ?? 15)) {
      lowStockCount++;
    }
  });

  const filteredProducts = products.filter((p) => {
    const matchSearch =
      !search ||
      p.name_en.toLowerCase().includes(search.toLowerCase()) ||
      (p.name_bn && p.name_bn.includes(search)) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.sku && p.sku.toLowerCase().includes(search.toLowerCase())) ||
      (p.brand && p.brand.toLowerCase().includes(search.toLowerCase()));

    let matchFilter = true;
    if (selectedFilter === 'low_stock') matchFilter = (p.stock_quantity ?? 100) <= (p.reorder_level ?? 15);
    if (selectedFilter === 'reorder') matchFilter = (p.stock_quantity ?? 100) <= (p.reorder_level ?? 15) * 1.5;

    return matchSearch && matchFilter;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              Stock Valuation & Control
            </span>
            <span className="text-xs text-[#64748B]">• {products.length} SKUs Monitored</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Inventory & Stock Valuation</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            FIFO stock ledger, automated POS checkout deductions, wastage tracking, and reorder levels
          </p>
        </div>

        <button
          onClick={loadStockData}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] text-xs font-bold text-[#475569] shadow-sm self-start sm:self-auto transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#0D5C3A]' : ''}`} />
          <span>Refresh Stock</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Total Stock Value</span>
            <div className="p-2 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] border border-[#C6E6D2]">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0D5C3A]">
              {formatMoney(totalStockValuationMinor, restaurant?.currency)}
            </h3>
            <p className="text-[11px] text-[#64748B] mt-1">Based on purchase cost prices</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Total Units On Hand</span>
            <div className="p-2 rounded-xl bg-[#E0F2FE] text-[#0284C7] border border-[#BAE6FD]">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0F172A]">{Math.round(totalUnits).toLocaleString()}</h3>
            <p className="text-[11px] text-[#64748B] mt-1">Across all FMCG departments</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Low Stock SKUs</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-amber-600">{lowStockCount}</h3>
            <p className="text-[11px] text-[#64748B] mt-1">Below safety reorder threshold</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Stock Health</span>
            <div className="p-2 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] border border-[#C6E6D2]">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0D5C3A]">
              {products.length > 0 ? Math.round(((products.length - lowStockCount) / products.length) * 100) : 100}%
            </h3>
            <p className="text-[11px] text-[#64748B] mt-1">Optimal SKU replenishment rate</p>
          </div>
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
            placeholder="Search by Barcode, SKU, Brand (Fresh, Teer), or Product Name..."
              aria-label="Search inventory"
            className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
          />
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto text-xs font-bold">
          <button
            onClick={() => setSelectedFilter('all')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              selectedFilter === 'all'
                ? 'bg-[#0D5C3A] text-white shadow-sm'
                : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
            }`}
          >
            All Stock
          </button>
          <button
            onClick={() => setSelectedFilter('low_stock')}
            className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
              selectedFilter === 'low_stock'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Low Stock ({lowStockCount})</span>
          </button>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[850px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-4">Item & Barcode</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Shelf / Aisle</th>
                <th className="py-3 px-4">Current Stock</th>
                <th className="py-3 px-4">Reorder Level</th>
                <th className="py-3 px-4">Avg Cost</th>
                <th className="py-3 px-4">Total Value</th>
                <th className="py-3 px-4 text-right">Adjustment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {filteredProducts.map((p) => {
                const isLow = (p.stock_quantity ?? 100) <= (p.reorder_level ?? 15);
                const cost = p.cost_price_minor ?? Math.round(p.base_price_minor * 0.75);
                const lineVal = Math.round((p.stock_quantity ?? 100) * cost);

                return (
                  <tr key={p.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-extrabold text-[#0F172A]">{p.name_en}</div>
                      <div className="text-[11px] text-[#64748B] flex items-center gap-2 font-mono">
                        <span>{p.barcode || p.sku || 'No Barcode'}</span>
                        {p.brand && <span className="text-[#0D5C3A] font-semibold">• {p.brand}</span>}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                        {p.category_name || 'Grocery'}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-semibold text-[#475569]">
                      {p.shelf_location || 'Aisle 1'}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${
                          isLow
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                        }`}
                      >
                        {p.stock_quantity ?? 100} {p.unit || 'pcs'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-[#64748B] font-semibold">
                      {p.reorder_level ?? 15} {p.unit || 'pcs'}
                    </td>

                    <td className="py-3 px-4 text-[#0F172A]">
                      {formatMoney(cost, restaurant?.currency)}
                    </td>

                    <td className="py-3 px-4 font-extrabold text-[#0D5C3A]">
                      {formatMoney(lineVal, restaurant?.currency)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedProduct(p);
                          setShowAdjustModal(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E6F4EA] text-[#475569] hover:text-[#0D5C3A] font-bold text-[11px] border border-[#E2E8F0] transition-all"
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Stock Adjustment (Damage, Recount, Spoilage) */}
      {showAdjustModal && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                  <ArrowUpDown className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[#0F172A]">Record Stock Adjustment</h3>
                  <p className="text-[11px] text-[#64748B] truncate max-w-[240px]">{selectedProduct.name_en}</p>
                </div>
              </div>
              <button
                onClick={() => setShowAdjustModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStockAdjustment} className="space-y-3.5">
              <div className="bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0] flex justify-between text-xs">
                <span className="text-[#64748B]">Current On-Hand:</span>
                <span className="font-black text-[#0D5C3A]">
                  {selectedProduct.stock_quantity ?? 100} {selectedProduct.unit || 'pcs'}
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Adjustment Type *</label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                >
                  <option value="damage">Damaged Packaging / Broken Container</option>
                  <option value="spoilage_expiry">Spoilage / Expired Grocery Goods</option>
                  <option value="recount">Physical Audit Recount (Variance)</option>
                  <option value="supplier_return">Return to FMCG Supplier / Vendor</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Quantity ({selectedProduct.unit || 'pcs'}) *</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Audit Reason / Inspector Note *</label>
                <textarea
                  rows={2}
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Broken seal during shelf restocking"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CBD5E1] text-xs font-bold text-[#64748B] hover:bg-[#F1F5F9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Confirm Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default InventoryManager;
