import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Briefcase,
  Sparkles,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Search,
  RefreshCw,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Receipt,
  Calculator,
  Bot,
  ClipboardCheck,
  Clock,
  ChevronRight,
  Printer,
  Banknote,
  CreditCard,
  ArrowLeftRight,
  ScanLine,
  Percent,
  Users,
  History,
  Info,
  Send,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Wand2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { useSetElizaScreenContext } from '../context/ElizaAssistantContext';
import { useElizaStandingGapCheck } from '../hooks/useElizaStandingGapCheck';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit, addDoc, updateDoc, deleteDoc, setDoc, getDoc, writeBatch, doc as fsDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { normalizeFinancialEntry } from '../../utils/financialHelpers';
import { logStatusEvent } from '../services/statusEvents';

interface FinancialEntryRow {
  id: string;
  patientId: string | null;
  patientName: string | null;
  type: 'income' | 'expense';
  category: string;
  description: string;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  status: 'pending' | 'partial' | 'paid' | 'cancelled';
  dueDate: any;
  paidAt: any;
  paymentMethod: string;
  source: string;
  professionalId?: string | null;
  professionalName?: string | null;
  /** Fase C — sempre a pessoa logada no momento da confirmação, nunca escolhível. Ausente em lançamentos recebidos antes desta fase. */
  receivedBy?: string | null;
  receivedByName?: string | null;
}

interface PatientLite { id: string; name: string; }

interface ClosingRow {
  id: string;
  date: string;
  cashAmount: number;
  machineAmount: number;
  pixAmount: number;
  transferAmount: number;
  otherAmount: number;
  totalAmount: number;
  systemTotal: number;
  difference: number;
  status: 'balanced' | 'unbalanced';
  observations: string;
  closedBy: string;
  createdAt?: any;
}

interface TeamMemberLite { id: string; name: string; }

interface CommissionSetting {
  professionalId: string;
  professionalName: string;
  defaultPercent: number;
  active: boolean;
}

interface CommissionRecord {
  id: string;
  professionalId: string;
  professionalName: string;
  financialEntryId: string | null;
  patientId: string | null;
  patientName: string | null;
  description: string;
  baseAmount: number;
  percent: number;
  commissionAmount: number;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  notes: string;
  source: string;
  createdAt?: any;
  paidAt?: any;
}

interface LegacyCommissionRow {
  id: string;
  professionalName: string;
  amount: number;
  status: string;
  date: any;
  origin: 'Clínica/Procedimento' | 'Comercial';
}

