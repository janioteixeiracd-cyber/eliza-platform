import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, doc, where, limit, getDocs, setDoc, getDoc } from 'firebase/firestore';

import { db, auth, IS_STUDIO_PREVIEW, logQuery, handleFirestoreError, OperationType } from '../lib/firebase';
import { PatientFinancialQuickView } from './finance/PatientFinancialQuickView';
import { useAuth } from '../contexts/AuthContext';
import { generateCommissionsForEntry } from '../services/financeService';
import { getFinancialDashboardData, repairFinancialDatabase, saveFinancialLog } from '../services/financialDashboardService';
import { 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  Filter, 
  Download, 
  PieChart, 
  TrendingUp,
  Search,
  Plus,
  CheckCircle2,
  Clock,
  ArrowRight,
  Database,
  AlertCircle,
  Trash,
  Edit2,
  FileText,
  Zap,
  Percent,
  Bot,
  Wrench,
  Users,
  MessageSquare,
  Phone,
  Settings,
  AlertTriangle,
  Play,
  RotateCcw,
  CheckSquare,
  Square,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Transaction {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: any;
  status: any;
  date?: any;
  dueDate?: any;
  paymentMethod?: string;
  account?: string;
  importSource?: string;
  importDate?: string;
  paidAmount?: any;
  paid_amount?: any;
  due_date?: any;
  resolvedType?: any;
  patientId?: any;
  patientName?: any;
  raw?: any;
}

// Helper to format a Date object as YYYY-MM-DD in the user's local timezone
const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function FinancialView({ onSelectPatient }: { onSelectPatient?: (patientId: string) => void } = {}) {
  const { clinic, user, profile } = useAuth();
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('daily_routine');
  
  // States for PatientFinancialQuickView
  const [selectedQuickViewPatientId, setSelectedQuickViewPatientId] = useState<string | null>(null);

  const handleOpenQuickView = (patientId: string, patientName?: string) => {
    console.log('[PATIENT_FINANCIAL_QUICK_VIEW_OPEN]', { patientId, patientName });
    setSelectedQuickViewPatientId(null); // Clear first to force re-mount and trigger load
    setTimeout(() => {
      setSelectedQuickViewPatientId(patientId);
    }, 50);
  };
  
  // New States for Central Financeira
  const [payables, setPayables] = useState<any[]>([]);
  const [dbCommissions, setDbCommissions] = useState<any[]>([]);
  const [finSearch, setFinSearch] = useState('');
  const [checkedTasks, setCheckedTasks] = useState<string[]>([]);
  const [cfoReport, setCfoReport] = useState<string>('');
  const [cfoLoading, setCfoLoading] = useState<boolean>(false);
  
  // Custom Filter & Wizard States
  const [filterType, setFilterType] = useState<'all' | 'recebimento' | 'despesa' | 'salario' | 'comissao'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all');
  const [filterCollaborator, setFilterCollaborator] = useState<string>('all');
  const [filterPatient, setFilterPatient] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterCaixa, setFilterCaixa] = useState<string>('all');

  const [addFormStep, setAddFormStep] = useState<'select' | 'form'>('select');
  const [chosenAddType, setChosenAddType] = useState<'recebimento' | 'despesa' | 'salario' | 'comissao' | 'transferencia' | null>(null);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [importedEntries, setImportedEntries] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [duplicateEntriesList, setDuplicateEntriesList] = useState<any[]>([]);
  const [duplicateScanStatus, setDuplicateScanStatus] = useState<string>('');
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<string | null>(null);

  const [dashboardData, setDashboardData] = useState<any>(null);
  const [isDiagnoseOpen, setIsDiagnoseOpen] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [selectedReceiptTransaction, setSelectedReceiptTransaction] = useState<any>(null);
  const [receiptForm, setReceiptForm] = useState({
    amountPaidNow: 0,
    paymentMethod: 'PIX',
    paymentDate: getLocalDateString()
  });
  const [receiptSplits, setReceiptSplits] = useState<Array<{ method: string, amount: number }>>([{ method: 'PIX', amount: 0 }]);

  const [editingTransaction, setEditingTransaction] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    description: '',
    category: 'Geral',
    amount: 0,
    type: 'income' as 'income' | 'expense',
    status: 'paid' as 'paid' | 'pending' | 'partial',
    paymentMethod: 'PIX',
    date: ''
  });

  const [transactionToConfirmEdit, setTransactionToConfirmEdit] = useState<any | null>(null);
  const [financialLogs, setFinancialLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid || profile?.uid === clinic?.ownerId;
  const isNina = profile?.name?.toLowerCase().includes('nina') || profile?.email?.toLowerCase().includes('nina') || user?.displayName?.toLowerCase().includes('nina') || user?.email?.toLowerCase().includes('nina');
  const currentStaffMember = staff.find(s => s.id === user?.uid);
  const canModify = isAdmin || isNina || (clinic as any)?.allowStaffEditFinancial === true || currentStaffMember?.allowFinancialModify === true;

  const scanForDuplicates = async () => {
    if (!clinic) return;
    setDuplicateScanStatus('cleaning');
    setIsProcessing(true);
    try {
      const snap = await getDocs(collection(db, 'clinics', clinic.id, 'financial_entries'));
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      const groups: Record<string, any[]> = {};
      entries.forEach(entry => {
        const patientId = entry.patientId || entry.patient_id;
        const qId = entry.quotationId || entry.quotation_id;
        const instNum = entry.installmentNumber || entry.installment_number;
        const amount = Number(entry.amount) || entry.value || 0;
        
        if (patientId && qId && instNum && amount) {
          const key = `${patientId}_${qId}_${instNum}_${amount}`;
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(entry);
        }
      });

      const duplicatesFound: any[] = [];
      let totalDups = 0;

      Object.entries(groups).forEach(([key, groupList]) => {
        if (groupList.length > 1) {
          const sorted = [...groupList].sort((a, b) => {
            const aMethod = (a.paymentMethod || a.payment_method || '').toUpperCase();
            const bMethod = (b.paymentMethod || b.payment_method || '').toUpperCase();
            
            const aIsSystem = aMethod === 'SISTEMA' || aMethod === 'SISTEM' || aMethod === 'SYSTEM' || !aMethod;
            const bIsSystem = bMethod === 'SISTEMA' || bMethod === 'SISTEM' || bMethod === 'SYSTEM' || !bMethod;

            if (aIsSystem && !bIsSystem) return 1;
            if (!aIsSystem && bIsSystem) return -1;
            
            if (a.status === 'paid' && b.status !== 'paid') return -1;
            if (b.status === 'paid' && a.status !== 'paid') return 1;

            return 0;
          });

          const bestEntry = sorted[0];
          const remainingDuplicates = sorted.slice(1);

          duplicatesFound.push({
            key,
            best: bestEntry,
            duplicates: remainingDuplicates
          });

          totalDups += remainingDuplicates.length;
        }
      });

      setDuplicateEntriesList(duplicatesFound);
      setDuplicateScanStatus(`Análise de duplicados finalizada. Encontrados ${duplicatesFound.length} grupos com ${totalDups} registros duplicados.`);
    } catch (err: any) {
      console.error("[SCAN_DUPLICATES_ERROR]", err);
      setDuplicateScanStatus('Erro ao analisar duplicados: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const removeDuplicatesFromFinance = async () => {
    if (!clinic || duplicateEntriesList.length === 0) return;
    setIsProcessing(true);
    setDuplicateScanStatus('Removendo duplicados...');
    try {
      let count = 0;
      for (const group of duplicateEntriesList) {
        for (const dup of group.duplicates) {
          await deleteDoc(doc(db, 'clinics', clinic.id, 'financial_entries', dup.id));
          count++;
        }
      }
      setDuplicateEntriesList([]);
      setDuplicateScanStatus(`Sucesso! ${count} registros duplicados de orçamento foram removidos.`);
      alert(`${count} registros duplicados de orçamento foram removidos com sucesso!`);
    } catch (err: any) {
      console.error("[CLEAN_DUPLICATES_ERROR]", err);
      setDuplicateScanStatus('Erro ao remover duplicados: ' + err.message);
      alert('Erro ao remover duplicados: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRepairDatabase = async () => {
    if (!clinic) return;
    setIsRepairing(true);
    setRepairResult(null);
    try {
      const res = await repairFinancialDatabase(clinic.id, {
        uid: user?.uid || 'unknown',
        email: user?.email || '',
        name: user?.displayName || 'Equipe'
      });
      setRepairResult(`Banco de dados financeiro reparado com sucesso!
      - ${res.repairedCount} lançamentos normatizados e auditados.
      - ${res.archivedCount} registros vazios ou rompidos arquivados.
      - ${res.duplicatesRemoved} registros duplicados de orçamentos removidos.`);
      alert("Manutenção concluída com sucesso!");
    } catch (err: any) {
      console.error("[REPAIR_DB_ERROR]", err);
      setRepairResult("Erro ao rodar manutenção: " + err.message);
    } finally {
      setIsRepairing(false);
    }
  };

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('month');
  const [dateMode, setDateMode] = useState<'payment' | 'due'>('payment');
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [newTransaction, setNewTransaction] = useState({
    description: '',
    category: 'Geral',
    amount: 0,
    type: 'income' as 'income' | 'expense',
    status: 'paid' as 'paid' | 'pending',
    patientId: '',
    patientName: '',
    sale_responsible_id: '',
    collection_responsible_id: '',
    procedure_responsible_id: '',
    entryType: 'recebimento' as 'recebimento' | 'despesa' | 'salario' | 'comissao' | 'transferencia',
    fornecedor: '',
    centroCusto: '',
    installmentNumber: null as number | null,
    totalInstallments: null as number | null,
    caixa: 'Caixa Geral',
    paymentMethod: 'PIX',
    dueDate: getLocalDateString(),
    date: getLocalDateString(),
    collaboratorId: '',
    collaboratorName: '',
    collaboratorRole: '',
    competence: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    producedValue: 0,
    commissionPercentage: 30,
    isPlanningComplete: true,
    isEvolutionComplete: true,
    isTreatmentLinked: true,
    isCorrectFinancial: true,
  });

  // Register global listener for financial sidebar quick view
  useEffect(() => {
    const handleOpenQuickViewEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.patientId) {
        handleOpenQuickView(customEvent.detail.patientId);
      }
    };
    window.addEventListener('open-patient-financial-quickview', handleOpenQuickViewEvent);
    return () => {
      window.removeEventListener('open-patient-financial-quickview', handleOpenQuickViewEvent);
    };
  }, []);

  // Fetch audit logs of financial changes
  useEffect(() => {
    if (activeTab === 'audit' && clinic?.id) {
      setIsLoadingLogs(true);
      const logsRef = collection(db, 'clinics', clinic.id, 'financial_logs');
      getDocs(logsRef)
        .then((snap) => {
          const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          list.sort((a: any, b: any) => {
            const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return dateB - dateA;
          });
          setFinancialLogs(list);
        })
        .catch(err => {
          console.error("Error fetching financial logs:", err);
        })
        .finally(() => {
          setIsLoadingLogs(false);
        });
    }
  }, [activeTab, clinic?.id]);

  useEffect(() => {
    if (!clinic) {
      console.log("[ELIZA] financial wait state: clinic not yet loaded");
      return;
    }

    console.log("[ELIZA] entering financial bootstrap");
    setIsDashboardLoading(true);

    const fetchDashboard = async () => {
      try {
        const data = await getFinancialDashboardData({
          clinicId: clinic.id,
          mode: dateMode,
          period: dateFilter,
          customRange
        });
        setDashboardData(data);
        if (data.filteredTransactions) {
          setTransactions(data.filteredTransactions.map(t => t.raw));
        }
      } catch (err) {
        console.error("[FINANCE_FETCH_ERROR]", err);
      } finally {
        setIsDashboardLoading(false);
      }
    };

    fetchDashboard();

    // Set up real-time listener for clinical financial_entries
    const unsubImp = onSnapshot(collection(db, 'clinics', clinic.id, 'financial_entries'), () => {
      fetchDashboard();
    }, (err) => {
      console.error("[FINANCE_SNAPSHOT_ERROR]", err);
      if (err.message?.includes('Quota exceeded') || (err as any).code === 'resource-exhausted') {
        setQuotaExceeded(true);
      }
    });

    const unsubPayables = onSnapshot(collection(db, 'clinics', clinic.id, 'clinic_payables'), (snap) => {
      setPayables(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      fetchDashboard();
    }, (err) => {
      console.error("[FINANCE_PAYABLES_SNAPSHOT_ERROR]", err);
    });

    const unsubCommissions = onSnapshot(collection(db, 'clinics', clinic.id, 'commissions'), (snap) => {
      setDbCommissions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("[FINANCE_COMMISSIONS_SNAPSHOT_ERROR]", err);
    });

    // Equipe
    console.log(`[ELIZA] loading team_members for ${clinic.id}...`);
    const qt = query(collection(db, 'clinics', clinic.id, 'team_members'), limit(100));
    const unsubStaff = onSnapshot(qt, (snap) => {
      console.log(`[ELIZA] team_members loaded: ${snap.size} docs`);
      if (!snap.empty) {
        setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else {
        const pathMembers = `clinics/${clinic.id}/members`;
        const qm = query(collection(db, 'clinics', clinic.id, 'members'), limit(50));
        onSnapshot(qm, (mSnap) => {
          setStaff(mSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
      }
    });

    // Pacientes
    console.log(`[ELIZA] loading patients list for finance...`);
    const qp = query(collection(db, 'clinics', clinic.id, 'patients'), limit(100));
    const unsubPatients = onSnapshot(qp, (snap) => {
      setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { 
      console.log("[ELIZA] exiting financial bootstrap (unmounting listeners)");
      unsubStaff(); unsubPatients(); unsubImp(); unsubPayables(); unsubCommissions();
    };
  }, [clinic, dateFilter, dateMode, customRange]);

  const handleAddTransaction = async () => {
    if (!newTransaction.description || !newTransaction.amount || !clinic) return;
    try {
      const isIncome = newTransaction.type === 'income';
      const entryData = {
        description: newTransaction.description,
        amount: Number(newTransaction.amount),
        value: Number(newTransaction.amount),
        category: newTransaction.category || 'Geral',
        type: isIncome ? 'receita' : 'despesa',
        status: newTransaction.status === 'paid' ? 'pago' : 'pendente',
        patient_id: newTransaction.patientId || null,
        patientId: newTransaction.patientId || null,
        patient_name: newTransaction.patientName || null,
        patientName: newTransaction.patientName || null,
        sale_responsible_id: newTransaction.sale_responsible_id || null,
        collection_responsible_id: newTransaction.collection_responsible_id || null,
        procedure_responsible_id: newTransaction.procedure_responsible_id || null,
        
        caixa_utilizado: newTransaction.caixa || 'Caixa Geral',
        caixa: newTransaction.caixa || 'Caixa Geral',
        paymentMethod: newTransaction.paymentMethod || 'PIX',
        payment_method: newTransaction.paymentMethod || 'PIX',
        receivedBy: isIncome ? (user?.uid || 'system') : null,
        receivedByName: isIncome ? (user?.displayName || 'Equipe') : null,
        paidBy: !isIncome ? (user?.uid || 'system') : null,
        paidByName: !isIncome ? (user?.displayName || 'Financeiro') : null,
        fornecedor: newTransaction.fornecedor || null,
        centroCusto: newTransaction.centroCusto || null,
        
        date: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        due_date: new Date().toISOString(),
        competence_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        createdAt: serverTimestamp(),
        created_at: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updated_at: serverTimestamp(),
        createdBy: user?.uid || 'system'
      };

      const docRef = await addDoc(collection(db, 'clinics', clinic.id, 'financial_entries'), entryData);

      if (newTransaction.type === 'income' && newTransaction.status === 'paid') {
        await generateCommissionsForEntry(clinic.id, { id: docRef.id, ...entryData, amount: newTransaction.amount, type: 'receita', status: 'pago' });
      }

      setIsAddModalOpen(false);
      setNewTransaction({ 
        description: '',
        category: 'Geral',
        amount: 0,
        type: 'income',
        status: 'paid',
        patientId: '',
        patientName: '',
        sale_responsible_id: '',
        collection_responsible_id: '',
        procedure_responsible_id: '',
        entryType: 'recebimento',
        fornecedor: '',
        centroCusto: '',
        installmentNumber: null,
        totalInstallments: null,
        caixa: 'Caixa Geral',
        paymentMethod: 'PIX',
        dueDate: getLocalDateString(),
        date: getLocalDateString(),
        collaboratorId: '',
        collaboratorName: '',
        collaboratorRole: '',
        competence: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        producedValue: 0,
        commissionPercentage: 30,
        isPlanningComplete: true,
        isEvolutionComplete: true,
        isTreatmentLinked: true,
        isCorrectFinancial: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/financial_entries`);
    }
  };

  const handleTriggerReceive = (t: any) => {
    setSelectedReceiptTransaction(t);
    const initialAmount = Number(t.pendingAmount ?? t.amount ?? 0);
    setReceiptForm({
      amountPaidNow: initialAmount,
      paymentMethod: 'PIX',
      paymentDate: getLocalDateString()
    });
    setReceiptSplits([{ method: 'PIX', amount: initialAmount }]);
    setIsReceiptModalOpen(true);
  };

  const handleConfirmDashboardReceipt = async () => {
    if (!clinic || !selectedReceiptTransaction) return;
    try {
      const t = selectedReceiptTransaction;
      const amountPaidNow = Number(receiptForm.amountPaidNow);
      
      const prevPayAmount = Number(t.raw.paidAmount || t.raw.paid_amount || 0);
      const totalAmount = Number(t.amount || t.raw.value || 0);
      
      const newPaidAmount = prevPayAmount + amountPaidNow;
      const newRemainingAmount = Math.max(0, totalAmount - newPaidAmount);
      const newStatus = newRemainingAmount <= 0 ? 'paid' : 'partial';

      const entryRef = doc(db, 'clinics', clinic.id, 'financial_entries', t.id);
      
      const receivedByUserId = user?.uid || '';
      const receivedByUserName = user?.displayName || 'Equipe';

      // Join split payment methods into a string for the main property
      const uniqueMethods = Array.from(new Set(receiptSplits.filter(s => s.amount > 0).map(s => s.method)));
      const methodStr = uniqueMethods.join(', ') || receiptForm.paymentMethod;

      const updatePayload: any = {
        status: newStatus,
        paidAmount: newPaidAmount,
        paid_amount: newPaidAmount,
        pendingAmount: newRemainingAmount,
        remainingAmount: newRemainingAmount,
        remaining_amount: newRemainingAmount,
        paidAt: serverTimestamp(),
        paymentMethod: methodStr,
        payment_method: methodStr,
        receivedBy: receivedByUserId,
        receivedByName: receivedByUserName,
        updatedAt: serverTimestamp(),
        updated_at: serverTimestamp(),
        splits: receiptSplits
      };

      await updateDoc(entryRef, updatePayload);

      // Log transaction receive action
      await saveFinancialLog(clinic.id, {
        uid: user?.uid || 'unknown',
        email: user?.email || '',
        name: user?.displayName || 'Equipe'
      }, 'receive', t.id, t.raw, updatePayload);

      // Generating commission proportionate to the payment made now:
      if (amountPaidNow > 0) {
        // Prepare split payment info so that the commission service has details
        await generateCommissionsForEntry(clinic.id, { 
          id: t.id, 
          ...t.raw, 
          amount: amountPaidNow, 
          type: 'receita', 
          status: newStatus,
          splits: receiptSplits,
          paymentMethod: methodStr,
          payment_method: methodStr
        });
      }

      setIsReceiptModalOpen(false);
      setSelectedReceiptTransaction(null);
      alert('Lançamento atualizado com sucesso!');
    } catch (err) {
      console.error("[RECEIPT_SUBMIT_ERROR]", err);
      alert('Erro ao atualizar lançamento: ' + (err as Error).message);
    }
  };

  const handleDeleteTransaction = async (id: string, entryData: any) => {
    if (!clinic) return;
    
    if (!canModify) {
      alert("Você não tem permissão para apagar dados financeiros nesta clínica.");
      return;
    }

    if (!window.confirm("Deseja realmente apagar este lançamento de forma permanente e irreversível?")) {
      return;
    }

    try {
      // Create financial log first
      await saveFinancialLog(clinic.id, {
        uid: user?.uid || 'unknown',
        email: user?.email || '',
        name: user?.displayName || 'Equipe'
      }, 'delete', id, entryData, null);

      const isPayable = (entryData?.source === 'payables') || (entryData?.raw?.source === 'payables');
      const colName = isPayable ? 'clinic_payables' : 'financial_entries';

      await deleteDoc(doc(db, 'clinics', clinic.id, colName, id));
      alert("Lançamento excluído com sucesso do ERP.");
    } catch (err: any) {
      console.error("[DELETE_TRANSACTION_ERROR]", err);
      alert("Erro ao excluir lançamento: " + err.message);
    }
  };

  const handleStartEditTransaction = (t: any) => {
    if (!canModify) {
      alert("Você não tem permissão para editar dados financeiros.");
      return;
    }
    setEditingTransaction(t);
    let dateStr = "";
    if (t.date) {
      if (typeof t.date === 'string' && t.date.includes('-') && t.date.split('-')[0].length === 4 && t.date.length >= 10) {
        dateStr = t.date.substring(0, 10);
      } else {
        const d = t.date instanceof Date ? t.date : (typeof t.date.toDate === 'function' ? t.date.toDate() : new Date(t.date));
        dateStr = getLocalDateString(d);
      }
    } else {
      dateStr = getLocalDateString();
    }
    setEditForm({
      description: t.description || '',
      category: t.category || 'Geral',
      amount: Number(t.amount || 0),
      type: t.type === 'income' ? 'income' : 'expense',
      status: t.status || 'paid',
      paymentMethod: t.paymentMethod || 'PIX',
      date: dateStr
    });
  };

  const handleSaveEditTransaction = async () => {
    if (!clinic || !editingTransaction) return;
    
    // Determining real id
    const realId = editingTransaction.id || 
                   editingTransaction.raw?.id || 
                   editingTransaction.raw?.entry_id || 
                   editingTransaction.raw?.financialEntryId;

    console.log("[FINANCIAL_EDIT_START]", { id: realId, info: editingTransaction });
    console.log("[FINANCIAL_DOC_ID]", realId);

    const isPayable = editingTransaction.source === 'payables' || editingTransaction.raw?.source === 'payables';
    const colName = isPayable ? 'clinic_payables' : 'financial_entries';
    const docRef = doc(db, 'clinics', clinic.id, colName, realId);

    try {
      const snapshot = await getDoc(docRef);
      const docExists = snapshot.exists();
      console.log("[FINANCIAL_DOC_EXISTS]", docExists);

      const amountVal = Number(editForm.amount);
      const isPaid = editForm.status === 'paid';

      let updatedFields: any = {};
      
      if (isPayable) {
        updatedFields = {
          description: editForm.description,
          category: editForm.category,
          amount: amountVal,
          status: isPaid ? 'paid' : ((editForm.status as string) === 'cancelled' || (editForm.status as string) === 'canceled' ? 'canceled' : 'open'),
          due_date: new Date(editForm.date).toISOString().substring(0, 10),
          paid_at: isPaid ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
          updated_at: serverTimestamp()
        };
      } else {
        updatedFields = {
          description: editForm.description,
          category: editForm.category,
          amount: amountVal,
          value: amountVal,
          type: editForm.type === 'income' ? 'receita' : 'despesa',
          status: editForm.status === 'paid' ? 'pago' : editForm.status === 'partial' ? 'parcial' : 'pendente',
          paymentMethod: editForm.paymentMethod,
          payment_method: editForm.paymentMethod,
          date: new Date(editForm.date).toISOString().substring(0, 10),
          dueDate: new Date(editForm.date).toISOString().substring(0, 10),
          due_date: new Date(editForm.date).toISOString().substring(0, 10),
          paidAmount: isPaid ? amountVal : (editingTransaction.raw?.paidAmount || 0),
          paid_amount: isPaid ? amountVal : (editingTransaction.raw?.paidAmount || 0),
          paymentDate: isPaid ? new Date(editForm.date).toISOString().substring(0, 10) : null,
          payment_date: isPaid ? new Date(editForm.date).toISOString().substring(0, 10) : null,
          paidAt: isPaid ? new Date(editForm.date).toISOString().substring(0, 10) : null,
          pendingAmount: isPaid ? 0 : amountVal,
          remainingAmount: isPaid ? 0 : amountVal,
          updatedAt: serverTimestamp(),
          updated_at: serverTimestamp()
        };
      }

      await saveFinancialLog(clinic.id, {
        uid: user?.uid || 'unknown',
        email: user?.email || '',
        name: user?.displayName || 'Equipe'
      }, 'update', realId, editingTransaction.raw, updatedFields);

      if (!docExists) {
        alert("Este lançamento não existe mais ou está inconsistente.");
        const confirmRecreate = window.confirm(
          "Deseja RECRIAR este lançamento com as informações editadas?"
        );
        if (confirmRecreate) {
          const docData = {
            ...editingTransaction.raw,
            ...updatedFields,
            createdAt: serverTimestamp(),
            created_at: serverTimestamp()
          };
          delete docData.resolvedType;
          delete docData.raw;
          
          await setDoc(docRef, docData);
          console.log("[FINANCIAL_UPDATE_SUCCESS]", realId);
          alert("Lançamento recriado com sucesso!");
          setEditingTransaction(null);
          return;
        } else {
          console.log("[FINANCIAL_UPDATE_FAILED] Replay/Recreate cancelled by user.");
          return;
        }
      }

      await updateDoc(docRef, updatedFields);
      console.log("[FINANCIAL_UPDATE_SUCCESS]", realId);

      // Try to synchronise patient financial subcollection paths if available
      const patientId = editingTransaction.patientId || editingTransaction.raw?.patientId || editingTransaction.raw?.patient_id;
      if (patientId && !isPayable) {
        const patientPaths = [
          `clinics/${clinic.id}/patients/${patientId}/financial/${realId}`,
          `patients/${patientId}/financial/${realId}`
        ];
        for (const pPath of patientPaths) {
          try {
            await updateDoc(doc(db, pPath), {
              description: editForm.description,
              category: editForm.category,
              value: amountVal,
              amount: amountVal,
              method: editForm.paymentMethod,
              paymentMethod: editForm.paymentMethod,
              payment_method: editForm.paymentMethod,
              status: editForm.status === 'paid' ? 'received' : editForm.status,
              dueDate: new Date(editForm.date).toISOString().substring(0, 10),
              due_date: new Date(editForm.date).toISOString().substring(0, 10),
              updatedAt: serverTimestamp()
            });
          } catch (e) {
            // ignore if path not found
          }
        }
      }
      
      setEditingTransaction(null);
      alert("Lançamento atualizado com sucesso!");
    } catch (err: any) {
      console.error("[EDIT_TRANSACTION_ERROR]", err);
      console.log("[FINANCIAL_UPDATE_FAILED]", err.message || String(err));
      alert("Erro ao salvar alterações do lançamento: " + err.message);
    }
  };

  const totalIncome = dashboardData?.totalIncome ?? 0;
  const totalExpense = dashboardData?.totalExpense ?? 0;
  const pendingIncome = dashboardData?.pendingIncome ?? 0;
  const balance = dashboardData?.balance ?? 0;
  const unlinkedTotal = dashboardData?.unlinkedTotal ?? 0;
  const filteredData = dashboardData?.filteredTransactions ?? [];
  
  const todayStats = dashboardData?.todayStats ?? { balance: 0, totalIncome: 0, totalExpense: 0, pendingIncome: 0 };
  const monthStats = dashboardData?.monthStats ?? { balance: 0, totalIncome: 0, totalExpense: 0, pendingIncome: 0 };
  const yearStats = dashboardData?.yearStats ?? { balance: 0, totalIncome: 0, totalExpense: 0, pendingIncome: 0 };

  const categoryIncomeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredData
      .filter(t => t.type === 'income' && (t.status === 'paid' || t.status === 'partial'))
      .forEach(t => {
        const cat = t.category || "Geral";
        counts[cat] = (counts[cat] || 0) + (t.paidAmount || t.amount);
      });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filteredData]);

  const categoryExpenseBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredData
      .filter(t => t.type === 'expense' && t.status === 'paid')
      .forEach(t => {
        const cat = t.category || "Geral";
        counts[cat] = (counts[cat] || 0) + t.amount;
      });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filteredData]);

  const showDiagnosisAlert = dashboardData && 
    dashboardData.diagnostics.totalLoadedEntries > 0 && 
    totalIncome === 0 && 
    pendingIncome === 0;

  // Helper function to resolve transaction type
  const getTransactionType = (t: any): 'recebimento' | 'despesa' | 'salario' | 'comissao' | 'transferencia' => {
    if (t.entryType) return t.entryType;
    if (t.raw?.entryType) return t.raw.entryType;
    
    const desc = (t.description || '').toLowerCase();
    const cat = (t.category || '').toLowerCase();
    
    if (cat.includes('salário') || cat.includes('salario') || desc.includes('salário') || desc.includes('salario') || desc.includes('folha de pagamento')) {
      return 'salario';
    }
    if (cat.includes('comissão') || cat.includes('comissao') || desc.includes('comissão') || desc.includes('comissao')) {
      return 'comissao';
    }
    if (t.type === 'expense' || t.raw?.type === 'despesa' || t.type === 'despesa' || t.raw?.type === 'expense') {
      return 'despesa';
    }
    return 'recebimento';
  };

  // Cálculo de Comissões por Critérios do Profissional
  const commissions = useMemo(() => {
    return staff.map(member => {
      const isCommEnabled = member.commissionEnabled ?? member.financial?.commissionEnabled ?? false;
      if (!isCommEnabled) {
        return {
          ...member,
          commissionEnabled: false,
          totalComission: 0,
          totalLiberado: 0,
          totalBloqueado: 0,
          details: []
        };
      }

      const commissionPct = member.commissionPercent ?? member.financial?.commissionPercent ?? member.financial?.commissionPercentage ?? 30;
      let totalLiberado = 0;
      let totalBloqueado = 0;
      const details: any[] = [];

      filteredData.forEach(t => {
        const isResponsible = t.raw?.procedure_responsible_id === member.id || t.raw?.sale_responsible_id === member.id;
        
        if (isResponsible && t.type === 'income' && (t.status === 'paid' || t.status === 'pago')) {
          const itemVal = Number(t.amount || 0);
          const calculatedPct = Number(t.raw?.commissionPercentage || commissionPct);
          const computedCommission = itemVal * (calculatedPct / 100);

          // Requirements check:
          const planningComplete = t.raw?.isPlanningComplete !== false;
          const evolutionComplete = t.raw?.isEvolutionComplete !== false;
          const treatmentLinked = t.raw?.isTreatmentLinked !== false;
          const correctFinancial = t.status === 'paid' || t.status === 'pago';

          const isBlocked = !planningComplete || !evolutionComplete || !treatmentLinked || !correctFinancial;

          if (isBlocked) {
            totalBloqueado += computedCommission;
          } else {
            totalLiberado += computedCommission;
          }

          details.push({
            id: t.id,
            description: t.description,
            patientName: t.patientName || 'Paciente avulso',
            amount: itemVal,
            commission: computedCommission,
            isBlocked,
            planningComplete,
            evolutionComplete,
            treatmentLinked,
            correctFinancial
          });
        }
      });

      return {
        ...member,
        commissionEnabled: true,
        commissionPct,
        totalComission: totalLiberado + totalBloqueado,
        totalLiberado,
        totalBloqueado,
        details
      };
    });
  }, [staff, filteredData]);

  // Dynamic DRE and operational cash flow metrics
  const dreMetrics = useMemo(() => {
    console.log("[FINANCEIRO_TRANSACAO_RENDER] Starting calculation of DRE stats");
    
    let totalEntradas = 0;
    let totalDespesas = 0;
    let totalSalarios = 0;
    let totalComissoes = 0;

    filteredData.forEach((t: any) => {
      const type = getTransactionType(t);
      const isPaid = t.status === 'paid' || t.status === 'pago';
      const amount = Number(t.amount || 0);
      
      if (isPaid) {
        if (type === 'recebimento') {
          totalEntradas += amount;
        } else if (type === 'despesa') {
          totalDespesas += amount;
        } else if (type === 'salario') {
          totalSalarios += amount;
        } else if (type === 'comissao') {
          totalComissoes += amount;
        }
      }
    });

    const saldoLiquido = totalEntradas - (totalDespesas + totalSalarios + totalComissoes);

    return {
      totalEntradas,
      totalDespesas,
      totalSalarios,
      totalComissoes,
      saldoLiquido
    };
  }, [filteredData]);

  // Dynamically filtered state-driven transaction search
  const finalFilteredTransactions = useMemo(() => {
    let result = filteredData.map(t => {
      const rawItem = t.raw || t;
      const resolvedType = getTransactionType(t);
      return {
        ...t,
        raw: rawItem,
        resolvedType
      };
    });

    // 1. Filter by Type
    if (filterType !== 'all') {
      result = result.filter(t => t.resolvedType === filterType);
    }

    // 2. Filter by Status
    if (filterStatus !== 'all') {
      if (filterStatus === 'paid') {
        result = result.filter(t => t.status === 'paid' || t.status === 'pago');
      } else if (filterStatus === 'pending') {
        result = result.filter(t => t.status === 'pending' || t.status === 'pendente' || t.status === 'partial');
      } else if (filterStatus === 'overdue') {
        const todayStr = getLocalDateString();
        result = result.filter(t => {
          const isPaid = t.status === 'paid' || t.status === 'pago';
          const due = t.dueDate ? (typeof t.dueDate === 'string' ? t.dueDate : new Date(t.dueDate).toISOString().substring(0, 10)) : '';
          return !isPaid && due && due < todayStr;
        });
      }
    }

    // 3. Filter by Collaborator
    if (filterCollaborator !== 'all') {
      result = result.filter(t => 
        t.raw?.sale_responsible_id === filterCollaborator ||
        t.raw?.collection_responsible_id === filterCollaborator ||
        t.raw?.procedure_responsible_id === filterCollaborator ||
        t.raw?.receivedBy === filterCollaborator ||
        t.raw?.collaboratorId === filterCollaborator
      );
    }

    // 4. Filter by Patient
    if (filterPatient !== 'all') {
      result = result.filter(t => t.patientId === filterPatient || t.raw?.patientId === filterPatient || t.raw?.patient_id === filterPatient);
    }

    // 5. Filter by Category
    if (filterCategory !== 'all') {
      result = result.filter(t => t.category === filterCategory || t.raw?.category === filterCategory);
    }

    // 6. Filter by Caixa
    if (filterCaixa !== 'all') {
      result = result.filter(t => t.raw?.caixa === filterCaixa || t.raw?.caixa_utilizado === filterCaixa);
    }

    return result;
  }, [filteredData, filterType, filterStatus, filterCollaborator, filterPatient, filterCategory, filterCaixa]);

  const setQuickPeriodRange = (periodKey: 'hoje' | 'ontem' | '7d' | '30d' | 'estemes' | 'mesanterior') => {
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    if (periodKey === 'hoje') {
      setDateFilter('today');
    } else if (periodKey === 'ontem') {
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      const yStr = formatDate(yesterday);
      setCustomRange({ start: yStr, end: yStr });
      setDateFilter('custom');
    } else if (periodKey === '7d') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(today.getDate() - 6);
      setCustomRange({ start: formatDate(sevenDaysAgo), end: formatDate(today) });
      setDateFilter('custom');
    } else if (periodKey === '30d') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 29);
      setCustomRange({ start: formatDate(thirtyDaysAgo), end: formatDate(today) });
      setDateFilter('custom');
    } else if (periodKey === 'estemes') {
      setDateFilter('month');
    } else if (periodKey === 'mesanterior') {
      const prevMonthFirst = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevMonthLast = new Date(today.getFullYear(), today.getMonth(), 0);
      setCustomRange({ start: formatDate(prevMonthFirst), end: formatDate(prevMonthLast) });
      setDateFilter('custom');
    }
  };

  const cleanZeroRecords = async () => {
    if (!clinic || isProcessing) return;
    if (!window.confirm("Essa ação excluirá permanentemente todos os registros com valor R$ 0 do seu banco de dados. Deseja continuar?")) return;
    
    setIsProcessing(true);
    try {
      const { writeBatch, doc } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      const zeroRecords = transactions.filter(t => !t.amount || t.amount <= 0);
      
      if (zeroRecords.length === 0) {
        alert("Nenhum registro zerado encontrado.");
        return;
      }

      zeroRecords.forEach(t => {
        const docRef = doc(db, 'clinics', clinic.id, 'transactions', t.id);
        batch.delete(docRef);
      });

      await batch.commit();
      alert(`${zeroRecords.length} registros zerados foram removidos com sucesso.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/transactions`);
      alert("Erro ao realizar limpeza.");
    } finally {
      setIsProcessing(false);
    }
  };

  const linkPatientsToTransactions = async () => {
    if (!clinic || isProcessing) return;
    setIsProcessing(true);
    try {
      const { writeBatch, doc } = await import('firebase/firestore');
      const batch = writeBatch(db);
      let count = 0;

      const unlinkedIncome = transactions.filter(t => t.type === 'income' && !(t as any).patientId && t.importSource === 'external_system');
      
      unlinkedIncome.forEach(t => {
        const desc = (t.description || '').toLowerCase();
        if (!desc) return;

        const foundPatient = patients.find(p => {
          const pName = (p.name || '').toLowerCase();
          return pName && desc.includes(pName);
        });

        if (foundPatient) {
          const docRef = doc(db, 'clinics', clinic.id, 'transactions', t.id);
          batch.update(docRef, { patientId: foundPatient.id, patientName: foundPatient.name });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        alert(`${count} transações foram vinculadas aos seus respectivos pacientes.`);
      } else {
        alert("Nenhuma correspondência encontrada entre descrições e nomes de pacientes.");
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/transactions`);
      alert("Erro ao vincular pacientes.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- METRICS & HELPERS FOR CENTRAL FINANCEIRA ---
  const todayStr = getLocalDateString(new Date());
  const currentMonthPrefix = todayStr.substring(0, 7); // "YYYY-MM"

  const metrics = useMemo(() => {
    let receivedToday = 0;
    let receivedMonth = 0;
    let totalInadimplencia = 0;
    let totalIncomes = 0;
    let totalExpenses = 0;

    transactions.forEach(t => {
      const isIncome = t.type === 'income' || t.type === 'receita';
      const isPaid = t.status === 'paid' || t.status === 'pago';
      
      const amountVal = Number(t.amount || 0);
      const paidAmount = Number(t.paidAmount || t.paid_amount || 0);

      const rawDate = t.date || t.dueDate || '';
      let dateStr = '';
      if (typeof rawDate === 'string') {
        dateStr = rawDate.substring(0, 10);
      } else if (rawDate && typeof rawDate.toDate === 'function') {
        dateStr = getLocalDateString(rawDate.toDate());
      } else if (rawDate && rawDate.seconds) {
        dateStr = getLocalDateString(new Date(rawDate.seconds * 1000));
      } else {
        dateStr = getLocalDateString();
      }

      if (isIncome) {
        totalIncomes += paidAmount;
        if (isPaid && dateStr === todayStr) {
          receivedToday += paidAmount;
        }
        if (isPaid && dateStr.startsWith(currentMonthPrefix)) {
          receivedMonth += paidAmount;
        }

        const dueDateRaw = t.dueDate || t.due_date || t.date || '';
        let dDateStr = '';
        if (typeof dueDateRaw === 'string') {
          dDateStr = dueDateRaw.substring(0, 10);
        } else if (dueDateRaw && typeof dueDateRaw.toDate === 'function') {
          dDateStr = getLocalDateString(dueDateRaw.toDate());
        } else if (dueDateRaw && dueDateRaw.seconds) {
          dDateStr = getLocalDateString(new Date(dueDateRaw.seconds * 1000));
        }

        const rem = amountVal - paidAmount;
        if (rem > 0 && dDateStr && dDateStr < todayStr && !isPaid) {
          totalInadimplencia += rem;
        }
      } else {
        if (isPaid) {
          totalExpenses += amountVal;
        }
      }
    });

    let payablesToday = 0;
    let payablesOverdue = 0;

    payables.forEach(p => {
      const statusStr = String(p.status || '').toLowerCase();
      const amountVal = Number(p.amount || 0);
      const dueDateStr = p.due_date || '';

      const isOpen = statusStr === 'open' || statusStr === 'overdue' || statusStr === 'pending';

      if (isOpen) {
        if (dueDateStr === todayStr) {
          payablesToday += amountVal;
        }
        if (dueDateStr < todayStr) {
          payablesOverdue += amountVal;
        }
      }
    });

    let pendingCommissionsVal = 0;
    commissions.forEach(c => {
      if (c.status !== 'paid' && c.status !== 'pago') {
        pendingCommissionsVal += Number(c.amount || c.value || 0);
      }
    });

    const saldoCaixa = totalIncomes - totalExpenses;

    return {
      receivedToday,
      receivedMonth,
      payablesToday,
      payablesOverdue,
      totalInadimplencia,
      pendingCommissionsVal,
      saldoCaixa
    };
  }, [transactions, payables, commissions, todayStr, currentMonthPrefix]);

  // AI CFO Eliza Chatbot States
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessages, setAiMessages] = useState<Array<{ sender: 'user' | 'eliza', text: string }>>([
    { sender: 'eliza', text: 'Olá! Sou a ELIZA, sua assistente CFO de Inteligência Financeira. Posso analisar recebimentos, contas vencidas, inadimplências e simular fluxo de caixa. Digite sua pergunta ou clique nas sugestões para começarmos!' }
  ]);

  // Folha e Equipe parameters
  const [editingStaffMember, setEditingStaffMember] = useState<string | null>(null);
  const [staffFixedSalary, setStaffFixedSalary] = useState(0);
  const [staffCommissionPercentage, setStaffCommissionPercentage] = useState(30);
  const [staffPaymentDay, setStaffPaymentDay] = useState(5);
  const [staffBonuses, setStaffBonuses] = useState(0);
  const [staffAwards, setStaffAwards] = useState(0);
  const [savingStaffId, setSavingStaffId] = useState("");

  const handleStartEditStaff = (member: any) => {
    setEditingStaffMember(member.id);
    setStaffFixedSalary(Number(member.fixedSalary || member.salary || 0));
    setStaffCommissionPercentage(Number(member.commissionPercentage || member.commission_percentage || 30));
    setStaffPaymentDay(Number(member.paymentDay || member.payment_day || 5));
    setStaffBonuses(Number(member.bonuses || 0));
    setStaffAwards(Number(member.awards || 0));
  };

  const handleSaveStaffSettings = async (memberId: string) => {
    if (!clinic) return;
    setSavingStaffId(memberId);
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'team_members', memberId), {
        fixedSalary: Number(staffFixedSalary),
        commissionPercentage: Number(staffCommissionPercentage),
        paymentDay: Number(staffPaymentDay),
        bonuses: Number(staffBonuses),
        awards: Number(staffAwards),
        updatedAt: serverTimestamp()
      });
      setEditingStaffMember(null);
      alert("Parâmetros do colaborador salvos com sucesso!");
    } catch (err: any) {
      console.error("[SAVE_STAFF_SETTINGS_ERROR_TM]", err);
      try {
        await updateDoc(doc(db, 'clinics', clinic.id, 'members', memberId), {
          fixedSalary: Number(staffFixedSalary),
          commissionPercentage: Number(staffCommissionPercentage),
          paymentDay: Number(staffPaymentDay),
          bonuses: Number(staffBonuses),
          awards: Number(staffAwards),
          updatedAt: serverTimestamp()
        });
        setEditingStaffMember(null);
        alert("Parâmetros do colaborador salvos com sucesso!");
      } catch (err2: any) {
        alert("Erro ao salvar parâmetros: " + err2.message);
      }
    } finally {
      setSavingStaffId("");
    }
  };

  // Inadimplência CRM States (Negotiations and action registration)
  const [negotiatingReceivable, setNegotiatingReceivable] = useState<any | null>(null);
  const [negotiationNotes, setNegotiationNotes] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [collectionStatus, setCollectionStatus] = useState('contatado');

  const handleSaveNegotiation = async () => {
    if (!clinic || !negotiatingReceivable) return;
    try {
      const entryRef = doc(db, 'clinics', clinic.id, 'financial_entries', negotiatingReceivable.id);
      await updateDoc(entryRef, {
        collection_status: collectionStatus,
        collection_notes: negotiationNotes,
        promise_date: promiseDate || null,
        reprogramming_history: [
          ...(negotiatingReceivable.raw?.reprogramming_history || []),
          {
            date: new Date().toISOString(),
            status: collectionStatus,
            notes: negotiationNotes,
            promise_date: promiseDate || null,
            responsible: user?.displayName || 'Financeiro'
          }
        ],
        updatedAt: serverTimestamp()
      });
      setNegotiatingReceivable(null);
      setNegotiationNotes('');
      setPromiseDate('');
      alert("Negociação registrada com sucesso!");
    } catch (err: any) {
      alert("Erro ao registrar negociação: " + err.message);
    }
  };

  // Chat with AI Virtual CFO Using client-side helper proxy
  const handleSendAiMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || aiInput;
    if (!textToSend.trim() || !clinic) return;

    const userMsg = { sender: 'user' as const, text: textToSend };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiLoading(true);

    try {
      const { getGenAI } = await import('../lib/gemini');
      const ai = getGenAI();

      // Bundle context
      const simpleTransactions = transactions.map(t => ({
        description: t.description,
        amount: t.amount,
        type: t.type,
        status: t.status,
        date: t.date || t.dueDate || ''
      }));

      const simplePayables = payables.map(p => ({
        description: p.description,
        supplier: p.supplier,
        amount: p.amount,
        status: p.status,
        due_date: p.due_date
      }));

      const simpleStaff = staff.map(s => ({
        name: s.name,
        role: s.role,
        fixedSalary: s.fixedSalary || 0,
        commissionPercentage: s.commissionPercentage || 30
      }));

      const systemPrompt = `Você é o CFO Virtual de Inteligência Financeira de nome ELIZA, construído especificamente para gerenciar clínicas médicas e odontológicas com alto nível de excelência operacional.
Você possui acesso em tempo real aos dados financeiros resumidos da clínica abaixo. Responda à dúvida do usuário de forma humilde, polida, clara, altamente profissional e pautada em dados. Prefira apresentar dados formatados em markdown ou listas para facilitar a digestão imediata no celular ou painel da secretária.
NUNCA cite variáveis ou termos internos ocultos. Fale como uma CFO com sólida vivência acadêmica e clínica.

DADOS DA CLÍNICA:
- Nome da Clínica: ${clinic.name || 'Clínica Parceira'}
- Saldo em Caixa Calculado: R$ ${metrics.saldoCaixa.toLocaleString('pt-BR')}
- Recebido Hoje: R$ ${metrics.receivedToday.toLocaleString('pt-BR')}
- Recebido este Mês: R$ ${metrics.receivedMonth.toLocaleString('pt-BR')}
- Contas a Pagar Hoje: R$ ${metrics.payablesToday.toLocaleString('pt-BR')}
- Contas Vencidas em Atraso: R$ ${metrics.payablesOverdue.toLocaleString('pt-BR')}
- Inadimplência de Pacientes Recentes: R$ ${metrics.totalInadimplencia.toLocaleString('pt-BR')}
- Comissões Pendentes Totais: R$ ${metrics.pendingCommissionsVal.toLocaleString('pt-BR')}

Amostra de Lançamentos Recentes: ${JSON.stringify(simpleTransactions.slice(0, 30))}
Amostra de Contas a Pagar: ${JSON.stringify(simplePayables.slice(0, 30))}
Equipe e Parâmetros salariais: ${JSON.stringify(simpleStaff)}`;

      const options = {
        model: 'gemini-2.5-flash',
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nDúvida do Usuário: ${textToSend}` }] }
        ],
        clinicId: clinic.id
      };

      const res = await ai.models.generateContent(options);
      const textResponse = res.text || res.candidates?.[0]?.content?.parts?.[0]?.text || "Desculpe, tive um contratempo para analisar seus relatórios agora.";
      
      setAiMessages(prev => [...prev, { sender: 'eliza', text: textResponse }]);
    } catch (err: any) {
      console.error("[AI_CFO_ERROR]", err);
      setAiMessages(prev => [...prev, { sender: 'eliza', text: "Lamento, não consegui obter o retorno do oráculo financeiro. Certifique-se de que a conexão está activa." }]);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 font-sans overflow-y-auto">
      {quotaExceeded && (
        <div className="mx-8 mt-8 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-rose-900 leading-none">Limite de Uso Excedido (Firestore Quota)</h4>
            <p className="text-[10px] text-rose-700 mt-1 leading-relaxed font-medium">
              O Firestore bloqueou temporariamente novas leituras por limite de cota. Verifique se o projeto está no plano Blaze e reduza consultas sem paginação.
            </p>
          </div>
        </div>
      )}
      
      {IS_STUDIO_PREVIEW && (
        <div className="mx-8 mt-4 p-2 bg-amber-50 border border-amber-100 rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <p className="text-[9px] font-bold text-amber-900 uppercase tracking-widest">Modo Preview: Carregamento limitado a {IS_STUDIO_PREVIEW ? 50 : 100} registros por segurança.</p>
        </div>
      )}
      {/* Header */}
      <header className="px-8 py-3 bg-white border-b border-slate-100 shrink-0 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Central Financeira ELIZA</span>
          </h2>
          <p className="text-[11px] text-slate-500 font-medium font-sans">Fluxo Operacional, Conciliação, Inadimplência e Virtual CFO</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
            <button 
              onClick={() => setDateMode('payment')}
              className={`px-2.5 py-1 rounded-md text-[8.5px] font-bold uppercase tracking-widest transition-all ${
                dateMode === 'payment' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-400'
              }`}
            >
              Pagamento
            </button>
            <button 
              onClick={() => setDateMode('due')}
              className={`px-2.5 py-1 rounded-md text-[8.5px] font-bold uppercase tracking-widest transition-all ${
                dateMode === 'due' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-400'
              }`}
            >
              Vencimento
            </button>
          </div>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
            {(['today', 'week', 'month', 'year', 'custom'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setDateFilter(period)}
                className={`px-2 py-1 rounded-md text-[8.5px] font-bold uppercase tracking-widest transition-all ${
                  dateFilter === period ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {period === 'today' ? 'Hoje' : period === 'week' ? 'Semana' : period === 'month' ? 'Mês' : period === 'year' ? 'Ano' : 'Custom'}
              </button>
            ))}
          </div>

          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold text-[11px] shrink-0 hover:bg-emerald-500 transition-all flex items-center gap-1.5 shadow-xs font-sans"
          >
            <Plus className="w-3 h-3" />
            Lançar Recebimento/Despesa
          </button>
        </div>
      </header>

      {/* Custom Range Picker */}
      {dateFilter === 'custom' && (
        <div className="px-8 py-2 bg-teal-50/20 border-b border-teal-100/50 flex items-center gap-4 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-teal-700 uppercase">Início:</span>
            <input 
              type="date" 
              value={customRange.start}
              onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-teal-700 uppercase">Fim:</span>
            <input 
              type="date" 
              value={customRange.end}
              onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs outline-none"
            />
          </div>
        </div>
      )}

      {/* 7 KPI Bento Panel for Central Financeira */}
      <div className="px-8 py-2 grid grid-cols-2 lg:grid-cols-7 gap-2 bg-white border-b border-slate-100 shrink-0">
        {[
          { label: 'Saldo Caixa', val: metrics.saldoCaixa, color: metrics.saldoCaixa >= 0 ? 'text-emerald-600' : 'text-rose-600', bg: 'bg-emerald-50/10' },
          { label: 'Recebido Hoje', val: metrics.receivedToday, color: 'text-emerald-700', bg: 'bg-emerald-50/30' },
          { label: 'Recebido Mês', val: metrics.receivedMonth, color: 'text-slate-800', bg: 'bg-slate-50' },
          { label: 'Pagar Hoje', val: metrics.payablesToday, color: 'text-amber-600', bg: 'bg-amber-50/20' },
          { label: 'Contas Vencidas', val: metrics.payablesOverdue, color: 'text-rose-600', bg: 'bg-rose-50/20' },
          { label: 'Inadimplência CRM', val: metrics.totalInadimplencia, color: 'text-pink-600', bg: 'bg-pink-50/10' },
          { label: 'Comissão Aberta', val: metrics.pendingCommissionsVal, color: 'text-indigo-600', bg: 'bg-indigo-50/10' },
        ].map((item, idx) => (
          <div key={idx} className={`${item.bg} p-1.5 px-2.5 rounded-lg border border-slate-100 space-y-0.5`}>
            <p className="text-[8.5px] text-slate-400 font-bold tracking-wide uppercase font-sans leading-none">{item.label}</p>
            <p className={`font-mono text-[11px] font-black leading-tight ${item.color}`}>R$ {item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        ))}
      </div>

      {/* Tab Selector Bar */}
      <div className="px-8 py-2 bg-slate-50 border-b border-slate-200 shrink-0 flex gap-1.5 overflow-x-auto">
        {[
          { id: 'daily_routine', label: 'Rotina do Dia', icon: Zap },
          { id: 'recebimentos', label: 'Recebimentos', icon: ArrowUpRight },
          { id: 'despesas', label: 'Despesas', icon: ArrowDownRight },
          { id: 'contas_pagar', label: 'Contas a Pagar ERP', icon: Calendar },
          { id: 'inadimplencia', label: 'Inadimplência CRM', icon: AlertCircle },
          { id: 'comissoes', label: 'Comissões', icon: Percent },
          { id: 'folha_equipe', label: 'Folha e Colaboradores', icon: Users },
          { id: 'ia_financeira', label: 'CFO Inteligência IA', icon: Bot },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shrink-0 transition-all font-sans ${
              activeTab === t.id ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content Scroller */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {showDiagnosisAlert && (
          <div className="mx-8 mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 animate-pulse" />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-amber-950">Aviso de Diagnóstico</p>
                <p className="text-[10px] text-amber-800 leading-relaxed font-semibold">
                  Foram encontrados lançamentos, mas os totais estão zerados. Os campos financeiros precisam ser normalizados.
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsDiagnoseOpen(true)}
              className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider shadow-sm shrink-0"
            >
              Exibir Diagnóstico
            </button>
          </div>
        )}

        {/* Main Content Area Container */}
        <div className="p-8 flex-1 flex flex-col min-h-0">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
            {activeTab === 'daily_routine' && (
              <div className="flex-1 flex flex-col p-8 space-y-8 bg-slate-50/30 overflow-y-auto min-h-[500px]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1 text-left">
                    <h4 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <Zap className="w-5 h-5 text-amber-500 animate-pulse" /> Central de Rotina Diária ELIZA
                    </h4>
                    <p className="text-xs text-slate-500 font-medium">
                      Checklist interativo e visual concebido para secretárias e gestores controlarem a solidez diária da clínica.
                    </p>
                  </div>
                  <div className="bg-white px-5 py-3 rounded-2xl border border-slate-200 flex items-center gap-4 shadow-sm shrink-0">
                    <div className="text-left">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Conclusão da Rotina</p>
                      <p className="text-xs font-black text-slate-800">
                        {checkedTasks.length} de 6 Atividades ({Math.round((checkedTasks.length / 6) * 100)}%)
                      </p>
                    </div>
                    <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full transition-all duration-305" style={{ width: `${(checkedTasks.length / 6) * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Checklist Card */}
                  <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm text-left font-sans">
                    <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Controle Operacional Prioritário</h5>
                    <div className="space-y-4">
                      {[
                        { id: 't1', label: 'Fechamento de Caixa PIX & POS', desc: 'Validar os extratos bancários das adquirentes de cartões e contas da clínica.' },
                        { id: 't2', label: 'Liberação de Comissões Médicas', desc: 'Conferir se procedimentos finalizados possuem prontuário e evolução corretos.' },
                        { id: 't3', label: 'Cobrança Ativa de Inadimplentes', desc: 'Acionar pacientes com atrasos vigentes no painel de contas a receber via WhatsApp.' },
                        { id: 't4', label: 'Dar Baixa em Contas a Pagar', desc: 'Quitar os compromissos agendados para hoje dentro do controle ERP.' },
                        { id: 't5', label: 'Análise Tributária e Notas Fiscais', desc: 'Garantir que as notas de clínicas parceiras e fornecedores foram anexadas.' },
                        { id: 't6', label: 'Filtro Estratégico com CFO Virtual', desc: 'Auditar o parecer de saúde financeira gerado pela inteligência artificial.' },
                      ].map(task => {
                        const isChecked = checkedTasks.includes(task.id);
                        return (
                          <div
                            key={task.id}
                            onClick={() => {
                              if (isChecked) {
                                setCheckedTasks(checkedTasks.filter(id => id !== task.id));
                              } else {
                                setCheckedTasks([...checkedTasks, task.id]);
                              }
                            }}
                            className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-4 ${
                              isChecked ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-150 hover:bg-slate-50/50'
                            }`}
                          >
                            <div className="mt-0.5 text-teal-600">
                              {isChecked ? <CheckCircle2 className="w-4 h-4 fill-teal-100" /> : <Clock className="w-4 h-4 text-slate-300" />}
                            </div>
                            <div>
                              <p className={`text-xs font-bold ${isChecked ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                {task.label}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-1 font-semibold">{task.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sidebar metrics & controls */}
                  <div className="space-y-6 text-left">
                    <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-xl relative overflow-hidden flex flex-col justify-between h-48">
                      <div>
                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Saldo do Consultório</p>
                        <h3 className="text-3xl font-black mt-2">R$ {dreMetrics.saldoLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                      </div>
                      <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Margem Operacional Líquida Posicionada</p>
                    </div>

                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm text-left">
                      <h5 className="font-bold text-xs text-slate-400 uppercase tracking-widest mb-4">Ação Rápida no Caixa</h5>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => {
                            setChosenAddType('recebimento');
                            setAddFormStep('form');
                            setIsAddModalOpen(true);
                          }}
                          className="p-4 bg-teal-50 hover:bg-teal-100 border border-teal-105 text-teal-850 rounded-xl transition-all font-bold text-[10px] uppercase text-center flex flex-col items-center justify-center gap-2 shadow-sm"
                        >
                          <ArrowUpRight className="w-6 h-6 text-teal-600" />
                          <span>Entrada (+)</span>
                        </button>
                        <button
                          onClick={() => {
                            setChosenAddType('despesa');
                            setAddFormStep('form');
                            setIsAddModalOpen(true);
                          }}
                          className="p-4 bg-rose-50 hover:bg-rose-100 border border-rose-105 text-rose-850 rounded-xl transition-all font-bold text-[10px] uppercase text-center flex flex-col items-center justify-center gap-2 shadow-sm"
                        >
                          <ArrowDownRight className="w-6 h-6 text-rose-600" />
                          <span>Saída (-)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'recebimentos' && (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50/25">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h4 className="text-xs font-black text-slate-705 uppercase tracking-widest pl-1">Listagem de Recebimentos e Atendimentos</h4>
                  <button
                    onClick={() => {
                      setChosenAddType('recebimento');
                      setAddFormStep('form');
                      setIsAddModalOpen(true);
                    }}
                    className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-teal-500/10"
                  >
                    <Plus className="w-3.5 h-3.5" /> Novo Recebimento
                  </button>
                </div>
                <div className="p-8 flex-1 overflow-y-auto space-y-6">
                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50/50">
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                          <th className="p-5">Data / Liberação</th>
                          <th className="p-5">Paciente / Procedimento</th>
                          <th className="p-5">Categoria</th>
                          <th className="p-5">Meio de Pgto</th>
                          <th className="p-5 text-right font-black">Valor</th>
                          <th className="p-5">Status</th>
                          <th className="p-5 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {finalFilteredTransactions.filter(t => t.type === 'income' || t.resolvedType === 'recebimento').map(t => (
                          <tr key={t.id} className="hover:bg-slate-50/30 text-xs text-slate-750">
                            <td className="p-5 font-bold">
                              {t.date ? new Date(t.date).toLocaleDateString('pt-BR') : '---'}
                            </td>
                            <td className="p-5 text-left">
                              {t.patientId ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenQuickView(t.patientId)}
                                  className="font-bold text-slate-905 hover:text-emerald-650 hover:underline transition-colors focus:outline-none text-left cursor-pointer inline-block"
                                >
                                  {t.patientName || 'Avulso'}
                                </button>
                              ) : (
                                <p className="font-bold text-slate-905">{t.patientName || 'Avulso'}</p>
                              )}
                              <p className="text-[10px] text-slate-450 mt-1 font-semibold">{t.description}</p>
                            </td>
                            <td className="p-5">
                              <span className="bg-slate-100 px-2 py-0.5 rounded-md font-bold uppercase text-[9px]">{t.category || 'Geral'}</span>
                            </td>
                            <td className="p-5 font-medium">{t.paymentMethod || 'PIX'}</td>
                            <td className="p-5 font-bold text-right text-emerald-600">R$ {Number(t.amount || 0).toLocaleString()}</td>
                            <td className="p-5">
                              <span className={`font-bold border rounded-lg px-2.5 py-1 text-[9px] uppercase tracking-wide ${
                                t.status === 'paid' || t.status === 'pago' ? 'bg-emerald-50 text-emerald-700 border-emerald-150' : 'bg-amber-50 text-amber-700 border-amber-150'
                              }`}>{t.status === 'paid' || t.status === 'pago' ? 'Pago' : 'Pendente'}</span>
                            </td>
                            <td className="p-5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setTransactionToConfirmEdit(t)}
                                  className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-all cursor-pointer"
                                  title="Editar Faturamento"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTransaction(t.id, t.raw)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                  title="Excluir Lançamento"
                                >
                                  <Trash className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {finalFilteredTransactions.filter(t => t.type === 'income' || t.resolvedType === 'recebimento').length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-20 text-center text-slate-350 italic">Nenhum recebimento registrado no período selecionado.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'despesas' && (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50/25">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h4 className="text-xs font-black text-slate-705 uppercase tracking-widest pl-1">Fluxo de Despesas e Custos Clínicos</h4>
                  <button
                    onClick={() => {
                      setChosenAddType('despesa');
                      setAddFormStep('form');
                      setIsAddModalOpen(true);
                    }}
                    className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-rose-500/10"
                  >
                    <Plus className="w-3.5 h-3.5" /> Nova Despesa
                  </button>
                </div>
                <div className="p-8 flex-1 overflow-y-auto space-y-6">
                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50/50">
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                          <th className="p-5">Data Pagamento</th>
                          <th className="p-5">Fornecedor / Descrição</th>
                          <th className="p-5">Categoria</th>
                          <th className="p-5">Meio de Pgto</th>
                          <th className="p-5 text-right font-black">Valor</th>
                          <th className="p-5">Status</th>
                          <th className="p-5 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {finalFilteredTransactions.filter(t => t.type === 'expense' || t.resolvedType === 'despesa').map(t => (
                          <tr key={t.id} className="hover:bg-slate-50/30 text-xs text-slate-750">
                            <td className="p-5 font-bold">
                              {t.date ? new Date(t.date).toLocaleDateString('pt-BR') : '---'}
                            </td>
                            <td className="p-5 text-left">
                              <p className="font-bold text-slate-905">{t.description}</p>
                              {t.raw?.fornecedor && <p className="text-[8px] text-slate-400 mt-1 uppercase">Para: {t.raw.fornecedor}</p>}
                            </td>
                            <td className="p-5">
                              <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md font-bold uppercase text-[9px]">{t.category || 'Geral'}</span>
                            </td>
                            <td className="p-5 font-medium">{t.paymentMethod || 'Dinheiro'}</td>
                            <td className="p-5 font-bold text-right text-rose-605">R$ {Number(t.amount || 0).toLocaleString()}</td>
                            <td className="p-5">
                              <span className={`font-bold border rounded-lg px-2.5 py-1 text-[9px] uppercase tracking-wide ${
                                t.status === 'paid' || t.status === 'pago' ? 'bg-emerald-50 text-emerald-700 border-emerald-150' : 'bg-amber-50 text-amber-700 border-amber-150'
                              }`}>{t.status === 'paid' || t.status === 'pago' ? 'Pago' : 'Pendente'}</span>
                            </td>
                            <td className="p-5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setTransactionToConfirmEdit(t)}
                                  className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-all cursor-pointer"
                                  title="Editar Lançamento"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTransaction(t.id, t.raw)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                  title="Excluir Lançamento"
                                >
                                  <Trash className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {finalFilteredTransactions.filter(t => t.type === 'expense' || t.resolvedType === 'despesa').length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-20 text-center text-slate-350 italic">Nenhuma despesa ou custo registrado no período selecionado.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'contas_pagar' && (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50/25">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h4 className="text-xs font-black text-slate-705 uppercase tracking-widest pl-1">ERP Clínico - Contas a Pagar & Despesas</h4>
                  <button
                    onClick={() => {
                      setChosenAddType('despesa');
                      setAddFormStep('form');
                      setIsAddModalOpen(true);
                    }}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Programar Pagamento
                  </button>
                </div>
                <div className="p-8 space-y-6 flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-6 rounded-3xl border border-rose-100 shadow-sm relative overflow-hidden text-left">
                      <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest">Saídas Pendentes / A Pagar</p>
                      <h3 className="text-2xl font-bold text-rose-650 mt-2">
                        R$ {finalFilteredTransactions.filter(t => t.type === 'expense' && (t.status === 'pending' || t.status === 'pendente')).reduce((acc, t) => acc + Number(t.amount || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </h3>
                      <p className="text-[9.5px] text-slate-400 mt-1 uppercase">Compromissos agendados em aberto</p>
                    </div>

                    <div className="bg-white p-6 rounded-3xl border border-teal-100 shadow-sm relative overflow-hidden text-left">
                      <p className="text-[8px] font-black text-teal-650 uppercase tracking-widest">Saídas Quitadas / Pagas</p>
                      <h3 className="text-2xl font-bold text-teal-650 mt-2">
                        R$ {finalFilteredTransactions.filter(t => t.type === 'expense' && (t.status === 'paid' || t.status === 'pago')).reduce((acc, t) => acc + Number(t.amount || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </h3>
                      <p className="text-[9.5px] text-slate-400 mt-1 uppercase">Deduções operacionais realizadas no período</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50/50">
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                          <th className="p-5">Vencimento</th>
                          <th className="p-5">Descrição / Fornecedor</th>
                          <th className="p-5">Categoria</th>
                          <th className="p-5 text-right font-black">Valor</th>
                          <th className="p-5">Status</th>
                          <th className="p-5 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {finalFilteredTransactions.filter(t => t.type === 'expense' && (t.status === 'pending' || t.status === 'pendente')).map(t => (
                          <tr key={t.id} className="hover:bg-slate-50/30 text-xs text-slate-755">
                            <td className="p-5 font-bold">
                              {t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-BR') : '---'}
                            </td>
                            <td className="p-5 text-left">
                              <p className="font-bold text-slate-900">{t.description}</p>
                              {t.raw?.fornecedor && <p className="text-[8px] text-slate-405 uppercase mt-1 text-left">Fornecedor: {t.raw.fornecedor}</p>}
                            </td>
                            <td className="p-5">
                              <span className="bg-slate-100 px-2 py-0.5 rounded-md font-bold uppercase text-[9px]">{t.category || 'Geral'}</span>
                            </td>
                            <td className="p-5 font-bold text-right text-rose-605">R$ {Number(t.amount || 0).toLocaleString()}</td>
                            <td className="p-5">
                              <span className="bg-amber-50 text-amber-700 font-bold border border-amber-150 rounded-lg px-2.5 py-1 text-[9px] uppercase tracking-wide">Pendente</span>
                            </td>
                            <td className="p-5 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={async () => {
                                    if (!clinic) return;
                                    try {
                                      const ref = doc(db, 'clinics', clinic.id, 'financial_entries', t.id);
                                      await updateDoc(ref, {
                                        status: 'paid',
                                        paymentDate: getLocalDateString(),
                                        paidAmount: Number(t.amount)
                                      });
                                      alert('Contas a Pagar: Baixa realizada com sucesso!');
                                    } catch (err: any) {
                                      alert('Erro ao dar baixa: ' + err.message);
                                    }
                                  }}
                                  className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-500/15 cursor-pointer"
                                >
                                  Dar Baixa
                                </button>
                                <button
                                  onClick={() => setTransactionToConfirmEdit(t)}
                                  className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-slate-55 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                                  title="Editar Lançamento"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTransaction(t.id, t.raw)}
                                  className="p-1.5 text-slate-400 hover:text-rose-650 hover:bg-rose-55 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                                  title="Excluir Lançamento"
                                >
                                  <Trash className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {finalFilteredTransactions.filter(t => t.type === 'expense' && (t.status === 'pending' || t.status === 'pendente')).length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-20 text-center text-slate-350 italic">Nenhum compromisso a pagar em aberto no período!</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'inadimplencia' && (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50/25">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 text-left">
                  <div>
                    <h4 className="text-xs font-black text-slate-705 uppercase tracking-widest pl-1">Painel CRM - Contas a Receber & Cobrança</h4>
                    <p className="text-[10px] text-slate-405 font-bold mt-1 uppercase pl-1">Acione pacientes inadimplentes ativamente com mensagens formatadas.</p>
                  </div>
                </div>
                <div className="p-8 space-y-6 flex-1 overflow-y-auto">
                  <div className="bg-white rounded-3xl border border-slate-205 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50/50">
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                          <th className="p-5">Data de Lançamento</th>
                          <th className="p-5">Paciente</th>
                          <th className="p-5">Procedimento / Motivo</th>
                          <th className="p-5 text-right font-black">Valor Aberto</th>
                          <th className="p-5">Status</th>
                          <th className="p-5 text-center">Contato</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {finalFilteredTransactions.filter(t => t.type === 'income' && (t.status === 'pending' || t.status === 'pendente' || t.status === 'partial')).map(t => {
                          const patientData = patients.find(p => p.id === t.patientId || p.id === t.raw?.patientId);
                          const phoneNum = patientData?.phone || t.raw?.patientPhone || '';
                          return (
                            <tr key={t.id} className="hover:bg-slate-50/30 text-xs text-slate-750">
                              <td className="p-5 font-bold">
                                {t.date ? new Date(t.date).toLocaleDateString('pt-BR') : '---'}
                              </td>
                              <td className="p-5 text-left">
                                {t.patientId ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenQuickView(t.patientId)}
                                    className="font-bold text-slate-900 hover:text-emerald-650 hover:underline transition-colors focus:outline-none text-left cursor-pointer inline-block"
                                  >
                                    {t.patientName || 'Avulso'}
                                  </button>
                                ) : (
                                  <span className="font-bold text-slate-900">{t.patientName || 'Avulso'}</span>
                                )}
                              </td>
                              <td className="p-5 text-left">
                                <p className="font-semibold">{t.description}</p>
                              </td>
                              <td className="p-5 font-bold text-right text-rose-500">R$ {Number(t.amount || 0).toLocaleString()}</td>
                              <td className="p-5">
                                <span className="bg-rose-50 text-rose-700 font-bold border border-rose-150 rounded-lg px-2.5 py-1 text-[9px] uppercase tracking-wide">Pendente</span>
                              </td>
                              <td className="p-5 text-center">
                                <button
                                  onClick={() => {
                                    // WhatsApp Cobra format
                                    let cleanPhone = phoneNum.replace(/\D/g, "");
                                    if (cleanPhone.length >= 10 && cleanPhone.length <= 11 && !cleanPhone.startsWith("55")) {
                                      cleanPhone = "55" + cleanPhone;
                                    }
                                    const rawMsg = `Olá, ${t.patientName || 'Paciente'}! Passando para lembrar que consta pendente no caixa o valor de R$ ${Number(t.amount || 0).toLocaleString('pt-BR')} referente à "${t.description}". Qualquer dúvida no pagamento, estamos por aqui!`;
                                    const encoded = encodeURIComponent(rawMsg);
                                    window.open(`https://wa.me/${cleanPhone || '55'}?text=${encoded}`, '_blank');
                                  }}
                                  className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 mx-auto shadow-md cursor-pointer"
                                >
                                  <Phone className="w-3 h-3" /> Cobrar no WhatsApp
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {finalFilteredTransactions.filter(t => t.type === 'income' && (t.status === 'pending' || t.status === 'pendente' || t.status === 'partial')).length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-20 text-center text-slate-350 italic text-xs">Parabéns! Inadimplência do caixa monitorada é igual a zero no período!</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'comissoes' && (
              <div className="flex-1 flex flex-col min-h-[400px] bg-slate-50/25">
                <div className="p-6 border-b border-slate-100 bg-teal-50/50 shrink-0 text-left">
                  <h4 className="text-xs font-black text-teal-800 uppercase tracking-[0.2em] pl-1">Cálculo de Comissões - Equipe Clínica</h4>
                </div>
                <div className="p-8 space-y-6 flex-1 overflow-y-auto text-left">
                  {commissions.length > 0 ? (
                    commissions.map((c: any) => (
                      <div key={c.id} className="p-6 bg-white border border-slate-200 rounded-[2rem] shadow-sm flex items-center justify-between group hover:border-teal-200 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-500 uppercase">
                            {c.name ? c.name.substring(0, 2) : 'CL'}
                          </div>
                          <div>
                            <h5 className="font-bold text-slate-900">{c.name}</h5>
                            <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">{c.role || 'Clínico'} • {c.commissionPct}% de comissão base</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">A Receber</p>
                          <h6 className="text-xl font-black text-teal-650">R$ {(c.totalLiberado || 0).toLocaleString()}</h6>
                          {c.totalBloqueado > 0 && <p className="text-[9px] text-rose-500 font-bold uppercase mt-1">{c.totalBloqueado.toLocaleString()} Bloqueados</p>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-20 text-center text-slate-400 italic text-xs">Cadastre sua equipe clínica em "Configurações" para gerenciar comissões.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'folha_equipe' && (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50/25">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 text-left">
                  <div>
                    <h4 className="text-xs font-black text-slate-705 uppercase tracking-widest pl-1">Folha de Faturamento e Colaboradores</h4>
                    <p className="text-[10px] text-slate-405 font-bold mt-1 uppercase pl-1">Monitore salários bases e efetue os acertos de despesas ordinárias no caixa.</p>
                  </div>
                </div>
                <div className="p-8 space-y-6 flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {staff.map((member: any) => {
                      const baseSalary = Number(member.baseSalary || member.salary || 1500);
                      return (
                        <div key={member.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-between text-left h-52">
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="px-2.5 py-1 bg-slate-100 rounded-lg text-[9px] font-black uppercase text-slate-500">{member.role || 'Colaborador'}</span>
                              <Users className="w-4 h-4 text-slate-350" />
                            </div>
                            <h5 className="font-extrabold text-sm text-slate-900 mt-4">{member.name || member.email}</h5>
                            <p className="text-[10px] text-slate-400 mt-1 font-bold font-mono">Salário-Base: R$ {baseSalary.toLocaleString()}</p>
                          </div>
                          
                          <button
                            onClick={async () => {
                              if (!clinic) return;
                              try {
                                await addDoc(collection(db, 'clinics', clinic.id, 'financial_entries'), {
                                  description: `Folha de Pagamento: ${member.name || member.email}`,
                                  category: 'Salários',
                                  amount: baseSalary,
                                  value: baseSalary,
                                  type: 'expense',
                                  status: 'paid',
                                  date: getLocalDateString(),
                                  dueDate: getLocalDateString(),
                                  due_date: getLocalDateString(),
                                  createdAt: serverTimestamp(),
                                  created_at: serverTimestamp(),
                                  updatedAt: serverTimestamp(),
                                  updated_at: serverTimestamp(),
                                  createdBy: user?.uid || 'system'
                                });
                                alert(`Salário-Base de ${member.name || 'colaborador'} pago e lançado com sucesso no caixa!`);
                              } catch (err: any) {
                                alert("Falha ao registrar acerto no financeiro: " + err.message);
                              }
                            }}
                            className="w-full py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all select-none text-center cursor-pointer"
                          >
                            Pagar Salário-Base
                          </button>
                        </div>
                      );
                    })}
                    {staff.length === 0 && (
                      <div className="col-span-full py-20 text-center text-slate-350 italic">Cadastre membros de sua equipe clínica para gerenciar salários.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ia_financeira' && (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-900 text-white">
                <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0 text-left">
                  <div>
                    <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest pl-1">CFO Inteligência IA — Parecer do Consultório</h4>
                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase pl-1">Consulte diagnósticos econômicos e táticos baseados nos fluxos de caixa reais.</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!clinic) {
                        alert('Clínica não resolvida.');
                        return;
                      }
                      setCfoLoading(true);
                      setCfoReport('');
                      try {
                        const promptText = `Aja como o CFO Virtual Clínico de alta performance da ELIZA.
Temos os seguintes dados financeiros reais computados para o período analisado na clínica "${clinic.name || 'Clínica HOF'}":
- Receitas Totais Liquidadas: R$ ${dreMetrics.totalEntradas.toLocaleString('pt-BR')}
- Despesas Totais Liquidadas: R$ ${dreMetrics.totalDespesas.toLocaleString('pt-BR')}
- Folha de Pagamentos: R$ ${dreMetrics.totalSalarios.toLocaleString('pt-BR')}
- Comissões Clinicas: R$ ${dreMetrics.totalComissoes.toLocaleString('pt-BR')}
- Saldo Líquido Operacional em Caixa do Período: R$ ${dreMetrics.saldoLiquido.toLocaleString('pt-BR')}

Elabore um parecer tático de CFO com os seguintes tópicos estruturados em português do Brasil de forma extremamente polida e profissional:
1. ANÁLISE GERAL DO BALANÇO E MARGEM
2. DIAGNÓSTICO DE INADIPLÊNCIA E FLUXO A RECEBER
3. RECOMENDAÇÃO TÁTICA E ECONÔMICA (dizer em até 3 pontos o que a clínica e secretária devem fazer para elevar a lucratividade)`;

                        const response = await fetch('/api/ai/generateContent', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            contents: promptText,
                            taskType: 'resumo_financeiro',
                            clinicId: clinic.id,
                            model: 'gemini-3.5-flash'
                          })
                        });

                        const resData = await response.json();
                        if (resData?.text) {
                          setCfoReport(resData.text);
                        } else {
                          setCfoReport('A ELIZA AI não retornou relatório válido. Verifique as configurações de chave.');
                        }
                      } catch (err: any) {
                        setCfoReport('Falha ao acionar IA da ELIZA: ' + err.message);
                      } finally {
                        setCfoLoading(false);
                      }
                    }}
                    disabled={cfoLoading}
                    className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-emerald-500/10 cursor-pointer"
                  >
                    <Bot className="w-4 h-4" /> {cfoLoading ? 'Analisando Caixa...' : 'Gerar Parecer CFO IA'}
                  </button>
                </div>
                
                <div className="p-8 flex-1 overflow-y-auto space-y-6 text-left">
                  {cfoLoading ? (
                    <div className="py-24 flex flex-col items-center justify-center space-y-4">
                      <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest animate-pulse">ELIZA Auditando Lançamentos...</p>
                    </div>
                  ) : cfoReport ? (
                    <div className="bg-slate-850 p-8 rounded-[2rem] border border-white/5 space-y-6 leading-relaxed text-sm text-slate-300">
                      <div className="border-b border-white/5 pb-4 flex items-center justify-between">
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 font-bold text-[9px] uppercase rounded-md">Relatório Pronto</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(cfoReport);
                            alert('CFO Virtual: Parecer copiado para a área de transferência!');
                          }}
                          className="text-[10px] text-slate-400 uppercase font-black tracking-widest hover:text-emerald-400 transition-all border-b border-dashed border-slate-400 focus:outline-none cursor-pointer"
                        >
                          Copiar Parecer
                        </button>
                      </div>
                      <div className="whitespace-pre-wrap font-sans space-y-4">
                        {cfoReport}
                      </div>
                    </div>
                  ) : (
                    <div className="py-24 text-center max-w-md mx-auto space-y-4">
                      <Bot className="w-12 h-12 text-emerald-400 mx-auto animate-bounce" />
                      <h5 className="font-bold text-slate-100">CFO Inteligência IA</h5>
                      <p className="text-xs text-slate-400 font-medium leading-relaxed">
                        Pronto para compilar as movimentações de entradas, salários e contas cadastradas para realizar seu diagnóstico financeiro mensal de consultório. Clique no botão acima para acionar.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'transactions' && (
              <>
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <Search className="w-4 h-4 text-slate-300" />
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2 flex-1">Listagem de Movimentações ({finalFilteredTransactions.length})</h4>
                </div>

                {/* Filtros Bento - Separados lógica e visualmente */}
                <div className="p-6 bg-slate-50/50 border-b border-slate-150 flex flex-col gap-4">
                  {/* Filtro Principal por Tipo */}
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { key: 'all', label: 'Todas Transações', color: 'bg-slate-900 border-slate-950 text-white', inactive: 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200' },
                      { key: 'recebimento', label: 'Recebimentos', color: 'bg-teal-600 border-teal-750 text-white shadow-md shadow-teal-600/10', inactive: 'bg-white text-teal-600 border-teal-150 hover:bg-teal-50/30' },
                      { key: 'despesa', label: 'Despesas / Gastos', color: 'bg-rose-600 border-rose-750 text-white shadow-md shadow-rose-600/10', inactive: 'bg-white text-rose-600 border-rose-150 hover:bg-rose-50/30' },
                      { key: 'salario', label: 'Salários', color: 'bg-violet-600 border-violet-750 text-white shadow-md shadow-violet-600/10', inactive: 'bg-white text-violet-600 border-violet-150 hover:bg-violet-50/30' },
                      { key: 'comissao', label: 'Comissões', color: 'bg-indigo-600 border-indigo-750 text-white shadow-md shadow-indigo-600/10', inactive: 'bg-white text-indigo-600 border-indigo-150 hover:bg-indigo-50/30' }
                    ].map(typeOpt => (
                      <button
                        key={typeOpt.key}
                        onClick={() => setFilterType(typeOpt.key as any)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                          filterType === typeOpt.key ? typeOpt.color : typeOpt.inactive
                        }`}
                      >
                        {typeOpt.label}
                      </button>
                    ))}
                  </div>

                  {/* Filtros Secundários de Seleção */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Status</span>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 outline-none focus:border-teal-600 cursor-pointer"
                      >
                        <option value="all">Todos os Status</option>
                        <option value="paid">Pago / Baixado</option>
                        <option value="pending">Pendentes</option>
                        <option value="overdue">Atrasados</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Profissional</span>
                      <select
                        value={filterCollaborator}
                        onChange={(e) => setFilterCollaborator(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 outline-none focus:border-teal-600 cursor-pointer"
                      >
                        <option value="all">Todos Profissionais</option>
                        {staff.map(s => (
                          <option key={s.id} value={s.id}>{s.name || s.email}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Paciente</span>
                      <select
                        value={filterPatient}
                        onChange={(e) => setFilterPatient(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 outline-none focus:border-teal-600 cursor-pointer"
                      >
                        <option value="all">Todos Pacientes</option>
                        {patients.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Categoria</span>
                      <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 outline-none focus:border-teal-600 cursor-pointer"
                      >
                        <option value="all">Todas as Categorias</option>
                        {Array.from(new Set(filteredData.map(t => (t.category || 'Geral') as string))).map((c: string) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Conta / Caixa</span>
                      <select
                        value={filterCaixa}
                        onChange={(e) => setFilterCaixa(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 outline-none focus:border-teal-600 cursor-pointer"
                      >
                        <option value="all">Todos os Caixas</option>
                        {Array.from(new Set(filteredData.map(t => (t.raw?.caixa || t.raw?.caixa_utilizado || 'Caixa Geral') as string))).map((c: string) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50/50">
                      <tr>
                        <th className="p-6 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Data / Baixa</th>
                        <th className="p-6 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Informações Principais</th>
                        <th className="p-6 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Detalhamento Financeiro</th>
                        <th className="p-6 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Valor</th>
                        <th className="p-6 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                        <th className="p-6 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {finalFilteredTransactions.length > 0 ? (
                        finalFilteredTransactions.map(t => {
                          const type = t.resolvedType;
                          const isPaid = t.status === 'paid' || t.status === 'pago';

                          return (
                            <tr key={t.id} className="hover:bg-slate-50/30 transition-colors">
                              {/* 1. DATA */}
                              <td className="p-6">
                                <p className="text-[10px] font-bold text-slate-900 leading-none">
                                  {t.date ? (t.date instanceof Date ? t.date.toLocaleDateString('pt-BR') : new Date(t.date).toLocaleDateString('pt-BR')) : '---'}
                                </p>
                                {t.dueDate && (
                                  <p className="text-[8px] text-slate-400 mt-1 uppercase">
                                    Venc: {t.dueDate instanceof Date ? t.dueDate.toLocaleDateString('pt-BR') : new Date(t.dueDate).toLocaleDateString('pt-BR')}
                                  </p>
                                )}
                              </td>

                              {/* 2. INFORMAÇÕES PRINCIPAIS (Visuais e customizadas por tipo) */}
                              <td className="p-6 max-w-sm">
                                {type === 'recebimento' && (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <span className="text-[7.5px] font-black text-teal-750 bg-teal-50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Recebimento</span>
                                    </div>
                                    {t.patientId ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleOpenQuickView(t.patientId);
                                        }}
                                        className="text-left font-black text-teal-600 hover:text-teal-705 hover:underline transition-colors block text-sm focus:outline-none cursor-pointer"
                                        id={`btn-patient-link-${t.id}`}
                                      >
                                        Paciente: {t.patientName || 'Paciente sem nome'}
                                      </button>
                                    ) : (
                                      <span className="text-left font-black text-slate-800 block text-sm">
                                        Paciente: {t.patientName || 'Avulso / Sem paciente'}
                                      </span>
                                    )}
                                    <p className="text-xs text-slate-600 font-bold mt-1">
                                      Procedimento: <span className="text-slate-800 font-extrabold">{t.raw?.procedureName || t.raw?.procedure_name || t.raw?.procedure || t.description || 'Não especificado'}</span>
                                    </p>
                                    {((t.installmentNumber ?? t.raw?.installmentNumber) !== null && (t.installmentNumber ?? t.raw?.installmentNumber) !== undefined) && (
                                      <p className="text-[9px] text-slate-500 font-bold mt-1.5 uppercase tracking-wide bg-slate-50 border border-slate-200/50 rounded-md px-1.5 py-0.5 w-fit">
                                        Parcela {t.installmentNumber ?? t.raw?.installmentNumber}{(t.totalInstallments ?? t.raw?.totalInstallments) ? `/${t.totalInstallments ?? t.raw?.totalInstallments}` : ''} — Plano {t.description && t.description !== (t.raw?.procedureName || t.raw?.procedure_name) ? `(${t.description})` : ''}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {type === 'despesa' && (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <span className="text-[7.5px] font-black text-rose-650 bg-rose-50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Despesa / Gasto</span>
                                    </div>
                                    <h5 className="text-sm font-black text-slate-800 leading-tight">{t.description || 'Gasto operacional'}</h5>
                                    <div className="flex flex-wrap gap-2 items-center mt-1">
                                      <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-500 uppercase tracking-tighter">{t.category || 'Geral'}</span>
                                      {t.raw?.fornecedor && (
                                        <span className="text-[10px] font-medium text-slate-500">Fornecedor: <strong>{t.raw.fornecedor}</strong></span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {type === 'salario' && (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <span className="text-[7.5px] font-black text-violet-650 bg-violet-50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Salário</span>
                                    </div>
                                    <h5 className="text-sm font-black text-slate-800 leading-tight">
                                      Colaborador: {t.raw?.collaboratorName || staff.find(s => s.id === t.raw?.collaboratorId)?.name || t.description || 'Equipe'}
                                    </h5>
                                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase">
                                      Período Competência: {t.raw?.competence || 'Mensal'}
                                    </p>
                                  </div>
                                )}

                                {type === 'comissao' && (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <span className="text-[7.5px] font-black text-indigo-650 bg-indigo-50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Comissão</span>
                                    </div>
                                    <h5 className="text-sm font-black text-slate-800 leading-tight">
                                      Colaborador: {t.raw?.collaboratorName || staff.find(s => s.id === t.raw?.collaboratorId)?.name || t.description || 'Equipe'}
                                    </h5>
                                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase">
                                      Período Competência: {t.raw?.competence || 'Mensal'}
                                    </p>
                                  </div>
                                )}

                                {type === 'transferencia' && (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <span className="text-[7.5px] font-black text-amber-650 bg-amber-50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Transferência</span>
                                    </div>
                                    <h5 className="text-sm font-black text-slate-800 leading-tight">{t.description}</h5>
                                    <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase">
                                      Movimentação interna entre caixas
                                    </p>
                                  </div>
                                )}

                                <p className="text-[8px] text-slate-400 mt-2 font-medium flex items-center gap-1">
                                  <Database className="w-2 h-2" /> {t.importSource ? `Importado: ${t.importSource}` : 'Sistema'}
                                </p>
                              </td>

                              {/* 3. DETALHAMENTO FINANCEIRO */}
                              <td className="p-6">
                                <div className="space-y-1 font-bold text-[10px] text-slate-500 uppercase tracking-wider bg-slate-50 border border-slate-200/50 p-2 rounded-xl w-fit min-w-[155px]">
                                  {type === 'recebimento' && (
                                    <>
                                      <p className="text-emerald-800 font-black">Recebido por: <span className="text-teal-700">{t.raw?.receivedByName || staff.find(s => s.id === t.raw?.receivedBy)?.name || 'Equipe'}</span></p>
                                      <p className="text-[9px]">Forma: <span className="text-slate-700">{t.paymentMethod || '---'}</span></p>
                                      <p className="text-[9px]">Caixa: <span className="text-slate-700">{t.raw?.caixa_utilizado || t.raw?.caixa || 'Caixa Geral'}</span></p>
                                    </>
                                  )}

                                  {type === 'despesa' && (
                                    <>
                                      <p className="text-rose-800 font-black">Pago por: <span className="text-rose-705">{t.raw?.paidByName || staff.find(s => s.id === t.raw?.paidBy)?.name || 'Financeiro'}</span></p>
                                      <p className="text-[9px]">Forma: <span className="text-slate-700">{t.paymentMethod || '---'}</span></p>
                                      <p className="text-[9px]">Caixa: <span className="text-slate-700">{t.raw?.caixa_utilizado || t.raw?.caixa || 'Caixa Geral'}</span></p>
                                    </>
                                  )}

                                  {type === 'salario' && (
                                    <>
                                      <p className="text-violet-850 font-black">Cargo: <span className="text-violet-750">{t.raw?.collaboratorRole || 'Colaborador'}</span></p>
                                      <p className="text-[9px]">Forma: <span className="text-slate-700">{t.paymentMethod || '---'}</span></p>
                                      <p className="text-[9px]">Caixa: <span className="text-slate-700">{t.raw?.caixa_utilizado || t.raw?.caixa || 'Caixa Geral'}</span></p>
                                    </>
                                  )}

                                  {type === 'comissao' && (
                                    <>
                                      <p className="text-indigo-850 font-black">Cargo: <span className="text-indigo-750">{t.raw?.collaboratorRole || 'Clínico'}</span></p>
                                      <p className="text-[9px]">Forma: <span className="text-slate-700">{t.paymentMethod || '---'}</span></p>
                                      <p className="text-[9px]">Caixa: <span className="text-slate-700">{t.raw?.caixa_utilizado || t.raw?.caixa || 'Caixa Geral'}</span></p>
                                    </>
                                  )}

                                  {type === 'transferencia' && (
                                    <>
                                      <p className="text-amber-850 font-black">Origem: <span className="text-amber-700">{t.raw?.caixa_origem || 'Caixa Geral'}</span></p>
                                      <p className="text-[9px]">Destino: <span className="text-amber-700">{t.raw?.caixa_destino || 'Conta Corrente'}</span></p>
                                    </>
                                  )}

                                  <p className="text-[9px] text-slate-400 mt-1">Data baixa: <span className="text-slate-700">{
                                    t.raw?.paidAt 
                                      ? (t.raw.paidAt.toDate ? t.raw.paidAt.toDate().toLocaleDateString('pt-BR') : new Date(t.raw.paidAt).toLocaleDateString('pt-BR'))
                                      : (t.date ? (t.date instanceof Date ? t.date.toLocaleDateString('pt-BR') : new Date(t.date).toLocaleDateString('pt-BR')) : '---')
                                  }</span></p>
                                </div>
                              </td>

                              {/* 4. VALOR CARD */}
                              <td className={`p-6 text-sm font-bold ${t.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {t.type === 'income' ? '+' : '-'} R$ {(t.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>

                              {/* 5. STATUS PILL */}
                              <td className="p-6">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${isPaid ? 'bg-emerald-500' : t.status === 'partial' ? 'bg-blue-400' : 'bg-amber-400'}`} />
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    {isPaid ? 'Pago' : t.status === 'partial' ? 'Parcial' : 'Pendente'}
                                  </span>
                                </div>
                              </td>

                              {/* 6. AÇÕES */}
                              <td className="p-6 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  {!isPaid ? (
                                    <button
                                      onClick={() => handleTriggerReceive(t)}
                                      className="bg-teal-600 hover:bg-teal-700 text-white px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all shadow-sm whitespace-nowrap cursor-pointer"
                                    >
                                      {t.type === 'income' ? 'Receber' : 'Pagar'}
                                    </button>
                                  ) : (
                                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider bg-emerald-50 px-2 py-1 rounded-md">Baixada</span>
                                  )}

                                  <button
                                    onClick={() => setTransactionToConfirmEdit(t)}
                                    className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-all cursor-pointer"
                                    title="Editar Lançamento"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTransaction(t.id, t.raw)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                    title="Excluir Lançamento"
                                  >
                                    <Trash className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-20 text-center text-slate-400 text-xs italic">Nenhuma transação cadastrada ou correspondente aos filtros.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeTab === 'unlinked' && (
              <div className="flex-1 flex flex-col">
                <div className="p-8 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-amber-900">Receitas sem Vínculo</h4>
                    <p className="text-[10px] text-amber-700 font-medium">Lançamentos importados que necessitam ser associados a um paciente.</p>
                  </div>
                  <div className="bg-amber-100 px-4 py-2 rounded-2xl">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">Total Pendente</p>
                    <p className="text-lg font-bold text-amber-900">R$ {unlinkedTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</th>
                        <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Descrição</th>
                        <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Valor</th>
                        <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importedEntries.filter(e => !e.patient_id && e.type === 'receita').map(e => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="p-6 text-[10px] font-bold text-slate-500">{new Date(e.date).toLocaleDateString()}</td>
                          <td className="p-6">
                            <p className="text-xs font-bold text-slate-900">{e.description}</p>
                            <p className="text-[8px] text-slate-400 uppercase mt-1">Origem: {e.payment_method}</p>
                          </td>
                          <td className="p-6 text-sm font-bold text-right text-slate-900">R$ {e.amount.toLocaleString()}</td>
                          <td className="p-6">
                            <button 
                              onClick={() => {
                                const patientId = prompt("Digite o ID do paciente para vincular:");
                                if (patientId) {
                                  let pName = "Paciente";
                                  const found = patients.find(p => p.id === patientId || p.patient_id === patientId);
                                  if (found) pName = found.name;
                                  
                                  const path = `clinics/${clinic!.id}/financial_entries/${e.id}`;
                                  updateDoc(doc(db, 'clinics', clinic!.id, 'financial_entries', e.id), {
                                    patient_id: patientId,
                                    patient_name: pName,
                                    needs_review: false,
                                    review_status: 'linked'
                                  }).then(() => alert("Vinculado com sucesso!"))
                                    .catch(err => handleFirestoreError(err, OperationType.UPDATE, path));
                                }
                              }}
                              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest"
                            >
                              Vincular
                            </button>
                          </td>
                        </tr>
                      ))}
                      {importedEntries.filter(e => !e.patient_id && e.type === 'receita').length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-20 text-center text-slate-300 text-xs font-bold uppercase">Nenhuma receita sem vínculo</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {activeTab === 'fluxodecaixa' && (
              <div className="p-8 space-y-8 flex-1 bg-slate-50/45 text-left">
                {/* Header Explaining DRE Case */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse" />
                      <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                        DRE Sintética e Demonstração de Fluxo de Caixa
                      </h4>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                      Relatório consolidado de competência ou caixa, analisando receitas, despesas operacionais ordinárias, salários fáceis e comissões clínicas liberadas para o período ativo.
                    </p>
                  </div>

                  {/* Filtros rápidos de período */}
                  <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-2xl self-start md:self-auto shrink-0">
                    {[
                      { key: 'hoje', label: 'Hoje' },
                      { key: 'ontem', label: 'Ontem' },
                      { key: '7d', label: '7 Dias' },
                      { key: '30d', label: '30 Dias' },
                      { key: 'estemes', label: 'Este Mês' },
                      { key: 'mesanterior', label: 'Mês Ant.' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setQuickPeriodRange(opt.key as any)}
                        className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 hover:bg-white/50 transition-all cursor-pointer"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resumo Geral Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {/* Card 1: Entradas */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total de Recebimentos</p>
                      <span className="p-1 px-2 text-[8px] bg-emerald-50 text-emerald-800 rounded-md font-bold uppercase">Entradas</span>
                    </div>
                    <h3 className="text-xl font-bold text-emerald-650 tracking-tight mt-3">R$ {dreMetrics.totalEntradas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                    <p className="text-[9.5px] text-slate-400 font-bold mt-1 uppercase">Baixado no período</p>
                  </div>

                  {/* Card 2: Despesas */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Despesas Corporativas</p>
                      <span className="p-1 px-2 text-[8px] bg-rose-50 text-rose-800 rounded-md font-bold uppercase">Saídas</span>
                    </div>
                    <h3 className="text-xl font-bold text-rose-600 tracking-tight mt-3">R$ {dreMetrics.totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                    <p className="text-[9.5px] text-slate-400 font-bold mt-1 uppercase">Gastos operacionais</p>
                  </div>

                  {/* Card 3: Salários */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Salários Pagos</p>
                      <span className="p-1 px-2 text-[8px] bg-violet-50 text-violet-800 rounded-md font-bold uppercase">Folha</span>
                    </div>
                    <h3 className="text-xl font-bold text-violet-600 tracking-tight mt-3">R$ {dreMetrics.totalSalarios.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                    <p className="text-[9.5px] text-slate-400 font-bold mt-1 uppercase">Fixo de equipe</p>
                  </div>

                  {/* Card 4: Comissões */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Comissões Pagas</p>
                      <span className="p-1 px-2 text-[8px] bg-indigo-50 text-indigo-800 rounded-md font-bold uppercase">Clínico</span>
                    </div>
                    <h3 className="text-xl font-bold text-indigo-650 tracking-tight mt-3">R$ {dreMetrics.totalComissoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                    <p className="text-[9.5px] text-slate-400 font-bold mt-1 uppercase">Produtividade clínica</p>
                  </div>

                  {/* Card 5: Saldo Líquido */}
                  <div className={`p-6 rounded-3xl border shadow-sm relative overflow-hidden ${dreMetrics.saldoLiquido >= 0 ? 'bg-teal-50/15 border-teal-150' : 'bg-rose-50/15 border-rose-150'}`}>
                    <div className="flex justify-between items-start">
                      <p className="text-[9px] font-black text-slate-650 uppercase tracking-widest">Saldo Operacional</p>
                      <span className={`p-1 px-2 text-[8px] rounded-md font-bold uppercase ${dreMetrics.saldoLiquido >= 0 ? 'bg-teal-60 border-teal-800 text-teal-800' : 'bg-rose-60 border-rose-800 text-rose-800'}`}>Saldo Líquido</span>
                    </div>
                    <h3 className={`text-xl font-black tracking-tight mt-3 ${dreMetrics.saldoLiquido >= 0 ? 'text-teal-655' : 'text-rose-655'}`}>
                      R$ {dreMetrics.saldoLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </h3>
                    <p className="text-[9.5px] text-slate-450 font-bold mt-1 uppercase">Margem de Lucro</p>
                  </div>
                </div>

                {/* DRE Sintética and Charts layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Part A: DRE Sintética Table */}
                  <div className="lg:col-span-7 bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                    <div className="border-b border-slate-150 pb-4 mb-6 flex justify-between items-center">
                      <h4 className="font-black text-xs text-slate-800 uppercase tracking-[0.2em] flex items-center gap-2">
                        <FileText className="w-4 h-4 text-teal-605" /> Demonstração de Resultado do Exercício (DRE)
                      </h4>
                      <span className="text-[9px] font-bold text-slate-400 uppercase">Valores em R$</span>
                    </div>

                    <div className="space-y-4">
                      {/* Line 1: Receita Bruta */}
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        <div>
                          <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">Receita Operacional Bruta (Entradas)</p>
                          <p className="text-[9px] text-slate-400 font-semibold uppercase">Faturamento recebido em caixa (PIX, Cartão, Dinheiro)</p>
                        </div>
                        <p className="text-sm font-bold text-emerald-600">+ R$ {dreMetrics.totalEntradas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </div>

                      {/* Line 2: (-) Custos Operativos de Despesa */}
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2 pl-4">
                        <div>
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">(-) Custos Operacionais Ordinários</p>
                          <p className="text-[9px] text-slate-400 font-semibold uppercase">Despesas gerais, materiais, aluguel, sistemas</p>
                        </div>
                        <p className="text-sm font-bold text-rose-500">- R$ {dreMetrics.totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </div>

                      {/* Line 3: (-) Salários */}
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2 pl-4">
                        <div>
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">(-) Folha de Pagamento Fixa</p>
                          <p className="text-[9px] text-slate-400 font-semibold uppercase">Salários fixos pagos a funcionários e equipe</p>
                        </div>
                        <p className="text-sm font-bold text-rose-500">- R$ {dreMetrics.totalSalarios.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </div>

                      {/* Line 4: (-) Comissões */}
                      <div className="flex justify-between items-center border-b border-slate-150 pb-2 pl-4">
                        <div>
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">(-) Comissões de Produtividade Clinica</p>
                          <p className="text-[9px] text-slate-400 font-semibold uppercase">Comissões repassadas aos profissionais de saúde</p>
                        </div>
                        <p className="text-sm font-bold text-rose-500">- R$ {dreMetrics.totalComissoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </div>

                      {/* Line 5: Lucro Líquido / Margem */}
                      <div className={`flex justify-between items-center p-4 rounded-2xl ${dreMetrics.saldoLiquido >= 0 ? 'bg-teal-50/20 text-teal-900 border border-teal-100' : 'bg-rose-50/20 text-rose-900 border border-rose-100'}`}>
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest">(=) Resultado Líquido do Período</p>
                          <p className="text-[9px] text-slate-500 font-semibold uppercase">Lucro real após dedução de todas as saídas operacionais</p>
                        </div>
                        <p className={`text-base font-black ${dreMetrics.saldoLiquido >= 0 ? 'text-teal-655' : 'text-rose-655'}`}>
                          R$ {dreMetrics.saldoLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Part B: Visualizations Block */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Visual 1: Expense Ring Chart (Pizza) */}
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                      <h4 className="font-black text-xs text-slate-800 uppercase tracking-[0.15em] border-b border-slate-150 pb-2 mb-4">
                        Distribuição das Saídas
                      </h4>

                      {dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes > 0 ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <div className="relative w-20 h-20 shrink-0 flex items-center justify-center rounded-full bg-slate-50 border border-slate-150">
                              <PieChart className="w-6 h-6 text-slate-400" />
                            </div>
                            <div className="flex-1 space-y-2">
                              <div>
                                <div className="flex justify-between text-[10px] font-bold text-slate-600 uppercase">
                                  <span>Despesas Operacionais</span>
                                  <span>{((dreMetrics.totalDespesas / (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 100).toFixed(0)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1">
                                  <div className="h-full bg-rose-500 rounded-full" style={{ width: `${(dreMetrics.totalDespesas / (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 100}%` }} />
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between text-[10px] font-bold text-slate-600 uppercase">
                                  <span>Folha de Pagamento</span>
                                  <span>{((dreMetrics.totalSalarios / (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 100).toFixed(0)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1">
                                  <div className="h-full bg-violet-600 rounded-full" style={{ width: `${(dreMetrics.totalSalarios / (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 100}%` }} />
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between text-[10px] font-bold text-slate-600 uppercase">
                                  <span>Comissões Clínicas</span>
                                  <span>{((dreMetrics.totalComissoes / (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 100).toFixed(0)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1">
                                  <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${(dreMetrics.totalComissoes / (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 100}%` }} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-center text-xs text-slate-400 italic py-8">Nenhuma saída registrada para o gráfico.</p>
                      )}
                    </div>

                    {/* Visual 2: Entradas x Saídas Bar Chart */}
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                      <h4 className="font-black text-xs text-slate-800 uppercase tracking-[0.15em] border-b border-slate-150 pb-2 mb-4">
                        Comparativo Geral de Balanço
                      </h4>

                      <div className="space-y-4 pt-2">
                        <div className="flex gap-4 items-end justify-center h-28">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-12 bg-teal-600 rounded-t-lg transition-all" style={{ height: dreMetrics.totalEntradas > 0 ? `${Math.min(100, Math.max(10, (dreMetrics.totalEntradas / Math.max(dreMetrics.totalEntradas, dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 80))}px` : '4px' }} />
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">Entradas</span>
                          </div>

                          <div className="flex flex-col items-center gap-1">
                            <div className="w-12 bg-rose-500 rounded-t-lg transition-all" style={{ height: (dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes) > 0 ? `${Math.min(100, Math.max(10, ((dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes) / Math.max(dreMetrics.totalEntradas, dreMetrics.totalDespesas + dreMetrics.totalSalarios + dreMetrics.totalComissoes)) * 80))}px` : '4px' }} />
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">Saídas</span>
                          </div>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-150 flex items-center justify-between mt-2">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Margem Líquida</span>
                          <span className={`text-[10px] font-black ${dreMetrics.totalEntradas > 0 && dreMetrics.saldoLiquido >= 0 ? 'text-teal-655' : 'text-rose-600'}`}>
                            {dreMetrics.totalEntradas > 0 ? `${((dreMetrics.saldoLiquido / dreMetrics.totalEntradas) * 100).toFixed(0)}%` : '0%'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'flow' && (
              <div className="p-8 space-y-8 flex-1 bg-slate-50/30 text-left">
                {/* Header Explaining Period Mode */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse" />
                        <h4 className="text-sm font-bold text-slate-800">
                          Cockpit Financeiro & Consolidação de Caixa
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                        Este painel unifica as métricas do seu sistema e das importações automáticas, analisando períodos com base na sua escolha de modelo de conciliação por <strong className="text-teal-600 font-semibold">{dateMode === 'payment' ? 'Data de Pagamento' : 'Data de Vencimento'}</strong>.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-start md:self-auto bg-slate-100 p-1 rounded-xl shrink-0">
                      <span className="text-[10px] font-bold text-slate-500 px-2 uppercase">Modo de Visão:</span>
                      <span className="bg-teal-600 text-white rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-wider block">
                        {dateMode === 'payment' ? 'Pagamento' : 'Vencimento'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Comparative Section: Today, Month, Year, and Custom */}
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                    Comparativo Cronológico de Caixa
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    
                    {/* HOJE */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider rounded">
                          Hoje
                        </span>
                        <TrendingUp className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Saldo Diário</p>
                        <p className={`text-xl font-bold ${todayStats.balance >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>
                          R$ {todayStats.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <p className="text-slate-400 font-bold">RECEITAS</p>
                          <p className="text-emerald-600 font-bold">R$ {todayStats.totalIncome.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-bold">DESPESAS</p>
                          <p className="text-rose-600 font-bold">R$ {todayStats.totalExpense.toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                    </div>

                    {/* MÊS ATUAL */}
                    <div className="bg-gradient-to-br from-white to-teal-50/10 p-6 rounded-3xl border border-teal-100 shadow-sm hover:border-teal-200 transition-all space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 bg-teal-50 text-teal-700 text-[10px] font-bold uppercase tracking-wider rounded">
                          Mês Corrente
                        </span>
                        <ArrowUpRight className="w-4 h-4 text-teal-500" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Saldo Líquido</p>
                        <p className={`text-xl font-bold ${monthStats.balance >= 0 ? 'text-teal-950' : 'text-rose-600'}`}>
                          R$ {monthStats.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-teal-100/50 grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <p className="text-slate-400 font-bold">RECEITAS</p>
                          <p className="text-emerald-600 font-bold">R$ {monthStats.totalIncome.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-bold">DESPESAS</p>
                          <p className="text-rose-600 font-bold">R$ {monthStats.totalExpense.toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                      <div className="text-[9px] text-teal-800 font-semibold bg-teal-50/50 p-2 rounded-xl flex items-center justify-between">
                        <span>A receber:</span>
                        <span>R$ {monthStats.pendingIncome.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>

                    {/* ANO ATUAL */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider rounded">
                          Ano Ativo
                        </span>
                        <Calendar className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Saldo do Ano</p>
                        <p className={`text-xl font-bold ${yearStats.balance >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>
                          R$ {yearStats.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <p className="text-slate-400 font-bold">RECEITAS</p>
                          <p className="text-emerald-600 font-bold">R$ {yearStats.totalIncome.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-bold">DESPESAS</p>
                          <p className="text-rose-600 font-bold">R$ {yearStats.totalExpense.toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                    </div>

                    {/* SELEÇÃO ATIVA */}
                    <div className="bg-slate-900 p-6 rounded-3xl shadow-xl text-white relative overflow-hidden space-y-4">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />
                      <div className="flex items-center justify-between pb-1 relative z-10">
                        <span className="px-2 py-0.5 bg-teal-500/20 text-teal-300 text-[8px] font-black uppercase tracking-widest rounded">
                          Seleção Ativa ({dateFilter === 'today' ? 'Hoje' : dateFilter === 'week' ? 'Semana' : dateFilter === 'month' ? 'Mês' : dateFilter === 'year' ? 'Ano' : 'Personalizado'})
                        </span>
                        <Filter className="w-3.5 h-3.5 text-teal-400" />
                      </div>
                      <div className="space-y-1 relative z-10">
                        <p className="text-[10px] text-teal-300 font-bold uppercase tracking-wider">Saldo Filtrado</p>
                        <p className="text-2xl font-bold text-white tracking-tight">
                          R$ {balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-white/10 grid grid-cols-2 gap-2 text-[10px] relative z-10">
                        <div>
                          <p className="text-teal-300/60 font-bold">ENTRADAS</p>
                          <p className="text-emerald-400 font-bold">R$ {totalIncome.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-teal-300/60 font-bold">SAÍDAS</p>
                          <p className="text-rose-300 font-bold">R$ {totalExpense.toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Visual Efficiency progress & Category breakdowns */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  
                  {/* Left panel: Selected period statistics summary & health meters */}
                  <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                      Métricas de Eficiência (Seleção)
                    </h5>

                    {/* Progress bars indicating Profit margin & Outstanding payments */}
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span className="flex items-center gap-1.5">Margem Líquida Operacional</span>
                          <span>
                            {totalIncome > 0 ? (((totalIncome - totalExpense) / totalIncome) * 100).toFixed(0) : '0'}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-teal-500 h-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, Math.max(0, totalIncome > 0 ? (((totalIncome - totalExpense) / totalIncome) * 100) : 0))}%` }} 
                          />
                        </div>
                        <p className="text-[9px] text-slate-400 font-medium">Percentual de receita que permanece após as saídas operacionais.</p>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>Índice de Valores Pendentes</span>
                          <span>
                            {totalIncome + pendingIncome > 0 ? ((pendingIncome / (totalIncome + pendingIncome)) * 100).toFixed(0) : '0'}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-amber-500 h-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, Math.max(0, (totalIncome + pendingIncome > 0) ? ((pendingIncome / (totalIncome + pendingIncome)) * 100) : 0))}%` }} 
                          />
                        </div>
                        <p className="text-[9px] text-slate-400 font-medium">Faturamento agendado / parcelado ainda não ingressado no caixa.</p>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-bold text-slate-700 flex-wrap">
                          <span>Grau de Cobertura de Despesas</span>
                          <span>{totalExpense > 0 ? ((totalIncome / totalExpense) * 100).toFixed(0) : '---'}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 ${totalIncome >= totalExpense ? 'bg-emerald-500' : 'bg-rose-500'}`} 
                            style={{ width: `${Math.min(100, Math.max(0, totalExpense > 0 ? ((totalIncome / totalExpense) * 100) : 0))}%` }} 
                          />
                        </div>
                        <p className="text-[9px] text-slate-400 font-medium">Capacidade das receitas pagas de liquidarem o total de despesas.</p>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-teal-600" />
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Metas de Recebimento</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                        O faturamento bruto total no período acumula <strong className="text-slate-900 font-bold">R$ {(totalIncome + pendingIncome).toLocaleString('pt-BR')}</strong>. Desse total disponível, <strong className="text-emerald-600 font-bold">R$ {totalIncome.toLocaleString('pt-BR')}</strong> já estão consolidados e em conta.
                      </p>
                    </div>

                    <div className="p-4 bg-teal-50 text-teal-900 rounded-2xl flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider leading-none text-teal-900">Período Compreendido</p>
                        <p className="text-[9.5px] font-semibold text-teal-800 leading-normal">
                          O sistema recalcula dinamicamente os valores de Hoje, Semana, Mês, Ano ou Intervalo Personalizado acima, garantindo flexibilidade total.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Right panel: Top categories of income & expenses in selection */}
                  <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* TOP RECEITAS */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                            Fontes de Receitas
                          </h5>
                          <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                        </div>
                        
                        <div className="space-y-4">
                          {categoryIncomeBreakdown.length > 0 ? (
                            categoryIncomeBreakdown.slice(0, 5).map(([category, amount]) => {
                              const totalCategorySum = categoryIncomeBreakdown.reduce((sum, [_, val]) => sum + val, 0);
                              const percentage = totalCategorySum > 0 ? (amount / totalCategorySum) * 100 : 0;
                              return (
                                <div key={category} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-700">{category}</span>
                                    <span className="font-bold text-slate-600">
                                      R$ {amount.toLocaleString('pt-BR')}
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                      className="bg-emerald-500 h-full rounded-full" 
                                      style={{ width: `${percentage}%` }} 
                                    />
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[11px] text-slate-400 italic">Nenhum recebimento registrado no período.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t border-slate-100 text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                        <span>Total de Receitas no período:</span>
                        <span className="text-emerald-600 font-bold">R$ {totalIncome.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>

                    {/* TOP DESPESAS */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                            Destino de Despesas
                          </h5>
                          <ArrowDownRight className="w-4 h-4 text-rose-500" />
                        </div>
                        
                        <div className="space-y-4">
                          {categoryExpenseBreakdown.length > 0 ? (
                            categoryExpenseBreakdown.slice(0, 5).map(([category, amount]) => {
                              const totalCategorySum = categoryExpenseBreakdown.reduce((sum, [_, val]) => sum + val, 0);
                              const percentage = totalCategorySum > 0 ? (amount / totalCategorySum) * 100 : 0;
                              return (
                                <div key={category} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-700">{category}</span>
                                    <span className="font-bold text-slate-600">
                                      R$ {amount.toLocaleString('pt-BR')}
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                      className="bg-rose-400 h-full rounded-full" 
                                      style={{ width: `${percentage}%` }} 
                                    />
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[11px] text-slate-400 italic">Nenhuma despesa paga no período.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t border-slate-100 text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                        <span>Total de Saídas no período:</span>
                        <span className="text-rose-600 font-bold">R$ {totalExpense.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>

                  </div>
                  
                </div>

                {/* Quick Diagnostics Action Area */}
                <div className="p-8 bg-slate-900 text-white rounded-[2.5rem] relative overflow-hidden shadow-2xl">
                  <div className="absolute top-0 right-0 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <h5 className="text-lg font-bold tracking-tight">Precisa auditar ou ajustar os lançamentos?</h5>
                      <p className="text-xs text-slate-300 leading-relaxed max-w-2xl font-medium">
                        Se você realizou uma importação em massa ou percebeu disparidades nos totais, utilize nossa ferramenta automática de reconciliação de dados. O sistema irá auditar campos duplicados, datas truncadas e vincular os registros aos respectivos prontuários de pacientes.
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <button 
                        onClick={() => setActiveTab('audit')}
                        className="bg-teal-500 hover:bg-teal-400 text-slate-950 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg select-none"
                      >
                        Ferramentas de Auditoria
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'audit' && (
              <div className="flex-1 flex flex-col min-h-[500px]">
                {/* ERP GENERAL MAINTENANCE CARD */}
                <div className="m-8 mb-4 bg-slate-900 text-white rounded-[2rem] p-8 shadow-xl relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-teal-500 text-slate-950 rounded-lg text-[9px] font-black uppercase tracking-widest">Procedimento Oficial</span>
                        <h4 className="text-base font-black tracking-tight">Manutenção Geral e Consolidação ERP</h4>
                      </div>
                      <p className="text-xs text-slate-400 font-medium max-w-xl">
                        Roda a detecção geral de inconsistências, repara o saldo das contas, normaliza datas para fuso <span className="text-teal-400 font-mono">America/Sao_Paulo</span>, e elimina duplicidades financeiras de consultório no registro oficial de lançamentos.
                      </p>
                    </div>
                    <button
                      onClick={handleRepairDatabase}
                      disabled={isRepairing}
                      className="bg-teal-500 hover:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] shadow-xl shadow-teal-500/20 transition-all flex items-center justify-center gap-2 shrink-0 select-none"
                    >
                      {isRepairing ? 'Executando Auditoria...' : 'Iniciar Conversão ERP de Caixa'}
                    </button>
                  </div>

                  {repairResult && (
                    <div className="mt-6 p-6 bg-slate-850 border border-slate-800 rounded-2xl whitespace-pre-line text-xs font-semibold text-slate-300 leading-relaxed">
                      {repairResult}
                    </div>
                  )}
                </div>

                <div className="p-8 pb-4 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Conferência de Importação</h4>
                      <p className="text-[10px] text-slate-400 font-medium">Validação de integridade dos dados migrados.</p>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={cleanZeroRecords}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-rose-100 hover:bg-rose-100 transition-all disabled:opacity-50"
                      >
                         Limpar Zerados ({transactions.filter(t => !t.amount || t.amount <= 0).length})
                      </button>
                      <button 
                        onClick={linkPatientsToTransactions}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-emerald-100 hover:bg-emerald-100 transition-all disabled:opacity-50"
                      >
                         Vincular Pacientes
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Importado</p>
                    <p className="text-2xl font-bold text-slate-900">{transactions.filter(t => t.importSource === 'external_system').length} <span className="text-xs font-medium text-slate-400">linhas</span></p>
                  </div>
                  <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2">Receitas Migradas</p>
                    <p className="text-2xl font-bold text-emerald-600">R$ {transactions.filter(t => t.importSource === 'external_system' && t.type === 'income').reduce((acc, t) => acc + t.amount, 0).toLocaleString()}</p>
                  </div>
                  <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                    <p className="text-[9px] font-black text-rose-600 uppercase tracking-widest mb-2">Despesas Migradas</p>
                    <p className="text-2xl font-bold text-rose-600">R$ {transactions.filter(t => t.importSource === 'external_system' && t.type === 'expense').reduce((acc, t) => acc + t.amount, 0).toLocaleString()}</p>
                  </div>
                </div>

                <div className="px-8 pb-8">
                  <div className="bg-slate-900 rounded-[2rem] p-8 text-white relative overflow-hidden">
                    <div className="relative z-10 space-y-6">
                       <h5 className="font-bold tracking-tight">Status de Integridade</h5>
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                          <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Pagos</p>
                            <p className="text-lg font-bold">{transactions.filter(t => t.importSource === 'external_system' && t.status === 'paid').length}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Pendentes</p>
                            <p className="text-lg font-bold">{transactions.filter(t => t.importSource === 'external_system' && t.status === 'pending').length}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Categorias Únicas</p>
                            <p className="text-lg font-bold">{new Set(transactions.filter(t => t.importSource === 'external_system').map(t => t.category)).size}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Sistemas</p>
                            <p className="text-lg font-bold">1</p>
                          </div>
                       </div>
                    </div>
                    <div className="absolute top-0 right-0 p-12 opacity-10">
                       <Database className="w-32 h-32" />
                    </div>
                  </div>
                </div>

                {/* Diagnóstico de Duplicados */}
                <div className="px-8 pb-8">
                  <div className="bg-white border border-slate-200 rounded-[2rem] p-8 relative overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                      <div>
                        <h5 className="font-bold text-slate-900 tracking-tight">Análise de Duplicidades Financeiras</h5>
                        <p className="text-xs text-slate-400 mt-1">Busca lançamentos duplicados de orçamentos (mesmo paciente, orçamento, parcela e valor).</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={scanForDuplicates}
                          disabled={isProcessing}
                          className="px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                        >
                          Analisar Duplicidades
                        </button>
                        {duplicateEntriesList.length > 0 && (
                          <button
                            onClick={removeDuplicatesFromFinance}
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                          >
                            Remover duplicados do financeiro
                          </button>
                        )}
                      </div>
                    </div>

                    {duplicateScanStatus && (
                      <div className="mb-6 p-4 bg-teal-50 border border-teal-100 rounded-2xl">
                        <p className="text-xs text-teal-800 font-medium">{duplicateScanStatus}</p>
                      </div>
                    )}

                    {duplicateEntriesList.length > 0 ? (
                      <div className="border border-slate-100 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              <th className="p-4">Paciente</th>
                              <th className="p-4">Orçamento</th>
                              <th className="p-4">Parcela</th>
                              <th className="p-4">Valor</th>
                              <th className="p-4">Duplicados</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs">
                            {duplicateEntriesList.map((group, index) => {
                              const best = group.best;
                              const methods = group.duplicates.map((d: any) => d.paymentMethod || d.payment_method || 'SISTEMA').join(', ');
                              return (
                                <tr key={index} className="hover:bg-slate-50">
                                  <td className="p-4 font-semibold text-slate-900">{best.patientName || best.patient_name || 'Paciente'}</td>
                                  <td className="p-4 text-slate-500">{best.description || 'Consulta/Orçamento'}</td>
                                  <td className="p-4 text-slate-500">#{best.installmentNumber || best.installment_number || '1'}</td>
                                  <td className="p-4 font-medium text-slate-900">R$ {(best.amount || best.value || 0).toLocaleString()}</td>
                                  <td className="p-4 text-rose-600 font-medium">
                                    {group.duplicates.length} ({methods})
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      duplicateScanStatus.includes('Análise de duplicados finalizada. Encontrados 0') && (
                        <div className="text-center py-6 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                          <p className="text-xs text-slate-500">Nenhum registro de orçamento duplicado encontrado. Seu financeiro está saudável!</p>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {/* Histórico Multifuncional de Alterações / Auditoria */}
                <div className="px-8 pb-8">
                  <div className="bg-white border border-slate-200 rounded-[2rem] p-8 relative overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                      <div>
                        <h5 className="font-bold text-slate-900 tracking-tight flex items-center gap-2">
                          <Bot className="w-5 h-5 text-teal-650" /> Histórico de Alterações do Painel Administrador
                        </h5>
                        <p className="text-xs text-slate-400 mt-1">
                          Logs de auditoria em tempo real detalhando quem alterou ou excluiu qualquer lançamento financeiro operacional.
                        </p>
                      </div>
                      <div className="shrink-0">
                        <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-3 py-1.5 rounded-xl uppercase tracking-wider">
                          {financialLogs.length} logs registrados
                        </span>
                      </div>
                    </div>

                    {isLoadingLogs ? (
                      <div className="py-12 text-center text-slate-400 text-xs italic">
                        Carregando registros de auditoria...
                      </div>
                    ) : financialLogs.length > 0 ? (
                      <div className="border border-slate-100 rounded-2xl overflow-hidden max-h-96 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-emerald-50/15 border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              <th className="p-4">Data / Hora</th>
                              <th className="p-4">Utilizador</th>
                              <th className="p-4 text-center">Operação</th>
                              <th className="p-4">Detalhamento Técnico</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                            {financialLogs.map((log: any) => {
                              const dateStr = log.timestamp 
                                ? new Date(log.timestamp).toLocaleString('pt-BR') 
                                : '---';
                              
                              let badgeColor = "bg-amber-50 text-amber-700 border-amber-100";
                              let actionLabel = "Alteração";
                              if (log.action === 'delete') {
                                badgeColor = "bg-rose-50 text-rose-700 border-rose-100";
                                actionLabel = "Exclusão";
                              } else if (log.action === 'create') {
                                badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-100";
                                actionLabel = "Criação";
                              }

                              return (
                                <tr key={log.id} className="hover:bg-slate-50/50">
                                  <td className="p-4 font-mono font-bold text-[11px] text-slate-500 whitespace-nowrap">
                                    {dateStr}
                                  </td>
                                  <td className="p-4 font-semibold text-slate-800">
                                    {log.userName || log.userId || 'Sistema'}
                                  </td>
                                  <td className="p-4 text-center">
                                    <span className={`px-2.5 py-0.5 rounded-lg border text-[9px] font-bold uppercase tracking-wider ${badgeColor}`}>
                                      {actionLabel}
                                    </span>
                                  </td>
                                  <td className="p-4 text-slate-650 leading-relaxed max-w-sm">
                                    <p className="font-medium text-[11.5px]">{log.details}</p>
                                    {(log.oldData || log.newData) && (
                                      <div className="mt-2 text-[10px] bg-slate-50 border border-slate-150 p-2 rounded-lg font-mono text-slate-500 overflow-x-auto whitespace-pre-wrap max-h-24">
                                        {log.oldData && (
                                          <p><span className="text-rose-600 font-bold">Antes:</span> {JSON.stringify(log.oldData)}</p>
                                        )}
                                        {log.newData && (
                                          <p className="mt-1"><span className="text-emerald-600 font-bold">Depois:</span> {JSON.stringify(log.newData)}</p>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-10 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                        <p className="text-xs text-slate-500">Nenhum log de alteração operacional registrado no sistema até o momento.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'commissions' && (
              <div className="flex-1 flex flex-col min-h-[400px]">
                 <div className="p-6 border-b border-slate-100 bg-teal-50/50">
                    <h4 className="text-xs font-bold text-teal-800 uppercase tracking-[0.2em]">Cálculo de Comissões - Equipe Clínica</h4>
                 </div>
                 <div className="p-8 space-y-6">
                    {commissions.length > 0 ? (
                      commissions.map((c: any) => (
                        <div key={c.id} className="p-6 bg-white border border-slate-200 rounded-[2rem] shadow-sm flex items-center justify-between group hover:border-teal-200 transition-all">
                          <div className="flex items-center gap-6">
                            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center font-bold text-slate-400 group-hover:bg-teal-600 group-hover:text-white transition-all overflow-hidden uppercase">
                              {c.name?.charAt(0) || '?'}
                            </div>
                            <div>
                              <h5 className="font-bold text-slate-900 tracking-tight">{c.name || 'Sem Nome'}</h5>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{c.role || 'Membro'}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">A Receber</p>
                            <h6 className="text-xl font-black text-teal-600">R$ {(c.totalComission || 0).toLocaleString()}</h6>
                            <button className="text-[9px] font-bold text-teal-600 uppercase tracking-wider mt-2 hover:underline">Fechar Período</button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-20 text-center text-slate-400 italic text-xs">Cadastre sua equipe clínica em "Configurações" para gerenciar comissões.</div>
                    )}
                 </div>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* Modal: Nova Transação */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-teal-600" /> Nova Movimentação
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição</label>
                  <input value={newTransaction.description} onChange={(e) => setNewTransaction({...newTransaction, description: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" placeholder="Ex: Manutenção Filtro" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paciente (Opcional)</label>
                  <select 
                    value={newTransaction.patientId} 
                    onChange={(e) => {
                      const p = patients.find(p => p.id === e.target.value);
                      setNewTransaction({...newTransaction, patientId: e.target.value, patientName: p?.name || ''});
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                  >
                    <option value="">Selecione um paciente...</option>
                    {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor (R$)</label>
                    <input type="number" value={newTransaction.amount} onChange={(e) => setNewTransaction({...newTransaction, amount: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Categoria</label>
                    <input value={newTransaction.category} onChange={(e) => setNewTransaction({...newTransaction, category: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tipo</label>
                    <select value={newTransaction.type} onChange={(e) => setNewTransaction({...newTransaction, type: e.target.value as any})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none">
                      <option value="income">Entrada (+)</option>
                      <option value="expense">Saída (-)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</label>
                    <select value={newTransaction.status} onChange={(e) => setNewTransaction({...newTransaction, status: e.target.value as any})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none">
                      <option value="paid">Confirmado</option>
                      <option value="pending">Pendente</option>
                    </select>
                  </div>
                </div>

                {newTransaction.type === 'income' && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Responsáveis pela Comissão</p>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Venda</label>
                        <select value={newTransaction.sale_responsible_id} onChange={(e) => setNewTransaction({...newTransaction, sale_responsible_id: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] outline-none">
                          <option value="">Nenhum...</option>
                          {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role || 'Membro'})</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Procedimento</label>
                        <select value={newTransaction.procedure_responsible_id} onChange={(e) => setNewTransaction({...newTransaction, procedure_responsible_id: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] outline-none">
                          <option value="">Nenhum...</option>
                          {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role || 'Membro'})</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-8 flex gap-3">
                <button onClick={() => setIsAddModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                <button onClick={handleAddTransaction} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20">Salvar Transação</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Receber / Baixar Pendência */}
      <AnimatePresence>
        {isReceiptModalOpen && selectedReceiptTransaction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsReceiptModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-teal-600" /> Baixar Lançamento
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Lançamento</p>
                  <p className="text-xs font-bold text-slate-900">{selectedReceiptTransaction.description}</p>
                  {selectedReceiptTransaction.patientName && (
                    <p className="text-[10px] text-teal-600 font-bold mt-1">Paciente: {selectedReceiptTransaction.patientName}</p>
                  )}
                  <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-200/50">
                    <div>
                      <p className="text-[8px] font-bold text-slate-400 uppercase">Valor Total</p>
                      <p className="text-sm font-bold text-slate-700">R$ {selectedReceiptTransaction.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] font-bold text-slate-400 uppercase">Pendente</p>
                      <p className="text-sm font-bold text-teal-600">R$ {selectedReceiptTransaction.pendingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-4">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Meios de Pagamento (Splits / Dividido)</label>
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptSplits([...receiptSplits, { method: 'PIX', amount: 0 }]);
                      }}
                      className="text-[9px] font-bold uppercase tracking-wider text-teal-600 hover:text-teal-700 bg-teal-50 px-2 py-1 rounded"
                    >
                      + Outro Meio
                    </button>
                  </div>

                  <div className="space-y-3">
                    {receiptSplits.map((split, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <select
                          value={split.method}
                          onChange={(e) => {
                            const newSplits = [...receiptSplits];
                            newSplits[idx].method = e.target.value;
                            setReceiptSplits(newSplits);
                          }}
                          className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        >
                          <option value="PIX">PIX</option>
                          <option value="Cartão de Crédito">Cartão de Crédito</option>
                          <option value="Cartão de Débito">Cartão de Débito</option>
                          <option value="Dinheiro">Dinheiro</option>
                          <option value="Transferência Bancária">Transferência Bancária</option>
                          <option value="Boleto">Boleto</option>
                        </select>
                        <input
                          type="number"
                          placeholder="Valor"
                          value={split.amount || ''}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const newSplits = [...receiptSplits];
                            newSplits[idx].amount = val;
                            setReceiptSplits(newSplits);

                            // Auto update receiptForm sum:
                            const totalPaidSum = newSplits.reduce((acc, curr) => acc + curr.amount, 0);
                            setReceiptForm(prev => ({ ...prev, amountPaidNow: totalPaidSum }));
                          }}
                          className="w-28 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-right font-bold"
                        />
                        {receiptSplits.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newSplits = receiptSplits.filter((_, i) => i !== idx);
                              setReceiptSplits(newSplits);
                              const totalPaidSum = newSplits.reduce((acc, curr) => acc + curr.amount, 0);
                              setReceiptForm(prev => ({ ...prev, amountPaidNow: totalPaidSum }));
                            }}
                            className="p-1 px-2 hover:bg-rose-50 text-slate-400 hover:text-rose-600 font-bold rounded"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/50 flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-500">Total a baixar agora:</span>
                    <span className="font-bold text-slate-900">R$ {Number(receiptForm.amountPaidNow).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>

                  {receiptForm.amountPaidNow > selectedReceiptTransaction.pendingAmount && (
                    <p className="text-[10px] text-amber-600 font-bold leading-tight flex items-start gap-1">
                      ⚠️ O valor de R$ {receiptForm.amountPaidNow.toLocaleString('pt-BR')} excede o saldo pendente de R$ {selectedReceiptTransaction.pendingAmount.toLocaleString('pt-BR')}.
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button onClick={() => setIsReceiptModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                <button onClick={handleConfirmDashboardReceipt} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20">Confirmar Baixa</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Editar Lançamento ERP */}
      <AnimatePresence>
        {editingTransaction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingTransaction(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-y-auto max-h-[90vh]">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-teal-600" /> Editar Lançamento ERP
              </h3>
              
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição / Item</label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    placeholder="Descrição do lançamento"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor do Lançamento (R$)</label>
                    <input
                      type="number"
                      value={editForm.amount}
                      onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data Competência</label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Categoria</label>
                    <select
                      value={editForm.category}
                      onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-semibold"
                    >
                      <option value="Geral">Geral</option>
                      <option value="Tratamento">Tratamento</option>
                      <option value="Procedimento">Procedimento</option>
                      <option value="Ortodontia">Ortodontia</option>
                      <option value="Implante">Implante</option>
                      <option value="Aluguel">Aluguel</option>
                      <option value="Salário">Salário</option>
                      <option value="Marketing">Marketing</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Método Principal</label>
                    <select
                      value={editForm.paymentMethod}
                      onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-semibold"
                    >
                      <option value="PIX">PIX</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Dinheiro">Dinheiro</option>
                      <option value="Transferência Bancária">Transferência Bancária</option>
                      <option value="Boleto">Boleto</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tipo de Fluxo</label>
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value as any })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    >
                      <option value="income">Entrada (Receita)</option>
                      <option value="expense">Saída (Despesa)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status de Pagamento</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    >
                      <option value="paid">Pago</option>
                      <option value="pending">Pendente</option>
                      <option value="partial">Parcial</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingTransaction(null)}
                  className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditTransaction}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20"
                >
                  Salvar Alterações
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Eliza Custom Confirmation Modal for Editing */}
      <AnimatePresence>
        {transactionToConfirmEdit && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setTransactionToConfirmEdit(null)} 
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-slate-900 border border-slate-800 rounded-[2rem] p-8 max-w-md w-full shadow-2xl text-left space-y-6 overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none text-left" />
              
              <div className="flex items-center gap-3 text-amber-500 relative z-10">
                <Bot className="w-10 h-10 text-emerald-400 animate-pulse" />
                <div>
                  <span className="text-[10px] bg-emerald-400/10 text-emerald-400 font-bold px-2.5 py-0.5 rounded-md uppercase tracking-wider">ELIZA Inteligente</span>
                  <h4 className="text-sm font-black text-white mt-1 leading-none">Aviso de Segurança Operacional</h4>
                </div>
              </div>
              
              <div className="space-y-3 relative z-10">
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  Detectamos uma solicitação para alterar um faturamento registrado oficialmente no caixa integrado da clínica.
                </p>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1 text-left">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">Lançamento Selecionado</p>
                  <p className="text-xs font-bold text-slate-200">{transactionToConfirmEdit.description || "Sem Descrição"}</p>
                  <p className="text-xs text-emerald-400 font-bold font-mono">
                    R$ {Number(transactionToConfirmEdit.amount || transactionToConfirmEdit.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <p className="text-[11px] text-amber-400/90 font-medium leading-relaxed font-sans">
                  ⚠️ Alterações tácticas neste faturamento irão desalinhar relatórios históricos, recalcular comissões profissionais vinculadas e registrar um log de auditoria administrativa. Deseja prosseguir com a edição?
                </p>
              </div>
              
              <div className="flex items-center justify-end gap-3 pt-2 relative z-10">
                <button
                  onClick={() => setTransactionToConfirmEdit(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white rounded-xl text-xs font-bold uppercase transition-all select-none cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const t = transactionToConfirmEdit;
                    setTransactionToConfirmEdit(null);
                    handleStartEditTransaction(t);
                  }}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-905 rounded-xl text-xs font-black uppercase tracking-wide transition-all shadow-lg select-none cursor-pointer"
                >
                  Prosseguir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Diagnóstico de Financeiro */}
      <AnimatePresence>
        {isDiagnoseOpen && dashboardData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsDiagnoseOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl p-10 max-h-[85vh] overflow-y-auto">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500 animate-pulse" /> Diagnóstico do Banco de Dados Financeiro
              </h3>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                  <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Registros Totais</p>
                  <p className="text-lg font-black text-slate-950">{dashboardData.diagnostics.totalLoadedEntries}</p>
                </div>
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <p className="text-[8px] font-bold text-emerald-600 uppercase mb-1">Pagos (Paid)</p>
                  <p className="text-lg font-black text-emerald-700">{dashboardData.diagnostics.countPaid}</p>
                </div>
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                  <p className="text-[8px] font-bold text-amber-600 uppercase mb-1">Pendentes</p>
                  <p className="text-lg font-black text-amber-700">{dashboardData.diagnostics.countPending}</p>
                </div>
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                  <p className="text-[8px] font-bold text-blue-600 uppercase mb-1">Parciais</p>
                  <p className="text-lg font-black text-blue-700">{dashboardData.diagnostics.countPartial}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="p-5 bg-teal-50/50 border border-teal-100 rounded-2xl">
                  <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Soma Global Paid Amount</p>
                  <p className="text-xl font-bold text-slate-900">R$ {dashboardData.diagnostics.sumPaidAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="p-5 bg-rose-50/50 border border-rose-100 rounded-2xl">
                  <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Soma Global Pending Amount</p>
                  <p className="text-xl font-bold text-slate-900">R$ {dashboardData.diagnostics.sumPendingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Campos Encontrados nos Documentos</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {dashboardData.diagnostics.detectedFields.map((f: string) => (
                      <span key={f} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-[10px] font-mono text-slate-600 rounded-md">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>

                {dashboardData.diagnostics.rawDocSampleKeys.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Chaves no Primeiro Documento (Amostra)</h4>
                    <div className="p-4 bg-slate-950 rounded-2xl font-mono text-xs text-slate-300">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(dashboardData.diagnostics.rawDocSampleKeys, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setIsDiagnoseOpen(false)} 
                  className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all"
                >
                  Fechar Diagnóstico
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Patient Financial Quick View Side Over Panel */}
      {selectedQuickViewPatientId && (
        <PatientFinancialQuickView 
          patientId={selectedQuickViewPatientId}
          clinicId={clinic?.id || ''}
          onClose={() => setSelectedQuickViewPatientId(null)}
          onRefreshParent={async () => {
            if (clinic?.id) {
              console.log('[PATIENT_FINANCIAL_QUICK_ACTION] Refreshing dashboard after quick view action...');
              try {
                const data = await getFinancialDashboardData({
                  clinicId: clinic.id,
                  mode: dateMode,
                  period: dateFilter,
                  customRange
                });
                setDashboardData(data);
                if (data.filteredTransactions) {
                  setTransactions(data.filteredTransactions.map(t => t.raw));
                }
              } catch (e) {
                console.error("Dashboard refresh error:", e);
              }
            }
          }}
        />
      )}
    </div>
  );
}
