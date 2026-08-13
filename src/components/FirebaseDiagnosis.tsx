import React, { useState, useEffect } from 'react';
import { Database, Zap, CheckCircle2, XCircle, Play, Sparkles, RefreshCw, AlertCircle, Smartphone, Search, AlertTriangle, Clock, User, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { getFirestore, doc, getDoc, collection, getDocs, limit, query, getCountFromServer, onSnapshot, orderBy } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import app, { auth, IS_STUDIO_PREVIEW, FIRESTORE_DATABASE_ID, db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

interface ScanResult {
  hasProfile: boolean;
  profileName: string | null;
  defaultClinicId: string | null;
  clinicName: string | null;
  patientsCount: number;
  appointmentsCount: number;
  transactionsCount: number;
  status: 'pending' | 'success' | 'error';
  error: string | null;
}

interface WhatsAppSendLog {
  id: string;
  type: string;
  patientId: string | null;
  patientName: string | null;
  originalPhone: string | null;
  normalizedPhone: string | null;
  message: string;
  status: 'success' | 'error';
  metaMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: any;
}

export default function FirebaseDiagnosis() {
  const { user, profile, clinic, refreshProfile } = useAuth();
  const [subTab, setSubTab] = useState<'database' | 'whatsapp'>('database');
  
  // Database Integrity Scanner State
  const [isScanning, setIsScanning] = useState(false);
  const [currentSelectedDb, setCurrentSelectedDb] = useState(FIRESTORE_DATABASE_ID);
  const [defaultDbResult, setDefaultDbResult] = useState<ScanResult>({
    hasProfile: false,
    profileName: null,
    defaultClinicId: null,
    clinicName: null,
    patientsCount: 0,
    appointmentsCount: 0,
    transactionsCount: 0,
    status: 'pending',
    error: null,
  });

  const [customDbResult, setCustomDbResult] = useState<ScanResult>({
    hasProfile: false,
    profileName: null,
    defaultClinicId: null,
    clinicName: null,
    patientsCount: 0,
    appointmentsCount: 0,
    transactionsCount: 0,
    status: 'pending',
    error: null,
  });

  // WhatsApp Audit State
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppSendLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // 1. Scan logic for Database scanner
  const scanDatabase = async (dbId: string): Promise<ScanResult> => {
    if (!user) {
      throw new Error("Usuário não autenticado");
    }

    const firestoreInstance = (dbId === '(default)' || dbId === '') 
      ? getFirestore(app) 
      : getFirestore(app, dbId);

    try {
      const profileRef = doc(firestoreInstance, 'users', user.uid);
      const profileSnap = await getDoc(profileRef);
      
      let hasProfile = false;
      let profileName: string | null = null;
      let defaultClinicId: string | null = null;
      let clinicName: string | null = null;
      let patientsCount = 0;
      let appointmentsCount = 0;
      let transactionsCount = 0;

      if (profileSnap.exists()) {
        hasProfile = true;
        const pData = profileSnap.data();
        profileName = pData.name || null;
        defaultClinicId = pData.defaultClinicId || null;
      }

      if (defaultClinicId) {
        const clinicRef = doc(firestoreInstance, 'clinics', defaultClinicId);
        const clinicSnap = await getDoc(clinicRef);
        if (clinicSnap.exists()) {
          clinicName = clinicSnap.data().name || null;
        }

        try {
          const patientsCountSnap = await getCountFromServer(collection(firestoreInstance, 'clinics', defaultClinicId, 'patients'));
          patientsCount = patientsCountSnap.data().count;
        } catch (e) {
          console.warn(`[Diag] No patients or permission error in DB ${dbId}:`, e);
        }

        try {
          const apptsCountSnap = await getCountFromServer(collection(firestoreInstance, 'clinics', defaultClinicId, 'appointments'));
          appointmentsCount = apptsCountSnap.data().count;
        } catch (e) {
          console.warn(`[Diag] No appointments in DB ${dbId}:`, e);
        }

        try {
          const transCountSnap = await getCountFromServer(collection(firestoreInstance, 'clinics', defaultClinicId, 'transactions'));
          transactionsCount = transCountSnap.data().count;
        } catch (e) {
          console.warn(`[Diag] No transactions in DB ${dbId}:`, e);
        }
      }

      return {
        hasProfile,
        profileName,
        defaultClinicId,
        clinicName,
        patientsCount,
        appointmentsCount,
        transactionsCount,
        status: 'success',
        error: null
      };

    } catch (err: any) {
      console.error(`[Diag] Error scanning DB ${dbId}:`, err);
      return {
        hasProfile: false,
        profileName: null,
        defaultClinicId: null,
        clinicName: null,
        patientsCount: 0,
        appointmentsCount: 0,
        transactionsCount: 0,
        status: 'error',
        error: err.message || String(err)
      };
    }
  };

  const handleRunScan = async () => {
    if (!user) return;
    setIsScanning(true);
    
    const defaultRes = await scanDatabase('(default)');
    setDefaultDbResult(defaultRes);

    const customRes = await scanDatabase(FIRESTORE_DATABASE_ID);
    setCustomDbResult(customRes);

    setIsScanning(false);
  };

  useEffect(() => {
    if (user && subTab === 'database') {
      handleRunScan();
    }
  }, [user, subTab]);

  // 2. Fetch WhatsApp Send Logs in real-time
  useEffect(() => {
    if (!clinic || subTab !== 'whatsapp') return;

    setLoadingLogs(true);
    const logsQuery = query(
      collection(db, 'clinics', clinic.id, 'integration_logs'),
      orderBy('createdAt', 'desc'),
      limit(150)
    );

    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      const allLogs = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      // Filter the type in memory to bypass Firebase Index requirement constraints
      const filtered = allLogs.filter((log: any) => log.type === 'whatsapp_send') as WhatsAppSendLog[];
      setWhatsappLogs(filtered);
      setLoadingLogs(false);
    }, (err) => {
      console.error("[Diagnostics] Failed to fetch WhatsApp logs:", err);
      setLoadingLogs(false);
    });

    return () => unsubLogs();
  }, [clinic, subTab]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filter logs based on search inputs
  const filteredWaLogs = whatsappLogs.filter(log => {
    const matchesSearch = 
      (log.patientName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.originalPhone || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.normalizedPhone || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.message || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.errorMessage || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.errorCode || '').toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'success' && log.status === 'success') || 
      (statusFilter === 'error' && log.status === 'error');

    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: filteredWaLogs.length,
    success: filteredWaLogs.filter(l => l.status === 'success').length,
    failed: filteredWaLogs.filter(l => l.status === 'error').length,
  };

  return (
    <div className="space-y-6 font-sans">
      
      {/* Tab Switcher Area */}
      <div className="flex bg-slate-100 p-1.5 rounded-2xl max-w-md border border-slate-200">
        <button
          onClick={() => setSubTab('database')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            subTab === 'database' 
              ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Database className="w-3.5 h-3.5 text-teal-600" />
          Integridade do Banco
        </button>
        <button
          onClick={() => setSubTab('whatsapp')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            subTab === 'whatsapp' 
              ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
          Auditoria WhatsApp
        </button>
      </div>

      {subTab === 'database' ? (
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden">
          {/* Connection status badge */}
          <div className="absolute top-0 right-0 p-6 md:p-8">
            <div className="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 flex items-center gap-2">
               <div className="w-2 h-2 rounded-full animate-pulse bg-emerald-600" />
               Estável
            </div>
          </div>

          {/* Title */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center shadow-sm">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Scanner de Integridade de Dados</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-60">Status do Banco de Dados Clínico</p>
            </div>
          </div>

          {/* Current Database Card */}
          <div className="mb-8 p-5 bg-slate-50 border border-slate-100 rounded-2xl">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Conexão Ativa no Navegador</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block">Project ID:</span>
                <span className="font-bold text-slate-900">{firebaseConfig.projectId}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Database Lock:</span>
                <span className="font-bold text-teal-600 font-mono text-[10.5px] break-all">{FIRESTORE_DATABASE_ID || '(default)'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Usuário Conectado:</span>
                <span className="font-bold text-slate-900 truncate block max-w-[150px]" title={user?.email || ''}>{user?.email || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Clínica Ativa:</span>
                <span className={`font-bold ${clinic ? 'text-emerald-600' : 'text-rose-500'}`}>{clinic?.name || 'NÃO CONECTADA'}</span>
              </div>
            </div>
          </div>

          {/* Database Comparative Results */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">Comparação de Bancos de Dados</h4>
              <button 
                onClick={handleRunScan}
                disabled={isScanning}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-xl text-[10px] font-extrabold uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 border border-slate-250"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                {isScanning ? 'Varrendo...' : 'Escanear Novamente'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Database A: DEFAULT */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${defaultDbResult.patientsCount > 0 ? 'border-emerald-500 bg-emerald-50/10 shadow-lg shadow-emerald-500/5' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-full">Banco Padrão</span>
                    <h5 className="text-sm font-black text-slate-900 mt-1">{"(default)"}</h5>
                  </div>
                  {defaultDbResult.patientsCount > 0 && (
                    <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3 fill-emerald-600 text-emerald-600" /> Contém Dados
                    </span>
                  )}
                </div>

                {defaultDbResult.status === 'pending' ? (
                  <p className="text-xs text-slate-400 italic">Aguardando varredura...</p>
                ) : defaultDbResult.status === 'error' ? (
                  <div className="flex items-start gap-2 text-rose-600 p-3 bg-rose-50 rounded-xl border border-rose-100">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="text-[10px] leading-tight font-medium">Erro ao acessar: {defaultDbResult.error}</p>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-slate-500">Perfil Localizado:</span>
                      <span className="font-bold text-slate-800">{defaultDbResult.hasProfile ? `SIM (${defaultDbResult.profileName})` : 'NÃO'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-slate-500">ID da Clínica:</span>
                      <span className="font-bold text-slate-800 font-mono text-[10px] truncate max-w-[120px]">{defaultDbResult.defaultClinicId || 'NENHUM'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-slate-500">Nome da Clínica:</span>
                      <span className="font-bold text-slate-800">{defaultDbResult.clinicName || 'N/A'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[10px]">
                      <div className="p-2.5 bg-white border border-slate-100 rounded-xl">
                        <span className="text-[18px] font-black text-slate-900 block">{defaultDbResult.patientsCount}</span>
                        <span className="text-slate-400 text-[8px] font-black uppercase tracking-wider block">Pacientes</span>
                      </div>
                      <div className="p-2.5 bg-white border border-slate-100 rounded-xl">
                        <span className="text-[18px] font-black text-slate-900 block">{defaultDbResult.appointmentsCount}</span>
                        <span className="text-slate-400 text-[8px] font-black uppercase tracking-wider block">Consultas</span>
                      </div>
                      <div className="p-2.5 bg-white border border-slate-100 rounded-xl">
                        <span className="text-[18px] font-black text-slate-900 block">{defaultDbResult.transactionsCount}</span>
                        <span className="text-slate-400 text-[8px] font-black uppercase tracking-wider block">Finanças</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Database B: CUSTOM DB */}
              <div className={`p-6 rounded-3xl border-2 transition-all ${customDbResult.patientsCount > 0 ? 'border-emerald-500 bg-emerald-50/10 shadow-lg shadow-emerald-500/5' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-full">Banco Customizado</span>
                    <h5 className="text-sm font-black text-slate-900 mt-1 truncate max-w-[150px]" title={FIRESTORE_DATABASE_ID}>{FIRESTORE_DATABASE_ID}</h5>
                  </div>
                  {customDbResult.patientsCount > 0 && (
                    <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3 fill-emerald-600 text-emerald-600" /> Contém Dados
                    </span>
                  )}
                </div>

                {customDbResult.status === 'pending' ? (
                  <p className="text-xs text-slate-400 italic">Aguardando varredura...</p>
                ) : customDbResult.status === 'error' ? (
                  <div className="flex items-start gap-2 text-rose-600 p-3 bg-rose-50 rounded-xl border border-rose-100">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="text-[10px] leading-tight font-medium">Erro ao acessar: {customDbResult.error}</p>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-slate-500">Perfil Localizado:</span>
                      <span className="font-bold text-slate-800">{customDbResult.hasProfile ? `SIM (${customDbResult.profileName})` : 'NÃO'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-slate-500">ID da Clínica:</span>
                      <span className="font-bold text-slate-800 font-mono text-[10px] truncate max-w-[120px]">{customDbResult.defaultClinicId || 'NENHUM'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-slate-500">Nome da Clínica:</span>
                      <span className="font-bold text-slate-800">{customDbResult.clinicName || 'N/A'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[10px]">
                      <div className="p-2.5 bg-white border border-slate-100 rounded-xl">
                        <span className="text-[18px] font-black text-slate-900 block">{customDbResult.patientsCount}</span>
                        <span className="text-slate-400 text-[8px] font-black uppercase tracking-wider block">Pacientes</span>
                      </div>
                      <div className="p-2.5 bg-white border border-slate-100 rounded-xl">
                        <span className="text-[18px] font-black text-slate-900 block">{customDbResult.appointmentsCount}</span>
                        <span className="text-slate-400 text-[8px] font-black uppercase tracking-wider block">Consultas</span>
                      </div>
                      <div className="p-2.5 bg-white border border-slate-100 rounded-xl">
                        <span className="text-[18px] font-black text-slate-900 block">{customDbResult.transactionsCount}</span>
                        <span className="text-slate-400 text-[8px] font-black uppercase tracking-wider block">Finanças</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Instructions */}
          <div className="mt-8 p-4 bg-amber-50 rounded-2xl border border-amber-200/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
             <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 border border-amber-200/30">
                   <AlertCircle className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-amber-800 uppercase tracking-widest">Aviso de Segurança Clinica</p>
                  <p className="text-[11px] font-medium text-amber-700/80 mt-0.5">
                    Se todos os seus pacientes sumiram, é muito provável que você estivesse usando o banco de dados {"(default)"} e o sistema agora está conectado ao banco de dados customizado (ou vice-versa). O scanner acima mostra exatamente onde estão seus dados históricos verdadeiros para que possamos restaurar a conexão de forma imediata e permanente para você.
                  </p>
                </div>
             </div>
          </div>
        </div>
      ) : (
        /* WhatsApp Audit Logs tab view */
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-xs">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 tracking-tight">Rastreabilidade e Auditoria de Cliques</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-60">Diagnóstico de Disparos de Mensagens (WhatsApp_Send)</p>
              </div>
            </div>
          </div>

          {/* Warning summary explanation */}
          <div className="p-4 bg-emerald-50/45 rounded-2xl border border-emerald-100/50 text-xs text-emerald-800/90 leading-relaxed">
            💡 <strong>Doutor(a), por que apenas um celular recebe?</strong> Esta tela audita o fluxo de envio real via Meta. Se você salvar um número incompleto (sem DDI 55 ou DDD local correto) na ficha do paciente, a Meta rejeitará o envio ou o mesmo falhará. Compare ao lado os campos <strong>Número Bruto</strong> e <strong>Número Normalizado</strong> para diagnosticar as contas que não estão recebendo.
          </div>

          {/* Filters & Metrics row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Search Input */}
            <div className="md:col-span-2 relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por paciente, celular salvo, mensagem, erro..."
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 focus:bg-white transition-all font-sans font-medium"
              />
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 transition-all font-sans font-medium"
              >
                <option value="all">Todos os status</option>
                <option value="success">Sucesso (OK)</option>
                <option value="error">Falhas (Erros)</option>
              </select>
            </div>

            {/* Quick analytics card */}
            <div className="bg-slate-50 border border-slate-100 p-2 rounded-xl flex items-center justify-around text-center">
              <div>
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Total</span>
                <span className="text-xs font-black text-slate-800">{stats.total}</span>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div>
                <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest block">Sucesso</span>
                <span className="text-xs font-black text-emerald-700">{stats.success}</span>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div>
                <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest block">Falha</span>
                <span className="text-xs font-black text-rose-700">{stats.failed}</span>
              </div>
            </div>
          </div>

          {/* Logs List Container */}
          <div className="space-y-3">
            {loadingLogs ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
                Carregando registros de auditoria em tempo real...
              </div>
            ) : filteredWaLogs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 text-slate-400 text-xs font-bold uppercase tracking-wider">
                Nenhum registro de auditoria de envio (WhatsApp_Send) localizado para este filtro.
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredWaLogs.map((log) => {
                  const isSuccess = log.status === 'success';
                  const isExpanded = expandedLogId === log.id;
                  const dateStr = log.createdAt ? new Date(log.createdAt.toDate ? log.createdAt.toDate() : log.createdAt).toLocaleString('pt-BR') : 'Instantâneo';

                  return (
                    <div 
                      key={log.id} 
                      className={`p-4 border rounded-2xl transition-all ${
                        isSuccess 
                          ? 'border-emerald-100 bg-emerald-50/10 hover:bg-emerald-50/20' 
                          : 'border-rose-100 bg-rose-50/10 hover:bg-rose-50/20'
                      }`}
                    >
                      {/* Top Header Row of Item */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100/60 pb-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-slate-400" />
                          <span className="text-xs font-extrabold text-slate-800">
                            {log.patientName || 'Contato / Destinatário'}
                          </span>
                          {log.patientId && (
                            <span className="text-[8px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                              ID: {log.patientId}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] font-mono text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {dateStr}
                          </span>
                          
                          <span className={`px-2.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                            isSuccess 
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                              : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {isSuccess ? 'Sucesso' : 'Falhou'}
                          </span>
                        </div>
                      </div>

                      {/* Content Comparison Row */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 text-xs leading-relaxed">
                        
                        {/* Audit Phone Numbers */}
                        <div className="space-y-1.5 bg-slate-50 border border-slate-100 p-2.5 rounded-xl">
                          <div>
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Nº Saved (Cadastro Pacientes)</span>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700 font-bold">
                              <span>{log.originalPhone || 'Não cadastrado'}</span>
                              {log.originalPhone && (
                                <button 
                                  onClick={() => handleCopy(log.originalPhone!, `${log.id}-orig`)}
                                  className="text-slate-400 hover:text-slate-600"
                                  title="Copiar número salvo"
                                >
                                  {copiedId === `${log.id}-orig` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Nº Enviado Meta (Normalizado)</span>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-teal-700 font-black">
                              <span>{log.normalizedPhone || 'Nenhum'}</span>
                              {log.normalizedPhone && (
                                <button 
                                  onClick={() => handleCopy(log.normalizedPhone!, `${log.id}-norm`)}
                                  className="text-slate-400 hover:text-slate-600"
                                  title="Copiar número de envio"
                                >
                                  {copiedId === `${log.id}-norm` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Audit Messages Context */}
                        <div className="md:col-span-2 space-y-1">
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Mensagem Disparada</span>
                          <p className="text-[11.5px] font-medium text-slate-600 bg-white/60 p-2.5 border border-slate-100 rounded-xl leading-relaxed max-h-[72px] overflow-y-auto custom-scrollbar">
                            {log.message || 'Sem conteúdo.'}
                          </p>
                        </div>
                      </div>

                      {/* Diagnostic details if Failure */}
                      {!isSuccess && (
                        <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs space-y-1.5">
                          <div className="flex items-center gap-1 text-rose-800 font-bold">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            <span>Erro operacional da Cloud API da Meta:</span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[10.5px]">
                            <div>
                              <span className="text-slate-400 block">Código API Error:</span>
                              <span className="font-mono text-rose-700 font-extrabold">{log.errorCode || 'N/A'}</span>
                            </div>
                            <div className="md:col-span-3">
                              <span className="text-slate-400 block">Motivo do Bloqueio:</span>
                              <span className="font-semibold text-rose-700">{log.errorMessage || 'Falha de entrega interna ou sem fundos.'}</span>
                            </div>
                          </div>
                          
                          <p className="text-[9.5px] text-slate-400 font-bold italic pt-1 text-right">
                            {log.errorCode === '100' ? "💡 Dica: Verifique o limite da API da Meta ou o formato de DDD." : "💡 Dica: Certifique-se de que o telefone contém o DDI (55) e um número válido com 9 dígitos."}
                          </p>
                        </div>
                      )}

                      {/* Success tracking ID info */}
                      {isSuccess && log.metaMessageId && (
                        <div className="mt-3 flex items-center justify-between text-[9px] font-mono text-slate-400 bg-slate-50 border border-slate-100 p-1.5 rounded-lg pr-3">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            ID Meta: {log.metaMessageId}
                          </span>
                          <button 
                            onClick={() => handleCopy(log.metaMessageId!, `${log.id}-meta`)}
                            className="text-slate-400 hover:text-slate-700 flex items-center gap-1 font-bold text-[8px] uppercase tracking-wider"
                          >
                            {copiedId === `${log.id}-meta` ? "Copiado!" : "Copiar ID"}
                          </button>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}