const COMMISSION_STATUS_META: Record<string, { label: string; classes: string }> = {
  pending: { label: 'Pendente', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  approved: { label: 'Aprovada', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
  paid: { label: 'Paga', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  cancelled: { label: 'Cancelada', classes: 'bg-slate-800 border-next-border text-slate-500' },
};

interface FinancialAiReport {
  id: string;
  question: string;
  summary: string;
  risks: string[];
  opportunities: string[];
  recommendedActions: string[];
  automatic?: boolean;
  createdAt?: any;
}

interface ReceiptFile { id: string; name: string; mimeType: string; dataUrl: string; }

interface ExtractedReceipt {
  description: string;
  amount: number;
  date: string;
  paymentMethod: string;
  type: 'income' | 'expense';
  category: string;
}

const AI_SUGGESTIONS = [
  'Como está a saúde financeira este mês?',
  'Onde estão os maiores riscos de inadimplência?',
  'O que priorizar essa semana no financeiro?',
  'O fechamento de caixa está saudável?',
];

type FinancialTab = 'overview' | 'ledger' | 'closing' | 'commissions' | 'ai';
type Period = 'today' | 'month' | 'all';

const INCOME_CATEGORIES = ['Procedimento Clínico', 'Orçamento/Tratamento', 'Consulta', 'Outros Recebimentos'];
const EXPENSE_CATEGORIES = ['Aluguel', 'Laboratório', 'Materiais', 'Folha/Equipe', 'Comissão', 'Impostos', 'Marketing', 'Sistema/Software', 'Manutenção', 'Outros'];
const PAYMENT_METHODS = ['PIX', 'Dinheiro', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência'];

function bucketForPaymentMethod(pm?: string): 'dinheiro' | 'cartao' | 'pix' | 'transferencia' | 'outros' {
  const s = (pm || '').toLowerCase();
  if (s.includes('dinheiro')) return 'dinheiro';
  if (s.includes('pix')) return 'pix';
  if (s.includes('cart') || s.includes('crédito') || s.includes('credito') || s.includes('débito') || s.includes('debito') || s.includes('máquina') || s.includes('maquina')) return 'cartao';
  if (s.includes('transfer')) return 'transferencia';
  return 'outros';
}

const STATUS_META: Record<string, { label: string; classes: string }> = {
  pending: { label: 'Pendente', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  partial: { label: 'Parcial', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
  paid: { label: 'Pago', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  cancelled: { label: 'Cancelado', classes: 'bg-slate-800 border-next-border text-slate-500' },
};

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toDate(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v?.toDate === 'function') return v.toDate();
    if (v?.seconds !== undefined) return new Date(v.seconds * 1000);
    if (typeof v === 'string') {
      const dateOnly = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnly) {
        return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12, 0, 0, 0);
      }
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function formatDate(v: any): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString('pt-BR') : '—';
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function toDateInputValue(v: any): string {
  const d = toDate(v) || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface EntryFormState {
  id: string | null;
  type: 'income' | 'expense';
  category: string;
  description: string;
  totalAmount: string;
  paidAmount: string;
  status: 'pending' | 'partial' | 'paid' | 'cancelled';
  paymentMethod: string;
  dueDate: string;
  patientId: string;
  /** Optional, only set when staff explicitly picks who performed the procedure — never inferred. Needed for temporal "desempenho por profissional" by revenue. */
  professionalId: string;
  /** Status this entry had when the form was opened — null for a brand-new entry. Used only to detect a real pending→paid transition (see handleSaveEntry) so editing an already-paid entry never clobbers its real paidAt. */
  originalStatus: 'pending' | 'partial' | 'paid' | 'cancelled' | null;
}

const EMPTY_FORM: EntryFormState = {
  id: null,
  type: 'income',
  category: INCOME_CATEGORIES[0],
  description: '',
  totalAmount: '',
  paidAmount: '',
  status: 'pending',
  paymentMethod: 'PIX',
  dueDate: toDateInputValue(new Date()),
  patientId: '',
  professionalId: '',
  originalStatus: null,
};

export default function NextFinancial() {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;

  const [activeTab, setActiveTab] = useState<FinancialTab>('overview');
  const [period, setPeriod] = useState<Period>('month');
  const [entries, setEntries] = useState<FinancialEntryRow[]>([]);
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'paid' | 'cancelled'>('all');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<EntryFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [receivingEntry, setReceivingEntry] = useState<FinancialEntryRow | null>(null);
  const [receiveAmountInput, setReceiveAmountInput] = useState('');
  const [confirmingReceive, setConfirmingReceive] = useState(false);

  const [closings, setClosings] = useState<ClosingRow[]>([]);
  const [selectedClosingDate, setSelectedClosingDate] = useState(toDateInputValue(new Date()));
  const [closingForm, setClosingForm] = useState({ cash: '', machine: '', pix: '', transfer: '', other: '', observations: '' });
  const [savingClosing, setSavingClosing] = useState(false);
  const [deletingClosingId, setDeletingClosingId] = useState<string | null>(null);

  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([]);
  const [commissionSettings, setCommissionSettings] = useState<Record<string, CommissionSetting>>({});
  const [commissionRecords, setCommissionRecords] = useState<CommissionRecord[]>([]);
  const [legacyCommissions, setLegacyCommissions] = useState<LegacyCommissionRow[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [savingSettingId, setSavingSettingId] = useState<string | null>(null);
  const [commissionForm, setCommissionForm] = useState({ financialEntryId: '', professionalId: '', percent: '', notes: '' });
  const [savingCommission, setSavingCommission] = useState(false);
  const [updatingCommissionId, setUpdatingCommissionId] = useState<string | null>(null);
  const [deletingCommissionId, setDeletingCommissionId] = useState<string | null>(null);

  const [iaQuestion, setIaQuestion] = useState('');
  const [iaAnalyzing, setIaAnalyzing] = useState(false);
  const [iaError, setIaError] = useState<string | null>(null);
  const [iaResult, setIaResult] = useState<FinancialAiReport | null>(null);
  const [iaSavingReport, setIaSavingReport] = useState(false);
  const [iaReports, setIaReports] = useState<FinancialAiReport[]>([]);
  const [iaExpandedReportId, setIaExpandedReportId] = useState<string | null>(null);
  const [iaConversation, setIaConversation] = useState<{ question: string; summary: string }[]>([]);
  const [iaAutoRan, setIaAutoRan] = useState(false);

  const receiptFileInputRef = useRef<HTMLInputElement>(null);
  const [iaReceiptFiles, setIaReceiptFiles] = useState<ReceiptFile[]>([]);
  const [iaAnalyzingReceipts, setIaAnalyzingReceipts] = useState(false);
  const [iaReceiptError, setIaReceiptError] = useState<string | null>(null);
  const [iaExtractedReceipts, setIaExtractedReceipts] = useState<ExtractedReceipt[] | null>(null);
  const [iaReceiptsSummary, setIaReceiptsSummary] = useState('');
  const [iaCommittingReceipts, setIaCommittingReceipts] = useState(false);

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 4000);
  }

  async function loadData() {
    if (!clinic?.id) return;
    setLoading(true);
    try {
      const finRef = collection(db, 'clinics', clinic.id, 'financial_entries');
      const finSnap = await secureGetDocs(query(finRef, limit(3000)), 'financial_entries', { addAuditLog });
      const rows: FinancialEntryRow[] = [];
      finSnap.forEach(d => {
        const n = normalizeFinancialEntry({ id: d.id, ...d.data() });
        if (n) rows.push(n);
      });
      rows.sort((a, b) => {
        const da = toDate(a.dueDate)?.getTime() || 0;
        const db_ = toDate(b.dueDate)?.getTime() || 0;
        return db_ - da;
      });
      setEntries(rows);

      const patRef = collection(db, 'clinics', clinic.id, 'patients');
      const patSnap = await secureGetDocs(query(patRef, limit(8000)), 'patients', { addAuditLog });
      setPatients(patSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || 'Sem nome' })));

      const closingsRef = collection(db, 'clinics', clinic.id, 'daily_closings');
      const closingsSnap = await secureGetDocs(query(closingsRef, limit(120)), 'daily_closings', { addAuditLog });
      const closingRows: ClosingRow[] = closingsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      closingRows.sort((a, b) => (a.date < b.date ? 1 : -1));
      setClosings(closingRows);

      let teamSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'team_members'), limit(100)), 'team_members', { addAuditLog });
      if (teamSnap.empty) {
        teamSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'members'), limit(100)), 'members', { addAuditLog });
      }
      const teamRows: TeamMemberLite[] = teamSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || (d.data() as any).displayName || 'Sem nome' }));
      setTeamMembers(teamRows);

      const settingsSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'commission_settings'), limit(100)), 'commission_settings', { addAuditLog });
      const settingsMap: Record<string, CommissionSetting> = {};
      settingsSnap.docs.forEach(d => { settingsMap[d.id] = d.data() as CommissionSetting; });
      setCommissionSettings(settingsMap);

      const recordsSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'commission_records'), limit(300)), 'commission_records', { addAuditLog });
      const recordRows: CommissionRecord[] = recordsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      recordRows.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
      setCommissionRecords(recordRows);

      const legacyRows: LegacyCommissionRow[] = [];
      try {
        const legacyASnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'commissions'), limit(150)), 'commissions', { addAuditLog });
        legacyASnap.docs.forEach(d => {
          const data = d.data() as any;
          legacyRows.push({
            id: d.id,
            professionalName: data.member_name || data.professionalName || 'Profissional',
            amount: Number(data.commission_amount ?? data.fixed_amount ?? 0),
            status: data.status || 'pending',
            date: data.generated_at || data.paid_at || data.createdAt,
            origin: 'Clínica/Procedimento',
          });
        });
      } catch { /* legacy collection may not exist in this clinic */ }
      try {
        const legacyBSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'commercial_sale_commissions'), limit(150)), 'commercial_sale_commissions', { addAuditLog });
        legacyBSnap.docs.forEach(d => {
          const data = d.data() as any;
          legacyRows.push({
            id: d.id,
            professionalName: data.responsibleName || data.responsibleId || 'Profissional',
            amount: Number(data.commissionValue ?? 0),
            status: data.status || 'pending',
            date: data.createdAt || data.date,
            origin: 'Comercial',
          });
        });
      } catch { /* legacy collection may not exist in this clinic */ }
      legacyRows.sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
      setLegacyCommissions(legacyRows);

      const reportsSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'financial_ai_reports'), limit(30)), 'financial_ai_reports', { addAuditLog });
      const reportRows: FinancialAiReport[] = reportsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      reportRows.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
      setIaReports(reportRows);
    } catch (err) {
      console.error('Failed to load financial data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  useEffect(() => {
    if (iaReports.length > 0 && iaConversation.length === 0) {
      setIaConversation(iaReports.slice(0, 4).slice().reverse().map(r => ({ question: r.question, summary: r.summary })));
    }
  }, [iaReports]);

  useEffect(() => {
    if (activeTab === 'ai' && !iaAutoRan && !loading && clinic?.id) {
      setIaAutoRan(true);
      handleAskFinancialAI('Dê um diagnóstico rápido da situação financeira agora e uma dica prática.', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loading, iaAutoRan, clinic?.id]);

  const now = new Date();

  function inPeriod(d: Date | null, p: Period): boolean {
    if (!d) return false;
    if (p === 'today') return isSameDay(d, now);
    if (p === 'month') return isSameMonth(d, now);
    return true;
  }

  const periodLabel = period === 'today' ? 'hoje' : period === 'month' ? 'este mês' : 'no total';

  const kpis = useMemo(() => {
    let received = 0, expensePaid = 0;
    let receivable = 0, payable = 0, overdueCount = 0, overdueAmount = 0;

    for (const e of entries) {
      const dueD = toDate(e.dueDate);
      const paidD = toDate(e.paidAt) || dueD;

      if (e.status === 'cancelled') continue;

      if (e.type === 'income') {
        if ((e.status === 'paid' || e.status === 'partial') && paidD && inPeriod(paidD, period)) {
          received += e.paidAmount;
        }
        if ((e.status === 'pending' || e.status === 'partial') && dueD && inPeriod(dueD, period)) {
          receivable += e.pendingAmount;
          if (dueD < now && !isSameDay(dueD, now)) {
            overdueCount++;
            overdueAmount += e.pendingAmount;
          }
        }
      } else {
        if ((e.status === 'paid' || e.status === 'partial') && paidD && inPeriod(paidD, period)) {
          expensePaid += e.paidAmount;
        }
        if ((e.status === 'pending' || e.status === 'partial') && dueD && inPeriod(dueD, period)) {
          payable += e.pendingAmount;
        }
      }
    }

    return {
      received,
      expensePaid,
      balance: received - expensePaid,
      receivable,
      payable,
      overdueCount,
      overdueAmount,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, period]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.type !== 'expense') continue;
      const d = toDate(e.paidAt) || toDate(e.dueDate);
      if (!inPeriod(d, period)) continue;
      if (e.status !== 'paid' && e.status !== 'partial') continue;
      map.set(e.category, (map.get(e.category) || 0) + e.paidAmount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, period]);

  const aiSummaryTotals = useMemo(() => {
    let receivedToday = 0, receivedMonth = 0, expensePaidMonth = 0;
    for (const e of entries) {
      if (e.status === 'cancelled') continue;
      const paidD = toDate(e.paidAt) || toDate(e.dueDate);
      if (!paidD || (e.status !== 'paid' && e.status !== 'partial')) continue;
      if (e.type === 'income') {
        if (isSameDay(paidD, now)) receivedToday += e.paidAmount;
        if (isSameMonth(paidD, now)) receivedMonth += e.paidAmount;
      } else if (isSameMonth(paidD, now)) {
        expensePaidMonth += e.paidAmount;
      }
    }
    return { receivedToday, receivedMonth, expensePaidMonth, balanceMonth: receivedMonth - expensePaidMonth };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  useElizaStandingGapCheck('financeiro_open');

  useSetElizaScreenContext(
    'Financeiro',
    entries.length === 0 ? '' : [
      `Período selecionado na tela: ${periodLabel}.`,
      `Recebido ${periodLabel}: ${formatCurrency(kpis.received)}. Pago ${periodLabel}: ${formatCurrency(kpis.expensePaid)}. Saldo: ${formatCurrency(kpis.balance)}.`,
      `A receber (${periodLabel}): ${formatCurrency(kpis.receivable)}. A pagar (${periodLabel}): ${formatCurrency(kpis.payable)}.`,
      `Contas vencidas (${periodLabel}): ${kpis.overdueCount} lançamento(s), totalizando ${formatCurrency(kpis.overdueAmount)}.`,
      categoryBreakdown.length > 0 ? `Maiores categorias de despesa no período: ${categoryBreakdown.map(([cat, val]) => `${cat} (${formatCurrency(val)})`).join(', ')}.` : '',
      `Total de lançamentos carregados: ${entries.length}.`,
    ].filter(Boolean).join('\n')
  );

  const recentEntries = useMemo(() => entries.slice(0, 6), [entries]);
  const upcomingReceivables = useMemo(() => {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return entries
      .filter(e => e.type === 'income' && (e.status === 'pending' || e.status === 'partial'))
      .filter(e => { const d = toDate(e.dueDate); return d && d >= startOfToday && d <= in7d; })
      .sort((a, b) => (toDate(a.dueDate)?.getTime() || 0) - (toDate(b.dueDate)?.getTime() || 0))
      .slice(0, 6);
  }, [entries]);

  const filteredLedger = useMemo(() => {
    return entries.filter(e => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (period !== 'all') {
        const d = toDate(e.dueDate);
        if (!d) return false;
        if (period === 'today' && !isSameDay(d, now)) return false;
        if (period === 'month' && !isSameMonth(d, now)) return false;
      }
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        if (!e.description.toLowerCase().includes(s) && !(e.patientName || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [entries, typeFilter, statusFilter, period, searchTerm]);

  function openCreate(type: 'income' | 'expense') {
    setForm({ ...EMPTY_FORM, type, category: type === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0] });
    setIsFormOpen(true);
  }

  function openEdit(e: FinancialEntryRow) {
    setForm({
      id: e.id,
      type: e.type,
      category: e.category,
      description: e.description,
      totalAmount: String(e.totalAmount || ''),
      paidAmount: String(e.paidAmount || ''),
      status: e.status,
      paymentMethod: e.paymentMethod || 'PIX',
      dueDate: toDateInputValue(e.dueDate),
      patientId: e.patientId || '',
      professionalId: e.professionalId || '',
      originalStatus: e.status,
    });
    setIsFormOpen(true);
  }

  async function handleSaveEntry() {
    if (!clinic?.id || !form.description.trim() || !form.totalAmount) return;
    setSaving(true);
    try {
      const totalAmount = Number(form.totalAmount) || 0;
      let paidAmount = Number(form.paidAmount) || 0;
      let status = form.status;
      if (status === 'paid') paidAmount = totalAmount;
      if (status === 'pending') paidAmount = 0;
      if (status !== 'cancelled') {
        if (paidAmount <= 0) status = 'pending';
        else if (paidAmount >= totalAmount) status = 'paid';
        else status = 'partial';
      }
      const pendingAmount = status === 'cancelled' ? 0 : Math.max(0, totalAmount - paidAmount);
      const patient = patients.find(p => p.id === form.patientId);
      const professional = teamMembers.find(m => m.id === form.professionalId);

      // Only stamp a NEW paidAt when this save is the actual moment the
      // entry becomes paid/partial (a real "payment confirmed" event).
      // Editing an already-settled entry for an unrelated reason (fixing
      // the description, category, etc.) must never overwrite its real
      // payment date with "now" — that was a real bug in the previous
      // version of this form, which stamped paidAt on every single save.
      const wasAlreadySettled = form.originalStatus === 'paid' || form.originalStatus === 'partial';
      const isBecomingSettled = status === 'paid' || status === 'partial';
      const isNewPaymentEvent = isBecomingSettled && !wasAlreadySettled;

      const basePayload: Record<string, any> = {
        type: form.type,
        category: form.category,
        description: form.description.trim(),
        amount: totalAmount,
        paidAmount,
        pendingAmount,
        status,
        paymentMethod: form.paymentMethod,
        date: new Date(`${form.dueDate}T12:00:00`).toISOString(),
        patientId: form.patientId || null,
        patientName: patient?.name || null,
        // Only set when staff explicitly picks a professional here — a
        // reliable link for "desempenho por profissional" by revenue,
        // never inferred from the appointment or anything else.
        professionalId: form.professionalId || null,
        professionalName: professional?.name || null,
        source: 'manual',
        updatedAt: serverTimestamp(),
      };
      // Server-side timestamp — immune to client clock skew — stamped only
      // on the real transition described above. Not included at all when
      // it's not a new payment event, so updateDoc leaves any existing
      // paidAt on the document untouched.
      if (isNewPaymentEvent) basePayload.paidAt = serverTimestamp();
      else if (!isBecomingSettled) basePayload.paidAt = null;

      if (form.id) {
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', form.id), basePayload);
        if (form.originalStatus !== status) {
          logStatusEvent(clinic.id, {
            entityType: 'financial_entry',
            entityId: form.id,
            eventType: 'financial_entry_status_changed',
            patientId: form.patientId || null,
            fromStatus: form.originalStatus,
            toStatus: status,
            metadata: { description: basePayload.description, amount: totalAmount },
          }, user?.uid);
        }
        addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento "${basePayload.description}" atualizado (escrita real).` });
        showMessage('Lançamento atualizado.');
      } else {
        const ref = await addDoc(collection(db, 'clinics', clinic.id, 'financial_entries'), {
          ...basePayload,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'eliza_next',
        });
        if (isBecomingSettled) {
          logStatusEvent(clinic.id, {
            entityType: 'financial_entry',
            entityId: ref.id,
            eventType: 'financial_entry_status_changed',
            patientId: form.patientId || null,
            fromStatus: null,
            toStatus: status,
            metadata: { description: basePayload.description, amount: totalAmount },
          }, user?.uid);
        }
        addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento "${basePayload.description}" (${formatCurrency(totalAmount)}) criado (escrita real).` });
        showMessage('Lançamento criado.');
      }
      setIsFormOpen(false);
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  }

  function openReceive(e: FinancialEntryRow) {
    setReceivingEntry(e);
    const saldo = e.pendingAmount || e.totalAmount;
    setReceiveAmountInput(String(saldo));
  }
  function closeReceive() {
    setReceivingEntry(null);
    setReceiveAmountInput('');
  }

  // Fase C: aceita valor parcial. Total -> mesmo comportamento de antes +
  // receivedBy. Parcial -> este doc vira o recibo de hoje (reduzido ao
  // valor recebido) e um doc NOVO nasce com o saldo em aberto — via
  // writeBatch, as duas escritas são atômicas (tudo ou nada).
  async function handleConfirmSettlement(e: FinancialEntryRow, receivedAmountRaw: number) {
    if (!clinic?.id) return;
    const saldoPendente = e.pendingAmount || e.totalAmount;
    const EPS = 0.005;
    const receivedAmount = Math.round((Number(receivedAmountRaw) || 0) * 100) / 100;
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      showMessage('Informe um valor válido maior que zero.');
      return;
    }
    const isFullPayment = receivedAmount >= saldoPendente - EPS;
    const wasCapped = receivedAmount > saldoPendente + EPS;
    const receivedByName = profile?.name || user?.email || 'Usuário';

    setConfirmingReceive(true);
    try {
      if (isFullPayment) {
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', e.id), {
          status: 'paid',
          paidAmount: e.totalAmount,
          pendingAmount: 0,
          // Server-side clock — this button IS the "payment confirmed now"
          // action, so always stamping is correct here (unlike the edit form).
          paidAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          receivedBy: user?.uid || null,
          receivedByName,
        });
        logStatusEvent(clinic.id, {
          entityType: 'financial_entry',
          entityId: e.id,
          eventType: 'financial_entry_status_changed',
          patientId: e.patientId || null,
          fromStatus: e.status,
          toStatus: 'paid',
          metadata: { description: e.description, amount: e.totalAmount },
        }, user?.uid);
        addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `"${e.description}" marcado como ${e.type === 'income' ? 'recebido' : 'pago'} por ${receivedByName} (escrita real).` });
        showMessage(wasCapped ? 'Valor informado era maior que o saldo — considerado o saldo total.' : (e.type === 'income' ? 'Marcado como recebido.' : 'Marcado como pago.'));
      } else {
        const remainder = Math.round((saldoPendente - receivedAmount) * 100) / 100;
        // Leitura fresca do doc bruto — normalizeFinancialEntry não devolve
        // groupId/quotationRef/professionalUid/installmentIndex/installmentTotal,
        // então esses campos de linhagem não existem em `e` (FinancialEntryRow).
        const rawSnap = await getDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', e.id));
        const raw: any = rawSnap.data() || {};
        const groupId = raw.groupId || `fin-split-${e.id}-${Date.now()}`;

        const patch: Record<string, any> = {
          amount: receivedAmount, paidAmount: receivedAmount, pendingAmount: 0, status: 'paid',
          paidAt: serverTimestamp(), updatedAt: serverTimestamp(),
          receivedBy: user?.uid || null, receivedByName, groupId,
        };
        const newRef = fsDoc(collection(db, 'clinics', clinic.id, 'financial_entries'));
        const remainderPayload: Record<string, any> = {
          patientId: e.patientId || null, patientName: e.patientName || null,
          type: e.type, category: e.category, description: e.description,
          amount: remainder, paidAmount: 0, pendingAmount: remainder, status: 'pending',
          paymentMethod: e.paymentMethod || 'PIX', date: e.dueDate || new Date().toISOString(),
          professionalId: e.professionalId ?? null, professionalName: e.professionalName ?? null,
          source: e.source || 'manual', groupId,
          quotationRef: raw.quotationRef ?? null,
          professionalUid: raw.professionalUid ?? null,
          installmentIndex: raw.installmentIndex,
          installmentTotal: raw.installmentTotal,
          createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_next',
        };
        Object.keys(remainderPayload).forEach(k => remainderPayload[k] === undefined && delete remainderPayload[k]);

        const batch = writeBatch(db);
        batch.update(fsDoc(db, 'clinics', clinic.id, 'financial_entries', e.id), patch);
        batch.set(newRef, remainderPayload);
        await batch.commit();

        logStatusEvent(clinic.id, {
          entityType: 'financial_entry',
          entityId: e.id,
          eventType: 'financial_entry_status_changed',
          patientId: e.patientId || null,
          fromStatus: e.status,
          toStatus: 'paid',
          metadata: { description: e.description, amount: receivedAmount },
        }, user?.uid);
        addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `"${e.description}" recebido parcialmente (${formatCurrency(receivedAmount)}) por ${receivedByName}; saldo de ${formatCurrency(remainder)} lançado como novo pendente (escrita real).` });
        showMessage(`Recebido ${formatCurrency(receivedAmount)}. Saldo de ${formatCurrency(remainder)} lançado como novo pendente.`);
      }
      closeReceive();
      await loadData();
    } catch (err: any) {
      showMessage(`Falha: ${err?.message || err}`);
    } finally {
      setConfirmingReceive(false);
    }
  }

  async function handleDeleteEntry(e: FinancialEntryRow) {
    if (!clinic?.id || !isAdmin) return;
    if (!window.confirm(`Excluir o lançamento "${e.description}" de verdade? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(e.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', e.id));
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento "${e.description}" excluído (escrita real).` });
      showMessage('Lançamento excluído.');
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setDeletingId(null);
    }
  }

  // --- Fechamento de Caixa ------------------------------------------------

  const systemTotalsForSelectedDate = useMemo(() => {
    const buckets = { dinheiro: 0, cartao: 0, pix: 0, transferencia: 0, outros: 0 };
    for (const e of entries) {
      if (e.type !== 'income' || (e.status !== 'paid' && e.status !== 'partial')) continue;
      const d = toDate(e.paidAt) || toDate(e.dueDate);
      if (!d || toDateInputValue(d) !== selectedClosingDate) continue;
      const bucket = bucketForPaymentMethod(e.paymentMethod);
      buckets[bucket] += e.paidAmount;
    }
    const total = buckets.dinheiro + buckets.cartao + buckets.pix + buckets.transferencia + buckets.outros;
    return { ...buckets, total };
  }, [entries, selectedClosingDate]);

  const existingClosing = useMemo(() => closings.find(c => c.date === selectedClosingDate) || null, [closings, selectedClosingDate]);

  const closingTotalEntered = (Number(closingForm.cash) || 0) + (Number(closingForm.machine) || 0) + (Number(closingForm.pix) || 0) + (Number(closingForm.transfer) || 0) + (Number(closingForm.other) || 0);
  const closingDifference = closingTotalEntered - systemTotalsForSelectedDate.total;

  async function handleSaveClosing() {
    if (!clinic?.id || existingClosing) return;
    setSavingClosing(true);
    try {
      const payload: Omit<ClosingRow, 'id'> = {
        date: selectedClosingDate,
        cashAmount: Number(closingForm.cash) || 0,
        machineAmount: Number(closingForm.machine) || 0,
        pixAmount: Number(closingForm.pix) || 0,
        transferAmount: Number(closingForm.transfer) || 0,
        otherAmount: Number(closingForm.other) || 0,
        totalAmount: closingTotalEntered,
        systemTotal: systemTotalsForSelectedDate.total,
        difference: closingTotalEntered - systemTotalsForSelectedDate.total,
        status: Math.abs(closingTotalEntered - systemTotalsForSelectedDate.total) < 0.01 ? 'balanced' : 'unbalanced',
        observations: closingForm.observations.trim(),
        closedBy: user?.email || user?.uid || 'eliza_next',
        createdAt: serverTimestamp(),
      };
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'daily_closings', selectedClosingDate), payload);
      addAuditLog({ collection: 'daily_closings', action: 'WRITE', status: 'SUCCESS', details: `Fechamento de caixa de ${formatDate(selectedClosingDate)} registrado (escrita real).` });
      showMessage('Fechamento de caixa registrado.');
      setClosingForm({ cash: '', machine: '', pix: '', transfer: '', other: '', observations: '' });
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao gravar fechamento: ${err?.message || err}`);
    } finally {
      setSavingClosing(false);
    }
  }

  async function handleDeleteClosing(c: ClosingRow) {
    if (!clinic?.id || !isAdmin) return;
    if (!window.confirm(`Excluir o fechamento de ${formatDate(c.date)} de verdade? Você poderá refazê-lo depois.`)) return;
    setDeletingClosingId(c.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'daily_closings', c.id));
      addAuditLog({ collection: 'daily_closings', action: 'WRITE', status: 'SUCCESS', details: `Fechamento de ${formatDate(c.date)} excluído (escrita real).` });
      showMessage('Fechamento excluído.');
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setDeletingClosingId(null);
    }
  }

  function handlePrintClosing(c: ClosingRow) {
    const win = window.open('', '_blank', 'width=680,height=860');
    if (!win) return;
    const html = `<!doctype html><html><head><title>Fechamento de Caixa ${formatDate(c.date)}</title>
      <style>
        body { font-family: -apple-system, Segoe UI, sans-serif; padding: 32px; color: #0f172a; }
        h1 { font-size: 18px; margin-bottom: 2px; }
        p.sub { color: #64748b; font-size: 12px; margin-top: 0; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        td { padding: 7px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        td:last-child { text-align: right; font-weight: 600; }
        .total td { font-weight: 700; font-size: 15px; border-top: 2px solid #0f172a; border-bottom: none; }
        .diff { font-weight: 700; color: ${c.status === 'balanced' ? '#16a34a' : '#dc2626'}; }
        .obs { font-size: 12px; color: #334155; white-space: pre-wrap; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
      </style></head><body>
      <h1>Fechamento de Caixa — ${clinic?.name || 'Clínica'}</h1>
      <p class="sub">Data: ${formatDate(c.date)} · Responsável: ${c.closedBy} · Status: ${c.status === 'balanced' ? 'Batido' : 'Com diferença'}</p>
      <table>
        <tr><td>Dinheiro</td><td>${formatCurrency(c.cashAmount)}</td></tr>
        <tr><td>Cartão</td><td>${formatCurrency(c.machineAmount)}</td></tr>
        <tr><td>PIX</td><td>${formatCurrency(c.pixAmount)}</td></tr>
        <tr><td>Transferência</td><td>${formatCurrency(c.transferAmount)}</td></tr>
        <tr><td>Outros</td><td>${formatCurrency(c.otherAmount)}</td></tr>
        <tr class="total"><td>Total contado</td><td>${formatCurrency(c.totalAmount)}</td></tr>
        <tr><td>Total no sistema</td><td>${formatCurrency(c.systemTotal)}</td></tr>
        <tr><td>Diferença</td><td class="diff">${formatCurrency(c.difference)}</td></tr>
      </table>
      ${c.observations ? `<p><strong>Observações:</strong></p><div class="obs">${c.observations.replace(/</g, '&lt;')}</div>` : ''}
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  // --- Comissões (modelo único, vai pra frente) ---------------------------

  const usedFinancialEntryIds = useMemo(() => new Set(commissionRecords.filter(r => r.status !== 'cancelled' && r.financialEntryId).map(r => r.financialEntryId as string)), [commissionRecords]);

  const eligibleEntriesForCommission = useMemo(() => {
    return entries.filter(e => e.type === 'income' && (e.status === 'paid' || e.status === 'partial') && !usedFinancialEntryIds.has(e.id));
  }, [entries, usedFinancialEntryIds]);

  const commissionKpis = useMemo(() => {
    let pending = 0, approved = 0, paidMonth = 0;
    for (const r of commissionRecords) {
      if (r.status === 'pending') pending += r.commissionAmount;
      else if (r.status === 'approved') approved += r.commissionAmount;
      else if (r.status === 'paid') {
        const d = toDate(r.paidAt);
        if (d && isSameMonth(d, now)) paidMonth += r.commissionAmount;
      }
    }
    return { pending, approved, paidMonth };
  }, [commissionRecords]);

  function settingFor(professionalId: string): CommissionSetting | undefined {
    return commissionSettings[professionalId];
  }

  async function handleSaveCommissionSetting(member: TeamMemberLite) {
    if (!clinic?.id) return;
    const raw = settingsDraft[member.id];
    const percent = raw !== undefined ? Number(raw) : (settingFor(member.id)?.defaultPercent || 0);
    setSavingSettingId(member.id);
    try {
      const payload: CommissionSetting = { professionalId: member.id, professionalName: member.name, defaultPercent: percent, active: true };
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'commission_settings', member.id), { ...payload, updatedAt: serverTimestamp(), updatedBy: user?.uid || 'eliza_next' });
      addAuditLog({ collection: 'commission_settings', action: 'WRITE', status: 'SUCCESS', details: `Percentual de comissão de "${member.name}" definido em ${percent}% (escrita real).` });
      setCommissionSettings(prev => ({ ...prev, [member.id]: payload }));
      showMessage(`Percentual de ${member.name} salvo.`);
    } catch (err: any) {
      showMessage(`Falha ao salvar: ${err?.message || err}`);
    } finally {
      setSavingSettingId(null);
    }
  }

  const selectedEntryForCommission = entries.find(e => e.id === commissionForm.financialEntryId) || null;
  const commissionPercentValue = Number(commissionForm.percent) || 0;
  const commissionAmountPreview = selectedEntryForCommission ? (selectedEntryForCommission.paidAmount * commissionPercentValue) / 100 : 0;

  async function handleGenerateCommission() {
    if (!clinic?.id || !selectedEntryForCommission || !commissionForm.professionalId) return;
    setSavingCommission(true);
    try {
      const professional = teamMembers.find(m => m.id === commissionForm.professionalId);
      const payload = {
        professionalId: commissionForm.professionalId,
        professionalName: professional?.name || 'Profissional',
        financialEntryId: selectedEntryForCommission.id,
        patientId: selectedEntryForCommission.patientId,
        patientName: selectedEntryForCommission.patientName,
        description: selectedEntryForCommission.description,
        baseAmount: selectedEntryForCommission.paidAmount,
        percent: commissionPercentValue,
        commissionAmount: commissionAmountPreview,
        status: 'pending' as const,
        notes: commissionForm.notes.trim(),
        source: 'manual',
        createdAt: serverTimestamp(),
        createdBy: user?.uid || 'eliza_next',
      };
      await addDoc(collection(db, 'clinics', clinic.id, 'commission_records'), payload);
      addAuditLog({ collection: 'commission_records', action: 'WRITE', status: 'SUCCESS', details: `Comissão de ${formatCurrency(commissionAmountPreview)} gerada para "${payload.professionalName}" (escrita real).` });
      showMessage('Comissão lançada.');
      setCommissionForm({ financialEntryId: '', professionalId: '', percent: '', notes: '' });
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao lançar comissão: ${err?.message || err}`);
    } finally {
      setSavingCommission(false);
    }
  }

  async function handleUpdateCommissionStatus(record: CommissionRecord, status: CommissionRecord['status']) {
    if (!clinic?.id) return;
    setUpdatingCommissionId(record.id);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'commission_records', record.id), {
        status,
        paidAt: status === 'paid' ? new Date().toISOString() : (record.paidAt || null),
        updatedAt: serverTimestamp(),
      });
      addAuditLog({ collection: 'commission_records', action: 'WRITE', status: 'SUCCESS', details: `Comissão de "${record.professionalName}" marcada como ${COMMISSION_STATUS_META[status].label.toLowerCase()} (escrita real).` });
      showMessage(`Comissão marcada como ${COMMISSION_STATUS_META[status].label.toLowerCase()}.`);
      await loadData();
    } catch (err: any) {
      showMessage(`Falha: ${err?.message || err}`);
    } finally {
      setUpdatingCommissionId(null);
    }
  }

  async function handleDeleteCommission(record: CommissionRecord) {
    if (!clinic?.id || !isAdmin) return;
    if (!window.confirm(`Excluir a comissão de "${record.professionalName}" de verdade?`)) return;
    setDeletingCommissionId(record.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'commission_records', record.id));
      addAuditLog({ collection: 'commission_records', action: 'WRITE', status: 'SUCCESS', details: `Comissão de "${record.professionalName}" excluída (escrita real).` });
      showMessage('Comissão excluída.');
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setDeletingCommissionId(null);
    }
  }

  // --- IA Financeira -------------------------------------------------------

  async function handleAskFinancialAI(questionOverride?: string, isAutomatic = false) {
    const question = (questionOverride ?? iaQuestion).trim();
    if (!question) return;
    setIaAnalyzing(true);
    setIaError(null);
    setIaResult(null);
    try {
      const lastClosing = closings[0];
      const topExpenses = categoryBreakdown.map(([cat, val]) => `${cat}: ${formatCurrency(val)}`).join(', ') || 'sem despesas pagas este mês';

      const context = `Dados reais desta clínica (ano/mês corrente):
- Recebido hoje: ${formatCurrency(aiSummaryTotals.receivedToday)}
- Recebido no mês: ${formatCurrency(aiSummaryTotals.receivedMonth)}
- Despesas pagas no mês: ${formatCurrency(aiSummaryTotals.expensePaidMonth)}
- Saldo do mês: ${formatCurrency(aiSummaryTotals.balanceMonth)}
- A receber (pendente/parcial): ${formatCurrency(kpis.receivable)}
- A pagar (pendente/parcial): ${formatCurrency(kpis.payable)}
- Contas vencidas: ${kpis.overdueCount} lançamento(s), totalizando ${formatCurrency(kpis.overdueAmount)}
- Maiores categorias de despesa no mês: ${topExpenses}
- Comissões pendentes: ${formatCurrency(commissionKpis.pending)}; aprovadas a pagar: ${formatCurrency(commissionKpis.approved)}
- Último fechamento de caixa: ${lastClosing ? `${formatDate(lastClosing.date)}, status ${lastClosing.status === 'balanced' ? 'batido' : 'com diferença de ' + formatCurrency(lastClosing.difference)}` : 'nenhum fechamento registrado ainda'}`;

      const memoryBlock = iaConversation.length > 0
        ? `\nHistórico recente da conversa com este usuário (use para não repetir e para dar continuidade, mas responda focado na pergunta atual):\n${iaConversation.map((m, i) => `${i + 1}. Perguntou: "${m.question}" — Você respondeu: "${m.summary}"`).join('\n')}\n`
        : '';

      const prompt = `Você é a Eliza, consultora financeira sênior de uma clínica odontológica. Use SOMENTE os dados reais abaixo — nunca invente números que não foram informados.

${context}
${memoryBlock}
Pergunta atual do usuário: "${question}"

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, exatamente neste formato:
{"summary":"resposta direta à pergunta em 2-4 frases, citando os números reais relevantes","risks":["risco financeiro concreto 1"],"opportunities":["oportunidade concreta 1"],"recommendedActions":["ação prática recomendada 1"]}
Seja específico e prático, como um CFO explicando para o dono da clínica. Se não houver dados suficientes para responder algo, diga isso explicitamente em vez de inventar.`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'financial_analysis',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente reformular a pergunta.');
      const parsed = JSON.parse(jsonMatch[0]);

      const result: FinancialAiReport = {
        id: '',
        question,
        summary: String(parsed.summary || ''),
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.map(String) : [],
        recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.map(String) : [],
        automatic: isAutomatic,
      };
      setIaResult(result);
      setIaConversation(prev => [...prev.slice(-5), { question, summary: result.summary }]);
      addAuditLog({ collection: 'financial_ai_reports', action: 'WRITE', status: 'SUCCESS', details: `Análise financeira (IA real${isAutomatic ? ', automática' : ''}) gerada para: "${question}".` });
    } catch (err: any) {
      setIaError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setIaAnalyzing(false);
    }
  }

  async function handleSaveIaReport() {
    if (!clinic?.id || !iaResult) return;
    setIaSavingReport(true);
    try {
      const payload = { ...iaResult, id: undefined, createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_next' };
      delete (payload as any).id;
      const ref = await addDoc(collection(db, 'clinics', clinic.id, 'financial_ai_reports'), payload);
      addAuditLog({ collection: 'financial_ai_reports', action: 'WRITE', status: 'SUCCESS', details: `Análise financeira salva no histórico (escrita real).` });
      setIaReports(prev => [{ ...iaResult, id: ref.id }, ...prev]);
      showMessage('Análise salva no histórico.');
    } catch (err: any) {
      showMessage(`Falha ao salvar: ${err?.message || err}`);
    } finally {
      setIaSavingReport(false);
    }
  }

  // --- Comprovantes / recibos → lançamentos + fechamento de caixa (IA) ----

  const handleReceiptFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (iaReceiptFiles.length + files.length > 6) {
      showMessage('Máximo de 6 comprovantes por análise.');
      if (receiptFileInputRef.current) receiptFileInputRef.current.value = '';
      return;
    }
    files.forEach(file => {
      if (file.size > 900000) {
        showMessage(`"${file.name}" é grande demais — use arquivos menores que 900KB.`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setIaReceiptFiles(prev => [...prev, {
          id: `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType: file.type || 'image/jpeg',
          dataUrl: reader.result as string,
        }]);
      };
      reader.readAsDataURL(file);
    });
    if (receiptFileInputRef.current) receiptFileInputRef.current.value = '';
  };

  const removeReceiptFile = (id: string) => setIaReceiptFiles(prev => prev.filter(f => f.id !== id));

  async function handleAnalyzeReceipts() {
    if (iaReceiptFiles.length === 0) return;
    setIaAnalyzingReceipts(true);
    setIaReceiptError(null);
    setIaExtractedReceipts(null);
    try {
      const prompt = `Você é a Eliza, e está ajudando a lançar comprovantes de pagamento/recibos/notas no financeiro real de uma clínica odontológica, para ajudar no fechamento de caixa do dia.

Para CADA imagem anexada, leia o comprovante e extraia os dados reais visíveis nele. Não invente nada que não esteja legível.

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, exatamente neste formato:
{"summary":"resumo curto do que foi lido nos comprovantes","receipts":[{"description":"o que é (ex: recebimento paciente X, compra de material Y)","amount":0,"date":"YYYY-MM-DD","paymentMethod":"PIX|Dinheiro|Cartão de Crédito|Cartão de Débito|Boleto|Transferência ou vazio se ilegível","type":"income|expense","category":"categoria sugerida"}]}
Use "income" quando o comprovante for de um valor recebido de paciente (ex: recibo de pagamento), e "expense" quando for uma nota/recibo de compra ou despesa da clínica. Se a data não estiver legível, use a data de hoje. Se o valor não estiver legível, use 0 e deixe a descrição indicar que precisa revisão manual.`;

      const parts: any[] = [{ text: prompt }];
      iaReceiptFiles.forEach(f => {
        const base64Data = f.dataUrl.split(',')[1];
        if (base64Data) parts.push({ inlineData: { mimeType: f.mimeType, data: base64Data } });
      });

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts }],
        taskType: 'financial_receipt_extraction',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente novamente.');
      const parsed = JSON.parse(jsonMatch[0]);

      const receipts: ExtractedReceipt[] = Array.isArray(parsed.receipts) ? parsed.receipts.map((r: any) => ({
        description: String(r?.description || 'Comprovante sem descrição'),
        amount: Number(r?.amount) || 0,
        date: /^\d{4}-\d{2}-\d{2}$/.test(r?.date) ? r.date : toDateInputValue(new Date()),
        paymentMethod: String(r?.paymentMethod || ''),
        type: r?.type === 'income' ? 'income' : 'expense',
        category: String(r?.category || 'Outros'),
      })) : [];

      setIaExtractedReceipts(receipts);
      setIaReceiptsSummary(String(parsed.summary || ''));
      addAuditLog({ collection: 'financial_entries', action: 'READ', status: 'SUCCESS', details: `Eliza leu ${iaReceiptFiles.length} comprovante(s) e extraiu ${receipts.length} lançamento(s) sugerido(s).` });
    } catch (err: any) {
      setIaReceiptError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setIaAnalyzingReceipts(false);
    }
  }

  function updateExtractedReceipt(index: number, patch: Partial<ExtractedReceipt>) {
    setIaExtractedReceipts(prev => prev ? prev.map((r, i) => i === index ? { ...r, ...patch } : r) : prev);
  }
  function removeExtractedReceiptRow(index: number) {
    setIaExtractedReceipts(prev => prev ? prev.filter((_, i) => i !== index) : prev);
  }

  async function handleCommitReceiptsToLedger() {
    if (!clinic?.id || !iaExtractedReceipts || iaExtractedReceipts.length === 0) return;
    setIaCommittingReceipts(true);
    try {
      for (const r of iaExtractedReceipts) {
        const amount = r.amount || 0;
        await addDoc(collection(db, 'clinics', clinic.id, 'financial_entries'), {
          type: r.type,
          category: r.category || 'Outros',
          description: r.description,
          amount,
          paidAmount: amount,
          pendingAmount: 0,
          status: 'paid',
          paymentMethod: r.paymentMethod || 'Outros',
          date: new Date(`${r.date}T12:00:00`).toISOString(),
          paidAt: new Date(`${r.date}T12:00:00`).toISOString(),
          source: 'manual',
          patientId: null,
          patientName: null,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'eliza_next',
          notes: 'Lançado a partir de comprovante lido pela Eliza IA.',
        });
      }
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `${iaExtractedReceipts.length} lançamento(s) gravado(s) a partir de comprovantes lidos pela Eliza (escrita real).` });
      showMessage(`${iaExtractedReceipts.length} lançamento(s) gravado(s). Eles já aparecem em Lançamentos e entram no cálculo do Fechamento de Caixa do dia.`);
      setIaExtractedReceipts(null);
      setIaReceiptsSummary('');
      setIaReceiptFiles([]);
      await loadData();
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setIaCommittingReceipts(false);
    }
  }

  const TABS: { id: FinancialTab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Visão Geral', icon: Wallet },
    { id: 'ledger', label: 'Lançamentos', icon: Receipt },
    { id: 'closing', label: 'Fechamento de Caixa', icon: ClipboardCheck },
    { id: 'commissions', label: 'Comissões', icon: Calculator },
    { id: 'ai', label: 'IA Financeira', icon: Bot },
  ];

  return (
    <div className="space-y-6 max-w-6xl font-sans pb-24">
      {/* HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6 z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
              <Briefcase className="w-3.5 h-3.5 text-next-purple-neon" />
              <span>CENTRAL FINANCEIRA</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight font-sans">
              Financeiro Inteligente
            </h1>
            <p className="text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
              Lançamentos, fechamento de caixa, comissões e IA financeira reunidos num único lugar, com dados reais desta clínica.
            </p>
          </div>
          <div className="bg-slate-900/80 border border-next-border rounded-next-xl p-4 flex-shrink-0 flex flex-col space-y-1.5 md:min-w-[210px]">
            <span className="text-[10px] font-mono text-slate-500 font-bold uppercase">Status</span>
            <div className="flex items-center gap-1.5 text-next-green-success font-semibold text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-next-green-success animate-pulse" />
              <span>Dados e escrita reais</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight font-mono">
              Lançamentos gravam de verdade em financial_entries desta clínica.
            </p>
          </div>
        </div>
      </div>

      {/* MESSAGE TOAST */}
      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 flex items-center gap-2 text-xs text-slate-200">
            <CheckCircle2 className="w-4 h-4 text-next-green-success flex-shrink-0" />
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-next-border pb-3">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${
                activeTab === t.id ? 'next-brand-gradient-bg text-white' : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-next-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-16 font-mono text-xs text-slate-500">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          Carregando dados financeiros reais...
        </div>
      ) : (
        <>
          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                {(['today', 'month', 'all'] as Period[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-all border ${
                      period === p ? 'bg-next-purple-neon/15 border-next-purple-neon/40 text-next-purple-light' : 'bg-slate-900 border-next-border text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {p === 'today' ? 'HOJE' : p === 'month' ? 'ESTE MÊS' : 'TUDO'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Recebido {periodLabel}</span>
                  <h3 className="text-2xl font-extrabold text-slate-100 tracking-tight font-mono mt-1">{formatCurrency(kpis.received)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Pago {periodLabel}</span>
                  <h3 className="text-2xl font-extrabold text-slate-100 tracking-tight font-mono mt-1">{formatCurrency(kpis.expensePaid)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Saldo {periodLabel}</span>
                  <h3 className={`text-2xl font-extrabold tracking-tight font-mono mt-1 ${kpis.balance >= 0 ? 'text-next-green-success' : 'text-next-red-alert'}`}>{formatCurrency(kpis.balance)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">A Receber ({periodLabel})</span>
                  <h3 className="text-2xl font-extrabold text-slate-100 tracking-tight font-mono mt-1">{formatCurrency(kpis.receivable)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">A Pagar ({periodLabel})</span>
                  <h3 className="text-2xl font-extrabold text-slate-100 tracking-tight font-mono mt-1">{formatCurrency(kpis.payable)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5 border-next-red-alert/30">
                  <span className="text-[10px] font-mono text-next-red-alert font-bold uppercase tracking-wider flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Contas Vencidas ({periodLabel})</span>
                  <h3 className="text-2xl font-extrabold text-next-red-alert tracking-tight font-mono mt-1">{formatCurrency(kpis.overdueAmount)}</h3>
                  <p className="text-[10.5px] text-slate-500 mt-1">{kpis.overdueCount} lançamento(s) em atraso</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Clock className="w-4 h-4 text-next-purple-neon" /> A vencer nos próximos 7 dias</h4>
                  {upcomingReceivables.length === 0 ? (
                    <p className="text-[11px] text-slate-500">Nenhum recebimento pendente vencendo nos próximos 7 dias.</p>
                  ) : (
                    <div className="space-y-2">
                      {upcomingReceivables.map(e => (
                        <div key={e.id} className="flex items-center justify-between text-xs bg-slate-900/40 border border-next-border rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-slate-200 font-semibold truncate">{e.patientName || e.description}</p>
                            <p className="text-[10px] text-slate-500">{formatDate(e.dueDate)}</p>
                          </div>
                          <span className="font-mono font-bold text-slate-300 flex-shrink-0">{formatCurrency(e.pendingAmount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-next-purple-neon" /> Despesas do mês por categoria</h4>
                  {categoryBreakdown.length === 0 ? (
                    <p className="text-[11px] text-slate-500">Nenhuma despesa paga registrada este mês.</p>
                  ) : (
                    <div className="space-y-2">
                      {categoryBreakdown.map(([cat, val]) => {
                        const max = categoryBreakdown[0][1] || 1;
                        return (
                          <div key={cat} className="space-y-1">
                            <div className="flex justify-between text-[11px] font-mono text-slate-400">
                              <span>{cat}</span>
                              <span className="text-slate-300 font-semibold">{formatCurrency(val)}</span>
                            </div>
                            <div className="w-full bg-slate-950 rounded-full h-1.5 border border-next-border/40 overflow-hidden">
                              <div className="bg-next-purple-neon h-full rounded-full" style={{ width: `${(val / max) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-200">Últimos lançamentos</h4>
                  <button onClick={() => setActiveTab('ledger')} className="text-[10.5px] font-bold text-next-purple-light flex items-center gap-1">Ver todos <ChevronRight className="w-3 h-3" /></button>
                </div>
                {recentEntries.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhum lançamento encontrado nesta clínica ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {recentEntries.map(e => {
                      const meta = STATUS_META[e.status];
                      return (
                        <div key={e.id} className="flex items-center justify-between text-xs bg-slate-900/40 border border-next-border rounded-lg px-3 py-2">
                          <div className="min-w-0 flex items-center gap-2">
                            {e.type === 'income' ? <TrendingUp className="w-3.5 h-3.5 text-next-green-success flex-shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 text-next-red-alert flex-shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-slate-200 font-semibold truncate">{e.description}</p>
                              <p className="text-[10px] text-slate-500 truncate">{e.patientName || e.category} · {formatDate(e.dueDate)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="font-mono font-bold text-slate-300">{formatCurrency(e.totalAmount)}</span>
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${meta.classes}`}>{meta.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LEDGER */}
          {activeTab === 'ledger' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-xs">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    placeholder="Buscar lançamento ou paciente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-next-border rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="bg-slate-900 border border-next-border rounded-lg text-[11px] text-slate-300 px-2.5 py-2 font-mono">
                    <option value="today">Hoje</option>
                    <option value="month">Este mês</option>
                    <option value="all">Tudo</option>
                  </select>
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="bg-slate-900 border border-next-border rounded-lg text-[11px] text-slate-300 px-2.5 py-2 font-mono">
                    <option value="all">Todos os tipos</option>
                    <option value="income">Receitas</option>
                    <option value="expense">Despesas</option>
                  </select>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="bg-slate-900 border border-next-border rounded-lg text-[11px] text-slate-300 px-2.5 py-2 font-mono">
                    <option value="all">Todos os status</option>
                    <option value="pending">Pendente</option>
                    <option value="partial">Parcial</option>
                    <option value="paid">Pago</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                  <button onClick={() => openCreate('income')} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple">
                    <Plus className="w-3.5 h-3.5" /> Receita
                  </button>
                  <button onClick={() => openCreate('expense')} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg">
                    <Plus className="w-3.5 h-3.5" /> Despesa
                  </button>
                </div>
              </div>

              {filteredLedger.length === 0 ? (
                <div className="next-glass-panel rounded-next-2xl p-10 text-center">
                  <Receipt className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Nenhum lançamento encontrado para este filtro.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLedger.map(e => {
                    const meta = STATUS_META[e.status];
                    return (
                      <div key={e.id} className="next-glass-panel rounded-xl p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {e.type === 'income' ? <TrendingUp className="w-4 h-4 text-next-green-success flex-shrink-0" /> : <TrendingDown className="w-4 h-4 text-next-red-alert flex-shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-200 truncate">{e.description}</p>
                            <p className="text-[10.5px] text-slate-500 truncate">{e.patientName ? `${e.patientName} · ` : ''}{e.category} · Vence {formatDate(e.dueDate)}{e.paymentMethod ? ` · ${e.paymentMethod}` : ''}</p>
                            {e.status === 'paid' && e.receivedByName && (
                              <p className="text-[9.5px] text-slate-500 truncate">{e.type === 'income' ? 'Recebido' : 'Pago'} por {e.receivedByName}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <span className="block font-mono font-bold text-sm text-slate-200">{formatCurrency(e.totalAmount)}</span>
                            {e.status === 'partial' && <span className="block text-[9.5px] text-slate-500">Pago: {formatCurrency(e.paidAmount)}</span>}
                          </div>
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${meta.classes}`}>{meta.label}</span>
                          {e.status !== 'paid' && e.status !== 'cancelled' && (
                            <button onClick={() => openReceive(e)} title={e.type === 'income' ? 'Marcar como recebido' : 'Marcar como pago'} className="p-1.5 rounded-lg bg-next-green-success/10 border border-next-green-success/20 text-next-green-success">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <button onClick={() => handleDeleteEntry(e)} disabled={deletingId === e.id} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert">
                              {deletingId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* CLOSING */}
          {activeTab === 'closing' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-mono text-slate-500 uppercase">Data do fechamento</label>
                <input
                  type="date"
                  value={selectedClosingDate}
                  onChange={(e) => setSelectedClosingDate(e.target.value)}
                  className="bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2"
                />
              </div>

              {existingClosing ? (
                <div className="next-glass-panel rounded-next-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-next-purple-neon" />
                      <h4 className="text-sm font-bold text-slate-200">Fechamento de {formatDate(existingClosing.date)}</h4>
                    </div>
                    <span className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md border ${existingClosing.status === 'balanced' ? 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' : 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert'}`}>
                      {existingClosing.status === 'balanced' ? 'Batido' : 'Com diferença'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Dinheiro</span><span className="font-mono font-bold text-slate-200">{formatCurrency(existingClosing.cashAmount)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Cartão</span><span className="font-mono font-bold text-slate-200">{formatCurrency(existingClosing.machineAmount)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">PIX</span><span className="font-mono font-bold text-slate-200">{formatCurrency(existingClosing.pixAmount)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Transf.</span><span className="font-mono font-bold text-slate-200">{formatCurrency(existingClosing.transferAmount)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Outros</span><span className="font-mono font-bold text-slate-200">{formatCurrency(existingClosing.otherAmount)}</span></div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-next-border text-xs">
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Total contado</span><span className="font-mono font-bold text-slate-100 text-sm">{formatCurrency(existingClosing.totalAmount)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Total no sistema</span><span className="font-mono font-bold text-slate-100 text-sm">{formatCurrency(existingClosing.systemTotal)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Diferença</span><span className={`font-mono font-bold text-sm ${existingClosing.status === 'balanced' ? 'text-next-green-success' : 'text-next-red-alert'}`}>{formatCurrency(existingClosing.difference)}</span></div>
                  </div>

                  {existingClosing.observations && (
                    <div>
                      <span className="block text-[9.5px] text-slate-500 uppercase font-mono mb-1">Observações</span>
                      <p className="text-xs text-slate-300 bg-slate-900/50 border border-next-border rounded-lg p-3 whitespace-pre-wrap">{existingClosing.observations}</p>
                    </div>
                  )}

                  <p className="text-[10.5px] text-slate-500 font-mono">Fechado por {existingClosing.closedBy}</p>

                  <div className="flex gap-2 pt-2 border-t border-next-border">
                    <button onClick={() => handlePrintClosing(existingClosing)} className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-xs rounded-xl">
                      <Printer className="w-3.5 h-3.5" /> Imprimir / Exportar PDF
                    </button>
                    {isAdmin && (
                      <button onClick={() => handleDeleteClosing(existingClosing)} disabled={deletingClosingId === existingClosing.id} className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert font-bold text-xs rounded-xl">
                        {deletingClosingId === existingClosing.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Excluir e refazer
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="next-glass-panel rounded-next-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <ScanLine className="w-4 h-4 text-next-purple-neon" />
                    <h4 className="text-sm font-bold text-slate-200">Conferência do dia (calculada pelo sistema)</h4>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Dinheiro</span><span className="font-mono font-bold text-slate-300">{formatCurrency(systemTotalsForSelectedDate.dinheiro)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Cartão</span><span className="font-mono font-bold text-slate-300">{formatCurrency(systemTotalsForSelectedDate.cartao)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">PIX</span><span className="font-mono font-bold text-slate-300">{formatCurrency(systemTotalsForSelectedDate.pix)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Transf.</span><span className="font-mono font-bold text-slate-300">{formatCurrency(systemTotalsForSelectedDate.transferencia)}</span></div>
                    <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Outros</span><span className="font-mono font-bold text-slate-300">{formatCurrency(systemTotalsForSelectedDate.outros)}</span></div>
                  </div>
                  <p className="text-[11px] text-slate-500">Total esperado pelo sistema: <strong className="text-slate-200">{formatCurrency(systemTotalsForSelectedDate.total)}</strong> (soma dos recebimentos pagos/parciais desta data, por forma de pagamento).</p>

                  <div className="border-t border-next-border pt-4 space-y-3">
                    <h5 className="text-xs font-bold text-slate-200">Contagem física do caixa</h5>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div>
                        <label className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><Banknote className="w-3 h-3" /> Dinheiro</label>
                        <input type="number" value={closingForm.cash} onChange={(e) => setClosingForm(f => ({ ...f, cash: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><CreditCard className="w-3 h-3" /> Cartão</label>
                        <input type="number" value={closingForm.machine} onChange={(e) => setClosingForm(f => ({ ...f, machine: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><ScanLine className="w-3 h-3" /> PIX</label>
                        <input type="number" value={closingForm.pix} onChange={(e) => setClosingForm(f => ({ ...f, pix: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><ArrowLeftRight className="w-3 h-3" /> Transf.</label>
                        <input type="number" value={closingForm.transfer} onChange={(e) => setClosingForm(f => ({ ...f, transfer: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[9.5px] font-mono text-slate-500 uppercase">Outros</label>
                        <input type="number" value={closingForm.other} onChange={(e) => setClosingForm(f => ({ ...f, other: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2 mt-1" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 bg-slate-900/40 border border-next-border rounded-lg p-3">
                      <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Total contado</span><span className="font-mono font-bold text-slate-100">{formatCurrency(closingTotalEntered)}</span></div>
                      <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Sistema</span><span className="font-mono font-bold text-slate-100">{formatCurrency(systemTotalsForSelectedDate.total)}</span></div>
                      <div><span className="block text-[9.5px] text-slate-500 uppercase font-mono">Diferença</span><span className={`font-mono font-bold ${Math.abs(closingDifference) < 0.01 ? 'text-next-green-success' : 'text-next-red-alert'}`}>{formatCurrency(closingDifference)}</span></div>
                    </div>

                    <div>
                      <label className="text-[9.5px] font-mono text-slate-500 uppercase">Observações (opcional)</label>
                      <textarea value={closingForm.observations} onChange={(e) => setClosingForm(f => ({ ...f, observations: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 h-16 resize-none mt-1" placeholder="Ex: diferença de troco, falta justificar sangria..." />
                    </div>

                    <button
                      onClick={handleSaveClosing}
                      disabled={savingClosing || closingTotalEntered === 0}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
                    >
                      {savingClosing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
                      <span>{savingClosing ? 'Registrando...' : 'Registrar fechamento (real)'}</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                <h4 className="text-xs font-bold text-slate-200">Histórico de fechamentos</h4>
                {closings.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhum fechamento registrado ainda nesta clínica.</p>
                ) : (
                  <div className="space-y-2">
                    {closings.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-xs bg-slate-900/40 border border-next-border rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'balanced' ? 'bg-next-green-success' : 'bg-next-red-alert'}`} />
                          <div className="min-w-0">
                            <p className="text-slate-200 font-semibold">{formatDate(c.date)}</p>
                            <p className="text-[10px] text-slate-500 truncate">{c.closedBy}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-mono font-bold text-slate-300">{formatCurrency(c.totalAmount)}</span>
                          <button onClick={() => handlePrintClosing(c)} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200">
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <button onClick={() => handleDeleteClosing(c)} disabled={deletingClosingId === c.id} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert">
                              {deletingClosingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COMMISSIONS */}
          {activeTab === 'commissions' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Pendente</span>
                  <h3 className="text-2xl font-extrabold text-next-orange-insight tracking-tight font-mono mt-1">{formatCurrency(commissionKpis.pending)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Aprovada (a pagar)</span>
                  <h3 className="text-2xl font-extrabold text-next-ia-blue tracking-tight font-mono mt-1">{formatCurrency(commissionKpis.approved)}</h3>
                </div>
                <div className="next-glass-panel rounded-next-xl p-5">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Paga este mês</span>
                  <h3 className="text-2xl font-extrabold text-next-green-success tracking-tight font-mono mt-1">{formatCurrency(commissionKpis.paidMonth)}</h3>
                </div>
              </div>

              {/* CONFIG */}
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Users className="w-4 h-4 text-next-purple-neon" /> Percentual padrão por profissional</h4>
                {teamMembers.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhum profissional encontrado em team_members/members desta clínica.</p>
                ) : (
                  <div className="space-y-2">
                    {teamMembers.map(m => {
                      const current = settingFor(m.id);
                      const draft = settingsDraft[m.id] ?? (current ? String(current.defaultPercent) : '');
                      return (
                        <div key={m.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-next-border rounded-lg px-3 py-2">
                          <span className="text-xs font-semibold text-slate-200 truncate">{m.name}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="relative">
                              <input
                                type="number"
                                value={draft}
                                onChange={(e) => setSettingsDraft(prev => ({ ...prev, [m.id]: e.target.value }))}
                                placeholder="0"
                                className="w-20 bg-slate-950 border border-next-border rounded-lg text-xs text-slate-200 pl-2.5 pr-6 py-1.5"
                              />
                              <Percent className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2" />
                            </div>
                            <button onClick={() => handleSaveCommissionSetting(m)} disabled={savingSettingId === m.id} className="px-2.5 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-50">
                              {savingSettingId === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Salvar'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* LAUNCH */}
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Plus className="w-4 h-4 text-next-purple-neon" /> Lançar comissão a partir de um recebimento</h4>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Lançamento recebido</label>
                  <select
                    value={commissionForm.financialEntryId}
                    onChange={(e) => setCommissionForm(f => ({ ...f, financialEntryId: e.target.value }))}
                    className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1"
                  >
                    <option value="">— Selecione um recebimento —</option>
                    {eligibleEntriesForCommission.map(e => (
                      <option key={e.id} value={e.id}>{e.description} · {e.patientName || 'sem paciente'} · {formatCurrency(e.paidAmount)} · {formatDate(e.dueDate)}</option>
                    ))}
                  </select>
                  {eligibleEntriesForCommission.length === 0 && <p className="text-[10.5px] text-slate-500 mt-1">Nenhum recebimento pago disponível (ou todos já têm comissão lançada).</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Profissional</label>
                    <select
                      value={commissionForm.professionalId}
                      onChange={(e) => {
                        const pid = e.target.value;
                        const pct = settingFor(pid)?.defaultPercent;
                        setCommissionForm(f => ({ ...f, professionalId: pid, percent: pct !== undefined ? String(pct) : f.percent }));
                      }}
                      className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1"
                    >
                      <option value="">— Selecione —</option>
                      {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Percentual (%)</label>
                    <input type="number" value={commissionForm.percent} onChange={(e) => setCommissionForm(f => ({ ...f, percent: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Observações (opcional)</label>
                  <input value={commissionForm.notes} onChange={(e) => setCommissionForm(f => ({ ...f, notes: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                {selectedEntryForCommission && (
                  <p className="text-[11px] text-slate-400">Base: <strong className="text-slate-200">{formatCurrency(selectedEntryForCommission.paidAmount)}</strong> × {commissionPercentValue}% = <strong className="text-next-purple-light">{formatCurrency(commissionAmountPreview)}</strong></p>
                )}
                <button
                  onClick={handleGenerateCommission}
                  disabled={savingCommission || !selectedEntryForCommission || !commissionForm.professionalId}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
                >
                  {savingCommission ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />}
                  <span>{savingCommission ? 'Lançando...' : 'Lançar comissão (real)'}</span>
                </button>
              </div>

              {/* LIST */}
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                <h4 className="text-xs font-bold text-slate-200">Comissões lançadas nesta central</h4>
                {commissionRecords.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhuma comissão lançada ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {commissionRecords.map(r => {
                      const meta = COMMISSION_STATUS_META[r.status] || COMMISSION_STATUS_META.pending;
                      return (
                        <div key={r.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-next-border rounded-lg px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-200 truncate">{r.professionalName} · {formatCurrency(r.commissionAmount)}</p>
                            <p className="text-[10.5px] text-slate-500 truncate">{r.description} {r.patientName ? `· ${r.patientName}` : ''} · base {formatCurrency(r.baseAmount)} × {r.percent}%</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${meta.classes}`}>{meta.label}</span>
                            {r.status === 'pending' && (
                              <button onClick={() => handleUpdateCommissionStatus(r, 'approved')} disabled={updatingCommissionId === r.id} className="px-2 py-1 rounded-lg bg-next-ia-blue/10 border border-next-ia-blue/20 text-next-ia-blue text-[10px] font-bold">Aprovar</button>
                            )}
                            {r.status === 'approved' && (
                              <button onClick={() => handleUpdateCommissionStatus(r, 'paid')} disabled={updatingCommissionId === r.id} className="px-2 py-1 rounded-lg bg-next-green-success/10 border border-next-green-success/20 text-next-green-success text-[10px] font-bold">Marcar paga</button>
                            )}
                            {isAdmin && (
                              <button onClick={() => handleDeleteCommission(r)} disabled={deletingCommissionId === r.id} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert">
                                {deletingCommissionId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* LEGACY HISTORY (read-only) */}
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><History className="w-4 h-4 text-slate-500" /> Histórico do sistema legado (somente leitura)</h4>
                <p className="text-[10.5px] text-slate-500 flex items-start gap-1.5"><Info className="w-3 h-3 flex-shrink-0 mt-0.5" /> Comissões geradas antes desta central, vindas de commissions e commercial_sale_commissions. Mostradas apenas para consulta — novas comissões usam o modelo único acima.</p>
                {legacyCommissions.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhuma comissão legada encontrada.</p>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {legacyCommissions.map(r => (
                      <div key={`${r.origin}-${r.id}`} className="flex items-center justify-between text-[11px] bg-slate-900/30 border border-next-border/60 rounded-lg px-3 py-1.5">
                        <span className="text-slate-300 truncate">{r.professionalName} <span className="text-slate-600">· {r.origin}</span></span>
                        <span className="font-mono text-slate-400 flex-shrink-0">{formatCurrency(r.amount)} · {r.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div className="next-glass-panel rounded-next-2xl p-6 space-y-4">
                <div className="flex items-start gap-2">
                  <Bot className="w-5 h-5 text-next-purple-neon flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold text-slate-200">Pergunte pra Eliza sobre o financeiro</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Ela já lê os números reais desta central (KPIs do mês, contas vencidas, comissões, último fechamento) antes de responder.</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {AI_SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => { setIaQuestion(s); handleAskFinancialAI(s); }} className="text-[10.5px] font-semibold px-2.5 py-1.5 rounded-lg border bg-slate-900/60 border-next-border text-slate-400 hover:text-slate-200 hover:border-next-purple-neon/40">
                      {s}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <textarea
                    value={iaQuestion}
                    onChange={(e) => setIaQuestion(e.target.value)}
                    placeholder="Ex: Estamos gastando demais em quê este mês?"
                    className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-20 resize-none pr-10"
                  />
                </div>

                <button
                  onClick={() => handleAskFinancialAI()}
                  disabled={iaAnalyzing || !iaQuestion.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
                >
                  {iaAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{iaAnalyzing ? 'A Eliza está analisando os números...' : 'Perguntar pra Eliza'}</span>
                </button>
                <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> Chama a IA real (OpenAI com fallback Gemini). Sem chave de API configurada neste ambiente, aparece um erro real — não é simulado.</p>
              </div>

              {/* RECEIPTS / COMPROVANTES */}
              <div className="next-glass-panel rounded-next-2xl p-6 space-y-3">
                <div className="flex items-start gap-2">
                  <Paperclip className="w-5 h-5 text-next-purple-neon flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold text-slate-200">Comprovantes e recibos → fechamento de caixa</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Anexe fotos de comprovantes de pagamento, recibos ou notas de compra. A Eliza lê cada um, sugere o lançamento e, ao aprovar, grava de verdade — o valor já entra no cálculo do Fechamento de Caixa do dia.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input ref={receiptFileInputRef} type="file" accept="image/*" multiple onChange={handleReceiptFilesSelected} className="hidden" />
                  <button onClick={() => receiptFileInputRef.current?.click()} className="inline-flex items-center gap-1 text-[10px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2.5 py-1.5 rounded-lg">
                    <Paperclip className="w-3 h-3" /> Anexar comprovantes
                  </button>
                  <span className="text-[10px] text-slate-600">até 6 imagens, 900KB cada</span>
                </div>

                {iaReceiptFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {iaReceiptFiles.map(f => (
                      <div key={f.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-next-border group">
                        <img src={f.dataUrl} alt={f.name} className="w-full h-full object-cover" />
                        <button onClick={() => removeReceiptFile(f.id)} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {iaReceiptFiles.length > 0 && (
                  <button
                    onClick={handleAnalyzeReceipts}
                    disabled={iaAnalyzingReceipts}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
                  >
                    {iaAnalyzingReceipts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    <span>{iaAnalyzingReceipts ? 'Lendo comprovantes...' : `Analisar ${iaReceiptFiles.length} comprovante(s) com a Eliza`}</span>
                  </button>
                )}

                {iaReceiptError && <p className="text-[11px] text-next-red-alert">{iaReceiptError}</p>}

                {iaExtractedReceipts && iaExtractedReceipts.length > 0 && (
                  <div className="space-y-2.5 border-t border-next-border pt-3">
                    {iaReceiptsSummary && <p className="text-[11px] text-slate-400 italic">{iaReceiptsSummary}</p>}
                    {iaExtractedReceipts.map((r, idx) => (
                      <div key={idx} className="bg-slate-900/40 border border-next-border rounded-lg p-3 space-y-2">
                        <div className="flex gap-2">
                          <input value={r.description} onChange={(e) => updateExtractedReceipt(idx, { description: e.target.value })} className="flex-1 bg-slate-950 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-1.5" />
                          <button onClick={() => removeExtractedReceiptRow(idx)} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <select value={r.type} onChange={(e) => updateExtractedReceipt(idx, { type: e.target.value as 'income' | 'expense' })} className="bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2 py-1.5">
                            <option value="income">Receita</option>
                            <option value="expense">Despesa</option>
                          </select>
                          <input type="number" value={r.amount} onChange={(e) => updateExtractedReceipt(idx, { amount: Number(e.target.value) })} className="bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2 py-1.5" />
                          <input type="date" value={r.date} onChange={(e) => updateExtractedReceipt(idx, { date: e.target.value })} className="bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2 py-1.5" />
                          <select value={r.paymentMethod} onChange={(e) => updateExtractedReceipt(idx, { paymentMethod: e.target.value })} className="bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2 py-1.5">
                            <option value="">Forma de pgto.</option>
                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={handleCommitReceiptsToLedger}
                      disabled={iaCommittingReceipts}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-next-green-success/15 border border-next-green-success/30 text-next-green-success font-bold text-xs rounded-xl disabled:opacity-50"
                    >
                      {iaCommittingReceipts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>{iaCommittingReceipts ? 'Gravando...' : `Lançar ${iaExtractedReceipts.length} lançamento(s) no financeiro (real)`}</span>
                    </button>
                  </div>
                )}
              </div>

              {iaError && (
                <div className="next-glass-panel rounded-next-2xl p-4 border-next-red-alert/30">
                  <p className="text-[11px] text-next-red-alert">{iaError}</p>
                </div>
              )}

              {iaResult && (
                <div className="next-glass-panel rounded-next-2xl p-6 space-y-4">
                  <div>
                    <p className="text-[10px] font-mono text-slate-500 uppercase mb-1">{iaResult.automatic ? 'Diagnóstico automático da Eliza' : `Resposta: "${iaResult.question}"`}</p>
                    <p className="text-xs text-slate-200 leading-relaxed">{iaResult.summary}</p>
                  </div>

                  {iaResult.risks.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-next-red-alert uppercase mb-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Riscos</p>
                      <ul className="space-y-1">
                        {iaResult.risks.map((r, i) => <li key={i} className="text-[11.5px] text-slate-300 flex gap-1.5"><span className="text-next-red-alert">•</span>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {iaResult.opportunities.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-next-purple-light uppercase mb-1.5 flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Oportunidades</p>
                      <ul className="space-y-1">
                        {iaResult.opportunities.map((r, i) => <li key={i} className="text-[11.5px] text-slate-300 flex gap-1.5"><span className="text-next-purple-light">•</span>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {iaResult.recommendedActions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-next-green-success uppercase mb-1.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ações recomendadas</p>
                      <ul className="space-y-1">
                        {iaResult.recommendedActions.map((r, i) => <li key={i} className="text-[11.5px] text-slate-300 flex gap-1.5"><span className="text-next-green-success">•</span>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  <button onClick={handleSaveIaReport} disabled={iaSavingReport} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-xs rounded-xl disabled:opacity-60">
                    {iaSavingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{iaSavingReport ? 'Salvando...' : 'Salvar análise no histórico (real)'}</span>
                  </button>
                </div>
              )}

              {iaReports.length > 0 && (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><History className="w-4 h-4 text-next-purple-neon" /> Análises salvas</h4>
                  {iaReports.map(r => (
                    <div key={r.id} className="bg-slate-900/40 border border-next-border rounded-lg overflow-hidden">
                      <button onClick={() => setIaExpandedReportId(iaExpandedReportId === r.id ? null : r.id)} className="w-full flex items-center justify-between p-3 text-left">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-200 truncate">{r.question}</p>
                          <p className="text-[10px] text-slate-500">{formatDate(r.createdAt)}</p>
                        </div>
                        {iaExpandedReportId === r.id ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                      </button>
                      {iaExpandedReportId === r.id && (
                        <div className="px-3 pb-3 text-[11.5px] text-slate-300 space-y-1.5">
                          <p className="italic text-slate-400">{r.summary}</p>
                          {r.recommendedActions?.map((a, i) => <p key={i}>• {a}</p>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* FORM DRAWER */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setIsFormOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200">{form.id ? 'Editar lançamento' : form.type === 'income' ? 'Nova receita' : 'Nova despesa'}</h3>
                <button onClick={() => setIsFormOpen(false)} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Descrição</label>
                <input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" placeholder="Ex: Recebimento consulta, Aluguel da clínica..." />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Tipo</label>
                  <select value={form.type} onChange={(e) => { const type = e.target.value as 'income' | 'expense'; setForm(f => ({ ...f, type, category: type === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0] })); }} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    <option value="income">Receita</option>
                    <option value="expense">Despesa</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Categoria</label>
                  <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    {(form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Valor total (R$)</label>
                  <input type="number" value={form.totalAmount} onChange={(e) => setForm(f => ({ ...f, totalAmount: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Vencimento</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                  <select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value as any }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    <option value="pending">Pendente</option>
                    <option value="partial">Parcial</option>
                    <option value="paid">Pago</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Forma de pagamento</label>
                  <select value={form.paymentMethod} onChange={(e) => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {form.status === 'partial' && (
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Valor já pago (R$)</label>
                  <input type="number" value={form.paidAmount} onChange={(e) => setForm(f => ({ ...f, paidAmount: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              )}

              {form.type === 'income' && (
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Paciente (opcional)</label>
                  <select value={form.patientId} onChange={(e) => setForm(f => ({ ...f, patientId: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    <option value="">— Nenhum —</option>
                    {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Profissional (opcional — só se souber com certeza quem gerou esta receita)</label>
                <select value={form.professionalId} onChange={(e) => setForm(f => ({ ...f, professionalId: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                  <option value="">— Não informado —</option>
                  {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              <button
                onClick={handleSaveEntry}
                disabled={saving || !form.description.trim() || !form.totalAmount}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{saving ? 'Gravando...' : 'Salvar lançamento (real)'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RECEIVE DRAWER */}
      <AnimatePresence>
        {receivingEntry && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={closeReceive}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 w-full max-w-md space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200">{receivingEntry.type === 'income' ? 'Receber pagamento' : 'Confirmar pagamento'}</h3>
                <button onClick={closeReceive} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-slate-400">{receivingEntry.description}</p>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Saldo em aberto</label>
                <p className="text-sm font-bold text-slate-200">{formatCurrency(receivingEntry.pendingAmount || receivingEntry.totalAmount)}</p>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Valor recebido agora (R$)</label>
                <input
                  type="number"
                  value={receiveAmountInput}
                  onChange={(e) => setReceiveAmountInput(e.target.value)}
                  max={receivingEntry.pendingAmount || receivingEntry.totalAmount}
                  className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1"
                />
                {Number(receiveAmountInput) > (receivingEntry.pendingAmount || receivingEntry.totalAmount) + 0.005 && (
                  <p className="text-[10px] text-next-orange-insight mt-1">Valor maior que o saldo — será considerado o saldo total.</p>
                )}
              </div>
              <button
                onClick={() => handleConfirmSettlement(receivingEntry, Number(receiveAmountInput) || 0)}
                disabled={confirmingReceive || !receiveAmountInput || Number(receiveAmountInput) <= 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
              >
                {confirmingReceive ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{confirmingReceive ? 'Confirmando...' : 'Confirmar recebimento'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FOOTER */}
      <div className="bg-slate-900 border border-next-border/60 rounded-xl p-4 flex items-start gap-3 text-[11px] text-slate-500 leading-relaxed font-mono">
        <Lock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <span>
Toda esta Central Financeira lê e grava de verdade nesta clínica (financial_entries, daily_closings, commission_settings, commission_records, financial_ai_reports). Comissões antigas de commissions/commercial_sale_commissions aparecem só para consulta.
        </span>
      </div>
    </div>
  );
}
