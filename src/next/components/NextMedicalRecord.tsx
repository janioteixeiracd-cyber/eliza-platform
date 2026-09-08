import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  HeartPulse, Search, Calendar, AlertTriangle, Loader2, RefreshCw,
  Plus, Save, X, ClipboardList, Activity, Smartphone, Receipt, Image as ImageIcon,
  Wallet, Sparkles, Trash2, Check, Upload, Brain, Mic, MicOff, Paperclip,
  ShieldAlert, Wand2, ChevronDown, ChevronUp, FileText, Pill,
  ArrowLeft, MessageCircle, Phone, Info, UserPlus, Pencil, IdCard, Cake, History, Mail,
  Eye, EyeOff, Link2, Copy, PlayCircle, GitCompare, Lock, MessageSquarePlus, Layers, RotateCcw
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { useSetElizaScreenContext } from '../context/ElizaAssistantContext';
import { logStatusEvent } from '../services/statusEvents';
import { PROCEDURE_CATEGORY_OPTIONS, type ProcedureCategory } from '../../lib/procedureTaxonomy';
import { secureGetDoc, secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, doc as fsDoc, getDoc, setDoc, updateDoc, arrayUnion, addDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import NextContractsPanel from './NextContracts';
import NextPrescriptionsPanel from './NextPrescriptions';
import AcademyPlanningCanvas from './AcademyPlanningCanvas';
import ClinicalFichaPanel, { type WorkspacePoint, type PointRecord } from './ClinicalFichaPanel';
import DoseColorLegend from './DoseColorLegend';
import NextPlanningAI from './NextPlanningAI';
import { getTemplateForId, type ClinicalField } from '../../lib/planningTemplates';
import { DEFAULT_DOSE_COLOR_PREFS, colorForDose, prefillPointRecord, type ToxinaWorkspacePrefs } from '../../lib/doseColorPrefs';
import { useClinicalProviders } from '../hooks/useClinicalProviders';
import NextQuotationItemPicker from './NextQuotationItemPicker';
import type { TreatmentCatalogItem } from '../hooks/useTreatmentCatalog';

const PAYMENT_METHOD_OPTIONS = ['Dinheiro', 'PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência'];

interface Patient {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status?: string;
  cpf?: string;
  birthDate?: string;
  address?: string;
  /** Enviada pelo próprio paciente via Portal (POST /api/patient-portal/profile-photo) — base64, mesmo padrão de PatientImage.url. */
  photoUrl?: string;
}

interface Evolution {
  id?: string;
  text: string;
  date: any;
  professional?: string;
  updatedAt?: string;
  voided?: boolean;
  voidedAt?: string;
  patientVisible?: boolean;
  /** Set only for entries auto-created by Planejamento IA when a plan/version is saved, or by a confirmed Execução — lets the timeline show a thumbnail + "Ver planejamento"/executionId instead of plain text. `executionId` is a reference only — the execution's own data is never duplicated into the evolution. */
  clinicalPlanRef?: { planningId: string; versionId: string; procedureName?: string; thumbnailBase64?: string; executionId?: string } | null;
  /** Set only for entries auto-created by confirming a loose quotation item as done (handleConfirmQuotationItemExecution) — the parallel, simpler path for items that never go through a structured Planejamento→Execução. Never coexists with clinicalPlanRef on the same entry. */
  quotationRef?: { quotationId: string; itemIndex: number; description: string } | null;
  /** Sugestão bruta da IA, gerada logo após confirmar a realização — nunca mostrada ao paciente diretamente, só serve de ponto de partida pro profissional editar. */
  postOpDraft?: string;
  /** Texto final de pós-operatório, aprovado/editado pelo profissional — ainda NÃO visível ao paciente até postOpReleasedToPortal virar true (ação separada e deliberada). */
  postOpInstructions?: string;
  postOpReleasedToPortal?: boolean;
}

interface Treatment {
  id: string;
  description: string;
  professional?: string;
  status?: string;
  evolutions?: Evolution[];
}

interface AiPreConsultSummary {
  summary: string;
  alerts: { type: 'danger' | 'warning' | 'info'; title: string; description: string }[];
  suggestedFocus: string[];
  generatedAt?: string;
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
  chiefComplaint?: string;
  proceduresOfInterest?: string;
  submittedByPatient?: boolean;
  submittedAt?: any;
  aiPreConsultSummary?: AiPreConsultSummary;
}

interface QuotationItem {
  description: string;
  value: number;
  quantity: number;
  status?: string;
  /** Central taxonomy (src/lib/procedureTaxonomy.ts) — optional, set going forward only, never backfilled. */
  procedureCategory?: ProcedureCategory | null;
  /** Real member uid responsible for this item — null only while the author has no isClinicalProvider and hasn't picked anyone yet (blocks save, see handleSaveQuotation). Absent on quotations saved before this field existed. */
  professionalUid?: string | null;
  /** Denormalized at selection time, display-only — avoids a re-fetch per item. */
  professionalName?: string | null;
  /** Set on approval (handleUpdateQuotationStatus) — absent/'pending' on items whose quotation was approved before this field existed, treated as 'pending' on read, never backfilled. */
  executionStatus?: 'pending' | 'confirmed';
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  confirmedByName?: string | null;
  /** Quem de fato realizou o procedimento, escolhido na hora da confirmação — pode divergir de professionalUid (o padrão do orçamento). Base pra Fase de Comissões (evolução confirmada + pagamento). */
  executedByUid?: string | null;
  executedByName?: string | null;
}

interface Quotation {
  id: string;
  title: string;
  items: QuotationItem[];
  status: 'draft' | 'approved' | 'rejected';
  totalValue: number;
  createdAt?: any;
  /** Set only from the moment this field was introduced — absent on older quotations, never backfilled. */
  approvedAt?: any;
  rejectedAt?: any;
  notes?: string;
  /** Present only when this quotation was generated from a Planejamento IA plan ("Gerar orçamento a partir deste planejamento") — never set by the plain "Novo orçamento" flow. */
  clinicalPlanRef?: { planningId: string; versionId: string; procedureId: string } | null;
  /** Optional — payment/installments are decided here OR later in Financeiro, never required at quotation time. */
  paymentMethod?: string | null;
  installments?: number | null;
}

interface PatientImage {
  id: string;
  title: string;
  url: string;
  category: string;
  description?: string;
  date?: any;
  patientVisible?: boolean;
}

interface FinancialEntry {
  id: string;
  description: string;
  amount: number;
  paidAmount?: number;
  pendingAmount?: number;
  status: string;
  paymentMethod?: string;
  date?: any;
  installmentIndex?: number;
  installmentTotal?: number;
  groupId?: string;
  /** Denormalized from the quotation item that originated this entry (createFinancialEntriesForApprovedQuotation) — prepares the ground for Fase C ("quem recebeu") without a later migration. */
  professionalUid?: string | null;
  professionalName?: string | null;
  quotationRef?: { quotationId: string; itemIndex: number } | null;
  /** Fase C — sempre a pessoa logada no momento da confirmação, nunca escolhível. Ausente em lançamentos recebidos antes desta fase. */
  receivedBy?: string | null;
  receivedByName?: string | null;
  /** Snapshot congelado dos lançamentos originais absorvidos por uma ação de pagamento/parcelamento agrupado (Financeiro) — só existe em lançamentos nascidos assim; alimenta o botão "Ver relação". */
  relatedEntries?: { id: string; description: string; amount: number }[];
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
  /** Present only when this appointment was scheduled from a Planejamento IA plan ("Agendar procedimento planejado"). */
  procedureId?: string | null;
  clinicalPlanRef?: { planningId: string; versionId: string; procedureId: string } | null;
}

interface ClinicalExecutionAddendum {
  id: string;
  text: string;
  createdBy: string;
  createdByName: string;
  createdAt: any;
}

/**
 * Planejamento → Execução. Lives at
 * clinics/{clinicId}/patients/{patientId}/clinical_plans/{planningId}/executions/{executionId}
 * — a sibling of `versions`, never a value written back onto the plan/version
 * itself. `plannedSnapshot` is frozen at the moment the execution is opened
 * so a later plan edit never retroactively changes what this execution is
 * compared against. Once `status` is 'confirmed', firestore.rules blocks any
 * further update/delete on this doc — corrections only via `addenda`.
 */
interface ClinicalExecutionData {
  id: string;
  planningId: string;
  versionId: string;
  procedureId: string;
  procedureName: string;
  /** Resolved once from the Catálogo Clínico at creation time and frozen here — same self-describing principle as `procedure_catalog.templateId` (see planningTemplates.ts), so reopening an execution never needs a second catalog lookup. */
  templateId: string;
  patientId: string;
  appointmentId?: string | null;
  status: 'draft' | 'confirmed';
  startedBy: string;
  startedByName: string;
  startedAt: any;
  confirmedBy?: string | null;
  confirmedByName?: string | null;
  confirmedAt?: any;
  usedPlanAsBase: boolean;
  plannedSnapshot: {
    versionNumber: number;
    procedureName: string;
    objective: string;
    clinicalEvaluation: string;
    structuredFields: Record<string, string | boolean>;
    // Present when the plan itself was made with the Clinical Learning
    // Workspace (2026-08-29) — carried forward so "Usar planejamento como
    // base" can restore the planned points' data, not just their positions.
    pointRecords?: Record<string, { muscle: string; unidades: string; observacao: string }> | null;
    strokesJson: string | null;
    images: { imageId: string; documentType: string }[];
  };
  executionFields: Record<string, string | boolean>;
  // Clinical Learning Workspace (2026-08-29) — same shape/key (stroke id) as
  // StudentAttempt.pointRecords in Academy. Optional/absent for executions of
  // a template without `clinicalWorkspace` (e.g. Implante Unitário) and for
  // any execution doc written before this field existed.
  pointRecords?: Record<string, { muscle: string; unidades: string; observacao: string }> | null;
  strokesJson: string | null;
  overlayThumbnailBase64?: string | null;
  // Foto real enviada DURANTE a execução (2026-08-31), quando o planejamento
  // não tinha foto ainda — nunca sobrescreve `plannedSnapshot.images` (que
  // fica congelado, é o que foi planejado); só passa a valer como imagem do
  // canvas de aplicação a partir de agora.
  execImageId?: string | null;
  observations?: string;
  complications?: string;
  createdAt?: any;
  updatedAt?: any;
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

type RecordTab = 'resumo' | 'evolucao' | 'planejamento' | 'execucao' | 'ia_clinica' | 'orcamento' | 'contratos' | 'receituarios' | 'imagens' | 'financeiro';

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

interface PlannedVsRealizedItem { key: string; label: string; plannedValue?: string | boolean; executedValue?: string | boolean; }
interface PlannedVsRealizedResult {
  matched: PlannedVsRealizedItem[];
  changed: PlannedVsRealizedItem[];
  plannedOnly: PlannedVsRealizedItem[];
  executionOnly: PlannedVsRealizedItem[];
}

// Objective, key-level comparison only — never infers a reason for a
// difference (that only ever comes from the professional's own observations
// or an addendum). A field only lands in `matched`/`changed` when the SAME
// key is declared in both `template.clinicalFields` and
// `template.executionFields` — for a template like Toxina, where planning and
// execution collect genuinely different data, that's honestly empty, and the
// UI says so instead of pretending a correspondence exists.
function computePlannedVsRealized(
  clinicalFields: ClinicalField[],
  executionFieldDefs: ClinicalField[],
  plannedStructuredFields: Record<string, string | boolean>,
  executedFields: Record<string, string | boolean>
): PlannedVsRealizedResult {
  const result: PlannedVsRealizedResult = { matched: [], changed: [], plannedOnly: [], executionOnly: [] };
  const executionKeys = new Set(executionFieldDefs.map(f => f.key));
  const clinicalKeys = new Set(clinicalFields.map(f => f.key));

  for (const field of clinicalFields) {
    const plannedValue = plannedStructuredFields[field.key];
    if (plannedValue === undefined || plannedValue === '') continue;
    const executedValue = executedFields[field.key];
    const hasExecuted = executionKeys.has(field.key) && executedValue !== undefined && executedValue !== '';
    if (!hasExecuted) {
      result.plannedOnly.push({ key: field.key, label: field.label, plannedValue });
    } else if (executedValue === plannedValue) {
      result.matched.push({ key: field.key, label: field.label, plannedValue, executedValue });
    } else {
      result.changed.push({ key: field.key, label: field.label, plannedValue, executedValue });
    }
  }
  for (const field of executionFieldDefs) {
    const executedValue = executedFields[field.key];
    if (executedValue === undefined || executedValue === '') continue;
    if (!clinicalKeys.has(field.key)) {
      result.executionOnly.push({ key: field.key, label: field.label, executedValue });
    }
  }
  return result;
}

interface NextMedicalRecordProps {
  prefillPatientId?: string | null;
  onPrefillConsumed?: () => void;
  onScheduleForPatient?: (patientName: string) => void;
  /** "Gerar orçamento a partir deste planejamento" handoff from Planejamento IA — arrives alongside prefillPatientId, consumed separately since it carries its own draft data. */
  prefillQuotationDraft?: { title: string; items: QuotationItem[]; notes?: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string } } | null;
  onQuotationDraftConsumed?: () => void;
  /** "Agendar procedimento planejado" from the embedded Planejamento tab (below) — same payload/handling as the standalone Planejamento IA screen's onSchedulePlanned, just forwarded from inside the Prontuário instead of ElizaNextLayout's own tab switch. */
  onSchedulePlanned?: (payload: { patientName: string; treatment: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string } }) => void;
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

// Mapeia a categoria/subcategoria do catálogo de tratamentos (treatment_catalog,
// texto livre por clínica) pra a taxonomia central fechada (procedureTaxonomy.ts)
// — evita que escolher um item do catálogo deixe a "Categoria clínica" vazia,
// pedindo pra escolher de novo manualmente (ex: "Toxina Botulínica" já vem
// como estetica_facial). Subcategoria tem prioridade por ser mais específica;
// cai pra categoria geral quando a subcategoria não bate com nada conhecido.
const CATALOG_SUBCATEGORY_TO_TAXONOMY: Record<string, ProcedureCategory> = {
  'Toxina': 'estetica_facial', 'Ácido Hialurônico': 'estetica_facial', 'Bioestimulador': 'estetica_facial',
  'Fios': 'estetica_facial', 'Lipo Enzimática': 'estetica_facial', 'Avaliação': 'avaliacao',
  'Dentística': 'dentistica_restauradora', 'Endodontia': 'endodontia', 'Cirurgia Oral': 'cirurgia_oral',
  'Periodontia': 'periodontia', 'Implante': 'implantodontia', 'Prótese': 'protese', 'Cirurgia Reconstrutiva': 'implantodontia',
};
const CATALOG_CATEGORY_TO_TAXONOMY: Record<string, ProcedureCategory> = {
  'Harmonização Facial': 'estetica_facial', 'Procedimentos Odontológicos': 'dentistica_restauradora',
  'Cirurgias': 'cirurgia_oral', 'Implantes e Próteses': 'implantodontia',
  'Avaliações e Consultas': 'avaliacao', 'Outros': 'outro',
};
function mapCatalogCategoryToProcedureCategory(category: string, subcategory?: string): ProcedureCategory | null {
  if (subcategory && CATALOG_SUBCATEGORY_TO_TAXONOMY[subcategory]) return CATALOG_SUBCATEGORY_TO_TAXONOMY[subcategory];
  return CATALOG_CATEGORY_TO_TAXONOMY[category] || null;
}

// Firestore has no partial array-element update — rewriting the whole
// `items` array is the only way to patch one item by index.
async function patchQuotationItem(
  clinicId: string,
  patientId: string,
  quotation: Quotation,
  index: number,
  patch: Partial<QuotationItem>
): Promise<QuotationItem[]> {
  const nextItems = quotation.items.map((it, i) => (i === index ? { ...it, ...patch } : it));
  await updateDoc(fsDoc(db, 'clinics', clinicId, 'patients', patientId, 'quotations', quotation.id), { items: nextItems });
  return nextItems;
}

// Fase B: aprovar um orçamento já cobra o paciente, independente de quando
// (ou se) o procedimento é confirmado como realizado — 1 lançamento por
// item, nunca 1 lançamento único somando tudo (cada item já carrega seu
// próprio profissional desde a Fase A). ID determinístico + getDoc antes de
// setDoc garante idempotência: reaprovar (após reverter p/ rascunho) nunca
// duplica, e nunca sobrescreve um lançamento que o financeiro já tenha
// editado/marcado como pago.
async function createFinancialEntriesForApprovedQuotation(
  clinicId: string,
  patientId: string,
  quotation: Quotation,
  patientName: string | undefined,
  uid: string | null | undefined
): Promise<FinancialEntry[]> {
  const today = new Date().toISOString();
  const created: FinancialEntry[] = [];
  for (let index = 0; index < quotation.items.length; index++) {
    const item = quotation.items[index];
    const entryRef = fsDoc(db, 'clinics', clinicId, 'financial_entries', `q-${quotation.id}-item-${index}`);
    const existing = await getDoc(entryRef);
    if (existing.exists()) continue;
    const amount = (Number(item.value) || 0) * (Number(item.quantity) || 1);
    const payload: Record<string, any> = {
      patientId,
      patientName: patientName || '',
      description: item.description,
      type: 'income',
      category: 'Orçamento/Tratamento',
      amount,
      paidAmount: 0,
      pendingAmount: amount,
      status: 'pending',
      date: today,
      createdAt: serverTimestamp(),
      createdBy: uid || 'eliza_next_sandbox',
      professionalUid: item.professionalUid ?? null,
      professionalName: item.professionalName ?? null,
      quotationRef: { quotationId: quotation.id, itemIndex: index },
    };
    if (quotation.paymentMethod) payload.paymentMethod = quotation.paymentMethod;
    await setDoc(entryRef, payload);
    // Sem serverTimestamp resolvido ainda no cliente — só pra já aparecer na
    // tela imediatamente; um reload traz o valor real, igual a qualquer outro
    // uso de serverTimestamp() neste arquivo.
    created.push({ id: entryRef.id, ...payload } as unknown as FinancialEntry);
  }
  return created;
}

// Ao editar um orçamento JÁ APROVADO, um item que mudou de valor precisa
// refletir no lançamento financeiro que a aprovação já criou — mas só se
// esse lançamento ainda não recebeu nada (paidAmount>0 significa que a UI
// já travou a edição desse item, ver isItemLocked no componente; aqui é só
// a defesa final, nunca sobrescreve um lançamento com dinheiro já registrado).
async function syncFinancialEntriesForEditedItems(
  clinicId: string,
  quotationId: string,
  items: QuotationItem[],
  financialEntries: FinancialEntry[]
): Promise<void> {
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const entry = financialEntries.find(f => f.id === `q-${quotationId}-item-${index}`);
    if (!entry) continue;
    if ((entry.paidAmount ?? 0) > 0) continue;
    const newAmount = (Number(item.value) || 0) * (Number(item.quantity) || 1);
    if (newAmount === entry.amount) continue;
    await updateDoc(fsDoc(db, 'clinics', clinicId, 'financial_entries', entry.id), {
      amount: newAmount,
      pendingAmount: newAmount,
    });
  }
}

