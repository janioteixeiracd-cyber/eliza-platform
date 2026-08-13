import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  HeartPulse, Search, Calendar, AlertTriangle, Loader2, RefreshCw,
  Plus, Save, X, ClipboardList, Activity, Smartphone, Receipt, Image as ImageIcon,
  Wallet, Sparkles, Trash2, Check, Upload, Brain, Mic, MicOff, Paperclip,
  ShieldAlert, Wand2, ChevronDown, ChevronUp, FileText, Pill,
  ArrowLeft, MessageCircle, Phone, Info, UserPlus, Pencil, IdCard, Cake, History, Mail
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDoc, secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, doc as fsDoc, setDoc, updateDoc, arrayUnion, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import NextContractsPanel from './NextContracts';
import NextPrescriptionsPanel from './NextPrescriptions';

interface Patient {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status?: string;
  cpf?: string;
  birthDate?: string;
  address?: string;
}

interface Evolution {
  id?: string;
  text: string;
  date: any;
  professional?: string;
  updatedAt?: string;
  voided?: boolean;
  voidedAt?: string;
}

interface Treatment {
  id: string;
  description: string;
  professional?: string;
  status?: string;
  evolutions?: Evolution[];
}

interface AnamnesisData {
  medicalTreatment?: string;
  allergies?: string;
  medications?: string;
  conditions?: string;
  healingIssues?: string;
  hemorrhage?: string;
  habits?: string;
  internalNotes?: string;
  updatedAt?: any;
}

interface QuotationItem {
  description: string;
  value: number;
  quantity: number;
  status?: string;
}

interface Quotation {
  id: string;
  title: string;
  items: QuotationItem[];
  status: 'draft' | 'approved' | 'rejected';
  totalValue: number;
  createdAt?: any;
}

interface PatientImage {
  id: string;
  title: string;
  url: string;
  category: string;
  description?: string;
  date?: any;
}

interface FinancialEntry {
  id: string;
  description: string;
  amount: number;
  status: string;
  paymentMethod?: string;
  date?: any;
}

interface AppointmentLite {
  id: string;
  patientId?: string;
  patientName?: string;
  date?: string;
  time?: string;
  status?: string;
  treatment?: string;
  dentistName?: string;
}

const ANAMNESIS_FIELDS: { label: string; name: keyof AnamnesisData }[] = [
  { label: 'Tratamento Médico?', name: 'medicalTreatment' },
  { label: 'Alergias?', name: 'allergies' },
  { label: 'Medicação Contínua?', name: 'medications' },
  { label: 'Condições (Diabetes/Cardíaco)?', name: 'conditions' },
  { label: 'Cicatrização?', name: 'healingIssues' },
  { label: 'Hemorragia?', name: 'hemorrhage' },
  { label: 'Hábitos (Fumo/Álcool)?', name: 'habits' },
];

type RecordTab = 'resumo' | 'evolucao' | 'ia_clinica' | 'orcamento' | 'contratos' | 'receituarios' | 'imagens' | 'financeiro';

// ---- Diretório de Pacientes (lista fundida do antigo "Consulta de Dados") --

