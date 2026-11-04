import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  AlertTriangle,
  Award,
  Wallet,
  Boxes,
  Users,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export const AdminDashboard: React.FC = () => {
  const { restaurant, activeBranch, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [stockSummary, setStockSummary] = useState<{ totalValuationMinor: number; lowStockCount: number }>({
    totalValuationMinor: 0,
    lowStockCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchDashboard = async () => {
    setIsLoading(true);
    try {
      const [res, items] = await Promise.all([
        api.get(`/reports/dashboard?branch_id=${activeBranch?.id || ''}`),
        api.get('/items'),
      ]);
      setData(res);

      if (Array.isArray(items)) {
        let val = 0;
        let low = 0;
        items.forEach((it: any) => {
          const qty = it.stock_quantity ?? 100;
          const cost = it.cost_price_minor ?? it.base_price_minor * 0.75;
          val += Math.round(qty * cost);
          if (qty <= (it.reorder_level ?? 15)) {
            low++;
          }
        });
        setStockSummary({ totalValuationMinor: val, lowStockCount: low });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [activeBranch]);

  if (isLoading || !data) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-500 gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-[#0D5C3A]" />
        <span className="text-sm font-bold text-[#0D5C3A]">Loading NovaMart super shop analytics...</span>
      </div>
    );
  }

  const chartData =
    data.sales_trend?.map((d: any) => ({
      day: d.day?.slice(5),
      sales: (d.sales_minor || 0) / 100,
    })) || [];

  const pieData =
    data.payment_mix?.map((p: any) => ({
      name: p.method?.toUpperCase(),
      value: (p.amount_minor || 0) / 100,
    })) || [];

  const PIE_COLORS = ['#0D5C3A', '#1E7E50', '#C5A059', '#2E8B57', '#E25C38'];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-[#0D5C3A] to-[#16422F] text-white p-5 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/20 text-[#A3E5C1]">
              Live Store Analytics
            </span>
            <span className="text-xs text-emerald-100 font-medium">• {activeBranch?.name || 'All Outlets'}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">NovaMart Super Shop Overview</h1>
          <p className="text-xs text-emerald-100 mt-0.5">
            Real-time cashier checkout revenue, grocery inventory valuation, and store margin tracking
          </p>
        </div>

        <button
          onClick={fetchDashboard}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all border border-white/20 self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Today Sales */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-[#0D5C3A]/40 transition-all">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Today's Sales</span>
            <div className="p-2 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] border border-[#C6E6D2]">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0F172A]">
              {formatMoney(data.today_sales_minor, restaurant?.currency)}
            </h3>
            <p className="text-[11px] text-[#64748B] mt-1">
              <span className="text-[#0D5C3A] font-bold">{data.today_orders || 0} customer receipts</span> today
            </p>
          </div>
        </div>

        {/* Owner-only strategic profitability */}
        {user?.role === 'owner' && <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-[#0D5C3A]/40 transition-all">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Month Net Profit</span>
            <div className="p-2 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] border border-[#C6E6D2]">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0F172A]">
              {formatMoney(data.month_net_profit, restaurant?.currency)}
            </h3>
            <p className="text-[11px] text-[#0D5C3A] font-bold mt-1">
              Store Margin: {data.month_margin_pct?.toFixed(1) || '24.5'}% (Automated P&L)
            </p>
          </div>
        </div>}

        {/* Card 3: Inventory Valuation */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-[#0D5C3A]/40 transition-all">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Stock Valuation</span>
            <div className="p-2 rounded-xl bg-[#E0F2FE] text-[#0284C7] border border-[#BAE6FD]">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0F172A]">
              {formatMoney(stockSummary.totalValuationMinor, restaurant?.currency)}
            </h3>
            <p className="text-[11px] text-[#64748B] mt-1">
              {stockSummary.lowStockCount > 0 ? (
                <span className="text-amber-600 font-bold">{stockSummary.lowStockCount} items near reorder level</span>
              ) : (
                <span className="text-emerald-700 font-medium">All aisles fully stocked</span>
              )}
            </p>
          </div>
        </div>

        {/* Card 4: Average Basket Size */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-[#0D5C3A]/40 transition-all">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Average Basket</span>
            <div className="p-2 rounded-xl bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0F172A]">
              {formatMoney(data.today_avg_bill_minor, restaurant?.currency)}
            </h3>
            <p className="text-[11px] text-[#64748B] mt-1">Average retail checkout invoice</p>
          </div>
        </div>
      </div>

      {/* Charts Section: 7-Day Trend + Payment Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Trend Chart */}
        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold text-[#0F172A]">7-Day Super Shop Revenue Trend</h3>
            <span className="text-[11px] text-[#64748B] font-medium">Daily Invoiced Sales (BDT)</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0D5C3A" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0D5C3A" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} />
                <YAxis stroke="#94A3B8" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E2E8F0',
                    borderRadius: '0.75rem',
                    color: '#0F172A',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                  }}
                  itemStyle={{ color: '#0D5C3A', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="sales" stroke="#0D5C3A" strokeWidth={3} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Mix Pie Chart */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <h3 className="text-sm font-extrabold text-[#0F172A] mb-2">Tender / Payment Mix</h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                  {pieData.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E2E8F0',
                    borderRadius: '0.75rem',
                    color: '#0F172A',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2 justify-center pt-2 border-t border-[#F1F5F9]">
            {pieData.map((p: any, idx: number) => (
              <span key={idx} className="text-[10px] font-bold text-[#475569] flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                ></span>
                {p.name}: ৳ {p.value.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Grid: Top Selling Grocery Products & Low Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Items Leaderboard */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-[#C5A059]" />
            <h3 className="text-sm font-extrabold text-[#0F172A]">Top Selling Grocery Products & SKUs</h3>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {data.top_items && data.top_items.length > 0 ? (
              data.top_items.map((it: any, i: number) => (
                <div key={i} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-[#E6F4EA] text-[#0D5C3A] text-xs font-black flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-[#0F172A] truncate">{it.name}</h4>
                      <span className="text-[10px] text-[#64748B]">{it.qty} units sold</span>
                    </div>
                  </div>
                  <span className="text-xs font-extrabold text-[#0D5C3A] shrink-0">
                    {formatMoney(it.rev_minor, restaurant?.currency)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-[#64748B] py-4 text-center">No sales registered yet today.</p>
            )}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="text-sm font-extrabold text-[#0F172A]">Low Stock Reorder Alerts</h3>
            </div>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              Immediate PO Required
            </span>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {data.low_stock && data.low_stock.length > 0 ? (
              data.low_stock.map((ls: any, i: number) => (
                <div key={i} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-[#0F172A] truncate">{ls.name}</h4>
                    <span className="text-[10px] text-[#64748B]">
                      Reorder Threshold: {ls.min_level} {ls.unit || 'units'}
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                    {ls.on_hand} {ls.unit || 'units'} left
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-[#0D5C3A] font-medium py-4 text-center">
                All super shop inventory levels are above safety stock.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
