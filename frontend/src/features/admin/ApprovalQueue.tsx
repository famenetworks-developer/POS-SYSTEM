import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { useAuth } from '../../context/AuthContext';

export const ApprovalQueue: React.FC = () => {
  const { restaurant } = useAuth();
  const [items,setItems]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState('');
  const load=async()=>{setLoading(true);try{setItems(await api.get('/approvals?status=pending')||[])}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  const decide=async(id:string,decision:'approved'|'rejected')=>{setBusy(id);try{await api.post(`/approvals/${id}/decision`,{decision,note:decision==='approved'?'Approved after operational review':'Rejected after operational review'});await load()}catch(e:any){alert(e.message)}finally{setBusy('')}};
  return <div className="space-y-5 max-w-6xl mx-auto"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-widest font-black text-amber-600">Controlled actions</p><h1 className="text-2xl font-black">Approval Queue</h1><p className="text-xs text-slate-500">Refunds, discounts, voids, purchases and sensitive stock changes</p></div><button onClick={load} className="p-2 rounded-xl border bg-white" aria-label="Refresh approvals"><RefreshCw className="w-4 h-4" /></button></div>
  {loading?<div className="h-48 flex items-center justify-center"><RefreshCw className="animate-spin" /></div>:items.length===0?<div className="bg-white rounded-2xl border p-10 text-center text-slate-500"><CheckCircle2 className="mx-auto w-8 h-8 text-emerald-600 mb-3" />No pending approvals</div>:<div className="space-y-3">{items.map(a=><article key={a.id} className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"><div><div className="flex items-center gap-2"><Clock3 className="w-4 h-4 text-amber-500"/><span className="font-black capitalize">{a.type.replace('_',' ')}</span><span className="text-[10px] font-bold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">Pending</span></div><p className="text-sm mt-2">{a.reason}</p><p className="text-xs text-slate-500 mt-1">{a.amount_minor>0?formatMoney(a.amount_minor,restaurant?.currency):'No monetary amount'} · {new Date(a.requested_at).toLocaleString()}</p></div><div className="flex gap-2"><button disabled={busy===a.id} onClick={()=>decide(a.id,'rejected')} className="min-h-[42px] px-4 rounded-xl border border-rose-200 text-rose-700 text-xs font-black flex items-center gap-1"><XCircle className="w-4 h-4"/>Reject</button><button disabled={busy===a.id} onClick={()=>decide(a.id,'approved')} className="min-h-[42px] px-4 rounded-xl bg-[#0D5C3A] text-white text-xs font-black flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/>Approve</button></div></article>)}</div>}</div>;
};