export default function NextMedicalRecord({ prefillPatientId, onPrefillConsumed, onScheduleForPatient, prefillQuotationDraft, onQuotationDraftConsumed, onSchedulePlanned }: NextMedicalRecordProps = {}) {
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
  // "Ver planejamento" (Evolução/Orçamento/Execução) abre a própria aba
  // Planejamento embutida no Prontuário em vez de trocar pra tela standalone
  // — o usuário não deve sair do paciente que está com o prontuário aberto.
  const [prefillPlanningIdForTab, setPrefillPlanningIdForTab] = useState<string | null>(null);
  const openPlanningInline = (planningId: string) => {
    setPrefillPlanningIdForTab(planningId);
    setActiveTab('planejamento');
  };

  const [anamnesis, setAnamnesis] = useState<AnamnesisData | null>(null);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [shareImageTarget, setShareImageTarget] = useState<PatientImage | null>(null);
  const [shareImageForm, setShareImageForm] = useState({ title: '', description: '' });
  const [savingShareImage, setSavingShareImage] = useState(false);
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

  // Portal do Paciente — link generation
  const [isPortalLinkModalOpen, setIsPortalLinkModalOpen] = useState(false);
  const [generatingPortalLink, setGeneratingPortalLink] = useState(false);
  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [portalLinkError, setPortalLinkError] = useState<string | null>(null);
  const [portalLinkCopied, setPortalLinkCopied] = useState(false);

  // Orçamento (quotation) state
  const [isQuotationFormOpen, setIsQuotationFormOpen] = useState(false);
  const [quotationTitle, setQuotationTitle] = useState('Plano de Tratamento');
  const [quotationItems, setQuotationItems] = useState<QuotationItem[]>([]);
  const [quotationNotes, setQuotationNotes] = useState('');
  const [pendingClinicalPlanRef, setPendingClinicalPlanRef] = useState<{ planningId: string; versionId: string; procedureId: string } | null>(null);
  const [savingQuotation, setSavingQuotation] = useState(false);
  const [updatingQuotationId, setUpdatingQuotationId] = useState<string | null>(null);
  const [confirmDeleteQuotationId, setConfirmDeleteQuotationId] = useState<string | null>(null);
  const [quotationPaymentMethod, setQuotationPaymentMethod] = useState('');
  const [quotationInstallments, setQuotationInstallments] = useState('');
  const [showQuotationItemPicker, setShowQuotationItemPicker] = useState(true);
  const [quotationSaveError, setQuotationSaveError] = useState<string | null>(null);
  const [confirmingItemKey, setConfirmingItemKey] = useState<string | null>(null);
  const [quotationBeingEditedId, setQuotationBeingEditedId] = useState<string | null>(null);
  const [executionOverrides, setExecutionOverrides] = useState<Record<string, string>>({});
  const [executionNotes, setExecutionNotes] = useState<Record<string, string>>({});
  // Painel de pós-operatório — abre logo após confirmar a realização de um
  // procedimento (handleConfirmQuotationItemExecution). Nunca reabre a
  // própria evolução recém-criada além de patchear os campos postOp* nela.
  const [postOpPanel, setPostOpPanel] = useState<{ treatmentId: string; evolutionId: string; procedureDescription: string } | null>(null);
  const [postOpDraftText, setPostOpDraftText] = useState('');
  const [postOpLoadingDraft, setPostOpLoadingDraft] = useState(false);
  const [postOpSaving, setPostOpSaving] = useState(false);
  const [postOpReleasing, setPostOpReleasing] = useState(false);
  const [postOpError, setPostOpError] = useState<string | null>(null);
  const { providers: clinicalProviders } = useClinicalProviders(clinic?.id);

  // Planejamento → Execução
  const [myMember, setMyMember] = useState<Record<string, any> | null>(null);
  const canExecuteClinical = isAdmin || myMember?.isClinicalProvider === true;
  const [executionsByAppointment, setExecutionsByAppointment] = useState<Record<string, ClinicalExecutionData>>({});
  const [loadingExecutions, setLoadingExecutions] = useState(false);
  const [startingExecutionApptId, setStartingExecutionApptId] = useState<string | null>(null);
  const [openExecution, setOpenExecution] = useState<ClinicalExecutionData | null>(null);
  const [openExecutionAppointment, setOpenExecutionAppointment] = useState<AppointmentLite | null>(null);
  const [execFieldsForm, setExecFieldsForm] = useState<Record<string, string | boolean>>({});
  const [execObservations, setExecObservations] = useState('');
  const [execComplications, setExecComplications] = useState('');
  const [execStrokesJson, setExecStrokesJson] = useState<string | null>(null);
  const [execOverlayThumbnail, setExecOverlayThumbnail] = useState<string | null>(null);
  const [execUsedPlanAsBase, setExecUsedPlanAsBase] = useState(false);
  const [showExecutionCanvas, setShowExecutionCanvas] = useState(false);
  // Clinical Learning Workspace, real-patient phase (2026-08-29) — same
  // point↔ficha mirroring pattern as Academy's NextStudentPortal.tsx, just
  // fed by the execution's real clinical photo instead of a generic
  // anatomical asset. Only populated/rendered when the template declares
  // `clinicalWorkspace`; other templates keep the plain field-list UI as-is.
  const [execWorkspacePoints, setExecWorkspacePoints] = useState<WorkspacePoint[]>([]);
  const [execPointRecords, setExecPointRecords] = useState<Record<string, PointRecord>>({});
  const [execSelectedPointId, setExecSelectedPointId] = useState<string | null>(null);
  const [execDeleteRequestedPointId, setExecDeleteRequestedPointId] = useState<string | null>(null);
  // Cor-por-dose + zonas de músculo + fallback de imagem de referência
  // (2026-08-30) — mesma preferência de clínica usada em Planejamento IA
  // (ver doseColorPrefs.ts), carregada uma vez e reaproveitada aqui.
  const [execWorkspacePrefs, setExecWorkspacePrefs] = useState<ToxinaWorkspacePrefs>(DEFAULT_DOSE_COLOR_PREFS);
  const [execReferenceImageIsAlt, setExecReferenceImageIsAlt] = useState(false);
  useEffect(() => {
    if (!clinic?.id) return;
    (async () => {
      try {
        const snap = await getDoc(fsDoc(db, 'clinics', clinic.id, 'settings', 'toxinaWorkspacePrefs'));
        if (snap.exists()) {
          const data = snap.data() as Partial<ToxinaWorkspacePrefs>;
          setExecWorkspacePrefs({
            colorRules: data.colorRules || DEFAULT_DOSE_COLOR_PREFS.colorRules,
            muscleDefaults: data.muscleDefaults || DEFAULT_DOSE_COLOR_PREFS.muscleDefaults,
          });
        }
      } catch (e) { console.error('Failed to load toxinaWorkspacePrefs:', e); }
    })();
  }, [clinic?.id]);
  const handleExecColorRulesChange = async (colorRules: ToxinaWorkspacePrefs['colorRules']) => {
    setExecWorkspacePrefs((v) => ({ ...v, colorRules }));
    if (!clinic?.id) return;
    try {
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'settings', 'toxinaWorkspacePrefs'), { colorRules }, { merge: true });
    } catch (e) { console.error('Failed to save toxinaWorkspacePrefs:', e); }
  };
  const execPointColorFor = (pointId: string) => colorForDose(execPointRecords[pointId]?.unidades, execWorkspacePrefs.colorRules);
  const [savingExecutionDraft, setSavingExecutionDraft] = useState(false);
  const [confirmingExecution, setConfirmingExecution] = useState(false);
  const [executionAddenda, setExecutionAddenda] = useState<ClinicalExecutionAddendum[]>([]);
  const [loadingAddenda, setLoadingAddenda] = useState(false);
  const [addendumText, setAddendumText] = useState('');
  const [savingAddendum, setSavingAddendum] = useState(false);

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
  const [financialForm, setFinancialForm] = useState({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX', installments: '1', installmentIntervalDays: '30' });
  const [savingFinancial, setSavingFinancial] = useState(false);
  const [editingFinancialId, setEditingFinancialId] = useState<string | null>(null);
  const [financialEditForm, setFinancialEditForm] = useState({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX', date: '' });
  const [savingFinancialEdit, setSavingFinancialEdit] = useState(false);
  const [confirmDeleteFinancialId, setConfirmDeleteFinancialId] = useState<string | null>(null);
  const [processingFinancialId, setProcessingFinancialId] = useState<string | null>(null);
  const [receivingFinancialId, setReceivingFinancialId] = useState<string | null>(null);
  const [receiveAmountInput, setReceiveAmountInput] = useState('');
  const [confirmCancelReceiptId, setConfirmCancelReceiptId] = useState<string | null>(null);
  // Pagamento/parcelamento agrupado de vários lançamentos pendentes de uma vez.
  const [selectedFinancialIds, setSelectedFinancialIds] = useState<Set<string>>(new Set());
  const [groupActionMode, setGroupActionMode] = useState<'receive' | 'installments' | null>(null);
  const [groupReceiveAmountInput, setGroupReceiveAmountInput] = useState('');
  const [groupInstallmentCount, setGroupInstallmentCount] = useState('2');
  const [groupInstallmentIntervalDays, setGroupInstallmentIntervalDays] = useState('30');
  const [savingGroupAction, setSavingGroupAction] = useState(false);
  const [expandedRelatedId, setExpandedRelatedId] = useState<string | null>(null);

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
        const apptsRef = collection(db, 'clinics', clinic.id, 'appointments');
        // Paralelo em vez de sequencial — numa rede/PC mais fraco (ex.
        // recepção), isto sozinho corta o tempo de abertura do diretório
        // quase pela metade (era ida-e-volta de pacientes, DEPOIS de
        // agendamentos; agora as duas rodam ao mesmo tempo).
        const [snap, apptSnap] = await Promise.all([
          secureGetDocs(query(patientsRef, limit(8000)), 'patients', { addAuditLog }),
          secureGetDocs(query(apptsRef, limit(3000)), 'appointments', { addAuditLog }),
        ]);
        setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Patient)));
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

  // "Gerar orçamento a partir deste planejamento" handoff from Planejamento
  // IA — arrives in the same navigation as prefillPatientId above (same
  // commit, so the patient is already being selected) but is consumed by
  // its own callback since it carries its own draft payload, not just an id.
  useEffect(() => {
    if (prefillQuotationDraft) {
      setQuotationTitle(prefillQuotationDraft.title);
      setQuotationItems(prefillQuotationDraft.items.length > 0 ? [...prefillQuotationDraft.items] : [{ description: '', value: 0, quantity: 1 }]);
      setQuotationNotes(prefillQuotationDraft.notes || '');
      setPendingClinicalPlanRef(prefillQuotationDraft.clinicalPlanRef);
      setIsQuotationFormOpen(true);
      setActiveTab('orcamento');
      onQuotationDraftConsumed?.();
    }
  }, [prefillQuotationDraft]);

  // Mesma lógica do effect acima, só que disparada de dentro da própria
  // aba "Planejamento" (2026-08-30) — não precisa ir e voltar por uma prop
  // externa porque já estamos no mesmo componente/paciente.
  const handlePlanningGenerateQuotation = (payload: { patientId: string; title: string; items: QuotationItem[]; notes?: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string } }) => {
    setQuotationTitle(payload.title);
    const withDefaults = payload.items.map(it => it.professionalUid ? it : { ...it, ...defaultQuotationProfessional() });
    setQuotationItems(withDefaults.length > 0 ? withDefaults : [{ description: '', value: 0, quantity: 1, ...defaultQuotationProfessional() }]);
    setQuotationNotes(payload.notes || '');
    setPendingClinicalPlanRef(payload.clinicalPlanRef);
    setIsQuotationFormOpen(true);
    setActiveTab('orcamento');
  };

  // Own membership doc — drives `canExecuteClinical` above. Mirrors the exact
  // same fetch already used in ElizaNextLayout.tsx for nav gating.
  useEffect(() => {
    async function fetchMyMembership() {
      if (!clinic?.id || !user?.uid) { setMyMember(null); return; }
      try {
        const snap = await secureGetDoc(fsDoc(db, 'clinics', clinic.id, 'members', user.uid), { addAuditLog });
        setMyMember(snap.exists() ? (snap.data() as any) : null);
      } catch {
        setMyMember(null);
      }
    }
    fetchMyMembership();
  }, [clinic?.id, user?.uid]);

  useEffect(() => {
    async function fetchRecord() {
      if (!clinic?.id || !selectedPatientId) {
        setAnamnesis(null); setTreatments([]); setQuotations([]); setImages([]); setFinancialEntries([]); setSavedDiagnoses([]);
        setExecutionsByAppointment({}); setOpenExecution(null); setOpenExecutionAppointment(null); setExecutionAddenda([]);
        return;
      }
      setLoadingRecord(true);
      setExecutionsByAppointment({}); setOpenExecution(null); setOpenExecutionAppointment(null); setExecutionAddenda([]);
      // `images` (e a trava de "já busquei" do efeito de lazy-load abaixo)
      // resetam aqui — nunca mostrar foto do paciente anterior enquanto a
      // busca sob demanda do novo paciente ainda não rodou.
      setImages([]);
      imagesLoadedForPatientRef.current = null;
      setSelectedFinancialIds(new Set());
      setGroupActionMode(null);
      // Reset the IA Clínica working session when switching patients — an
      // in-progress analysis for patient A should never leak into patient B.
      setIaSpecialties([]); setIaCaseDescription(''); setIaExamFiles([]); setIaDiagnosis(null); setIaError(null); setIaChatMessages([]); setIaChatInput('');
      try {
        const patientRoot = ['clinics', clinic.id, 'patients', selectedPatientId] as const;
        const finRef = collection(db, 'clinics', clinic.id, 'financial_entries');

        // Paralelo em vez de 5 idas-e-voltas sequenciais — cada `await` em
        // série soma sua própria latência de rede; num PC/rede mais fraco
        // (ex. recepção) isso é o que fazia abrir um prontuário "demorar
        // bastante". `images` fica de fora de propósito: cada doc guarda a
        // foto em base64 (até ~800KB cada, até 60 por paciente) — só é
        // buscado sob demanda (ver efeito abaixo), nunca ao só abrir o
        // prontuário.
        const [anamnesisSnap, treatmentsSnap, quotationsSnap, finSnap, aiPlansSnap] = await Promise.all([
          secureGetDoc<AnamnesisData>(fsDoc(db, ...patientRoot, 'anamnesis', 'current'), { addAuditLog }),
          secureGetDocs<Treatment>(query(collection(db, ...patientRoot, 'treatments'), limit(50)), 'treatments', { addAuditLog }),
          secureGetDocs<Quotation>(query(collection(db, ...patientRoot, 'quotations'), limit(50)), 'quotations', { addAuditLog }),
          secureGetDocs<FinancialEntry>(query(finRef, where('patientId', '==', selectedPatientId), limit(100)), 'financial_entries', { addAuditLog }),
          secureGetDocs<AiDiagnosis>(query(collection(db, ...patientRoot, 'ai_treatment_plans'), limit(20)), 'ai_treatment_plans', { addAuditLog }),
        ]);

        const data = anamnesisSnap.exists() ? anamnesisSnap.data() : null;
        setAnamnesis(data);
        setAnamnesisForm(data || {});
        setTreatments(treatmentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Treatment)));
        setQuotations(quotationsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Quotation)));
        setFinancialEntries(finSnap.docs.map(d => ({ id: d.id, ...d.data() } as FinancialEntry)));
        setSavedDiagnoses(aiPlansSnap.docs.map(d => ({ id: d.id, ...d.data() } as AiDiagnosis)));
      } catch (err) {
        console.warn('Failed to load real medical record in sandbox:', err);
      } finally {
        setLoadingRecord(false);
      }
    }
    fetchRecord();
  }, [clinic?.id, selectedPatientId]);

  // `images` guarda foto em base64 dentro do próprio doc (até ~800KB cada) —
  // buscar isso toda vez que um prontuário abre é o maior custo de rede do
  // Prontuário Vivo, mesmo quando ninguém vai olhar uma foto. Só carrega de
  // verdade quando a aba Imagens é aberta, ou a aba Execução (que referencia
  // uma foto do planejamento/execução via `openExecutionCanvasImage` acima) —
  // e só uma vez por paciente, não a cada troca de aba.
  const imagesLoadedForPatientRef = useRef<string | null>(null);
  useEffect(() => {
    if (!clinic?.id || !selectedPatientId) return;
    if (activeTab !== 'imagens' && activeTab !== 'execucao') return;
    if (imagesLoadedForPatientRef.current === selectedPatientId) return;
    imagesLoadedForPatientRef.current = selectedPatientId;
    (async () => {
      try {
        const imagesSnap = await secureGetDocs<PatientImage>(
          query(collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images'), limit(60)),
          'images',
          { addAuditLog }
        );
        setImages(imagesSnap.docs.map(d => ({ id: d.id, ...d.data() } as PatientImage)));
      } catch (err) {
        console.warn('Failed to load patient images:', err);
        imagesLoadedForPatientRef.current = null;
      }
    })();
  }, [clinic?.id, selectedPatientId, activeTab]);

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

  // Índice por paciente, construído uma vez por mudança em `appointments` —
  // a versão anterior fazia esse filter+sort de novo, do zero, pra CADA
  // card de paciente visível a CADA render (centenas de pacientes × milhares
  // de agendamentos), o maior custo de CPU do Prontuário Vivo num PC fraco.
  const nextAppointmentByPatient = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const map = new Map<string, AppointmentLite>();
    for (const a of appointments) {
      if ((a.date || '') < todayStr) continue;
      const key = `${a.date}T${a.time || '00:00'}`;
      for (const patientKey of [a.patientId, a.patientName]) {
        if (!patientKey) continue;
        const current = map.get(patientKey);
        const currentKey = current ? `${current.date}T${current.time || '00:00'}` : null;
        if (!current || key < currentKey!) map.set(patientKey, a);
      }
    }
    return map;
  }, [appointments]);

  const getNextAppointment = (patientId: string, patientName: string) => {
    return nextAppointmentByPatient.get(patientId) || nextAppointmentByPatient.get(patientName) || null;
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
    const items: { treatmentId: string; treatmentDesc: string; text: string; date: any; id?: string; professional?: string; voided?: boolean; voidedAt?: string; updatedAt?: string; patientVisible?: boolean; clinicalPlanRef?: Evolution['clinicalPlanRef']; quotationRef?: Evolution['quotationRef'] }[] = [];
    treatments.forEach(t => {
      (t.evolutions || []).forEach(ev => items.push({
        treatmentId: t.id, treatmentDesc: t.description || 'Prontuário Clínico Geral', text: ev.text, date: ev.date,
        id: ev.id, professional: ev.professional, voided: ev.voided, voidedAt: ev.voidedAt, updatedAt: ev.updatedAt,
        patientVisible: ev.patientVisible, clinicalPlanRef: ev.clinicalPlanRef, quotationRef: ev.quotationRef,
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

  useSetElizaScreenContext(
    'Prontuário',
    viewMode === 'list'
      ? (patients.length === 0 ? '' : `Lista de pacientes: ${filteredPatients.length} de ${patients.length} exibido(s) (filtro de status: ${statusFilter}${listSearchTerm ? `, busca: "${listSearchTerm}"` : ''}).`)
      : (!selectedPatient ? '' : [
          `Prontuário aberto: ${selectedPatient.name} (status: ${selectedPatient.status || 'active'}).`,
          `Tratamentos registrados: ${treatments.length}. Evoluções no histórico: ${timeline.length}.`,
          `Orçamentos: ${quotations.length} (${quotations.filter(q => q.status === 'approved').length} aprovado(s), ${quotations.filter(q => q.status === 'draft').length} rascunho).`,
          financialEntries.length > 0 ? `Lançamentos financeiros deste paciente: ${financialEntries.length}, pendente total R$ ${financialEntries.reduce((s, e) => s + (e.pendingAmount || 0), 0).toFixed(2)}.` : '',
          clinicalAlerts.length > 0 ? `Alertas clínicos ativos: ${clinicalAlerts.map((a: any) => a.title).join('; ')}.` : '',
          patientAppointmentHistory.length > 0 ? `Próximo/último agendamento: ${patientAppointmentHistory[0].date} ${patientAppointmentHistory[0].time || ''}.` : '',
        ].filter(Boolean).join('\n')),
    viewMode === 'record' ? (selectedPatient?.id || null) : null
  );

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

  // Portal do Paciente only ever shows evolutions/photos explicitly marked
  // patientVisible — everything else (internal notes, staff recados, ELIZA
  // outputs) stays invisible to the patient by default.
  const toggleEvolutionVisibility = async (treatmentId: string, evolutionId?: string) => {
    if (!clinic?.id || !selectedPatientId || !evolutionId) return;
    const treatment = treatments.find(t => t.id === treatmentId);
    if (!treatment) return;
    const newEvolutions = (treatment.evolutions || []).map(ev => ev.id === evolutionId ? { ...ev, patientVisible: !ev.patientVisible } : ev);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'treatments', treatmentId), { evolutions: newEvolutions });
      setTreatments(prev => prev.map(t => t.id === treatmentId ? { ...t, evolutions: newEvolutions } : t));
      addAuditLog({ collection: 'treatments', action: 'WRITE', status: 'SUCCESS', details: `Visibilidade da evolução alterada no Portal do Paciente (escrita real).` });
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    }
  };

  // -------------------------------------------------------------------
  // Planejamento → Execução
  // -------------------------------------------------------------------

  const patientLinkedAppointments = useMemo(
    () => patientAppointmentHistory.filter(a => a.clinicalPlanRef?.planningId && a.clinicalPlanRef?.versionId),
    [patientAppointmentHistory]
  );

  const openExecutionTemplate = useMemo(
    () => (openExecution ? getTemplateForId(openExecution.templateId) : null),
    [openExecution?.templateId]
  );

  const openExecutionCanvasImage = useMemo(() => {
    // Foto enviada durante a própria execução tem prioridade sobre a do
    // planejamento (que pode nem existir) — ver `execImageId` acima.
    const execImgId = openExecution?.execImageId;
    if (execImgId) {
      const found = images.find(img => img.id === execImgId);
      if (found) return found;
    }
    const imageRef = openExecution?.plannedSnapshot.images?.[0];
    if (!imageRef) return null;
    return images.find(img => img.id === imageRef.imageId) || null;
  }, [openExecution, images]);

  // Fallback de imagem de referência (2026-08-30): sem foto real da paciente
  // no planejamento, usa a imagem anatômica aprovada do template — nunca
  // trava o mapa de pontos por falta de foto. Só se aplica ao workspace
  // clínico (Toxina/Preenchimento); o bloco "Planejado" acima continua sem
  // imagem quando não há foto real, isso é intencional.
  const execReferenceImageUrl = openExecutionTemplate?.clinicalWorkspace
    ? (execReferenceImageIsAlt
        ? openExecutionTemplate.clinicalWorkspace.anatomicalAssetUrlAlt || openExecutionTemplate.clinicalWorkspace.anatomicalAssetUrl
        : openExecutionTemplate.clinicalWorkspace.anatomicalAssetUrl)
    : null;
  const execUsingReferenceImage = !openExecutionCanvasImage && !!execReferenceImageUrl;
  const execEffectiveCanvasImageUrl = openExecutionCanvasImage?.url || execReferenceImageUrl || undefined;

  // Loaded once per patient when the Execução tab is opened — a pointed
  // query per linked appointment (`where('appointmentId','==',...)`), never a
  // collectionGroup, so no extra Firestore index/rule is needed.
  useEffect(() => {
    async function loadExecutions() {
      if (activeTab !== 'execucao' || !clinic?.id || !selectedPatientId || patientLinkedAppointments.length === 0) return;
      setLoadingExecutions(true);
      try {
        const map: Record<string, ClinicalExecutionData> = {};
        for (const appt of patientLinkedAppointments) {
          const ref = appt.clinicalPlanRef!;
          const executionsRef = collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'clinical_plans', ref.planningId, 'executions');
          const snap = await secureGetDocs<ClinicalExecutionData>(query(executionsRef, where('appointmentId', '==', appt.id), limit(1)), 'clinical_plans/executions', { addAuditLog });
          if (!snap.empty) {
            const d = snap.docs[0];
            map[appt.id] = { id: d.id, ...d.data() } as ClinicalExecutionData;
          }
        }
        setExecutionsByAppointment(map);
      } catch (err) {
        console.warn('Failed to load clinical executions:', err);
      } finally {
        setLoadingExecutions(false);
      }
    }
    loadExecutions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, clinic?.id, selectedPatientId, patientLinkedAppointments.length]);

  const openExecutionPanel = (exec: ClinicalExecutionData, appt: AppointmentLite) => {
    setOpenExecution(exec);
    setOpenExecutionAppointment(appt);
    setExecFieldsForm(exec.executionFields || {});
    setExecObservations(exec.observations || '');
    setExecComplications(exec.complications || '');
    setExecStrokesJson(exec.strokesJson || null);
    setExecOverlayThumbnail(exec.overlayThumbnailBase64 || null);
    setExecUsedPlanAsBase(exec.usedPlanAsBase || false);
    setShowExecutionCanvas(false);
    setExecWorkspacePoints([]);
    setExecPointRecords(exec.pointRecords || {});
    setExecSelectedPointId(null);
    setExecutionAddenda([]);
    setAddendumText('');
    if (exec.status === 'confirmed') loadExecutionAddenda(exec);
  };

  // Mirrors the canvas's live point strokes into the ficha's point table —
  // same wiring as Academy's handleWorkspacePointsChange in NextStudentPortal.tsx.
  const handleExecWorkspacePointsChange = (points: WorkspacePoint[]) => {
    setExecWorkspacePoints(points);
    setExecPointRecords((v) => {
      const next: Record<string, PointRecord> = {};
      for (const p of points) {
        if (v[p.id]) { next[p.id] = v[p.id]; continue; }
        const prefill = prefillPointRecord(p, openExecutionTemplate?.clinicalWorkspace?.muscleZones, execWorkspacePrefs.muscleDefaults);
        next[p.id] = { muscle: prefill?.muscle || '', unidades: prefill?.unidades || '', observacao: '' };
      }
      return next;
    });
  };

  const closeExecutionPanel = () => {
    setOpenExecution(null);
    setOpenExecutionAppointment(null);
    setShowExecutionCanvas(false);
  };

  const loadExecutionAddenda = async (exec: ClinicalExecutionData) => {
    if (!clinic?.id || !selectedPatientId) return;
    setLoadingAddenda(true);
    try {
      const ref = collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'clinical_plans', exec.planningId, 'executions', exec.id, 'addenda');
      const snap = await secureGetDocs<ClinicalExecutionAddendum>(query(ref, limit(50)), 'clinical_plans/executions/addenda', { addAuditLog });
      setExecutionAddenda(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClinicalExecutionAddendum)));
    } catch (err) {
      console.warn('Failed to load execution addenda:', err);
    } finally {
      setLoadingAddenda(false);
    }
  };

  const handleExecutePlanning = async (appt: AppointmentLite) => {
    if (!clinic?.id || !selectedPatientId || !appt.clinicalPlanRef || !user) return;
    const existing = executionsByAppointment[appt.id];
    if (existing) {
      openExecutionPanel(existing, appt);
      return;
    }
    if (!canExecuteClinical) {
      showMessage('Você não tem permissão clínica para iniciar uma execução — fale com o administrador da clínica.');
      return;
    }
    setStartingExecutionApptId(appt.id);
    try {
      const { planningId, versionId, procedureId } = appt.clinicalPlanRef;
      const patientRoot = ['clinics', clinic.id, 'patients', selectedPatientId] as const;
      const planRef = fsDoc(db, ...patientRoot, 'clinical_plans', planningId);
      const versionSnap = await secureGetDoc<any>(fsDoc(planRef, 'versions', versionId), { addAuditLog });
      if (!versionSnap.exists()) { showMessage('A versão do planejamento referenciada por este agendamento não foi encontrada.'); return; }
      const v = versionSnap.data();

      const catalogSnap = await secureGetDoc<any>(fsDoc(db, 'clinics', clinic.id, 'procedure_catalog', procedureId), { addAuditLog });
      const templateId: string = (catalogSnap.exists() && catalogSnap.data()?.templateId) || 'generico';
      const template = getTemplateForId(templateId);
      if (template.executionFields.length === 0 && template.executionCanvasTools.length === 0) {
        showMessage('Este procedimento ainda não tem suporte a Execução configurado — só procedimentos com template dedicado (Toxina Botulínica, Preenchimento Facial, Implante Unitário) têm isso disponível hoje.');
        return;
      }

      const professionalName = profile?.name || user.email || 'Profissional';
      const executionsRef = collection(planRef, 'executions');
      const newExecRef = fsDoc(executionsRef);
      const execData: Omit<ClinicalExecutionData, 'id'> = {
        planningId, versionId, procedureId, procedureName: v.procedureName || '', templateId,
        patientId: selectedPatientId, appointmentId: appt.id,
        status: 'draft',
        startedBy: user.uid, startedByName: professionalName, startedAt: serverTimestamp(),
        usedPlanAsBase: false,
        plannedSnapshot: {
          versionNumber: v.versionNumber || 1,
          procedureName: v.procedureName || '',
          objective: v.objective || '',
          clinicalEvaluation: v.clinicalEvaluation || '',
          structuredFields: v.structuredFields || {},
          pointRecords: v.pointRecords || null,
          strokesJson: v.strokesJson || null,
          images: Array.isArray(v.images) ? v.images : [],
        },
        executionFields: {},
        strokesJson: null,
        observations: '',
        complications: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(newExecRef, execData);
      // Same sentinel-echo fix as persistExecution() below — serverTimestamp()
      // isn't a real Date until re-read from Firestore.
      const nowLocal = new Date();
      const created: ClinicalExecutionData = { id: newExecRef.id, ...execData, startedAt: nowLocal, createdAt: nowLocal, updatedAt: nowLocal };
      setExecutionsByAppointment(prev => ({ ...prev, [appt.id]: created }));
      addAuditLog({ collection: 'clinical_plans/executions', action: 'WRITE', status: 'SUCCESS', details: `Execução iniciada para "${selectedPatient?.name}" (${v.procedureName}, versão ${v.versionNumber}) por ${professionalName} (escrita real).` });
      openExecutionPanel(created, appt);
    } catch (err: any) {
      showMessage(`Falha ao iniciar execução: ${err?.message || err}`);
    } finally {
      setStartingExecutionApptId(null);
    }
  };

  const handleUsePlanAsBase = () => {
    if (!openExecution) return;
    setExecStrokesJson(openExecution.plannedSnapshot.strokesJson || null);
    // The canvas re-parses `strokesJson` and re-fires onPointsChange with the
    // copied strokes' real ids — setting the point records here first (same
    // render/commit) means that mirror finds the right muscle/unidades/
    // observação for each id instead of falling back to empty defaults.
    setExecPointRecords(openExecution.plannedSnapshot.pointRecords || {});
    setExecUsedPlanAsBase(true);
    showMessage('Marcações do planejamento copiadas para a execução — revise, ajuste o que for diferente e confirme.');
  };

  const handleSaveExecutionDrawing = (drawingsJson: string, overlayBase64?: string) => {
    setExecStrokesJson(drawingsJson);
    setExecOverlayThumbnail(overlayBase64 || null);
    setShowExecutionCanvas(false);
  };

  const persistExecution = async (extra: Record<string, any>) => {
    if (!openExecution || !clinic?.id || !selectedPatientId) throw new Error('Execução não carregada.');
    const ref = fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'clinical_plans', openExecution.planningId, 'executions', openExecution.id);
    const payload: Record<string, any> = {
      executionFields: execFieldsForm,
      pointRecords: openExecutionTemplate?.clinicalWorkspace ? execPointRecords : null,
      strokesJson: execStrokesJson,
      observations: execObservations,
      complications: execComplications,
      usedPlanAsBase: execUsedPlanAsBase,
      updatedAt: serverTimestamp(),
      ...extra,
    };
    if (execOverlayThumbnail) payload.overlayThumbnailBase64 = execOverlayThumbnail;
    await updateDoc(ref, payload);
    // The write payload's serverTimestamp() fields are unresolved sentinels
    // client-side — echo a real Date locally instead so formatDate() doesn't
    // render "Invalid Date" before the next real read of this doc.
    const now = new Date();
    const localEcho: Record<string, any> = { ...payload, updatedAt: now };
    if ('confirmedAt' in payload) localEcho.confirmedAt = now;
    if ('startedAt' in payload) localEcho.startedAt = now;
    const updated: ClinicalExecutionData = { ...openExecution, ...localEcho };
    setOpenExecution(updated);
    setExecutionsByAppointment(prev => openExecutionAppointment ? { ...prev, [openExecutionAppointment.id]: updated } : prev);
    return updated;
  };

  // Upload direto de foto real durante a execução (2026-08-31), pedido pelo
  // usuário — quando o planejamento não tinha foto ainda, a profissional
  // pode enviar uma agora mesmo, sem precisar ir na aba Imagens antes.
  // Mesmo padrão de handleFileSelected (base64 direto, teto de 800KB) — só
  // grava em `execImageId` (nunca em `plannedSnapshot.images`, que fica
  // congelado como estava planejado).
  const execPhotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingExecPhoto, setUploadingExecPhoto] = useState(false);
  const handleUploadExecutionPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !clinic?.id || !selectedPatientId || !openExecution) return;
    if (file.size > 800000) { showMessage('Imagem muito grande — use arquivos menores que 800KB.'); return; }
    setUploadingExecPhoto(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        const id = `img-${Date.now()}`;
        const payload = { title: file.name, category: 'Exame/Foto', description: '', url: base64, date: serverTimestamp() };
        await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images', id), payload);
        setImages(prev => [{ id, ...payload }, ...prev]);
        await persistExecution({ execImageId: id });
        addAuditLog({ collection: 'images', action: 'WRITE', status: 'SUCCESS', details: `Imagem "${file.name}" adicionada durante a execução de "${selectedPatient?.name}" (escrita real).` });
      } catch (err: any) {
        showMessage(`Falha ao gravar imagem: ${err?.message || err}`);
      } finally {
        setUploadingExecPhoto(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveExecutionDraft = async () => {
    if (!openExecution) return;
    setSavingExecutionDraft(true);
    try {
      await persistExecution({});
      addAuditLog({ collection: 'clinical_plans/executions', action: 'WRITE', status: 'SUCCESS', details: `Rascunho de execução salvo para "${selectedPatient?.name}" (escrita real).` });
      showMessage('Rascunho da execução salvo.');
    } catch (err: any) {
      showMessage(`Falha ao salvar rascunho: ${err?.message || err}`);
    } finally {
      setSavingExecutionDraft(false);
    }
  };

  const handleConfirmExecution = async () => {
    if (!openExecution || !clinic?.id || !selectedPatientId || !user) return;
    if (!canExecuteClinical) {
      showMessage('Você não tem permissão clínica para confirmar esta execução.');
      return;
    }
    setConfirmingExecution(true);
    try {
      const professionalName = profile?.name || user.email || 'Profissional';
      const updated = await persistExecution({
        status: 'confirmed',
        confirmedBy: user.uid,
        confirmedByName: professionalName,
        confirmedAt: serverTimestamp(),
      });

      // Evolução real, vinculada por referência — nunca duplica o objeto da execução.
      let treatmentId = treatments.find(t => (t.status || 'active') === 'active')?.id;
      const treatmentsRef = collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'treatments');
      if (!treatmentId) {
        treatmentId = `gen-treat-${Date.now()}`;
        await setDoc(fsDoc(treatmentsRef, treatmentId), { id: treatmentId, description: 'Prontuário Clínico Geral', professional: 'ELIZA NEXT', status: 'active', evolutions: [] });
      }
      const evoEntry: Evolution = {
        id: `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: `Execução registrada — ${updated.procedureName} (versão ${updated.plannedSnapshot.versionNumber}).`,
        date: new Date().toISOString(),
        professional: professionalName,
        clinicalPlanRef: {
          planningId: updated.planningId,
          versionId: updated.versionId,
          procedureName: updated.procedureName,
          executionId: updated.id,
          ...(execOverlayThumbnail ? { thumbnailBase64: execOverlayThumbnail } : {}),
        },
      };
      await updateDoc(fsDoc(treatmentsRef, treatmentId), { evolutions: arrayUnion(evoEntry) });
      setTreatments(prev => {
        const exists = prev.some(t => t.id === treatmentId);
        if (exists) return prev.map(t => t.id === treatmentId ? { ...t, evolutions: [...(t.evolutions || []), evoEntry] } : t);
        return [...prev, { id: treatmentId!, description: 'Prontuário Clínico Geral', status: 'active', evolutions: [evoEntry] }];
      });

      addAuditLog({ collection: 'clinical_plans/executions', action: 'WRITE', status: 'SUCCESS', details: `Execução confirmada para "${selectedPatient?.name}" (${updated.procedureName}) por ${professionalName} — Evolução vinculada gerada (escrita real).` });
      showMessage('Execução confirmada. Evolução registrada no prontuário.');
    } catch (err: any) {
      showMessage(`Falha ao confirmar execução: ${err?.message || err}`);
    } finally {
      setConfirmingExecution(false);
    }
  };

  const handleAddExecutionAddendum = async () => {
    if (!openExecution || !clinic?.id || !selectedPatientId || !addendumText.trim() || !user) return;
    setSavingAddendum(true);
    try {
      const professionalName = profile?.name || user.email || 'Profissional';
      const ref = collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'clinical_plans', openExecution.planningId, 'executions', openExecution.id, 'addenda');
      const docRef = await addDoc(ref, { text: addendumText.trim(), createdBy: user.uid, createdByName: professionalName, createdAt: serverTimestamp() });
      setExecutionAddenda(prev => [...prev, { id: docRef.id, text: addendumText.trim(), createdBy: user.uid, createdByName: professionalName, createdAt: new Date().toISOString() }]);
      addAuditLog({ collection: 'clinical_plans/executions/addenda', action: 'WRITE', status: 'SUCCESS', details: `Adendo adicionado à execução confirmada de "${selectedPatient?.name}" por ${professionalName} (escrita real).` });
      setAddendumText('');
      showMessage('Adendo registrado.');
    } catch (err: any) {
      showMessage(`Falha ao registrar adendo: ${err?.message || err}`);
    } finally {
      setSavingAddendum(false);
    }
  };

  const renderExecutionFields = (fields: ClinicalField[], form: Record<string, string | boolean>, setForm: (updater: (v: Record<string, string | boolean>) => Record<string, string | boolean>) => void, disabled: boolean) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {fields.map(f => (
        <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
          <label className="text-[10px] font-mono text-slate-500 uppercase">{f.label}</label>
          {f.type === 'boolean' ? (
            <label className="flex items-center gap-2 mt-1">
              <input type="checkbox" disabled={disabled} checked={!!form[f.key]} onChange={(e) => setForm(v => ({ ...v, [f.key]: e.target.checked }))} className="w-4 h-4 rounded" />
              <span className="text-xs text-slate-300">Sim</span>
            </label>
          ) : f.type === 'select' ? (
            <select disabled={disabled} value={(form[f.key] as string) || ''} onChange={(e) => setForm(v => ({ ...v, [f.key]: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 disabled:opacity-60">
              <option value="">Selecionar...</option>
              {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea disabled={disabled} value={(form[f.key] as string) || ''} onChange={(e) => setForm(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none disabled:opacity-60" />
          ) : (
            <input disabled={disabled} value={(form[f.key] as string) || ''} onChange={(e) => setForm(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 disabled:opacity-60" />
          )}
        </div>
      ))}
    </div>
  );

  const executionComparison = useMemo(() => {
    if (!openExecution || !openExecutionTemplate) return null;
    return computePlannedVsRealized(openExecutionTemplate.clinicalFields, openExecutionTemplate.executionFields, openExecution.plannedSnapshot.structuredFields, execFieldsForm);
  }, [openExecution, openExecutionTemplate, execFieldsForm]);

  const handleOpenPortalLinkModal = async () => {
    if (!clinic?.id || !selectedPatientId || !user) return;
    setIsPortalLinkModalOpen(true);
    setPortalLink(null);
    setPortalLinkError(null);
    setPortalLinkCopied(false);
    setGeneratingPortalLink(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/patient-portal/admin/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicId: clinic.id, patientId: selectedPatientId }),
      });
      const resData = await response.json();
      if (!response.ok || !resData.success) throw new Error(resData?.error || 'Falha ao gerar link.');
      setPortalLink(`${window.location.origin}/portal/t/${resData.data.token}`);
      addAuditLog({ collection: 'patient_portal_links', action: 'WRITE', status: 'SUCCESS', details: `Link do Portal do Paciente gerado para "${selectedPatient?.name}" (escrita real).` });
    } catch (err: any) {
      setPortalLinkError(err?.message || 'Falha ao gerar link.');
    } finally {
      setGeneratingPortalLink(false);
    }
  };

  const handleCopyPortalLink = async () => {
    if (!portalLink) return;
    try {
      await navigator.clipboard.writeText(portalLink);
      setPortalLinkCopied(true);
      setTimeout(() => setPortalLinkCopied(false), 2500);
    } catch { /* clipboard permission denied — link is still visible to select manually */ }
  };

  // --- Orçamento -----------------------------------------------------

  const quotationTotal = quotationItems.reduce((acc, it) => acc + (Number(it.value) || 0) * (Number(it.quantity) || 1), 0);

  // Default professional for a new quotation item: the logged-in user only
  // counts as a default when they themselves have agenda liberada
  // (isClinicalProvider) — otherwise (secretária/financeiro criando o
  // orçamento em nome de outra pessoa) o campo nasce vazio e obrigatório.
  const defaultQuotationProfessional = (): Pick<QuotationItem, 'professionalUid' | 'professionalName'> =>
    myMember?.isClinicalProvider === true && user?.uid
      ? { professionalUid: user.uid, professionalName: myMember?.name || null }
      : { professionalUid: null, professionalName: null };

  const openNewQuotation = () => {
    setQuotationBeingEditedId(null);
    setQuotationTitle('Plano de Tratamento');
    setQuotationItems([{ description: '', value: 0, quantity: 1, ...defaultQuotationProfessional() }]);
    setQuotationNotes('');
    setQuotationPaymentMethod('');
    setQuotationInstallments('');
    setQuotationSaveError(null);
    setShowQuotationItemPicker(true);
    setPendingClinicalPlanRef(null);
    setAiSuggestion(null);
    setIsQuotationFormOpen(true);
  };

  // "Ver/Editar" um orçamento já salvo — mesmo modal do "Novo orçamento",
  // só pré-preenchido. handleSaveQuotation detecta quotationBeingEditedId e
  // faz updateDoc no lugar de criar um novo doc.
  const openViewQuotation = (q: Quotation) => {
    setQuotationBeingEditedId(q.id);
    setQuotationTitle(q.title);
    setQuotationItems(q.items.map(it => ({ ...it })));
    setQuotationNotes(q.notes || '');
    setQuotationPaymentMethod(q.paymentMethod || '');
    setQuotationInstallments(q.installments ? String(q.installments) : '');
    setQuotationSaveError(null);
    setShowQuotationItemPicker(true);
    setPendingClinicalPlanRef(q.clinicalPlanRef || null);
    setAiSuggestion(null);
    setIsQuotationFormOpen(true);
  };

  const handlePickCatalogItem = (item: TreatmentCatalogItem) => {
    setQuotationItems(prev => [...prev, {
      description: item.name,
      value: item.defaultPrice,
      quantity: 1,
      procedureCategory: mapCatalogCategoryToProcedureCategory(item.category, item.subcategory),
      ...defaultQuotationProfessional(),
    }]);
  };

  const updateQuotationItem = (idx: number, patch: Partial<QuotationItem>) => {
    setQuotationItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const handleSaveQuotation = async () => {
    if (!clinic?.id || !selectedPatientId) return;
    const validItems = quotationItems.filter(it => it.description.trim());
    if (validItems.length === 0) { showMessage('Adicione ao menos um item com descrição.'); return; }
    if (clinicalProviders.length === 0) {
      setQuotationSaveError('Nenhum profissional com agenda liberada cadastrado nesta clínica. Cadastre em Admin → Equipe antes de continuar.');
      return;
    }
    if (validItems.some(it => !it.professionalUid)) {
      setQuotationSaveError('Selecione o profissional responsável em todos os itens antes de salvar.');
      return;
    }
    setQuotationSaveError(null);
    setSavingQuotation(true);
    try {
      if (quotationBeingEditedId) {
        const original = quotations.find(q => q.id === quotationBeingEditedId);
        const payload: Record<string, any> = {
          title: quotationTitle || 'Plano de Tratamento',
          items: validItems,
          totalValue: quotationTotal,
        };
        if (quotationNotes.trim()) payload.notes = quotationNotes.trim();
        if (quotationPaymentMethod) payload.paymentMethod = quotationPaymentMethod;
        if (quotationInstallments && Number(quotationInstallments) > 0) payload.installments = Number(quotationInstallments);
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations', quotationBeingEditedId), payload);
        setQuotations(prev => prev.map(q => q.id === quotationBeingEditedId ? { ...q, ...payload } : q));

        if (original?.status === 'approved') {
          const updatedQuotation: Quotation = { ...(original as Quotation), items: validItems };
          // Idempotente (getDoc antes de setDoc, Fase B) — só cria lançamento
          // pros itens realmente novos, nunca duplica os que já existiam.
          const newEntries = await createFinancialEntriesForApprovedQuotation(clinic.id, selectedPatientId, updatedQuotation, selectedPatient?.name, user?.uid);
          if (newEntries.length > 0) setFinancialEntries(prev => [...newEntries, ...prev]);
          // Só ajusta o valor dos que já existiam e mudaram (e ainda não
          // foram recebidos — a UI já travou a edição desses, isto é a defesa final).
          await syncFinancialEntriesForEditedItems(clinic.id, quotationBeingEditedId, validItems, financialEntries);
        }

        addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Orçamento "${payload.title}" editado para "${selectedPatient?.name}" (escrita real).` });
        setIsQuotationFormOpen(false);
        setQuotationBeingEditedId(null);
        setQuotationNotes('');
        setQuotationPaymentMethod('');
        setQuotationInstallments('');
        showMessage('Orçamento atualizado de verdade.');
        return;
      }

      const id = `q-${Date.now()}`;
      const payload: Omit<Quotation, 'id'> & { createdAt: any } = {
        title: quotationTitle || 'Plano de Tratamento',
        items: validItems,
        status: 'draft',
        totalValue: quotationTotal,
        createdAt: serverTimestamp(),
      };
      // Firestore setDoc rejects `undefined` field values outright — these
      // only get attached to the payload object when actually present,
      // never sent as `undefined`.
      if (quotationNotes.trim()) payload.notes = quotationNotes.trim();
      if (pendingClinicalPlanRef) payload.clinicalPlanRef = pendingClinicalPlanRef;
      if (quotationPaymentMethod) payload.paymentMethod = quotationPaymentMethod;
      if (quotationInstallments && Number(quotationInstallments) > 0) payload.installments = Number(quotationInstallments);
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations', id), payload);
      setQuotations(prev => [{ id, ...payload }, ...prev]);
      addAuditLog({
        collection: 'quotations',
        action: 'WRITE',
        status: 'SUCCESS',
        details: pendingClinicalPlanRef
          ? `Orçamento "${payload.title}" (${formatCurrency(quotationTotal)}) criado para "${selectedPatient?.name}" a partir do Planejamento IA (planningId=${pendingClinicalPlanRef.planningId}, versionId=${pendingClinicalPlanRef.versionId}) — escrita real.`
          : `Orçamento "${payload.title}" (${formatCurrency(quotationTotal)}) criado para "${selectedPatient?.name}" (escrita real).`,
      });
      setIsQuotationFormOpen(false);
      setPendingClinicalPlanRef(null);
      setQuotationNotes('');
      setQuotationPaymentMethod('');
      setQuotationInstallments('');
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
      // Real transition into 'approved' (not already there) — the guard
      // that makes the side effects below idempotent even if this quotation
      // gets reverted to draft and approved again later.
      const isNewApproval = status === 'approved' && quotation.status !== 'approved';
      const payload: Record<string, any> = { status, updatedAt: serverTimestamp() };
      if (status === 'approved') payload.approvedAt = serverTimestamp();
      if (status === 'rejected') payload.rejectedAt = serverTimestamp();

      // Fase B: só na primeira aprovação real, marca todo item ainda não
      // confirmado como 'pending' (nunca regride um item já 'confirmed'
      // numa reaprovação depois de uma reversão pra rascunho).
      let nextItems = quotation.items;
      if (isNewApproval) {
        nextItems = quotation.items.map(it => it.executionStatus === 'confirmed' ? it : { ...it, executionStatus: 'pending' as const });
        payload.items = nextItems;
      }

      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations', quotation.id), payload);
      setQuotations(prev => prev.map(q => q.id === quotation.id ? { ...q, status, items: nextItems } : q));
      // Small structured history of the transition itself — `status`/
      // `updatedAt` alone can't tell a temporal query WHEN this happened,
      // and a reversal (approved→draft) would silently erase the moment
      // it was approved if we only kept the current status.
      logStatusEvent(clinic.id, {
        entityType: 'quotation',
        entityId: quotation.id,
        eventType: 'quotation_status_changed',
        patientId: selectedPatientId,
        fromStatus: quotation.status,
        toStatus: status,
        metadata: { title: quotation.title, totalValue: quotation.totalValue },
      }, user?.uid);

      // O dinheiro é devido assim que o orçamento é aprovado, independente
      // de quando (ou se) o procedimento é confirmado como realizado —
      // inclusive pra orçamentos gerados de um Planejamento IA (só a
      // Evolução diverge pra esses, ver pendingQuotationItems). Reverter
      // pra rascunho ou rejeitar NUNCA mexe nos lançamentos já criados —
      // cancelamento é decisão manual do financeiro, nunca automática,
      // pra nunca esconder um valor que já possa ter sido recebido.
      if (isNewApproval) {
        const newEntries = await createFinancialEntriesForApprovedQuotation(clinic.id, selectedPatientId, { ...quotation, items: nextItems }, selectedPatient?.name, user?.uid);
        if (newEntries.length > 0) setFinancialEntries(prev => [...newEntries, ...prev]);
      }

      const statusLabel = status === 'approved' ? 'aprovado' : status === 'rejected' ? 'rejeitado' : 'revertido para rascunho';
      addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Orçamento "${quotation.title}" marcado como ${statusLabel} (escrita real).` });
      showMessage(`Orçamento marcado como ${statusLabel}.`);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setUpdatingQuotationId(null);
    }
  };

  // Só orçamentos NÃO aprovados podem ser excluídos — um aprovado já pode
  // ter lançamento financeiro/evolução vinculados (Fase B), excluir o doc
  // não desfaria isso, só esconderia a origem. Reverter pra rascunho antes,
  // se for o caso, é o caminho — não oferecer exclusão direta de aprovado.
  const handleDeleteQuotation = async (quotation: Quotation) => {
    if (!clinic?.id || !selectedPatientId) return;
    setUpdatingQuotationId(quotation.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations', quotation.id));
      setQuotations(prev => prev.filter(q => q.id !== quotation.id));
      addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Orçamento "${quotation.title}" excluído para "${selectedPatient?.name}" (escrita real).` });
      showMessage('Orçamento excluído de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setUpdatingQuotationId(null);
      setConfirmDeleteQuotationId(null);
    }
  };

  // Confirmação "solta" de um item de orçamento — caminho paralelo e mais
  // simples ao existente Planejamento→Execução (handleConfirmExecution),
  // pra procedimentos comuns que nunca passam por um plano estruturado.
  // Nunca oferecido pra itens de um orçamento com clinicalPlanRef (esses já
  // têm evolução via Execução — ver pendingQuotationItems).
  const handleConfirmQuotationItemExecution = async (quotationId: string, itemIndex: number) => {
    if (!clinic?.id || !selectedPatientId || !user) return;
    if (!canExecuteClinical) {
      showMessage('Você não tem permissão clínica para confirmar a realização deste procedimento.');
      return;
    }
    const quotation = quotations.find(q => q.id === quotationId);
    const item = quotation?.items[itemIndex];
    if (!quotation || !item) return;
    const key = `${quotationId}-${itemIndex}`;
    setConfirmingItemKey(key);
    try {
      const professionalName = profile?.name || user.email || 'Profissional';
      const nowIso = new Date().toISOString();
      // Quem confirmou a ação (audit trail) pode ser diferente de quem de
      // fato realizou o procedimento — o select no painel "Aguardando
      // confirmação" deixa escolher, com default = profissional do orçamento.
      const overrideUid = executionOverrides[key];
      const overrideProvider = overrideUid ? clinicalProviders.find(p => p.uid === overrideUid) : undefined;
      const executedByUid = overrideUid || item.professionalUid || null;
      const executedByName = overrideProvider?.name || item.professionalName || professionalName;
      const nextItems = await patchQuotationItem(clinic.id, selectedPatientId, quotation, itemIndex, {
        executionStatus: 'confirmed',
        confirmedAt: nowIso,
        confirmedBy: user.uid,
        confirmedByName: professionalName,
        executedByUid,
        executedByName,
      });
      setQuotations(prev => prev.map(q => q.id === quotationId ? { ...q, items: nextItems } : q));

      // Evolução real — mesmo padrão de handleConfirmExecution, mas com
      // quotationRef em vez de clinicalPlanRef (não existe plano aqui).
      let treatmentId = treatments.find(t => (t.status || 'active') === 'active')?.id;
      const treatmentsRef = collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'treatments');
      if (!treatmentId) {
        treatmentId = `gen-treat-${Date.now()}`;
        await setDoc(fsDoc(treatmentsRef, treatmentId), { id: treatmentId, description: 'Prontuário Clínico Geral', professional: 'ELIZA NEXT', status: 'active', evolutions: [] });
      }
      const noteText = (executionNotes[key] || '').trim();
      const baseText = `Procedimento realizado — ${item.description} (orçamento aprovado em ${formatDate(quotation.approvedAt) || 'data não registrada'}).`;
      const evoEntry: Evolution = {
        id: `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: noteText ? `${baseText} ${noteText}` : baseText,
        date: nowIso,
        professional: executedByName,
        quotationRef: { quotationId, itemIndex, description: item.description },
      };
      await updateDoc(fsDoc(treatmentsRef, treatmentId), { evolutions: arrayUnion(evoEntry) });
      setTreatments(prev => {
        const exists = prev.some(t => t.id === treatmentId);
        if (exists) return prev.map(t => t.id === treatmentId ? { ...t, evolutions: [...(t.evolutions || []), evoEntry] } : t);
        return [...prev, { id: treatmentId!, description: 'Prontuário Clínico Geral', status: 'active', evolutions: [evoEntry] }];
      });

      addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Item "${item.description}" do orçamento "${quotation.title}" confirmado como realizado por ${professionalName} para "${selectedPatient?.name}" — Evolução vinculada gerada (escrita real).` });
      showMessage('Procedimento confirmado. Evolução registrada no prontuário.');
      setExecutionNotes(prev => { const next = { ...prev }; delete next[key]; return next; });

      // Painel de pós-operatório abre na hora — a Eliza já começa a gerar a
      // sugestão em segundo plano, o profissional só revisa/edita.
      setPostOpDraftText('');
      setPostOpError(null);
      setPostOpPanel({ treatmentId, evolutionId: evoEntry.id!, procedureDescription: item.description });
      generatePostOpDraft(treatmentId, evoEntry.id!, item.description);
    } catch (err: any) {
      showMessage(`Falha ao confirmar realização: ${err?.message || err}`);
    } finally {
      setConfirmingItemKey(null);
    }
  };

  // Evoluções vivem como array embutido no doc do treatment (nunca docs
  // próprios) — qualquer patch precisa reescrever o array inteiro.
  //
  // BUG REAL corrigido aqui: esta função é chamada de dentro de
  // generatePostOpDraft, depois de um `await` na IA (rede, ~1-3s). Se ela
  // lesse `treatments` do estado local (closure do componente), pegaria a
  // FOTO DE ANTES da evolução que acabou de ser criada em
  // handleConfirmQuotationItemExecution (que roda no mesmo tick, síncrono,
  // antes do primeiro `await` da IA) — porque o estado local só é atualizado
  // de verdade num próximo render, e o closure de uma função async iniciada
  // ANTES desse render nunca vê a versão nova. O patch então reescrevia o
  // array de evoluções com a versão antiga, apagando de verdade no Firestore
  // a evolução recém-criada (não só o pós-operatório — a evolução inteira).
  // Corrigido lendo o doc real do Firestore na hora do patch, nunca
  // confiando no estado local pra este read-modify-write.
  const patchEvolution = async (treatmentId: string, evolutionId: string, patch: Partial<Evolution>) => {
    if (!clinic?.id || !selectedPatientId) return;
    const treatmentRef = fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'treatments', treatmentId);
    const snap = await getDoc(treatmentRef);
    if (!snap.exists()) return;
    const currentEvolutions = (snap.data() as Treatment).evolutions || [];
    const newEvolutions = currentEvolutions.map(ev => ev.id === evolutionId ? { ...ev, ...patch } : ev);
    await updateDoc(treatmentRef, { evolutions: newEvolutions });
    setTreatments(prev => prev.map(t => t.id === treatmentId ? { ...t, evolutions: newEvolutions } : t));
  };

  // Mesmo padrão de handleAskEliza (IA real via getGenAI, JSON estrito,
  // sempre editável e nunca aplicada sozinha — regra documentada em
  // planningTemplates.ts) — aqui pra sugerir pós-operatório específico do
  // procedimento recém-confirmado, nunca pra prescrever de verdade.
  const generatePostOpDraft = async (treatmentId: string, evolutionId: string, procedureDescription: string) => {
    setPostOpLoadingDraft(true);
    setPostOpError(null);
    try {
      const anamnesisContext = anamnesis
        ? ANAMNESIS_FIELDS.map(f => `${f.label} ${anamnesis[f.name] || 'não informado'}`).join('; ')
        : 'sem anamnese registrada';
      const prompt = `Você é a Eliza, assistente odontológica/estética. O profissional acabou de confirmar a realização do procedimento "${procedureDescription}" no paciente "${selectedPatient?.name}".
Contexto de anamnese (alergias/condições relevantes, nunca invente além disso): ${anamnesisContext}.
Escreva uma orientação de pós-operatório objetiva e prática, em português, pro paciente ler (o que fazer/evitar nas próximas horas/dias) — específica pra esse procedimento, nunca genérica demais.
Isto é uma SUGESTÃO: o profissional vai revisar e editar antes de qualquer coisa ficar visível pro paciente. Nunca inclua dose/medicação de prescrição específica, só orientação geral de cuidado.
Responda ESTRITAMENTE em JSON válido, sem markdown, no formato: {"instructions": "texto do pós-operatório"}`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'postop_instructions',
        clinicId: clinic?.id,
      });
      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Você pode escrever manualmente.');
      const parsed = JSON.parse(jsonMatch[0]);
      const draft = String(parsed.instructions || '').trim();
      setPostOpDraftText(draft);
      await patchEvolution(treatmentId, evolutionId, { postOpDraft: draft });
    } catch (err: any) {
      setPostOpError(err?.message || 'Falha ao gerar sugestão da Eliza. Você pode escrever manualmente.');
    } finally {
      setPostOpLoadingDraft(false);
    }
  };

  const handleSavePostOpInstructions = async () => {
    if (!postOpPanel) return;
    setPostOpSaving(true);
    try {
      await patchEvolution(postOpPanel.treatmentId, postOpPanel.evolutionId, { postOpInstructions: postOpDraftText.trim() });
      addAuditLog({ collection: 'treatments', action: 'WRITE', status: 'SUCCESS', details: `Pós-operatório de "${postOpPanel.procedureDescription}" salvo para "${selectedPatient?.name}" (ainda não liberado no Portal — escrita real).` });
      showMessage('Pós-operatório salvo no prontuário.');
    } catch (err: any) {
      showMessage(`Falha ao salvar pós-operatório: ${err?.message || err}`);
    } finally {
      setPostOpSaving(false);
    }
  };

  const handleReleasePostOpToPortal = async () => {
    if (!postOpPanel) return;
    setPostOpReleasing(true);
    try {
      await patchEvolution(postOpPanel.treatmentId, postOpPanel.evolutionId, { postOpReleasedToPortal: true });
      addAuditLog({ collection: 'treatments', action: 'WRITE', status: 'SUCCESS', details: `Pós-operatório de "${postOpPanel.procedureDescription}" liberado no Portal do Paciente para "${selectedPatient?.name}" (escrita real).` });
      showMessage('Liberado no Portal do Paciente.');
      setPostOpPanel(null);
    } catch (err: any) {
      showMessage(`Falha ao liberar no portal: ${err?.message || err}`);
    } finally {
      setPostOpReleasing(false);
    }
  };

  // Itens de orçamentos aprovados ainda aguardando confirmação de
  // realização — de todos os orçamentos do paciente, exceto os gerados de
  // um Planejamento IA (esses seguem via Execução, aba própria, pra nunca
  // duplicar evolução). Ausência de executionStatus (orçamentos aprovados
  // antes da Fase B) é tratada como 'pending', sem backfill.
  const pendingQuotationItems = useMemo(() => {
    const out: { quotationId: string; itemIndex: number; item: QuotationItem; quotationTitle: string }[] = [];
    quotations.forEach(q => {
      if (q.status !== 'approved' || q.clinicalPlanRef) return;
      (q.items || []).forEach((item, idx) => {
        if ((item.executionStatus ?? 'pending') === 'pending') {
          out.push({ quotationId: q.id, itemIndex: idx, item, quotationTitle: q.title });
        }
      });
    });
    return out;
  }, [quotations]);

  // Compartilhado pelas duas seções da lista (Aprovados / Aguardando
  // aprovação) — mesmo card, só muda em qual `quotations.filter(...)` roda.
  const renderQuotationCard = (q: Quotation) => (
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
      <p className="text-[10px] text-slate-500 font-mono mb-2">
        Criado em {formatDate(q.createdAt) || 'data não registrada'}
        {q.status === 'approved' && q.approvedAt ? ` · Aprovado em ${formatDate(q.approvedAt)}` : ''}
      </p>
      {q.notes && <p className="text-[10.5px] text-slate-500 italic mb-2">{q.notes}</p>}
      {q.clinicalPlanRef && (
        <button
          onClick={() => openPlanningInline(q.clinicalPlanRef!.planningId)}
          className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-bold text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 px-2 py-1 rounded-lg hover:bg-next-purple-neon/20 transition-colors"
        >
          <Brain className="w-3 h-3" /> Gerado do Planejamento IA — ver plano
        </button>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => openViewQuotation(q)} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-300 bg-slate-800 border border-next-border px-2 py-1 rounded-lg">
          <Pencil className="w-3 h-3" /> Ver/Editar
        </button>
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
        {q.status !== 'approved' && (
          confirmDeleteQuotationId === q.id ? (
            <div className="flex items-center gap-1">
              <button onClick={() => handleDeleteQuotation(q)} disabled={updatingQuotationId === q.id} className="text-[10px] font-bold text-white bg-next-red-alert px-2 py-1 rounded-lg disabled:opacity-60">
                {updatingQuotationId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirmar exclusão'}
              </button>
              <button onClick={() => setConfirmDeleteQuotationId(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button onClick={() => setConfirmDeleteQuotationId(q.id)} className="inline-flex items-center gap-1 text-[10px] font-bold text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/25 px-2 py-1 rounded-lg">
              <Trash2 className="w-3 h-3" /> Excluir
            </button>
          )
        )}
      </div>
    </div>
  );

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
      const suggested = aiSuggestion.items.map(it => ({ ...it, ...defaultQuotationProfessional() }));
      return [...base, ...suggested];
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

  // Ocultar continua sendo um toggle direto (sem precisar de modal) — só
  // COMPARTILHAR (ligar a visibilidade) passa pelo modal de título/descrição
  // abaixo, porque é aí que faz sentido revisar o que o paciente vai ler.
  const toggleImageVisibility = async (img: PatientImage) => {
    if (!clinic?.id || !selectedPatientId) return;
    const nextVisible = !img.patientVisible;
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images', img.id), { patientVisible: nextVisible });
      setImages(prev => prev.map(i => i.id === img.id ? { ...i, patientVisible: nextVisible } : i));
      addAuditLog({ collection: 'images', action: 'WRITE', status: 'SUCCESS', details: `Visibilidade da imagem "${img.title}" alterada no Portal do Paciente (escrita real).` });
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    }
  };

  const openShareImageModal = (img: PatientImage) => {
    setShareImageTarget(img);
    setShareImageForm({ title: img.title || '', description: img.description || '' });
  };

  const handleConfirmShareImage = async () => {
    if (!clinic?.id || !selectedPatientId || !shareImageTarget) return;
    setSavingShareImage(true);
    try {
      const patch = { title: shareImageForm.title.trim() || shareImageTarget.title, description: shareImageForm.description.trim(), patientVisible: true };
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images', shareImageTarget.id), patch);
      setImages(prev => prev.map(i => i.id === shareImageTarget.id ? { ...i, ...patch } : i));
      addAuditLog({ collection: 'images', action: 'WRITE', status: 'SUCCESS', details: `Imagem "${patch.title}" compartilhada com "${selectedPatient?.name}" no Portal do Paciente (escrita real).` });
      showMessage('Imagem compartilhada com o paciente.');
      setShareImageTarget(null);
    } catch (err: any) {
      showMessage(`Falha ao compartilhar: ${err?.message || err}`);
    } finally {
      setSavingShareImage(false);
    }
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
      const totalAmount = Number(financialForm.amount) || 0;
      const installmentCount = Math.max(1, Math.min(24, Number(financialForm.installments) || 1));
      const intervalDays = Math.max(1, Number(financialForm.installmentIntervalDays) || 30);
      const groupId = `pat-fin-${Date.now()}`;
      const baseDate = new Date();

      // Split into equal cents, remainder goes on the last installment.
      const baseCents = Math.floor((totalAmount * 100) / installmentCount);
      const remainderCents = Math.round(totalAmount * 100) - baseCents * installmentCount;

      const batch = writeBatch(db);
      const newEntries: FinancialEntry[] = [];
      for (let i = 0; i < installmentCount; i++) {
        const id = `${groupId}-${i + 1}`;
        const cents = baseCents + (i === installmentCount - 1 ? remainderCents : 0);
        const amount = cents / 100;
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + i * intervalDays);
        const payload = {
          patientId: selectedPatientId,
          patientName: selectedPatient?.name || '',
          description: financialForm.description.trim(),
          type: 'income',
          category: 'Clínico',
          amount,
          paidAmount: financialForm.status === 'paid' ? amount : 0,
          pendingAmount: financialForm.status === 'paid' ? 0 : amount,
          status: financialForm.status,
          paymentMethod: financialForm.paymentMethod,
          date: dueDate.toISOString(),
          installmentIndex: i + 1,
          installmentTotal: installmentCount,
          groupId,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'eliza_next_sandbox',
        };
        batch.set(fsDoc(db, 'clinics', clinic.id, 'financial_entries', id), payload);
        newEntries.push({ id, ...payload } as unknown as FinancialEntry);
      }
      await batch.commit();
      setFinancialEntries(prev => [...newEntries, ...prev]);
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `${installmentCount > 1 ? `${installmentCount} parcelas (total ${formatCurrency(totalAmount)})` : formatCurrency(totalAmount)} lançado(s) para "${selectedPatient?.name}" (escrita real).` });
      setFinancialForm({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX', installments: '1', installmentIntervalDays: '30' });
      setIsFinancialFormOpen(false);
      showMessage('Lançamento financeiro salvo de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingFinancial(false);
    }
  };

  const startEditFinancialEntry = (entry: FinancialEntry) => {
    setEditingFinancialId(entry.id);
    setFinancialEditForm({
      description: entry.description || '',
      amount: String(entry.amount ?? ''),
      status: entry.status || 'pending',
      paymentMethod: entry.paymentMethod || 'PIX',
      date: entry.date ? new Date(entry.date).toISOString().slice(0, 10) : '',
    });
  };

  const cancelEditFinancialEntry = () => { setEditingFinancialId(null); };

  const startReceiveFinancialEntry = (entry: FinancialEntry) => {
    setReceivingFinancialId(entry.id);
    const saldo = entry.pendingAmount ?? entry.amount;
    setReceiveAmountInput(String(saldo));
  };
  const cancelReceiveFinancialEntry = () => { setReceivingFinancialId(null); setReceiveAmountInput(''); };

  const handleSaveFinancialEdit = async () => {
    if (!clinic?.id || !editingFinancialId || !financialEditForm.description.trim() || !financialEditForm.amount) return;
    setSavingFinancialEdit(true);
    try {
      const currentEntry = financialEntries.find(f => f.id === editingFinancialId);
      // Um lançamento já recebido nunca tem valor/status editado por aqui —
      // só "Cancelar recebimento" (abaixo) pode desfazer um pagamento. Editar
      // o valor de um `paid` direto (bug real, achado em produção) fazia a
      // diferença simplesmente sumir do Financeiro: nenhum lançamento novo
      // nascia pra cobrir o saldo que deixou de estar "recebido".
      const isPaid = currentEntry?.status === 'paid';
      const amount = isPaid ? (currentEntry!.amount) : (Number(financialEditForm.amount) || 0);
      const status = isPaid ? 'paid' : financialEditForm.status;
      const patch: any = {
        description: financialEditForm.description.trim(),
        amount,
        status,
        paymentMethod: financialEditForm.paymentMethod,
        date: financialEditForm.date ? new Date(`${financialEditForm.date}T12:00:00`).toISOString() : new Date().toISOString(),
        ...(isPaid ? {} : {
          paidAmount: status === 'paid' ? amount : status === 'partial' ? undefined : 0,
          pendingAmount: status === 'paid' ? 0 : amount,
        }),
      };
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', editingFinancialId), patch);
      setFinancialEntries(prev => prev.map(f => f.id === editingFinancialId ? { ...f, ...patch } : f));
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento "${patch.description}" editado para "${selectedPatient?.name}" (escrita real).` });
      setEditingFinancialId(null);
      showMessage('Lançamento atualizado de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao editar: ${err?.message || err}`);
    } finally {
      setSavingFinancialEdit(false);
    }
  };

  // Desfaz um recebimento (total ou a fatia paga de um recebimento parcial),
  // devolvendo ESTE MESMO lançamento pro estado de antes de ser recebido —
  // nunca mexe em nenhum outro doc (ex. o "restante" que um recebimento
  // parcial já tenha gerado antes, que continua existindo do jeito que está).
  const handleCancelFinancialReceipt = async (entry: FinancialEntry) => {
    if (!clinic?.id) return;
    setProcessingFinancialId(entry.id);
    try {
      const patch = { status: 'pending', paidAmount: 0, pendingAmount: entry.amount, paidAt: null, receivedBy: null, receivedByName: null };
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', entry.id), patch);
      setFinancialEntries(prev => prev.map(f => f.id === entry.id ? { ...f, ...patch } : f));
      logStatusEvent(clinic.id, {
        entityType: 'financial_entry',
        entityId: entry.id,
        eventType: 'financial_entry_status_changed',
        patientId: selectedPatientId || null,
        fromStatus: entry.status,
        toStatus: 'pending',
        metadata: { description: entry.description, amount: entry.amount, reason: 'receipt_cancelled' },
      }, user?.uid);
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Recebimento de "${entry.description}" (${formatCurrency(entry.amount)}) cancelado — voltou a pendente (escrita real).` });
      showMessage('Recebimento cancelado — voltou a pendente.');
    } catch (err: any) {
      showMessage(`Falha ao cancelar recebimento: ${err?.message || err}`);
    } finally {
      setProcessingFinancialId(null);
      setConfirmCancelReceiptId(null);
    }
  };

  // Pagamento agrupado: soma o saldo de N lançamentos pendentes selecionados
  // e trata como um valor único — mesma matemática de recibo+restante de
  // handleConfirmFinancialReceived, mas os N originais são DELETADOS (não
  // tem como "um deles virar o recibo", vêm de vários) e o(s) novo(s)
  // lançamento(s) carregam `relatedEntries` — o snapshot que alimenta o
  // botão "Ver relação".
  const handleConfirmGroupPayment = async (entries: FinancialEntry[], receivedAmountRaw: number) => {
    if (!clinic?.id || entries.length === 0) return;
    const sumPendente = entries.reduce((s, e) => s + (e.pendingAmount ?? e.amount), 0);
    const EPS = 0.005;
    const receivedAmount = Math.round((Number(receivedAmountRaw) || 0) * 100) / 100;
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      showMessage('Informe um valor válido maior que zero.');
      return;
    }
    const isFullPayment = receivedAmount >= sumPendente - EPS;
    const wasCapped = receivedAmount > sumPendente + EPS;
    const receivedByName = profile?.name || user?.email || 'Usuário';
    const relatedEntries = entries.map(e => ({ id: e.id, description: e.description, amount: e.pendingAmount ?? e.amount }));
    const groupId = `pat-fin-group-${Date.now()}`;
    const groupDescription = `Pagamento agrupado (${entries.length} procedimentos)`;

    setSavingGroupAction(true);
    try {
      const batch = writeBatch(db);
      entries.forEach(e => batch.delete(fsDoc(db, 'clinics', clinic.id, 'financial_entries', e.id)));

      const paidRef = fsDoc(collection(db, 'clinics', clinic.id, 'financial_entries'));
      const paidPayload: Record<string, any> = {
        patientId: selectedPatientId, patientName: selectedPatient?.name || '',
        description: groupDescription, type: 'income', category: 'Clínico',
        amount: isFullPayment ? sumPendente : receivedAmount,
        paidAmount: isFullPayment ? sumPendente : receivedAmount, pendingAmount: 0, status: 'paid',
        paymentMethod: entries[0]?.paymentMethod || 'PIX', date: new Date().toISOString(),
        paidAt: serverTimestamp(), receivedBy: user?.uid || null, receivedByName,
        groupId, relatedEntries,
        createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_next_sandbox',
      };
      batch.set(paidRef, paidPayload);

      let remainderRef: ReturnType<typeof fsDoc> | null = null;
      let remainderPayload: Record<string, any> | null = null;
      if (!isFullPayment) {
        const remainder = Math.round((sumPendente - receivedAmount) * 100) / 100;
        remainderRef = fsDoc(collection(db, 'clinics', clinic.id, 'financial_entries'));
        remainderPayload = {
          patientId: selectedPatientId, patientName: selectedPatient?.name || '',
          description: `Saldo restante — ${groupDescription}`, type: 'income', category: 'Clínico',
          amount: remainder, paidAmount: 0, pendingAmount: remainder, status: 'pending',
          paymentMethod: entries[0]?.paymentMethod || 'PIX', date: new Date().toISOString(),
          groupId, relatedEntries,
          createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_next_sandbox',
        };
        batch.set(remainderRef, remainderPayload);
      }

      await batch.commit();

      const newDocs: FinancialEntry[] = [{ id: paidRef.id, ...paidPayload } as unknown as FinancialEntry];
      if (remainderRef && remainderPayload) newDocs.push({ id: remainderRef.id, ...remainderPayload } as unknown as FinancialEntry);
      const removedIds = new Set(entries.map(e => e.id));
      setFinancialEntries(prev => [...newDocs, ...prev.filter(f => !removedIds.has(f.id))]);
      setSelectedFinancialIds(new Set());
      setGroupActionMode(null);
      setGroupReceiveAmountInput('');

      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Pagamento agrupado de ${formatCurrency(isFullPayment ? sumPendente : receivedAmount)} recebido por ${receivedByName}, combinando: ${relatedEntries.map(r => `${r.description} (${formatCurrency(r.amount)})`).join(', ')}${!isFullPayment ? ` — saldo de ${formatCurrency(sumPendente - receivedAmount)} lançado como novo pendente` : ''} (escrita real).` });
      showMessage(isFullPayment
        ? (wasCapped ? 'Valor informado era maior que o saldo — considerado o saldo total.' : 'Pagamento agrupado recebido de verdade.')
        : `Recebido ${formatCurrency(receivedAmount)}. Saldo de ${formatCurrency(sumPendente - receivedAmount)} lançado como novo pendente.`);
    } catch (err: any) {
      showMessage(`Falha ao processar pagamento agrupado: ${err?.message || err}`);
    } finally {
      setSavingGroupAction(false);
    }
  };

  // Gera N parcelas a partir da soma de vários lançamentos pendentes
  // selecionados — mesma matemática de centavos exatos (resto na última
  // parcela) já usada em handleAddFinancialEntry pra um lançamento novo.
  const handleGenerateInstallmentsFromSelected = async (entries: FinancialEntry[], installmentCountRaw: number, intervalDaysRaw: number) => {
    if (!clinic?.id || entries.length === 0) return;
    const sumPendente = entries.reduce((s, e) => s + (e.pendingAmount ?? e.amount), 0);
    const installmentCount = Math.max(1, Math.min(24, Math.round(installmentCountRaw) || 1));
    const intervalDays = Math.max(1, Math.round(intervalDaysRaw) || 30);
    const relatedEntries = entries.map(e => ({ id: e.id, description: e.description, amount: e.pendingAmount ?? e.amount }));
    const groupId = `pat-fin-group-${Date.now()}`;
    const groupDescription = `Parcelamento agrupado (${entries.length} procedimentos)`;
    const baseDate = new Date();

    const baseCents = Math.floor((sumPendente * 100) / installmentCount);
    const remainderCents = Math.round(sumPendente * 100) - baseCents * installmentCount;

    setSavingGroupAction(true);
    try {
      const batch = writeBatch(db);
      entries.forEach(e => batch.delete(fsDoc(db, 'clinics', clinic.id, 'financial_entries', e.id)));

      const newEntries: FinancialEntry[] = [];
      for (let i = 0; i < installmentCount; i++) {
        const id = `${groupId}-${i + 1}`;
        const cents = baseCents + (i === installmentCount - 1 ? remainderCents : 0);
        const amount = cents / 100;
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + i * intervalDays);
        const payload = {
          patientId: selectedPatientId, patientName: selectedPatient?.name || '',
          description: groupDescription, type: 'income', category: 'Clínico',
          amount, paidAmount: 0, pendingAmount: amount, status: 'pending',
          paymentMethod: entries[0]?.paymentMethod || 'PIX', date: dueDate.toISOString(),
          installmentIndex: i + 1, installmentTotal: installmentCount,
          groupId, relatedEntries,
          createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_next_sandbox',
        };
        batch.set(fsDoc(db, 'clinics', clinic.id, 'financial_entries', id), payload);
        newEntries.push({ id, ...payload } as unknown as FinancialEntry);
      }
      await batch.commit();

      const removedIds = new Set(entries.map(e => e.id));
      setFinancialEntries(prev => [...newEntries, ...prev.filter(f => !removedIds.has(f.id))]);
      setSelectedFinancialIds(new Set());
      setGroupActionMode(null);

      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `${installmentCount} parcelas (total ${formatCurrency(sumPendente)}) geradas combinando: ${relatedEntries.map(r => `${r.description} (${formatCurrency(r.amount)})`).join(', ')} (escrita real).` });
      showMessage(`${installmentCount} parcelas geradas, total ${formatCurrency(sumPendente)}.`);
    } catch (err: any) {
      showMessage(`Falha ao gerar parcelamento: ${err?.message || err}`);
    } finally {
      setSavingGroupAction(false);
    }
  };

  // Fase C: aceita valor parcial. Total -> mesmo comportamento de antes +
  // receivedBy. Parcial -> este doc vira o recibo de hoje (reduzido ao
  // valor recebido) e um doc NOVO nasce com o saldo em aberto — via
  // writeBatch, as duas escritas são atômicas (tudo ou nada).
  const handleConfirmFinancialReceived = async (entry: FinancialEntry, receivedAmountRaw: number) => {
    if (!clinic?.id) return;
    const saldoPendente = entry.pendingAmount ?? entry.amount;
    const EPS = 0.005;
    const receivedAmount = Math.round((Number(receivedAmountRaw) || 0) * 100) / 100;
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      showMessage('Informe um valor válido maior que zero.');
      return;
    }
    const isFullPayment = receivedAmount >= saldoPendente - EPS;
    const wasCapped = receivedAmount > saldoPendente + EPS;
    const receivedByName = profile?.name || user?.email || 'Usuário';

    setProcessingFinancialId(entry.id);
    try {
      if (isFullPayment) {
        // Server-side clock — this action IS the "payment confirmed now"
        // event, so always stamping paidAt here is correct.
        const patch = { status: 'paid', paidAmount: entry.amount, pendingAmount: 0, paidAt: serverTimestamp(), receivedBy: user?.uid || null, receivedByName };
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', entry.id), patch);
        setFinancialEntries(prev => prev.map(f => f.id === entry.id ? { ...f, ...patch, paidAt: new Date().toISOString() } : f));
        logStatusEvent(clinic.id, {
          entityType: 'financial_entry',
          entityId: entry.id,
          eventType: 'financial_entry_status_changed',
          patientId: selectedPatientId || null,
          fromStatus: entry.status,
          toStatus: 'paid',
          metadata: { description: entry.description, amount: entry.amount },
        }, user?.uid);
        addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento "${entry.description}" marcado como recebido por ${receivedByName} (escrita real).` });
        showMessage(wasCapped ? 'Valor informado era maior que o saldo — considerado o saldo total.' : 'Marcado como recebido de verdade.');
      } else {
        const remainder = Math.round((saldoPendente - receivedAmount) * 100) / 100;
        const groupId = entry.groupId || `pat-fin-split-${entry.id}-${Date.now()}`;
        const patch: Record<string, any> = {
          amount: receivedAmount, paidAmount: receivedAmount, pendingAmount: 0, status: 'paid',
          paidAt: serverTimestamp(), receivedBy: user?.uid || null, receivedByName, groupId,
        };
        const newRef = fsDoc(collection(db, 'clinics', clinic.id, 'financial_entries'));
        const remainderPayload: Record<string, any> = {
          patientId: selectedPatientId, patientName: selectedPatient?.name || '',
          description: entry.description, type: 'income', category: 'Clínico',
          amount: remainder, paidAmount: 0, pendingAmount: remainder, status: 'pending',
          paymentMethod: entry.paymentMethod, date: entry.date || new Date().toISOString(),
          installmentIndex: entry.installmentIndex, installmentTotal: entry.installmentTotal,
          groupId,
          professionalUid: entry.professionalUid ?? null,
          professionalName: entry.professionalName ?? null,
          quotationRef: entry.quotationRef ?? null,
          createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_next_sandbox',
        };
        Object.keys(remainderPayload).forEach(k => remainderPayload[k] === undefined && delete remainderPayload[k]);

        const batch = writeBatch(db);
        batch.update(fsDoc(db, 'clinics', clinic.id, 'financial_entries', entry.id), patch);
        batch.set(newRef, remainderPayload);
        await batch.commit();

        setFinancialEntries(prev => [
          { id: newRef.id, ...remainderPayload } as unknown as FinancialEntry,
          ...prev.map(f => f.id === entry.id ? { ...f, ...patch, paidAt: new Date().toISOString() } : f),
        ]);
        logStatusEvent(clinic.id, {
          entityType: 'financial_entry',
          entityId: entry.id,
          eventType: 'financial_entry_status_changed',
          patientId: selectedPatientId || null,
          fromStatus: entry.status,
          toStatus: 'paid',
          metadata: { description: entry.description, amount: receivedAmount },
        }, user?.uid);
        addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Recebido ${formatCurrency(receivedAmount)} de "${entry.description}" por ${receivedByName}; saldo de ${formatCurrency(remainder)} lançado como novo pendente (escrita real).` });
        showMessage(`Recebido ${formatCurrency(receivedAmount)}. Saldo de ${formatCurrency(remainder)} lançado como novo pendente.`);
      }
    } catch (err: any) {
      showMessage(`Falha ao atualizar: ${err?.message || err}`);
    } finally {
      setProcessingFinancialId(null);
      setReceivingFinancialId(null);
      setReceiveAmountInput('');
    }
  };

  const handleDeleteFinancialEntry = async (id: string) => {
    if (!clinic?.id) return;
    setProcessingFinancialId(id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', id));
      setFinancialEntries(prev => prev.filter(f => f.id !== id));
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento financeiro excluído para "${selectedPatient?.name}" (escrita real).` });
      showMessage('Lançamento excluído de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setProcessingFinancialId(null);
      setConfirmDeleteFinancialId(null);
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
    { id: 'planejamento', label: 'Planejamento', icon: Layers },
    { id: 'execucao', label: 'Execução', icon: PlayCircle },
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
                        {p.photoUrl ? (
                          <img src={p.photoUrl} alt={p.name} className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
                        ) : (
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs uppercase flex-shrink-0 ${style.avatar}`}>
                            {(p.name || '?').charAt(0)}
                          </div>
                        )}
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

                {fichaTarget.photoUrl ? (
                  <img src={fichaTarget.photoUrl} alt={fichaTarget.name} className="w-14 h-14 rounded-2xl object-cover mb-4" />
                ) : (
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg uppercase mb-4 ${colorFor(fichaTarget.name).avatar}`}>
                    {(fichaTarget.name || '?').charAt(0)}
                  </div>
                )}

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

        {/* PORTAL DO PACIENTE — link generation */}
        <AnimatePresence>
          {isPortalLinkModalOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsPortalLinkModalOpen(false)}>
              <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Link2 className="w-4 h-4 text-next-purple-neon" /> Portal do Paciente</h3>
                  <button onClick={() => setIsPortalLinkModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-[11px] text-slate-500 mb-4">Link individual seguro — não contém CPF, telefone nem o ID do paciente. Qualquer pessoa com o link acessa como {selectedPatient?.name}, então envie só para o paciente.</p>

                {generatingPortalLink ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Gerando link real...</div>
                ) : portalLinkError ? (
                  <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{portalLinkError}</p>
                ) : portalLink ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 bg-slate-900 border border-next-border rounded-lg px-3 py-2.5">
                      <input readOnly value={portalLink} className="flex-1 bg-transparent text-[11px] text-slate-300 font-mono outline-none" onFocus={(e) => e.currentTarget.select()} />
                      <button onClick={handleCopyPortalLink} className="text-slate-400 hover:text-next-purple-light flex-shrink-0" title="Copiar link">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {portalLinkCopied && <p className="text-[10.5px] text-next-green-success">Link copiado.</p>}
                    {waLink(selectedPatient?.phone) && (
                      <a
                        href={`${waLink(selectedPatient?.phone)}?text=${encodeURIComponent(`Olá ${selectedPatient?.name}! Acesse seu Portal do Paciente pelo link: ${portalLink}`)}`}
                        target="_blank" rel="noreferrer noopener"
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-next-green-success/15 hover:bg-next-green-success/25 border border-next-green-success/30 text-next-green-success font-bold text-xs rounded-xl"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Enviar por WhatsApp
                      </a>
                    )}
                  </div>
                ) : null}
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
                {selectedPatient.photoUrl ? (
                  <img src={selectedPatient.photoUrl} alt={selectedPatient.name} className="w-16 h-16 rounded-2xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-next-purple-neon/20 text-next-purple-light flex items-center justify-center font-black text-2xl uppercase flex-shrink-0">{(selectedPatient.name || '?').charAt(0)}</div>
                )}
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
                <button onClick={handleOpenPortalLinkModal} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-slate-300 bg-slate-900/70 hover:bg-slate-800 border border-next-border px-3 py-2 rounded-xl">
                  <Link2 className="w-3.5 h-3.5" /> Portal do Paciente
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

                  {(anamnesis?.chiefComplaint || anamnesis?.proceduresOfInterest || anamnesis?.submittedByPatient) && (
                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-3 border-next-purple-neon/30">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Smartphone className="w-4 h-4 text-next-purple-neon" /> Respondido pelo Paciente</h3>
                        {anamnesis?.submittedByPatient && (
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-next-purple-neon/10 border border-next-purple-neon/30 text-next-purple-light tracking-wider">
                            Portal do Paciente — {formatDate(anamnesis.submittedAt)}
                          </span>
                        )}
                      </div>
                      {anamnesis?.chiefComplaint && (
                        <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                          <p className="text-[9.5px] font-mono text-slate-500 uppercase">Queixa principal</p>
                          <p className="text-xs text-slate-200 mt-0.5">{anamnesis.chiefComplaint}</p>
                        </div>
                      )}
                      {anamnesis?.proceduresOfInterest && (
                        <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                          <p className="text-[9.5px] font-mono text-slate-500 uppercase">Procedimentos de interesse</p>
                          <p className="text-xs text-slate-200 mt-0.5">{anamnesis.proceduresOfInterest}</p>
                        </div>
                      )}
                      {anamnesis?.aiPreConsultSummary && (
                        <div className="space-y-2 pt-1">
                          <p className="text-[10px] font-mono text-next-purple-light uppercase tracking-wider flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Dossiê Pré-Consulta (IA)</p>
                          <p className="text-xs text-slate-300 leading-relaxed">{anamnesis.aiPreConsultSummary.summary}</p>
                          {anamnesis.aiPreConsultSummary.alerts.length > 0 && (
                            <div className="space-y-1.5">
                              {anamnesis.aiPreConsultSummary.alerts.map((a, i) => (
                                <div key={i} className={`p-2.5 rounded-lg border flex gap-2 items-start ${
                                  a.type === 'danger' ? 'bg-next-red-alert/10 border-next-red-alert/25' :
                                  a.type === 'warning' ? 'bg-amber-500/10 border-amber-500/25' :
                                  'bg-next-ia-blue/10 border-next-ia-blue/25'
                                }`}>
                                  {a.type === 'info' ? <Info className="w-3.5 h-3.5 text-next-ia-blue flex-shrink-0 mt-0.5" /> : <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${a.type === 'danger' ? 'text-next-red-alert' : 'text-amber-400'}`} />}
                                  <div>
                                    <p className={`text-[11px] font-bold ${a.type === 'danger' ? 'text-next-red-alert' : a.type === 'warning' ? 'text-amber-300' : 'text-next-ia-blue-light'}`}>{a.title}</p>
                                    <p className="text-[10.5px] text-slate-400 mt-0.5">{a.description}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {anamnesis.aiPreConsultSummary.suggestedFocus.length > 0 && (
                            <ul className="text-[11px] text-slate-400 list-disc list-inside space-y-0.5">
                              {anamnesis.aiPreConsultSummary.suggestedFocus.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}

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
                <div className="space-y-4">
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Receipt className="w-4 h-4 text-next-green-success" /> Aguardando confirmação</h3>
                  <p className="text-[10.5px] text-slate-500">Itens de orçamentos aprovados — confirmar aqui gera a evolução clínica correspondente.</p>
                  {pendingQuotationItems.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum item de orçamento aguardando confirmação.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {pendingQuotationItems.map(({ quotationId, itemIndex, item, quotationTitle }) => {
                        const key = `${quotationId}-${itemIndex}`;
                        const selectedExecutorUid = executionOverrides[key] ?? item.professionalUid ?? '';
                        return (
                          <div key={key} className="bg-slate-900/40 border border-next-border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-200 truncate">{item.description} <span className="text-slate-500 font-normal">· {quotationTitle}</span></p>
                                <p className="text-[10px] text-slate-500 font-mono truncate">{formatCurrency((item.value || 0) * (item.quantity || 1))}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <select
                                  value={selectedExecutorUid}
                                  onChange={(e) => setExecutionOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                                  title="Quem realizou o procedimento (pode ser diferente do profissional padrão do orçamento)"
                                  className="bg-slate-900 border border-next-border rounded-lg text-[10.5px] text-slate-300 px-2 py-1.5"
                                >
                                  <option value="">Quem realizou?</option>
                                  {clinicalProviders.map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                                </select>
                                <button
                                  onClick={() => handleConfirmQuotationItemExecution(quotationId, itemIndex)}
                                  disabled={!canExecuteClinical || confirmingItemKey === key}
                                  title={!canExecuteClinical ? 'Sua conta não está marcada como profissional clínico — não pode confirmar a realização de procedimentos.' : undefined}
                                  className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-green-success bg-next-green-success/10 border border-next-green-success/25 px-2.5 py-1.5 rounded-lg disabled:opacity-50 flex-shrink-0"
                                >
                                  {confirmingItemKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar realização
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={executionNotes[key] || ''}
                              onChange={(e) => setExecutionNotes(prev => ({ ...prev, [key]: e.target.value }))}
                              placeholder="Observações ou detalhes clínicos deste tratamento (opcional)..."
                              rows={2}
                              className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-300 px-2.5 py-2 resize-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!canExecuteClinical && pendingQuotationItems.length > 0 && (
                    <p className="text-[10.5px] text-amber-400/90 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Sua conta não está marcada como profissional clínico ("Atendimento Clínico" em Admin → Equipe) — não pode confirmar procedimentos como realizados.</p>
                  )}
                </div>
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
                                <button
                                  onClick={() => toggleEvolutionVisibility(item.treatmentId, item.id)}
                                  title={item.patientVisible ? 'Visível no Portal do Paciente — clique para ocultar' : 'Oculto no Portal do Paciente — clique para liberar'}
                                  className={`flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${item.patientVisible ? 'text-next-green-success border-next-green-success/30 bg-next-green-success/10' : 'text-slate-500 border-next-border bg-slate-900'}`}
                                >
                                  {item.patientVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                  {item.patientVisible ? 'Paciente vê' : 'Oculto'}
                                </button>
                              )}
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
                          {item.clinicalPlanRef && (
                            <button
                              onClick={() => openPlanningInline(item.clinicalPlanRef!.planningId)}
                              className="mt-2 flex items-center gap-2 bg-slate-950/60 border border-next-border rounded-lg p-2 hover:border-next-purple-neon/40 transition-colors w-full text-left"
                            >
                              {item.clinicalPlanRef.thumbnailBase64 ? (
                                <img src={item.clinicalPlanRef.thumbnailBase64} alt="Planejamento" className="w-10 h-10 rounded-md object-cover flex-shrink-0 bg-slate-900" />
                              ) : (
                                <div className="w-10 h-10 rounded-md bg-slate-900 flex items-center justify-center flex-shrink-0"><Brain className="w-4 h-4 text-next-purple-neon" /></div>
                              )}
                              <span className="text-[10.5px] font-bold text-next-purple-light">Ver planejamento{item.clinicalPlanRef.procedureName ? ` — ${item.clinicalPlanRef.procedureName}` : ''}</span>
                            </button>
                          )}
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <span className="text-[9.5px] text-slate-500">{item.professional ? `Por ${item.professional}` : ''}{item.updatedAt && !item.voided ? ' (Editado)' : ''}</span>
                            {item.voided && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500 bg-slate-800 border border-next-border px-1.5 py-0.5 rounded flex-shrink-0">Anulado em {formatDate(item.voidedAt)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </div>
              )}

              <AnimatePresence>
                {postOpPanel && (() => {
                  const liveEvolution = treatments.find(t => t.id === postOpPanel.treatmentId)?.evolutions?.find(e => e.id === postOpPanel.evolutionId);
                  const alreadySaved = !!liveEvolution?.postOpInstructions;
                  const alreadyReleased = !!liveEvolution?.postOpReleasedToPortal;
                  return (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPostOpPanel(null)}>
                      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg next-glass-panel rounded-next-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Sparkles className="w-4 h-4 text-next-purple-neon" /> Pós-operatório sugerido pela Eliza</h3>
                          <button onClick={() => setPostOpPanel(null)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-[10.5px] text-slate-500">Procedimento: <span className="text-slate-300 font-semibold">{postOpPanel.procedureDescription}</span></p>
                        <p className="text-[10.5px] text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Sugestão da IA — sempre revise e edite antes de salvar. Só aparece pro paciente depois de você liberar, abaixo.
                        </p>

                        {postOpLoadingDraft ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-xs">
                            <Loader2 className="w-4 h-4 animate-spin" /> Gerando sugestão...
                          </div>
                        ) : (
                          <textarea
                            value={postOpDraftText}
                            onChange={(e) => setPostOpDraftText(e.target.value)}
                            rows={6}
                            placeholder="Escreva as orientações de pós-operatório..."
                            className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 resize-none"
                          />
                        )}
                        {postOpError && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{postOpError}</p>}

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => generatePostOpDraft(postOpPanel.treatmentId, postOpPanel.evolutionId, postOpPanel.procedureDescription)}
                            disabled={postOpLoadingDraft}
                            className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-slate-300 bg-slate-800 border border-next-border px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                          >
                            <Sparkles className="w-3.5 h-3.5" /> Gerar novamente
                          </button>
                          <button
                            onClick={handleSavePostOpInstructions}
                            disabled={postOpSaving || postOpLoadingDraft || !postOpDraftText.trim()}
                            className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple disabled:opacity-60"
                          >
                            {postOpSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {alreadySaved ? 'Atualizar pós-operatório' : 'Salvar pós-operatório'}
                          </button>
                          <button
                            onClick={handleReleasePostOpToPortal}
                            disabled={postOpReleasing || !alreadySaved || alreadyReleased}
                            title={!alreadySaved ? 'Salve o pós-operatório primeiro' : undefined}
                            className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-green-success bg-next-green-success/10 border border-next-green-success/25 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                          >
                            {postOpReleasing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />} {alreadyReleased ? 'Liberado no Portal' : 'Liberar no portal'}
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>

              {/* PLANEJAMENTO — Planejamento IA embutido no Prontuário (2026-08-30):
                  atalho a mais, não substitui o item "Planejamento IA" do menu
                  lateral — reaproveita o mesmo componente/lógica 100%, só já
                  chega com este paciente selecionado (prefillPatientId), sem
                  precisar buscar de novo. */}
              {activeTab === 'planejamento' && selectedPatientId && (
                <NextPlanningAI
                  prefillPatientId={selectedPatientId}
                  prefillPlanningId={prefillPlanningIdForTab}
                  onPrefillConsumed={() => setPrefillPlanningIdForTab(null)}
                  onOpenRecord={() => setActiveTab('resumo')}
                  onGenerateQuotation={handlePlanningGenerateQuotation}
                  onSchedulePlanned={onSchedulePlanned}
                />
              )}

              {/* EXECUÇÃO — Planejamento → Execução */}
              {activeTab === 'execucao' && (
                <div className="space-y-4">
                  {!openExecution ? (
                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><PlayCircle className="w-4 h-4 text-next-purple-neon" /> Execução de Planejamentos</h3>
                      <p className="text-[10.5px] text-slate-500 leading-relaxed">Planejamento → Orçamento → Agendamento → Execução → Resultado. Aqui você registra o que foi realmente feito — nunca sobrescreve o planejamento, e agendar não significa executar.</p>
                      {!canExecuteClinical && (
                        <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 flex gap-2 items-start">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                          <p className="text-[10.5px] text-amber-300">Sua conta não está marcada como profissional clínico ("Atende") — você pode ver execuções já existentes, mas não pode iniciar ou confirmar uma. Peça ao administrador para habilitar isso na aba Equipe.</p>
                        </div>
                      )}
                      {loadingExecutions ? (
                        <div className="flex items-center gap-2 text-xs text-slate-500 py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                      ) : patientLinkedAppointments.length === 0 ? (
                        <p className="text-xs text-slate-500">Nenhum agendamento vinculado a um Planejamento IA para este paciente ainda. Em Planejamento IA, gere um orçamento e agende o procedimento planejado — o agendamento aparece aqui automaticamente.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {patientLinkedAppointments.map(appt => {
                            const exec = executionsByAppointment[appt.id];
                            return (
                              <div key={appt.id} className="flex items-center justify-between gap-2 bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-200 truncate">{appt.treatment || 'Consulta'}</p>
                                  <p className="text-[10px] text-slate-500 font-mono">{(appt.date || '').split('-').reverse().join('/')} {appt.time || ''}</p>
                                  {exec && (
                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border tracking-wider mt-1 inline-block ${exec.status === 'confirmed' ? 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' : 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue'}`}>
                                      {exec.status === 'confirmed' ? 'Execução confirmada' : 'Rascunho em andamento'}
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleExecutePlanning(appt)}
                                  disabled={startingExecutionApptId === appt.id || (!exec && !canExecuteClinical)}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg shadow-next-glow-purple disabled:opacity-50 flex-shrink-0"
                                >
                                  {startingExecutionApptId === appt.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                                  {exec ? 'Ver execução' : 'Executar planejamento'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <button onClick={closeExecutionPanel} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-slate-400 hover:text-slate-200">
                          <ArrowLeft className="w-3.5 h-3.5" /> Voltar para a lista
                        </button>
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border tracking-wider flex items-center gap-1 ${openExecution.status === 'confirmed' ? 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' : 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue'}`}>
                          {openExecution.status === 'confirmed' && <Lock className="w-2.5 h-2.5" />}
                          {openExecution.status === 'confirmed' ? 'Confirmada — imutável' : 'Rascunho'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* PLANEJADO */}
                        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Planejado — versão {openExecution.plannedSnapshot.versionNumber}</h4>
                            <button onClick={() => openPlanningInline(openExecution.planningId)} className="text-[9.5px] font-bold text-next-purple-light">Ver planejamento</button>
                          </div>
                          <p className="text-xs font-bold text-slate-200">{openExecution.plannedSnapshot.procedureName}</p>
                          {openExecution.plannedSnapshot.objective && (
                            <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">Objetivo</p>
                              <p className="text-xs text-slate-300 mt-0.5">{openExecution.plannedSnapshot.objective}</p>
                            </div>
                          )}
                          {openExecution.plannedSnapshot.clinicalEvaluation && (
                            <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">Avaliação clínica</p>
                              <p className="text-xs text-slate-300 mt-0.5">{openExecution.plannedSnapshot.clinicalEvaluation}</p>
                            </div>
                          )}
                          {openExecutionTemplate?.clinicalFields.filter(f => {
                            const v = openExecution.plannedSnapshot.structuredFields[f.key];
                            return v !== undefined && v !== '';
                          }).map(f => (
                            <div key={f.key} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">{f.label}</p>
                              <p className="text-xs text-slate-300 mt-0.5">{String(openExecution.plannedSnapshot.structuredFields[f.key])}</p>
                            </div>
                          ))}
                          {openExecutionCanvasImage && (
                            <div>
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase mb-1">Marcações planejadas</p>
                              <img src={openExecutionCanvasImage.url} alt="Planejado" className="w-full rounded-lg border border-next-border opacity-90" />
                            </div>
                          )}
                        </div>

                        {/* REALIZADO */}
                        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3 border-next-purple-neon/20">
                          <h4 className="text-[10px] font-mono uppercase tracking-wider text-next-purple-light">Realizado</h4>

                          {openExecutionTemplate && openExecutionTemplate.executionSafetyNotes.length > 0 && (
                            <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 space-y-1">
                              {openExecutionTemplate.executionSafetyNotes.map((note, i) => (
                                <p key={i} className="text-[10px] text-amber-300 flex gap-1.5 items-start"><AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />{note}</p>
                              ))}
                            </div>
                          )}

                          {openExecution.status === 'draft' && (
                            <button onClick={handleUsePlanAsBase} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-next-purple-neon/15 border border-next-purple-neon/30 text-next-purple-light font-bold text-[10.5px] rounded-lg">
                              <Wand2 className="w-3.5 h-3.5" /> Usar planejamento como base
                            </button>
                          )}

                          {openExecutionTemplate?.clinicalWorkspace ? (
                            <>
                              <ClinicalFichaPanel
                                template={openExecutionTemplate}
                                caseLabel={openExecution.plannedSnapshot.procedureName || openExecutionTemplate.templateId}
                                dateLabel={formatDate(openExecution.startedAt)}
                                professionalLabel={openExecution.startedByName}
                                headerFieldValues={execFieldsForm}
                                onHeaderFieldChange={openExecution.status === 'draft' ? (key, value) => setExecFieldsForm(v => ({ ...v, [key]: value })) : undefined}
                                points={execWorkspacePoints}
                                pointRecords={execPointRecords}
                                onPointRecordChange={openExecution.status === 'draft' ? (id, patch) => setExecPointRecords(v => ({ ...v, [id]: { ...(v[id] || { muscle: '', unidades: '', observacao: '' }), ...patch } })) : undefined}
                                onDeletePoint={openExecution.status === 'draft' ? (id) => setExecDeleteRequestedPointId(id) : undefined}
                                selectedPointId={execSelectedPointId}
                                onSelectPoint={setExecSelectedPointId}
                                observations={execObservations}
                                onObservationsChange={openExecution.status === 'draft' ? setExecObservations : undefined}
                                readOnly={openExecution.status === 'confirmed'}
                              />

                              {execUsingReferenceImage && (
                                <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                                  <p className="text-[10.5px] text-amber-400 font-bold">Imagem de referência — não é a foto da paciente.</p>
                                  <div className="flex items-center gap-3">
                                    {openExecutionTemplate.clinicalWorkspace?.anatomicalAssetUrlAlt && (
                                      <button type="button" onClick={() => setExecReferenceImageIsAlt(v => !v)} className="text-[10px] font-bold text-amber-300 underline whitespace-nowrap">
                                        {execReferenceImageIsAlt ? 'Ver versão feminina' : 'Ver versão masculina'}
                                      </button>
                                    )}
                                    {openExecution.status === 'draft' && (
                                      <>
                                        <input ref={execPhotoInputRef} type="file" accept="image/*" onChange={handleUploadExecutionPhoto} className="hidden" />
                                        <button type="button" onClick={() => execPhotoInputRef.current?.click()} disabled={uploadingExecPhoto}
                                          className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-300 underline whitespace-nowrap disabled:opacity-60">
                                          {uploadingExecPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                          {uploadingExecPhoto ? 'Enviando...' : 'Adicionar foto real'}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                              <DoseColorLegend rules={execWorkspacePrefs.colorRules} onChange={openExecution.status === 'draft' ? handleExecColorRulesChange : undefined} readOnly={openExecution.status === 'confirmed'} pointValueLabel={openExecutionTemplate.clinicalWorkspace?.pointValueLabel} />
                              {execEffectiveCanvasImageUrl && (
                                <div>
                                  <p className="text-[9.5px] font-mono text-slate-500 uppercase mb-1">Mapa de aplicação{execUsingReferenceImage ? '' : ' — foto real da paciente'}</p>
                                  <AcademyPlanningCanvas
                                    imageUrl={execEffectiveCanvasImageUrl}
                                    initialDrawingsJson={execStrokesJson || undefined}
                                    enabledTools={openExecutionTemplate.executionCanvasTools}
                                    onPointsChange={handleExecWorkspacePointsChange}
                                    selectedPointId={execSelectedPointId}
                                    onSelectPoint={setExecSelectedPointId}
                                    deleteRequestedPointId={execDeleteRequestedPointId}
                                    readOnly={openExecution.status === 'confirmed'}
                                    onSavePlanning={(drawingsJson, overlayPng) => { setExecStrokesJson(drawingsJson); if (overlayPng) setExecOverlayThumbnail(overlayPng); }}
                                    pointColorFor={execPointColorFor}
                                  />
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              {openExecutionTemplate && renderExecutionFields(openExecutionTemplate.executionFields, execFieldsForm, setExecFieldsForm, openExecution.status === 'confirmed')}

                              {openExecutionCanvasImage && openExecutionTemplate && openExecutionTemplate.executionCanvasTools.length > 0 && (
                                <div>
                                  <p className="text-[9.5px] font-mono text-slate-500 uppercase mb-1">Marcações efetivamente realizadas</p>
                                  {!showExecutionCanvas ? (
                                    <div className="space-y-2">
                                      <img src={execOverlayThumbnail || openExecutionCanvasImage.url} alt="Marcações realizadas" className="w-full rounded-lg border border-next-border" />
                                      {openExecution.status === 'draft' && (
                                        <button onClick={() => setShowExecutionCanvas(true)} className="text-[10.5px] font-bold text-next-purple-light">{execStrokesJson ? 'Editar marcações' : 'Abrir editor de marcações'}</button>
                                      )}
                                    </div>
                                  ) : (
                                    <AcademyPlanningCanvas imageUrl={openExecutionCanvasImage.url} initialDrawingsJson={execStrokesJson || undefined} onSavePlanning={handleSaveExecutionDrawing} onClose={() => setShowExecutionCanvas(false)} enabledTools={openExecutionTemplate.executionCanvasTools} />
                                  )}
                                </div>
                              )}

                              <div>
                                <label className="text-[10px] font-mono text-slate-500 uppercase">Observações</label>
                                <textarea disabled={openExecution.status === 'confirmed'} value={execObservations} onChange={(e) => setExecObservations(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none disabled:opacity-60" />
                              </div>
                            </>
                          )}
                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Intercorrências</label>
                            <textarea disabled={openExecution.status === 'confirmed'} value={execComplications} onChange={(e) => setExecComplications(e.target.value)} placeholder="Deixe em branco se não houve" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none disabled:opacity-60" />
                          </div>

                          {openExecution.status === 'draft' && canExecuteClinical && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button onClick={handleSaveExecutionDraft} disabled={savingExecutionDraft} className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 border border-next-border text-slate-200 font-bold text-xs rounded-xl disabled:opacity-60" style={{ minHeight: '38px' }}>
                                {savingExecutionDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Salvar rascunho
                              </button>
                              <button onClick={handleConfirmExecution} disabled={confirmingExecution} className="inline-flex items-center gap-1.5 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '38px' }}>
                                {confirmingExecution ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar execução
                              </button>
                            </div>
                          )}
                          {openExecution.status === 'confirmed' && (
                            <p className="text-[10px] text-slate-500 flex items-center gap-1.5"><Lock className="w-3 h-3 flex-shrink-0" /> Confirmada por {openExecution.confirmedByName} em {formatDate(openExecution.confirmedAt)} — não pode mais ser editada. Use um adendo abaixo para correções.</p>
                          )}
                        </div>
                      </div>

                      {executionComparison && (
                        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><GitCompare className="w-4 h-4 text-next-purple-neon" /> Planejado × Realizado</h4>
                          <p className="text-[10px] text-slate-500">Comparação objetiva por campo — nunca infere motivo; qualquer alteração documentada aparece nas observações ou num adendo.</p>

                          {(executionComparison.matched.length > 0 || executionComparison.changed.length > 0) && (
                            <div className="space-y-1.5">
                              {executionComparison.matched.map(item => (
                                <div key={item.key} className="flex items-center justify-between gap-2 bg-next-green-success/5 border border-next-green-success/20 rounded-lg p-2 text-[10.5px]">
                                  <span className="text-slate-300 font-semibold">{item.label}</span>
                                  <span className="text-next-green-success">Igual ao planejado — {String(item.plannedValue)}</span>
                                </div>
                              ))}
                              {executionComparison.changed.map(item => (
                                <div key={item.key} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2 text-[10.5px]">
                                  <p className="text-slate-300 font-semibold">{item.label}</p>
                                  <p className="text-slate-400">Planejado: {String(item.plannedValue)} → Realizado: {String(item.executedValue)}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {executionComparison.plannedOnly.length > 0 && (
                            <div>
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase mb-1">Planejado sem correspondente na execução</p>
                              {executionComparison.plannedOnly.map(item => (
                                <p key={item.key} className="text-[10.5px] text-slate-400">{item.label}: {String(item.plannedValue)}</p>
                              ))}
                            </div>
                          )}

                          {executionComparison.executionOnly.length > 0 && (
                            <div>
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase mb-1">Registrado na execução, sem equivalente no planejamento</p>
                              {executionComparison.executionOnly.map(item => (
                                <p key={item.key} className="text-[10.5px] text-slate-400">{item.label}: {String(item.executedValue)}</p>
                              ))}
                            </div>
                          )}

                          {executionComparison.matched.length === 0 && executionComparison.changed.length === 0 && executionComparison.plannedOnly.length === 0 && (
                            <p className="text-[10.5px] text-slate-500">Este procedimento não usa campos estruturados equivalentes entre planejamento e execução — compare visualmente pelas marcações no canvas e pelos textos acima.</p>
                          )}

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">Marcações planejadas</p>
                              <p className="text-sm font-bold text-slate-200">{(() => { try { return (JSON.parse(openExecution.plannedSnapshot.strokesJson || '{}').strokes || []).length; } catch { return 0; } })()}</p>
                            </div>
                            <div className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                              <p className="text-[9.5px] font-mono text-slate-500 uppercase">Marcações realizadas</p>
                              <p className="text-sm font-bold text-slate-200">{(() => { try { return (JSON.parse(execStrokesJson || '{}').strokes || []).length; } catch { return 0; } })()}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {openExecution.status === 'confirmed' && (
                        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><MessageSquarePlus className="w-4 h-4 text-next-purple-neon" /> Adendos / Correções</h4>
                          {loadingAddenda ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                          ) : executionAddenda.length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhum adendo registrado ainda.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {executionAddenda.map(a => (
                                <div key={a.id} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                                  <p className="text-xs text-slate-200">{a.text}</p>
                                  <p className="text-[9.5px] text-slate-500 mt-1">Por {a.createdByName} em {formatDate(a.createdAt)}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {canExecuteClinical && (
                            <div className="flex gap-2">
                              <input value={addendumText} onChange={(e) => setAddendumText(e.target.value)} placeholder="Descrever correção/complemento..." className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5" onKeyDown={(e) => { if (e.key === 'Enter') handleAddExecutionAddendum(); }} />
                              <button onClick={handleAddExecutionAddendum} disabled={savingAddendum || !addendumText.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50 flex-shrink-0">
                                {savingAddendum ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-[10px] font-mono text-slate-500 uppercase">Aprovados</p>
                          {quotations.filter(q => q.status === 'approved').length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhum orçamento aprovado ainda.</p>
                          ) : (
                            <div className="space-y-2">{quotations.filter(q => q.status === 'approved').map(renderQuotationCard)}</div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <p className="text-[10px] font-mono text-slate-500 uppercase">Aguardando aprovação</p>
                          {quotations.filter(q => q.status !== 'approved').length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhum orçamento aguardando aprovação.</p>
                          ) : (
                            <div className="space-y-2">{quotations.filter(q => q.status !== 'approved').map(renderQuotationCard)}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {isQuotationFormOpen && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setIsQuotationFormOpen(false); setPendingClinicalPlanRef(null); setQuotationBeingEditedId(null); }}>
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                        onClick={(e) => e.stopPropagation()}
                        className={`next-glass-panel rounded-next-2xl p-5 space-y-3 w-full ${showQuotationItemPicker ? 'max-w-5xl' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto`}
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-200">{quotationBeingEditedId ? 'Ver/Editar orçamento' : 'Novo orçamento'}</h4>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setIsAiPanelOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2.5 py-1.5 rounded-lg">
                              <Sparkles className="w-3.5 h-3.5" /> Pedir ajuda à Eliza
                            </button>
                            <button onClick={() => { setIsQuotationFormOpen(false); setPendingClinicalPlanRef(null); setQuotationBeingEditedId(null); }} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                          </div>
                        </div>

                        {pendingClinicalPlanRef && (
                          <p className="text-[10.5px] text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                            <Brain className="w-3.5 h-3.5 flex-shrink-0" /> Gerado a partir de um Planejamento IA — valores abaixo continuam por sua conta, revise antes de salvar.
                          </p>
                        )}

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

                        <div className={showQuotationItemPicker ? 'grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4 items-start' : ''}>
                        {showQuotationItemPicker && (
                          <div className="md:sticky md:top-0 md:max-h-[70vh] md:overflow-y-auto">
                            <NextQuotationItemPicker clinicId={clinic?.id} onSelect={handlePickCatalogItem} />
                          </div>
                        )}
                        <div className="space-y-2 min-w-0">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Itens</label>
                            <button onClick={() => setShowQuotationItemPicker(v => !v)} className="text-[10.5px] font-bold text-next-purple-light hover:text-next-purple-neon">
                              {showQuotationItemPicker ? 'ocultar catálogo' : '+ escolher do catálogo'}
                            </button>
                          </div>

                          {(() => {
                            const editingApprovedQuotation = quotationBeingEditedId ? quotations.find(q => q.id === quotationBeingEditedId && q.status === 'approved') : null;
                            return quotationItems.map((it, idx) => {
                              const linkedEntry = editingApprovedQuotation ? financialEntries.find(f => f.id === `q-${quotationBeingEditedId}-item-${idx}`) : undefined;
                              const isPaid = !!linkedEntry && (linkedEntry.paidAmount ?? 0) > 0;
                              // Item já recebido trava pra qualquer um — exceto Admin, que pode
                              // remanejar/corrigir mesmo assim (com aviso), sem que isso sincronize
                              // sozinho o lançamento já pago (ver syncFinancialEntriesForEditedItems).
                              const isLocked = isPaid && !isAdmin;
                              return (
                                <div key={idx} className="space-y-1.5 bg-slate-900/30 border border-next-border rounded-lg p-2">
                                  {isLocked && (
                                    <p className="text-[9.5px] text-amber-400/90 flex items-center gap-1"><Lock className="w-3 h-3 flex-shrink-0" /> Já recebido — valor travado</p>
                                  )}
                                  {isPaid && isAdmin && (
                                    <p className="text-[9.5px] text-amber-400/90 flex items-center gap-1"><Lock className="w-3 h-3 flex-shrink-0" /> Já recebido — como Admin você pode ajustar, mas o valor já recebido no Financeiro não muda sozinho; ajuste lá manualmente se precisar remanejar o pagamento.</p>
                                  )}
                                  <div className="flex flex-wrap gap-2 items-center">
                                    <input value={it.description} onChange={(e) => updateQuotationItem(idx, { description: e.target.value })} placeholder="Procedimento (ou digitar livremente)" className="flex-1 min-w-[140px] bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                                    <select
                                      value={it.procedureCategory || ''}
                                      onChange={(e) => updateQuotationItem(idx, { procedureCategory: (e.target.value || null) as ProcedureCategory | null })}
                                      title="Categoria clínica (taxonomia central da Eliza — opcional)"
                                      className="bg-slate-900 border border-next-border rounded-lg text-[11px] text-slate-400 px-2 py-2 max-w-[150px]"
                                    >
                                      <option value="">Categoria clínica (opcional)</option>
                                      {PROCEDURE_CATEGORY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                    <input type="number" disabled={isLocked} value={it.quantity} onChange={(e) => updateQuotationItem(idx, { quantity: Number(e.target.value) })} className="w-14 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-2 disabled:opacity-50" />
                                    <input type="number" disabled={isLocked} value={it.value} onChange={(e) => updateQuotationItem(idx, { value: Number(e.target.value) })} placeholder="R$" className="w-24 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-2 disabled:opacity-50" />
                                    {!editingApprovedQuotation && (
                                      <button onClick={() => setQuotationItems(prev => prev.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
                                    )}
                                  </div>
                                  <select
                                    value={it.professionalUid || ''}
                                    onChange={(e) => {
                                      const provider = clinicalProviders.find(p => p.uid === e.target.value);
                                      updateQuotationItem(idx, { professionalUid: provider?.uid || null, professionalName: provider?.name || null });
                                    }}
                                    className={`w-full bg-slate-900 border rounded-lg text-[11px] px-2.5 py-2 ${it.professionalUid ? 'border-next-border text-slate-300' : 'border-amber-500/60 text-amber-400'}`}
                                  >
                                    <option value="">{clinicalProviders.length === 0 ? 'Nenhum profissional com agenda liberada cadastrado' : 'Profissional responsável *'}</option>
                                    {clinicalProviders.map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                                  </select>
                                </div>
                              );
                            });
                          })()}
                          <button onClick={() => setQuotationItems(prev => [...prev, { description: '', value: 0, quantity: 1, ...defaultQuotationProfessional() }])} className="text-[10.5px] font-bold text-slate-400 hover:text-slate-200">+ adicionar item</button>

                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Observações</label>
                            <textarea value={quotationNotes} onChange={(e) => setQuotationNotes(e.target.value)} placeholder="Contexto clínico relevante para este orçamento (opcional)..." className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-16 resize-none mt-1" />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] font-mono text-slate-500 uppercase">Forma de pagamento (opcional)</label>
                              <select value={quotationPaymentMethod} onChange={(e) => setQuotationPaymentMethod(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                                <option value="">— não definido —</option>
                                {PAYMENT_METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-mono text-slate-500 uppercase">Parcelas (opcional)</label>
                              <input type="number" min={1} value={quotationInstallments} onChange={(e) => setQuotationInstallments(e.target.value)} placeholder="Ex: 3" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                            </div>
                          </div>

                          {quotationSaveError && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{quotationSaveError}</p>}

                          <div className="flex items-center justify-between pt-2 border-t border-next-border">
                            <span className="text-xs text-slate-400">Total: <strong className="text-next-purple-light">{formatCurrency(quotationTotal)}</strong></span>
                            <button onClick={handleSaveQuotation} disabled={savingQuotation} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                              {savingQuotation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              <span>{savingQuotation ? 'Gravando...' : quotationBeingEditedId ? 'Salvar alterações' : 'Salvar orçamento real'}</span>
                            </button>
                          </div>
                        </div>
                        </div>
                      </motion.div>
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
                          <button
                            onClick={() => img.patientVisible ? toggleImageVisibility(img) : openShareImageModal(img)}
                            title={img.patientVisible ? 'Visível no Portal do Paciente — clique para ocultar' : 'Compartilhar com o paciente'}
                            className={`absolute top-1.5 left-1.5 flex items-center gap-1 text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded border ${img.patientVisible ? 'text-next-green-success border-next-green-success/30 bg-slate-950/80' : 'text-slate-300 border-next-border bg-slate-950/80'}`}
                          >
                            {img.patientVisible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                            {!img.patientVisible && <span>Compartilhar</span>}
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

              <AnimatePresence>
                {shareImageTarget && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingShareImage && setShareImageTarget(null)}>
                    <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm next-glass-panel rounded-next-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Eye className="w-4 h-4 text-next-purple-neon" /> Compartilhar com o paciente</h3>
                        <button onClick={() => !savingShareImage && setShareImageTarget(null)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                      </div>
                      <img src={shareImageTarget.url} alt={shareImageTarget.title} className="w-full h-32 object-cover rounded-lg" />
                      <p className="text-[10.5px] text-slate-500">Título e descrição abaixo é o que o paciente vai ver no Portal — revise antes de compartilhar.</p>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Título</label>
                        <input value={shareImageForm.title} onChange={(e) => setShareImageForm(v => ({ ...v, title: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Descrição (opcional)</label>
                        <textarea value={shareImageForm.description} onChange={(e) => setShareImageForm(v => ({ ...v, description: e.target.value }))} rows={2} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 resize-none" />
                      </div>
                      <button onClick={handleConfirmShareImage} disabled={savingShareImage} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                        {savingShareImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{savingShareImage ? 'Compartilhando...' : 'Compartilhar com o paciente'}</span>
                      </button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* FINANCEIRO */}
              {activeTab === 'financeiro' && (() => {
                const totalRecebido = financialEntries.filter(f => f.status === 'paid').reduce((s, f) => s + (f.paidAmount ?? f.amount ?? 0), 0);
                const totalAReceber = financialEntries.filter(f => f.status !== 'paid' && f.status !== 'cancelled').reduce((s, f) => s + (f.pendingAmount ?? f.amount ?? 0), 0);
                const sorted = [...financialEntries].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
                const installmentPreview = (() => {
                  const n = Math.max(1, Math.min(24, Number(financialForm.installments) || 1));
                  const total = Number(financialForm.amount) || 0;
                  if (n <= 1 || !total) return null;
                  return `${n}x de ${formatCurrency(total / n)} (a cada ${financialForm.installmentIntervalDays} dias)`;
                })();
                return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="next-glass-panel rounded-next-2xl p-4">
                      <p className="text-[10px] font-mono text-slate-500 uppercase">Total Recebido</p>
                      <p className="text-lg font-black text-next-green-success">{formatCurrency(totalRecebido)}</p>
                    </div>
                    <div className="next-glass-panel rounded-next-2xl p-4">
                      <p className="text-[10px] font-mono text-slate-500 uppercase">Total a Receber</p>
                      <p className="text-lg font-black text-next-orange-insight">{formatCurrency(totalAReceber)}</p>
                    </div>
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Wallet className="w-4 h-4 text-next-purple-neon" /> Financeiro do paciente</h3>
                      <button onClick={() => setIsFinancialFormOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple">
                        <Plus className="w-3.5 h-3.5" /> Novo lançamento
                      </button>
                    </div>

                    {selectedFinancialIds.size > 0 && (() => {
                      const selectedEntries = sorted.filter(f => selectedFinancialIds.has(f.id));
                      const selectedTotal = selectedEntries.reduce((s, f) => s + (f.pendingAmount ?? f.amount), 0);
                      return (
                        <div className="bg-next-purple-neon/10 border border-next-purple-neon/30 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
                          <p className="text-[11px] font-bold text-next-purple-light">{selectedFinancialIds.size} selecionado{selectedFinancialIds.size === 1 ? '' : 's'} — Total: {formatCurrency(selectedTotal)}</p>
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setGroupActionMode('receive'); setGroupReceiveAmountInput(String(selectedTotal)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg">
                              <Check className="w-3.5 h-3.5" /> Receber/parcelar selecionados
                            </button>
                            <button onClick={() => { setSelectedFinancialIds(new Set()); setGroupActionMode(null); }} className="px-3 py-1.5 bg-slate-800 text-slate-300 font-bold text-[10.5px] rounded-lg">Limpar seleção</button>
                          </div>
                        </div>
                      );
                    })()}

                    <AnimatePresence>
                      {groupActionMode && (() => {
                        const selectedEntries = sorted.filter(f => selectedFinancialIds.has(f.id));
                        const selectedTotal = selectedEntries.reduce((s, f) => s + (f.pendingAmount ?? f.amount), 0);
                        const receiveVal = Number(groupReceiveAmountInput) || 0;
                        const overSaldo = receiveVal > selectedTotal + 0.005;
                        const installmentCount = Math.max(1, Math.min(24, Number(groupInstallmentCount) || 1));
                        return (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="bg-slate-900/60 border border-next-purple-neon/40 rounded-xl p-3 space-y-2.5 overflow-hidden">
                            <p className="text-[10px] font-mono text-slate-500 uppercase">Combinando: <span className="text-slate-300 normal-case font-sans">{selectedEntries.map(e => `${e.description} (${formatCurrency(e.pendingAmount ?? e.amount)})`).join(', ')}</span></p>
                            <div className="flex items-center gap-1 bg-slate-950 border border-next-border rounded-lg p-1 w-fit">
                              <button onClick={() => setGroupActionMode('receive')} className={`px-2.5 py-1.5 rounded-md text-[10.5px] font-bold ${groupActionMode === 'receive' ? 'next-brand-gradient-bg text-white' : 'text-slate-400'}`}>Receber pagamento</button>
                              <button onClick={() => setGroupActionMode('installments')} className={`px-2.5 py-1.5 rounded-md text-[10.5px] font-bold ${groupActionMode === 'installments' ? 'next-brand-gradient-bg text-white' : 'text-slate-400'}`}>Gerar parcelamento</button>
                            </div>
                            {groupActionMode === 'receive' ? (
                              <>
                                <p className="text-[10px] font-mono text-slate-500 uppercase">Saldo combinado: <span className="text-slate-300">{formatCurrency(selectedTotal)}</span></p>
                                <input type="number" value={groupReceiveAmountInput} onChange={(e) => setGroupReceiveAmountInput(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" placeholder="Valor recebido" />
                                {overSaldo && <p className="text-[10px] text-next-orange-insight">Valor maior que o saldo — será considerado o saldo total.</p>}
                                <button onClick={() => handleConfirmGroupPayment(selectedEntries, receiveVal)} disabled={savingGroupAction || receiveVal <= 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-60">
                                  {savingGroupAction ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar recebimento
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-500 uppercase">Parcelas</label>
                                    <input type="number" min={1} max={24} value={groupInstallmentCount} onChange={(e) => setGroupInstallmentCount(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-mono text-slate-500 uppercase">Intervalo (dias)</label>
                                    <input type="number" min={1} value={groupInstallmentIntervalDays} onChange={(e) => setGroupInstallmentIntervalDays(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                                  </div>
                                </div>
                                <p className="text-[10.5px] text-slate-500">{installmentCount}x de {formatCurrency(selectedTotal / installmentCount)}, total {formatCurrency(selectedTotal)}.</p>
                                <button onClick={() => handleGenerateInstallmentsFromSelected(selectedEntries, Number(groupInstallmentCount), Number(groupInstallmentIntervalDays))} disabled={savingGroupAction} className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-60">
                                  {savingGroupAction ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Gerar parcelamento
                                </button>
                              </>
                            )}
                            <button onClick={() => setGroupActionMode(null)} className="text-[10.5px] font-bold text-slate-400 hover:text-slate-200">Cancelar</button>
                          </motion.div>
                        );
                      })()}
                    </AnimatePresence>

                    {sorted.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum lançamento financeiro real para este paciente ainda.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {sorted.map(f => {
                          if (receivingFinancialId === f.id) {
                            const saldo = f.pendingAmount ?? f.amount;
                            const val = Number(receiveAmountInput) || 0;
                            const overSaldo = val > saldo + 0.005;
                            return (
                              <div key={f.id} className="bg-slate-900/60 border border-next-green-success/40 rounded-lg p-3 space-y-2.5">
                                <p className="text-[10px] font-mono text-slate-500 uppercase">Saldo em aberto: <span className="text-slate-300">{formatCurrency(saldo)}</span></p>
                                <input
                                  type="number"
                                  value={receiveAmountInput}
                                  onChange={(e) => setReceiveAmountInput(e.target.value)}
                                  max={saldo}
                                  className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2"
                                  placeholder="Valor recebido"
                                />
                                {overSaldo && <p className="text-[10px] text-next-orange-insight">Valor maior que o saldo — será considerado o saldo total.</p>}
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleConfirmFinancialReceived(f, val)}
                                    disabled={processingFinancialId === f.id || val <= 0}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-60"
                                  >
                                    {processingFinancialId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar recebimento
                                  </button>
                                  <button onClick={cancelReceiveFinancialEntry} className="px-3 py-1.5 bg-slate-800 text-slate-300 font-bold text-[10.5px] rounded-lg">Cancelar</button>
                                </div>
                              </div>
                            );
                          }
                          if (editingFinancialId === f.id) {
                            const isPaidEntry = f.status === 'paid';
                            return (
                              <div key={f.id} className="bg-slate-900/60 border border-next-purple-neon/40 rounded-lg p-3 space-y-2.5">
                                {isPaidEntry && (
                                  <p className="text-[9.5px] text-amber-400/90 flex items-center gap-1"><Lock className="w-3 h-3 flex-shrink-0" /> Já recebido — valor e status travados. Pra corrigir o valor recebido, cancele o recebimento (abaixo) e receba de novo com o valor certo.</p>
                                )}
                                <input value={financialEditForm.description} onChange={(e) => setFinancialEditForm(v => ({ ...v, description: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" placeholder="Descrição" />
                                <div className={`grid gap-2 ${isPaidEntry ? 'grid-cols-2' : 'grid-cols-4'}`}>
                                  {!isPaidEntry && (
                                    <input type="number" value={financialEditForm.amount} onChange={(e) => setFinancialEditForm(v => ({ ...v, amount: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-1.5" placeholder="Valor" />
                                  )}
                                  <input type="date" value={financialEditForm.date} onChange={(e) => setFinancialEditForm(v => ({ ...v, date: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-1.5" />
                                  {!isPaidEntry && (
                                    <select value={financialEditForm.status} onChange={(e) => setFinancialEditForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-1.5">
                                      <option value="pending">Pendente</option>
                                      <option value="partial">Parcial</option>
                                      <option value="paid">Pago</option>
                                      <option value="cancelled">Cancelado</option>
                                    </select>
                                  )}
                                  <select value={financialEditForm.paymentMethod} onChange={(e) => setFinancialEditForm(v => ({ ...v, paymentMethod: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2 py-1.5">
                                    <option value="PIX">PIX</option>
                                    <option value="Cartão">Cartão</option>
                                    <option value="Dinheiro">Dinheiro</option>
                                    <option value="Boleto">Boleto</option>
                                  </select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={handleSaveFinancialEdit} disabled={savingFinancialEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-60">
                                    {savingFinancialEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Salvar
                                  </button>
                                  <button onClick={cancelEditFinancialEntry} className="px-3 py-1.5 bg-slate-800 text-slate-300 font-bold text-[10.5px] rounded-lg">Cancelar</button>
                                </div>
                              </div>
                            );
                          }
                          const selectable = f.status !== 'paid' && f.status !== 'cancelled';
                          return (
                            <div key={f.id} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5 group space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                {selectable && (
                                  <input
                                    type="checkbox"
                                    checked={selectedFinancialIds.has(f.id)}
                                    onChange={(e) => setSelectedFinancialIds(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(f.id); else next.delete(f.id);
                                      return next;
                                    })}
                                    className="w-3.5 h-3.5 rounded flex-shrink-0"
                                    title="Selecionar pra pagamento/parcelamento agrupado"
                                  />
                                )}
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-200">
                                    {f.description}
                                    {f.installmentTotal && f.installmentTotal > 1 && (
                                      <span className="ml-1.5 text-[9px] font-mono text-next-purple-light bg-next-purple-neon/10 px-1.5 py-0.5 rounded">{f.installmentIndex}/{f.installmentTotal}</span>
                                    )}
                                  </p>
                                  <p className="text-[10px] text-slate-500">{formatDate(f.date)} • {f.paymentMethod}</p>
                                  {f.status === 'paid' && f.receivedByName && (
                                    <p className="text-[9.5px] text-slate-500">Recebido por {f.receivedByName}</p>
                                  )}
                                  {f.relatedEntries && f.relatedEntries.length > 0 && (
                                    <button onClick={() => setExpandedRelatedId(expandedRelatedId === f.id ? null : f.id)} className="text-[9.5px] font-bold text-next-purple-light hover:underline flex items-center gap-1 mt-0.5">
                                      <Link2 className="w-2.5 h-2.5" /> {expandedRelatedId === f.id ? 'Ocultar relação' : 'Ver relação'}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <p className="text-xs font-bold text-next-purple-light">{formatCurrency(f.amount)}</p>
                                  <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${f.status === 'paid' ? 'text-next-green-success bg-next-green-success/10' : f.status === 'cancelled' ? 'text-slate-500 bg-slate-800' : 'text-next-orange-insight bg-next-orange-insight/10'}`}>{f.status}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  {f.status !== 'paid' && f.status !== 'cancelled' && (
                                    <button onClick={() => startReceiveFinancialEntry(f)} disabled={processingFinancialId === f.id} title="Receber pagamento" className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 hover:text-next-green-success hover:border-next-green-success/40 border border-transparent flex items-center justify-center">
                                      {processingFinancialId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                    </button>
                                  )}
                                  {f.status === 'paid' && (
                                    confirmCancelReceiptId === f.id ? (
                                      <button onClick={() => handleCancelFinancialReceipt(f)} disabled={processingFinancialId === f.id} title="Confirmar cancelamento do recebimento" className="px-2 h-6 rounded-lg bg-amber-500/20 text-amber-400 text-[9px] font-bold flex items-center justify-center">
                                        {processingFinancialId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Cancelar?'}
                                      </button>
                                    ) : (
                                      <button onClick={() => setConfirmCancelReceiptId(f.id)} title="Cancelar recebimento (volta a pendente)" className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 border border-transparent flex items-center justify-center">
                                        <RotateCcw className="w-3 h-3" />
                                      </button>
                                    )
                                  )}
                                  <button onClick={() => startEditFinancialEntry(f)} title="Editar" className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 hover:text-next-purple-light hover:border-next-purple-neon/40 border border-transparent flex items-center justify-center">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  {confirmDeleteFinancialId === f.id ? (
                                    <button onClick={() => handleDeleteFinancialEntry(f.id)} disabled={processingFinancialId === f.id} title="Confirmar exclusão" className="px-2 h-6 rounded-lg bg-next-red-alert/20 text-next-red-alert text-[9px] font-bold flex items-center justify-center">
                                      {processingFinancialId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Excluir?'}
                                    </button>
                                  ) : (
                                    <button onClick={() => setConfirmDeleteFinancialId(f.id)} title="Excluir" className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 hover:text-next-red-alert hover:border-next-red-alert/40 border border-transparent flex items-center justify-center">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            {expandedRelatedId === f.id && f.relatedEntries && f.relatedEntries.length > 0 && (
                              <div className="bg-slate-950/60 border border-next-border rounded-lg p-2 space-y-1">
                                <p className="text-[9.5px] font-mono text-slate-500 uppercase">Procedimentos combinados neste lançamento</p>
                                {f.relatedEntries.map((r, i) => (
                                  <div key={i} className="flex items-center justify-between text-[10.5px]">
                                    <span className="text-slate-300">{r.description}</span>
                                    <span className="text-slate-400 font-mono">{formatCurrency(r.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            </div>
                          );
                        })}
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
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Valor total (R$)</label>
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
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Parcelas</label>
                            <input type="number" min={1} max={24} value={financialForm.installments} onChange={(e) => setFinancialForm(v => ({ ...v, installments: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                          </div>
                          <div>
                            <label className="text-[10px] font-mono text-slate-500 uppercase">Intervalo (dias)</label>
                            <input type="number" min={1} value={financialForm.installmentIntervalDays} onChange={(e) => setFinancialForm(v => ({ ...v, installmentIntervalDays: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                          </div>
                        </div>
                        {installmentPreview && (
                          <p className="text-[10.5px] text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-lg px-3 py-2">{installmentPreview} — vai gerar {financialForm.installments} lançamentos separados, cada um editável.</p>
                        )}
                        <button onClick={handleAddFinancialEntry} disabled={savingFinancial} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                          {savingFinancial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          <span>{savingFinancial ? 'Gravando...' : 'Salvar lançamento real'}</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                );
              })()}
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
