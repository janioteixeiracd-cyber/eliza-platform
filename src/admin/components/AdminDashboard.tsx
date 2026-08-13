import React, { useState, useEffect } from 'react';
import {
  Building2,
  Users,
  CreditCard,
  Cpu,
  TrendingUp,
  Zap,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ServerCog
} from 'lucide-react';
import { useAdmin } from '../../contexts/AdminContext';

export default function AdminDashboard() {
  const { clinics, users, plans, isLoading, checkSystemHealth } = useAdmin();

  const [health, setHealth] = useState<{ ok: boolean; uptimeSeconds?: number; latencyMs?: number; firestoreReachable?: boolean } | { ok: false; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    checkSystemHealth().then((result) => { if (!cancelled) setHealth(result); });
    return () => { cancelled = true; };
  }, []);

  if (isLoading && clinics.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center py-40">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  // Real KPIs, computed directly from the already-loaded clinics/users/plans
  // (platform_metrics is never written by anything, so it always reads as
  // zero — deriving from real collections instead of depending on that dead
  // job).
  const activeClinics = clinics.filter((c: any) => c.status === 'active' || c.status === 'ativo').length;
  const activeUsers = users.length;
  const planById = Object.fromEntries(plans.map((p: any) => [p.id, p]));
  const mrr = clinics.reduce((sum: number, c: any) => {
    const plan = planById[c.planId || c.plan];
    return sum + (plan?.price || 0);
  }, 0);

  // Real "needs attention" signals from data already in memory — no
  // fabricated numbers, no extra reads.
  const blockedClinics = clinics.filter((c: any) => c.status === 'blocked' || c.status === 'suspended');
  const whatsappDisconnected = clinics.filter((c: any) => c.whatsappStatus && c.whatsappStatus !== 'connected');
  const alertCount = blockedClinics.length + whatsappDisconnected.length;

  return (
    <div className="p-8 space-y-8">
      <header>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">ELIZA Master Dashboard</h2>
        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Visão Global da Plataforma SaaS</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Clínicas', value: clinics.length, sub: `${activeClinics} ativas`, icon: Building2, color: 'teal' },
          { label: 'Usuários na Plataforma', value: activeUsers, sub: 'contas em users/', icon: Users, color: 'blue' },
          { label: 'MRR (planos atribuídos)', value: `R$ ${mrr.toLocaleString('pt-BR')}`, sub: `${plans.filter((p: any) => p.active !== false).length} planos ativos`, icon: CreditCard, color: 'emerald' },
          { label: 'Uso de IA', value: 'Ver aba', sub: 'Uso de IA — dados reais', icon: Cpu, color: 'purple' }
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group">
            <div className={`absolute top-0 right-0 w-24 h-24 bg-${stat.color}-500/5 -mr-8 -mt-8 rounded-full blur-2xl transition-all group-hover:scale-150`}></div>
            <div className="relative flex justify-between items-start mb-4">
               <div className={`w-10 h-10 rounded-xl bg-${stat.color}-50 flex items-center justify-center text-${stat.color}-600`}>
                  <stat.icon className="w-5 h-5" />
               </div>
               <span className="text-[10px] font-black text-slate-400 bg-slate-50 px-2 py-1 rounded-lg uppercase tracking-tight">
                  {stat.sub}
               </span>
            </div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">{stat.value}</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Saúde da Infraestrutura</h3>
              <p className="text-[10px] text-slate-400 font-bold mt-1">Sinais reais — backend próprio e Firestore, sem monitoramento externo</p>
            </div>
            <ServerCog className={`w-5 h-5 ${health?.ok ? 'text-emerald-500' : health === null ? 'text-slate-300' : 'text-rose-500'}`} />
          </div>
          <div className="p-8 space-y-4">
            {health === null ? (
              <div className="flex items-center gap-3 text-slate-400 text-[11px] font-bold uppercase tracking-widest">
                <Loader2 className="w-4 h-4 animate-spin" /> Consultando /api/health...
              </div>
            ) : (
              [
                { label: 'Backend Express (uptime do processo)', ok: health.ok, detail: 'uptimeSeconds' in health && health.uptimeSeconds != null ? `${Math.floor(health.uptimeSeconds / 60)} min ativo` : 'indisponível' },
                { label: 'Conectividade Firestore (Admin SDK)', ok: 'firestoreReachable' in health ? !!health.firestoreReachable : false, detail: 'firestoreReachable' in health && health.firestoreReachable ? 'leitura respondeu' : 'sem resposta' },
                { label: 'Latência da checagem', ok: health.ok, detail: 'latencyMs' in health && health.latencyMs != null ? `${health.latencyMs}ms` : '—' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">{item.label}</span>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${item.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{item.detail}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${item.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: item.ok ? '100%' : '15%' }}></div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-slate-900 rounded-[2.5rem] text-white p-8 flex flex-col justify-between">
          <header>
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
               {alertCount > 0 ? <AlertCircle className="w-6 h-6 text-rose-400" /> : <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
            </div>
            <h3 className="text-lg font-black tracking-tight mb-2 uppercase">Centro de Alertas</h3>
            {alertCount === 0 ? (
              <p className="text-[10px] text-slate-400 font-medium leading-relaxed">Nenhum alerta no momento. Nenhuma clínica bloqueada/suspensa e nenhuma integração de WhatsApp desconectada.</p>
            ) : (
              <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                {blockedClinics.length > 0 && `${blockedClinics.length} clínica(s) bloqueada(s)/suspensa(s)`}
                {blockedClinics.length > 0 && whatsappDisconnected.length > 0 && ' e '}
                {whatsappDisconnected.length > 0 && `${whatsappDisconnected.length} com WhatsApp desconectado`}.
              </p>
            )}
          </header>
          {alertCount > 0 && (
            <div className="mt-8 space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
              {[...blockedClinics, ...whatsappDisconnected].slice(0, 6).map((c: any) => (
                <div key={c.id} className="text-[10px] text-slate-300 font-bold uppercase truncate bg-white/5 rounded-lg px-3 py-2">{c.name}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
