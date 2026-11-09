import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { NumericKeypad } from '../../components/ui/NumericKeypad';
import { ShoppingBag, KeyRound, Mail, Sparkles, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { homeForRole } from '../../lib/rbac';

export const LoginView: React.FC = () => {
  const navigate = useNavigate();
  const { login, pinLogin, user, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<'pin' | 'email'>('email');

  // Email form
  const [email, setEmail] = useState<string>('cashier@novamart.com');
  const [password, setPassword] = useState<string>('cashier123');

  // PIN form
  // Branches for the PIN tab, from the public list (works before anyone is logged in).
  const [branches, setBranches] = useState<Array<{ id: string; name: string; store_name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [pin, setPin] = useState<string>('');

  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(homeForRole(user.role), { replace: true });
    }
  }, [isAuthenticated, navigate, user]);

  useEffect(() => {
    api
      .get('/auth/branches')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setBranches(data);
          setSelectedBranchId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const signedInUser = await login(email, password);
      navigate(homeForRole(signedInUser.role), { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePinDigit = (d: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + d);
    }
  };

  const handlePinSubmit = async () => {
    if (!pin || !selectedBranchId) return;
    setError('');
    setIsSubmitting(true);
    try {
      const signedInUser = await pinLogin(selectedBranchId, pin);
      navigate(homeForRole(signedInUser.role), { replace: true });
    } catch (err: any) {
      setError(err.message || 'Invalid cashier PIN');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillQuickDemo = (roleEmail: string, rolePass: string) => {
    setEmail(roleEmail);
    setPassword(rolePass);
  };

  return (
    <div className="login-page min-h-screen flex items-center justify-center p-3 sm:p-6 selection:bg-[#E21B70] selection:text-white">
      <div className="login-shell w-full max-w-[1320px] min-h-[min(820px,calc(100dvh-48px))] grid lg:grid-cols-[1.05fr_.95fr] overflow-hidden rounded-[28px] border-[8px] border-white shadow-[0_35px_100px_rgba(1,13,24,.45)] bg-[#F3F0E9]">
        <section className="login-art-panel relative hidden lg:flex flex-col justify-between overflow-hidden p-12 xl:p-14 text-white">
          <div className="relative z-10 flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl border border-white/50 bg-white/10 backdrop-blur-sm flex items-center justify-center">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-black tracking-tight">NovaMart</p>
              <p className="text-[9px] font-bold uppercase tracking-[.28em] text-white/70">Premium Super Shop</p>
            </div>
          </div>
          <div className="relative z-10 max-w-lg pb-2">
            <p className="text-[11px] font-black uppercase tracking-[.28em] text-[#FF8FBD] mb-5">Smart retail. Beautifully simple.</p>
            <h1 className="login-art-title text-[clamp(2.8rem,4.4vw,5rem)] font-black leading-[.98] tracking-[-.055em]">
              Your shelves.<br />Your sales.<br /><span>One place.</span>
            </h1>
            <p className="mt-6 text-sm leading-relaxed text-white/70 max-w-sm">Run products, inventory, counters and customers from one powerful super shop workspace.</p>
          </div>
        </section>

        <section className="login-form-panel min-w-0 flex items-center justify-center p-4 sm:p-8 lg:p-10 xl:p-14 bg-[#F3F0E9]">
      <div className="login-form-card min-w-0 max-w-md w-full bg-[#FFFCF7] border border-[#DDD8CE] rounded-[24px] p-6 sm:p-9 shadow-[0_25px_60px_rgba(26,22,16,.14)] relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-[#0D5C3A]/5 rounded-full blur-3xl pointer-events-none" />

        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-6 lg:items-start lg:text-left">
          <div className="lg:hidden w-14 h-14 rounded-2xl bg-[#E21B70] flex items-center justify-center text-white font-black shadow-lg shadow-[#E21B70]/25 mb-3">
            <ShoppingBag className="w-7 h-7" />
          </div>
          <h1 className="text-[clamp(2rem,10vw,3rem)] font-black text-[#122428] tracking-[-.04em] leading-tight">Welcome back.</h1>
          <p className="text-sm text-[#7B7A74] mt-2">Sign in to continue to NovaMart.</p>
        </div>

        {/* Mode switcher tabs */}
        <div className="login-mode-tabs grid grid-cols-2 gap-1 bg-[#F1F5F9] p-1 rounded-xl mb-6 border border-[#E2E8F0]">
          <button
            onClick={() => setTab('email')}
            className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              tab === 'email' ? 'bg-[#0D5C3A] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0D5C3A]'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Email Access</span>
          </button>
          <button
            onClick={() => setTab('pin')}
            className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              tab === 'pin' ? 'bg-[#0D5C3A] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0D5C3A]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Cashier PIN</span>
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold text-center">
            {error}
          </div>
        )}

        {/* TAB 1: Email Form */}
        {tab === 'email' && (
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label htmlFor="staff-email" className="text-xs font-bold text-[#0F172A] mb-1 block">Staff Email Address</label>
              <input
                id="staff-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cashier@novamart.com"
                className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3.5 py-2.5 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
              />
            </div>

            <div>
              <label htmlFor="staff-password" className="text-xs font-bold text-[#0F172A] mb-1 block">Password</label>
              <input
                id="staff-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3.5 py-2.5 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
            className="w-full py-3.5 rounded-xl bg-[#E21B70] hover:bg-[#C91661] text-white text-sm font-black shadow-lg shadow-[#E21B70]/20 transition-all disabled:opacity-50 mt-2 min-h-[48px]"
            >
              {isSubmitting ? 'Authenticating...' : 'Sign In to Super Shop'}
            </button>
          </form>
        )}

        {/* TAB 2: Cashier PIN Keypad Form */}
        {tab === 'pin' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="checkout-branch" className="text-xs font-bold text-[#0F172A] mb-1 block">Checkout Branch Outlet</label>
              <select
                id="checkout-branch"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {new Set(branches.map((x) => x.store_name)).size > 1 ? `${b.store_name} · ${b.name}` : b.name}
                  </option>
                ))}
              </select>
              {branches.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-700">No branches available. Log in with email instead.</p>
              )}
              <p className="mt-1 text-[11px] text-[#64748B]">PIN login is for cashiers and managers. Other staff log in with email.</p>
            </div>

            {/* PIN Dots indicator */}
            <div className="flex justify-center items-center gap-3 py-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-3.5 h-3.5 rounded-full border transition-all ${
                    pin.length > i
                      ? 'bg-[#0D5C3A] border-[#0D5C3A] scale-110 shadow-sm'
                      : 'border-[#CBD5E1] bg-white'
                  }`}
                />
              ))}
            </div>

            <NumericKeypad
              onDigit={handlePinDigit}
              onBackspace={() => setPin((prev) => prev.slice(0, -1))}
              onClear={() => setPin('')}
              onSubmit={handlePinSubmit}
              submitLabel="LOGIN"
            />
          </div>
        )}

        {/* Quick Demo Logins Section */}
        <div className="mt-6 pt-5 border-t border-[#E2E8F0]">
          <div className="flex items-start gap-1.5 justify-center text-center text-[10px] font-black uppercase tracking-wider text-[#64748B] mb-2.5 leading-relaxed">
            <Sparkles className="w-3.5 h-3.5 text-[#0D5C3A]" />
            <span>One-Click Super Shop Demo Logins:</span>
          </div>

          <div className="login-demo-grid grid grid-cols-3 gap-1.5">
            <button
              onClick={() => fillQuickDemo('cashier@novamart.com', 'cashier123')}
              className="px-2 py-1.5 rounded-lg bg-[#E6F4EA] hover:bg-[#D4EEDC] text-[#0D5C3A] text-[10px] font-extrabold border border-[#C6E6D2] text-center"
            >
              Cashier
            </button>
            <button
              onClick={() => fillQuickDemo('manager@novamart.com', 'manager123')}
              className="px-2 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] text-[10px] font-extrabold border border-[#E2E8F0] text-center"
            >
              Manager
            </button>
            <button
              onClick={() => fillQuickDemo('owner@novamart.com', 'owner123')}
              className="px-2 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] text-[10px] font-extrabold border border-[#E2E8F0] text-center"
            >
              Owner
            </button>
            <button
              onClick={() => fillQuickDemo('inventory@novamart.com', 'inventory123')}
              className="px-2 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] text-[10px] font-extrabold border border-[#E2E8F0] text-center"
            >
              Inventory
            </button>
            <button
              onClick={() => fillQuickDemo('purchase@novamart.com', 'purchase123')}
              className="px-2 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] text-[10px] font-extrabold border border-[#E2E8F0] text-center"
            >
              Purchase
            </button>
            <button
              onClick={() => fillQuickDemo('tenantadmin@novamart.com', 'admin123')}
              className="px-2 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] text-[10px] font-extrabold border border-[#E2E8F0] text-center"
            >
              Admin
            </button>
          </div>
          <p className="text-[10px] text-center text-[#94A3B8] mt-2">
            Cashier PIN: <strong className="text-[#0D5C3A]">2222</strong>
          </p>
        </div>
      </div>
        </section>
      </div>
    </div>
  );
};
export default LoginView;
