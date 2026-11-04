import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Supplier } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import {
  Truck,
  Plus,
  Search,
  Phone,
  Mail,
  DollarSign,
  FileText,
  Calendar,
  CheckCircle2,
  X,
  Building,
  PackageCheck,
} from 'lucide-react';

export const SupplierManager: React.FC = () => {
  const { restaurant, user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [search, setSearch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Add Supplier Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [contactPerson, setContactPerson] = useState<string>('');
  const [terms, setTerms] = useState<string>('Net 30 Days');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadSuppliers = async () => {
    setIsLoading(true);
    try {
      const [data, orders] = await Promise.all([api.get('/suppliers'), api.get('/purchase-orders')]);
      setSuppliers(data || []);
      setPurchaseOrders(orders || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setIsSubmitting(true);
    try {
      await api.post('/suppliers', {
        name,
        phone,
      });
      setShowAddModal(false);
      setName('');
      setPhone('');
      setContactPerson('');
      await loadSuppliers();
    } catch (e: any) {
      alert('Error adding supplier: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = suppliers.filter((s) => {
    return (
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.phone && s.phone.includes(search))
    );
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              Supply Chain & Vendors
            </span>
            <span className="text-xs text-[#64748B]">• {suppliers.length} FMCG Distributors</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Suppliers & Purchase Orders</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Manage FMCG brand distributors, purchase agreements, credit terms, and goods receipts
          </p>
        </div>

        {user?.role !== 'admin' && <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm self-start sm:self-auto transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Supplier</span>
        </button>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Active FMCG Vendors</span>
            <div className="p-2 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] border border-[#C6E6D2]">
              <Building className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0F172A]">{suppliers.length}</h3>
            <p className="text-[11px] text-[#64748B] mt-1">Direct corporate distributors</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Total Accounts Payable</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-amber-600">
              {formatMoney(
                suppliers.reduce((acc, s) => acc + (s.balance_minor || 0), 0),
                restaurant?.currency
              )}
            </h3>
            <p className="text-[11px] text-[#64748B] mt-1">Outstanding distributor credit</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Open Purchase Orders</span>
            <div className="p-2 rounded-xl bg-[#E0F2FE] text-[#0284C7] border border-[#BAE6FD]">
              <PackageCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-[#0284C7]">{purchaseOrders.filter((po) => !['received', 'cancelled'].includes(po.status)).length}</h3>
            <p className="text-[11px] text-[#64748B] mt-1">Awaiting approval, delivery or receiving</p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Vendor Name (Meghna, City Group, PRAN, Aarong, Unilever)..."
              aria-label="Search suppliers"
            className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
          />
        </div>
      </div>

      {/* Supplier Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[750px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-4">Distributor / Supplier Name</th>
                <th className="py-3 px-4">Helpline & Contact</th>
                <th className="py-3 px-4">Payment Terms</th>
                <th className="py-3 px-4">Payable Balance</th>
                <th className="py-3 px-4">Created Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-extrabold text-[#0F172A] flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[#E6F4EA] text-[#0D5C3A] font-black text-xs flex items-center justify-center">
                        <Truck className="w-3.5 h-3.5" />
                      </div>
                      <span>{s.name}</span>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="font-mono text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-[#0D5C3A]" />
                      <span>{s.phone || '02-88001122'}</span>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                      Not configured
                    </span>
                  </td>

                  <td className="py-3 px-4 font-black text-xs text-[#0D5C3A]">
                    {formatMoney(s.balance_minor || 0, restaurant?.currency)}
                  </td>

                  <td className="py-3 px-4 text-[#64748B]">
                    {s.created_at
                      ? new Date(s.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Active'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add Supplier */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-[#0F172A]">Add FMCG Supplier</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Company / Vendor Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. City Group (Teer)"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Contact Phone *</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 01700112233"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Payment Credit Terms</label>
                <select
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                >
                  <option value="Net 30 Days">Net 30 Days</option>
                  <option value="Net 15 Days">Net 15 Days</option>
                  <option value="Cash on Delivery (COD)">Cash on Delivery (COD)</option>
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
                  {isSubmitting ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default SupplierManager;
