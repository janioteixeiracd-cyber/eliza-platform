import React, { useState, useEffect } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { Cpu, Zap, Activity, AlertCircle, PieChart, Sparkles, Loader2, RefreshCw } from 'lucide-react';

export default function PlatformAiUsage() {
  const { clinics, getAiUsageRollup } = useAdmin();
  const [rollup, setRollup] = useState<Awaited<ReturnType<typeof getAiUsageRollup>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getAiUsageRollup()
      .then(setRollup)
      .catch((e) => setError(e?.message || 'Falha ao consultar uso de IA.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const successRate = rollup && rollup.totalCalls > 0 ? ((rollup.successCalls / rollup.totalCalls) * 100).toFixed(1) : '—';
  const clinicNameById = Object.fromEntries(clinics.map((c: any) => [c.id, c.name]));
  const byClinicSorted = rollup ? Object.values(rollup.byClinic).sort((a, b) => b.calls - a.calls) : [];

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Consumo de Recursos (IA)</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Contagem real de chamadas registradas em clinics/*/ai_usage_logs</p>
        </div>
        <button onClick={load} disabled={loading} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </button>
      </header>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[10.5px] text-amber-800 font-medium leading-relaxed">
          Cobertura parcial: só as chamadas que passam pelo gateway central de IA (clínica, prontuário, financeiro, Eliza Academy, etc.) são registradas aqui.
          Fluxos de WhatsApp (rascunho/polimento) e dicas de marketing ainda não passam por esse log. Não existe tracking de tokens nem custo em R$ — a contagem é de chamadas reais, não de gasto.
        </p>
      </div>

      {error && <p className="text-xs text-rose-600 font-bold">{error}</p>}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Chamadas Registradas', value: loading ? '...' : (rollup?.totalCalls ?? 0).toLocaleString('pt-BR'), icon: Activity, color: 'teal' },
          { label: 'Taxa de Sucesso Real', value: loading ? '...' : `${successRate}%`, icon: Sparkles, color: 'emerald' },
          { label: 'Chamadas com Falha', value: loading ? '...' : (rollup?.failedCalls ?? 0).toLocaleString('pt-BR'), icon: AlertCircle, color: 'rose' },
          { label: 'Amostra (últimas)', value: loading ? '...' : `${rollup?.sampledCount ?? 0}`, icon: PieChart, color: 'purple' },
        ].map((card, i) => (
          <div key={i} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden">
            <div className={`w-10 h-10 rounded-xl bg-${card.color}-50 flex items-center justify-center text-${card.color}-600 mb-4`}>
              <card.icon className="w-5 h-5" />
            </div>
            <h3 className="text-base font-black text-slate-900 uppercase tracking-tight leading-snug">{card.value}</h3>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-2">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Chamadas por Provedor</h3>
          </div>
          <div className="p-6 space-y-3">
            {rollup && Object.keys(rollup.byProvider).length > 0 ? Object.entries(rollup.byProvider).sort((a, b) => b[1] - a[1]).map(([provider, count]) => (
              <div key={provider} className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 uppercase">{provider}</span>
                <span className="text-xs font-black text-slate-900">{count}</span>
              </div>
            )) : <p className="text-[10px] text-slate-400 font-bold uppercase text-center py-6">{loading ? 'Carregando...' : 'Sem chamadas registradas ainda'}</p>}
          </div>
        </div>
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Chamadas por Modelo</h3>
          </div>
          <div className="p-6 space-y-3">
            {rollup && Object.keys(rollup.byModel).length > 0 ? Object.entries(rollup.byModel).sort((a, b) => b[1] - a[1]).map(([model, count]) => (
              <div key={model} className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 uppercase truncate">{model}</span>
                <span className="text-xs font-black text-slate-900 shrink-0 ml-2">{count}</span>
              </div>
            )) : <p className="text-[10px] text-slate-400 font-bold uppercase text-center py-6">{loading ? 'Carregando...' : 'Sem chamadas registradas ainda'}</p>}
          </div>
        </div>
      </div>

      {/* Clinics AI breakdown */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Uso de IA por Clínica</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Clínica', 'Chamadas Registradas'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byClinicSorted.length > 0 ? byClinicSorted.map((row) => (
                <tr key={row.clinicId} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{clinicNameById[row.clinicId] || row.clinicId}</p>
                    <p className="text-[9px] text-slate-400 font-mono">{row.clinicId}</p>
                  </td>
                  <td className="px-6 py-4 font-mono text-[11px] text-slate-900 font-bold">{row.calls}</td>
                </tr>
              )) : (
                <tr><td colSpan={2} className="px-6 py-10 text-center text-[10px] text-slate-400 font-bold uppercase">{loading ? 'Carregando...' : 'Nenhuma chamada de IA registrada ainda'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
