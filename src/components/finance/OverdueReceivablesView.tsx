import React, { useState, useEffect } from 'react';
import { 
  AlertCircle, 
  Search, 
  Filter, 
  MoreHorizontal, 
  MessageSquare, 
  Phone, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  TrendingUp,
  User,
  ExternalLink,
  ChevronRight,
  Sparkles,
  RefreshCw,
  X,
  Plus
} from 'lucide-react';
import { collection, query, onSnapshot, where, orderBy, limit, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { OverdueReceivable, CollectionStatus } from '../../types/finance';
import { differenceInDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function OverdueReceivablesView() {
  const { clinic, user } = useAuth();
  const [receivables, setReceivables] = useState<OverdueReceivable[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'priority'>('all');

  // Modal State for Edit & Reschedule
  const [activeReschedule, setActiveReschedule] = useState<OverdueReceivable | null>(null);
  const [tempDueDate, setTempDueDate] = useState('');
  const [tempPromiseDate, setTempPromiseDate] = useState('');
  const [tempCollectionNotes, setTempCollectionNotes] = useState('');
  const [tempNegotiatorId, setTempNegotiatorId] = useState('');
  const [tempCollectionStatus, setTempCollectionStatus] = useState<CollectionStatus>('não iniciado');
  const [isSaving, setIsSaving] = useState(false);

  // Patient linking state
  const [linkingReceivable, setLinkingReceivable] = useState<OverdueReceivable | null>(null);
  const [linkingSearch, setLinkingSearch] = useState('');

  // official WA sending loaders
  const [sendingId, setSendingId] = useState<string | null>(null);

  // FETCH STAFF
  useEffect(() => {
    if (!clinic) return;
    const qt = query(collection(db, 'clinics', clinic.id, 'team_members'), limit(100));
    const unsubStaff = onSnapshot(qt, (snap) => {
      if (!snap.empty) {
        setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else {
        const qm = query(collection(db, 'clinics', clinic.id, 'members'), limit(50));
        onSnapshot(qm, (mSnap) => {
          setStaff(mSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
      }
    });
    return () => unsubStaff();
  }, [clinic]);

  // FETCH PATIENTS
  useEffect(() => {
    if (!clinic) return;
    const fetchPatients = async () => {
      try {
        const snap = await getDocs(collection(db, 'clinics', clinic.id, 'patients'));
        setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Error fetching patients in Overdue view:", err);
      }
    };
    fetchPatients();
  }, [clinic]);

  // STREAM OVERDUE ENTRIES
  useEffect(() => {
    if (!clinic) return;

    const path = `clinics/${clinic.id}/financial_entries`;
    const q = query(
      collection(db, 'clinics', clinic.id, 'financial_entries'),
      where('type', '==', 'receita'),
      limit(300)
    );

    const unsub = onSnapshot(q, (snap) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdue = snap.docs
        .map(d => {
          const data = d.data();
          
          let dueDate: Date | null = null;
          const rawDueDate = data.due_date || data.dueDate || data.date;
          if (rawDueDate) {
            if (rawDueDate.toDate && typeof rawDueDate.toDate === 'function') {
              dueDate = rawDueDate.toDate();
            } else {
              dueDate = new Date(rawDueDate);
            }
          }
          if (!dueDate || isNaN(dueDate.getTime())) return null;

          // Exclude paid titles
          const rawStatus = String(data.status || '').toLowerCase();
          if (rawStatus === 'pago' || rawStatus === 'paid') return null;

          // Exclude futures
          const dueCompare = new Date(dueDate);
          dueCompare.setHours(0, 0, 0, 0);
          if (dueCompare >= today) return null;

          const amountPaid = Number(data.paidAmount || data.paid_amount || 0);
          const totalAmount = Number(data.amount || data.totalAmount || data.value || 0);
          const remaining = totalAmount - amountPaid;

          if (remaining <= 0) return null;

          return {
            id: d.id,
            patient_id: data.patientId || data.patient_id || '',
            patient_name: data.patientName || data.patient_name || '',
            amount: remaining,
            due_date: dueCompare.toISOString().split('T')[0],
            days_overdue: differenceInDays(today, dueCompare),
            collection_status: data.collection_status || 'não iniciado',
            collection_responsible_id: data.collection_responsible_id || data.sale_responsible_id || null,
            reprogramming_history: data.reprogramming_history || [],
            description: data.description || '',
            raw: data,
          } as OverdueReceivable;
        })
        .filter(Boolean) as OverdueReceivable[];

      setReceivables(overdue.sort((a, b) => b.days_overdue - a.days_overdue));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, path);
      setLoading(false);
    });

    return () => unsub();
  }, [clinic]);

  const statusColors: Record<CollectionStatus, string> = {
    'não iniciado': 'bg-slate-100 text-slate-500 border border-slate-200',
    'em contato': 'bg-blue-50 text-blue-600 border border-blue-200',
    'prometeu pagar': 'bg-amber-50 text-amber-600 border border-amber-200',
    'negociado': 'bg-purple-50 text-purple-600 border border-purple-200',
    'pago': 'bg-emerald-50 text-emerald-600 border border-emerald-200',
    'sem resposta': 'bg-rose-50 text-rose-500 border border-rose-200',
    'incobrável': 'bg-slate-950 text-slate-100 border border-slate-950'
  };

  const statusLabels: Record<CollectionStatus, string> = {
    'não iniciado': 'Não Iniciado',
    'em contato': 'Em Negociação',
    'prometeu pagar': 'Promessa de Pagamento',
    'negociado': 'Negociado',
    'pago': 'Pago',
    'sem resposta': 'Sem Resposta',
    'incobrável': 'Cancelado'
  };

  const formatPhoneForWa = (phoneStr: string) => {
    if (!phoneStr) return '';
    const clean = phoneStr.replace(/\D/g, '');
    if (clean.length === 10 || clean.length === 11) {
      return '55' + clean;
    }
    return clean;
  };

  // Humanized Template Builder
  const getWhatsAppMessageText = (r: OverdueReceivable) => {
    const rawDate = r.due_date;
    const formattedDate = rawDate ? new Date(rawDate + 'T12:00:00').toLocaleDateString('pt-BR') : '---';
    const formattedAmount = Number(r.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    return `Olá ${r.patient_name || 'Paciente'}, tudo bem? Aqui é da clínica ${clinic?.name || 'nossa clínica'}. Identificamos que a parcela no valor de R$ ${formattedAmount} com vencimento em ${formattedDate} ficou em aberto em nosso sistema. Deseja que enviemos uma chave PIX para facilitar a baixa? Atenciosamente, ${clinic?.name || 'Equipe'}.`;
  };

  // DIRECT WAME FALLBACK
  const handleWAWebRedirect = (r: OverdueReceivable) => {
    const patObj = patients.find(p => p.id === r.patient_id);
    const rawPhone = patObj?.whatsapp || patObj?.phone || '';
    const formattedPhone = formatPhoneForWa(rawPhone);
    if (!formattedPhone) {
      alert("Este paciente não possui telefone celular ou WhatsApp cadastrado.");
      return;
    }
    const txt = getWhatsAppMessageText(r);
    const url = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(txt)}`;
    window.open(url, '_blank');
  };

  // SEND OFFICIALLY VIA API HOOK
  const handleSendWAOfficially = async (r: OverdueReceivable) => {
    if (!clinic) return;
    const patObj = patients.find(p => p.id === r.patient_id);
    const rawPhone = patObj?.whatsapp || patObj?.phone || '';
    const formattedPhone = formatPhoneForWa(rawPhone);

    if (!formattedPhone) {
      alert("Paciente não possui telefone cadastrado!");
      return;
    }

    setSendingId(r.id || 'sending');
    const txt = getWhatsAppMessageText(r);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clinicId: clinic.id,
          conversationId: formattedPhone,
          text: txt,
          sentByUserId: user?.uid || 'system',
          sentByName: user?.displayName || 'ELIZA Cobrança',
          source: 'overdue_recovery_ia'
        })
      });

      const bodyData = await res.json();
      if (!res.ok) {
        throw new Error(bodyData.error || 'Erro na transmissão');
      }

      alert(`Notificação enviada com sucesso para o paciente ${r.patient_name} via IA oficial.`);

      // update collection status
      if (r.id) {
        const entryRef = doc(db, 'clinics', clinic.id, 'financial_entries', r.id);
        await updateDoc(entryRef, {
          collection_status: 'em contato',
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || 'system'
        });
      }
    } catch (err: any) {
      console.warn("[OFFICIAL_WA_FAILED_FALLING_WAME]", err);
      alert("Aviso: Notificação Automatizada Oficial indisponível. Abrindo o WhatsApp Web de contingência!");
      const url = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(txt)}`;
      window.open(url, '_blank');
    } finally {
      setSendingId(null);
    }
  };

  // START RESCHEDULE
  const handleStartReschedule = (r: OverdueReceivable) => {
    setActiveReschedule(r);
    setTempDueDate(r.due_date || '');
    setTempPromiseDate(r.raw?.promise_to_pay_date || r.raw?.promise_date || '');
    setTempCollectionNotes(r.raw?.collection_notes || r.raw?.notes || '');
    setTempNegotiatorId(r.collection_responsible_id || '');
    setTempCollectionStatus(r.collection_status || 'não iniciado');
  };

  // SAVE HISTORIC RESCHEDULE
  const handleSaveReschedule = async () => {
    if (!clinic || !activeReschedule || !activeReschedule.id) return;
    setIsSaving(true);
    try {
      const ref = doc(db, 'clinics', clinic.id, 'financial_entries', activeReschedule.id);
      
      const previousDueDate = activeReschedule.due_date;
      const todayString = new Date().toISOString();
      const negotiatorName = staff.find(s => s.id === tempNegotiatorId)?.name || '---';

      const newHistoryItem = {
        previousDueDate,
        newDueDate: tempDueDate,
        promiseToPayDate: tempPromiseDate,
        collectionNotes: tempCollectionNotes,
        negotiatorId: tempNegotiatorId,
        negotiatorName,
        previousStatus: activeReschedule.collection_status || 'não iniciado',
        newStatus: tempCollectionStatus,
        updatedAt: todayString,
        updatedBy: user?.displayName || user?.email || 'Equipe'
      };

      const existingHistory = activeReschedule.reprogramming_history || [];
      const updatedHistory = [...existingHistory, newHistoryItem];

      const updates: any = {
        dueDate: tempDueDate,
        due_date: tempDueDate,
        date: tempDueDate,
        collection_status: tempCollectionStatus,
        promise_to_pay_date: tempPromiseDate,
        collection_notes: tempCollectionNotes,
        collection_responsible_id: tempNegotiatorId || null,
        reprogramming_history: updatedHistory,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || 'system'
      };

      // Mark paid if set
      if (tempCollectionStatus === 'pago') {
        updates.status = 'pago';
        updates.paidAt = serverTimestamp();
        updates.paidAmount = activeReschedule.amount;
      }

      await updateDoc(ref, updates);

      alert("Título reprogramado e atualizado com sucesso!");
      setActiveReschedule(null);
    } catch (err: any) {
      console.error("[ERROR_SAVING_REPROGRAM]", err);
      alert("Erro ao reprogramar: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // PATIENT CLICK ROUTERS
  const handlePatientDetailRedirect = (patientId: string) => {
    if (!patientId) return;
    window.dispatchEvent(new CustomEvent('open-patient-financial-quickview', { detail: { patientId } }));
  };

  const handlePatientFinancialRedirect = (patientId: string) => {
    if (!patientId) return;
    window.dispatchEvent(new CustomEvent('open-patient-financial-quickview', { detail: { patientId } }));
  };

  // Search filter computes
  const displayedReceivables = receivables.filter(r => {
    const matchesSearch = 
      (r.patient_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    if (filterType === 'priority') {
      return matchesSearch && (r.days_overdue > 30 || r.amount > 600);
    }
    return matchesSearch;
  });

  return (
    <div className="space-y-10">
      {/* Header Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
                 <AlertCircle className="w-5 h-5" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Inadimplente</p>
           </div>
           <p className="text-3xl font-black text-rose-600 tracking-tighter">
             R$ {receivables.reduce((sum, r) => sum + r.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
           </p>
           <p className="text-[10px] text-slate-400 mt-2 font-medium">Considerando {receivables.length} títulos atrasados</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                 <MessageSquare className="w-5 h-5" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contatos Ativos</p>
           </div>
           <p className="text-3xl font-black text-slate-900 tracking-tighter">
             {receivables.filter(r => r.collection_status !== 'não iniciado').length}
           </p>
           <p className="text-[10px] text-slate-400 mt-2 font-medium">Pacientes com histórico de cobrança</p>
        </div>

        <div className="bg-amber-600 rounded-[32px] p-8 shadow-lg shadow-amber-600/20 text-white">
           <div className="flex items-center gap-3 mb-4 opacity-80">
              <TrendingUp className="w-5 h-5" />
              <p className="text-[10px] font-black uppercase tracking-widest">Meta de Recuperação</p>
           </div>
           <p className="text-3xl font-black tracking-tighter">
             R$ {(receivables.reduce((sum, r) => sum + r.amount, 0) * 0.3).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
           </p>
           <p className="text-[10px] mt-2 font-black uppercase tracking-tighter opacity-80">30% do total atrasado</p>
        </div>
      </div>

      {/* Listing Panel */}
      <div className="bg-white border border-slate-200 rounded-[40px] overflow-hidden shadow-sm">
        <div className="h-20 bg-slate-50/50 flex flex-col sm:flex-row items-center px-8 border-b border-slate-100 gap-4 justify-between">
           <div className="relative flex-1 w-full m-1 sm:m-0">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
              <input 
                className="bg-transparent border-none text-xs font-bold w-full pl-6 outline-none focus:ring-0" 
                placeholder="Buscar paciente ou procedimento inadimplente..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>
           
           <div className="flex gap-2 w-full sm:w-auto">
              <button 
                onClick={() => setFilterType('all')}
                className={`flex-1 sm:flex-none px-4 py-2 border rounded-xl text-[9px] font-black uppercase tracking-widest cursor-pointer transition-all ${filterType === 'all' ? 'bg-slate-900 text-white border-slate-950' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Todos
              </button>
              <button 
                onClick={() => setFilterType('priority')}
                className={`flex-1 sm:flex-none px-4 py-2 border rounded-xl icon-right text-[9px] font-black uppercase tracking-widest cursor-pointer transition-all ${filterType === 'priority' ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Prioritários (+30d ou + R$600)
              </button>
           </div>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/30">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Paciente & Telefone</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Tratamento / Procedimento</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Atraso & Vencimentos</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status da Cobrança</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Inadimplência Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-10">
                    <p className="text-slate-400 font-bold text-xs animate-pulse">Carregando títulos atrasados...</p>
                  </td>
                </tr>
              ) : displayedReceivables.length > 0 ? (
                displayedReceivables.map((r, idx) => {
                  const hasPatient = r.patient_id && r.patient_id !== '';
                  const patObj = patients.find(p => p.id === r.patient_id);
                  const patientPhone = patObj?.whatsapp || patObj?.phone || 'Telefone não cadastrado';

                  // Original due date can be fetched from first item in history OR simply the existing payment
                  const originalDueDate = r.reprogramming_history && r.reprogramming_history.length > 0
                    ? r.reprogramming_history[0].previousDueDate
                    : r.due_date;

                  return (
                    <tr key={r.id || idx} className="group hover:bg-slate-50 transition-all">
                      {/* Column 1: Patient Details */}
                      <td className="px-8 py-6">
                         <div className="flex items-center gap-3">
                            {hasPatient ? (
                              <>
                                <button 
                                  onClick={() => handlePatientFinancialRedirect(r.patient_id)}
                                  className="w-10 h-10 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center hover:bg-teal-100 transition-all focus:outline-none"
                                  title="Abrir Financeiro do Paciente"
                                >
                                   <User className="w-5 h-5" />
                                </button>
                                <div>
                                   <button
                                     onClick={() => handlePatientFinancialRedirect(r.patient_id)}
                                     className="text-sm font-black text-slate-900 cursor-pointer text-left hover:text-teal-600 hover:underline block"
                                   >
                                     {r.patient_name || 'Sem nome'}
                                   </button>
                                   <p className="text-[10px] text-slate-400 font-bold mt-0.5 flex items-center gap-1">
                                     <Phone className="w-3 h-3 text-slate-300" />
                                     {patientPhone}
                                   </p>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
                                   <AlertCircle className="w-5 h-5" />
                                </div>
                                <div>
                                   <p className="text-sm font-bold text-amber-700 italic">Paciente não identificado</p>
                                   <button
                                     onClick={() => setLinkingReceivable(r)}
                                     className="mt-1 flex items-center gap-1.5 px-2 py-1 bg-amber-100 hover:bg-amber-250 text-amber-900 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors"
                                   >
                                     <Plus className="w-3 h-3" /> Vincular paciente
                                   </button>
                                </div>
                              </>
                            )}
                         </div>
                      </td>

                      {/* Column 2: Treatment / Procedure */}
                      <td className="px-8 py-6 text-xs font-bold text-slate-700">
                        <span className="block font-black text-slate-900">{r.description || 'Consulta/Avulso'}</span>
                        <span className="text-[10px] text-slate-400 font-extrabold block mt-0.5 uppercase tracking-wide">
                          {r.raw?.procedureName || r.raw?.procedure_name || r.raw?.procedure || 'Sem Procedimento'}
                        </span>
                      </td>

                      {/* Column 3: Days overdue & original vs current due date */}
                      <td className="px-8 py-6 text-center">
                         <div className="inline-flex flex-col items-center">
                            <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full font-black text-[10px] uppercase ${r.days_overdue > 60 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                               {r.days_overdue} dias
                            </span>
                            <p className="text-[9px] text-slate-400 font-extrabold mt-1.5 uppercase tracking-tighter">
                               Orig: {originalDueDate ? new Date(originalDueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '---'}
                            </p>
                            {r.reprogramming_history && r.reprogramming_history.length > 0 && (
                               <p className="text-[9px] text-amber-600 font-extrabold mt-0.5 line-through">
                                 Atual: {new Date(r.due_date + 'T12:00:00').toLocaleDateString('pt-BR')} (Reprog. {r.reprogramming_history.length}x)
                               </p>
                            )}
                         </div>
                      </td>

                      {/* Column 4: Amount */}
                      <td className="px-8 py-6">
                         <p className="text-sm font-black text-slate-900 tracking-tighter">R$ {r.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </td>

                      {/* Column 5: Status */}
                      <td className="px-8 py-6">
                         <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest ${statusColors[r.collection_status]}`}>
                            {statusLabels[r.collection_status] || r.collection_status}
                         </span>
                      </td>

                      {/* Column 6: Actions */}
                      <td className="px-8 py-6 text-right">
                         <div className="flex items-center justify-end gap-1.5">
                            {hasPatient && (
                              <>
                                 {/* Contacts Options Container */}
                                 <div className="flex gap-1 items-center bg-slate-100 p-1 rounded-2xl border border-slate-200">
                                    <button 
                                      onClick={() => handleWAWebRedirect(r)}
                                      className="p-2 text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all cursor-pointer shadow-sm hover:scale-105" 
                                      title="Lembrete manual via WhatsApp Web"
                                    >
                                       <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
                                         <path d="M12.004 2c-5.51 0-9.99 4.48-9.99 9.99 0 2.11.65 4.08 1.81 5.7L2.2 22l4.49-1.58c1.55.95 3.39 1.57 5.31 1.57 5.51 0 9.99-4.48 9.99-9.99 0-5.51-4.48-9.99-9.99-9.99zm5.32 14.1c-.22.63-1.09 1.15-1.74 1.28-.62.13-1.39.14-2.22-.12-.86-.27-1.74-.71-2.58-1.27l-.37-.26c-.73-.55-1.42-1.21-2.02-1.92-.61-.71-1.07-1.48-1.35-2.24-.13-.35-.22-.72-.25-1.08-.13-.71.14-1.43.64-1.94l.28-.29c.14-.14.33-.21.52-.21h.3c.11 0 .23 0 .34.05.21.09.43.51.48.62.12.26.24.52.37.78.09.18.11.38.01.55l-.44.75c-.1.17-.07.38.08.54.49.52 1.05.99 1.66 1.4.15.1.34.1.48-.02l.66-.71c.14-.15.35-.19.53-.1.31.14.62.29.93.43.3.14.61.29.91.43.14.07.22.18.25.32l.2.98c0 .12 0 .23-.05.35z"/>
                                       </svg>
                                    </button>
                                    <button
                                      disabled={sendingId !== null}
                                      onClick={() => handleSendWAOfficially(r)}
                                      className={`p-2 rounded-xl transition-all font-bold text-[9px] uppercase flex items-center gap-1 cursor-pointer ${sendingId === r.id ? 'bg-indigo-300 text-indigo-900 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                                      title="Enviar cobrança via ELIZA IA Oficial"
                                    >
                                       <Sparkles className="w-3.5 h-3.5" />
                                       {sendingId === r.id ? 'Enviando...' : 'IA'}
                                    </button>
                                 </div>

                                 {/* "Ver Financeiro" redirect */}
                                 <button
                                   onClick={() => handlePatientFinancialRedirect(r.patient_id)}
                                   className="p-2.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl transition-all cursor-pointer border border-sky-200"
                                   title="Abrir histórico financeiro do paciente"
                                 >
                                    <ExternalLink className="w-4 h-4" />
                                 </button>
                              </>
                            )}

                            {/* REPROGRAM DATE BUTTON */}
                            <button 
                              onClick={() => handleStartReschedule(r)}
                              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all cursor-pointer border border-slate-200" 
                              title="Reprogramar data ou alterar status"
                            >
                               <Calendar className="w-4 h-4" />
                            </button>
                         </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 font-bold">
                     Nenhum título inadimplente encontrado com este critério.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RESCHEDULE & RE-STATUSING MODAL */}
      {activeReschedule && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[999] p-4">
          <div className="bg-white border border-slate-200 rounded-[40px] w-full max-w-lg shadow-2xl p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                      <RefreshCw className="w-5 h-5" />
                   </div>
                   <div>
                      <h3 className="text-md font-black text-slate-900">Operar Cobrança e Reprogramar</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">{activeReschedule.patient_name || 'Paciente Não Identificado'}</p>
                   </div>
                </div>
                <button 
                  onClick={() => setActiveReschedule(null)}
                  className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
             </div>

             <div className="space-y-4">
                <div>
                   <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Histórico de Alterações</label>
                   {activeReschedule.reprogramming_history && activeReschedule.reprogramming_history.length > 0 ? (
                     <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 max-h-32 overflow-y-auto space-y-2">
                        {activeReschedule.reprogramming_history.map((h, hIdx) => (
                           <div key={hIdx} className="text-[10px] text-slate-600 font-bold border-b border-dashed border-slate-200 pb-1.5 last:border-0 last:pb-0">
                             <p>Vencimento alterado de <span className="text-red-500 font-black">{h.previousDueDate ? new Date(h.previousDueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '---'}</span> para <span className="text-emerald-600 font-black">{h.newDueDate ? new Date(h.newDueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '---'}</span></p>
                             {h.promiseToPayDate && <p className="text-[9.5px] text-indigo-700">Previsão: {new Date(h.promiseToPayDate + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
                             {h.collectionNotes && <p className="text-[9.5px] text-slate-500 italic">Observação: "{h.collectionNotes}"</p>}
                             <p className="text-[8px] text-slate-400 text-right">Por {h.updatedBy} em {new Date(h.updatedAt).toLocaleString('pt-BR')}</p>
                           </div>
                        ))}
                     </div>
                   ) : (
                     <p className="text-[10px] text-slate-400 italic font-bold">Nenhuma reprogramação de vencimento foi registrada anteriormente neste título.</p>
                   )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Novo Vencimento</label>
                      <input 
                        type="date"
                        className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold w-full p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                        value={tempDueDate}
                        onChange={(e) => setTempDueDate(e.target.value)}
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Previsão de Recebimento</label>
                      <input 
                        type="date"
                        className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold w-full p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                        value={tempPromiseDate}
                        onChange={(e) => setTempPromiseDate(e.target.value)}
                      />
                   </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Responsável pela Negociação</label>
                      <select 
                        className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold w-full p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                        value={tempNegotiatorId}
                        onChange={(e) => setTempNegotiatorId(e.target.value)}
                      >
                         <option value="">Selecione um profissional...</option>
                         {staff.map(s => (
                           <option key={s.id} value={s.id}>{s.name || s.id}</option>
                         ))}
                      </select>
                   </div>
                   <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Status da Cobrança</label>
                      <select 
                        className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold w-full p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                        value={tempCollectionStatus}
                        onChange={(e) => setTempCollectionStatus(e.target.value as CollectionStatus)}
                      >
                         <option value="não iniciado">Não Iniciado</option>
                         <option value="em contato">Em Negociação</option>
                         <option value="prometeu pagar">Promessa de Pagamento</option>
                         <option value="pago">Pago</option>
                         <option value="incobrável">Cancelado</option>
                      </select>
                   </div>
                </div>

                <div>
                   <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Observação da Negociação</label>
                   <textarea 
                     className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold w-full p-3 h-20 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 resize-none animate-none"
                     placeholder="Histórico ou detalhes do contato com o paciente..."
                     value={tempCollectionNotes}
                     onChange={(e) => setTempCollectionNotes(e.target.value)}
                   />
                </div>
             </div>

             <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-3xl">
                <p className="text-[10px] font-bold text-indigo-700 leading-normal">
                   <strong>Nota de Auditoria:</strong> Ao alterar a data de vencimento deste título de R$ {activeReschedule.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, a ELIZA armazenará uma linha de registro histórico identificando seu usuário para controle financeiro impecável.
                </p>
             </div>

             <div className="flex gap-3 justify-end pt-2">
                <button 
                  onClick={() => setActiveReschedule(null)}
                  className="px-5 py-3 border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  disabled={isSaving}
                  onClick={handleSaveReschedule}
                  className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-md hover:shadow-indigo-600/15"
                >
                  {isSaving ? "Gravando Alterações..." : "Salvar & Registrar"}
                </button>
             </div>
          </div>
        </div>
      )}

      {/* SEARCH AND VINCULAR PACIENTE BACKDROP MODAL */}
      {linkingReceivable && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[999] p-4">
          <div className="bg-white border border-slate-200 rounded-[40px] w-full max-w-md shadow-2xl p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <div className="w-10 h-10 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center">
                      <User className="w-5 h-5" />
                   </div>
                   <div>
                      <h3 className="text-md font-black text-slate-900">Vincular Paciente</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase truncate max-w-[200px]" title={linkingReceivable.description}>
                        Título: {linkingReceivable.description || 'Saldo devedor pendente'}
                      </p>
                   </div>
                </div>
                <button 
                  onClick={() => setLinkingReceivable(null)}
                  className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
             </div>

             <div className="space-y-4">
                <div className="relative">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                   <input
                     autoFocus
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:border-teal-600 outline-none font-medium"
                     placeholder="Buscar por nome do paciente..."
                     value={linkingSearch}
                     onChange={(e) => setLinkingSearch(e.target.value)}
                   />
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-200 max-h-64 overflow-y-auto divide-y divide-slate-100">
                   {patients
                     .filter(p => (p.name || '').toLowerCase().includes(linkingSearch.toLowerCase()))
                     .map(p => (
                       <button
                         key={p.id}
                         type="button"
                         onClick={async () => {
                           if (!clinic || !linkingReceivable) return;
                           try {
                             const ref = doc(db, 'clinics', clinic.id, 'financial_entries', linkingReceivable.id);
                             await updateDoc(ref, {
                               patientId: p.id,
                               patient_id: p.id,
                               patientName: p.name,
                               patient_name: p.name,
                               updatedAt: serverTimestamp(),
                             });
                             alert(`Vinculado com sucesso ao paciente ${p.name}!`);
                             setLinkingReceivable(null);
                           } catch (err: any) {
                             alert(`Erro ao vincular: ${err.message}`);
                           }
                         }}
                         className="w-full text-left p-4 hover:bg-teal-50/50 hover:text-teal-900 transition-colors flex items-center justify-between text-xs font-bold text-slate-700"
                       >
                         <div>
                           <p className="font-extrabold">{p.name}</p>
                           {p.whatsapp && <p className="text-[9px] text-slate-400">Tel: {p.whatsapp}</p>}
                         </div>
                         <ChevronRight className="w-4 h-4 text-slate-300 pointer-events-none" />
                       </button>
                     ))}
                   {patients.filter(p => (p.name || '').toLowerCase().includes(linkingSearch.toLowerCase())).length === 0 && (
                     <p className="p-6 text-center text-slate-400 text-xs font-bold">Nenhum paciente cadastrado com este nome.</p>
                   )}
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
