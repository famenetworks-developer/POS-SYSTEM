import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getLanguage, setLanguage, t } from '../../lib/i18n';
import { cacheBootstrapData, syncOutbox } from '../../offline/sync';
import { canAccess } from '../../lib/rbac';
import {
  ShoppingBag,
  ShoppingCart,
  Truck,
  LayoutGrid,
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  Globe,
  ChevronDown,
  Menu,
  X,
  Clock,
  User as UserIcon,
  Store,
  Building2,
  MapPin,
  ScanBarcode,
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, restaurant, branches, activeBranch, setActiveBranch, logout } = useAuth();
  const location = useLocation();
  const [lang, setLangState] = useState(getLanguage());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'online' | 'offline' | 'syncing'>(
    navigator.onLine ? 'online' : 'offline'
  );
  const [syncMessage, setSyncMessage] = useState<string>('Connection is healthy');

  useEffect(() => {
    setMobileMenuOpen(false);
    setBranchMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.lang = lang === 'bn' ? 'bn' : 'en';
  }, [lang]);

  useEffect(() => {
    const handleSync = (e: any) => {
      setSyncStatus(e.detail);
    };
    const handleOnline = () => {
      setSyncStatus('online');
      setSyncMessage('Connection restored');
    };
    const handleOffline = () => {
      setSyncStatus('offline');
      setSyncMessage('No internet connection');
    };
    const handleLang = () => setLangState(getLanguage());

    window.addEventListener('sync_status', handleSync);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('languagechange', handleLang);

    return () => {
      window.removeEventListener('sync_status', handleSync);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('languagechange', handleLang);
    };
  }, []);

  const toggleLanguage = () => {
    const next = lang === 'en' ? 'bn' : 'en';
    setLanguage(next);
    setLangState(next);
  };

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      setSyncMessage('Connect to the internet and try again');
      return;
    }
    setSyncStatus('syncing');
    setSyncMessage('Syncing pending changes...');
    try {
      const result = await syncOutbox();
      await cacheBootstrapData(activeBranch?.id);
      setSyncStatus(result.failed > 0 ? 'offline' : 'online');
      setSyncMessage(
        result.failed > 0
          ? `${result.failed} change${result.failed === 1 ? '' : 's'} could not sync`
          : result.synced > 0
          ? `${result.synced} change${result.synced === 1 ? '' : 's'} synced`
          : 'Everything is up to date'
      );
    } catch (error) {
      console.error('[Navbar] Manual sync failed', error);
      setSyncStatus(navigator.onLine ? 'online' : 'offline');
      setSyncMessage('Sync failed. Please try again.');
    }
  };

  const backOfficePath = user?.role === 'inventory_manager'
    ? '/admin/inventory'
    : user?.role === 'purchase_manager'
      ? '/admin/suppliers'
      : user?.role === 'accountant'
        ? '/admin/reports'
        : user?.role === 'admin'
          ? '/admin/administration'
        : user?.role === 'cashier'
          ? '/admin/shifts'
          : '/admin';

  const navItems = [
    { path: '/pos', label: t('pos'), icon: ShoppingCart, roles: ['owner', 'manager', 'cashier'] },
    { path: '/fulfillment', label: t('fulfillment'), icon: Truck, roles: ['owner', 'manager', 'delivery_staff'] },
    { path: '/registers', label: t('registers'), icon: LayoutGrid, roles: ['owner', 'manager'] },
    { path: backOfficePath, label: t('admin'), icon: LayoutDashboard, roles: ['owner', 'admin', 'manager', 'cashier', 'inventory_manager', 'purchase_manager', 'accountant'] },
  ];

  if (user?.role === 'super_admin') {
    navItems.push({ path: '/platform', label: t('platform'), icon: ShieldCheck, roles: ['super_admin'] });
  }

  const roleLabel = (role?: string) => {
    switch (role) {
      case 'owner': return 'Owner';
      case 'manager': return 'Branch Manager';
      case 'cashier': return 'Cashier';
      case 'inventory_manager': return 'Inventory Head';
      case 'purchase_manager': return 'Purchase Officer';
      case 'accountant': return 'Accountant';
      case 'delivery_staff': return 'Delivery Staff';
      case 'super_admin': return 'Super Admin';
      case 'admin': return 'Tenant Admin';
      default: return role || 'Staff';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-[#E3E6E8] text-[#2E3138] shadow-sm select-none">
      <div className="storefront-promo-bar">
        <div className="max-w-[1680px] mx-auto min-h-11 px-2 sm:px-4 py-1 flex items-center justify-center gap-1.5 sm:gap-3">
          <div className="hidden sm:flex w-8 h-8 rounded-lg border border-white/50 items-center justify-center"><ShoppingBag className="w-4 h-4" /></div>
          <Link to="/register?type=partner" className="promo-outline-button" aria-label="Create a supermarket partner account">
            <Store className="w-3.5 h-3.5" /> <span className="sm:hidden">Partner account</span><span className="hidden sm:inline">Sign up to be a supermarket partner</span>
          </Link>
          <Link to="/register?type=business" className="promo-outline-button" aria-label="Create a business account">
            <Building2 className="w-3.5 h-3.5" /> <span className="sm:hidden">Business account</span><span className="hidden sm:inline">Sign up for a business account</span>
          </Link>
        </div>
      </div>
      <div className="max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-8 h-[72px] flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Branch */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link to="/pos" className="flex items-center gap-2.5 font-bold tracking-tight text-[#0F172A] group shrink-0">
            <div className="w-9 h-9 rounded-lg bg-[#E21B70] flex items-center justify-center text-white font-black shadow-md shadow-[#E21B70]/25 group-hover:scale-105 transition-transform">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-lg sm:text-xl font-bold tracking-tight text-[#E21B70] leading-tight">
                NovaMart
              </span>
            </div>
          </Link>

          {/* Desktop Branch Switcher */}
          {branches.length > 0 && (
            <div className="relative hidden sm:block">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={branchMenuOpen}
                onClick={() => setBranchMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#CBD5E1] text-xs font-bold text-[#334155] transition-colors"
              >
                <span className="truncate max-w-[140px]">{activeBranch?.name || 'Select Outlet'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
              </button>
              {branches.length > 1 && branchMenuOpen && (
                <div role="menu" className="absolute top-full left-0 mt-1 w-56 py-1 bg-white border border-[#CBD5E1] rounded-xl shadow-xl z-50">
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setActiveBranch(b);
                        setBranchMenuOpen(false);
                      }}
                      role="menuitem"
                      className={`w-full text-left px-3.5 py-2 text-xs transition-colors flex items-center justify-between ${
                        activeBranch?.id === b.id ? 'bg-[#E6F4EA] text-[#0D5C3A] font-bold' : 'text-[#334155] hover:bg-[#F1F5F9]'
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      {activeBranch?.id === b.id && <span className="w-2 h-2 rounded-full bg-[#0D5C3A] shrink-0"></span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="hidden 2xl:flex items-center gap-4 text-sm text-[#2E3138] font-medium">
            <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" /> New address · Select your address</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> Time · Standard</span>
          </div>
        </div>

        {/* Desktop Navigation Tabs */}
        <nav className="hidden xl:flex items-center gap-1">
          {navItems.filter((item) => !user || item.roles.includes(user.role)).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-[#FFF0F6] text-[#E21B70]'
                    : 'text-[#64748B] hover:text-[#E21B70] hover:bg-[#FFF0F6]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Actions: Shift Indicator, Sync, Language, User, Logout */}
        <div className="flex items-center gap-2 sm:gap-3">
          {canAccess(user?.role, 'scan') && (
            <Link
              to="/scan"
              title="Scan barcode"
              aria-label="Scan barcode"
              className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 sm:px-4 py-2 rounded-lg border text-xs font-bold focus-visible:ring-2 focus-visible:ring-[#E21B70] ${
                location.pathname === '/scan'
                  ? 'border-[#E21B70] bg-[#FFF0F6] text-[#E21B70]'
                  : 'border-[#2E3138] hover:bg-[#F7F7F7]'
              }`}
            >
              <ScanBarcode className="w-4 h-4" />
              <span className="hidden sm:inline">Scan barcode</span>
            </Link>
          )}
          {/* Shift status */}
          <Link
            to="/login"
            className="hidden md:inline-flex items-center justify-center min-h-[40px] px-5 py-2 rounded-lg border border-[#2E3138] text-xs font-bold hover:bg-[#F7F7F7] focus-visible:ring-2 focus-visible:ring-[#E21B70]"
          >
            Log in
          </Link>
          <Link
            to="/pos?delivery=signup"
            className="hidden xl:inline-flex items-center justify-center min-h-[40px] px-5 py-2 rounded-lg bg-[#E21B70] hover:bg-[#C91661] text-white text-xs font-bold focus-visible:ring-2 focus-visible:ring-[#E21B70] focus-visible:ring-offset-2"
          >
            Sign up for free delivery
          </Link>

          {/* Sync status */}
          <button
            data-navbar-sync
            type="button"
            onClick={handleManualSync}
            title={`${syncMessage}. Click to sync now.`}
            aria-label={`${syncStatus}. ${syncMessage}. Sync now`}
            aria-live="polite"
            disabled={syncStatus === 'syncing'}
            className={`flex items-center gap-1 sm:gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1 rounded-full text-[10px] sm:text-[11px] font-bold border shrink-0 ${
              syncStatus === 'online'
                ? 'bg-[#E6F4EA] text-[#0D5C3A] border-[#B7E1CD]'
                : syncStatus === 'syncing'
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-rose-100 text-rose-800 border-rose-300'
            } disabled:cursor-wait focus-visible:ring-2 focus-visible:ring-[#E21B70] focus-visible:ring-offset-2`}
          >
            {syncStatus === 'online' ? (
              <>
                <Wifi className="w-3 h-3 text-[#0D5C3A]" />
                <span className="hidden sm:inline">Online</span>
              </>
            ) : syncStatus === 'syncing' ? (
              <>
                <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                <span className="hidden sm:inline">Syncing</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-rose-600" />
                <span className="hidden sm:inline">Offline</span>
              </>
            )}
          </button>

          {/* Language Toggle */}
          <button
            data-navbar-language
            type="button"
            onClick={toggleLanguage}
            title="Toggle English / বাংলা"
            aria-label={`Switch language to ${lang === 'en' ? 'Bangla' : 'English'}`}
            className="flex items-center gap-1 min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#CBD5E1] text-xs font-bold text-[#334155] transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-[#0D5C3A]" />
            <span>{lang === 'en' ? 'বাংলা' : 'EN'}</span>
          </button>

          {/* User profile info */}
          <div className="hidden">
            <div className="w-8 h-8 rounded-full bg-[#E6F4EA] border border-[#B7E1CD] flex items-center justify-center text-[#0D5C3A] font-bold text-xs">
              {user?.name ? user.name.charAt(0).toUpperCase() : <UserIcon className="w-4 h-4" />}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-[#0F172A] truncate max-w-[120px] leading-tight">
                {user?.name || 'Cashier'}
              </span>
              <span className="text-[10px] text-[#0D5C3A] font-semibold">
                {roleLabel(user?.role)}
              </span>
            </div>
          </div>

          {/* Logout Button */}
          <button
            data-navbar-logout
            type="button"
            onClick={logout}
            title={t('logout')}
            aria-label={t('logout')}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"
          >
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Mobile hamburger menu toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            className="md:hidden w-11 h-11 flex items-center justify-center rounded-xl text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#E2E8F0] bg-white px-4 py-3 space-y-2">
          {branches.length > 0 && (
            <label className="block text-xs font-bold text-[#475569]">
              <span className="block mb-1.5">Active outlet</span>
              <select
                value={activeBranch?.id || ''}
                onChange={(event) => {
                  const branch = branches.find((item) => item.id === event.target.value);
                  if (branch) setActiveBranch(branch);
                }}
                className="w-full min-h-[44px] rounded-xl border border-[#CBD5E1] bg-white px-3 text-base text-[#334155]"
              >
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
          )}
          {navItems.filter((item) => !user || item.roles.includes(user.role)).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  isActive ? 'bg-[#0D5C3A] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#F1F5F9]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={handleManualSync}
              disabled={syncStatus === 'syncing'}
              className="min-h-[44px] rounded-xl border border-[#CBD5E1] flex items-center justify-center gap-2 text-xs font-bold text-[#334155] disabled:opacity-60"
            >
              {syncStatus === 'syncing' ? <RefreshCw className="w-4 h-4 animate-spin" /> : syncStatus === 'offline' ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
              {syncStatus === 'syncing' ? 'Syncing' : syncStatus === 'offline' ? 'Offline' : 'Online'}
            </button>
            <button
              type="button"
              onClick={toggleLanguage}
              className="min-h-[44px] rounded-xl border border-[#CBD5E1] flex items-center justify-center gap-2 text-xs font-bold text-[#334155]"
            >
              <Globe className="w-4 h-4" /> {lang === 'en' ? 'বাংলা' : 'English'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
