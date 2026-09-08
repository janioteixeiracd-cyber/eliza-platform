import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Brain, Search, Sparkles, AlertTriangle, Loader2, RefreshCw, CheckCircle2,
  ImageIcon, Eye, Stethoscope, User, Lightbulb, Layers, ArrowLeft, History, ExternalLink,
  Anchor, GitBranch, Activity, Puzzle, Shield, Scissors, Wrench, Baby, Send, MessageCircle, FileText,
  Receipt, CalendarPlus, ArrowRight, Upload,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { useSetElizaScreenContext } from '../context/ElizaAssistantContext';
import { useElizaAsk } from '../hooks/useElizaAsk';
import { secureGetDocs } from '../services/next-db';
import {
  collection, query, orderBy, limit, doc as fsDoc, getDoc, getDocs, addDoc, setDoc, updateDoc, arrayUnion, serverTimestamp, where,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import AcademyPlanningCanvas from './AcademyPlanningCanvas';
import ClinicalFichaPanel, { type WorkspacePoint, type PointRecord } from './ClinicalFichaPanel';
import DoseColorLegend from './DoseColorLegend';
import { PROCEDURE_CATEGORY_LABELS, type ProcedureCategory } from '../../lib/procedureTaxonomy';
import { getTemplateForId, DOCUMENT_TYPE_LABELS, type DocumentType, type ProcedureTemplate } from '../../lib/planningTemplates';
import { DEFAULT_DOSE_COLOR_PREFS, colorForDose, prefillPointRecord, type ToxinaWorkspacePrefs } from '../../lib/doseColorPrefs';
import NextFacialPlanning from './NextFacialPlanning';

interface PatientLite { id: string; name: string; birthDate?: string; phone?: string; }
interface GalleryImage { id: string; title: string; category: string; url: string; }
interface CatalogProcedure { id: string; procedureId: string; category: string; name: string; active: boolean; templateId?: string; defaultPrice?: number; }

// Keyed by outputSchema field — not by procedure, so any template's schema
// renders correctly. Both validated templates use STANDARD_ANALYSIS_SCHEMA
// today, so only these 5 keys ever actually hit the map; an unrecognized
// key from a future template's own schema still renders, just with the
// generic fallback icon/tone instead of a bespoke one.
const ANALYSIS_SECTION_STYLE: Record<string, { icon: React.ElementType; tone: string }> = {
  dadoClinico: { icon: Stethoscope, tone: 'text-slate-300 border-next-border bg-slate-900/40' },
  observacaoVisual: { icon: Eye, tone: 'text-cyan-300 border-cyan-500/25 bg-cyan-500/5' },
  informacaoProfissional: { icon: User, tone: 'text-slate-300 border-next-border bg-slate-900/40' },
  inferencia: { icon: Brain, tone: 'text-amber-300 border-amber-500/25 bg-amber-500/5' },
  sugestao: { icon: Lightbulb, tone: 'text-next-purple-light border-next-purple-neon/25 bg-next-purple-neon/5' },
};
const DEFAULT_SECTION_STYLE = { icon: FileText, tone: 'text-slate-300 border-next-border bg-slate-900/40' };

type AiAnalysis = Record<string, string[]>;

interface PlanImageRef { imageId: string; documentType: DocumentType; }

interface PlanVersionData {
  versionNumber: number;
  procedureId: string;
  procedureName: string;
  category: string;
  images: PlanImageRef[];
  structuredFields: Record<string, string | boolean>;
  // Clinical Learning Workspace (2026-08-29) — same shape as StudentAttempt/
  // ClinicalExecutionData.pointRecords. Optional/absent for templates
  // without `clinicalWorkspace` and for versions saved before this existed.
  pointRecords?: Record<string, { muscle: string; unidades: string; observacao: string }> | null;
  strokesJson: string;
  overlayThumbnailBase64?: string | null;
  objective: string;
  clinicalEvaluation: string;
  aiAnalysis: AiAnalysis | null;
  dataSufficiency: 'ok' | 'insufficient';
  caveats: string[];
  stage: 'planning' | 'executed' | 'result';
  professionalId: string;
  professionalName: string;
  createdAt?: any;
}

// Only Harmonização Orofacial and Implantodontia have a working template this
// round — the rest of the taxonomy is listed honestly as "em breve" — never
// a fake enabled button.
const ENABLED_AREAS: ProcedureCategory[] = ['harmonizacao_orofacial', 'implantodontia', 'dentistica_restauradora', 'endodontia', 'protese'];
const AREA_ORDER: ProcedureCategory[] = [
  'harmonizacao_orofacial', 'implantodontia', 'ortodontia', 'endodontia',
  'protese', 'periodontia', 'cirurgia_oral', 'dentistica_restauradora', 'odontopediatria',
];
const AREA_ICONS: Record<ProcedureCategory, React.ElementType> = {
  harmonizacao_orofacial: Sparkles, implantodontia: Anchor, ortodontia: GitBranch, endodontia: Activity,
  protese: Puzzle, periodontia: Shield, cirurgia_oral: Scissors, dentistica_restauradora: Wrench,
  odontopediatria: Baby, avaliacao: FileText, estetica_facial: Sparkles, outro: FileText,
};

function calcAge(birthDate?: string): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000)));
}

interface QuotationDraftPayload { patientId: string; title: string; items: { description: string; value: number; quantity: number; procedureCategory?: ProcedureCategory | null }[]; notes?: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string }; }
interface SchedulePlannedPayload { patientName: string; treatment: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string }; }

