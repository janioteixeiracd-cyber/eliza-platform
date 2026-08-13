import React, { useState } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { Database, Filter, Search, Terminal, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

export default function PlatformLogs() {
  const { auditLogs, clinics, isLoading } = useAdmin();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClinic, setSelectedClinic] = useState('');

  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = log.action?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          log.adminId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          log.targetId?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesClinic = !selectedClinic || log.targetId === selectedClinic || log.details?.clinicId === selectedClinic;
    return matchesSearch && matchesClinic;
  });

  const getClinicName = (clinicId: string) => {
    if (!clinicId) return '';
    const c = clinics.find(cl => cl.id === clinicId);
    return c ? c.name : clinicId;
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'NOW';
    if (ts.toDate) return ts.toDate().toLocaleString();
    if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleString();
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Logs de Auditoria</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Histórico imutável de ações administrativas e auditoria geral</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <select 
            value={selectedClinic}
            onChange={(e) => setSelectedClinic(e.target.value)}
            className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all cursor-pointer"
          >
            <option value="">TODAS AS CLÍNICAS</option>
            {clinics.map(c => (
              <option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>
            ))}
          </select>
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="FILTRAR LOGS OU UID..."
              className="pl-11 pr-6 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all w-full"
            />
          </div>
        </div>
      </header>

      {/* Terminal Visual logs */}
      <div className="bg-slate-900 rounded-[2.5rem] border border-slate-800 shadow-2xl overflow-hidden flex flex-col min-h-[500px]">
        <div className="bg-slate-950 px-8 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/80"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500/80"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500/80"></span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono font-bold tracking-widest uppercase">Platform Core Terminal</span>
          </div>
          <Terminal className="w-4 h-4 text-slate-600" />
        </div>

        <div className="flex-1 p-8 font-mono text-xs text-slate-300 space-y-4 overflow-y-auto max-h-[600px] custom-scrollbar">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => {
              const isAccessGranted = log.action?.includes('SUPER_ADMIN_ACCESS_GRANTED');
              const isStatusUpdate = log.action?.includes('SUPER_ADMIN_CLINIC_STATUS_UPDATED');
              const isPlanUpdate = log.action?.includes('SUPER_ADMIN_PLAN_UPDATED');
              const isSupportAccess = log.action?.includes('SUPER_ADMIN_SUPPORT_ACCESS');

              let badgeColor = "text-slate-400 bg-slate-800/50";
              if (isAccessGranted) badgeColor = "text-emerald-400 bg-emerald-950/40 border border-emerald-900/30";
              if (isSupportAccess) badgeColor = "text-amber-400 bg-amber-950/40 border border-amber-900/30";
              if (isStatusUpdate || isPlanUpdate) badgeColor = "text-teal-400 bg-teal-950/40 border border-teal-900/30";

              return (
                <div key={log.id} className="p-4 bg-slate-950/40 border border-slate-800/50 rounded-2xl flex flex-col md:flex-row md:items-start gap-4 hover:bg-slate-950/80 transition-all">
                  <div className="text-[10px] text-slate-500 font-mono shrink-0 whitespace-nowrap pt-1">
                    [{formatTimestamp(log.createdAt)}]
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${badgeColor}`}>
                        {log.action}
                      </span>
                      <span className="text-slate-500 text-[10px]">
                        Target ID: <span className="text-slate-400">{log.targetId}</span> {getClinicName(log.targetId) && `(${getClinicName(log.targetId)})`}
                      </span>
                    </div>
                    {log.details && Object.keys(log.details).length > 0 && (
                      <pre className="text-[10px] bg-slate-950/80 p-3 rounded-xl text-slate-400 border border-slate-800/30 overflow-x-auto max-w-full">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                    <div className="text-[9px] text-slate-500">
                      Executor UID: <span className="text-slate-400">{log.adminId}</span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 space-y-4">
              <Database className="w-12 h-12 stroke-1 opacity-40" />
              <p className="text-[10px] font-bold uppercase tracking-widest">Nenhum log gravado no banco ou correspondente ao filtro</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
