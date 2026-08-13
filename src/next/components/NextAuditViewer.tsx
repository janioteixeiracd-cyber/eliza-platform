import React from 'react';
import { motion } from 'motion/react';
import { 
  Terminal, 
  Trash2, 
  ShieldAlert, 
  CheckCircle, 
  Database,
  Lock,
  Clock
} from 'lucide-react';
import { useNextReadOnly } from '../context/NextReadOnlyContext';

export default function NextAuditViewer() {
  const { auditLogs, clearAuditLogs } = useNextReadOnly();

  return (
    <div className="space-y-6 max-w-6xl font-sans">
      
      {/* Title & Description */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400 animate-pulse" />
            <span>Audit Trail (Logs de Segurança em Tempo Real)</span>
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Registro das leituras/consultas feitas via a camada auditada (`next-db`). Gravações usam o
            SDK do Firestore direto e não passam por aqui — não é um log de toda e qualquer operação.
          </p>
        </div>

        {auditLogs.length > 0 && (
          <button
            onClick={clearAuditLogs}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold rounded-xl transition-all"
            style={{ minHeight: '44px' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpar Console</span>
          </button>
        )}
      </div>

      {/* Terminal View Container */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col min-h-[450px]">
        
        {/* Terminal Header */}
        <div className="bg-slate-900 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-xs text-slate-500 font-mono pl-2">next-sandbox-telemetry@elisa: ~</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              AUDIT_ENGINE_LIVE
            </span>
          </div>
        </div>

        {/* Terminal Console Output */}
        <div className="flex-1 p-5 font-mono text-xs overflow-y-auto space-y-3 max-h-[500px]">
          
          {/* Header Command */}
          <div className="text-slate-500">
            $ cat /var/log/eliza-next/security-audit.log
          </div>

          {auditLogs.length === 0 ? (
            <div className="text-slate-500 italic py-8 text-center">
              Nenhuma transação registrada no log de auditoria ainda.
            </div>
          ) : (
            auditLogs.map((log) => {
              const isBlocked = log.action === 'WRITE_BLOCKED' || log.status === 'BLOCKED';
              
              return (
                <motion.div 
                  key={log.id}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`p-3 rounded-xl border ${
                    isBlocked 
                      ? 'bg-amber-950/10 border-amber-500/20 text-amber-300' 
                      : 'bg-slate-900/45 border-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-2.5">
                      {isBlocked ? (
                        <Lock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                            isBlocked ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {log.action}
                          </span>
                          <span className="text-slate-400 text-[11px] font-bold">Coleção: {log.collection}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{log.details}</p>
                        {log.parameters && (
                          <pre className="text-[10px] text-slate-500 bg-slate-950 p-2 rounded-lg border border-slate-900 mt-2 overflow-x-auto">
                            {JSON.stringify(log.parameters, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5 justify-end">
                        <Clock className="w-3 h-3" />
                        <span>{log.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <span className={`text-[10px] font-bold mt-1 inline-block ${
                        isBlocked ? 'text-amber-500' : 'text-emerald-500'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
