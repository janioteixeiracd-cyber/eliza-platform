import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db, auth, IS_STUDIO_PREVIEW, logQuery, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Search, UserPlus, Filter, MoreHorizontal, Phone, Mail, FileText, Trash2, Smartphone, Database, AlertCircle, ClipboardCheck, Loader2, Bug, RefreshCw, X, Sparkles, Calendar, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { repairPatientStatus } from '../features/import/importService';
import PatientMigrationWizard from './PatientMigrationWizard';

interface Patient {
  id: string;
  name: string;
  phone: string;
  email?: string;
  status: 'active' | 'suspended' | 'suspect' | 'review' | 'other';
  lastProcedure?: string;
  createdAt?: any;
  clinicId?: string;
  _isLegacy?: boolean;
}

interface PatientsListProps {
  onSelectPatient?: (id: string) => void;
  onSchedulePatient?: (id: string) => void;
}

export default function PatientsList({ onSelectPatient, onSchedulePatient }: PatientsListProps) {
  const { clinic, user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid || profile?.uid === clinic?.ownerId;
  const isNina = profile?.name?.toLowerCase().includes('nina') || profile?.email?.toLowerCase().includes('nina') || user?.displayName?.toLowerCase().includes('nina') || user?.email?.toLowerCase().includes('nina');
  const canDeletePatient = isAdmin || isNina;
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [repairMessage, setRepairMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [indexError, setIndexError] = useState<{ link: string; message: string } | null>(null);
  const [diagInfo, setDiagInfo] = useState<any>(null);
  const [newPatient, setNewPatient] = useState({ name: '', phone: '', email: '' });
  const [isMigrationWizardOpen, setIsMigrationWizardOpen] = useState(false);

  useEffect(() => {
    if (!clinic) {
      console.log("[ELIZA] patients list wait state: clinic not yet loaded");
      return;
    }
    setLoading(true);
    setIndexError(null);
    console.log("[ELIZA] entering patients list bootstrap");
    
    let unsubscribe: () => void = () => {};
    let unsubscribeAppts: () => void = () => {};
    
    try {
      const limitCount = IS_STUDIO_PREVIEW ? 300 : 1000;
      const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
      
      // Count patients in review to show banner if needed
      console.log(`[ELIZA] loading review count for ${clinic.id}...`);
      const qReview = query(patientsRef, where('status', 'in', ['review', 'suspect']), limit(50));
      getDocs(qReview).then(snap => {
        console.log(`[ELIZA] review count loaded: ${snap.size}`);
        setReviewCount(snap.size);
      }).catch(err => {
        console.error(`[ELIZA] ERROR in review count query:`, err.message);
        handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/patients (review count)`);
      });

      // Subscribe to clinic appointments for real-time Next Appointment resolution
      const appointmentsRef = collection(db, 'clinics', clinic.id, 'appointments');
      unsubscribeAppts = onSnapshot(appointmentsRef, (snap) => {
        const apptsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAppointments(apptsList);
      }, (err) => {
        console.warn("[ELIZA] failed listening to appointments inside PatientsList:", err.message);
      });

      let q = query(patientsRef, where('status', '==', 'active'), limit(limitCount));
      console.log(`[ELIZA] loading main patients query (status=active)...`);

      unsubscribe = onSnapshot(q, (snap) => {
        console.log(`[ELIZA] patients loaded: ${snap.size} docs`);
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any), _isLegacy: false } as Patient));
        setPatients(items);
        setLoading(false);
        setIndexError(null);
        setQuotaExceeded(false);
      }, (err: any) => {
        console.error(`[ELIZA] ERROR in patients list query:`, err.message);
        setLoading(false);
        if (err.message?.includes('index') || err.code === 'failed-precondition') {
          console.warn("[Firestore] Index required. Details:", err);
          
          if (IS_STUDIO_PREVIEW) {
            // Fallback for missing indices in preview
            getDocs(query(patientsRef, limit(100))).then(fallbackSnap => {
              const items = fallbackSnap.docs
                .map(d => ({ id: d.id, ...(d.data() as any), _isLegacy: false } as Patient))
                .filter(p => p.status === 'active')
                .slice(0, limitCount);
              setPatients(items);
            });
            
            const link = err.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0] || '';
            setIndexError({ 
              link: link,
              message: "Modo Preview: Usando filtro em memória (Fallback). Clique para criar o índice no console."
            });
          } else {
            handleFirestoreError(err, OperationType.LIST, `clinics/${clinic.id}/patients`);
          }
        } else if (err.message?.includes('Quota exceeded') || err.code === 'resource-exhausted') {
          setQuotaExceeded(true);
        } else {
          handleFirestoreError(err, OperationType.LIST, `clinics/${clinic.id}/patients`);
        }
      });

    } catch (err: any) {
      console.error(`[ELIZA] FATAL ERROR in patients list bootstrap:`, err.message);
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, `clinics/${clinic.id}/patients`);
    }

    return () => {
      console.log("[ELIZA] exiting patients list bootstrap");
      unsubscribe();
      unsubscribeAppts();
    };
  }, [clinic]);

  const runDiagnosis = async () => {
    if (!clinic) return;
    setLoading(true);
    setDiagInfo(null);
    console.log("[Diagnosis] Starting diagnosis for clinic:", clinic.id);
    try {
      const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
      const [snapTotal, snapActive, snapSuspect, snapReview] = await Promise.all([
        getDocs(query(patientsRef, limit(10))),
        getDocs(query(patientsRef, where('status', '==', 'active'), limit(5))),
        getDocs(query(patientsRef, where('status', '==', 'suspect'), limit(5))),
        getDocs(query(patientsRef, where('status', '==', 'review'), limit(5)))
      ]);

      console.log(`[Diagnosis] Found: Total(limit 10)=${snapTotal.size}, Active=${snapActive.size}, Suspect=${snapSuspect.size}, Review=${snapReview.size}`);

      setDiagInfo({
        clinicId: clinic.id,
        sampleTotal: snapTotal.size,
        sampleActive: snapActive.size,
        sampleSuspect: snapSuspect.size,
        sampleReview: snapReview.size,
        docs: snapTotal.docs.map(d => ({ id: d.id, status: d.data().status }))
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/diagnosis`);
      setDiagInfo({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRepair = async () => {
    if (!clinic) return;
    
    setRepairing(true);
    setRepairMessage({ text: 'Iniciando correção de status...', type: 'info' });
    
    try {
      const fixedCount = await repairPatientStatus(clinic.id, (count) => {
        setRepairMessage({ text: `${count} pacientes corrigidos até agora...`, type: 'info' });
      });
      
      if (fixedCount > 0) {
        setRepairMessage({ text: `${fixedCount} pacientes foram corrigidos com sucesso e agora estão ativos no sistema.`, type: 'success' });
      } else {
        setRepairMessage({ text: 'Nenhum paciente pendente atendeu aos critérios de correção. Verifique o diagnóstico.', type: 'info' });
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/patients (repair)`);
      setRepairMessage({ text: 'Erro na correção: ' + err.message, type: 'error' });
    } finally {
      setRepairing(false);
    }
  };

  const handleAddPatient = async () => {
    if (!newPatient.name || !newPatient.phone || !clinic) return;
    
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'patients'), {
        ...newPatient,
        status: 'active',
        createdAt: serverTimestamp(),
      });
      setNewPatient({ name: '', phone: '', email: '' });
      setIsAddModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic?.id}/patients`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!clinic) return;
    if (!canDeletePatient) {
      alert('Apenas o administrador, dono da clínica ou a funcionária Nina podem excluir pacientes.');
      return;
    }
    if (confirm('Deseja realmente excluir este paciente?')) {
      const path = `clinics/${clinic.id}/patients/${id}`;
      try {
        await deleteDoc(doc(db, 'clinics', clinic.id, 'patients', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    }
  };

  const getNextAppointment = (patientId: string) => {
    const patientAppts = appointments.filter(a => a.patientId === patientId);
    if (patientAppts.length === 0) return null;
    
    // Format today as YYYY-MM-DD
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Only future or today
    const activeAppts = patientAppts.filter(a => a.date >= todayStr);
    if (activeAppts.length === 0) return null;
    
    // Sort chronologically
    activeAppts.sort((a, b) => {
      const dateTimeA = `${a.date}T${a.time || '00:00'}`;
      const dateTimeB = `${b.date}T${b.time || '00:00'}`;
      return dateTimeA.localeCompare(dateTimeB);
    });
    
    return activeAppts[0];
  };

  const getStatusBadge = (status: string) => {
    const base = "text-[9px] font-black uppercase px-2 py-0.5 rounded-md border tracking-wider shrink-0";
    switch (status) {
      case 'active':
        return <span className={`${base} bg-teal-50 border-teal-100 text-teal-700`}>Ativo</span>;
      case 'suspended':
        return <span className={`${base} bg-rose-50 border-rose-100 text-rose-700`}>Suspenso</span>;
      case 'suspect':
        return <span className={`${base} bg-amber-50 border-amber-100 text-amber-700`}>Falta</span>;
      case 'review':
        return <span className={`${base} bg-blue-50 border-blue-100 text-blue-700`}>Op</span>;
      default:
        return <span className={`${base} bg-slate-50 border-slate-105 text-slate-700`}>Ativo</span>;
    }
  };

  const filteredPatients = patients.filter(p => {
    const term = (searchTerm || '').trim().toLowerCase();
    if (!term) return true;
    return (
      (p.name || '').toLowerCase().includes(term) ||
      (p.phone || '').toLowerCase().includes(term) ||
      (p.email || '').toLowerCase().includes(term)
    );
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 w-full max-w-full overflow-x-hidden">
      {/* Repair Feedback Message */}
      {repairMessage && (
        <div className={`py-2 px-4 flex items-center gap-2 border-b ${
          repairMessage.type === 'success' ? 'bg-teal-50 border-teal-100 text-teal-900' :
          repairMessage.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-900' :
          'bg-indigo-50 border-indigo-100 text-indigo-900'
        }`}>
          <ClipboardCheck className="w-4 h-4 text-slate-650 shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-widest flex-1">{repairMessage.text}</p>
          <button onClick={() => setRepairMessage(null)} className="p-1 opacity-40 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Review Count Banner */}
      {reviewCount > 0 && !repairMessage && (
        <div className="bg-amber-50 border-b border-amber-100 py-2 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-[10px] text-amber-700 font-bold leading-normal">Existem {reviewCount} pacientes importados pendentes para ativação.</p>
          </div>
          <button 
            onClick={handleRepair}
            className="bg-amber-600 text-white px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-amber-700 transition-all font-bold shrink-0"
          >
            Corrigir Agora
          </button>
        </div>
      )}

      {/* Index Error Notification */}
      {indexError && (
        <div className="bg-amber-50 border-b border-amber-100 py-2 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-[10px] text-amber-700 font-medium leading-normal">{indexError.message}</p>
          </div>
          {indexError.link && (
            <a 
              href={indexError.link} 
              target="_blank" 
              rel="noreferrer"
              className="text-[9px] bg-amber-600 text-white px-2.5 py-1 rounded-lg font-black uppercase tracking-wider hover:bg-amber-700 transition-all shrink-0"
            >
              Criar Índice
            </a>
          )}
        </div>
      )}

      {/* Quota Error */}
      {quotaExceeded && (
        <div className="bg-rose-50 border-b border-rose-100 py-2 px-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-rose-600 shrink-0" />
          <p className="text-[10px] text-rose-700 font-bold uppercase tracking-widest">Limite de Uso Excedido temporariamente.</p>
        </div>
      )}

      {IS_STUDIO_PREVIEW && (
        <div className="bg-amber-50/70 border-b border-amber-100/50 py-1 px-4 flex items-center gap-1.5 shrink-0">
          <AlertCircle className="w-3 h-3 text-amber-650 shrink-0" />
          <p className="text-[8px] font-black text-amber-900 uppercase tracking-widest">Modo Preview: Carregamento otimizado de pacientes cadastrados.</p>
        </div>
      )}

      {/* List Header */}
      <div className="px-4 py-4 md:py-5 border-b border-slate-100 bg-white w-full box-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg md:text-xl font-black tracking-tight text-slate-850 flex items-center gap-2">
              Pacientes
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full font-bold">
                {filteredPatients.length} ativos
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 font-semibold leading-none">Gerencie sua base de clientes, contatos e próximos agendamentos.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex-1 sm:flex-none bg-teal-600 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-md shadow-teal-600/10 hover:bg-teal-700 transition-all flex items-center justify-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Novo Paciente
            </button>
            <button 
              onClick={runDiagnosis}
              disabled={loading}
              className="p-2.5 bg-slate-100 border border-slate-250/50 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
              title="Testar leitura de pacientes"
            >
              <Bug className="w-4 h-4" />
            </button>
            <button 
              onClick={handleRepair}
              disabled={repairing}
              className="p-2.5 bg-amber-50 border border-amber-250/50 text-amber-600 rounded-xl hover:bg-amber-100 transition-colors"
              title="Corrigir status dos pacientes importados"
            >
              <ClipboardCheck className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Diagnosis Results */}
        {diagInfo && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 p-3 rounded-xl bg-slate-900 text-white font-mono text-[9px] relative"
          >
            <button onClick={() => setDiagInfo(null)} className="absolute top-3 right-3 text-white/40 hover:text-white">
              ✕
            </button>
            <p className="text-teal-400 font-bold mb-1 uppercase tracking-wider">Resultado:</p>
            {diagInfo.error ? (
              <p className="text-rose-400">ERRO: {diagInfo.error}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                   <p>Clínica: {diagInfo.clinicId}</p>
                   <p>Total: {diagInfo.sampleTotal}</p>
                   <p>Ativos: {diagInfo.sampleActive ? 'SIM' : 'NÃO'}</p>
                </div>
                <div>
                   <p>Revisão: {diagInfo.sampleReview ? 'SIM' : 'NÃO'}</p>
                   <p>Amostra total: {diagInfo.docs?.length || 0}</p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Toolbar */}
        <div className="mt-3.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-205 rounded-xl py-2 pl-9 pr-3 text-xs focus:ring-1 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all font-medium"
            />
          </div>
        </div>
      </div>

      {/* Grid of Patients */}
      <div 
        className="flex-1 overflow-y-auto px-4 py-4 w-full box-border overflow-x-hidden"
        style={{ paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 w-full">
          <AnimatePresence>
            {filteredPatients.map((patient) => {
              const nextAppt = getNextAppointment(patient.id);
              return (
                <motion.div
                  key={patient.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all relative group cursor-pointer w-full box-border flex flex-col justify-between"
                  onClick={() => onSelectPatient?.(patient.id)}
                >
                  <div>
                    {/* Top Row with Avatar, Name, and Status */}
                    <div className="flex items-start gap-2.5 justify-between w-full">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 bg-teal-50 text-teal-600 rounded-lg flex items-center justify-center font-black text-xs border border-teal-100 uppercase shrink-0">
                          {patient.name?.charAt(0) || '?'}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-extrabold text-slate-800 text-xs sm:text-sm truncate leading-snug group-hover:text-teal-600 transition-colors" title={patient.name}>
                            {patient.name}
                          </h4>
                          <span className="font-mono text-[10px] text-slate-500 font-bold flex items-center gap-0.5 mt-0.5">
                            <Smartphone className="w-3 h-3 text-emerald-500 shrink-0" />
                            {patient.phone}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {getStatusBadge(patient.status)}
                        {canDeletePatient && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(patient.id);
                            }}
                            className="p-1 text-slate-300 hover:text-red-500 transition-colors md:opacity-0 md:group-hover:opacity-100 opacity-100 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Next Appointment Display instead of Legacy email */}
                    <div className="mt-3 space-y-1 w-full text-[10px] font-bold">
                      {nextAppt ? (
                        <div className="text-teal-700 bg-teal-50/50 border border-teal-100/70 rounded-lg py-1 px-2.5 flex items-center gap-1.5 w-full min-w-0">
                          <Calendar className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                          <span className="truncate leading-none">
                            Próximo: {nextAppt.date.split('-').reverse().join('/')} às {nextAppt.time}
                          </span>
                        </div>
                      ) : (
                        <div className="text-slate-500 bg-slate-50 border border-slate-150 rounded-lg py-1 px-2.5 flex items-center gap-1.5 w-full min-w-daily">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 opacity-60 shrink-0" />
                          <span className="truncate leading-none text-slate-400">
                            Sem agendamento futuro
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Compact Quick Actions */}
                  <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-row gap-1.5 w-full">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPatient?.(patient.id);
                      }}
                      className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-[10.5px] font-black py-1.5 px-2 rounded-lg transition-colors uppercase tracking-tight flex items-center justify-center gap-0.5"
                    >
                      Ficha
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onSchedulePatient?.(patient.id);
                      }}
                      className="flex-1 bg-teal-55/40 hover:bg-teal-50 border border-teal-200/80 text-teal-700 text-[10px] font-black py-1.5 px-2 rounded-lg transition-colors uppercase tracking-tight flex items-center justify-center gap-0.5"
                    >
                      Agendar
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const cleanPhone = patient.phone ? patient.phone.replace(/\D/g, '') : '';
                        window.open(`https://wa.me/${cleanPhone.startsWith('55') ? '' : '55'}${cleanPhone}`, '_blank');
                      }}
                      className="flex-1 bg-emerald-50 hover:bg-emerald-500 hover:text-white border border-emerald-250 text-emerald-700 text-[10px] font-black py-1.5 px-2 rounded-lg transition-all uppercase tracking-tight flex items-center justify-center gap-0.5"
                    >
                      <MessageCircle className="w-3 h-3 shrink-0" />
                      WhatsApp
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-6 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl shadow-blue-900/20"
          >
            <h3 className="text-2xl font-bold text-slate-900 mb-2">Cadastrar Paciente</h3>
            <p className="text-slate-500 text-sm mb-5">Insira as informações básicas para começar.</p>
            
            {/* IA Smart Migration Banner */}
            <div className="mb-6 p-4 bg-teal-50 border border-teal-100/85 rounded-2xl flex flex-col gap-2.5">
              <div className="flex items-start gap-2.5">
                <div className="p-2 bg-teal-600/10 text-teal-700 rounded-xl">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-[11px] text-slate-800">Possui prints de sistema antigo?</h4>
                  <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">A ELIZA extrai dados cadastrais, tratamentos, evoluções e financeiro usando IA.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  setIsMigrationWizardOpen(true);
                }}
                className="w-full bg-teal-600 text-white hover:bg-teal-700 font-bold py-2.5 px-4 rounded-xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Migrar Paciente com IA
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Nome Completo</label>
                <input 
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-teal-600 outline-none"
                  value={newPatient.name}
                  onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Telefone / WhatsApp</label>
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-teal-600 outline-none"
                  value={newPatient.phone}
                  onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">E-mail (opcional)</label>
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-teal-600 outline-none"
                  value={newPatient.email}
                  onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-10 flex gap-3">
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-4 rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleAddPatient}
                className="flex-1 bg-teal-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-teal-600/20 hover:bg-teal-700 transition-all font-bold"
              >
                Salvar Paciente
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* IA Patient Migration Wizard Modal */}
      <PatientMigrationWizard 
        isOpen={isMigrationWizardOpen}
        onClose={() => setIsMigrationWizardOpen(false)}
        existingPatients={patients}
        onSuccess={() => {
          // The components will auto reload due to onSnapshot listeners
        }}
      />
    </div>
  );
}
