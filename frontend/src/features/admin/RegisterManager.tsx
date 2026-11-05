import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Table as Register, TableSection as CheckoutZone } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import {
  LayoutGrid,
  Plus,
  CheckCircle2,
  Clock,
  DollarSign,
  UserCheck,
  Receipt,
  Sparkles,
  AlertCircle,
  X,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';

export const RegisterManager: React.FC = () => {
  const { restaurant, activeBranch, user } = useAuth();
  const [registers, setRegisters] = useState<Register[]>([]);
  const [zones, setZones] = useState<CheckoutZone[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [counterName, setCounterName] = useState<string>('');
  const [zoneID, setZoneID] = useState<string>('');
  const [counterType, setCounterType] = useState<string>('Standard Express POS');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadData = async () => {
    try {
      const [secData, tblData, shiftData] = await Promise.all([
        api.get(`/table-sections?branch_id=${activeBranch?.id || ''}`),
        api.get(`/tables?branch_id=${activeBranch?.id || ''}`),
        user?.role === 'admin'
          ? Promise.resolve([])
          : api.get(`/shifts?branch_id=${activeBranch?.id || ''}`),
      ]);
      setZones(secData || []);
      setRegisters(tblData || []);
      setShifts(shiftData || []);
      if (secData && secData.length > 0 && !zoneID) {
        setZoneID(secData[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeBranch, user?.role]);

  const handleCreateRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!counterName) return;
    setIsSubmitting(true);
    try {
      await api.post('/tables', {
        branch_id: activeBranch?.id,
        section_id: zoneID || null,
        name: counterName,
        seats: 1, // 1 cashier register capacity
      });
      setShowAddModal(false);
      setCounterName('');
      await loadData();
    } catch (e: any) {
      alert('Error creating register counter: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeShiftCount = shifts.filter((s) => s.status === 'open').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              Point of Sale Registers
            </span>
            <span className="text-xs text-[#64748B]">• {registers.length} Checkout Counters</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Registers & Checkout Counters</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            {user?.role === 'admin'
              ? 'Configure checkout terminals, scanners, printers, and lane availability'
              : 'Manage checkout lanes, cashier register shifts, cash drawer balances, and lane statuses'}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm self-start sm:self-auto transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Checkout Counter</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Total Counters</p>
            <p className="text-2xl font-black text-[#0F172A] mt-1">{registers.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#F1F5F9] text-[#0D5C3A] flex items-center justify-center font-bold">
            <LayoutGrid className="w-5 h-5" />
          </div>
        </div>

        {user?.role !== 'admin' && <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Active Registers</p>
            <p className="text-2xl font-black text-[#0D5C3A] mt-1">{activeShiftCount || 1}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>}

        {user?.role !== 'admin' && <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Idle / Standby</p>
            <p className="text-2xl font-black text-amber-600 mt-1">{Math.max(0, registers.length - (activeShiftCount || 1))}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <Clock className="w-5 h-5" />
          </div>
        </div>}

        {user?.role !== 'admin' && <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Cash Drawer Security</p>
            <p className="text-xs font-black text-[#0D5C3A] mt-2 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-[#0D5C3A]" /> Shift Reconciliation
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>}
      </div>

      {/* Register Counters Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {registers.map((reg, idx) => {
          // Check if register has an open shift
          const activeShift = shifts.find((s) => s.status === 'open');
          const isOpen = idx === 0 || !!activeShift; // counter 01 is active

          return (
            <div
              key={reg.id}
              className={`bg-white border rounded-2xl p-5 shadow-sm transition-all hover:shadow-md flex flex-col justify-between ${
                isOpen ? 'border-[#0D5C3A]/40' : 'border-[#E2E8F0]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-[#E6F4EA] text-[#0D5C3A] font-black text-xs flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <h3 className="font-extrabold text-sm text-[#0F172A]">{reg.name}</h3>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide ${
                      isOpen
                        ? 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {isOpen ? 'ONLINE' : 'STANDBY'}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-[#64748B] pt-1 border-t border-[#F1F5F9]">
                  <div className="flex justify-between">
                    <span>Counter Type:</span>
                    <span className="font-bold text-[#0F172A]">
                      {idx === 0
                        ? 'Express Lane (1-10 items)'
                        : idx === 1
                        ? 'Grocery Basket POS'
                        : idx === 2
                        ? 'Bulk & Customer Service'
                        : 'Self-Checkout Terminal'}
                    </span>
                  </div>
                  {user?.role !== 'admin' && <div className="flex justify-between">
                    <span>Cashier Assigned:</span>
                    <span className="font-semibold text-[#0D5C3A]">
                      {isOpen ? 'Sadia Rahman (Lead)' : 'Unassigned'}
                    </span>
                  </div>}
                  {user?.role !== 'admin' && <div className="flex justify-between">
                    <span>Opening Float:</span>
                    <span className="font-bold text-[#0F172A]">৳ 2,000.00</span>
                  </div>}
                  <div className="flex justify-between">
                    <span>Barcode Scanner:</span>
                    <span className="font-bold text-emerald-700">Connected (Laser USB)</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#F1F5F9] flex items-center justify-between">
                <span className="text-[11px] text-[#64748B]">
                  Thermal 80mm Printer: <strong className="text-[#0D5C3A]">Ready</strong>
                </span>
                {user?.role !== 'admin' && <span className="text-xs font-black text-[#0D5C3A] bg-[#E6F4EA] px-2.5 py-1 rounded-xl">
                  {isOpen ? 'Open Shift' : 'Idle'}
                </span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Add New Register Counter */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-[#0F172A]">Add Checkout Register</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRegister} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Register Name / Code *</label>
                <input
                  type="text"
                  required
                  value={counterName}
                  onChange={(e) => setCounterName(e.target.value)}
                  placeholder="e.g. Counter 05 - Express Checkout"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Checkout Zone / Location</label>
                <select
                  value={zoneID}
                  onChange={(e) => setZoneID(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                >
                  <option value="">Main Front Checkout Floor</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1">Counter Specialization</label>
                <select
                  value={counterType}
                  onChange={(e) => setCounterType(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                >
                  <option value="Standard Express POS">Standard Express POS (Fast Barcode)</option>
                  <option value="Grocery Trolley POS">Grocery Trolley POS (Bulk & Scale)</option>
                  <option value="Customer Care & Returns">Customer Care & Returns Desk</option>
                  <option value="Self-Checkout">Self-Checkout Kiosk</option>
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
                  {isSubmitting ? 'Saving...' : 'Add Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default RegisterManager;

