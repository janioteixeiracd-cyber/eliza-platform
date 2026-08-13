import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  Camera, 
  Plus, 
  History, 
  CheckCircle2, 
  AlertTriangle, 
  Calculator,
  ArrowRight,
  Sparkles,
  FileText,
  X,
  CreditCard,
  Banknote,
  Smartphone,
  TrendingUp,
  Image as ImageIcon,
  BrainCircuit
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  serverTimestamp, 
  where,
  getDocs,
  limit,
  doc,
  updateDoc
} from 'firebase/firestore';
import { ElizaAIService, ElizaStructuredResponse } from '../services/ElizaAIService';
import ElizaPremiumCard from './ElizaPremiumCard';
import { normalizeLocalDate, normalizeFinancialEntry } from '../utils/financialHelpers';

// Helper to format a Date object as YYYY-MM-DD in the user's local timezone
const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface DailyClosing {
  id: string;
  date: string;
  cashAmount: number;
  machineAmount: number;
  pixAmount: number;
  transferAmount: number;
  totalAmount: number;
  observations: string;
  evidences: string[];
  status: string;
  difference: number;
  closedBy: string;
  createdAt: any;
}

export default function CashClosingView() {
  const { clinic, profile } = useAuth();
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [systemTotal, setSystemTotal] = useState(0);
  const [dinheiroTotal, setDinheiroTotal] = useState(0);
  const [cartaoTotal, setCartaoTotal] = useState(0);
  const [pixTotal, setPixTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [aiAnalysisResponse, setAiAnalysisResponse] = useState<ElizaStructuredResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState<any>(null);
  const [adjustments, setAdjustments] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    cashAmount: 0,
    machineAmount: 0,
    pixAmount: 0,
    transferAmount: 0,
    observations: '',
    evidences: [] as string[]
  });

  // Realtime subscription for active suggested closings from ELIZA
  useEffect(() => {
    if (!clinic) return;
    const qSug = query(
      collection(db, 'clinics', clinic.id, 'cash_closings'),
      where('status', '==', 'suggested'),
      orderBy('date', 'desc'),
      limit(5)
    );
    const unsubSug = onSnapshot(qSug, (snap) => {
      if (!snap.empty) {
        const docObj = snap.docs[0];
        setActiveSuggestion({ id: docObj.id, ...docObj.data() });
      } else {
        setActiveSuggestion(null);
      }
    }, (err) => {
      console.error("[SUGGESTION_LISTEN_ERROR]", err);
    });
    return () => unsubSug();
  }, [clinic]);

  // Realtime subscription for adjustment subcollection associated with the active suggestion
  useEffect(() => {
    if (!clinic || !activeSuggestion) {
      setAdjustments([]);
      return;
    }
    const adjustmentsRef = collection(db, 'clinics', clinic.id, 'cash_closings', activeSuggestion.date, 'adjustments');
    const qAdj = query(adjustmentsRef, where('status', '==', 'pending_review'));
    const unsubAdj = onSnapshot(qAdj, (snap) => {
      setAdjustments(snap.docs.map(docObj => ({ id: docObj.id, ...docObj.data() })));
    }, (err) => {
      console.error("[ADJUSTMENTS_LISTEN_ERROR]", err);
    });
    return () => unsubAdj();
  }, [clinic, activeSuggestion]);

  const handleApproveClosing = async () => {
    if (!clinic || !profile || !activeSuggestion) return;
    setLoading(true);
    try {
      const closingDocRef = doc(db, 'clinics', clinic.id, 'cash_closings', activeSuggestion.date);
      await updateDoc(closingDocRef, {
        status: 'approved',
        approvedBy: profile.name,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Clone/add to legacy collection daily_closings so old historical list shows it perfectly!
      const dailyClosingsRef = collection(db, 'clinics', clinic.id, 'daily_closings');
      await addDoc(dailyClosingsRef, {
        date: activeSuggestion.date,
        cashAmount: activeSuggestion.byPaymentMethod?.dinheiro || 0,
        machineAmount: (activeSuggestion.byPaymentMethod?.credito || 0) + (activeSuggestion.byPaymentMethod?.debito || 0),
        pixAmount: activeSuggestion.byPaymentMethod?.pix || 0,
        transferAmount: (activeSuggestion.byPaymentMethod?.transferencia || 0) + (activeSuggestion.byPaymentMethod?.boleto || 0) + (activeSuggestion.byPaymentMethod?.outros || 0),
        totalAmount: activeSuggestion.totalReceived,
        systemTotal: activeSuggestion.totalReceived,
        observations: "Aprovado via fechamento inteligente automatizado.",
        difference: 0,
        status: "balanced",
        closedBy: profile.name,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("[APPROVE_CLOSING_ERROR]", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustSuggestion = () => {
    if (!activeSuggestion) return;
    setFormData({
      cashAmount: activeSuggestion.byPaymentMethod?.dinheiro || 0,
      machineAmount: (activeSuggestion.byPaymentMethod?.credito || 0) + (activeSuggestion.byPaymentMethod?.debito || 0),
      pixAmount: activeSuggestion.byPaymentMethod?.pix || 0,
      transferAmount: (activeSuggestion.byPaymentMethod?.transferencia || 0) + (activeSuggestion.byPaymentMethod?.boleto || 0) + (activeSuggestion.byPaymentMethod?.outros || 0),
      observations: `Ajuste manual com base no fechamento sugerido automática para o dia ${activeSuggestion.date}.`,
      evidences: []
    });
    setStep(1);
    setIsModalOpen(true);
  };

  const handleSynchronizeAdjustment = async (adj: any) => {
    if (!clinic || !activeSuggestion) return;
    setLoading(true);
    try {
      const adjRef = doc(db, 'clinics', clinic.id, 'cash_closings', activeSuggestion.date, 'adjustments', adj.id);
      await updateDoc(adjRef, {
        status: 'merged',
        mergedAt: serverTimestamp()
      });

      const closingRef = doc(db, 'clinics', clinic.id, 'cash_closings', activeSuggestion.date);
      const updatedByPaymentMethod = { ...activeSuggestion.byPaymentMethod };
      
      adj.newEntries?.forEach((entry: any) => {
        const method = String(entry.paymentMethod || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const amt = Number(entry.amount || 0);
        if (["dinheiro", "especie", "cash"].some(x => method.includes(x))) {
          updatedByPaymentMethod.dinheiro = (updatedByPaymentMethod.dinheiro || 0) + amt;
        } else if (["pix"].some(x => method.includes(x))) {
          updatedByPaymentMethod.pix = (updatedByPaymentMethod.pix || 0) + amt;
        } else if (["credito", "credit"].some(x => method.includes(x))) {
          updatedByPaymentMethod.credito = (updatedByPaymentMethod.credito || 0) + amt;
        } else if (["debito", "debit"].some(x => method.includes(x))) {
          updatedByPaymentMethod.debito = (updatedByPaymentMethod.debito || 0) + amt;
        } else if (["transferencia", "ted", "doc", "bancaria", "bank", "transfer"].some(x => method.includes(x))) {
          updatedByPaymentMethod.transferencia = (updatedByPaymentMethod.transferencia || 0) + amt;
        } else if (["boleto", "ticket"].some(x => method.includes(x))) {
          updatedByPaymentMethod.boleto = (updatedByPaymentMethod.boleto || 0) + amt;
        } else {
          updatedByPaymentMethod.outros = (updatedByPaymentMethod.outros || 0) + amt;
        }
      });

      await updateDoc(closingRef, {
        totalReceived: adj.newTotal,
        byPaymentMethod: updatedByPaymentMethod,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("[SYNCHRONIZE_ADJUSTMENT_ERROR]", err);
    } finally {
      setLoading(false);
    }
  };

  const handleIgnoreAdjustment = async (adj: any) => {
    if (!clinic || !activeSuggestion) return;
    setLoading(true);
    try {
      const adjRef = doc(db, 'clinics', clinic.id, 'cash_closings', activeSuggestion.date, 'adjustments', adj.id);
      await updateDoc(adjRef, {
        status: 'ignored',
        ignoredAt: serverTimestamp()
      });
    } catch (err) {
      console.error("[IGNORE_ADJUSTMENT_ERROR]", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!clinic) return;
    const closingsPath = `clinics/${clinic.id}/daily_closings`;
    const q = query(
      collection(db, 'clinics', clinic.id, 'daily_closings'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setClosings(snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyClosing)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, closingsPath);
    });

    // Calculate system total for today
    const fetchSystemTotal = async () => {
      if (!clinic) return;
      const today = new Date();
      const todayStr = today.toLocaleDateString('en-CA'); // robust local date string "YYYY-MM-DD"
      
      try {
        const entriesSnap = await getDocs(collection(db, 'clinics', clinic.id, 'financial_entries'));
        
        let total = 0;
        let dinheiro = 0;
        let cartao = 0;
        let pix = 0;
        const seenIds = new Set<string>();

        entriesSnap.forEach(d => {
          const docId = d.id;
          if (seenIds.has(docId)) return;
          seenIds.add(docId);

          const norm = normalizeFinancialEntry({ id: docId, ...d.data() });
          
          if (norm.archived) return;
          if (norm.type !== 'income') return;
          if (norm.status !== 'paid' && norm.status !== 'partial') return;

          // Check payment or due date in local format
          const pDate = norm.paidAt ? normalizeLocalDate(norm.paidAt) : normalizeLocalDate(norm.dueDate);
          const pDateStr = pDate.toLocaleDateString('en-CA');

          if (pDateStr === todayStr) {
            total += norm.paidAmount;
            const method = String(norm.paymentMethod || "").toLowerCase().trim();
            if (method.includes("dinheiro") || method.includes("cash")) {
              dinheiro += norm.paidAmount;
            } else if (method.includes("cartao") || method.includes("cartão") || method.includes("debito") || method.includes("débito") || method.includes("credito") || method.includes("crédito") || method.includes("machine") || method.includes("maquininha") || method.includes("card")) {
              cartao += norm.paidAmount;
            } else if (method.includes("pix")) {
              pix += norm.paidAmount;
            }
          }
        });

        setSystemTotal(total);
        setDinheiroTotal(dinheiro);
        setCartaoTotal(cartao);
        setPixTotal(pix);
      } catch (err) {
        console.error("[FETCH_SYSTEM_TOTAL_ERROR]", err);
      }
    };
    fetchSystemTotal();

    return () => unsub();
  }, [clinic]);

  const totalClosed = formData.cashAmount + formData.machineAmount + formData.pixAmount + formData.transferAmount;
  const difference = totalClosed - systemTotal;

  const diagnoseDiscrepancy = async () => {
    if (!clinic) return;
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAiAnalysisResponse(null);

    const todayStr = getLocalDateString();

    try {
      const response = await ElizaAIService.analyzeReconciliation({
        clinicId: clinic.id,
        date: todayStr,
        closingTotal: totalClosed,
        systemTotal: systemTotal,
        detailsText: `Atendente observou: ${formData.observations || 'Nenhuma nota especial.'}. Diferença calculada de R$ ${difference.toFixed(2)}.`
      });
      setAiAnalysisResponse(response);
    } catch (err: any) {
      console.error("[ELIZA_AI] error:", err);
      setAnalysisError("A ELIZA AI não conseguiu gerar a análise agora. Verifique a configuração do modelo de IA.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async () => {
    if (!clinic || !profile) return;
    setLoading(true);
    const path = `clinics/${clinic.id}/daily_closings`;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'daily_closings'), {
        ...formData,
        date: getLocalDateString(),
        totalAmount: totalClosed,
        systemTotal,
        difference,
        status: difference === 0 ? 'balanced' : 'unbalanced',
        closedBy: profile.name,
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      setStep(1);
      setFormData({ cashAmount: 0, machineAmount: 0, pixAmount: 0, transferAmount: 0, observations: '', evidences: [] });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, evidences: [...prev.evidences, reader.result as string] }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6 lg:p-10 custom-scrollbar">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                <Wallet className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Fechamento de Caixa</h1>
            </div>
            <p className="text-sm font-medium text-slate-500">Conciliação diária de valores e evidências operacionais.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-900/20 transition-all flex items-center justify-center gap-3"
          >
            <Calculator className="w-4 h-4" />
            Iniciar Fechamento
          </button>
        </header>

        {activeSuggestion && (
          <div className="bg-gradient-to-br from-indigo-950 to-slate-900 rounded-[3rem] p-8 text-white shadow-2xl relative overflow-hidden mb-10 border border-indigo-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-indigo-600/20 border border-indigo-500/35 rounded-2xl flex items-center justify-center text-indigo-300 shadow-md shadow-indigo-950/40">
                  <BrainCircuit className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider">
                      Sugestão Inteligente ELIZA
                    </span>
                    <span className="bg-teal-500/20 text-teal-300 border border-teal-500/35 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider">
                      Pendente de Aprovação
                    </span>
                  </div>
                  <h2 className="text-xl font-black text-white tracking-tight leading-none">
                    Fechamento de Caixa: {activeSuggestion.date}
                  </h2>
                </div>
              </div>
              <div className="md:text-right bg-black/20 p-5 rounded-2.5xl border border-white/5 md:min-w-[200px]">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Total Proposto</p>
                <p className="text-2xl font-black text-teal-400 tracking-tight mt-1">
                  R$ {activeSuggestion.totalReceived?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Payment Methods Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white/5 border border-white/5 p-4 rounded-2xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Dinheiro</p>
                <p className="text-sm font-black text-white mt-1">R$ {(activeSuggestion.byPaymentMethod?.dinheiro || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="bg-white/5 border border-white/5 p-4 rounded-2xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">PIX</p>
                <p className="text-sm font-black text-white mt-1">R$ {(activeSuggestion.byPaymentMethod?.pix || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="bg-white/5 border border-white/5 p-4 rounded-2xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Crédito / Débito</p>
                <p className="text-sm font-black text-white mt-1">
                  R$ {((activeSuggestion.byPaymentMethod?.credito || 0) + (activeSuggestion.byPaymentMethod?.debito || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-white/5 border border-white/5 p-4 rounded-2xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Boleto / Transf.</p>
                <p className="text-sm font-black text-white mt-1">
                  R$ {((activeSuggestion.byPaymentMethod?.boleto || 0) + (activeSuggestion.byPaymentMethod?.transferencia || 0) + (activeSuggestion.byPaymentMethod?.outros || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Warnings Section */}
            {activeSuggestion.warnings?.length > 0 && (
              <div className="bg-rose-500/10 border border-rose-500/20 p-5 rounded-2.5xl mb-6">
                <p className="text-[10px] font-black uppercase text-rose-300 tracking-wider flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4" /> Alertas de Divergência ({activeSuggestion.warnings?.length})
                </p>
                <ul className="space-y-2 text-[11px] font-semibold text-slate-300">
                  {activeSuggestion.warnings.slice(0, 4).map((w: string, i: number) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-rose-400 font-bold">•</span>
                      <span>{w}</span>
                    </li>
                  ))}
                  {activeSuggestion.warnings.length > 4 && (
                    <li className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider pl-3 mt-1 cursor-pointer hover:underline" onClick={handleAdjustSuggestion}>
                      + {activeSuggestion.warnings.length - 4} alertas adicionais. Clique em ajustar fechamento para revisar todos os lançamentos.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Realtime Adjustments / Pending incorporating */}
            {adjustments.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/25 p-6 rounded-2.5xl mb-6 border-dashed">
                <p className="text-[10px] font-black uppercase text-amber-300 tracking-widest flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 animate-spin-slow" /> ATUALIZAÇÃO DE CAIXA OPERACIONAL DETECTADA
                </p>
                {adjustments.map((adj, idx) => (
                  <div key={idx} className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 bg-slate-950/20 p-5 rounded-xl border border-amber-500/10">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-200">
                        Novos lançamentos foram integrados no sistema após o fechamento parcial das 18h:
                      </p>
                      <div className="bg-black/35 p-3.5 rounded-xl text-[11px] text-slate-300 font-mono">
                        {adj.newEntries?.map((e: any, i: number) => (
                          <div key={i}>
                            • {e.title} - R$ {Number(e.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ({e.paymentMethod})
                          </div>
                        ))}
                      </div>
                      <p className="text-xs font-black text-amber-400 mt-2">
                        Deseja incorporar o valor de R$ {Number(adj.difference || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} no total? (Novo total estimado: R$ {Number(adj.newTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={loading}
                        onClick={() => handleIgnoreAdjustment(adj)}
                        className="bg-white/5 hover:bg-white/10 text-slate-300 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                      >
                        Ignorar
                      </button>
                      <button
                        disabled={loading}
                        onClick={() => handleSynchronizeAdjustment(adj)}
                        className="bg-amber-500 hover:bg-amber-600 text-slate-950 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20"
                      >
                        Sincronizar & Incorporar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Primary Action Row */}
            <div className="flex flex-wrap gap-4 pt-6 border-t border-white/5">
              <button
                disabled={loading}
                onClick={handleAdjustSuggestion}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white min-w-[200px] py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.15em] border border-white/5 transition-all"
              >
                Ajustar / Negar Fechamento
              </button>
              <button
                disabled={loading}
                onClick={handleApproveClosing}
                className="flex-1 bg-teal-500 hover:bg-teal-600 text-slate-950 min-w-[200px] py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-teal-500/20 transition-all"
              >
                {loading ? 'Sincronizando...' : 'Aprovar Fechamento'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           {/* Current Pulse */}
           <div className="lg:col-span-2 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Registrado hoje no sistema</p>
                    <h3 className="text-3xl font-black text-slate-900 tracking-tight mb-4">R$ {systemTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                    <div className="flex gap-2">
                       <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] font-bold uppercase tracking-widest border border-emerald-100 flex items-center gap-1">
                         <TrendingUp className="w-3 h-3" /> Capturado
                       </span>
                    </div>
                 </div>
                 <div className="bg-slate-900 p-8 rounded-[3rem] text-white shadow-xl flex flex-col justify-between">
                    <div>
                      <p className="text-[10px] font-black text-teal-400/80 uppercase tracking-widest mb-2">Insight da ELIZA</p>
                      <p className="text-xs font-semibold text-slate-300 leading-relaxed">
                        {systemTotal > 0 
                          ? "Compare os valores da maquininha com os lançamentos de hoje para garantir a conciliação bancária correta."
                          : "Aguardando lançamentos financeiros para iniciar a análise operacional do dia."}
                      </p>
                    </div>
                    <div className="pt-4 mt-6 border-t border-white/5">
                       <button className="text-[10px] font-black uppercase tracking-widest text-teal-400 flex items-center gap-2 hover:underline">
                         Sincronizar lançamentos <ArrowRight className="w-3 h-3" />
                       </button>
                    </div>
                 </div>
              </div>

              {/* History List */}
              <div className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                   <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                     <History className="w-4 h-4" /> Histórico de Fechamentos
                   </h3>
                </div>
                <div className="divide-y divide-slate-50">
                  {closings.length === 0 ? (
                    <div className="p-20 text-center text-slate-400">
                       <CheckCircle2 className="w-8 h-8 mx-auto mb-4 opacity-20" />
                       <p className="text-xs font-bold uppercase tracking-widest">Nenhum fechamento registrado</p>
                    </div>
                  ) : (
                    closings.map(closing => (
                      <div key={closing.id} className="p-6 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                         <div className="flex items-center gap-6">
                            <div className="text-center w-12">
                               <p className="text-sm font-black text-slate-900">{closing.date.split('-')[2]}</p>
                               <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                 {new Date(closing.date).toLocaleString('default', { month: 'short' })}
                               </p>
                            </div>
                            <div>
                               <p className="text-sm font-bold text-slate-900">R$ {closing.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                               <p className="text-[10px] font-bold text-slate-400 mt-0.5">Fechado por {closing.closedBy}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-4">
                            <div className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border ${
                              closing.status === 'balanced' 
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                                : 'bg-rose-50 text-rose-600 border-rose-100'
                            }`}>
                              {closing.status === 'balanced' ? 'Conciliado' : 'Divergente'}
                            </div>
                            {closing.evidences?.length > 0 && (
                              <div className="p-2 bg-slate-100 rounded-lg text-slate-400">
                                <Camera className="w-4 h-4" />
                              </div>
                            )}
                            <button className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 opacity-0 group-hover:opacity-100 transition-all hover:text-teal-600">
                               <ArrowRight className="w-4 h-4" />
                            </button>
                         </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
           </div>

           {/* Quick Actions & Status */}
           <div className="space-y-6">
              <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Tipos de Pagamento Hoje</h4>
                 <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-teal-600 shadow-sm"><Banknote className="w-4 h-4" /></div>
                          <span className="text-[10px] font-bold uppercase text-slate-600">Dinheiro</span>
                       </div>
                       <span className="text-xs font-black text-slate-900">{dinheiroTotal > 0 ? `R$ ${dinheiroTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : "Sem movimento"}</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-teal-600 shadow-sm"><CreditCard className="w-4 h-4" /></div>
                          <span className="text-[10px] font-bold uppercase text-slate-600">Cartão</span>
                       </div>
                       <span className="text-xs font-black text-slate-900">{cartaoTotal > 0 ? `R$ ${cartaoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : "Sem movimento"}</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-teal-600 shadow-sm"><Smartphone className="w-4 h-4" /></div>
                          <span className="text-[10px] font-bold uppercase text-slate-600">PIX</span>
                       </div>
                       <span className="text-xs font-black text-slate-900">{pixTotal > 0 ? `R$ ${pixTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : "Sem movimento"}</span>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      {/* Modal: Fechamento de Caixa */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
             <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden">
                <div className="h-2 bg-teal-600" />
                <div className="p-10">
                   <div className="flex justify-between items-center mb-8">
                      <div>
                         <h3 className="text-2xl font-black text-slate-900 tracking-tight">Fechamento do Dia</h3>
                         <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                           {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                         </p>
                      </div>
                      <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                         {[1, 2, 3].map(s => (
                           <div key={s} className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black ${step === s ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/20' : 'text-slate-300'}`}>{s}</div>
                         ))}
                      </div>
                   </div>

                   {step === 1 && (
                     <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Total em Dinheiro</label>
                              <div className="relative">
                                 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 font-bold text-xs">R$</div>
                                 <input 
                                  type="number"
                                  value={formData.cashAmount || ''}
                                  onChange={(e) => setFormData({...formData, cashAmount: parseFloat(e.target.value) || 0})}
                                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-black outline-none focus:border-teal-500" 
                                  placeholder="0,00" 
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Total na Maquininha</label>
                              <div className="relative">
                                 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 font-bold text-xs">R$</div>
                                 <input 
                                  type="number"
                                  value={formData.machineAmount || ''}
                                  onChange={(e) => setFormData({...formData, machineAmount: parseFloat(e.target.value) || 0})}
                                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-black outline-none focus:border-teal-500" 
                                  placeholder="0,00" 
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Total em PIX</label>
                              <div className="relative">
                                 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 font-bold text-xs">R$</div>
                                 <input 
                                  type="number"
                                  value={formData.pixAmount || ''}
                                  onChange={(e) => setFormData({...formData, pixAmount: parseFloat(e.target.value) || 0})}
                                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-black outline-none focus:border-teal-500" 
                                  placeholder="0,00" 
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Transferências</label>
                              <div className="relative">
                                 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 font-bold text-xs">R$</div>
                                 <input 
                                  type="number"
                                  value={formData.transferAmount || ''}
                                  onChange={(e) => setFormData({...formData, transferAmount: parseFloat(e.target.value) || 0})}
                                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-black outline-none focus:border-teal-500" 
                                  placeholder="0,00" 
                                 />
                              </div>
                           </div>
                        </div>

                        <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                           <div>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Somado</p>
                              <p className="text-xl font-black text-slate-900">R$ {totalClosed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                           </div>
                           <button onClick={() => setStep(2)} className="bg-slate-900 text-white px-10 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 hover:bg-teal-600 transition-all flex items-center gap-3">
                             Prosseguir <ArrowRight className="w-4 h-4" />
                           </button>
                        </div>
                     </div>
                   )}

                   {step === 2 && (
                     <div className="space-y-8">
                        <div>
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block px-1">Upload de Comprovantes / Extratos</label>
                           <div className="grid grid-cols-4 gap-4">
                              {formData.evidences.map((url, i) => (
                                <div key={i} className="aspect-square bg-slate-100 rounded-2xl overflow-hidden relative border border-slate-200 group">
                                   <img src={url} className="w-full h-full object-cover" alt="Comp" />
                                   <button 
                                    onClick={() => setFormData(prev => ({ ...prev, evidences: prev.evidences.filter((_, idx) => idx !== i) }))}
                                    className="absolute inset-0 bg-rose-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white"
                                   >
                                      <X className="w-5 h-5" />
                                   </button>
                                </div>
                              ))}
                              <label className="aspect-square bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 hover:bg-slate-100 hover:border-teal-300 transition-all cursor-pointer">
                                 <Plus className="w-6 h-6 mb-1" />
                                 <span className="text-[8px] font-black uppercase">Anexar</span>
                                 <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                              </label>
                           </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observações do dia</label>
                           <textarea 
                            value={formData.observations}
                            onChange={(e) => setFormData({...formData, observations: e.target.value})}
                            className="w-full h-32 px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-teal-500 resize-none" 
                            placeholder="Alguma anotação sobre diferenças ou fatos relevantes?"
                           />
                        </div>

                        <div className="pt-6 border-t border-slate-100 flex gap-4">
                           <button onClick={() => setStep(1)} className="flex-1 py-4 border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Voltar</button>
                           <button onClick={() => setStep(3)} className="flex-1 bg-slate-900 text-white py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10">Ver Resumo</button>
                        </div>
                     </div>
                   )}

                   {step === 3 && (
                     <div className="space-y-8">
                        <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                           <div className="flex justify-between items-center mb-8">
                              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Relatório de Conciliação</h4>
                              <Sparkles className="w-5 h-5 text-teal-600" />
                           </div>
                           <div className="space-y-6">
                              <div className="flex justify-between items-center py-4 border-b border-white">
                                 <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Total Fechamento</span>
                                 <span className="text-base font-black text-slate-900 tracking-tight">R$ {totalClosed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className="flex justify-between items-center py-4 border-b border-white">
                                 <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Total no Sistema</span>
                                 <span className="text-base font-bold text-slate-900 tracking-tight">R$ {systemTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className={`flex justify-between items-center p-6 rounded-2xl ${difference === 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                 <span className="text-[10px] font-black uppercase tracking-[0.2em]">Resultado Final</span>
                                 <div className="text-right">
                                    <p className="text-lg font-black tracking-tight">{difference === 0 ? 'Valores Batem' : `Diferença R$ ${Math.abs(difference).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</p>
                                    <p className="text-[9px] font-bold opacity-60 uppercase tracking-widest">{difference === 0 ? 'Sem divergências identificadas' : (difference > 0 ? 'Sobra de caixa' : 'Falta em caixa')}</p>
                                 </div>
                              </div>
                           </div>

                           {difference !== 0 && (
                             <div className="mt-6 pt-6 border-t border-slate-200" id="eliza-section">
                                <button 
                                  onClick={diagnoseDiscrepancy}
                                  disabled={isAnalyzing}
                                  className="w-full flex items-center justify-center gap-2 py-3 bg-teal-50 text-teal-700 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-100 transition-all"
                                >
                                  <BrainCircuit className={`w-4 h-4 ${isAnalyzing ? 'animate-pulse' : ''}`} />
                                  {isAnalyzing ? 'ELIZA analisando...' : 'Pedir Análise da ELIZA'}
                                </button>
                                {(aiAnalysisResponse || isAnalyzing || analysisError) && (
                                  <ElizaPremiumCard 
                                    analysis={aiAnalysisResponse} 
                                    isLoading={isAnalyzing} 
                                    error={analysisError} 
                                    onRetry={diagnoseDiscrepancy} 
                                  />
                                )}

                             </div>
                           )}
                        </div>

                        <div className="flex gap-4">
                           <button onClick={() => setStep(2)} className="flex-1 py-4 border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400">Ajustar Dados</button>
                           <button 
                            onClick={handleSubmit}
                            disabled={loading}
                            className="flex-1 bg-teal-600 text-white py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] shadow-xl shadow-teal-600/20 hover:bg-teal-700 transition-all"
                           >
                            {loading ? 'Sincronizando...' : 'Concluir Fechamento'}
                           </button>
                        </div>
                     </div>
                   )}
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
