import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, LogIn, LogOut, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import { formatMoney, toMinorUnits } from '../../lib/money';
import { Shift } from '../../types';

interface CloseResult {
  expected_cash: number;
  counted_cash: number;
  variance_minor: number;
}

interface ShiftBarProps {
  // Change this value (e.g. after a sale) to reload the shift and its expected cash.
  refreshKey?: number;
  // Called after a shift is opened or closed.
  onChange?: () => void;
  // Called whenever it is known whether the cashier has an open shift.
  onShiftChange?: (hasOpenShift: boolean) => void;
}

const moneyInputClass =
  'mt-1 w-full min-h-[48px] rounded-lg border border-[#CBD5E1] px-3 text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#E21B70]';

// Shows the signed-in cashier's shift at the active branch, with Open shift / Close shift.
export const ShiftBar: React.FC<ShiftBarProps> = ({ refreshKey = 0, onChange, onShiftChange }) => {
  const { user, restaurant, activeBranch } = useAuth();
  const [shift, setShift] = useState<Shift | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<'open' | 'close' | null>(null);
  const [cashInput, setCashInput] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const branchId = activeBranch?.id;
  const userId = user?.id;
  const money = (minor: number) => formatMoney(minor, restaurant?.currency);

  const loadShift = useCallback(async () => {
    if (!branchId || !userId) return;
    try {
      const list = await api.get<Shift[]>(`/shifts?branch_id=${branchId}`);
      const mine = (list || []).find((s) => s.status === 'open' && s.cashier_id === userId) || null;
      setShift(mine);
      onShiftChange?.(mine !== null);
    } catch {
      setShift(null);
      onShiftChange?.(false);
    } finally {
      setLoaded(true);
    }
  }, [branchId, userId, onShiftChange]);

  useEffect(() => {
    void loadShift();
  }, [loadShift, refreshKey]);

  const openDialog = (kind: 'open' | 'close') => {
    setDialog(kind);
    setCashInput('');
    setNote('');
    setError('');
    setCloseResult(null);
  };

  const closeDialog = () => {
    if (!busy) setDialog(null);
  };

  // Plain amounts only, e.g. 2000 or 2000.50; anything else keeps the button disabled.
  const cashValid = /^\d+(\.\d{1,2})?$/.test(cashInput.trim());
  const cashMinor = cashValid ? toMinorUnits(cashInput.trim()) : null;
  const variance = shift && cashValid ? (cashMinor as number) - shift.expected_cash_minor : 0;

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || !cashValid) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/shifts/open', { branch_id: branchId, opening_cash_minor: cashMinor });
      setDialog(null);
      await loadShift();
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the shift');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shift || !cashValid) return;
    if (variance !== 0 && !note.trim()) {
      setError('The drawer does not match. Write a short note explaining the difference.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post<CloseResult>(`/shifts/${shift.id}/close`, { counted_cash_minor: cashMinor, note: note.trim() });
      setCloseResult(res);
      await loadShift();
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close the shift');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || !branchId) return null;

  const opened = shift ? new Date(shift.opened_at) : null;
  const openedLabel = opened
    ? `${opened.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${opened.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';

  return (
    <>
      {shift ? (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2">
          <Clock className="w-4 h-4 shrink-0 text-[#0D5C3A]" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black text-[#0D5C3A]">Shift open · since {openedLabel}</p>
            <p className="text-[10px] text-[#475569]">Cash that should be in the drawer: <span className="font-bold">{money(shift.expected_cash_minor)}</span></p>
          </div>
          <button
            type="button"
            onClick={() => openDialog('close')}
            className="inline-flex shrink-0 items-center gap-1 min-h-[32px] rounded-lg border border-[#0D5C3A] px-2.5 text-[11px] font-bold text-[#0D5C3A] hover:bg-white"
          >
            <LogOut className="w-3.5 h-3.5" /> Close shift
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
          <p className="min-w-0 flex-1 text-[11px] font-semibold text-amber-900">No open shift. Open a shift to start selling.</p>
          <button
            type="button"
            onClick={() => openDialog('open')}
            className="inline-flex shrink-0 items-center gap-1 min-h-[32px] rounded-lg bg-[#E21B70] px-2.5 text-[11px] font-bold text-white hover:bg-[#C91661]"
          >
            <LogIn className="w-3.5 h-3.5" /> Open shift
          </button>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/60 p-4" onClick={closeDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={dialog === 'open' ? 'Open shift' : 'Close shift'}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <button type="button" onClick={closeDialog} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-[#334155] hover:bg-[#F1F5F9]">
              <X className="w-5 h-5" />
            </button>

            {dialog === 'open' && (
              <form onSubmit={handleOpen}>
                <h2 className="text-base font-black text-[#0F172A]">Open shift</h2>
                <p className="mt-1 text-xs text-[#64748B]">Count the cash in the drawer before your first sale and enter it here.</p>
                <label className="mt-4 block text-xs font-bold text-[#334155]">
                  Opening cash (BDT)
                  <input autoFocus inputMode="decimal" value={cashInput} onChange={(e) => setCashInput(e.target.value)} placeholder="0" className={moneyInputClass} />
                </label>
                {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">{error}</p>}
                <button type="submit" disabled={!cashValid || busy} className="mt-4 w-full min-h-[44px] rounded-xl bg-[#E21B70] text-sm font-bold text-white hover:bg-[#C91661] disabled:opacity-50">
                  {busy ? 'Opening…' : 'Open shift'}
                </button>
              </form>
            )}

            {dialog === 'close' && shift && !closeResult && (
              <form onSubmit={handleClose}>
                <h2 className="text-base font-black text-[#0F172A]">Close shift</h2>
                <p className="mt-1 text-xs text-[#64748B]">Count all the cash in the drawer and enter the total.</p>
                <dl className="mt-4 space-y-1 rounded-lg bg-[#F8FAFC] p-3 text-xs">
                  <div className="flex justify-between"><dt className="text-[#64748B]">Opening cash</dt><dd className="font-semibold">{money(shift.opening_cash_minor)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[#64748B]">Should be in the drawer</dt><dd className="font-black">{money(shift.expected_cash_minor)}</dd></div>
                </dl>
                <label className="mt-4 block text-xs font-bold text-[#334155]">
                  Cash you counted (BDT)
                  <input autoFocus inputMode="decimal" value={cashInput} onChange={(e) => setCashInput(e.target.value)} placeholder="0" className={moneyInputClass} />
                </label>
                {cashValid && (
                  <p className={`mt-2 text-center text-sm font-black ${variance === 0 ? 'text-emerald-700' : variance < 0 ? 'text-rose-600' : 'text-amber-700'}`}>
                    {variance === 0 ? 'Drawer matches ✓' : variance < 0 ? `${money(-variance)} short` : `${money(variance)} over`}
                  </p>
                )}
                {cashValid && variance !== 0 && (
                  <label className="mt-3 block text-xs font-bold text-[#334155]">
                    Why doesn't it match? (required)
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E21B70]" />
                  </label>
                )}
                {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">{error}</p>}
                <button type="submit" disabled={!cashValid || busy} className="mt-4 w-full min-h-[44px] rounded-xl bg-[#0D5C3A] text-sm font-bold text-white hover:bg-[#0A4A2E] disabled:opacity-50">
                  {busy ? 'Closing…' : 'Close shift'}
                </button>
              </form>
            )}

            {dialog === 'close' && closeResult && (
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <h2 className="text-base font-black text-[#0F172A]">Shift closed</h2>
                </div>
                <dl className="mt-4 space-y-1 rounded-lg bg-[#F8FAFC] p-3 text-xs">
                  <div className="flex justify-between"><dt className="text-[#64748B]">Should have been</dt><dd className="font-semibold">{money(closeResult.expected_cash)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[#64748B]">Counted</dt><dd className="font-semibold">{money(closeResult.counted_cash)}</dd></div>
                  <div className="flex justify-between">
                    <dt className="text-[#64748B]">Difference</dt>
                    <dd className={`font-black ${closeResult.variance_minor === 0 ? 'text-emerald-700' : closeResult.variance_minor < 0 ? 'text-rose-600' : 'text-amber-700'}`}>
                      {closeResult.variance_minor === 0 ? 'None' : closeResult.variance_minor < 0 ? `${money(-closeResult.variance_minor)} short` : `${money(closeResult.variance_minor)} over`}
                    </dd>
                  </div>
                </dl>
                <button type="button" onClick={() => setDialog(null)} className="mt-4 w-full min-h-[44px] rounded-xl bg-[#2E3138] text-sm font-bold text-white">
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
