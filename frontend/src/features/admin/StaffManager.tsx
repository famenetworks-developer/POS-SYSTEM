import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { User } from '../../types';
import { api } from '../../lib/api';
import { Plus, Key, Shield, UserCheck, UserX, X, Users, BadgeCheck } from 'lucide-react';

export const StaffManager: React.FC = () => {
  const { user, activeBranch } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [role, setRole] = useState<string>('cashier');
  const [discountLimit, setDiscountLimit] = useState<number>(10);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadStaff = async () => {
    try {
      const data = await api.get('/users');
      setUsers(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/users', {
        name,
        email,
        password,
        pin,
        role,
        discount_limit_pct: discountLimit,
        branch_ids: activeBranch ? [activeBranch.id] : [],
      });
      setShowAddModal(false);
      setName('');
      setEmail('');
      setPassword('');
      setPin('');
      await loadStaff();
      alert('Staff member registered successfully!');
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleUserStatus = async (targetUser: User) => {
    try {
      await api.patch(`/users/${targetUser.id}/status`, { is_active: !targetUser.is_active });
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, is_active: !targetUser.is_active } : u))
      );
    } catch (e: any) {
      alert('Error updating user status: ' + e.message);
    }
  };

  const roleLabels: Record<string, { label: string; badge: string }> = {
    super_admin: { label: 'Super Admin', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
    admin: { label: 'Tenant Admin', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    owner: { label: 'Store Owner', badge: 'bg-emerald-50 text-[#0D5C3A] border-emerald-200' },
    manager: { label: 'Branch Manager', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
    cashier: { label: 'Cashier (Register)', badge: 'bg-green-50 text-green-700 border-green-200' },
    inventory_manager: { label: 'Inventory Head', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
    purchase_manager: { label: 'Purchase Officer', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    accountant: { label: 'Chief Accountant', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    delivery_staff: { label: 'Delivery Staff', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              Access & Security
            </span>
            <span className="text-xs text-[#64748B]">• {users.length} Team Members</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Staff & Role Permissions</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Manage cashier terminals, supervisor overrides, discount caps, and shift authorizations
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm self-start sm:self-auto transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Staff Member</span>
        </button>
      </div>

      {/* Staff Grid Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-4">Employee Name</th>
                <th className="py-3 px-4">Email Login</th>
                <th className="py-3 px-4">System Role</th>
                <th className="py-3 px-4">Max Discount Cap</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {users.map((u) => {
                const roleInfo = roleLabels[u.role] || {
                  label: u.role,
                  badge: 'bg-slate-100 text-slate-700 border-slate-200',
                };

                return (
                  <tr key={u.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-extrabold text-[#0F172A] flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-[#E6F4EA] text-[#0D5C3A] font-bold text-xs flex items-center justify-center">
                          {u.name.charAt(0)}
                        </span>
                        <span>{u.name}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-xs text-[#64748B]">
                      {u.email}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black border ${roleInfo.badge}`}
                      >
                        {roleInfo.label}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-bold text-[#0D5C3A]">
                      {u.discount_limit_pct}%
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${
                          u.is_active
                            ? 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {u.is_active ? 'ACTIVE' : 'SUSPENDED'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      {u.id !== user?.id && (
                        <button
                          onClick={() => toggleUserStatus(u)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                            u.is_active
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-[#0D5C3A] border-emerald-200'
                          }`}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add Staff Member */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-[#0F172A]">Add Team Member</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Mahfuzur Rahman"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Email Address (Login ID) *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mahfuz@novamart.com"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Password *</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 chars"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Quick Terminal PIN (4-digit)</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="e.g. 2222"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Role *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  >
                    <option value="cashier">Cashier (Register Operator)</option>
                    <option value="manager">Branch Manager</option>
                    <option value="inventory_manager">Inventory Head</option>
                    <option value="purchase_manager">Purchase Officer</option>
                    <option value="accountant">Chief Accountant</option>
                    <option value="delivery_staff">Delivery & Fulfillment</option>
                    {user?.role === 'owner' && <option value="admin">Tenant Administrator</option>}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Max Discount Cap (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discountLimit}
                    onChange={(e) => setDiscountLimit(parseInt(e.target.value) || 0)}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
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
                  {isSubmitting ? 'Saving...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default StaffManager;