export default function NextPlanningAI({ prefillPatientId, prefillPlanningId, onPrefillConsumed, onOpenRecord, onGenerateQuotation, onSchedulePlanned, onOpenProcedureCatalog }: { prefillPatientId?: string | null; prefillPlanningId?: string | null; onPrefillConsumed?: () => void; onOpenRecord?: (patientId: string) => void; onGenerateQuotation?: (payload: QuotationDraftPayload) => void; onSchedulePlanned?: (payload: SchedulePlannedPayload) => void; onOpenProcedureCatalog?: () => void }) {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const { ask, ready: askReady } = useElizaAsk();

  const [showLegacy, setShowLegacy] = useState(false);

  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const selectedPatient = patients.find(p => p.id === selectedPatientId) || null;

  const [selectedArea, setSelectedArea] = useState<ProcedureCategory | null>(null);
  const [procedures, setProcedures] = useState<CatalogProcedure[]>([]);
  const [loadingProcedures, setLoadingProcedures] = useState(false);
  const [selectedProcedureId, setSelectedProcedureId] = useState<string | null>(null);
  const selectedProcedure = procedures.find(p => p.id === selectedProcedureId) || null;
  const template: ProcedureTemplate = useMemo(() => getTemplateForId(selectedProcedure?.templateId), [selectedProcedure]);

  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [imageDocTypes, setImageDocTypes] = useState<Record<string, DocumentType>>({});
  const [canvasImageId, setCanvasImageId] = useState<string | null>(null);

  const [structuredFields, setStructuredFields] = useState<Record<string, string | boolean>>({});
  const [objective, setObjective] = useState('');
  const [clinicalEvaluation, setClinicalEvaluation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [dataSufficiency, setDataSufficiency] = useState<'ok' | 'insufficient'>('ok');
  const [caveats, setCaveats] = useState<string[]>([]);

  const [strokesJson, setStrokesJson] = useState<string | undefined>(undefined);
  const [overlayThumbnail, setOverlayThumbnail] = useState<string | null>(null);
  const [showCanvas, setShowCanvas] = useState(false);

  // Clinical Learning Workspace (2026-08-29) — same point↔ficha mirroring
  // pattern as Academy/Execução, for templates that declare `clinicalWorkspace`.
  const [workspacePoints, setWorkspacePoints] = useState<WorkspacePoint[]>([]);
  const [pointRecords, setPointRecords] = useState<Record<string, PointRecord>>({});
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [deleteRequestedPointId, setDeleteRequestedPointId] = useState<string | null>(null);
  // Zonas de músculo fixas (2026-08-30): só resolve/pré-preenche para um
  // ponto GENUINAMENTE novo (id que ainda não tinha registro) — nunca
  // reescreve um ponto já existente, mesmo que o profissional tenha limpado
  // o campo de propósito.
  const handleWorkspacePointsChange = (points: WorkspacePoint[]) => {
    setWorkspacePoints(points);
    setPointRecords((v) => {
      const next: Record<string, PointRecord> = {};
      for (const p of points) {
        if (v[p.id]) { next[p.id] = v[p.id]; continue; }
        const prefill = prefillPointRecord(p, template.clinicalWorkspace?.muscleZones, workspacePrefs.muscleDefaults);
        next[p.id] = { muscle: prefill?.muscle || '', unidades: prefill?.unidades || '', observacao: '' };
      }
      return next;
    });
  };

  // Cor-por-dose + dose sugerida (2026-08-30) — preferência única por
  // clínica, compartilhada com Academy/Execução (ver doseColorPrefs.ts).
  // Sem doc gravado ainda → fica nos defaults em memória, nada é escrito até
  // o profissional editar a paleta pela primeira vez.
  const [workspacePrefs, setWorkspacePrefs] = useState<ToxinaWorkspacePrefs>(DEFAULT_DOSE_COLOR_PREFS);
  useEffect(() => {
    if (!clinic?.id) return;
    (async () => {
      try {
        const snap = await getDoc(fsDoc(db, 'clinics', clinic.id, 'settings', 'toxinaWorkspacePrefs'));
        if (snap.exists()) {
          const data = snap.data() as Partial<ToxinaWorkspacePrefs>;
          setWorkspacePrefs({
            colorRules: data.colorRules || DEFAULT_DOSE_COLOR_PREFS.colorRules,
            muscleDefaults: data.muscleDefaults || DEFAULT_DOSE_COLOR_PREFS.muscleDefaults,
          });
        }
      } catch (e) { console.error('Failed to load toxinaWorkspacePrefs:', e); }
    })();
  }, [clinic?.id]);
  const handleColorRulesChange = async (colorRules: ToxinaWorkspacePrefs['colorRules']) => {
    setWorkspacePrefs((v) => ({ ...v, colorRules }));
    if (!clinic?.id) return;
    try {
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'settings', 'toxinaWorkspacePrefs'), { colorRules }, { merge: true });
    } catch (e) { console.error('Failed to save toxinaWorkspacePrefs:', e); }
  };
  const pointColorFor = (pointId: string) => colorForDose(pointRecords[pointId]?.unidades, workspacePrefs.colorRules);

  // Fallback de imagem de referência (2026-08-30): sem foto de paciente
  // selecionada, usa a imagem anatômica aprovada do template (a mesma do
  // Academy) em vez de travar o mapa de pontos — sempre com etiqueta clara
  // de que não é a foto real, e alternável feminino/masculino quando o
  // template declara `anatomicalAssetUrlAlt`.
  const [referenceImageIsAlt, setReferenceImageIsAlt] = useState(false);

  // Upload direto de foto real (2026-08-31), pedido pelo usuário — quando
  // ainda não há foto da paciente, a profissional pode enviar uma agora
  // mesmo, sem sair da tela, em vez de precisar ir na aba Imagens antes.
  // Mesmo padrão já usado no Prontuário (base64 direto no Firestore, sem
  // Storage — ver handleFileSelected em NextMedicalRecord.tsx), teto de
  // 800KB. A foto enviada vira a imagem selecionada do canvas na hora.
  const referencePhotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingReferencePhoto, setUploadingReferencePhoto] = useState(false);
  const handleUploadReferencePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !clinic?.id || !selectedPatientId) return;
    if (file.size > 800000) { showMessage('Imagem muito grande — use arquivos menores que 800KB.', 'error'); return; }
    setUploadingReferencePhoto(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        const id = `img-${Date.now()}`;
        const payload = { title: file.name, category: 'Exame/Foto', description: '', url: base64, date: serverTimestamp() };
        await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images', id), payload);
        setGallery(prev => [{ id, title: payload.title, category: payload.category, url: base64 }, ...prev]);
        setCanvasImageId(id);
        setSelectedImageIds(prev => (prev.includes(id) ? prev : [...prev, id]));
        addAuditLog({ collection: 'images', action: 'WRITE', status: 'SUCCESS', details: `Imagem "${file.name}" adicionada ao prontuário de "${selectedPatient?.name}" (escrita real, via Planejamento IA).` });
      } catch (err: any) {
        showMessage(`Falha ao gravar imagem: ${err?.message || err}`, 'error');
      } finally {
        setUploadingReferencePhoto(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const [existingPlans, setExistingPlans] = useState<{ id: string; procedureId: string; procedureName: string; currentVersionNumber: number; updatedAt: any }[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [openPlanningId, setOpenPlanningId] = useState<string | null>(null);
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);

  // Planejamento → Orçamento/Agenda — the plan never stores a back-reference
  // array; whether "there's a quotation/appointment related to this plan" is
  // answered live by querying the other side's own clinicalPlanRef.planningId,
  // the same single source of truth used to build those documents in the
  // first place. Never marks the plan itself as executed.
  const [linkedQuotations, setLinkedQuotations] = useState<{ id: string; title: string; status: string; totalValue: number }[]>([]);
  const [linkedAppointments, setLinkedAppointments] = useState<{ id: string; date?: string; time?: string; status?: string }[]>([]);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  // `type` sempre opcional, default 'success' — só os call sites de falha
  // real passam 'error'. Corrige um bug real: toda mensagem (inclusive
  // "Falha ao gravar...") aparecia com o mesmo estilo verde de sucesso.
  function showMessage(msg: string, type: 'success' | 'error' = 'success') { setMessage({ text: msg, type }); setTimeout(() => setMessage(null), 5500); }

  // Antes, uma falha de permissão/rede em qualquer uma das buscas abaixo
  // (pacientes, galeria, catálogo, planos, orçamentos/agendamentos
  // vinculados, reabrir plano) só ia pro console — a tela parecia
  // "genuinamente vazia" sem diferença nenhuma pro usuário. Um banner
  // compartilhado torna a falha real visível, sem precisar de um estado de
  // erro dedicado por seção.
  const [loadError, setLoadError] = useState<string | null>(null);

  // Embedded Eliza chat — same /api/eliza/ask orchestrator the floating
  // assistant uses (via useElizaAsk), just rendered inline instead of as a
  // modal. Not a second AI system, a different casing of the same one.
  const [chatInput, setChatInput] = useState('');
  const [chatTurns, setChatTurns] = useState<{ question: string; summary: string; loading?: boolean; error?: string }[]>([]);
  const [chatSending, setChatSending] = useState(false);
  async function handleChatSend() {
    const question = chatInput.trim();
    if (!question || chatSending) return;
    setChatInput('');
    setChatSending(true);
    setChatTurns(prev => [...prev, { question, summary: '', loading: true }]);
    try {
      const answer = await ask(question, {
        screenType: 'planejamento',
        patientId: selectedPatient?.id || null,
        pageContext: { tabLabel: 'Planejamento IA', summary: selectedPatient ? `Caso aberto: ${selectedPatient.name}.${selectedProcedure ? ` Procedimento: ${selectedProcedure.name}.` : ''}` : '' },
      });
      setChatTurns(prev => prev.map((t, i) => i === prev.length - 1 ? { question, summary: answer.summary, loading: false } : t));
    } catch (err: any) {
      setChatTurns(prev => prev.map((t, i) => i === prev.length - 1 ? { question, summary: '', loading: false, error: err?.message || 'Falha ao responder.' } : t));
    } finally {
      setChatSending(false);
    }
  }

  useEffect(() => {
    async function loadPatients() {
      if (!clinic?.id) return;
      setLoadingPatients(true);
      try {
        const patRef = collection(db, 'clinics', clinic.id, 'patients');
        const patSnap = await secureGetDocs(query(patRef, limit(8000)), 'patients', { addAuditLog });
        setPatients(patSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load patients:', err);
        setLoadError('Falha ao carregar a lista de pacientes — tente recarregar a página.');
      } finally {
        setLoadingPatients(false);
      }
    }
    loadPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  // Deep link from the Evolução timeline ("Ver planejamento").
  useEffect(() => {
    if (prefillPatientId) setSelectedPatientId(prefillPatientId);
    if (prefillPlanningId) setOpenPlanningId(prefillPlanningId);
    if (prefillPatientId || prefillPlanningId) onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPatientId, prefillPlanningId]);

  const filteredPatients = useMemo(() => {
    if (!searchTerm) return patients;
    const s = searchTerm.toLowerCase();
    return patients.filter(p => p.name?.toLowerCase().includes(s));
  }, [patients, searchTerm]);

  useSetElizaScreenContext(
    'Planejamento IA',
    !selectedPatient ? '' : `Caso aberto: ${selectedPatient.name}.${selectedProcedure ? ` Procedimento: ${selectedProcedure.name}.` : ''}`,
    selectedPatient?.id || null
  );

  // Estado do RASCUNHO de plano em andamento — precisa ser limpo toda vez
  // que a área/procedimento muda, nunca só ao trocar de paciente. Bug real
  // corrigido aqui: os botões de área/procedimento nunca chamavam isto,
  // então trocar de procedimento com um plano já aberto continuava
  // salvando no MESMO `openPlanningId` — misturando, no histórico de
  // versões de um plano, dados de dois procedimentos diferentes.
  function resetPlanDraft() {
    setSelectedImageIds([]); setImageDocTypes({}); setCanvasImageId(null);
    setStructuredFields({}); setObjective(''); setClinicalEvaluation(''); setAnalysis(null); setAnalysisError(null);
    setStrokesJson(undefined); setOverlayThumbnail(null); setShowCanvas(false);
    setWorkspacePoints([]); setPointRecords({}); setSelectedPointId(null);
    setOpenPlanningId(null); setOpenVersionId(null);
  }

  function resetCase() {
    setSelectedArea(null); setProcedures([]); setSelectedProcedureId(null);
    setGallery([]);
    resetPlanDraft();
  }

  // Patient gallery — reused as-is, no new upload path for this vertical
  // slice (Storage doesn't exist for this project yet; see the audit).
  useEffect(() => {
    async function loadGallery() {
      if (!clinic?.id || !selectedPatientId) return;
      setLoadingGallery(true);
      try {
        const snap = await secureGetDocs<GalleryImage>(query(collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'images'), limit(60)), 'images', { addAuditLog });
        setGallery(snap.docs.map(d => ({ id: d.id, ...d.data() } as GalleryImage)));
      } catch (err) {
        console.error('Failed to load patient gallery:', err);
        setLoadError('Falha ao carregar a galeria de imagens do paciente.');
      } finally {
        setLoadingGallery(false);
      }
    }
    loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id, selectedPatientId]);

  useEffect(() => {
    async function loadPlans() {
      if (!clinic?.id || !selectedPatientId) { setExistingPlans([]); return; }
      setLoadingPlans(true);
      try {
        const snap = await getDocs(query(collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'clinical_plans'), orderBy('updatedAt', 'desc'), limit(20)));
        setExistingPlans(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load existing clinical plans:', err);
        setLoadError('Falha ao carregar os planejamentos já salvos deste paciente.');
      } finally {
        setLoadingPlans(false);
      }
    }
    loadPlans();
  }, [clinic?.id, selectedPatientId]);

  useEffect(() => {
    async function loadProcedures() {
      if (!clinic?.id || !selectedArea) { setProcedures([]); return; }
      setLoadingProcedures(true);
      try {
        const snap = await getDocs(query(collection(db, 'clinics', clinic.id, 'procedure_catalog'), where('category', '==', selectedArea), where('active', '==', true)));
        setProcedures(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load procedure catalog:', err);
        setLoadError('Falha ao carregar o catálogo de procedimentos desta área.');
      } finally {
        setLoadingProcedures(false);
      }
    }
    loadProcedures();
  }, [clinic?.id, selectedArea]);

  // Reopen an existing plan (from Evolução deep link or the list below) —
  // loads its latest version into the same editor, so saving creates a new
  // version instead of a brand new plan.
  useEffect(() => {
    async function loadPlanning() {
      if (!clinic?.id || !selectedPatientId || !openPlanningId) return;
      try {
        const planRef = fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'clinical_plans', openPlanningId);
        const planSnap = await getDoc(planRef);
        if (!planSnap.exists()) { showMessage('Planejamento não encontrado.', 'error'); return; }
        const planData: any = planSnap.data();
        const versionSnap = await getDoc(fsDoc(planRef, 'versions', planData.currentVersionId));
        if (!versionSnap.exists()) return;
        const v = versionSnap.data() as PlanVersionData & { imageIds?: string[] };
        setSelectedArea(v.category as ProcedureCategory);
        setSelectedProcedureId(v.procedureId);
        // `images` is the current shape; `imageIds` is a defensive fallback
        // for any version saved before this field existed.
        const imgs: PlanImageRef[] = Array.isArray(v.images) ? v.images : (v.imageIds || []).map(id => ({ imageId: id, documentType: 'fotografia_clinica' as DocumentType }));
        setSelectedImageIds(imgs.map(i => i.imageId));
        setImageDocTypes(Object.fromEntries(imgs.map(i => [i.imageId, i.documentType])));
        setCanvasImageId(imgs[0]?.imageId || null);
        setStructuredFields(v.structuredFields || {});
        setObjective(v.objective || '');
        setClinicalEvaluation(v.clinicalEvaluation || '');
        setAnalysis(v.aiAnalysis || null);
        setDataSufficiency(v.dataSufficiency || 'ok');
        setCaveats(v.caveats || []);
        setStrokesJson(v.strokesJson || undefined);
        setOverlayThumbnail(v.overlayThumbnailBase64 || null);
        setWorkspacePoints([]); setPointRecords(v.pointRecords || {}); setSelectedPointId(null);
        setOpenVersionId(planData.currentVersionId);
      } catch (err) {
        console.error('Failed to reopen clinical plan:', err);
        setLoadError('Falha ao reabrir este planejamento.');
      }
    }
    loadPlanning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id, selectedPatientId, openPlanningId]);

  // Whether "there's a quotation/appointment related to this plan" is
  // answered live from the other side's own clinicalPlanRef — no back-
  // reference array to keep in sync, no duplicated write path.
  useEffect(() => {
    async function loadLinked() {
      if (!clinic?.id || !selectedPatientId || !openPlanningId) { setLinkedQuotations([]); setLinkedAppointments([]); return; }
      try {
        const qSnap = await getDocs(query(collection(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'quotations'), where('clinicalPlanRef.planningId', '==', openPlanningId)));
        setLinkedQuotations(qSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load linked quotations:', err);
        setLoadError('Falha ao carregar os orçamentos vinculados a este plano.');
      }
      try {
        const aSnap = await getDocs(query(collection(db, 'clinics', clinic.id, 'appointments'), where('clinicalPlanRef.planningId', '==', openPlanningId)));
        setLinkedAppointments(aSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load linked appointments:', err);
        setLoadError('Falha ao carregar os agendamentos vinculados a este plano.');
      }
    }
    loadLinked();
  }, [clinic?.id, selectedPatientId, openPlanningId]);

  function handleGenerateQuotationClick() {
    if (!selectedPatient || !selectedProcedure || !openPlanningId || !openVersionId) return;
    onGenerateQuotation?.({
      patientId: selectedPatient.id,
      title: `Orçamento — ${selectedProcedure.name}`,
      items: [{ description: selectedProcedure.name, value: selectedProcedure.defaultPrice || 0, quantity: 1, procedureCategory: selectedArea }],
      notes: [objective.trim(), clinicalEvaluation.trim()].filter(Boolean).join(' | ') || undefined,
      clinicalPlanRef: { planningId: openPlanningId, versionId: openVersionId, procedureId: selectedProcedure.procedureId },
    });
  }

  function handleSchedulePlannedClick() {
    if (!selectedPatient || !selectedProcedure || !openPlanningId || !openVersionId) return;
    onSchedulePlanned?.({
      patientName: selectedPatient.name,
      treatment: selectedProcedure.name,
      clinicalPlanRef: { planningId: openPlanningId, versionId: openVersionId, procedureId: selectedProcedure.procedureId },
    });
  }

  function toggleImage(id: string) {
    setSelectedImageIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id);
        if (canvasImageId === id) setCanvasImageId(next[0] || null);
        return next;
      }
      if (prev.length >= 4) { showMessage('Selecione no máximo 4 imagens por análise.', 'error'); return prev; }
      if (prev.length === 0) setCanvasImageId(id);
      setImageDocTypes(dt => (dt[id] ? dt : { ...dt, [id]: template.documentTypes[0] }));
      return [...prev, id];
    });
  }

  function setStructuredField(key: string, value: string | boolean) {
    setStructuredFields(prev => ({ ...prev, [key]: value }));
  }

  async function handleAnalyze() {
    if (!clinic?.id || !selectedPatient || !selectedProcedure || !user) return;
    if (!objective.trim() && !clinicalEvaluation.trim()) { showMessage('Informe o objetivo ou a avaliação clínica.', 'error'); return; }
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const selectedImages = gallery.filter(g => selectedImageIds.includes(g.id));
      const idToken = await user.getIdToken();
      const res = await fetch('/api/eliza/planning-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          clinicId: clinic.id,
          patientId: selectedPatient.id,
          procedureId: selectedProcedure.procedureId,
          objective: objective.trim(),
          clinicalEvaluation: clinicalEvaluation.trim(),
          structuredFields,
          images: selectedImages.map(img => ({
            mimeType: img.url.split(';')[0]?.split(':')[1] || 'image/jpeg',
            dataBase64: img.url,
            documentType: imageDocTypes[img.id] || template.documentTypes[0],
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error || 'A Eliza não conseguiu analisar agora.');
      setAnalysis(data.analysis);
      setDataSufficiency(data.dataSufficiency);
      setCaveats(data.caveats || []);
      addAuditLog({ collection: 'ai_eliza_v2_planning_audit', action: 'WRITE', status: 'SUCCESS', details: `Análise de Planejamento IA (${selectedProcedure.name}) gerada para "${selectedPatient.name}" — IA multimodal real.` });
    } catch (err: any) {
      setAnalysisError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSaveDrawing(json: string, overlayBase64?: string) {
    setStrokesJson(json);
    setOverlayThumbnail(overlayBase64 || null);
    setShowCanvas(false);
    showMessage('Desenho salvo neste rascunho — clique em "Salvar Planejamento" para gravar de verdade.');
  }

  async function handleSavePlanning() {
    if (!clinic?.id || !selectedPatient || !selectedProcedure || !user) return;
    setSaving(true);
    try {
      const patientRoot = ['clinics', clinic.id, 'patients', selectedPatient.id] as const;
      let planningId = openPlanningId;
      let versionNumber = 1;
      const planRef = planningId ? fsDoc(db, ...patientRoot, 'clinical_plans', planningId) : fsDoc(collection(db, ...patientRoot, 'clinical_plans'));
      planningId = planRef.id;

      if (openPlanningId) {
        // Read the authoritative counter from Firestore rather than the local
        // `existingPlans` cache — that cache is only populated by a save that
        // happened earlier in this same session, so it's empty whenever a plan
        // is reopened via a deep link (e.g. the Evolução "Ver planejamento"
        // button), which would otherwise always mislabel the next save as v2.
        const existingSnap = await getDoc(planRef);
        const existingVersionNumber = existingSnap.exists() ? (existingSnap.data().currentVersionNumber as number | undefined) : undefined;
        versionNumber = (existingVersionNumber || 1) + 1;
      }

      const images: PlanImageRef[] = selectedImageIds.map(id => ({ imageId: id, documentType: imageDocTypes[id] || template.documentTypes[0] }));

      const versionData: PlanVersionData = {
        versionNumber,
        procedureId: selectedProcedure.procedureId,
        procedureName: selectedProcedure.name,
        category: selectedArea || '',
        images,
        structuredFields,
        pointRecords: template.clinicalWorkspace ? pointRecords : null,
        strokesJson: strokesJson || JSON.stringify({ strokes: [], textNotes: [] }),
        overlayThumbnailBase64: overlayThumbnail,
        objective: objective.trim(),
        clinicalEvaluation: clinicalEvaluation.trim(),
        aiAnalysis: analysis,
        dataSufficiency,
        caveats,
        // A new version is always a fresh planning pass — turning it into
        // "executado"/"resultado" is a separate, explicit action for later,
        // never implied just because the plan was edited again.
        stage: 'planning',
        professionalId: user.uid,
        professionalName: profile?.name || user.email || 'Profissional',
        createdAt: serverTimestamp(),
      };

      const versionRef = await addDoc(collection(planRef, 'versions'), versionData);

      const planPayload: Record<string, any> = {
        patientId: selectedPatient.id,
        procedureId: selectedProcedure.procedureId,
        procedureName: selectedProcedure.name,
        category: selectedArea,
        currentVersionId: versionRef.id,
        currentVersionNumber: versionNumber,
        updatedAt: serverTimestamp(),
      };
      // Firestore's setDoc rejects `undefined` field values outright, so
      // createdAt/createdBy are only included on the very first save —
      // never sent (not even as undefined) on later versions of the same plan.
      if (!openPlanningId) {
        planPayload.createdAt = serverTimestamp();
        planPayload.createdBy = user.uid;
      }
      await setDoc(planRef, planPayload, { merge: true });

      // Real Evolução entry — same treatments/evolutions pattern the rest of
      // the Prontuário already uses, so it shows up in the same timeline
      // staff already reads, with a thumbnail + link back to this plan.
      let treatmentId = 'gen-treat-planning';
      const treatmentsRef = collection(db, ...patientRoot, 'treatments');
      const treatmentSnap = await getDoc(fsDoc(treatmentsRef, treatmentId));
      if (!treatmentSnap.exists()) {
        await setDoc(fsDoc(treatmentsRef, treatmentId), { id: treatmentId, description: 'Prontuário Clínico Geral', professional: 'ELIZA NEXT', status: 'active', evolutions: [] });
      }
      const evolutionEntry = {
        id: `evo-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: `Planejamento IA — ${selectedProcedure.name} (versão ${versionNumber}).`,
        date: new Date().toISOString(),
        professional: profile?.name || user.email || 'Profissional',
        clinicalPlanRef: { planningId, versionId: versionRef.id, procedureName: selectedProcedure.name, thumbnailBase64: overlayThumbnail || null },
      };
      await updateDoc(fsDoc(treatmentsRef, treatmentId), { evolutions: arrayUnion(evolutionEntry) });

      addAuditLog({ collection: 'clinical_plans', action: 'WRITE', status: 'SUCCESS', details: `Planejamento IA (${selectedProcedure.name}, versão ${versionNumber}) salvo para "${selectedPatient.name}" (escrita real).` });
      showMessage(`Planejamento salvo — versão ${versionNumber}. Já aparece na Evolução do prontuário.`);
      setOpenPlanningId(planningId);
      setOpenVersionId(versionRef.id);
      setExistingPlans(prev => {
        const filtered = prev.filter(p => p.id !== planningId);
        return [{ id: planningId!, procedureId: selectedProcedure.procedureId, procedureName: selectedProcedure.name, currentVersionNumber: versionNumber, updatedAt: new Date() }, ...filtered];
      });
    } catch (err: any) {
      showMessage(`Falha ao salvar: ${err?.message || err}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const canvasImage = gallery.find(g => g.id === canvasImageId);
  const referenceImageUrl = template.clinicalWorkspace
    ? (referenceImageIsAlt ? template.clinicalWorkspace.anatomicalAssetUrlAlt || template.clinicalWorkspace.anatomicalAssetUrl : template.clinicalWorkspace.anatomicalAssetUrl)
    : null;
  const usingReferenceImage = !canvasImage && !!referenceImageUrl;
  const effectiveCanvasImageUrl = canvasImage?.url || referenceImageUrl || undefined;
  const age = calcAge(selectedPatient?.birthDate);

  if (showLegacy) {
    return (
      <div className="space-y-4">
        <button onClick={() => setShowLegacy(false)} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-next-purple-light hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao Planejamento IA
        </button>
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 text-[11px] text-amber-300">
          Versão anterior (Planejamento Facial) — mantida só para consultar planos já salvos. Novos planejamentos devem ser feitos no Planejamento IA.
        </div>
        <NextFacialPlanning />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl font-sans pb-24">
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative space-y-3 z-10">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
              <Brain className="w-3.5 h-3.5 text-next-purple-neon" />
              <span>PLANEJAMENTO IA</span>
            </div>
            <button onClick={() => setShowLegacy(true)} className="text-[10.5px] font-bold text-slate-500 hover:text-slate-300 flex items-center gap-1">
              <History className="w-3.5 h-3.5" /> Ver Planejamento Facial (legado)
            </button>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 tracking-tight font-sans">Planejamento Clínico Inteligente</h1>
          <p className="text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
            Paciente → área → procedimento → documentação e campos clínicos → análise real da Eliza (dado clínico, observação visual, inferência e sugestão sempre separados) → você desenha manualmente o plano. A decisão final é sempre sua.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="bg-next-red-alert/10 border border-next-red-alert/25 rounded-xl p-3 flex items-center justify-between gap-2 text-xs text-slate-200">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-next-red-alert flex-shrink-0" /> {loadError}</span>
          <button onClick={() => setLoadError(null)} className="text-slate-500 hover:text-slate-300 text-[10.5px] font-bold flex-shrink-0">Dispensar</button>
        </div>
      )}

      {message && (
        <div className={`rounded-xl p-3 flex items-center gap-2 text-xs text-slate-200 ${message.type === 'error' ? 'bg-next-red-alert/10 border border-next-red-alert/25' : 'bg-next-green-success/10 border border-next-green-success/20'}`}>
          {message.type === 'error' ? <AlertTriangle className="w-4 h-4 text-next-red-alert flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-next-green-success flex-shrink-0" />} {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        <div className="md:col-span-2 space-y-6">
          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200">1. Paciente</h3>
              {selectedPatient && <button onClick={() => { setSelectedPatientId(null); resetCase(); }} className="text-[10.5px] text-slate-500 hover:text-slate-300">trocar paciente</button>}
            </div>
            {!selectedPatient ? (
              <>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500"><Search className="w-3.5 h-3.5" /></span>
                  <input type="text" placeholder="Buscar paciente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-950 border border-next-border rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon" />
                </div>
                {loadingPatients ? (
                  <div className="text-center py-6 font-mono text-xs text-slate-500"><RefreshCw className="w-4 h-4 animate-spin mx-auto" /></div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
                    {filteredPatients.map(p => (
                      <button key={p.id} onClick={() => setSelectedPatientId(p.id)} className="text-left px-3 py-2 rounded-lg border text-xs font-semibold truncate bg-slate-900/50 border-next-border text-slate-300 hover:border-next-border-glow transition-colors">
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full next-brand-gradient-bg flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                    {selectedPatient.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-200">{selectedPatient.name}</p>
                    <p className="text-[10px] text-slate-500">{age !== null ? `${age} anos` : 'Idade não informada'}{selectedPatient.phone ? ` · ${selectedPatient.phone}` : ''}</p>
                  </div>
                </div>
                {onOpenRecord && (
                  <button onClick={() => onOpenRecord(selectedPatient.id)} className="text-[10.5px] font-bold text-next-purple-light hover:underline flex items-center gap-1 flex-shrink-0">
                    Ver ficha completa <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {selectedPatient && existingPlans.length > 0 && !openPlanningId && (
            <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><History className="w-4 h-4 text-next-purple-neon" /> Planejamentos existentes deste paciente</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {existingPlans.map(p => (
                  <button key={p.id} onClick={() => setOpenPlanningId(p.id)} className="text-left bg-slate-900/40 border border-next-border rounded-lg p-3 hover:border-next-purple-neon/40 transition-colors flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0"><Brain className="w-4 h-4 text-next-purple-neon" /></div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-200 truncate">{p.procedureName}</p>
                      <p className="text-[10px] text-slate-500">Versão {p.currentVersionNumber} · clique para reabrir</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedPatient && (
            <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-slate-200">2. Área de atuação</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {AREA_ORDER.map(area => {
                  const enabled = ENABLED_AREAS.includes(area);
                  const isActive = selectedArea === area;
                  const Icon = AREA_ICONS[area];
                  return (
                    <button
                      key={area}
                      disabled={!enabled}
                      onClick={() => { if (selectedArea !== area) { resetPlanDraft(); setSelectedArea(area); setSelectedProcedureId(null); } }}
                      className={`flex flex-col items-start gap-2 px-3 py-3 rounded-xl text-[11px] font-bold border transition-colors ${
                        isActive ? 'next-brand-gradient-bg text-white border-transparent'
                          : enabled ? 'bg-slate-900/60 border-next-border text-slate-300 hover:border-next-purple-neon/40'
                          : 'bg-slate-950/60 border-next-border/50 text-slate-600 cursor-not-allowed'
                      }`}
                      title={enabled ? undefined : 'Em breve'}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-left leading-tight">{PROCEDURE_CATEGORY_LABELS[area]}{!enabled && ' · em breve'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedArea && (
            <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-slate-200">3. Procedimento (Catálogo Clínico)</h3>
              {loadingProcedures ? (
                <div className="text-center py-4 font-mono text-xs text-slate-500"><RefreshCw className="w-4 h-4 animate-spin mx-auto" /></div>
              ) : procedures.length === 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500">Nenhum procedimento cadastrado ainda no catálogo para esta área.</p>
                  {onOpenProcedureCatalog && (
                    <button onClick={onOpenProcedureCatalog} className="text-[10.5px] font-bold text-next-purple-light hover:underline">
                      Cadastrar procedimento no Admin → Catálogo →
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {procedures.map(proc => (
                    <button key={proc.id} onClick={() => { if (selectedProcedureId !== proc.id) { resetPlanDraft(); setSelectedProcedureId(proc.id); } }} className={`px-3 py-2 rounded-lg text-[11px] font-bold border transition-colors ${selectedProcedureId === proc.id ? 'next-brand-gradient-bg text-white border-transparent' : 'bg-slate-900/60 border-next-border text-slate-300 hover:border-next-purple-neon/40'}`}>
                      {proc.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedProcedure && (
            <>
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-next-purple-neon" /> 4. Documentação (da galeria do paciente, até 4)</h3>
                {loadingGallery ? (
                  <div className="text-center py-4 font-mono text-xs text-slate-500"><RefreshCw className="w-4 h-4 animate-spin mx-auto" /></div>
                ) : gallery.length === 0 ? (
                  <p className="text-xs text-slate-500">Este paciente ainda não tem imagens na galeria (aba Imagens do Prontuário).</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {gallery.map(img => {
                      const isSelected = selectedImageIds.includes(img.id);
                      return (
                        <div key={img.id} className="space-y-1">
                          <button onClick={() => toggleImage(img.id)} className={`relative rounded-lg overflow-hidden border-2 aspect-square w-full ${isSelected ? 'border-next-purple-neon' : 'border-next-border'}`}>
                            <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
                            {isSelected && <div className="absolute inset-0 bg-next-purple-neon/25 flex items-center justify-center"><CheckCircle2 className="w-5 h-5 text-white" /></div>}
                          </button>
                          {isSelected && template.documentTypes.length > 1 && (
                            <select
                              value={imageDocTypes[img.id] || template.documentTypes[0]}
                              onChange={(e) => setImageDocTypes(prev => ({ ...prev, [img.id]: e.target.value as DocumentType }))}
                              className="w-full bg-slate-950 border border-next-border rounded text-[9px] text-slate-300 px-1 py-1"
                            >
                              {template.documentTypes.map(dt => <option key={dt} value={dt}>{DOCUMENT_TYPE_LABELS[dt]}</option>)}
                            </select>
                          )}
                          {isSelected && template.documentTypes.length === 1 && (
                            <p className="text-[9px] text-slate-500 text-center">{DOCUMENT_TYPE_LABELS[template.documentTypes[0]]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200">5. Objetivo e avaliação clínica</h3>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Objetivo do paciente</label>
                  <textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex: suavizar linhas de expressão em glabela, sem perder naturalidade..." className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-20 resize-none mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Avaliação clínica do profissional</label>
                  <textarea value={clinicalEvaluation} onChange={(e) => setClinicalEvaluation(e.target.value)} placeholder="Ex: tônus muscular elevado em terço superior, assimetria leve à direita..." className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-20 resize-none mt-1" />
                </div>

                {!template.clinicalWorkspace && template.clinicalFields.length > 0 && (
                  <div className="pt-2 border-t border-next-border space-y-3">
                    <p className="text-[10px] font-mono text-slate-500 uppercase">Campos clínicos — {selectedProcedure.name}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {template.clinicalFields.map(field => (
                        <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                          <label className="text-[10px] font-mono text-slate-500 uppercase">{field.label}</label>
                          {field.type === 'textarea' ? (
                            <textarea value={(structuredFields[field.key] as string) || ''} onChange={(e) => setStructuredField(field.key, e.target.value)} placeholder={field.placeholder} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-16 resize-none mt-1" />
                          ) : field.type === 'select' ? (
                            <select value={(structuredFields[field.key] as string) || ''} onChange={(e) => setStructuredField(field.key, e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                              <option value="">Selecionar...</option>
                              {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          ) : field.type === 'boolean' ? (
                            <div className="flex gap-2 mt-1">
                              {[{ v: true, l: 'Sim' }, { v: false, l: 'Não' }].map(opt => (
                                <button key={String(opt.v)} type="button" onClick={() => setStructuredField(field.key, opt.v)} className={`flex-1 py-2 rounded-lg text-[11px] font-bold border transition-colors ${structuredFields[field.key] === opt.v ? 'next-brand-gradient-bg text-white border-transparent' : 'bg-slate-900 border-next-border text-slate-400'}`}>
                                  {opt.l}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <input type="text" value={(structuredFields[field.key] as string) || ''} onChange={(e) => setStructuredField(field.key, e.target.value)} placeholder={field.placeholder} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={handleAnalyze} disabled={analyzing || (!objective.trim() && !clinicalEvaluation.trim())} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50">
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{analyzing ? `Analisando ${selectedImageIds.length} imagem(ns) com a Eliza...` : 'Analisar com Eliza IA'}</span>
                </button>
                <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> IA real e multimodal (analisa as imagens selecionadas de verdade, respeitando o tipo de cada uma). Nunca decide nem desenha nada sozinha.</p>
                {analysisError && <p className="text-[11px] text-next-red-alert">{analysisError}</p>}
              </div>

              {analysis && (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-200">Análise da Eliza</h3>
                    {dataSufficiency === 'insufficient' && <span className="text-[9.5px] font-bold text-amber-400 uppercase">Dados insuficientes p/ algumas conclusões</span>}
                  </div>
                  {template.outputSchema.map(section => {
                    const items = analysis[section.key];
                    if (!items || items.length === 0) return null;
                    const style = ANALYSIS_SECTION_STYLE[section.key] || DEFAULT_SECTION_STYLE;
                    const Icon = style.icon;
                    return (
                      <div key={section.key} className={`rounded-lg border p-3 ${style.tone}`}>
                        <p className="text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 mb-1.5"><Icon className="w-3.5 h-3.5" /> {section.label} <span className="font-normal normal-case opacity-70">— {section.hint}</span></p>
                        <ul className="space-y-1">
                          {items.map((it, i) => <li key={i} className="text-[11.5px] leading-relaxed">• {it}</li>)}
                        </ul>
                      </div>
                    );
                  })}
                  {caveats.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      {caveats.map((c, i) => <p key={i} className="text-[10px] text-slate-500 italic">⚠ {c}</p>)}
                    </div>
                  )}
                </div>
              )}

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Layers className="w-4 h-4 text-next-purple-neon" /> 6. Planejamento visual (manual)</h3>
                {selectedImageIds.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedImageIds.map(id => {
                      const img = gallery.find(g => g.id === id);
                      if (!img) return null;
                      return (
                        <button key={id} onClick={() => setCanvasImageId(id)} className={`w-12 h-12 rounded-lg overflow-hidden border-2 ${canvasImageId === id ? 'border-next-purple-neon' : 'border-next-border'}`}>
                          <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                )}
                {template.clinicalWorkspace ? (
                  // Stacked, never side-by-side — unlike Execução's Planejado|
                  // Realizado (which already halves the width before this even
                  // renders), this screen keeps a persistent Eliza IA chat
                  // column, so a side-by-side ficha+canvas squeezes the canvas
                  // to near-zero width on real laptop screens (confirmed while
                  // testing this 2026-08-29 — the canvas rendered at 0px).
                  <div className="space-y-4">
                    <ClinicalFichaPanel
                      template={template}
                      caseLabel={selectedProcedure.name}
                      dateLabel={new Date().toLocaleDateString('pt-BR')}
                      professionalLabel={profile?.name || user?.email || 'Profissional'}
                      headerFieldValues={structuredFields}
                      onHeaderFieldChange={(key, value) => setStructuredField(key, value)}
                      points={workspacePoints}
                      pointRecords={pointRecords}
                      onPointRecordChange={(id, patch) => setPointRecords(v => ({ ...v, [id]: { ...(v[id] || { muscle: '', unidades: '', observacao: '' }), ...patch } }))}
                      onDeletePoint={(id) => setDeleteRequestedPointId(id)}
                      selectedPointId={selectedPointId}
                      onSelectPoint={setSelectedPointId}
                      observations=""
                      hideObservations
                    />
                    {usingReferenceImage && (
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <p className="text-[10.5px] text-amber-400 font-bold">Imagem de referência — não é a foto da paciente.</p>
                        <div className="flex items-center gap-3">
                          {template.clinicalWorkspace?.anatomicalAssetUrlAlt && (
                            <button type="button" onClick={() => setReferenceImageIsAlt(v => !v)} className="text-[10px] font-bold text-amber-300 underline whitespace-nowrap">
                              {referenceImageIsAlt ? 'Ver versão feminina' : 'Ver versão masculina'}
                            </button>
                          )}
                          <input ref={referencePhotoInputRef} type="file" accept="image/*" onChange={handleUploadReferencePhoto} className="hidden" />
                          <button type="button" onClick={() => referencePhotoInputRef.current?.click()} disabled={uploadingReferencePhoto}
                            className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-300 underline whitespace-nowrap disabled:opacity-60">
                            {uploadingReferencePhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            {uploadingReferencePhoto ? 'Enviando...' : 'Adicionar foto real'}
                          </button>
                        </div>
                      </div>
                    )}
                    <DoseColorLegend rules={workspacePrefs.colorRules} onChange={handleColorRulesChange} pointValueLabel={template.clinicalWorkspace?.pointValueLabel} />
                    {effectiveCanvasImageUrl && (
                      <AcademyPlanningCanvas
                        imageUrl={effectiveCanvasImageUrl}
                        initialDrawingsJson={strokesJson}
                        enabledTools={template.canvasTools}
                        onPointsChange={handleWorkspacePointsChange}
                        selectedPointId={selectedPointId}
                        onSelectPoint={setSelectedPointId}
                        deleteRequestedPointId={deleteRequestedPointId}
                        onSavePlanning={(drawingsJson, overlayBase64) => { setStrokesJson(drawingsJson); setOverlayThumbnail(overlayBase64 || null); }}
                        pointColorFor={pointColorFor}
                      />
                    )}
                  </div>
                ) : !canvasImage ? (
                  <p className="text-xs text-slate-500">Selecione uma imagem acima para desenhar sobre ela.</p>
                ) : !showCanvas ? (
                  <div className="space-y-2">
                    <div className="relative w-full max-w-xs rounded-xl overflow-hidden border border-next-border">
                      <img src={canvasImage.url} alt={canvasImage.title} className="w-full" />
                      {overlayThumbnail && <img src={overlayThumbnail} alt="Overlay" className="absolute inset-0 w-full h-full" />}
                    </div>
                    <button onClick={() => setShowCanvas(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg">
                      <Brain className="w-3.5 h-3.5 text-next-purple-light" /> {strokesJson ? 'Editar desenho' : 'Abrir editor de desenho'}
                    </button>
                  </div>
                ) : (
                  <AcademyPlanningCanvas imageUrl={canvasImage.url} initialDrawingsJson={strokesJson} onSavePlanning={handleSaveDrawing} onClose={() => setShowCanvas(false)} enabledTools={template.canvasTools} />
                )}
                <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> Este desenho é uma marcação manual sobre a imagem — não é uma medida calibrada nem um valor clínico real.</p>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5">
                {/* Sem foto real do paciente ainda, o fallback de imagem de
                    referência (usingReferenceImage) existe justamente pra
                    esse caso — travar Salvar exigindo selectedImageIds
                    anulava o próprio fallback que o app já oferece. */}
                <button onClick={handleSavePlanning} disabled={saving || (!selectedImageIds.length && !usingReferenceImage)} className="inline-flex items-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {saving ? 'Salvando...' : openPlanningId ? 'Salvar nova versão' : 'Salvar Planejamento'}
                </button>
                <p className="text-[10px] text-slate-600 mt-2">Grava em clinics/{'{clinicId}'}/patients/{'{patientId}'}/clinical_plans/{'{planningId}'}/versions/{'{versionId}'} — cada salvamento cria uma versão nova, nunca apaga a anterior. Também registra uma Evolução real no Prontuário.</p>
              </div>

              {openPlanningId && openVersionId && (onGenerateQuotation || onSchedulePlanned) && (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                  <h3 className="text-xs font-bold text-slate-200">7. Orçamento e Agenda</h3>
                  <p className="text-[10px] text-slate-500 leading-relaxed">Planejamento → Orçamento → Agendamento → Execução → Resultado. Aqui você só cria os dois primeiros vínculos — nada disto marca este planejamento como executado.</p>
                  <div className="flex flex-wrap gap-2">
                    {onGenerateQuotation && (
                      <button onClick={handleGenerateQuotationClick} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg hover:border-next-purple-neon/40">
                        <Receipt className="w-3.5 h-3.5 text-next-purple-light" /> Gerar orçamento a partir deste planejamento <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    {onSchedulePlanned && (
                      <button onClick={handleSchedulePlannedClick} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg hover:border-next-purple-neon/40">
                        <CalendarPlus className="w-3.5 h-3.5 text-next-purple-light" /> Agendar procedimento planejado <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {(linkedQuotations.length > 0 || linkedAppointments.length > 0) && (
                    <div className="pt-2 border-t border-next-border space-y-2">
                      {linkedQuotations.map(q => (
                        <div key={q.id} className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-900/40 border border-next-border rounded-lg px-2.5 py-1.5">
                          <Receipt className="w-3.5 h-3.5 text-next-purple-light flex-shrink-0" />
                          <span className="flex-1">Orçamento "{q.title}" — {q.status === 'approved' ? 'aprovado' : q.status === 'rejected' ? 'rejeitado' : 'rascunho'}</span>
                        </div>
                      ))}
                      {linkedAppointments.map(a => (
                        <div key={a.id} className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-900/40 border border-next-border rounded-lg px-2.5 py-1.5">
                          <CalendarPlus className="w-3.5 h-3.5 text-next-purple-light flex-shrink-0" />
                          <span className="flex-1">Agendamento em {a.date} às {a.time} — {a.status || 'pendente'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="md:col-span-1 md:sticky md:top-4 space-y-4">
          <div className="next-glass-panel rounded-next-2xl p-5 flex flex-col h-80 md:h-96 lg:h-[520px]">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2 mb-3"><MessageCircle className="w-4 h-4 text-next-purple-neon" /> Eliza IA</h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {chatTurns.length === 0 ? (
                <div className="text-[11px] text-slate-400 leading-relaxed space-y-2">
                  <p>Estou aqui para apoiar no seu planejamento. Você pode perguntar sobre este paciente, este procedimento, ou pedir para eu explicar a análise acima — sempre com base em dados reais.</p>
                </div>
              ) : (
                chatTurns.map((t, i) => (
                  <div key={i} className="space-y-1.5">
                    <p className="text-[11px] font-bold text-slate-300 bg-slate-900/60 rounded-lg px-2.5 py-1.5">{t.question}</p>
                    {t.loading ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> Pensando...</div>
                    ) : t.error ? (
                      <p className="text-[11px] text-next-red-alert">{t.error}</p>
                    ) : (
                      <p className="text-[11px] text-slate-300 leading-relaxed bg-next-purple-neon/5 border border-next-purple-neon/15 rounded-lg px-2.5 py-1.5">{t.summary}</p>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2 pt-3 mt-2 border-t border-next-border">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleChatSend(); }}
                placeholder="Faça uma pergunta para a Eliza..."
                disabled={!askReady || chatSending}
                className="flex-1 bg-slate-950 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon disabled:opacity-50"
              />
              <button onClick={handleChatSend} disabled={!askReady || chatSending || !chatInput.trim()} className="p-2 next-brand-gradient-bg text-white rounded-lg disabled:opacity-40 flex-shrink-0">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
