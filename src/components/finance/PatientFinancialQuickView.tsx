import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Phone, MessageSquare, Plus, DollarSign, Calendar, Edit2, Check, 
  Trash2, AlertTriangle, Clock, RefreshCw, Star, ArrowUpRight, Bot, ExternalLink, Award, PlayCircle, HelpCircle, ShieldCheck
} from 'lucide-react';
import { 
  collection, doc, getDoc, getDocs, updateDoc, addDoc, query, where, 
  orderBy, limit, deleteDoc, serverTimestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';

interface PatientFinancialQuickViewProps {
  patientId: string;
  clinicId: string;
  onClose: () => void;
  onRefreshParent?: () => void;
}

export const PatientFinancialQuickView: React.FC<PatientFinancialQuickViewProps> = ({
  patientId,
  clinicId,
  onClose,
  onRefreshParent
}) => {
  const { user } = useAuth();
  const [patient, setPatient] = useState<any | null>(null);
  const [treatments, setTreatments] = useState<any[]>([]);
  const [financials, setFinancials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick actions / modals state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'cobrança' | 'negociação' | 'outros'>('cobrança');
  const [historyList, setHistoryList] = useState<any[]>([]);
  
  // Installment edit/receiving states
  const [editingInstallmentId, setEditingInstallmentId] = useState<string | null>(null);
  const [editDueDate, setEditDueDate] = useState('');
  const [editAmount, setEditAmount] = useState('');

  // 1. Fetch all patient data, treatments, financials, and quick history logs
  const fetchPatientDetails = async () => {
    if (!patientId || !clinicId) return;
    setLoading(true);
    setError(null);
    console.log('[PATIENT_FINANCIAL_QUICK_VIEW_OPEN]', { patientId, clinicId });

    try {
      // Fetch Patient Master Data
      const pDocRef = doc(db, 'clinics', clinicId, 'patients', patientId);
      const pSnap = await getDoc(pDocRef);
      
      if (!pSnap.exists()) {
        console.warn('[PATIENT_FINANCIAL_QUICK_VIEW_ERROR] Patient not found in FireStore.', patientId);
        setError('Paciente não encontrado na base de dados oficial.');
        setLoading(false);
        return;
      }
      
      const pData = { id: pSnap.id, ...pSnap.data() };
      setPatient(pData);

      // Fetch patient treatments
      const treatmentsRef = collection(db, 'clinics', clinicId, 'patients', patientId, 'treatments');
      const tSnap = await getDocs(treatmentsRef);
      const fetchedTreatments: any[] = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTreatments(fetchedTreatments);

      // Fetch patient installments / financial entries
      const financialsRef = collection(db, 'clinics', clinicId, 'patients', patientId, 'financial');
      const fSnap = await getDocs(financialsRef);
      const fetchedFinancials: any[] = fSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Sort financials by due date or installment number
      fetchedFinancials.sort((a, b) => {
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        if (dateA !== dateB) return dateA - dateB;
        return (a.installmentNumber || 0) - (b.installmentNumber || 0);
      });
      setFinancials(fetchedFinancials);

      // Fetch local charges/negotiations history from patients subcollection if it exists, otherwise generate some based on context
      const historyRef = collection(db, 'clinics', clinicId, 'patients', patientId, 'history_notes');
      try {
        const histSnap = await getDocs(query(historyRef, orderBy('createdAt', 'desc')));
        const fetchedHistory: any[] = histSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setHistoryList(fetchedHistory);
      } catch (histErr) {
        // Fallback or empty list
        setHistoryList([]);
      }

      console.log('[PATIENT_FINANCIAL_QUICK_VIEW_LOADED]', {
        patientId,
        treatmentsCount: fetchedTreatments.length,
        financialsCount: fetchedFinancials.length
      });

    } catch (err: any) {
      console.error('[PATIENT_FINANCIAL_QUICK_VIEW_ERROR]', err);
      setError('Ocorreu um erro ao carregar os dados financeiros do paciente.');
      handleFirestoreError(err, OperationType.GET, `clinics/${clinicId}/patients/${patientId}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatientDetails();
  }, [patientId, clinicId]);

  // ESC key keydown listener for quick close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 2. Computed Financial Summaries
  const financialSummary = useMemo(() => {
    let totalContracted = 0;
    let totalReceived = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let nextDueDate: string | null = null;
    const paymentMethods: Record<string, number> = {};

    // Use specific patient installments
    financials.forEach(f => {
      const val = Number(f.amount || f.value || 0);
      totalContracted += val;

      const isPaid = f.status === 'paid' || f.status === 'pago' || f.status === 'received';
      if (isPaid) {
        totalReceived += val;
      } else {
        totalPending += val;
        
        // Check if overdue
        if (f.dueDate || f.due_date) {
          const due = new Date(f.dueDate || f.due_date);
          const today = new Date();
          today.setHours(0,0,0,0);
          if (due < today) {
            totalOverdue += val;
          }
        }
      }

      // Track next due date
      if (!isPaid && (f.dueDate || f.due_date)) {
        const dStr = f.dueDate || f.due_date;
        const due = new Date(dStr);
        const today = new Date();
        today.setHours(0,0,0,0);
        if (due >= today) {
          if (!nextDueDate || new Date(dStr) < new Date(nextDueDate)) {
            nextDueDate = dStr;
          }
        }
      }

      // Track payment methods
      const method = f.paymentMethod || f.payment_method || f.method || 'PIX';
      paymentMethods[method] = (paymentMethods[method] || 0) + 1;
    });

    // Fallback block if installments is empty but there are treatments
    if (financials.length === 0 && treatments.length > 0) {
      treatments.forEach(t => {
        const price = Number(t.price || t.value || t.amount || 0);
        totalContracted += price;
        if (t.financialStatus === 'paid' || t.status === 'completed') {
          totalReceived += price;
        } else {
          totalPending += price;
        }
      });
    }

    // Find top payment method
    let preferredMethod = 'PIX';
    let maxCount = 0;
    Object.entries(paymentMethods).forEach(([method, count]) => {
      if (count > maxCount) {
        maxCount = count;
        preferredMethod = method;
      }
    });

    return {
      totalContracted,
      totalReceived,
      totalPending,
      totalOverdue,
      nextDueDate,
      preferredMethod
    };
  }, [financials, treatments]);

  // 3. Quick Actions
  const handleOpenWhatsApp = () => {
    console.log('[PATIENT_FINANCIAL_QUICK_ACTION]', 'whatsapp', { patientId });
    if (!patient?.phone) {
      alert('Telefone do paciente não cadastrado.');
      return;
    }
    let cleanPhone = patient.phone.replace(/\D/g, "");
    if (cleanPhone.length >= 10 && cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }
    const rawMsg = `Olá, ${patient.name}! Entramos em contato do departamento financeiro da Clínica para revisar seus orçamentos e parcelas pendentes. Como podemos lhe ajudar hoje?`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(rawMsg)}`, '_blank');
  };

  const handleCall = () => {
    console.log('[PATIENT_FINANCIAL_QUICK_ACTION]', 'call', { patientId });
    if (!patient?.phone) {
      alert('Telefone do paciente não cadastrado.');
      return;
    }
    window.open(`tel:${patient.phone}`, '_self');
  };

  const handleOpenCompleteFile = () => {
    console.log('[PATIENT_FINANCIAL_QUICK_ACTION]', 'open_complete_file', { patientId });
    window.dispatchEvent(new CustomEvent('select-patient', { detail: { patientId, tab: 'financial' } }));
    onClose();
  };

  // Add historical notes/charges manually
  const handleAddHistoryNote = async () => {
    if (!noteText.trim()) return;
    try {
      const historyRef = collection(db, 'clinics', clinicId, 'patients', patientId, 'history_notes');
      const noteDoc = {
        text: noteText,
        type: noteType,
        createdAt: new Date().toISOString(),
        createdBy: user?.displayName || 'Sistema'
      };
      const resultDoc = await addDoc(historyRef, noteDoc);
      setHistoryList(prev => [{ id: resultDoc.id, ...noteDoc }, ...prev]);
      setNoteText('');
      setIsNoteModalOpen(false);
      console.log('[PATIENT_FINANCIAL_QUICK_ACTION]', 'add_history_note', { patientId, type: noteType });
    } catch (err: any) {
      alert('Ocorreu uma falha ao registrar o histórico: ' + err.message);
    }
  };

  // 4. Installment Operations
  const handleEditDueDate = async (installmentId: string) => {
    if (!editDueDate) return;
    try {
      // 1. Update patient level document
      const docRef = doc(db, 'clinics', clinicId, 'patients', patientId, 'financial', installmentId);
      await updateDoc(docRef, {
        dueDate: editDueDate,
        due_date: editDueDate
      });

      // 2. Also try updating matching global cash closing entries or general entries
      const globalRef = collection(db, 'clinics', clinicId, 'financial_entries');
      const globalQuery = query(globalRef, where('patientId', '==', patientId));
      const snaps = await getDocs(globalQuery);
      const matched = snaps.docs.find(d => d.id === installmentId || d.data().paymentId === installmentId);
      if (matched) {
        await updateDoc(doc(db, 'clinics', clinicId, 'financial_entries', matched.id), {
          dueDate: editDueDate,
          due_date: editDueDate,
          date: editDueDate // Update date for cashflow tracking
        });
      }

      setEditingInstallmentId(null);
      setEditDueDate('');
      alert('Vencimento alterado com sucesso!');
      fetchPatientDetails();
      if (onRefreshParent) onRefreshParent();
      console.log('[PATIENT_FINANCIAL_QUICK_ACTION]', 'edit_due_date', { patientId, installmentId, editDueDate });
    } catch (err: any) {
      alert('Falha ao editar vencimento: ' + err.message);
    }
  };

  const handleReceiveInstallment = async (installmentId: string, amount: number) => {
    if (!window.confirm(`Confirmar recebimento de R$ ${amount.toLocaleString('pt-BR')}?`)) return;
    
    try {
      // 1. Update Patient Level Installment
      const docRef = doc(db, 'clinics', clinicId, 'patients', patientId, 'financial', installmentId);
      const partialUpdate = {
        status: 'paid',
        paymentDate: new Date().toISOString().split('T')[0],
        paidAmount: amount,
        paid_amount: amount,
        remainingAmount: 0,
        remaining_amount: 0
      };
      await updateDoc(docRef, partialUpdate);

      // 2. Try to find counterpart in clinics/{clinicId}/financial_entries and mark it paid
      const globalRef = collection(db, 'clinics', clinicId, 'financial_entries');
      const globalQuery = query(globalRef, where('patientId', '==', patientId));
      const snaps = await getDocs(globalQuery);
      let matchedFound = false;

      for (const entryDoc of snaps.docs) {
        const item = entryDoc.data();
        if (entryDoc.id === installmentId || item.paymentId === installmentId) {
          await updateDoc(doc(db, 'clinics', clinicId, 'financial_entries', entryDoc.id), {
            status: 'paid',
            paymentDate: new Date().toISOString().split('T')[0],
            paidAmount: amount,
            paid_amount: amount,
            remainingAmount: 0,
            remaining_amount: 0
          });
          matchedFound = true;
          break;
        }
      }

      // 3. If no matching global entry is found, write one to ensure overall accounting has it!
      if (!matchedFound) {
        const docObj = financials.find(f => f.id === installmentId);
        await addDoc(collection(db, 'clinics', clinicId, 'financial_entries'), {
          description: docObj?.description || `Recebimento Parcela de Odonto`,
          category: 'Tratamentos',
          amount: amount,
          value: amount,
          type: 'income',
          status: 'paid',
          date: new Date().toISOString().split('T')[0],
          dueDate: docObj?.dueDate || new Date().toISOString().split('T')[0],
          due_date: docObj?.dueDate || new Date().toISOString().split('T')[0],
          paymentDate: new Date().toISOString().split('T')[0],
          paymentMethod: docObj?.paymentMethod || 'PIX',
          paymentId: installmentId,
          patientId: patientId,
          patientName: patient?.name || 'Paciente Clínico',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user?.uid || 'system'
        });
      }

      // Also generate commissions inside backend services safely
      try {
        const { generateCommissionsForEntry } = await import('../../services/financeService');
        await generateCommissionsForEntry(clinicId, {
          id: installmentId,
          amount,
          value: amount,
          status: 'paid',
          type: 'income',
          patientId,
          patientName: patient?.name || 'Paciente'
        });
      } catch (commErr) {
        console.warn("Commissions sync warning:", commErr);
      }

      alert('Pagamento registrado de forma oficial no caixa geral!');
      fetchPatientDetails();
      if (onRefreshParent) onRefreshParent();
      console.log('[PATIENT_FINANCIAL_QUICK_ACTION]', 'receive_installment', { patientId, installmentId, amount });
    } catch (err: any) {
      alert('Falha ao processar recebimento: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[28rem] bg-slate-900 text-slate-100 shadow-2xl z-50 flex flex-col h-full border-l border-slate-800 animate-in slide-in-from-right duration-300">
      
      {/* Drawer Header */}
      <div className="p-6 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-920">
        <div>
          <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-md font-bold text-[9px] uppercase tracking-wider">
            Ficha Financeira Rápida
          </span>
          <h3 className="text-sm font-black text-white mt-1.5 flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-emerald-400" /> ELIZA QuickView
          </h3>
        </div>
        <button 
          onClick={onClose}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-all cursor-pointer focus:outline-none"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin" />
          <p className="text-xs text-slate-400 uppercase tracking-widest font-black animate-pulse">Lendo Informações da Nuvem...</p>
        </div>
      ) : error ? (
        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-rose-500" />
          <p className="text-xs text-slate-300 font-bold leading-relaxed">{error}</p>
          <button 
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all uppercase tracking-wider cursor-pointer"
          >
            Retornar ao Painel
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
          
          {/* 1. Patient Core Details Card */}
          <div className="bg-slate-850 p-5 rounded-2xl border border-slate-800 space-y-4 text-left">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-base font-extrabold text-white">{patient?.name || 'Paciente sem nome'}</h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">{patient?.phone || 'Telefone não cadastrado'}</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                patient?.status === 'active' || patient?.status === 'ativo' 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' 
                : 'bg-slate-800 text-slate-400'
              }`}>
                {patient?.status === 'active' || patient?.status === 'ativo' ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/60 text-xs">
              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Última Visita</p>
                <p className="text-slate-200 font-semibold mt-0.5">
                  {patient?.lastVisit || patient?.last_visit || patient?.lastVisitDate 
                    ? new Date(patient.lastVisit || patient.last_visit || patient?.lastVisitDate).toLocaleDateString('pt-BR') 
                    : 'Não registrada'}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Responsável Clínico</p>
                <p className="text-slate-200 font-semibold mt-0.5 truncate">
                  {patient?.dentistName || patient?.responsible_professional || 'Clínica Geral'}
                </p>
              </div>
            </div>
          </div>

          {/* 2. Bento Financial Summary */}
          <div className="space-y-3 text-left">
            <h5 className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Resumo Consolidado</h5>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-850 p-4 rounded-xl border border-slate-800">
                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Total Contratado</p>
                <p className="text-sm font-black text-white mt-1">R$ {financialSummary.totalContracted.toLocaleString('pt-BR')}</p>
              </div>
              <div className="bg-slate-850 p-4 rounded-xl border border-slate-800">
                <p className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest">Total Recebido</p>
                <p className="text-sm font-black text-emerald-400 mt-1">R$ {financialSummary.totalReceived.toLocaleString('pt-BR')}</p>
              </div>
              <div className="bg-slate-850 p-4 rounded-xl border border-slate-800">
                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Total Pendente</p>
                <p className="text-sm font-black text-slate-350 mt-1">R$ {financialSummary.totalPending.toLocaleString('pt-BR')}</p>
              </div>
              <div className={`p-4 rounded-xl border ${financialSummary.totalOverdue > 0 ? 'bg-rose-950/20 border-rose-900/60' : 'bg-slate-850 border-slate-800'}`}>
                <p className={`text-[8px] font-bold uppercase tracking-widest ${financialSummary.totalOverdue > 0 ? 'text-rose-400 font-black' : 'text-slate-400'}`}>Total Vencido</p>
                <p className={`text-sm font-black mt-1 ${financialSummary.totalOverdue > 0 ? 'text-rose-450' : 'text-white'}`}>
                  R$ {financialSummary.totalOverdue.toLocaleString('pt-BR')}
                </p>
              </div>
            </div>

            <div className="bg-slate-850 p-4 rounded-xl border border-slate-800 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-wide">Próximo Vencimento</p>
                <p className="text-slate-200 font-semibold mt-0.5">
                  {financialSummary.nextDueDate ? new Date(financialSummary.nextDueDate).toLocaleDateString('pt-BR') : 'Nenhum pendente'}
                </p>
              </div>
              <div>
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-wide">Preferência Pgto</p>
                <p className="text-slate-200 font-semibold mt-0.5">{financialSummary.preferredMethod}</p>
              </div>
            </div>
          </div>

          {/* 3. Linked Treatments */}
          <div className="space-y-3 text-left">
            <h5 className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Procedimentos & Tratamentos</h5>
            <div className="bg-slate-850 rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800">
              {treatments.length > 0 ? (
                treatments.map((t, idx) => (
                  <div key={t.id || idx} className="p-4 space-y-1.5">
                    <div className="flex justify-between items-start">
                      <p className="text-xs font-bold text-white leading-relaxed">
                        {t.procedureName || t.procedureCategory || t.description || 'Procedimento Clínico'}
                      </p>
                      <span className="text-slate-200 font-black text-xs font-mono">
                        R$ {Number(t.price || t.value || t.amount || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-450 font-semibold uppercase">
                      <span>Prof: {t.dentistName || t.dentist || 'Clínica'}</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black ${
                        t.status === 'completed' || t.status === 'concluido' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                      }`}>{t.status === 'completed' || t.status === 'concluido' ? 'Concluído' : 'Em Curso'}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-500 text-xs italic">Nenhum procedimento registrado sob este paciente.</div>
              )}
            </div>
          </div>

          {/* 4. Installments & Payments Checklist */}
          <div className="space-y-3 text-left">
            <div className="flex justify-between items-center">
              <h5 className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Cronograma de Parcelas</h5>
              <span className="text-[9px] font-medium text-slate-500 uppercase">{financials.length} Registradas</span>
            </div>
            
            <div className="space-y-2">
              {financials.length > 0 ? (
                financials.map(f => {
                  const isPaid = f.status === 'paid' || f.status === 'pago' || f.status === 'received';
                  const isOverdue = !isPaid && f.dueDate && new Date(f.dueDate) < new Date();
                  return (
                    <div key={f.id} className={`p-4 bg-slate-850 rounded-xl border transition-all ${
                      isPaid ? 'border-emerald-900/30 opacity-70' : isOverdue ? 'border-rose-900/40 bg-rose-950/5' : 'border-slate-800'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-white flex items-center gap-1.5">
                            {isPaid ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Clock className="w-3.5 h-3.5 text-slate-400" />}
                            Parcela {f.installmentNumber || '1'} 
                            <span className="text-[9.5px] text-slate-450 font-mono">
                              ({f.paymentMethod || f.payment_method || 'PIX'})
                            </span>
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Vencimento: <span className="font-semibold text-slate-200">{f.dueDate ? new Date(f.dueDate).toLocaleDateString('pt-BR') : 'Indefinido'}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-xs font-extrabold ${isPaid ? 'text-emerald-400' : 'text-slate-200'}`}>
                            R$ {Number(f.amount || f.value || 0).toLocaleString()}
                          </p>
                          <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded mt-1.5 inline-block ${
                            isPaid ? 'bg-emerald-500/10 text-emerald-400' : isOverdue ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800 text-slate-350'
                          }`}>
                            {isPaid ? 'Liquidada' : isOverdue ? 'Atrasada' : 'Aberta'}
                          </span>
                        </div>
                      </div>

                      {/* Interactive Buttons per parcel */}
                      {!isPaid && (
                        <div className="mt-4 pt-3 border-t border-slate-800/50 flex align-center justify-end gap-3">
                          {editingInstallmentId === f.id ? (
                            <div className="flex items-center gap-2 w-full">
                              <input 
                                type="date"
                                value={editDueDate}
                                onChange={(e) => setEditDueDate(e.target.value)}
                                className="bg-slate-800 text-slate-100 border border-slate-700 rounded-lg p-1 text-[11px] outline-none flex-1 focus:ring-1 focus:ring-emerald-400"
                              />
                              <button 
                                onClick={() => handleEditDueDate(f.id)}
                                className="p-1 px-2.5 bg-emerald-500 text-slate-950 rounded-lg text-[9px] font-black uppercase transition-all"
                              >
                                Salvar
                              </button>
                              <button 
                                onClick={() => setEditingInstallmentId(null)}
                                className="p-1 px-2 bg-slate-700 text-slate-200 rounded-lg text-[9px] font-bold uppercase transition-all"
                              >
                                X
                              </button>
                            </div>
                          ) : (
                            <>
                              <button 
                                onClick={() => {
                                  setEditingInstallmentId(f.id);
                                  setEditDueDate(f.dueDate || '');
                                }}
                                className="text-[9px] font-bold text-slate-400 uppercase tracking-wider hover:text-white flex items-center gap-1 transition-colors outline-none focus:outline-none"
                              >
                                <Edit2 className="w-3 h-3" /> Editar faturamento
                              </button>
                              <button 
                                onClick={() => handleReceiveInstallment(f.id, Number(f.amount || f.value || 0))}
                                className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-lg text-[9px] uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                              >
                                Registrar Recebimento
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center bg-slate-850 rounded-xl border border-slate-800 text-slate-500 text-xs italic">
                  Nenhuma parcela encontrada sob este paciente na base local.
                </div>
              )}
            </div>
          </div>

          {/* 5. Quick History */}
          <div className="space-y-3 text-left">
            <div className="flex justify-between items-center">
              <h5 className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Histórico Rápido de Contato & Cobrança</h5>
              <button
                onClick={() => {
                  setNoteText('');
                  setNoteType('cobrança');
                  setIsNoteModalOpen(true);
                }}
                className="text-[9px] font-black text-emerald-400 hover:text-emerald-300 flex items-center gap-1 uppercase bg-transparent border-0 outline-none focus:outline-none cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Registrar Ocorrência
              </button>
            </div>

            {/* Inline Note Composer Modal */}
            {isNoteModalOpen && (
              <div className="bg-slate-850 p-4 rounded-xl border border-emerald-500/50 space-y-3">
                <p className="text-[9px] text-slate-300 font-bold uppercase">Registrar Ação / Resolução Financeira</p>
                <div className="flex gap-2">
                  {(['cobrança', 'negociação', 'outros'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setNoteType(type)}
                      className={`px-2.5 py-1 rounded text-[9px] uppercase font-bold tracking-wider transition-all ${
                        noteType === type ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Ex: Ligado para o paciente, confirmou agendamento de Pix para sexta-feira..."
                  className="w-full h-16 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-emerald-400 outline-none"
                />
                <div className="flex align-center justify-end gap-2.5">
                  <button 
                    onClick={() => setIsNoteModalOpen(false)}
                    className="px-3 py-1.5 bg-slate-800 text-slate-450 hover:text-slate-100 rounded-lg text-[10px] font-bold uppercase"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleAddHistoryNote}
                    className="px-4 py-1.5 bg-emerald-500 text-slate-950 font-black rounded-lg text-[10px] uppercase shadow-sm"
                  >
                    Confirmar Anotação
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {historyList.length > 0 ? (
                historyList.map(item => (
                  <div key={item.id} className="p-3 bg-slate-850 rounded-xl border border-slate-800 text-left space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                        item.type === 'cobrança' ? 'bg-rose-500/10 text-rose-450' : 'bg-violet-500/10 text-violet-405'
                      }`}>
                        {item.type}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {item.createdAt ? new Date(item.createdAt).toLocaleDateString('pt-BR') : ''}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 font-medium leading-relaxed">{item.text}</p>
                    <p className="text-[9px] text-slate-450 font-semibold font-mono">Lançado por: {item.createdBy}</p>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-550 border border-dashed border-slate-800 rounded-xl text-xs italic">
                  Nenhuma negociação ou cobrança cadastrada sob este paciente.
                </div>
              )}
            </div>
          </div>

          {/* 6. Quick Action Rails */}
          <div className="space-y-3 pt-4 border-t border-slate-800/60 text-left pb-6">
            <h5 className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Ações de Contato Rápido</h5>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleOpenWhatsApp}
                className="p-3 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5" /> Abrir WhatsApp
              </button>
              <button
                onClick={handleCall}
                className="p-3 bg-slate-800 hover:bg-slate-750 border border-slate-705 text-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" /> Ligar / Discador
              </button>
            </div>

            <button
              onClick={handleOpenCompleteFile}
              className="w-full p-4 bg-slate-950 hover:bg-slate-920 border border-slate-800 text-white font-black rounded-xl text-[10px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
            >
              <ExternalLink className="w-4 h-4 text-emerald-400" /> Abrir Ficha Clínica Completa
            </button>
          </div>

        </div>
      )}
    </div>
  );
};
