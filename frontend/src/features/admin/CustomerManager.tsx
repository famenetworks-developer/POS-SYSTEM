import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Customer } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import {
  Users,
  Plus,
  Search,
  Star,
  Award,
  Phone,
  Mail,
  Gift,
  Coins,
  CheckCircle2,
  X,
  CreditCard,
  ShoppingBag,
  Pencil,
} from 'lucide-react';

interface LoyaltyRule {
  points_per_unit: number;
  discount_minor_per_unit: number;
  auto_redeem: boolean;
}

export const CustomerManager: React.FC = () => {
  const { restaurant, user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loyaltyRule, setLoyaltyRule] = useState<LoyaltyRule>({ points_per_unit: 100, discount_minor_per_unit: 5000, auto_redeem: true });
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [rulePoints, setRulePoints] = useState('100');
  const [ruleDiscount, setRuleDiscount] = useState('50');
  const [isSavingRule, setIsSavingRule] = useState(false);

  // Add Customer Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [customerGroup, setCustomerGroup] = useState<string>('regular');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const [data, rule] = await Promise.all([api.get('/customers'), api.get('/customers/loyalty-settings')]);
      setCustomers(data || []);
      if (rule) setLoyaltyRule(rule);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const openRuleEditor = () => {
    setRulePoints(String(loyaltyRule.points_per_unit));
    setRuleDiscount((loyaltyRule.discount_minor_per_unit / 100).toFixed(2));
    setShowRuleModal(true);
  };

  const handleSaveRule = async (event: React.FormEvent) => {
    event.preventDefault();
    const points = Math.floor(Number(rulePoints));
    const discountMinor = Math.round(Number(ruleDiscount) * 100);
    if (!Number.isFinite(points) || points < 1 || !Number.isFinite(discountMinor) || discountMinor < 1) {
      alert('Enter positive values for points and discount.');
      return;
    }
    setIsSavingRule(true);
    try {
      const saved = await api.patch<LoyaltyRule>('/customers/loyalty-settings', { points_per_unit: points, discount_minor_per_unit: discountMinor, auto_redeem: true });
      setLoyaltyRule(saved);
      setShowRuleModal(false);
    } catch (error: any) {
      alert('Could not save redemption rule: ' + error.message);
    } finally {
      setIsSavingRule(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;
    setIsSubmitting(true);
    try {
      await api.post('/customers', {
        name,
        phone,
        email,
        customer_group: customerGroup,
      });
      setShowAddModal(false);
      setName('');
      setPhone('');
      setEmail('');
      setCustomerGroup('regular');
      await loadCustomers();
    } catch (e: any) {
      alert('Failed to register customer: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = customers.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone && c.phone.includes(search)) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()));

    const matchTier = selectedTier === 'all' || (c.customer_group || 'regular') === selectedTier;
    return matchSearch && matchTier;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              NovaClub Loyalty
            </span>
            <span className="text-xs text-[#64748B]">• {customers.length} Members registered</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Customers & Loyalty Program</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Manage super shop shoppers, reward loyalty points, customer tiers, and purchase credit
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm self-start sm:self-auto transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Register New Customer</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Total Members</p>
            <p className="text-2xl font-black text-[#0F172A] mt-1">{customers.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Gold & VIP Tier</p>
            <p className="text-2xl font-black text-[#C5A059] mt-1">
              {customers.filter((c) => c.customer_group === 'gold' || c.customer_group === 'vip').length || 2}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <Award className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Points Issued</p>
            <p className="text-2xl font-black text-[#0D5C3A] mt-1">
              {customers.reduce((acc, c) => acc + (c.loyalty_points || 0), 0).toLocaleString()}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
            <Coins className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Redemption Rule</p>
            <p className="text-xs font-bold text-[#0D5C3A] mt-1">{loyaltyRule.points_per_unit.toLocaleString()} Pts = {formatMoney(loyaltyRule.discount_minor_per_unit, restaurant?.currency)} Discount</p>
            <p className="text-[9px] text-[#64748B] mt-0.5">Automatically applied at checkout</p>
          </div>
          {(user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager') ? <button type="button" onClick={openRuleEditor} aria-label="Edit redemption rule" title="Edit redemption rule" className="w-10 h-10 rounded-xl bg-[#E0F2FE] text-[#0284C7] hover:bg-[#BAE6FD] flex items-center justify-center font-bold transition-colors"><Pencil className="w-4 h-4" /></button> : <div className="w-10 h-10 rounded-xl bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center font-bold"><Gift className="w-5 h-5" /></div>}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Mobile number (017..., 018...) or Customer Name..."
              aria-label="Search customers"
            className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
          />
        </div>

        <div className="w-full sm:w-auto max-w-full flex items-center gap-1.5 self-stretch sm:self-auto text-xs font-bold overflow-x-auto pb-1 sm:pb-0">
          {['all', 'regular', 'silver', 'gold', 'vip'].map((tier) => (
            <button
              key={tier}
              onClick={() => setSelectedTier(tier)}
              className={`px-3 py-1.5 rounded-xl uppercase tracking-wide transition-all ${
                selectedTier === tier
                  ? 'bg-[#0D5C3A] text-white shadow-sm'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[750px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-4">Member Name</th>
                <th className="py-3 px-4">Mobile / Contact</th>
                <th className="py-3 px-4">Membership Tier</th>
                <th className="py-3 px-4">Loyalty Points</th>
                <th className="py-3 px-4">Points Cash Value</th>
                <th className="py-3 px-4">Customer Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {filtered.map((c) => {
                const points = c.loyalty_points || 0;
                const pointsValueMinor = Math.floor(points / loyaltyRule.points_per_unit) * loyaltyRule.discount_minor_per_unit;
                const tier = (c.customer_group || 'regular').toUpperCase();

                return (
                  <tr key={c.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-extrabold text-[#0F172A] flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-[#E6F4EA] text-[#0D5C3A] font-bold text-xs flex items-center justify-center">
                          {c.name.charAt(0)}
                        </span>
                        <span>{c.name}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-mono text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-[#0D5C3A]" />
                        <span>{c.phone || '—'}</span>
                      </div>
                      {c.email && (
                        <div className="text-[11px] text-[#64748B] flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 text-[#94A3B8]" />
                          <span>{c.email}</span>
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide ${
                          tier === 'GOLD' || tier === 'VIP'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : tier === 'SILVER'
                            ? 'bg-slate-100 text-slate-700 border border-slate-300'
                            : 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                        }`}
                      >
                        {tier}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-black text-xs text-[#0D5C3A]">
                      <div className="flex items-center gap-1">
                        <Coins className="w-3.5 h-3.5 text-amber-500" />
                        <span>{points} Pts</span>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-bold text-[#475569]">
                      ৳ {(pointsValueMinor / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-4 font-semibold text-[#0F172A]">
                      {c.balance_minor ? formatMoney(c.balance_minor, restaurant?.currency) : '৳ 0.00'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showRuleModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div><h3 className="text-sm font-black text-[#0F172A]">Edit Redemption Rule</h3><p className="text-[11px] text-[#64748B] mt-0.5">Applied automatically when a customer checks out</p></div>
              <button type="button" onClick={() => setShowRuleModal(false)} className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveRule} className="space-y-4 pt-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                <label className="text-xs font-bold text-[#0F172A]">Points required<input type="number" min="1" step="1" required value={rulePoints} onChange={(e) => setRulePoints(e.target.value)} className="mt-1 w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3 py-2 text-sm" /></label>
                <span className="pb-2 text-sm font-black text-[#64748B]">=</span>
                <label className="text-xs font-bold text-[#0F172A]">Discount (BDT)<input type="number" min="0.01" step="0.01" required value={ruleDiscount} onChange={(e) => setRuleDiscount(e.target.value)} className="mt-1 w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3 py-2 text-sm" /></label>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-800">Complete point units are redeemed automatically. The discount is capped so an invoice can never become negative.</div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#E2E8F0]"><button type="button" onClick={() => setShowRuleModal(false)} className="px-4 py-2 rounded-xl border text-xs font-bold">Cancel</button><button type="submit" disabled={isSavingRule} className="px-5 py-2 rounded-xl bg-[#0D5C3A] text-white text-xs font-black disabled:opacity-50">{isSavingRule ? 'Saving...' : 'Save Rule'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Register Customer */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-[#0F172A]">Register NovaClub Customer</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tanvir Ahmed"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Mobile Phone (Primary Key) *</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 01711223344"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. tanvir@gmail.com"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Membership Tier</label>
                <select
                  value={customerGroup}
                  onChange={(e) => setCustomerGroup(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                >
                  <option value="regular">Regular Shopper</option>
                  <option value="silver">Silver Member (5% birthday discount)</option>
                  <option value="gold">Gold VIP (1.5x loyalty points)</option>
                  <option value="vip">Platinum VIP (Free home delivery)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CBD5E1] text-xs font-bold text-[#64748B] hover:bg-[#F1F5F9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Register Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default CustomerManager;

