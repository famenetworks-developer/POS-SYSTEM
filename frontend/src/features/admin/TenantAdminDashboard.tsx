import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Monitor, RefreshCw, Settings, ShieldCheck, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { User } from '../../types';

export const TenantAdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [registers, setRegisters] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [userData, registerData, auditData, settingsData] = await Promise.all([
        api.get('/users'), api.get('/tables'), api.get('/audit-logs'), api.get('/settings'),
      ]);
      setUsers(Array.isArray(userData) ? userData : []);
      setRegisters(Array.isArray(registerData) ? registerData : []);
      setAudits(Array.isArray(auditData) ? auditData.slice(0, 8) : []);
      setSettings(settingsData || {});
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  const byRole = useMemo(() => users.reduce<Record<string, number>>((a, u) => ({ ...a, [u.role]: (a[u.role] || 0) + 1 }), {}), [users]);
  const active = users.filter((u) => u.is_active).length;
  const cards = [
    { label: 'Active users', value: `${active}/${users.length}`, icon: Users },
    { label: 'Roles configured', value: Object.keys(byRole).length, icon: ShieldCheck },
    { label: 'Registers online', value: registers.filter((r) => r.status !== 'offline').length, icon: Monitor },
    { label: 'Settings groups', value: Object.keys(settings).length, icon: Settings },
  ];

  if (loading) return <div className="h-64 flex items-center justify-center"><RefreshCw className="animate-spin text-[#0D5C3A]" /></div>;
  return <div className="space-y-6 max-w-7xl mx-auto">
    <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 p-6 text-white flex justify-between gap-4">
      <div><p className="text-xs font-black uppercase tracking-widest text-emerald-300">Tenant administration</p><h1 className="text-2xl font-black mt-1">System & Security Overview</h1><p className="text-sm text-slate-300 mt-1">Users, registers, configuration, synchronization and audit activity</p></div>
      <button onClick={load} className="self-start p-2 rounded-xl bg-white/10" aria-label="Refresh administration dashboard"><RefreshCw className="w-4 h-4" /></button>
    </div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{cards.map(({label,value,icon:Icon}) => <div key={label} className="bg-white border border-slate-200 rounded-2xl p-5"><Icon className="w-5 h-5 text-[#0D5C3A]" /><p className="text-2xl font-black mt-3">{value}</p><p className="text-xs font-bold text-slate-500 mt-1">{label}</p></div>)}</div>
    <div className="grid lg:grid-cols-2 gap-5">
      <section className="bg-white border border-slate-200 rounded-2xl p-5"><h2 className="font-black flex items-center gap-2"><Users className="w-4 h-4" />Users by role</h2><div className="mt-4 space-y-2">{Object.entries(byRole).map(([role,count]) => <div key={role} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-bold capitalize">{role.replace('_',' ')}</span><span>{count}</span></div>)}</div></section>
      <section className="bg-white border border-slate-200 rounded-2xl p-5"><h2 className="font-black flex items-center gap-2"><Activity className="w-4 h-4" />Recent administrative activity</h2><div className="mt-4 space-y-2">{audits.length ? audits.map((a) => <div key={a.id} className="rounded-xl border border-slate-100 px-3 py-2 text-xs"><p className="font-bold">{a.action}</p><p className="text-slate-500">{a.entity} · {new Date(a.created_at).toLocaleString()}</p></div>) : <p className="text-sm text-slate-500 flex gap-2"><AlertTriangle className="w-4 h-4" />No recent audit events.</p>}</div></section>
    </div>
  </div>;
};
