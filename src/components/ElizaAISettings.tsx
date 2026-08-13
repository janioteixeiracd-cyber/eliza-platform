import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Loader2, 
  CheckCircle,
  AlertTriangle,
  Settings,
  Cpu,
  History,
  TrendingUp,
  BrainCircuit
} from 'lucide-react';
import { doc, getDoc, setDoc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { motion } from 'motion/react';

interface ElizaAISettingsProps {
  clinic: {
    id: string;
    [key: string]: any;
  };
}

export default function ElizaAISettings({ clinic }: ElizaAISettingsProps) {
  const [config, setConfig] = useState({
    aiProviderPrincipal: 'openai',
    aiProviderFallback: 'gemini',
    aiModelClinical: 'gpt-4o',
    aiModelAdministrative: 'gpt-4o-mini',
    aiModelFast: 'gpt-4o-mini',
    aiDailyLimit: 100,
    aiEnableCostLogs: true
  });

  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load clinic config and real-time logs
  useEffect(() => {
    if (!clinic?.id) return;

    // 1. Get current clinic configurations
    const loadClinicConfig = async () => {
      try {
        const docRef = doc(db, 'clinics', clinic.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setConfig({
            aiProviderPrincipal: data.aiProviderPrincipal || 'openai',
            aiProviderFallback: data.aiProviderFallback || 'gemini',
            aiModelClinical: data.aiModelClinical || 'gpt-4o',
            aiModelAdministrative: data.aiModelAdministrative || 'gpt-4o-mini',
            aiModelFast: data.aiModelFast || 'gpt-4o-mini',
            aiDailyLimit: typeof data.aiDailyLimit === 'number' ? data.aiDailyLimit : 100,
            aiEnableCostLogs: data.aiEnableCostLogs !== false
          });
        }
      } catch (err: any) {
        console.error("Failed to load clinic AI config:", err);
        setErrorMsg("Não foi possível carregar as configurações de IA.");
      } finally {
        setLoading(false);
      }
    };

    loadClinicConfig();

    // 2. Stream recent AI usage logs
    const logsQuery = query(
      collection(db, 'clinics', clinic.id, 'ai_usage_logs'),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribeLogs = onSnapshot(logsQuery, (snap) => {
      const logsData = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate() || new Date()
      }));
      setLogs(logsData);
    }, (err) => {
      console.warn("Could not load AI usage logs:", err);
    });

    return () => {
      unsubscribeLogs();
    };
  }, [clinic?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    setErrorMsg(null);

    try {
      const docRef = doc(db, 'clinics', clinic.id);
      await setDoc(docRef, {
        aiProviderPrincipal: config.aiProviderPrincipal,
        aiProviderFallback: config.aiProviderFallback,
        aiModelClinical: config.aiModelClinical,
        aiModelAdministrative: config.aiModelAdministrative,
        aiModelFast: config.aiModelFast,
        aiDailyLimit: Number(config.aiDailyLimit) || 100,
        aiEnableCostLogs: config.aiEnableCostLogs
      }, { merge: true });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Save config failing:", err);
      setErrorMsg("Erro ao salvar configurações no banco de dados.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Carregando IA ELIZA...</p>
      </div>
    );
  }

  // Calculate some stats from logs
  const totalCalls = logs.length;
  const successCalls = logs.filter(l => l.success).length;
  const failedCalls = totalCalls - successCalls;
  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 100;

  return (
    <div className="space-y-8 text-left">
      <header className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-teal-600" />
            IA ELIZA - Gateway & Configurações
          </h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 italic">
            Gerencie o provedor principal, fallbacks de redundância, modelos de linguagem e logs de custo
          </p>
        </div>
        <Cpu className="w-6 h-6 text-slate-200" />
      </header>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <span className="text-xs font-semibold">{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* CONFIG FORM */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSave} className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
            <h4 className="text-xs font-black text-teal-700 uppercase tracking-widest flex items-center gap-2 border-b border-slate-100 pb-3">
              <Settings className="w-4 h-4" /> Diretrizes de Roteamento de IA
            </h4>

            {/* Providers Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Provedor Principal</label>
                <select
                  value={config.aiProviderPrincipal}
                  onChange={(e) => setConfig({ ...config, aiProviderPrincipal: e.target.value })}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:bg-white outline-none font-bold"
                >
                  <option value="openai">OpenAI (Recomendado / Estável)</option>
                  <option value="gemini">Gemini (Incluso)</option>
                </select>
                <p className="text-[9px] text-slate-400 font-medium">Determina a IA que receberá as chamadas por padrão.</p>
              </div>

              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Provedor Fallback</label>
                <select
                  value={config.aiProviderFallback}
                  onChange={(e) => setConfig({ ...config, aiProviderFallback: e.target.value })}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:bg-white outline-none font-bold"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini (Recomendado como Backup)</option>
                  <option value="none">Nenhum (Retornar erro se falhar)</option>
                </select>
                <p className="text-[9px] text-slate-400 font-medium">Acionado automaticamente em caso de indisponibilidade do principal.</p>
              </div>
            </div>

            {/* Dynamic Tasks models mapping */}
            <div className="space-y-4">
              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-dashed border-slate-150 pb-1.5">
                Mapeamento de Modelos por Tarefa
              </h5>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Clinical Tasks model */}
                <div className="space-y-1 text-left">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Modelo Clínico (Crítico)</label>
                  <select
                    value={config.aiModelClinical}
                    onChange={(e) => setConfig({ ...config, aiModelClinical: e.target.value })}
                    className="w-full px-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:bg-white outline-none font-semibold"
                  >
                    <option value="gpt-4o">gpt-4o (Altíssima Precisão)</option>
                    <option value="gpt-4-turbo">gpt-4-turbo (Clássico)</option>
                    <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                    <option value="gpt-4o-mini">gpt-4o-mini (Econômico)</option>
                  </select>
                  <p className="text-[9px] text-slate-400 font-medium">Anamnese, dossiê, planejamento facial, risco e receitas interativas.</p>
                </div>

                {/* Administrative Tasks model */}
                <div className="space-y-1 text-left">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Modelo Administrativo</label>
                  <select
                    value={config.aiModelAdministrative}
                    onChange={(e) => setConfig({ ...config, aiModelAdministrative: e.target.value })}
                    className="w-full px-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:bg-white outline-none font-semibold"
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (Super Rápido e Barato)</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                  </select>
                  <p className="text-[9px] text-slate-400 font-medium">Resumos de caixa, CRM, marketing, contratos e disparo de WhatsApp.</p>
                </div>

                {/* Fast general Tasks model */}
                <div className="space-y-1 text-left">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Modelo Rápido / Geral</label>
                  <select
                    value={config.aiModelFast}
                    onChange={(e) => setConfig({ ...config, aiModelFast: e.target.value })}
                    className="w-full px-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:bg-white outline-none font-semibold"
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (Econômico)</option>
                    <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                    <option value="gpt-4o">gpt-4o</option>
                  </select>
                  <p className="text-[9px] text-slate-400 font-medium">Categorização rápida e triagem inicial.</p>
                </div>

                {/* Daily limit constraint */}
                <div className="space-y-1 text-left">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Limite Diário Estimado (Chamadas)</label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={config.aiDailyLimit}
                    onChange={(e) => setConfig({ ...config, aiDailyLimit: parseInt(e.target.value) || 100 })}
                    className="w-full px-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:bg-white outline-none font-semibold"
                  />
                  <p className="text-[9px] text-slate-400 font-medium">Mecanismo preventivo para evitar loops infindáveis de requisições.</p>
                </div>
              </div>
            </div>

            {/* Logging and control Options */}
            <div className="space-y-3 pt-2">
              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-dashed border-slate-150 pb-1.5">
                Controle de Log & Segurança
              </h5>
              
              <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-150">
                <input
                  id="enable_cost_logs"
                  type="checkbox"
                  checked={config.aiEnableCostLogs}
                  onChange={(e) => setConfig({ ...config, aiEnableCostLogs: e.target.checked })}
                  className="w-4 h-4 text-teal-600 focus:ring-teal-500 border-slate-300 rounded cursor-pointer"
                />
                <div className="text-left">
                  <label htmlFor="enable_cost_logs" className="text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer">
                    Salvar histórico de requisições e custos
                  </label>
                  <p className="text-[9px] text-slate-400 font-medium leading-relaxed mt-0.5">
                    Permite gerar as métricas de acompanhamento de chamadas e auditoria clínica armazenando um rastro sob <code>clinics/{clinic.id}/ai_usage_logs</code>.
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              {saveSuccess && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-600 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-teal-500" />
                  Salvo com Sucesso! Gateway Atualizado.
                </span>
              )}
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold uppercase tracking-widest rounded-2xl transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <span>Salvar Configuração</span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* SIDE BAR / STATS & LOGS SUMMARY */}
        <div className="space-y-6">
          {/* Quick Metrics */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-[2rem] border border-slate-800 shadow-sm space-y-4">
            <h4 className="text-[10px] font-black text-teal-400 uppercase tracking-widest flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" /> Desempenho do Gateway
            </h4>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="bg-white/5 p-3 rounded-xl">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Chamadas Recentes</span>
                <span className="text-2xl font-black">{totalCalls}</span>
              </div>
              <div className="bg-white/5 p-3 rounded-xl">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Taxa de Sucesso</span>
                <span className="text-2xl font-black text-teal-400">{successRate}%</span>
              </div>
            </div>

            {failedCalls > 0 && (
              <div className="text-[9px] font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1 p-2 bg-rose-500/10 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Deteções de redundância: {failedCalls}
              </div>
            )}
          </div>

          {/* Historical Logs List */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm space-y-4">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <History className="w-4 h-4 text-teal-600" />
              Auditoria de Requisições
            </h4>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar">
              {logs.length === 0 ? (
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider py-8 text-center italic">Nenhuma chamada registrada recentemente.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1.5 text-xs text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-600">
                        {log.taskType?.replace('_', ' ') || 'unknown'}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-wide ${
                        log.success ? 'bg-teal-50 text-teal-700 border border-teal-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                      }`}>
                        {log.success ? 'OK' : 'Falha'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold">
                      <span>Provedor: <strong className="text-slate-600 uppercase">{log.provider}</strong> ({log.model})</span>
                      <span>{log.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {log.errorCode && (
                      <div className="p-1.5 bg-rose-500/5 text-rose-600 font-mono text-[8.5px] rounded-sm truncate" title={log.errorCode}>
                        Erro: {log.errorCode}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
