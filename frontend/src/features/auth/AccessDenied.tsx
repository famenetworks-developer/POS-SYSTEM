import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { homeForRole } from '../../lib/rbac';

export const AccessDenied: React.FC = () => {
  const { user } = useAuth();
  return <div className="flex-1 min-h-[70vh] flex items-center justify-center p-6">
    <div className="max-w-md w-full rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center"><ShieldX className="w-7 h-7" /></div>
      <p className="mt-5 text-xs font-black uppercase tracking-widest text-rose-600">403 · Access denied</p>
      <h1 className="mt-2 text-2xl font-black text-slate-900">This area is not assigned to your position</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">You are signed in as <strong>{user?.role.replace('_', ' ')}</strong>. The attempted page requires a permission that is not assigned to this account.</p>
      <Link to={homeForRole(user?.role)} className="mt-6 inline-flex min-h-[44px] items-center rounded-xl bg-[#0D5C3A] px-5 py-2.5 text-sm font-black text-white">Return to my dashboard</Link>
    </div>
  </div>;
};
