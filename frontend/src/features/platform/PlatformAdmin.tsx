import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { ShieldCheck, UserCheck, Clock, ExternalLink, RefreshCw } from 'lucide-react';

export const PlatformAdmin: React.FC = () => {
  const { impersonate } = useAuth();
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const restList = await api.get('/admin/restaurants');
      const planList = await api.get('/admin/plans');
      setTenants(restList || []);
      setPlans(planList || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleExtendTrial = async (tenantId: string) => {
    try {
      await api.patch(`/admin/restaurants/${tenantId}/status`, {
        status: 'active',
        extend_days: 14,
      });
      alert('Tenant trial extended by 14 days!');
      loadData();
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleImpersonate = async (tenantId: string) => {
    if (!window.confirm('Are you sure you want to impersonate this tenant? This action is strictly audited.')) {
      return;
    }
    try {
      await impersonate(tenantId);
      window.location.href = '/pos';
    } catch (e: any) {
      alert('Impersonation failed: ' + e.message);
    }
  };

  return (
    <div className="w-full min-w-0 p-3.5 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0A3420] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#0A3420]" />
            <span>Platform SaaS Administration</span>
          </h1>
          <p className="text-xs text-[#5E7568] mt-0.5">
            Super administrator console for multi-tenant subscriptions, trials, and audited impersonation
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-[#F0F4EC] text-xs font-bold text-[#0A3420] border border-[#DCE4D6] shadow-sm min-h-[38px] self-start sm:self-auto shrink-0 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Tenants Table */}
      <div className="w-full min-w-0 bg-white border border-[#E3E8DE] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-[#FAFBF9] text-[#5E7568] font-bold border-b border-[#E3E8DE]">
            <tr>
              <th className="py-3.5 px-4">Super Shop Tenant</th>
              <th className="py-3.5 px-4">Contact Email</th>
              <th className="py-3.5 px-4">Plan</th>
              <th className="py-3.5 px-4">Trial / Expiry</th>
              <th className="py-3.5 px-4">Tenant Status</th>
              <th className="py-3.5 px-4 text-right">Super Admin Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAEFE6] text-[#123122]">
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-[#F7F8F5] transition-colors">
                <td className="py-3.5 px-4 font-bold text-[#0A3420]">
                  {t.name}
                  <span className="text-[10px] text-[#7A9283] font-mono block">{t.slug}</span>
                </td>
                <td className="py-3.5 px-4 text-[#5E7568]">{t.email}</td>
                <td className="py-3.5 px-4 font-extrabold text-[#0A3420]">{t.plan_name}</td>
                <td className="py-3.5 px-4 text-[#5E7568]">
                  {t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString() : 'Lifetime'}
                </td>
                <td className="py-3.5 px-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    t.status === 'active'
                      ? 'bg-[#EAF3ED] text-[#0A3420] border border-[#C5DDD0]'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}>
                    {t.status}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      onClick={() => handleExtendTrial(t.id)}
                      className="px-2.5 py-1 rounded-lg bg-[#F0F4EC] hover:bg-[#E3E8DE] text-[#0A3420] border border-[#DCE4D6] font-bold text-[11px] transition-colors"
                    >
                      +14 Days Trial
                    </button>
                    <button
                      onClick={() => handleImpersonate(t.id)}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-[#0A3420] hover:bg-[#0E442A] text-white font-bold text-[11px] transition-colors shadow-xs"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Impersonate</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
};
