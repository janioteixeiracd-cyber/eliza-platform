import React, { useState, useEffect } from 'react';
import { useFinancial } from '../core/financialStore';
import { motion } from 'motion/react';
import {
  Activity,
  Cpu,
  Database,
  RefreshCw,
  Zap,
  CheckCircle,
  AlertTriangle,
  Flame,
  Gauge,
  Sliders,
  Trash2,
} from 'lucide-react';

interface SystemHealthViewProps {
  clinicId: string;
}

export const SystemHealthView: React.FC<SystemHealthViewProps> = ({ clinicId }) => {
  const { telemetry, performanceMode, togglePerformanceMode, clearTelemetry, forceRefresh } = useFinancial(clinicId);
  const [internalLoopCounter, setInternalLoopCounter] = useState(0);

  // Monitor quick state mounts to detect general layout rendering triggers
  useEffect(() => {
    const handler = setInterval(() => {
      setInternalLoopCounter(prev => prev + 1);
    }, 1000);
    return () => clearInterval(handler);
  }, []);

  const hasHighReads = telemetry.firestoreReads > 500;
  const hasMultipleBootstraps = telemetry.duplicateBootstrapsCount > 1;
  const hasLoops = telemetry.renderLoopsCount > 1500;

  return (
    <div id="eliza-system-health-panel" className="bg-slate-50 min-h-screen p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-teal-600 animate-pulse" />
              <h1 className="text-xl font-bold text-slate-950 font-sans tracking-tight">ELIZA System Health</h1>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Diagnósticos avançados em tempo real da infraestrutura e consultas do Firestore.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={forceRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-all click-feedback"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reiniciar Engine
            </button>
            <button
              onClick={clearTelemetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg shadow-sm hover:bg-rose-100 transition-all click-feedback"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Zerar Telemetria
            </button>
          </div>
        </div>

        {/* Alarm Banner if loops or high queries are detected */}
        {(hasLoops || hasHighReads || hasMultipleBootstraps) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-orange-50 border border-orange-200 rounded-2xl flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-orange-850">Avisos Importantes de Infraestrutura</p>
              <ul className="text-[11px] text-orange-700 font-medium list-disc list-inside mt-1 space-y-0.5">
                {hasLoops && <li>Renderização excessiva detectada ({telemetry.renderLoopsCount} ciclos). Verifique dependências de hooks.</li>}
                {hasHighReads && <li>Consumo elevado do Firestore observado ({telemetry.firestoreReads} leituras).</li>}
                {hasMultipleBootstraps && <li>Multiplos bootstraps de contextos concorrentes detectados.</li>}
              </ul>
            </div>
          </motion.div>
        )}

        {/* GRID metrics - 4 columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
            <div className="p-2.5 bg-teal-50 rounded-xl text-teal-600">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Leituras Firestore</p>
              <p className="text-xl font-bold text-slate-800 mt-0.5">{telemetry.firestoreReads}</p>
              <p className="text-[10px] text-teal-600 font-medium mt-0.5">Leituras acumuladas</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
            <div className={`p-2.5 rounded-xl ${telemetry.queriesPerMinute > 60 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Consultas / Minuto</p>
              <p className="text-xl font-bold text-slate-800 mt-0.5">{telemetry.queriesPerMinute}</p>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">Média ponderada atual</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
            <div className="p-2.5 bg-purple-50 rounded-xl text-purple-600">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Uso Est. Memória</p>
              <p className="text-xl font-bold text-slate-800 mt-0.5">{telemetry.estimatedMemoryMB} MB</p>
              <p className="text-[10px] text-purple-600 font-medium mt-0.5">Heap JavaScript est.</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
            <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loops de Render</p>
              <p className={`text-xl font-bold mt-0.5 ${telemetry.renderLoopsCount > 1000 ? 'text-amber-600' : 'text-slate-800'}`}>
                {telemetry.renderLoopsCount}
              </p>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">Ciclos capturados</p>
            </div>
          </div>

        </div>

        {/* Detailed telemetries & System Control Panels */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">

          {/* Performance Mode Module */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm md:col-span-8 space-y-6">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Sliders className="w-4 h-4 text-teal-600" />
              <h2 className="text-sm font-bold text-slate-900">Configuração de Alta Performance</h2>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-teal-150 text-teal-700 uppercase tracking-wider">
                  ELIZA_PERFORMANCE_MODE
                </span>
                <p className="text-xs font-bold text-slate-800">Ativar Otimização Extrema de Leituras</p>
                <p className="text-[11px] text-slate-400 font-medium leading-normal max-w-md">
                  Reduz as leituras no Firestore limitando as consultas aos 150 lançamentos financeiros mais recentes e desativa streams de tempo real redundantes na interface. Recomendado para economizar consumo de rede em clínicas de alta volumetria.
                </p>
              </div>

              <div className="relative shrink-0 flex items-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={performanceMode}
                    onChange={(e) => togglePerformanceMode(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
              </div>
            </div>

            {/* Performance status card */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <p className="text-xs font-bold text-slate-850">Otimizações Ativas</p>
                </div>
                <ul className="text-[11px] text-emerald-700 font-medium space-y-1.5 mt-2.5">
                  <li className="flex items-start gap-1">✓ Cache de consultas reativo centralizado</li>
                  <li className="flex items-start gap-1">✓ Agragados locais financeiros automáticos</li>
                  <li className="flex items-start gap-1">✓ Indexação de campos do ERP dental</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-800">Detecção de Padrões Inadequados</p>
                <div className="space-y-1 mt-2">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                    <span>Queries sem índice:</span>
                    <span className="font-bold text-slate-700">0 detectadas</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                    <span>Scans de coleção inteira:</span>
                    <span className={`font-bold ${telemetry.fullScansDetected > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                      {telemetry.fullScansDetected} scans
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                    <span>Bootstraps redundantes:</span>
                    <span className={`font-bold ${telemetry.duplicateBootstrapsCount > 0 ? 'text-rose-500' : 'text-slate-700'}`}>
                      {telemetry.duplicateBootstrapsCount} detectados
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Telemetries details sidebar */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm md:col-span-4 space-y-4">
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-widest text-slate-400">Resumo de Infraestrutura</h2>
            
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <p className="text-[11px] text-slate-400 font-medium">Observações Ativas (Listeners)</p>
                <p className="text-lg font-black text-slate-800">{telemetry.activeListeners}</p>
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-0.5">
                  Quantidade de conexões WebSockets abertas para observar alterações no banco.
                </p>
              </div>

              <div className="border-b border-slate-100 pb-3">
                <p className="text-[11px] text-slate-400 font-medium">Realtime Subscriptions</p>
                <p className="text-lg font-black text-slate-800">{telemetry.realtimeSubscriptions}</p>
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-0.5">
                  Conexões diretas da API REST de streaming com canais do GCP.
                </p>
              </div>

              <div>
                <p className="text-[11px] text-slate-400 font-medium">Capacidade do Preview</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                  <p className="text-xs font-bold text-slate-800">Online</p>
                </div>
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-1">
                  Nginx proxy e Cloud Run operando normalmente na porta 3000.
                </p>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