const STATUS_META: Record<string, { label: string; classes: string }> = {
  active: { label: 'Ativo', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  suspended: { label: 'Suspenso', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
  suspect: { label: 'Falta', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  review: { label: 'Revisão', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
};

const APPT_STATUS_META: Record<string, { label: string; classes: string }> = {
  pendente: { label: 'Pendente', classes: 'bg-slate-800 border-next-border text-slate-400' },
  confirmado: { label: 'Confirmado', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
  atendimento: { label: 'Em Atendimento', classes: 'bg-amber-500/10 border-amber-500/25 text-amber-400' },
  finalizado: { label: 'Finalizado', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  cancelado: { label: 'Cancelado', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
  faltou: { label: 'Faltou', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
};

const CARD_STYLES = [
  { avatar: 'bg-fuchsia-500/25 text-fuchsia-200' },
  { avatar: 'bg-teal-500/25 text-teal-200' },
  { avatar: 'bg-sky-500/25 text-sky-200' },
  { avatar: 'bg-amber-500/25 text-amber-200' },
  { avatar: 'bg-next-purple-neon/25 text-next-purple-light' },
];
function colorFor(seed?: string) {
  const s = seed || 'default';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CARD_STYLES[h % CARD_STYLES.length];
}

function statusBadge(status?: string) {
  const meta = STATUS_META[status || 'active'] || { label: status || 'Ativo', classes: 'bg-slate-800 border-next-border text-slate-400' };
  return (
    <span className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md border tracking-wider shrink-0 ${meta.classes}`}>
      {meta.label}
    </span>
  );
}

function waLink(phone?: string) {
  const clean = (phone || '').replace(/\D/g, '');
  if (!clean) return null;
  return `https://wa.me/${clean.startsWith('55') ? '' : '55'}${clean}`;
}

// ---- ELIZA IA Clínica (Treatment Studio, Parte 1) -----------------------

const SPECIALTIES = [
  'Implantodontia', 'Prótese', 'Harmonização Facial', 'Cirurgia', 'Endodontia',
  'Ortodontia', 'Periodontia', 'Dentística', 'Odontopediatria', 'DTM', 'Laser', 'Outro'
];

const ANALYSIS_STEPS = [
  'Lendo histórico e anamnese',
  'Analisando exames e fotografias anexadas',
  'Avaliando anatomia e oclusão',
  'Cruzando com protocolos clínicos',
  'Estimando custos e materiais',
  'Montando o plano de tratamento',
];

interface DiagnosisPhase { name: string; description: string; }

interface AiDiagnosis {
  id?: string;
  specialties: string[];
  caseDescription: string;
  summary: string;
  problems: string[];
  hypotheses: string[];
  differentialDiagnosis: string[];
  objectives: string[];
  phases: DiagnosisPhase[];
  materials: string[];
  estimatedTime: string;
  complexity: string;
  risks: string[];
  orientations: string[];
  suggestedItems: QuotationItem[];
  createdAt?: any;
}

interface ExamFile { id: string; name: string; mimeType: string; dataUrl: string; }

interface ClinicalAlert { type: 'danger' | 'warning' | 'info'; title: string; description: string; }

interface FollowUpMessage { role: 'user' | 'ai'; text: string; }

// Rule-based (no AI call) clinical risk cross-reference over the real,
// already-saved anamnesis — always available, never depends on the AI
// Gateway being configured or reachable.
function getClinicalAlerts(anamnesis: AnamnesisData | null): ClinicalAlert[] {
  if (!anamnesis) return [];
  const alerts: ClinicalAlert[] = [];
  const blob = [anamnesis.allergies, anamnesis.medications, anamnesis.conditions, anamnesis.healingIssues, anamnesis.hemorrhage, anamnesis.habits, anamnesis.internalNotes]
    .filter(Boolean).join(' ').toLowerCase();
  const has = (...kws: string[]) => kws.some(k => blob.includes(k));
  const negated = has('não', 'nao', 'negativ', 'nega', 'nenhum');

  if (has('alerg') && !negated) alerts.push({ type: 'danger', title: 'Alergia registrada', description: 'Paciente relata alergia — confira antes de prescrever ou aplicar qualquer substância.' });
  if (has('anticoagul', 'varfarina', 'xarelto', 'marevan')) alerts.push({ type: 'danger', title: 'Uso de anticoagulante', description: 'Risco de sangramento prolongado em procedimentos invasivos — avaliar suspensão com o médico responsável.' });
  if (has('gestante', 'grávida', 'gravida', 'gravidez')) alerts.push({ type: 'danger', title: 'Gestação', description: 'Evitar procedimentos e medicações contraindicadas na gravidez.' });
  if (has('diabet')) alerts.push({ type: 'warning', title: 'Diabetes', description: 'Cicatrização mais lenta e maior risco de infecção — atenção pós-operatória redobrada.' });
  if (has('marca-passo', 'marcapasso', 'marca passo')) alerts.push({ type: 'warning', title: 'Marca-passo', description: 'Cautela com equipamentos eletrônicos/ultrassônicos (ex: bisturi elétrico, aparelhos de ultrassom).' });
  if (has('isotretino', 'roacutan')) alerts.push({ type: 'warning', title: 'Uso de isotretinoína', description: 'Contraindicação relativa a procedimentos estéticos invasivos (peelings, laser) — aguardar período de carência.' });
  if (has('cardíaco', 'cardiaco', 'cardiopat')) alerts.push({ type: 'warning', title: 'Condição cardíaca', description: 'Avaliar necessidade de profilaxia antibiótica e monitorar o estresse do procedimento.' });
  if (has('bruxismo')) alerts.push({ type: 'info', title: 'Bruxismo', description: 'Considerar placa de proteção e reforço em procedimentos restauradores/estéticos.' });
  if (has('hemorrag') && !negated) alerts.push({ type: 'warning', title: 'Histórico de hemorragia', description: 'Atenção redobrada em procedimentos com sangramento — considerar exames complementares.' });
  if (has('fumante', 'tabagis')) alerts.push({ type: 'info', title: 'Tabagismo', description: 'Fumo está associado a cicatrização mais lenta e maior risco de complicações.' });

  return alerts;
}

function isSameCalendarDay(iso: any): boolean {
  try { return new Date(iso).toDateString() === new Date().toDateString(); } catch { return false; }
}

interface NextMedicalRecordProps {
  prefillPatientId?: string | null;
  onPrefillConsumed?: () => void;
  onScheduleForPatient?: (patientName: string) => void;
}

function formatDate(d: any): string {
  try {
    if (!d) return '';
    if (typeof d === 'string') return new Date(d).toLocaleDateString('pt-BR');
    if (d.toDate) return d.toDate().toLocaleDateString('pt-BR');
    return new Date(d).toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function NextMedicalRecord({ prefillPatientId, onPrefillConsumed, onScheduleForPatient }: NextMedicalRecordProps = {}) {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;

  const [viewMode, setViewMode] = useState<'list' | 'record'>('list');

  // Diretório de pacientes (fundido do antigo "Consulta de Dados")
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<AppointmentLite[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [listSearchTerm, setListSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [recordSwitchTerm, setRecordSwitchTerm] = useState('');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: '', phone: '', email: '' });
  const [savingPatient, setSavingPatient] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [fichaTarget, setFichaTarget] = useState<Patient | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', status: 'active', cpf: '', birthDate: '', address: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RecordTab>('resumo');

  const [anamnesis, setAnamnesis] = useState<AnamnesisData | null>(null);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [financialEntries, setFinancialEntries] = useState<FinancialEntry[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);

  const [anamnesisForm, setAnamnesisForm] = useState<AnamnesisData>({});
  const [savingAnamnesis, setSavingAnamnesis] = useState(false);
  const [isAnamnesisOpen, setIsAnamnesisOpen] = useState(false);

  const [newEvolutionText, setNewEvolutionText] = useState('');
  const [savingEvolution, setSavingEvolution] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [pendingEvolutionAction, setPendingEvolutionAction] = useState<{ treatmentId: string; evolutionId: string; mode: 'delete' | 'void' } | null>(null);
  const [processingEvolutionId, setProcessingEvolutionId] = useState<string | null>(null);

  // Orçamento (quotation) state
  const [isQuotationFormOpen, setIsQuotationFormOpen] = useState(false);
  const [quotationTitle, setQuotationTitle] = useState('Plano de Tratamento');
  const [quotationItems, setQuotationItems] = useState<QuotationItem[]>([]);
  const [savingQuotation, setSavingQuotation] = useState(false);
  const [updatingQuotationId, setUpdatingQuotationId] = useState<string | null>(null);

  // AI treatment plan assist
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{ summary: string; items: QuotationItem[] } | null>(null);

  // Images
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Financial
  const [isFinancialFormOpen, setIsFinancialFormOpen] = useState(false);
  const [financialForm, setFinancialForm] = useState({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX' });
  const [savingFinancial, setSavingFinancial] = useState(false);

  // IA Clínica (Treatment Studio, Parte 1)
  const [savedDiagnoses, setSavedDiagnoses] = useState<AiDiagnosis[]>([]);
  const [iaSpecialties, setIaSpecialties] = useState<string[]>([]);
  const [iaCaseDescription, setIaCaseDescription] = useState('');
  const [iaExamFiles, setIaExamFiles] = useState<ExamFile[]>([]);
  const [iaListening, setIaListening] = useState(false);
  const [iaAnalyzing, setIaAnalyzing] = useState(false);
  const [iaAnalysisStepIndex, setIaAnalysisStepIndex] = useState(0);
  const [iaError, setIaError] = useState<string | null>(null);
  const [iaDiagnosis, setIaDiagnosis] = useState<AiDiagnosis | null>(null);
  const [iaSavingDiagnosis, setIaSavingDiagnosis] = useState(false);
  const [iaExpandedHistoryId, setIaExpandedHistoryId] = useState<string | null>(null);
  const [iaChatMessages, setIaChatMessages] = useState<FollowUpMessage[]>([]);
  const [iaChatInput, setIaChatInput] = useState('');
  const [iaChatLoading, setIaChatLoading] = useState(false);
  const examFileInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<any>(null);

  useEffect(() => {
    async function fetchDirectory() {
      if (!clinic?.id) return;
      try {
        setLoadingPatients(true);
        const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
        const snap = await secureGetDocs(query(patientsRef, limit(300)), 'patients', { addAuditLog });
        setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Patient)));

        const apptsRef = collection(db, 'clinics', clinic.id, 'appointments');
        const apptSnap = await secureGetDocs(query(apptsRef, limit(300)), 'appointments', { addAuditLog });
        setAppointments(apptSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppointmentLite)));
      } catch (err) {
        console.warn('Failed to load real patients/appointments in sandbox:', err);
      } finally {
        setLoadingPatients(false);
      }
    }
    fetchDirectory();
  }, [clinic?.id]);

  useEffect(() => {
    if (prefillPatientId) {
      setSelectedPatientId(prefillPatientId);
      setActiveTab('resumo');
      setViewMode('record');
      onPrefillConsumed?.();
    }
  }, [prefillPatientId]);

  useEffect(() => {
    async function fetchRecord() {
      if (!clinic?.id || !selectedPatientId) {
        setAnamnesis(null); setTreatments([]); setQuotations([]); setImages([]); setFinancialEntries([]); setSavedDiagnoses([]);
        return;
      }
      setLoadingRecord(true);
      // Reset the IA Clínica working session when switching patients — an
      // in-progress analysis for patient A should never leak into patient B.
      setIaSpecialties([]); setIaCaseDescription(''); setIaExamFiles([]); setIaDiagnosis(null); setIaError(null); setIaChatMessages([]); setIaChatInput('');
      try {
        const patientRoot = ['clinics', clinic.id, 'patients', selectedPatientId] as const;

        const anamnesisSnap = await secureGetDoc<AnamnesisData>(fsDoc(db, ...patientRoot, 'anamnesis', 'current'), { addAuditLog });
        const data = anamnesisSnap.exists() ? anamnesisSnap.data() : null;
        setAnamnesis(data);
        setAnamnesisForm(data || {});

        const treatmentsSnap = await secureGetDocs<Treatment>(query(collection(db, ...patientRoot, 'treatments'), limit(50)), 'treatments', { addAuditLog });
        setTreatments(treatmentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Treatment)));

        const quotationsSnap = await secureGetDocs<Quotation>(query(collection(db, ...patientRoot, 'quotations'), limit(50)), 'quotations', { addAuditLog });
        setQuotations(quotationsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Quotation)));

        const imagesSnap = await secureGetDocs<PatientImage>(query(collection(db, ...patientRoot, 'images'), limit(60)), 'images', { addAuditLog });
        setImages(imagesSnap.docs.map(d => ({ id: d.id, ...d.data() } as PatientImage)));

        const finRef = collection(db, 'clinics', clinic.id, 'financial_entries');
        const finSnap = await secureGetDocs<FinancialEntry>(query(finRef, where('patientId', '==', selectedPatientId), limit(100)), 'financial_entries', { addAuditLog });
        setFinancialEntries(finSnap.docs.map(d => ({ id: d.id, ...d.data() } as FinancialEntry)));

        const aiPlansSnap = await secureGetDocs<AiDiagnosis>(query(collection(db, ...patientRoot, 'ai_treatment_plans'), limit(20)), 'ai_treatment_plans', { addAuditLog });
        setSavedDiagnoses(aiPlansSnap.docs.map(d => ({ id: d.id, ...d.data() } as AiDiagnosis)));
      } catch (err) {
        console.warn('Failed to load real medical record in sandbox:', err);
      } finally {
        setLoadingRecord(false);
      }
    }
    fetchRecord();
  }, [clinic?.id, selectedPatientId]);

  const filteredPatients = useMemo(() => {
    const term = listSearchTerm.trim().toLowerCase();
    return patients.filter(p => {
      if (statusFilter !== 'all' && (p.status || 'active') !== statusFilter) return false;
      if (!term) return true;
      return (p.name || '').toLowerCase().includes(term) || (p.phone || '').toLowerCase().includes(term) || (p.email || '').toLowerCase().includes(term);
    });
  }, [patients, listSearchTerm, statusFilter]);

  const recordSwitchResults = useMemo(() => {
    const term = recordSwitchTerm.trim().toLowerCase();
    if (!term) return [];
    return patients.filter(p => (p.name || '').toLowerCase().includes(term)).slice(0, 8);
  }, [patients, recordSwitchTerm]);

  const getNextAppointment = (patientId: string, patientName: string) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const mine = appointments.filter(a => (a.patientId === patientId || a.patientName === patientName) && (a.date || '') >= todayStr);
    if (mine.length === 0) return null;
    mine.sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`));
    return mine[0];
  };

  const selectedPatient = patients.find(p => p.id === selectedPatientId) || null;

  const patientAppointmentHistory = useMemo(() => {
    if (!selectedPatient) return [];
    const mine = appointments.filter(a => a.patientId === selectedPatient.id || a.patientName === selectedPatient.name);
    return mine
      .sort((a, b) => `${b.date || ''}T${b.time || '00:00'}`.localeCompare(`${a.date || ''}T${a.time || '00:00'}`))
      .slice(0, 10);
  }, [appointments, selectedPatient]);

  const timeline = useMemo(() => {
    const items: { treatmentId: string; treatmentDesc: string; text: string; date: any; id?: string; professional?: string; voided?: boolean; voidedAt?: string; updatedAt?: string }[] = [];
    treatments.forEach(t => {
      (t.evolutions || []).forEach(ev => items.push({
        treatmentId: t.id, treatmentDesc: t.description || 'Prontuário Clínico Geral', text: ev.text, date: ev.date,
        id: ev.id, professional: ev.professional, voided: ev.voided, voidedAt: ev.voidedAt, updatedAt: ev.updatedAt,
      }));
    });
    items.sort((a, b) => {
      const da = typeof a.date === 'string' ? a.date : (a.date?.toDate ? a.date.toDate().toISOString() : '');
      const dbv = typeof b.date === 'string' ? b.date : (b.date?.toDate ? b.date.toDate().toISOString() : '');
      return dbv.localeCompare(da);
    });
    return items;
  }, [treatments]);

  const clinicalAlerts = useMemo(() => getClinicalAlerts(anamnesis), [anamnesis]);

  const showMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4500); };

  // ---- REAL WRITES ------------------------------------------------------
  // Same product decision as Agenda/Pacientes: everything below writes for
  // real to this patient's real record in Firestore.

  const openRecord = (patientId: string) => {
    setSelectedPatientId(patientId);
    setActiveTab('resumo');
    setRecordSwitchTerm('');
    setViewMode('record');
  };

  const openFicha = (p: Patient) => {
    setFichaTarget(p);
    setEditForm({ name: p.name || '', phone: p.phone || '', email: p.email || '', status: p.status || 'active', cpf: p.cpf || '', birthDate: p.birthDate || '', address: p.address || '' });
  };

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    if (!newPatient.name.trim() || !newPatient.phone.trim()) {
      setCreateError('Nome e telefone são obrigatórios.');
      return;
    }
    setSavingPatient(true);
    setCreateError(null);
    try {
      const payload = { name: newPatient.name.trim(), phone: newPatient.phone.trim(), email: newPatient.email.trim() || null, status: 'active', createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db, 'clinics', clinic.id, 'patients'), payload);
      setPatients(prev => [...prev, { id: ref.id, ...payload } as Patient]);
      addAuditLog({ collection: 'patients', action: 'WRITE', status: 'SUCCESS', details: `Paciente real "${payload.name}" criado (escrita real no Firestore).` });
      setNewPatient({ name: '', phone: '', email: '' });
      setIsAddOpen(false);
      showMessage(`Paciente "${payload.name}" criado de verdade nesta clínica.`);
    } catch (err: any) {
      setCreateError(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingPatient(false);
    }
  };

  const handleSaveFicha = async () => {
    if (!clinic?.id || !fichaTarget) return;
    setSavingEdit(true);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', fichaTarget.id), {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        email: editForm.email.trim() || null,
        status: editForm.status,
        cpf: editForm.cpf.trim() || null,
        birthDate: editForm.birthDate || null,
        address: editForm.address.trim() || null,
        updatedAt: serverTimestamp(),
      });
      setPatients(prev => prev.map(p => p.id === fichaTarget.id ? { ...p, ...editForm } : p));
      addAuditLog({ collection: 'patients', action: 'WRITE', status: 'SUCCESS', details: `Ficha de "${editForm.name}" atualizada (escrita real no Firestore).` });
      showMessage('Ficha atualizada de verdade.');
      setFichaTarget(prev => prev ? { ...prev, ...editForm } : prev);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeletePatient = async (p: Patient) => {
    if (!clinic?.id) return;
    if (!isAdmin) {
      showMessage('Apenas administradores/donos da clínica podem excluir pacientes.');
      return;
    }
    if (!window.confirm(`Excluir "${p.name}" de verdade? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(p.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'patients', p.id));
      setPatients(prev => prev.filter(x => x.id !== p.id));
      addAuditLog({ collection: 'patients', action: 'WRITE', status: 'SUCCESS', details: `Paciente "${p.name}" excluído (escrita real no Firestore).` });
      showMessage(`"${p.name}" excluído de verdade.`);
      setFichaTarget(null);
      if (selectedPatientId === p.id) { setSelectedPatientId(null); setViewMode('list'); }
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveAnamnesis = async () => {
    if (!clinic?.id || !selectedPatientId) return;
    setSavingAnamnesis(true);
    try {
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'anamnesis', 'current'), { ...anamnesisForm, updatedAt: serverTimestamp() }, { merge: true });
      setAnamnesis(anamnesisForm);
      addAuditLog({ collection: 'anamnesis', action: 'WRITE', status: 'SUCCESS', details: `Anamnese de "${selectedPatient?.name}" atualizada (escrita real).` });
      setIsAnamnesisOpen(false);
      showMessage('Anamnese salva de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingAnamnesis(false);
    }
  };

  const handleAddEvolution = async () => {
    if (!clinic?.id || !selectedPatientId || !newEvolutionText.trim()) return;
    setSavingEvolution(true);
    try {
      let treatmentId = treatments.find(t => (t.status || 'active') === 'active')?.id;
      const treatmentsRef = collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'treatments');
      if (!treatmentId) {
        treatmentId = `gen-treat-${Date.now()}`;
        await setDoc(fsDoc(treatmentsRef, treatmentId), { id: treatmentId, description: 'Prontuário Clínico Geral', professional: 'ELIZA NEXT', status: 'active', evolutions: [] });
      }
      const entry: Evolution = {
        id: `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: newEvolutionText.trim(),
        date: new Date().toISOString(),
        professional: profile?.name || user?.email || 'Profissional',
      };
      await updateDoc(fsDoc(treatmentsRef, treatmentId), { evolutions: arrayUnion(entry) });
      setTreatments(prev => {
        const exists = prev.some(t => t.id === treatmentId);
        if (exists) return prev.map(t => t.id === treatmentId ? { ...t, evolutions: [...(t.evolutions || []), entry] } : t);
        return [...prev, { id: treatmentId!, description: 'Prontuário Clínico Geral', status: 'active', evolutions: [entry] }];
      });
      addAuditLog({ collection: 'treatments', action: 'WRITE', status: 'SUCCESS', details: `Nova evolução clínica registrada para "${selectedPatient?.name}" por ${entry.professional} (escrita real).` });
      setNewEvolutionText('');
      showMessage('Evolução clínica registrada de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingEvolution(false);
    }
  };

  // Grace-period rule: an evolution can be hard-deleted only on the same
  // calendar day it was created. From the next day on, deleting becomes a
  // soft "anular" (voided) — the entry stays in the record, struck through.
  const requestEvolutionAction = (item: { treatmentId: string; id?: string; date: any }) => {
    if (!item.id) return;
    setPendingEvolutionAction({ treatmentId: item.treatmentId, evolutionId: item.id, mode: isSameCalendarDay(item.date) ? 'delete' : 'void' });
  };
  const cancelEvolutionAction = () => setPendingEvolutionAction(null);

  const confirmEvolutionAction = async () => {
    if (!pendingEvolutionAction || !clinic?.id || !selectedPatientId) return;
    const { treatmentId, evolutionId, mode } = pendingEvolutionAction;
    const treatment = treatments.find(t => t.id === treatmentId);
    if (!treatment) { setPendingEvolutionAction(null); return; }
    setProcessingEvolutionId(evolutionId);
    try {
      const newEvolutions = mode === 'delete'
        ? (treatment.evolutions || []).filter(ev => ev.id !== evolutionId)
        : (treatment.evolutions || []).map(ev => ev.id === evolutionId ? { ...ev, voided: true, voidedAt: new Date().toISOString() } : ev);
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'treatments', treatmentId), { evolutions: newEvolutions });
      setTreatments(prev => prev.map(t => t.id === treatmentId ? { ...t, evolutions: newEvolutions } : t));
      addAuditLog({
        collection: 'treatments', action: 'WRITE', status: 'SUCCESS',
        details: mode === 'delete'
          ? `Evolução clínica excluída (mesmo dia do lançamento) do prontuário de "${selectedPatient?.name}" (escrita real).`
          : `Evolução clínica anulada (mantida no histórico) no prontuário de "${selectedPatient?.name}" (escrita real).`,
      });
      showMessage(mode === 'delete' ? 'Evolução excluída de verdade.' : 'Evolução anulada de verdade — mantida no histórico.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setProcessingEvolutionId(null);
      setPendingEvolutionAction(null);
    }
  };

  // --- Orçamento -----------------------------------------------------

  const quotationTotal = quotationItems.reduce((acc, it) => acc + (Number(it.value) || 0) * (Number(it.quantity) || 1), 0);

  const openNewQuotation = () => {
    setQuotationTitle('Plano de Tratamento');
    setQuotationItems([{ description: '', value: 0, quantity: 1 }]);
    setAiSuggestion(null);
    setIsQuotationFormOpen(true);
  };

  const updateQuotationItem = (idx: number, patch: Partial<QuotationItem>) => {
    setQuotationItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const handleSaveQuotation = async () => {
    if (!clinic?.id || !selectedPatientId) return;
    const validItems = quotationItems.filter(it => it.description.trim());
    if (validItems.length === 0) { showMessage('Adicione ao menos um item com descrição.'); return; }
    setSavingQuotation(true);
    try {
      const id = `q-${Date.now()}`;
      const payload: Omit<Quotation, 'id'> & { createdAt: any } = {
        title: quotationTitle || 'Plano de Tratamento',
        items: validItems,
        status: 'draft',
        totalValue: quotationTotal,
        createdAt: serverTimestamp(),
      };
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations', id), payload);
      setQuotations(prev => [{ id, ...payload }, ...prev]);
      addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Orçamento "${payload.title}" (${formatCurrency(quotationTotal)}) criado para "${selectedPatient?.name}" (escrita real).` });
      setIsQuotationFormOpen(false);
      showMessage('Orçamento salvo de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingQuotation(false);
    }
  };

  const handleUpdateQuotationStatus = async (quotation: Quotation, status: 'approved' | 'rejected' | 'draft') => {
    if (!clinic?.id || !selectedPatientId) return;
    setUpdatingQuotationId(quotation.id);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations', quotation.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      setQuotations(prev => prev.map(q => q.id === quotation.id ? { ...q, status } : q));
      const statusLabel = status === 'approved' ? 'aprovado' : status === 'rejected' ? 'rejeitado' : 'revertido para rascunho';
      addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Orçamento "${quotation.title}" marcado como ${statusLabel} (escrita real).` });
      showMessage(`Orçamento marcado como ${statusLabel}.`);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setUpdatingQuotationId(null);
    }
  };

  // --- AI Treatment Plan (real AI Gateway, same proxy the legacy app uses) --

  const handleAskEliza = async () => {
    if (!aiPrompt.trim() || !selectedPatient) return;
    setAiLoading(true);
    setAiError(null);
    setAiSuggestion(null);
    try {
      const anamnesisContext = anamnesis
        ? ANAMNESIS_FIELDS.map(f => `${f.label} ${anamnesis[f.name] || 'não informado'}`).join('; ')
        : 'sem anamnese registrada';

      const prompt = `Você é a Eliza, assistente odontológica. Monte uma sugestão de plano de tratamento para o paciente "${selectedPatient.name}".
Anamnese: ${anamnesisContext}.
Necessidade descrita pelo dentista: "${aiPrompt.trim()}".
Responda ESTRITAMENTE em JSON válido, sem markdown, no formato:
{"summary": "resumo curto do racional clínico", "items": [{"description": "procedimento", "value": 0, "quantity": 1}]}
Use valores em reais (BRL) como estimativa razoável de mercado brasileiro. Não invente alergias ou condições que não foram informadas.`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'treatment_plan',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente reformular o pedido.');
      const parsed = JSON.parse(jsonMatch[0]);
      const items: QuotationItem[] = (parsed.items || []).map((it: any) => ({
        description: String(it.description || ''),
        value: Number(it.value) || 0,
        quantity: Number(it.quantity) || 1,
      }));
      setAiSuggestion({ summary: String(parsed.summary || ''), items });
      addAuditLog({ collection: 'ai_treatment_plan', action: 'WRITE', status: 'SUCCESS', details: `Plano de tratamento sugerido pela Eliza (IA real) para "${selectedPatient.name}".` });
    } catch (err: any) {
      setAiError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setQuotationTitle(prev => prev || 'Plano de Tratamento (sugestão da Eliza)');
    setQuotationItems(prev => {
      const base = prev.filter(it => it.description.trim());
      return [...base, ...aiSuggestion.items];
    });
    setIsAiPanelOpen(false);
  };

  // --- Imagens ---------------------------------------------------------

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !clinic?.id || !selectedPatientId) return;
    if (file.size > 800000) { showMessage('Imagem muito grande — use arquivos menores que 800KB.'); return; }
    setUploadingImage(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        const id = `img-${Date.now()}`;
        const payload = { title: file.name, category: 'Exame/Foto', description: '', url: base64, date: serverTimestamp() };
        await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images', id), payload);
        setImages(prev => [{ id, ...payload }, ...prev]);
        addAuditLog({ collection: 'images', action: 'WRITE', status: 'SUCCESS', details: `Imagem "${file.name}" adicionada ao prontuário de "${selectedPatient?.name}" (escrita real).` });
        showMessage('Imagem salva de verdade.');
      } catch (err: any) {
        showMessage(`Falha ao gravar imagem: ${err?.message || err}`);
      } finally {
        setUploadingImage(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteImage = async (img: PatientImage) => {
    if (!clinic?.id || !selectedPatientId) return;
    setDeletingImageId(img.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images', img.id));
      setImages(prev => prev.filter(i => i.id !== img.id));
      addAuditLog({ collection: 'images', action: 'WRITE', status: 'SUCCESS', details: `Imagem "${img.title}" removida do prontuário de "${selectedPatient?.name}" (escrita real).` });
      showMessage('Imagem excluída.');
    } catch (err: any) {
      showMessage(`Falha ao excluir imagem: ${err?.message || err}`);
    } finally {
      setDeletingImageId(null);
    }
  };

  // --- Financeiro do paciente -------------------------------------------
  // Writes only to clinics/{clinicId}/financial_entries (the field the
  // legacy app itself documents as its single source of truth for display).
  // We intentionally do NOT replicate the legacy's triple-write into
  // patient/financial + clinics/transactions + financial_entries — that
  // redundancy is legacy tech debt, not something worth carrying forward.

  const handleAddFinancialEntry = async () => {
    if (!clinic?.id || !selectedPatientId || !financialForm.description.trim() || !financialForm.amount) return;
    setSavingFinancial(true);
    try {
      const id = `pat-fin-${Date.now()}`;
      const amount = Number(financialForm.amount) || 0;
      const payload = {
        patientId: selectedPatientId,
        patientName: selectedPatient?.name || '',
        description: financialForm.description.trim(),
        type: 'income',
        category: 'Clínico',
        amount,
        status: financialForm.status,
        paymentMethod: financialForm.paymentMethod,
        date: new Date().toISOString(),
        createdAt: serverTimestamp(),
        createdBy: user?.uid || 'eliza_next_sandbox',
      };
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', id), payload);
      setFinancialEntries(prev => [{ id, ...payload }, ...prev]);
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento financeiro (${formatCurrency(amount)}) criado para "${selectedPatient?.name}" (escrita real).` });
      setFinancialForm({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX' });
      setIsFinancialFormOpen(false);
      showMessage('Lançamento financeiro salvo de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingFinancial(false);
    }
  };

  // --- IA Clínica (ELIZA Treatment Studio — Parte 1) ---------------------
  // Centro de planejamento clínico: o profissional escolhe a(s)
  // especialidade(s), relata o caso (texto ou voz), anexa exames reais, e a
  // Eliza analisa tudo (incluindo as imagens, de forma multimodal, via o
  // mesmo AI Gateway real usado no resto do app) para propor um diagnóstico
  // e plano de tratamento completo — 100% editável antes de salvar.

  const toggleSpecialty = (spec: string) => {
    setIaSpecialties(prev => prev.includes(spec) ? prev.filter(s => s !== spec) : [...prev, spec]);
  };

  const handleExamFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (iaExamFiles.length + files.length > 6) {
      showMessage('Máximo de 6 arquivos por análise.');
      if (examFileInputRef.current) examFileInputRef.current.value = '';
      return;
    }
    files.forEach(file => {
      if (file.size > 900000) {
        showMessage(`"${file.name}" é grande demais — use arquivos menores que 900KB.`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setIaExamFiles(prev => [...prev, {
          id: `exam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType: file.type || 'image/jpeg',
          dataUrl: reader.result as string,
        }]);
      };
      reader.readAsDataURL(file);
    });
    if (examFileInputRef.current) examFileInputRef.current.value = '';
  };

  const removeExamFile = (id: string) => setIaExamFiles(prev => prev.filter(f => f.id !== id));

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showMessage('Ditado por voz não é suportado neste navegador. Tente Chrome/Edge.');
      return;
    }
    if (iaListening) {
      speechRecognitionRef.current?.stop();
      setIaListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      if (transcript.trim()) setIaCaseDescription(prev => (prev ? prev.trim() + ' ' : '') + transcript.trim());
    };
    recognition.onerror = () => setIaListening(false);
    recognition.onend = () => setIaListening(false);
    recognition.start();
    speechRecognitionRef.current = recognition;
    setIaListening(true);
  };

  const handleAnalyzeCase = async () => {
    if (!selectedPatient) return;
    if (iaSpecialties.length === 0) { showMessage('Selecione ao menos uma especialidade.'); return; }
    if (!iaCaseDescription.trim()) { showMessage('Descreva o caso antes de analisar.'); return; }

    setIaAnalyzing(true);
    setIaError(null);
    setIaDiagnosis(null);
    setIaChatMessages([]);
    setIaChatInput('');
    setIaAnalysisStepIndex(0);
    const stepTimer = setInterval(() => {
      setIaAnalysisStepIndex(prev => (prev < ANALYSIS_STEPS.length - 1 ? prev + 1 : prev));
    }, 850);

    try {
      const anamnesisContext = anamnesis
        ? ANAMNESIS_FIELDS.map(f => `${f.label} ${anamnesis[f.name] || 'não informado'}`).join('; ')
        : 'sem anamnese registrada';
      const evolutionContext = timeline.slice(0, 5).map(t => `[${formatDate(t.date)}] ${t.text}`).join(' | ') || 'sem evoluções registradas';

      const prompt = `Você é a Eliza, inteligência clínica odontológica sênior. Monte um diagnóstico e plano de tratamento completo para o paciente "${selectedPatient.name}".

Especialidade(s) selecionada(s) pelo profissional: ${iaSpecialties.join(', ')}.
Relato do caso pelo profissional: "${iaCaseDescription.trim()}".
Anamnese real do paciente (fonte da verdade, não invente nada além disso): ${anamnesisContext}.
Evoluções clínicas recentes reais: ${evolutionContext}.
${iaExamFiles.length > 0 ? `Foram anexadas ${iaExamFiles.length} imagem(ns) de exame/foto/radiografia/tomografia para você analisar visualmente junto com o caso.` : 'Nenhuma imagem foi anexada — baseie-se apenas no relato e na anamnese.'}

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, exatamente neste formato:
{"summary":"resumo clínico do caso em 2-3 frases","problems":["problema 1"],"hypotheses":["hipótese 1"],"differentialDiagnosis":["diagnóstico diferencial 1"],"objectives":["objetivo 1"],"phases":[{"name":"Fase 1","description":"o que será feito nesta fase"}],"materials":["material 1"],"estimatedTime":"estimativa de tempo clínico/cirúrgico","complexity":"Baixa|Média|Alta","risks":["risco 1"],"orientations":["orientação pós-operatória 1"],"suggestedItems":[{"description":"procedimento","value":0,"quantity":1}]}
Baseie-se apenas nas informações fornecidas (anamnese, relato, evoluções, imagens). Nunca invente alergias, condições, achados ou históricos que não foram informados ou não são visíveis nas imagens anexadas. Use valores em reais (BRL) como estimativa razoável de mercado odontológico brasileiro.`;

      const parts: any[] = [{ text: prompt }];
      iaExamFiles.forEach(f => {
        const base64Data = f.dataUrl.split(',')[1];
        if (base64Data) parts.push({ inlineData: { mimeType: f.mimeType, data: base64Data } });
      });

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts }],
        taskType: 'clinical_diagnosis',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente reformular o relato do caso.');
      const parsed = JSON.parse(jsonMatch[0]);

      const diagnosis: AiDiagnosis = {
        specialties: [...iaSpecialties],
        caseDescription: iaCaseDescription.trim(),
        summary: String(parsed.summary || ''),
        problems: Array.isArray(parsed.problems) ? parsed.problems.map(String) : [],
        hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.map(String) : [],
        differentialDiagnosis: Array.isArray(parsed.differentialDiagnosis) ? parsed.differentialDiagnosis.map(String) : [],
        objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map(String) : [],
        phases: Array.isArray(parsed.phases) ? parsed.phases.map((p: any) => ({ name: String(p?.name || ''), description: String(p?.description || '') })) : [],
        materials: Array.isArray(parsed.materials) ? parsed.materials.map(String) : [],
        estimatedTime: String(parsed.estimatedTime || ''),
        complexity: String(parsed.complexity || 'Média'),
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
        orientations: Array.isArray(parsed.orientations) ? parsed.orientations.map(String) : [],
        suggestedItems: Array.isArray(parsed.suggestedItems) ? parsed.suggestedItems.map((it: any) => ({ description: String(it?.description || ''), value: Number(it?.value) || 0, quantity: Number(it?.quantity) || 1 })) : [],
      };
      setIaDiagnosis(diagnosis);
      addAuditLog({ collection: 'ai_clinica', action: 'WRITE', status: 'SUCCESS', details: `Diagnóstico e plano de tratamento (IA real multimodal, ${iaExamFiles.length} arquivo(s) anexado(s)) gerado para "${selectedPatient.name}".` });
    } catch (err: any) {
      setIaError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      clearInterval(stepTimer);
      setIaAnalyzing(false);
    }
  };

  // Follow-up chat: continues the conversation about the diagnosis just
  // generated, reusing the same real AI Gateway — a lightweight way to get
  // conversational depth without rebuilding a whole triage engine.
  const handleAskFollowUp = async () => {
    if (!iaChatInput.trim() || !iaDiagnosis || !selectedPatient) return;
    const question = iaChatInput.trim();
    setIaChatMessages(prev => [...prev, { role: 'user', text: question }]);
    setIaChatInput('');
    setIaChatLoading(true);
    try {
      const prompt = `Você é a Eliza, inteligência clínica odontológica sênior. Você já gerou este diagnóstico e plano de tratamento para o paciente "${selectedPatient.name}":
Resumo: ${iaDiagnosis.summary}
Fases: ${iaDiagnosis.phases.map(p => `${p.name}: ${p.description}`).join(' | ') || 'não detalhadas'}

O profissional tem uma pergunta de acompanhamento sobre este caso: "${question}"

Responda de forma direta e curta (2-4 frases), em português, com base apenas no caso já analisado. Não repita o diagnóstico inteiro.`;
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'clinical_followup',
        clinicId: clinic?.id,
      });
      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || 'Não consegui gerar uma resposta.';
      setIaChatMessages(prev => [...prev, { role: 'ai', text: rawText.trim() }]);
    } catch (err: any) {
      setIaChatMessages(prev => [...prev, { role: 'ai', text: `Falha ao consultar a Eliza: ${err?.message || err}` }]);
    } finally {
      setIaChatLoading(false);
    }
  };

  // Generic editable-list helpers used by every string[] section of the
  // diagnosis (problems, hypotheses, differentialDiagnosis, objectives,
  // materials, risks, orientations).
  type DiagnosisListField = 'problems' | 'hypotheses' | 'differentialDiagnosis' | 'objectives' | 'materials' | 'risks' | 'orientations';
  const updateDiagnosisListItem = (field: DiagnosisListField, index: number, value: string) => {
    setIaDiagnosis(prev => prev ? { ...prev, [field]: (prev[field] as string[]).map((v, i) => i === index ? value : v) } : prev);
  };
  const addDiagnosisListItem = (field: DiagnosisListField) => {
    setIaDiagnosis(prev => prev ? { ...prev, [field]: [...(prev[field] as string[]), ''] } : prev);
  };
  const removeDiagnosisListItem = (field: DiagnosisListField, index: number) => {
    setIaDiagnosis(prev => prev ? { ...prev, [field]: (prev[field] as string[]).filter((_, i) => i !== index) } : prev);
  };

  const updatePhase = (index: number, patch: Partial<DiagnosisPhase>) => {
    setIaDiagnosis(prev => prev ? { ...prev, phases: prev.phases.map((p, i) => i === index ? { ...p, ...patch } : p) } : prev);
  };
  const addPhase = () => setIaDiagnosis(prev => prev ? { ...prev, phases: [...prev.phases, { name: `Fase ${prev.phases.length + 1}`, description: '' }] } : prev);
  const removePhase = (index: number) => setIaDiagnosis(prev => prev ? { ...prev, phases: prev.phases.filter((_, i) => i !== index) } : prev);

  const updateDiagnosisItem = (index: number, patch: Partial<QuotationItem>) => {
    setIaDiagnosis(prev => prev ? { ...prev, suggestedItems: prev.suggestedItems.map((it, i) => i === index ? { ...it, ...patch } : it) } : prev);
  };
  const addDiagnosisItem = () => setIaDiagnosis(prev => prev ? { ...prev, suggestedItems: [...prev.suggestedItems, { description: '', value: 0, quantity: 1 }] } : prev);
  const removeDiagnosisItem = (index: number) => setIaDiagnosis(prev => prev ? { ...prev, suggestedItems: prev.suggestedItems.filter((_, i) => i !== index) } : prev);

  const diagnosisTotal = (iaDiagnosis?.suggestedItems || []).reduce((acc, it) => acc + (Number(it.value) || 0) * (Number(it.quantity) || 1), 0);

  const handleSaveDiagnosisToRecord = async () => {
    if (!clinic?.id || !selectedPatientId || !iaDiagnosis) return;
    setIaSavingDiagnosis(true);
    try {
      const id = `aidiag-${Date.now()}`;
      const payload = { ...iaDiagnosis, createdAt: serverTimestamp() };
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'ai_treatment_plans', id), payload);
      setSavedDiagnoses(prev => [{ id, ...payload }, ...prev]);
      addAuditLog({ collection: 'ai_treatment_plans', action: 'WRITE', status: 'SUCCESS', details: `Plano de tratamento com IA salvo no prontuário de "${selectedPatient?.name}" (escrita real).` });
      showMessage('Plano de tratamento salvo de verdade no prontuário.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setIaSavingDiagnosis(false);
    }
  };

  const handleSendDiagnosisToQuotation = () => {
    if (!iaDiagnosis) return;
    setQuotationTitle(`Plano de Tratamento — ${iaDiagnosis.specialties.join(', ')}`);
    setQuotationItems(iaDiagnosis.suggestedItems.length > 0 ? [...iaDiagnosis.suggestedItems] : [{ description: '', value: 0, quantity: 1 }]);
    setIsQuotationFormOpen(true);
    setActiveTab('orcamento');
    showMessage('Itens do plano levados para o Orçamento — revise e salve por lá.');
  };

  const renderEditableList = (field: DiagnosisListField, label: string) => (
    <div>
      <p className="text-[10px] font-mono text-slate-500 uppercase mb-1">{label}</p>
      <div className="space-y-1.5">
        {(iaDiagnosis?.[field] || []).map((val, idx) => (
          <div key={idx} className="flex gap-1.5">
            <input value={val} onChange={(e) => updateDiagnosisListItem(field, idx, e.target.value)} className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-1.5" />
            <button onClick={() => removeDiagnosisListItem(field, idx)} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={() => addDiagnosisListItem(field)} className="text-[10px] font-bold text-slate-500 hover:text-slate-300">+ adicionar</button>
      </div>
    </div>
  );

  const TABS: { id: RecordTab; label: string; icon: any }[] = [
    { id: 'resumo', label: 'Resumo', icon: ClipboardList },
    { id: 'evolucao', label: 'Evolução', icon: Activity },
    { id: 'ia_clinica', label: 'IA Clínica', icon: Brain },
    { id: 'orcamento', label: 'Orçamento', icon: Receipt },
    { id: 'contratos', label: 'Contratos', icon: FileText },
    { id: 'receituarios', label: 'Receituários', icon: Pill },
    { id: 'imagens', label: 'Imagens', icon: ImageIcon },
    { id: 'financeiro', label: 'Financeiro', icon: Wallet },
  ];

  // -------------------------------------------------------------------
  // MODO LISTA — diretório de pacientes (fusão do antigo "Consulta de Dados")
  // -------------------------------------------------------------------
  if (viewMode === 'list') {
    return (
      <div className="max-w-7xl mx-auto pb-16 space-y-6 font-sans">
        <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 z-10">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight next-brand-gradient-text flex items-center gap-2">
                <HeartPulse className="w-6 h-6 text-next-purple-neon" />
                Prontuário Vivo
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full font-bold font-mono">{filteredPatients.length}</span>
              </h1>
              <p className="text-slate-400 text-xs mt-1">Selecione um paciente para abrir o prontuário completo, ou cadastre um novo. Tudo aqui é real desta clínica.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => window.location.reload()} disabled={loadingPatients} className="p-2.5 bg-slate-900/70 border border-next-border rounded-xl text-slate-400 hover:text-slate-200 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loadingPatients ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => { setCreateError(null); setIsAddOpen(true); }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple"
                style={{ minHeight: '40px' }}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Novo Paciente</span>
              </button>
            </div>
          </div>

          <div className="relative z-10 mt-4 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por nome, telefone ou e-mail..."
                value={listSearchTerm}
                onChange={(e) => setListSearchTerm(e.target.value)}
                className="w-full bg-slate-900/70 border border-next-border rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-next-purple-neon/50"
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-slate-900/70 border border-next-border rounded-xl text-xs text-slate-200 px-3 py-2.5">
              <option value="all">Todos os status</option>
              <option value="active">Ativos</option>
              <option value="suspended">Suspensos</option>
              <option value="suspect">Falta</option>
              <option value="review">Revisão</option>
            </select>
          </div>
        </div>

        <AnimatePresence>
          {message && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 text-xs text-next-green-success font-semibold">
              {message}
            </motion.div>
          )}
        </AnimatePresence>

        {loadingPatients ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-next-purple-neon" />
            <span className="text-xs font-mono">Carregando pacientes reais...</span>
          </div>
        ) : filteredPatients.length === 0 ? (
          <div className="next-glass-panel rounded-next-2xl p-10 text-center">
            <p className="text-sm font-semibold text-slate-300">Nenhum paciente encontrado</p>
            <p className="text-xs text-slate-500 mt-1">Ajuste a busca/filtro, ou cadastre um novo paciente real.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPatients.map(p => {
              const style = colorFor(p.name);
              const nextAppt = getNextAppointment(p.id, p.name);
              const wa = waLink(p.phone);
              return (
                <motion.div key={p.id} layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="next-glass-panel rounded-next-2xl p-4 flex flex-col justify-between hover:border-next-border-glow transition-colors cursor-pointer" onClick={() => openRecord(p.id)}>
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs uppercase flex-shrink-0 ${style.avatar}`}>
                          {(p.name || '?').charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-100 text-xs truncate" title={p.name}>{p.name}</h4>
                          <span className="font-mono text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Smartphone className="w-3 h-3 text-next-green-success" />
                            {p.phone || 'sem telefone'}
                          </span>
                        </div>
                      </div>
                      {statusBadge(p.status)}
                    </div>

                    <div className="mt-3">
                      {nextAppt ? (
                        <div className="text-[10.5px] font-semibold text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/20 rounded-lg py-1.5 px-2.5 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">Próximo: {(nextAppt.date || '').split('-').reverse().join('/')} às {nextAppt.time}</span>
                        </div>
                      ) : (
                        <div className="text-[10.5px] text-slate-500 bg-slate-900/50 border border-next-border rounded-lg py-1.5 px-2.5 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                          <span>Sem agendamento futuro</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-next-border space-y-1.5">
                    <div className="flex gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); openFicha(p); }} className="flex-1 bg-slate-900/70 hover:bg-slate-800 border border-next-border text-slate-300 text-[10px] font-bold py-1.5 rounded-lg uppercase">Ficha</button>
                      <button onClick={(e) => { e.stopPropagation(); openRecord(p.id); }} className="flex-1 bg-next-ia-blue/15 hover:bg-next-ia-blue/25 border border-next-ia-blue/30 text-next-ia-blue-light text-[10px] font-bold py-1.5 rounded-lg uppercase">Abrir Prontuário</button>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); onScheduleForPatient?.(p.name); }} className="flex-1 bg-next-purple-neon/15 hover:bg-next-purple-neon/25 border border-next-purple-neon/30 text-next-purple-light text-[10px] font-bold py-1.5 rounded-lg uppercase">Agendar</button>
                      {wa && (
                        <button onClick={(e) => { e.stopPropagation(); window.open(wa, '_blank', 'noreferrer,noopener'); }} className="flex-1 bg-next-green-success/15 hover:bg-next-green-success/25 border border-next-green-success/30 text-next-green-success text-[10px] font-bold py-1.5 rounded-lg uppercase flex items-center justify-center gap-1">
                          <MessageCircle className="w-3 h-3" /> Whats
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {renderSharedModals()}

        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span>Cadastrar, editar e excluir pacientes grava de verdade nesta clínica</span>
          </span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // MODO PRONTUÁRIO — ficha completa em tela cheia
  // -------------------------------------------------------------------

  function renderSharedModals() {
    return (
      <>
        {/* NEW PATIENT MODAL */}
        <AnimatePresence>
          {isAddOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingPatient && setIsAddOpen(false)}>
              <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-slate-100">Cadastrar paciente</h3>
                  <button onClick={() => !savingPatient && setIsAddOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-[11px] text-amber-400/90 mb-4 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Isto grava um paciente real nesta clínica.</p>

                <form onSubmit={handleAddPatient} className="space-y-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Nome completo *</label>
                    <input autoFocus value={newPatient.name} onChange={(e) => setNewPatient(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Telefone / WhatsApp *</label>
                    <input value={newPatient.phone} onChange={(e) => setNewPatient(v => ({ ...v, phone: e.target.value }))} placeholder="5511999990000" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">E-mail (opcional)</label>
                    <input value={newPatient.email} onChange={(e) => setNewPatient(v => ({ ...v, email: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  {createError && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{createError}</p>}
                  <button type="submit" disabled={savingPatient} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                    {savingPatient ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    <span>{savingPatient ? 'Gravando...' : 'Salvar paciente real'}</span>
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FICHA DRAWER — cadastro completo, usado no modo lista e no modo prontuário */}
        <AnimatePresence>
          {fichaTarget && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end" onClick={() => setFichaTarget(null)}>
              <motion.div
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.25 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm h-full bg-next-bg-card border-l border-next-border p-6 overflow-y-auto"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-100">Ficha do Paciente</h3>
                  <button onClick={() => setFichaTarget(null)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                </div>

                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg uppercase mb-4 ${colorFor(fichaTarget.name).avatar}`}>
                  {(fichaTarget.name || '?').charAt(0)}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Nome completo</label>
                    <input value={editForm.name} onChange={(e) => setEditForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Telefone</label>
                    <input value={editForm.phone} onChange={(e) => setEditForm(v => ({ ...v, phone: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">E-mail</label>
                    <input value={editForm.email} onChange={(e) => setEditForm(v => ({ ...v, email: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">CPF</label>
                      <input value={editForm.cpf} onChange={(e) => setEditForm(v => ({ ...v, cpf: e.target.value }))} placeholder="000.000.000-00" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Nascimento</label>
                      <input type="date" value={editForm.birthDate} onChange={(e) => setEditForm(v => ({ ...v, birthDate: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Endereço</label>
                    <input value={editForm.address} onChange={(e) => setEditForm(v => ({ ...v, address: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                    <select value={editForm.status} onChange={(e) => setEditForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                      <option value="active">Ativo</option>
                      <option value="suspended">Suspenso</option>
                      <option value="suspect">Falta</option>
                      <option value="review">Revisão</option>
                    </select>
                  </div>

                  <button onClick={handleSaveFicha} disabled={savingEdit} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                    {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>{savingEdit ? 'Gravando...' : 'Salvar alterações reais'}</span>
                  </button>
                </div>

                <div className="mt-6 pt-4 border-t border-next-border space-y-2">
                  <p className="text-[10px] font-mono text-slate-500 uppercase mb-2">Próximo agendamento</p>
                  {(() => {
                    const nextAppt = getNextAppointment(fichaTarget.id, fichaTarget.name);
                    return nextAppt ? (
                      <div className="text-xs text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/20 rounded-lg p-2.5">
                        {(nextAppt.date || '').split('-').reverse().join('/')} às {nextAppt.time}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 bg-slate-900/50 border border-next-border rounded-lg p-2.5">Sem agendamento futuro</div>
                    );
                  })()}

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => { openRecord(fichaTarget.id); setFichaTarget(null); }} className="flex-1 bg-next-ia-blue/15 hover:bg-next-ia-blue/25 border border-next-ia-blue/30 text-next-ia-blue-light text-[10.5px] font-bold py-2 rounded-lg uppercase">Ver prontuário</button>
                    <button onClick={() => onScheduleForPatient?.(fichaTarget.name)} className="flex-1 bg-next-purple-neon/15 hover:bg-next-purple-neon/25 border border-next-purple-neon/30 text-next-purple-light text-[10.5px] font-bold py-2 rounded-lg uppercase">Agendar</button>
                    {waLink(fichaTarget.phone) && (
                      <button onClick={() => window.open(waLink(fichaTarget.phone)!, '_blank', 'noreferrer,noopener')} className="flex-1 bg-next-green-success/15 hover:bg-next-green-success/25 border border-next-green-success/30 text-next-green-success text-[10.5px] font-bold py-2 rounded-lg uppercase flex items-center justify-center gap-1">
                        <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                      </button>
                    )}
                  </div>

                  {isAdmin && (
                    <button
                      onClick={() => handleDeletePatient(fichaTarget)}
                      disabled={deletingId === fichaTarget.id}
                      className="w-full mt-2 inline-flex items-center justify-center gap-1.5 text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 hover:bg-next-red-alert/20 text-[10.5px] font-bold py-2 rounded-lg uppercase disabled:opacity-50"
                    >
                      {deletingId === fichaTarget.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Excluir paciente real
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-4 font-sans">

      {/* Barra superior: voltar + trocar paciente */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setViewMode('list')} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-next-border rounded-xl px-3 py-2.5 flex-shrink-0">
          <ArrowLeft className="w-3.5 h-3.5" /> Pacientes
        </button>
        <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest hidden sm:inline">Prontuário Vivo</span>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={recordSwitchTerm}
            onChange={(e) => setRecordSwitchTerm(e.target.value)}
            placeholder="Trocar de paciente..."
            className="w-full bg-slate-900/70 border border-next-border rounded-xl py-2.5 pl-8 pr-3 text-[11px] text-slate-200 outline-none focus:border-next-purple-neon/50"
          />
          {recordSwitchTerm.trim() && (
            <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-next-bg-card border border-next-border rounded-xl shadow-xl max-h-56 overflow-y-auto">
              {recordSwitchResults.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-slate-500">Nenhum paciente encontrado.</p>
              ) : recordSwitchResults.map(p => (
                <button key={p.id} onClick={() => openRecord(p.id)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-[9px] font-bold uppercase flex-shrink-0">{(p.name || '?').charAt(0)}</span>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 text-xs text-next-green-success font-semibold">
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      {!selectedPatient ? (
        <div className="next-glass-panel rounded-next-2xl p-10 text-center">
          <ClipboardList className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">Paciente não encontrado</p>
          <p className="text-xs text-slate-500 mt-1">Volte para a lista e selecione um paciente para ver o prontuário real.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Patient header — premium */}
          <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
            <div className="absolute top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
                <div className="w-16 h-16 rounded-2xl bg-next-purple-neon/20 text-next-purple-light flex items-center justify-center font-black text-2xl uppercase flex-shrink-0">{(selectedPatient.name || '?').charAt(0)}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-black text-slate-100 tracking-tight truncate">{selectedPatient.name}</h2>
                    {statusBadge(selectedPatient.status)}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-1.5">
                    {selectedPatient.phone && <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1"><Smartphone className="w-3 h-3" />{selectedPatient.phone}</span>}
                    {selectedPatient.cpf && <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1"><IdCard className="w-3 h-3" />{selectedPatient.cpf}</span>}
                    {selectedPatient.birthDate && <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1"><Cake className="w-3 h-3" />{formatDate(selectedPatient.birthDate)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                <button onClick={() => openFicha(selectedPatient)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-slate-300 bg-slate-900/70 hover:bg-slate-800 border border-next-border px-3 py-2 rounded-xl">
                  <Pencil className="w-3.5 h-3.5" /> Editar Cadastro
                </button>
                {selectedPatient.phone && (
                  <a href={`tel:${(selectedPatient.phone || '').replace(/\D/g, '')}`} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-slate-300 bg-slate-900/70 hover:bg-slate-800 border border-next-border px-3 py-2 rounded-xl">
                    <Phone className="w-3.5 h-3.5" /> Ligar
                  </a>
                )}
                {waLink(selectedPatient.phone) && (
                  <a href={waLink(selectedPatient.phone)!} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-green-success bg-next-green-success/15 hover:bg-next-green-success/25 border border-next-green-success/30 px-3 py-2 rounded-xl">
                    <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                  </a>
                )}
                <button onClick={() => onScheduleForPatient?.(selectedPatient.name)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 hover:bg-next-purple-neon/25 border border-next-purple-neon/30 px-3 py-2 rounded-xl">
                  <Calendar className="w-3.5 h-3.5" /> Agendar
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-900/60 border border-next-border rounded-xl p-1 overflow-x-auto">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${activeTab === t.id ? 'next-brand-gradient-bg text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          {loadingRecord ? (
            <div className="next-glass-panel rounded-next-2xl p-10 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-next-purple-neon" />
              <span className="text-xs font-mono text-slate-500">Carregando prontuário real...</span>
            </div>
          ) : (
            <>
              {/* RESUMO — cadastro completo + últimas consultas + anamnese */}
              {activeTab === 'resumo' && (
                <div className="space-y-4">
                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><IdCard className="w-4 h-4 text-next-purple-neon" /> Dados Cadastrais</h3>
                      <button onClick={() => openFicha(selectedPatient)} className="text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2.5 py-1 rounded-lg">Editar</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                        <p className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><Smartphone className="w-3 h-3" /> Telefone</p>
                        <p className="text-xs text-slate-200 mt-0.5">{selectedPatient.phone || '—'}</p>
                      </div>
                      <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                        <p className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><Mail className="w-3 h-3" /> E-mail</p>
                        <p className="text-xs text-slate-200 mt-0.5">{selectedPatient.email || '—'}</p>
                      </div>
                      <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                        <p className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><IdCard className="w-3 h-3" /> CPF</p>
                        <p className="text-xs text-slate-200 mt-0.5">{selectedPatient.cpf || '—'}</p>
                      </div>
                      <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                        <p className="text-[9.5px] font-mono text-slate-500 uppercase flex items-center gap-1"><Cake className="w-3 h-3" /> Nascimento</p>
                        <p className="text-xs text-slate-200 mt-0.5">{selectedPatient.birthDate ? formatDate(selectedPatient.birthDate) : '—'}</p>
                      </div>
                      <div className="sm:col-span-2 bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                        <p className="text-[9.5px] font-mono text-slate-500 uppercase">Endereço</p>
                        <p className="text-xs text-slate-200 mt-0.5">{selectedPatient.address || '—'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><History className="w-4 h-4 text-next-purple-neon" /> Últimas Consultas</h3>
                    {patientAppointmentHistory.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhuma consulta registrada ainda para este paciente.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {patientAppointmentHistory.map(a => {
                          const meta = APPT_STATUS_META[a.status || 'pendente'] || APPT_STATUS_META.pendente;
                          return (
                            <div key={a.id} className="flex items-center justify-between gap-2 bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-200 truncate">{a.treatment || 'Consulta'}</p>
                                <p className="text-[10px] text-slate-500 font-mono">
                                  {(a.date || '').split('-').reverse().join('/')} {a.time || ''}
                                  {a.dentistName ? ` • Atendido por ${a.dentistName}` : ''}
                                </p>
                              </div>
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border tracking-wider shrink-0 ${meta.classes}`}>{meta.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-next-purple-neon" /> Anamnese</h3>
                      <button onClick={() => setIsAnamnesisOpen(v => !v)} className="text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2.5 py-1 rounded-lg">
                        {isAnamnesisOpen ? 'Fechar' : anamnesis ? 'Editar' : 'Preencher'}
                      </button>
                    </div>

                    {!isAnamnesisOpen ? (
                      anamnesis ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {ANAMNESIS_FIELDS.map(f => (
                            <div key={f.name} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">{f.label}</p>
                              <p className="text-xs text-slate-200 mt-0.5">{anamnesis[f.name] || '—'}</p>
                            </div>
                          ))}
                          {anamnesis.internalNotes && (
                            <div className="sm:col-span-2 bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">Notas internas</p>
                              <p className="text-xs text-slate-200 mt-0.5">{anamnesis.internalNotes}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Nenhuma anamnese registrada ainda para este paciente.</p>
                      )
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {ANAMNESIS_FIELDS.map(f => (
                            <div key={f.name}>
                              <label className="text-[10px] font-mono text-slate-500 uppercase">{f.label}</label>
                              <input value={anamnesisForm[f.name] || ''} onChange={(e) => setAnamnesisForm(v => ({ ...v, [f.name]: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="text-[10px] font-mono text-slate-500 uppercase">Notas internas</label>
                          <textarea value={anamnesisForm.internalNotes || ''} onChange={(e) => setAnamnesisForm(v => ({ ...v, internalNotes: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-20 resize-none" />
                        </div>
                        <button onClick={handleSaveAnamnesis} disabled={savingAnamnesis} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '38px' }}>
                          {savingAnamnesis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          <span>{savingAnamnesis ? 'Gravando...' : 'Salvar anamnese real'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* EVOLUÇÃO */}
              {activeTab === 'evolucao' && (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Activity className="w-4 h-4 text-next-purple-neon" /> Evolução Clínica</h3>
                  <div className="flex gap-2">
                    <input value={newEvolutionText} onChange={(e) => setNewEvolutionText(e.target.value)} placeholder="Registrar evolução de hoje..." className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5" onKeyDown={(e) => { if (e.key === 'Enter') handleAddEvolution(); }} />
                    <button onClick={handleAddEvolution} disabled={savingEvolution || !newEvolutionText.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50 flex-shrink-0">
                      {savingEvolution ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><Info className="w-3 h-3 flex-shrink-0" /> Evoluções podem ser excluídas no mesmo dia do lançamento. A partir do dia seguinte, excluir vira "anular" — o texto some da conduta ativa mas fica riscado no histórico.</p>
                  <div className="pl-4 border-l border-next-border space-y-3 pt-2">
                    {timeline.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhuma evolução clínica registrada ainda para este paciente.</p>
                    ) : timeline.map((item, idx) => {
                      const isPending = !!item.id && pendingEvolutionAction?.evolutionId === item.id;
                      const isProcessing = !!item.id && processingEvolutionId === item.id;
                      return (
                        <div key={item.id || idx} className={`relative border rounded-lg p-3 ${item.voided ? 'bg-slate-900/20 border-next-border/60' : 'bg-slate-900/40 border-next-border'}`}>
                          <div className={`absolute -left-[21px] top-4 w-2 h-2 rounded-full ${item.voided ? 'bg-slate-600' : 'bg-next-purple-neon'}`} />
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <span className="text-[10px] font-mono text-next-purple-light truncate">{item.treatmentDesc}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(item.date)}</span>
                              {item.id && !item.voided && (
                                isPending ? (
                                  <div className="flex items-center gap-1">
                                    <button onClick={confirmEvolutionAction} disabled={isProcessing} className="text-[9px] font-bold text-white bg-next-red-alert px-1.5 py-1 rounded disabled:opacity-60 whitespace-nowrap">
                                      {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : (pendingEvolutionAction?.mode === 'delete' ? 'Confirmar exclusão' : 'Confirmar anulação')}
                                    </button>
                                    <button onClick={cancelEvolutionAction} className="text-slate-500 hover:text-slate-300"><X className="w-3 h-3" /></button>
                                  </div>
                                ) : (
                                  <button onClick={() => requestEvolutionAction(item)} title={isSameCalendarDay(item.date) ? 'Excluir (ainda hoje)' : 'Anular (mantém no histórico)'} className="text-slate-600 hover:text-next-red-alert">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                          <p className={`text-xs leading-relaxed ${item.voided ? 'text-slate-500 line-through decoration-slate-600' : 'text-slate-200'}`}>{item.text}</p>
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <span className="text-[9.5px] text-slate-500">{item.professional ? `Por ${item.professional}` : ''}{item.updatedAt && !item.voided ? ' (Editado)' : ''}</span>
                            {item.voided && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500 bg-slate-800 border border-next-border px-1.5 py-0.5 rounded flex-shrink-0">Anulado em {formatDate(item.voidedAt)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* IA CLÍNICA — ELIZA Treatment Studio (Parte 1) */}
              {activeTab === 'ia_clinica' && (
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-next-2xl p-6 next-brand-gradient-bg shadow-next-glow-purple-strong">
                    <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl pointer-events-none bg-white/10" />
                    <div className="relative z-10 flex items-center gap-4">
                      <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center text-white border border-white/20 flex-shrink-0">
                        <Brain className="w-7 h-7" />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-white tracking-tight flex items-center gap-2 flex-wrap">
                          Centro de Planejamento Clínico Inteligente
                          <span className="text-[9.5px] bg-white/20 font-extrabold uppercase px-2 py-0.5 rounded-full text-white tracking-widest">ELIZA AI Center</span>
                        </h3>
                        <p className="text-white/80 text-[11px] mt-1">A Eliza já leu a anamnese e a evolução reais deste paciente. Escolha a especialidade, relate o caso e anexe exames — ela monta um diagnóstico e plano de tratamento completo, 100% editável.</p>
                      </div>
                    </div>
                  </div>

                  {/* Alertas Clínicos — motor de regras real sobre a anamnese, sem depender de IA */}
                  {anamnesis && (
                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-400" /> Alertas Clínicos
                        <span className="text-[9px] font-mono text-slate-500 normal-case font-normal">(regras sobre a anamnese real — não depende de IA)</span>
                      </h3>
                      {clinicalAlerts.length === 0 ? (
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <Check className="w-4 h-4 text-next-green-success flex-shrink-0" /> Nenhum alerta identificado na anamnese registrada.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {clinicalAlerts.map((a, i) => (
                            <div key={i} className={`p-3 rounded-xl border flex gap-2.5 items-start ${
                              a.type === 'danger' ? 'bg-next-red-alert/10 border-next-red-alert/25' :
                              a.type === 'warning' ? 'bg-amber-500/10 border-amber-500/25' :
                              'bg-next-ia-blue/10 border-next-ia-blue/25'
                            }`}>
                              {a.type === 'info' ? <Info className="w-4 h-4 text-next-ia-blue flex-shrink-0 mt-0.5" /> : <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${a.type === 'danger' ? 'text-next-red-alert' : 'text-amber-400'}`} />}
                              <div>
                                <p className={`text-xs font-bold ${a.type === 'danger' ? 'text-next-red-alert' : a.type === 'warning' ? 'text-amber-300' : 'text-next-ia-blue-light'}`}>{a.title}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">{a.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
                        {/* Specialty multi-select */}
                        <div>
                          <p className="text-[10px] font-mono text-slate-500 uppercase mb-1.5">Especialidade(s) — pode marcar várias</p>
                          <div className="flex flex-wrap gap-1.5">
                            {SPECIALTIES.map(spec => (
                              <button
                                key={spec}
                                onClick={() => toggleSpecialty(spec)}
                                className={`text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                                  iaSpecialties.includes(spec) ? 'next-brand-gradient-bg text-white border-transparent' : 'bg-slate-900/60 border-next-border text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {spec}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Case description + voice dictation */}
                        <div>
                          <p className="text-[10px] font-mono text-slate-500 uppercase mb-1.5">Qual é sua dúvida? Relate o caso</p>
                          <div className="relative">
                            <textarea
                              value={iaCaseDescription}
                              onChange={(e) => setIaCaseDescription(e.target.value)}
                              placeholder="Ex: Paciente perdeu os elementos 24 e 25, tem pouca altura óssea, é fumante. Gostaria de devolver estética. Também reclama do envelhecimento facial..."
                              className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-28 resize-none pr-10"
                            />
                            <button
                              onClick={toggleVoiceInput}
                              title={iaListening ? 'Parar ditado' : 'Ditar por voz'}
                              className={`absolute right-2 top-2 p-1.5 rounded-lg ${iaListening ? 'bg-next-red-alert/20 text-next-red-alert animate-pulse' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                            >
                              {iaListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Exam / photo upload — sent for real multimodal AI analysis */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] font-mono text-slate-500 uppercase">Fotos, raio-x, tomografia, exames</p>
                            <input ref={examFileInputRef} type="file" accept="image/*" multiple onChange={handleExamFilesSelected} className="hidden" />
                            <button onClick={() => examFileInputRef.current?.click()} className="inline-flex items-center gap-1 text-[10px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2 py-1 rounded-lg">
                              <Paperclip className="w-3 h-3" /> Anexar
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-600 mb-1.5">Até 6 imagens, 900KB cada — a Eliza analisa visualmente cada uma junto com o caso (não é só anexo, é lido de verdade).</p>
                          {iaExamFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {iaExamFiles.map(f => (
                                <div key={f.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-next-border group">
                                  <img src={f.dataUrl} alt={f.name} className="w-full h-full object-cover" />
                                  <button onClick={() => removeExamFile(f.id)} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={handleAnalyzeCase}
                          disabled={iaAnalyzing || iaSpecialties.length === 0 || !iaCaseDescription.trim()}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple-strong disabled:opacity-50"
                        >
                          {iaAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                          <span>{iaAnalyzing ? 'A Eliza está analisando...' : 'Analisar caso com a Eliza'}</span>
                        </button>
                        <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> Chama a IA real (mesmo Gateway do app legado, OpenAI com fallback Gemini). Sem chave de API configurada neste ambiente, aparece um erro real — não é simulado.</p>
                  </div>

                  {/* "Thinking" progress */}
                  <AnimatePresence>
                    {iaAnalyzing && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="next-glass-panel rounded-next-2xl p-5 overflow-hidden">
                        <div className="space-y-2">
                          {ANALYSIS_STEPS.map((step, idx) => (
                            <div key={step} className={`flex items-center gap-2 text-xs transition-colors ${idx <= iaAnalysisStepIndex ? 'text-slate-200' : 'text-slate-600'}`}>
                              {idx < iaAnalysisStepIndex ? (
                                <Check className="w-3.5 h-3.5 text-next-green-success flex-shrink-0" />
                              ) : idx === iaAnalysisStepIndex ? (
                                <Loader2 className="w-3.5 h-3.5 text-next-purple-neon animate-spin flex-shrink-0" />
                              ) : (
                                <span className="w-3.5 h-3.5 rounded-full border border-slate-700 flex-shrink-0" />
                              )}
                              {step}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {iaError && (
                    <div className="next-glass-panel rounded-next-2xl p-4 border-next-red-alert/30">
                      <p className="text-[11px] text-next-red-alert">{iaError}</p>
                    </div>
                  )}

                  {/* Diagnosis result — fully editable */}
                  {iaDiagnosis && (
                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-next-purple-neon" />
                        <h4 className="text-xs font-bold text-slate-200">Diagnóstico e Plano de Tratamento (sugestão da Eliza — revise e edite)</h4>
                      </div>

                      <div>
                        <p className="text-[10px] font-mono text-slate-500 uppercase mb-1">Resumo</p>
                        <textarea value={iaDiagnosis.summary} onChange={(e) => setIaDiagnosis(prev => prev ? { ...prev, summary: e.target.value } : prev)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 h-16 resize-none" />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {renderEditableList('problems', 'Problemas encontrados')}
                        {renderEditableList('hypotheses', 'Hipóteses')}
                        {renderEditableList('differentialDiagnosis', 'Diagnóstico diferencial')}
                        {renderEditableList('objectives', 'Objetivos')}
                      </div>

                      {/* Treatment phases */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-mono text-slate-500 uppercase">Plano de tratamento (fases)</p>
                          <button onClick={addPhase} className="text-[10px] font-bold text-slate-500 hover:text-slate-300">+ adicionar fase</button>
                        </div>
                        <div className="space-y-2">
                          {iaDiagnosis.phases.map((phase, idx) => (
                            <div key={idx} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5 space-y-1.5">
                              <div className="flex gap-1.5">
                                <input value={phase.name} onChange={(e) => updatePhase(idx, { name: e.target.value })} className="flex-1 bg-slate-950 border border-next-border rounded-lg text-xs font-bold text-next-purple-light px-2.5 py-1.5" />
                                <button onClick={() => removePhase(idx)} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                              <textarea value={phase.description} onChange={(e) => updatePhase(idx, { description: e.target.value })} className="w-full bg-slate-950 border border-next-border rounded-lg text-xs text-slate-300 px-2.5 py-1.5 h-14 resize-none" />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {renderEditableList('materials', 'Materiais necessários')}
                        {renderEditableList('risks', 'Riscos')}
                      </div>
                      {renderEditableList('orientations', 'Orientações')}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-mono text-slate-500 uppercase">Tempo estimado</label>
                          <input value={iaDiagnosis.estimatedTime} onChange={(e) => setIaDiagnosis(prev => prev ? { ...prev, estimatedTime: e.target.value } : prev)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono text-slate-500 uppercase">Complexidade</label>
                          <select value={iaDiagnosis.complexity} onChange={(e) => setIaDiagnosis(prev => prev ? { ...prev, complexity: e.target.value } : prev)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                            <option value="Baixa">Baixa</option>
                            <option value="Média">Média</option>
                            <option value="Alta">Alta</option>
                          </select>
                        </div>
                      </div>

                      {/* Suggested budget */}
                      <div className="border-t border-next-border pt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-mono text-slate-500 uppercase">Orçamento sugerido</p>
                          <button onClick={addDiagnosisItem} className="text-[10px] font-bold text-slate-500 hover:text-slate-300">+ adicionar item</button>
                        </div>
                        <div className="space-y-1.5">
                          {iaDiagnosis.suggestedItems.map((it, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input value={it.description} onChange={(e) => updateDiagnosisItem(idx, { description: e.target.value })} placeholder="Procedimento" className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                              <input type="number" value={it.quantity} onChange={(e) => updateDiagnosisItem(idx, { quantity: Number(e.target.value) })} className="w-14 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-2" />
                              <input type="number" value={it.value} onChange={(e) => updateDiagnosisItem(idx, { value: Number(e.target.value) })} placeholder="R$" className="w-24 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-2" />
                              <button onClick={() => removeDiagnosisItem(idx)} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-2">Total estimado: <strong className="text-next-purple-light">{formatCurrency(diagnosisTotal)}</strong></p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-next-border">
                        <button onClick={handleSaveDiagnosisToRecord} disabled={iaSavingDiagnosis} className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-xs rounded-xl disabled:opacity-60">
                          {iaSavingDiagnosis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          <span>{iaSavingDiagnosis ? 'Gravando...' : 'Salvar no prontuário (real)'}</span>
                        </button>
                        <button onClick={handleSendDiagnosisToQuotation} className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple">
                          <Receipt className="w-3.5 h-3.5" />
                          <span>Gerar orçamento com estes itens</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Follow-up chat — continua a conversa sobre o diagnóstico com a mesma IA real */}
                  {iaDiagnosis && (
                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                      <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Sparkles className="w-4 h-4 text-next-purple-neon" /> Perguntar mais à Eliza</h4>
                      {iaChatMessages.length > 0 && (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {iaChatMessages.map((m, i) => (
                            <div key={i} className={`text-xs rounded-lg p-2.5 ${m.role === 'user' ? 'bg-next-purple-neon/15 border border-next-purple-neon/25 text-slate-200 ml-6' : 'bg-slate-900/60 border border-next-border text-slate-300 mr-6'}`}>
                              <span className="block text-[9px] font-mono uppercase text-slate-500 mb-0.5">{m.role === 'user' ? 'Você' : 'Eliza'}</span>
                              {m.text}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={iaChatInput}
                          onChange={(e) => setIaChatInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAskFollowUp(); }}
                          placeholder="Ex: e se o paciente tiver bruxismo, muda alguma coisa no plano?"
                          className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5"
                        />
                        <button onClick={handleAskFollowUp} disabled={iaChatLoading || !iaChatInput.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50 flex-shrink-0">
                          {iaChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* History of previously saved AI plans */}
                  {savedDiagnoses.length > 0 && (
                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                      <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-next-purple-neon" /> Planos salvos anteriormente</h4>
                      {savedDiagnoses.map(d => (
                        <div key={d.id} className="bg-slate-900/40 border border-next-border rounded-lg overflow-hidden">
                          <button onClick={() => setIaExpandedHistoryId(iaExpandedHistoryId === d.id ? null : (d.id || null))} className="w-full flex items-center justify-between p-3 text-left">
                            <div>
                              <p className="text-xs font-bold text-slate-200">{d.specialties?.join(', ') || 'Plano de tratamento'}</p>
                              <p className="text-[10px] text-slate-500">{formatDate(d.createdAt)} — {formatCurrency((d.suggestedItems || []).reduce((a, it) => a + it.value * it.quantity, 0))}</p>
                            </div>
                            {iaExpandedHistoryId === d.id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                          </button>
                          {iaExpandedHistoryId === d.id && (
                            <div className="px-3 pb-3 text-xs text-slate-300 space-y-1.5">
                              <p className="italic text-slate-400">{d.summary}</p>
                              {d.phases?.map((p, i) => <p key={i}><strong className="text-next-purple-light">{p.name}:</strong> {p.description}</p>)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ORÇAMENTO */}
              {activeTab === 'orcamento' && (
                <div className="space-y-4">
                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Receipt className="w-4 h-4 text-next-purple-neon" /> Orçamentos</h3>
                      <button onClick={openNewQuotation} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple">
                        <Plus className="w-3.5 h-3.5" /> Novo orçamento
                      </button>
                    </div>

                    {quotations.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum orçamento registrado ainda para este paciente.</p>
                    ) : (
                      <div className="space-y-2">
                        {quotations.map(q => (
                          <div key={q.id} className="bg-slate-900/40 border border-next-border rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-slate-200">{q.title}</span>
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                                q.status === 'approved' ? 'bg-next-green-success/10 border-next-green-success/25 text-next-green-success' :
                                q.status === 'rejected' ? 'bg-next-red-alert/10 border-next-red-alert/25 text-next-red-alert' :
                                'bg-slate-800 border-next-border text-slate-400'
                              }`}>{q.status === 'approved' ? 'aprovado' : q.status === 'rejected' ? 'rejeitado' : 'rascunho'}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mb-2">{q.items?.length || 0} item(ns) — <span className="text-next-purple-light font-bold">{formatCurrency(q.totalValue)}</span></p>
                            <div className="flex items-center gap-1.5">
                              {q.status !== 'approved' && (
                                <button onClick={() => handleUpdateQuotationStatus(q, 'approved')} disabled={updatingQuotationId === q.id} className="inline-flex items-center gap-1 text-[10px] font-bold text-next-green-success bg-next-green-success/10 border border-next-green-success/25 px-2 py-1 rounded-lg disabled:opacity-50">
                                  {updatingQuotationId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Aprovar
                                </button>
                              )}
                              {q.status !== 'rejected' && (
                                <button onClick={() => handleUpdateQuotationStatus(q, 'rejected')} disabled={updatingQuotationId === q.id} className="inline-flex items-center gap-1 text-[10px] font-bold text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/25 px-2 py-1 rounded-lg disabled:opacity-50">
                                  <X className="w-3 h-3" /> Rejeitar
                                </button>
                              )}
                              {q.status !== 'draft' && (
                                <button onClick={() => handleUpdateQuotationStatus(q, 'draft')} disabled={updatingQuotationId === q.id} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 border border-next-border px-2 py-1 rounded-lg disabled:opacity-50">
                                  Reverter p/ rascunho
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {isQuotationFormOpen && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="next-glass-panel rounded-next-2xl p-5 space-y-3 overflow-hidden">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-200">Novo orçamento</h4>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setIsAiPanelOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2.5 py-1.5 rounded-lg">
                              <Sparkles className="w-3.5 h-3.5" /> Pedir ajuda à Eliza
                            </button>
                            <button onClick={() => setIsQuotationFormOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                          </div>
                        </div>

                        {/* AI Treatment Plan Assist — calls the real AI Gateway */}
                        <AnimatePresence>
                          {isAiPanelOpen && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="bg-slate-950 border border-next-purple-neon/30 rounded-xl p-3 space-y-2 overflow-hidden">
                              <p className="text-[10.5px] text-slate-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />Isto chama a IA real (Gemini) via o mesmo proxy do app legado. Se a chave de API não estiver configurada neste ambiente, vai aparecer um erro claro — não é simulado.</p>
                              <textarea
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder="Descreva o que o paciente precisa (ex: dor no dente 26, quer clareamento, precisa de 2 restaurações)..."
                                className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-20 resize-none"
                              />
                              <button onClick={handleAskEliza} disabled={aiLoading || !aiPrompt.trim()} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                <span>{aiLoading ? 'Consultando a Eliza...' : 'Gerar sugestão de plano com IA'}</span>
                              </button>

                              {aiError && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{aiError}</p>}

                              {aiSuggestion && (
                                <div className="bg-slate-900/60 border border-next-border rounded-lg p-3 space-y-2">
                                  <p className="text-xs text-slate-300 italic">{aiSuggestion.summary}</p>
                                  <div className="space-y-1">
                                    {aiSuggestion.items.map((it, i) => (
                                      <div key={i} className="flex items-center justify-between text-[11px] bg-slate-950 rounded px-2 py-1.5">
                                        <span className="text-slate-300">{it.quantity}x {it.description}</span>
                                        <span className="text-next-purple-light font-bold">{formatCurrency(it.value)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <button onClick={applyAiSuggestion} className="w-full inline-flex items-center justify-center gap-1.5 text-[10.5px] font-bold text-next-green-success bg-next-green-success/15 border border-next-green-success/30 py-2 rounded-lg">
                                    <Check className="w-3.5 h-3.5" /> Adicionar itens sugeridos ao orçamento
                                  </button>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div>
                          <label className="text-[10px] font-mono text-slate-500 uppercase">Título</label>
                          <input value={quotationTitle} onChange={(e) => setQuotationTitle(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-mono text-slate-500 uppercase">Itens</label>
                          {quotationItems.map((it, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input value={it.description} onChange={(e) => updateQuotationItem(idx, { description: e.target.value })} placeholder="Procedimento" className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                              <input type="number" value={it.quantity} onChange={(e) => updateQuotationItem(idx, { quantity: Number(e.target.value) })} className="w-14 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-2" />
                              <input type="number" value={it.value} onChange={(e) => updateQuotationItem(idx, { value: Number(e.target.value) })} placeholder="R$" className="w-24 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-2" />
                              <button onClick={() => setQuotationItems(prev => prev.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                          <button onClick={() => setQuotationItems(prev => [...prev, { description: '', value: 0, quantity: 1 }])} className="text-[10.5px] font-bold text-slate-400 hover:text-slate-200">+ adicionar item</button>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-next-border">
                          <span className="text-xs text-slate-400">Total: <strong className="text-next-purple-light">{formatCurrency(quotationTotal)}</strong></span>
                          <button onClick={handleSaveQuotation} disabled={savingQuotation} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                            {savingQuotation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            <span>{savingQuotation ? 'Gravando...' : 'Salvar orçamento real'}</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* CONTRATOS */}
              {activeTab === 'contratos' && selectedPatient && (
                <NextContractsPanel
                  patient={{ id: selectedPatient.id, name: selectedPatient.name, phone: selectedPatient.phone, cpf: selectedPatient.cpf, birthDate: selectedPatient.birthDate }}
                  quotations={quotations}
                />
              )}

              {/* RECEITUÁRIOS */}
              {activeTab === 'receituarios' && selectedPatient && (
                <NextPrescriptionsPanel
                  patient={{ id: selectedPatient.id, name: selectedPatient.name, cpf: selectedPatient.cpf, birthDate: selectedPatient.birthDate }}
                  anamnesis={anamnesis}
                />
              )}

              {/* IMAGENS */}
              {activeTab === 'imagens' && (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-next-purple-neon" /> Imagens</h3>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelected} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploadingImage} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple disabled:opacity-60">
                      {uploadingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>{uploadingImage ? 'Enviando...' : 'Adicionar imagem'}</span>
                    </button>
                  </div>
                  <p className="text-[10.5px] text-slate-500">Máx. 800KB por imagem (armazenada como base64 no documento do paciente, mesmo limite do app legado).</p>
                  {images.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhuma imagem registrada ainda para este paciente.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {images.map(img => (
                        <div key={img.id} className="bg-slate-900/40 border border-next-border rounded-xl overflow-hidden relative group">
                          <img src={img.url} alt={img.title} className="w-full h-24 object-cover" />
                          <button
                            onClick={() => handleDeleteImage(img)}
                            disabled={deletingImageId === img.id}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-slate-950/80 border border-next-border text-slate-300 hover:text-next-red-alert hover:border-next-red-alert/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-100"
                            title="Excluir imagem"
                          >
                            {deletingImageId === img.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </button>
                          <div className="p-2">
                            <p className="text-[10px] font-bold text-slate-300 truncate">{img.title}</p>
                            <p className="text-[9px] text-slate-500">{formatDate(img.date)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* FINANCEIRO */}
              {activeTab === 'financeiro' && (
                <div className="space-y-4">
                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Wallet className="w-4 h-4 text-next-purple-neon" /> Financeiro do paciente</h3>
                      <button onClick={() => setIsFinancialFormOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple">
                        <Plus className="w-3.5 h-3.5" /> Novo lançamento
                      </button>
                    </div>

                    {financialEntries.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum lançamento financeiro real para este paciente ainda.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {financialEntries.map(f => (
                          <div key={f.id} className="flex items-center justify-between bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                            <div>
                              <p className="text-xs font-semibold text-slate-200">{f.description}</p>
                              <p className="text-[10px] text-slate-500">{formatDate(f.date)} • {f.paymentMethod}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-bold text-next-purple-light">{formatCurrency(f.amount)}</p>
                              <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${f.status === 'paid' ? 'text-next-green-success bg-next-green-success/10' : 'text-next-orange-insight bg-next-orange-insight/10'}`}>{f.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {isFinancialFormOpen && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="next-glass-panel rounded-next-2xl p-5 space-y-3 overflow-hidden">
                        <div>
                          <label className="text-[10px] font-mono text-slate-500 uppercase">Descrição</label>
                          <input value={financialForm.description} onChange={(e) => setFinancialForm(v => ({ ...v, description: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Valor (R$)</label>
                            <input type="number" value={financialForm.amount} onChange={(e) => setFinancialForm(v => ({ ...v, amount: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                          </div>
                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                            <select value={financialForm.status} onChange={(e) => setFinancialForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                              <option value="pending">Pendente</option>
                              <option value="partial">Parcial</option>
                              <option value="paid">Pago</option>
                              <option value="cancelled">Cancelado</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Método</label>
                            <select value={financialForm.paymentMethod} onChange={(e) => setFinancialForm(v => ({ ...v, paymentMethod: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                              <option value="PIX">PIX</option>
                              <option value="Cartão">Cartão</option>
                              <option value="Dinheiro">Dinheiro</option>
                              <option value="Boleto">Boleto</option>
                            </select>
                          </div>
                        </div>
                        <button onClick={handleAddFinancialEntry} disabled={savingFinancial} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                          {savingFinancial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          <span>{savingFinancial ? 'Gravando...' : 'Salvar lançamento real'}</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {renderSharedModals()}

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Cadastro, anamnese, evolução, orçamento, imagens e financeiro gravam de verdade nesta clínica</span>
        </span>
      </div>
    </div>
  );
}
