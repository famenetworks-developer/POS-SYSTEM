import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shift } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { ShiftBar } from '../pos/ShiftBar';
import { Clock, AlertTriangle, CheckCircle2, ChevronRight, X, DollarSign, ShieldCheck } from 'lucide-react';

export const ShiftManager: React.FC = () => {
  const { user, restaurant, activeBranch } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedShift, setSelectedShift] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);

  const loadShifts = async () => {
    try {
      const data = await api.get(`/shifts?branch_id=${activeBranch?.id || ''}`);
      setShifts(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadShifts();
  }, [activeBranch]);

  const viewShiftDetail = async (shift: Shift) => {
    try {
      const rep = await api.get(`/shifts/${shift.id}/report`);
      setSelectedShift(rep);
      setShowDetailModal(true);
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
            Cash Drawer Audit
          </span>
          <span className="text-xs text-[#64748B]">• Register Shifts</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Register Shifts & Cash Reconciliation</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Audit cashier registers, opening cash float, expected cash drawer totals, counted cash, and variance logs
        </p>
      </div>

      {user?.role === 'cashier' && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
          <ShiftBar onChange={loadShifts} />
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[720px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3.5 px-4">Cashier</th>
                <th className="py-3.5 px-4">Terminal / Register</th>
                <th className="py-3.5 px-4">Opened At</th>
                <th className="py-3.5 px-4">Opening Float</th>
                <th className="py-3.5 px-4">Expected Cash</th>
                <th className="py-3.5 px-4">Counted Cash</th>
                <th className="py-3.5 px-4">Variance</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {shifts.map((s) => {
                const variance = s.variance_minor || 0;
                const hasVariance = s.status === 'closed' && variance !== 0;

                return (
                  <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-3.5 px-4 font-bold text-[#0F172A]">{s.cashier_name || 'Cashier'}</td>
                    <td className="py-3.5 px-4 text-[#64748B] font-mono">{s.terminal_id || 'Counter 01'}</td>
                    <td className="py-3.5 px-4 text-[#64748B]">
                      {new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })},{' '}
                      {new Date(s.opened_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-[#0F172A]">
                      {formatMoney(s.opening_cash_minor, restaurant?.currency)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-[#0D5C3A]">
                      {formatMoney(s.expected_cash_minor, restaurant?.currency)}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-[#0F172A]">
                      {s.counted_cash_minor ? formatMoney(s.counted_cash_minor, restaurant?.currency) : '—'}
                    </td>
                    <td className="py-3.5 px-4">
                      {hasVariance ? (
                        <span
                          className={`font-black ${
                            variance < 0 ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {variance < 0 ? '-' : '+'}
                          {formatMoney(Math.abs(variance), restaurant?.currency)}
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold">৳ 0.00</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${
                          s.status === 'open'
                            ? 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {s.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => viewShiftDetail(s)}
                        className="text-xs font-bold text-[#0D5C3A] hover:underline inline-flex items-center gap-1"
                      >
                        <span>Audit Log</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Shift Audit Report */}
      {showDetailModal && selectedShift && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[#0F172A]">Shift Reconciliation Report</h3>
                  <p className="text-xs text-[#64748B]">Terminal: {selectedShift.shift?.terminal_id || 'Counter 01'}</p>
                </div>
              </div>
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] space-y-2">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Cashier on Duty:</span>
                  <span className="font-bold text-[#0F172A]">{selectedShift.shift?.cashier_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Shift Status:</span>
                  <span className="font-black text-[#0D5C3A] uppercase">{selectedShift.shift?.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Opening Cash Float:</span>
                  <span className="font-bold text-[#0F172A]">
                    {formatMoney(selectedShift.shift?.opening_cash_minor || 0, restaurant?.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Expected Cash Drawer:</span>
                  <span className="font-black text-[#0D5C3A]">
                    {formatMoney(selectedShift.shift?.expected_cash_minor, restaurant?.currency)}
                  </span>
                </div>
                {selectedShift.shift?.counted_cash_minor > 0 && (
                  <div className="flex justify-between border-t border-[#E2E8F0] pt-2">
                    <span className="text-[#64748B]">Counted Cash:</span>
                    <span className="font-bold text-[#0F172A]">
                      {formatMoney(selectedShift.shift?.counted_cash_minor, restaurant?.currency)}
                    </span>
                  </div>
                )}
              </div>

              {selectedShift.shift?.variance_reason && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <span className="font-bold text-amber-800 block mb-1">Cashier Variance Note:</span>
                  <p className="text-amber-900">{selectedShift.shift.variance_reason}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-[#E2E8F0]">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 rounded-xl bg-[#0D5C3A] text-white text-xs font-black"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ShiftManager;
