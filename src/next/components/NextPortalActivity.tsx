import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, getDocs, addDoc, doc as fsDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { useSetElizaScreenContext } from '../context/ElizaAssistantContext';
import { logStatusEvent } from '../services/statusEvents';
import {
  Smartphone, Calendar, RotateCcw, Receipt, MessageCircle, ClipboardList,
  CheckCircle2, Loader2, ExternalLink, Clock, Link2, Send, ChevronRight, ArrowLeft,
  Sparkles, Check, X, Activity,
} from 'lucide-react';
import { COGNITIVE_GAP_LABELS } from '../constants/cognitiveGapLabels';

interface ThreadMessage { id: string; text: string; sender: 'patient' | 'staff' | 'ai'; createdAt: any; }
interface AiDraft { text: string; basedOnQuestion: string; }

interface PortalItem {
  id: string;
  type: string;
  title: string;
  description: string;
  patientId: string | null;
  patientName: string;
  status: string;
  createdAt: any;
  convertedTo?: { type: 'appointment' | 'quotation'; id: string; label: string } | null;
  // Only set on type === 'eliza_cognitive_gap' — the real sub-type the
  // Eliza Consciência engine detected (see COGNITIVE_GAP_LABELS). The raw
  // `type` is the same generic string for all 5 kinds, so the label has to
  // come from here, not from TYPE_META.
  cognitiveType?: string;
  // Only present on legacy `missing_clinical_evolution` items written by
  // the old ClinicalEvolutionMonitorService — that service never sets
  // title/description, so these back a synthesized description instead.
  professionalName?: string;
  dueDate?: any;
}

const TYPE_META: Record<string, { label: string; icon: React.ElementType }> = {
  patient_portal_schedule_request: { label: 'Horário', icon: Calendar },
  patient_portal_return_request: { label: 'Retorno', icon: RotateCcw },
  patient_portal_quotation_interest: { label: 'Orçamento', icon: Receipt },
  patient_portal_message: { label: 'Mensagem', icon: MessageCircle },
  patient_portal_anamnesis_submitted: { label: 'Anamnese', icon: ClipboardList },
  missing_clinical_evolution: { label: 'Evolução Pendente', icon: Activity },
  eliza_cognitive_gap: { label: 'Insight da Eliza', icon: Sparkles },
  agenda_delay_check: { label: 'Possível Atraso', icon: Calendar },
  agenda_follow_up: { label: 'Follow-up Agenda', icon: Calendar },
};

// Which Portal request types can plausibly turn into a real result the
// clinic tracks — only these get the "Vincular resultado" control. A
// message or an anamnesis submission doesn't "convert" into anything.
const LINKABLE_TYPES: Record<string, 'appointment' | 'quotation'> = {
  patient_portal_schedule_request: 'appointment',
  patient_portal_return_request: 'appointment',
  patient_portal_quotation_interest: 'quotation',
};

type PortalCategory = 'clinico' | 'financeiro' | 'agenda' | 'portal';

const CATEGORY_LABELS: Record<PortalCategory, string> = {
  clinico: 'Clínico',
  financeiro: 'Financeiro',
  agenda: 'Agenda',
  portal: 'Portal',
};

const COGNITIVE_TYPE_CATEGORY: Record<string, PortalCategory> = {
  finished_appointment_without_clinical_update: 'clinico',
  overdue_financial_risk: 'financeiro',
  stale_open_budgets: 'financeiro',
  recall_backlog: 'agenda',
  operational_pending_backlog: 'portal',
};

// Central de Tarefas mixes items from several origins (Portal do Paciente,
// a legacy clinical-evolution watcher, the Eliza Consciência engine) under
// one generic `type`/`status` shape — these three helpers are the single
// place that turns that raw shape into what a human actually reads.
function getItemCategory(item: PortalItem): PortalCategory {
  if (item.type === 'missing_clinical_evolution') return 'clinico';
  if (item.type === 'eliza_cognitive_gap') return COGNITIVE_TYPE_CATEGORY[item.cognitiveType || ''] || 'portal';
  if (item.type === 'agenda_delay_check' || item.type === 'agenda_follow_up') return 'agenda';
  return 'portal';
}

function getItemLabel(item: PortalItem): string {
  if (item.type === 'eliza_cognitive_gap') {
    return COGNITIVE_GAP_LABELS[item.cognitiveType || ''] || TYPE_META[item.type]?.label || item.type;
  }
  return TYPE_META[item.type]?.label || item.type;
}

function getItemContent(item: PortalItem): { title: string; description: string } {
  if (item.type === 'missing_clinical_evolution' && !item.title && !item.description) {
    return {
      title: 'Evolução clínica pendente',
      description: `Atendimento de ${item.patientName || 'paciente'} com ${item.professionalName || 'profissional não informado'} em ${formatAbsoluteDate(item.dueDate)} sem evolução registrada.`,
    };
  }
  return { title: item.title, description: item.description };
}

function toMs(v: any): number {
  if (!v) return 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const p = new Date(v).getTime();
  return isNaN(p) ? 0 : p;
}

function formatRelative(v: any): string {
  const ms = toMs(v);
  if (!ms) return '—';
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return 'ontem';
  return new Date(ms).toLocaleDateString('pt-BR');
}

function formatAbsoluteDate(v: any): string {
  const ms = toMs(v);
  if (!ms) return 'data não registrada';
  return new Date(ms).toLocaleDateString('pt-BR');
}

interface PatientGroup { key: string; patientId: string | null; patientName: string; items: PortalItem[]; pendingCount: number; lastAt: any; }

interface NextPortalActivityProps {
  onOpenRecord?: (patientId: string) => void;
  // 'portal' (default) only shows pending_items created by the Patient
  // Portal — the screen this component was originally built for. 'all' is
  // the general Central de Tarefas: every pending_item in the clinic
  // (Portal requests, Eliza AI's "criar tarefa" action, Agenda follow-ups,
  // etc.), same underlying collection and UI, just without the source
  // filter — so this one component serves both nav entries.
  scope?: 'portal' | 'all';
}

export default function NextPortalActivity({ onOpenRecord, scope = 'portal' }: NextPortalActivityProps) {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const [items, setItems] = useState<PortalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'done' | 'all'>('pending');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PortalCategory>('all');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null);
  const [linkCandidates, setLinkCandidates] = useState<{ id: string; label: string }[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [decidingDraft, setDecidingDraft] = useState(false);

  useEffect(() => {
    if (!clinic?.id) return;
    setLoading(true);
    const base = collection(db, 'clinics', clinic.id, 'pending_items');
    const q = scope === 'portal'
      ? query(base, where('source', '==', 'Portal do Paciente'), orderBy('createdAt', 'desc'), limit(200))
      : query(base, orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setLoading(false);
    }, (err) => {
      console.error('Failed to load pending_items activity:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [clinic?.id, scope]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? items : items.filter(i => (i.status || 'pending') === filter);
    if (scope === 'all' && categoryFilter !== 'all') list = list.filter(i => getItemCategory(i) === categoryFilter);
    return list;
  }, [items, filter, categoryFilter, scope]);

  const pendingCount = useMemo(() => items.filter(i => (i.status || 'pending') === 'pending').length, [items]);

  // Grouped by patient so a chatty conversation (or several requests from
  // the same person) doesn't flood the list — one card per patient, click
  // through to see everything that specific patient sent via the Portal.
  const groups = useMemo(() => {
    const map = new Map<string, PatientGroup>();
    for (const item of filtered) {
      // Tasks with no patient attached (e.g. the Eliza AI "criar tarefa"
      // action on a clinic-wide insight) all land in one shared bucket
      // instead of one group per null-name variant.
      const key = item.patientId || '_sem_paciente';
      let g = map.get(key);
      if (!g) {
        g = { key, patientId: item.patientId, patientName: item.patientId ? item.patientName : 'Tarefas gerais', items: [], pendingCount: 0, lastAt: item.createdAt };
        map.set(key, g);
      }
      g.items.push(item);
      if ((item.status || 'pending') === 'pending') g.pendingCount++;
      if (toMs(item.createdAt) > toMs(g.lastAt)) g.lastAt = item.createdAt;
    }
    return Array.from(map.values()).sort((a, b) => toMs(b.lastAt) - toMs(a.lastAt));
  }, [filtered]);

  const activeGroup = selectedKey ? groups.find(g => g.key === selectedKey) || null : null;

  useSetElizaScreenContext(
    scope === 'portal' ? 'Portal do Paciente' : 'Central de Tarefas',
    items.length === 0
      ? `Nenhuma ${scope === 'portal' ? 'atividade do Portal do Paciente' : 'tarefa'} registrada ainda.`
      : `${pendingCount} pendente(s) de ${items.length} no total. Últimas: ${items.slice(0, 5).map(i => `${i.patientName} — ${getItemLabel(i)}`).join('; ')}.`
  );

  const resolve = async (item: PortalItem) => {
    if (!clinic?.id) return;
    setResolvingId(item.id);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'pending_items', item.id), {
        status: 'done',
        resolvedAt: serverTimestamp(),
      });
      // `resolvedAt` above already lands on the doc, but the legacy Gestão
      // de Prioridades screen resolves items WITHOUT setting it — this
      // event is the one place resolution timing is guaranteed to be
      // recorded no matter which screen was used.
      logStatusEvent(clinic.id, {
        entityType: 'pending_item',
        entityId: item.id,
        eventType: 'pending_item_resolved',
        patientId: item.patientId,
        fromStatus: item.status,
        toStatus: 'done',
        metadata: { type: item.type, title: item.title },
      }, user?.uid);
      addAuditLog({ collection: 'pending_items', action: 'WRITE', status: 'SUCCESS', details: `Item do Portal do Paciente "${item.title}" marcado como concluído (escrita real).` });
    } catch (err) {
      console.error('Failed to resolve portal item:', err);
    } finally {
      setResolvingId(null);
    }
  };

  // Real-time thread for a patient_portal_message item — staff already has
  // Firestore access (unlike the patient, who goes through REST polling
  // because they have no Firebase account), so this is a genuine onSnapshot.
  useEffect(() => {
    if (!clinic?.id || !openThreadId) { setThreadMessages([]); setAiDraft(null); return; }
    const item = items.find(i => i.id === openThreadId);
    if (!item?.patientId) return;
    const convoRef = fsDoc(db, 'clinics', clinic.id, 'portal_conversations', item.patientId);
    const unsubMessages = onSnapshot(
      query(collection(convoRef, 'messages'), orderBy('createdAt', 'asc'), limit(200)),
      (snap) => setThreadMessages(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error('Failed to load portal conversation thread:', err)
    );
    // The AI never sends a learned/suggested answer on its own — it parks
    // it here (server.ts's /api/patient-portal/messages) until staff
    // approves or rejects it from this same panel.
    const unsubConvo = onSnapshot(convoRef, (snap) => {
      setAiDraft((snap.data() as any)?.pendingAiDraft || null);
    }, (err) => console.error('Failed to load portal conversation doc:', err));
    updateDoc(convoRef, { unreadByStaff: false }).catch(() => {});
    return () => { unsubMessages(); unsubConvo(); };
  }, [clinic?.id, openThreadId, items]);

  // Every real, manually-typed staff reply is captured as a learned Q&A
  // pair — this is the "memória" the Eliza portal AI prompt reads from on
  // future messages (server.ts), so answers she's already given for real
  // get reused as a *suggestion* next time, never sent without approval.
  const captureKnowledge = async (item: PortalItem, answer: string) => {
    if (!clinic?.id) return;
    const lastPatientMsg = [...threadMessages].reverse().find(m => m.sender === 'patient');
    if (!lastPatientMsg?.text) return;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'portal_ai_knowledge'), {
        question: lastPatientMsg.text,
        answer,
        patientName: item.patientName,
        createdBy: user?.uid || null,
        createdByName: profile?.name || 'Equipe',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to capture portal AI knowledge:', err);
    }
  };

  const sendReply = async (item: PortalItem) => {
    if (!clinic?.id || !item.patientId || !replyText.trim()) return;
    const value = replyText.trim();
    setSendingReply(true);
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'portal_conversations', item.patientId, 'messages'), {
        text: value, sender: 'staff', createdAt: serverTimestamp(),
      });
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'portal_conversations', item.patientId), {
        lastMessage: value, lastMessageAt: serverTimestamp(), lastMessageSender: 'staff', unreadByPatient: true, unreadByStaff: false,
      });
      setReplyText('');
      addAuditLog({ collection: 'portal_conversations', action: 'WRITE', status: 'SUCCESS', details: `Resposta enviada ao paciente ${item.patientName} pelo chat do Portal (escrita real).` });
      captureKnowledge(item, value);
    } catch (err) {
      console.error('Failed to send portal reply:', err);
    } finally {
      setSendingReply(false);
    }
  };

  const decideAiDraft = async (item: PortalItem, approve: boolean) => {
    if (!clinic?.id || !item.patientId || !aiDraft) return;
    setDecidingDraft(true);
    const convoRef = fsDoc(db, 'clinics', clinic.id, 'portal_conversations', item.patientId);
    try {
      if (approve) {
        await addDoc(collection(convoRef, 'messages'), { text: aiDraft.text, sender: 'ai', createdAt: serverTimestamp() });
        await updateDoc(convoRef, { lastMessage: aiDraft.text, lastMessageAt: serverTimestamp(), lastMessageSender: 'ai', unreadByPatient: true, pendingAiDraft: null });
        addAuditLog({ collection: 'portal_conversations', action: 'WRITE', status: 'SUCCESS', details: `Resposta sugerida pela IA aprovada e enviada a ${item.patientName} (escrita real).` });
      } else {
        await updateDoc(convoRef, { pendingAiDraft: null });
      }
    } catch (err) {
      console.error('Failed to decide on portal AI draft:', err);
    } finally {
      setDecidingDraft(false);
    }
  };

  // Explicit conversion link: staff picks a real appointment/quotation of
  // this same patient (created after the request) to confirm the Portal
  // request actually became that result — never inferred automatically,
  // only ever set by a human choosing it here.
  const openLinkPicker = async (item: PortalItem) => {
    if (!clinic?.id || !item.patientId) return;
    const kind = LINKABLE_TYPES[item.type];
    if (!kind) return;
    setLinkingItemId(item.id);
    setLinkCandidates([]);
    setLoadingCandidates(true);
    try {
      if (kind === 'appointment') {
        const snap = await getDocs(query(
          collection(db, 'clinics', clinic.id, 'appointments'),
          where('patientId', '==', item.patientId),
          limit(50)
        ));
        const createdAfter = toMs(item.createdAt);
        const candidates = snap.docs
          .map(d => ({ id: d.id, data: d.data() as any }))
          .filter(({ data }) => !createdAfter || toMs(data.createdAt) >= createdAfter - 60000)
          .map(({ id, data }) => ({ id, label: `${data.date || ''} ${data.time || ''} — ${data.status || ''}`.trim() }));
        setLinkCandidates(candidates);
      } else {
        const snap = await getDocs(query(collection(db, 'clinics', clinic.id, 'patients', item.patientId, 'quotations'), limit(50)));
        const createdAfter = toMs(item.createdAt);
        const candidates = snap.docs
          .map(d => ({ id: d.id, data: d.data() as any }))
          .filter(({ data }) => !createdAfter || toMs(data.createdAt) >= createdAfter - 60000)
          .map(({ id, data }) => ({ id, label: `${data.title || 'Orçamento'} — ${data.status || ''}` }));
        setLinkCandidates(candidates);
      }
    } catch (err) {
      console.error('Failed to load link candidates:', err);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const confirmLink = async (item: PortalItem, candidateId: string, candidateLabel: string) => {
    if (!clinic?.id) return;
    const kind = LINKABLE_TYPES[item.type];
    if (!kind) return;
    setConvertingId(item.id);
    try {
      const convertedTo = { type: kind, id: candidateId, label: candidateLabel };
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'pending_items', item.id), { convertedTo });
      logStatusEvent(clinic.id, {
        entityType: 'pending_item',
        entityId: item.id,
        eventType: 'pending_item_converted',
        patientId: item.patientId,
        metadata: { type: item.type, convertedToType: kind, convertedToId: candidateId, convertedToLabel: candidateLabel },
      }, user?.uid);
      addAuditLog({ collection: 'pending_items', action: 'WRITE', status: 'SUCCESS', details: `Solicitação do Portal "${item.title}" vinculada a ${kind === 'appointment' ? 'um agendamento' : 'um orçamento'} real (escrita real).` });
      setLinkingItemId(null);
    } catch (err) {
      console.error('Failed to link portal item:', err);
    } finally {
      setConvertingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-16 space-y-6 font-sans">
      <div className="relative next-glass-panel rounded-next-2xl p-6">
        <div className="absolute inset-0 overflow-hidden rounded-next-2xl pointer-events-none">
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
        </div>
        <div className="relative z-10">
          <h1 className="text-2xl font-extrabold tracking-tight next-brand-gradient-text flex items-center gap-2">
            {scope === 'portal' ? <Smartphone className="w-6 h-6 text-next-purple-neon" /> : <ClipboardList className="w-6 h-6 text-next-purple-neon" />}
            {scope === 'portal' ? 'Portal do Paciente' : 'Central de Tarefas'}
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            {scope === 'portal'
              ? <>Tudo que os pacientes fazem no Portal — solicitações, mensagens, interesse em orçamentos e anamneses — aparece aqui em tempo real, gravado de verdade em <code className="text-slate-500">pending_items</code>.</>
              : <>Toda pendência real da clínica num só lugar — solicitações do Portal do Paciente, tarefas criadas pela Eliza Consciência, follow-ups da Agenda — tudo gravado de verdade em <code className="text-slate-500">pending_items</code>.</>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-slate-900/60 border border-next-border rounded-xl p-1 w-fit">
        {([
          { id: 'pending', label: `Pendentes${pendingCount ? ` (${pendingCount})` : ''}` },
          { id: 'done', label: 'Concluídos' },
          { id: 'all', label: 'Todos' },
        ] as { id: 'pending' | 'done' | 'all'; label: string }[]).map(opt => (
          <button key={opt.id} onClick={() => setFilter(opt.id)} className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${filter === opt.id ? 'next-brand-gradient-bg text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {scope === 'all' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {([{ id: 'all', label: 'Todas' }, ...(Object.keys(CATEGORY_LABELS) as PortalCategory[]).map(id => ({ id, label: CATEGORY_LABELS[id] }))] as { id: 'all' | PortalCategory; label: string }[]).map(opt => (
            <button
              key={opt.id}
              onClick={() => setCategoryFilter(opt.id)}
              className={`px-2.5 py-1.5 rounded-full text-[10.5px] font-bold border transition-colors ${categoryFilter === opt.id ? 'bg-next-purple-neon/20 border-next-purple-neon/50 text-next-purple-light' : 'border-next-border text-slate-500 hover:text-slate-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="next-glass-panel rounded-next-2xl p-10 flex flex-col items-center gap-2">
          <Loader2 className="w-5 h-5 text-next-purple-neon animate-spin" />
          <span className="text-xs font-mono text-slate-500">Carregando atividade real do Portal...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="next-glass-panel rounded-next-2xl p-10 text-center">
          <Smartphone className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">{filter === 'pending' ? `Nenhuma pendência ${scope === 'portal' ? 'do Portal do Paciente' : ''} no momento.` : 'Nada por aqui ainda.'}</p>
        </div>
      ) : !activeGroup ? (
        <div className="space-y-2">
          {groups.map(g => (
            <button
              key={g.key}
              onClick={() => setSelectedKey(g.key)}
              className="w-full next-glass-panel rounded-xl p-4 flex items-center gap-3 text-left hover:border-next-purple-neon/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-next-purple-neon/15 text-next-purple-light flex items-center justify-center flex-shrink-0 font-black text-sm flex-shrink-0">
                {g.patientId ? (g.patientName || '?').charAt(0).toUpperCase() : <ClipboardList className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-200 truncate">{g.patientName}</p>
                <p className="text-[10.5px] text-slate-500 mt-0.5">{g.items.length} atividade{g.items.length === 1 ? '' : 's'} · última {formatRelative(g.lastAt)}</p>
              </div>
              {g.pendingCount > 0 && (
                <span className="text-[10px] font-black px-2 py-1 rounded-full bg-next-purple-neon/20 text-next-purple-light flex-shrink-0">{g.pendingCount}</span>
              )}
              <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 pb-1">
            <button onClick={() => setSelectedKey(null)} className="w-8 h-8 rounded-lg bg-slate-900 border border-next-border flex items-center justify-center text-slate-400 hover:text-slate-200 flex-shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-200 truncate">{activeGroup.patientName}</p>
              <p className="text-[10.5px] text-slate-500">{activeGroup.items.length} atividade{activeGroup.items.length === 1 ? '' : 's'}</p>
            </div>
            {activeGroup.patientId && onOpenRecord && (
              <button onClick={() => onOpenRecord(activeGroup.patientId!)} className="text-[10.5px] font-bold text-next-purple-light flex items-center gap-1 hover:underline flex-shrink-0">
                <ExternalLink className="w-3 h-3" /> Abrir prontuário
              </button>
            )}
          </div>
          {activeGroup.items.map(item => {
            const meta = TYPE_META[item.type] || { label: item.type, icon: Smartphone };
            const Icon = meta.icon;
            const label = getItemLabel(item);
            const content = getItemContent(item);
            const isDone = (item.status || 'pending') === 'done';
            return (
              <div key={item.id} className="next-glass-panel rounded-xl p-4 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-slate-800 text-slate-500' : 'bg-next-purple-neon/15 text-next-purple-light'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs font-bold text-slate-200 truncate">{content.title}</p>
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-next-border text-slate-500 flex-shrink-0">{label}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{content.description}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {formatRelative(item.createdAt)}</span>
                    {item.convertedTo ? (
                      <span className="text-[10px] font-bold text-next-green-success flex items-center gap-1">
                        <Link2 className="w-3 h-3" /> Vinculado: {item.convertedTo.label}
                      </span>
                    ) : LINKABLE_TYPES[item.type] && item.patientId && (
                      <button
                        onClick={() => openLinkPicker(item)}
                        className="text-[10px] font-bold text-slate-400 hover:text-next-purple-light flex items-center gap-1"
                      >
                        <Link2 className="w-3 h-3" /> Vincular resultado
                      </button>
                    )}
                    {item.type === 'patient_portal_message' && item.patientId && (
                      <button
                        onClick={() => setOpenThreadId(openThreadId === item.id ? null : item.id)}
                        className="text-[10px] font-bold text-slate-400 hover:text-next-purple-light flex items-center gap-1"
                      >
                        <MessageCircle className="w-3 h-3" /> {openThreadId === item.id ? 'Fechar conversa' : 'Ver conversa'}
                      </button>
                    )}
                  </div>

                  {openThreadId === item.id && (
                    <div className="mt-2 p-2.5 rounded-lg bg-slate-950/60 border border-next-border space-y-2">
                      <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                        {threadMessages.length === 0 ? (
                          <p className="text-[10px] text-slate-500">Carregando conversa...</p>
                        ) : threadMessages.map(m => (
                          <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[10.5px] leading-relaxed ${
                              m.sender === 'staff' ? 'next-brand-gradient-bg text-white'
                                : m.sender === 'ai' ? 'bg-next-purple-neon/10 text-slate-200 border border-next-purple-neon/25'
                                : 'bg-slate-800 text-slate-200'
                            }`}>
                              {m.sender === 'ai' && <p className="text-[8.5px] font-black uppercase text-next-purple-light mb-0.5">Eliza (IA)</p>}
                              {m.text}
                            </div>
                          </div>
                        ))}
                      </div>

                      {aiDraft && (
                        <div className="p-2.5 rounded-lg bg-next-purple-neon/10 border border-next-purple-neon/30 space-y-1.5">
                          <p className="text-[9px] font-black uppercase text-next-purple-light flex items-center gap-1"><Sparkles className="w-3 h-3" /> Eliza sugere esta resposta, baseada em algo parecido que a equipe já respondeu — aprove antes de enviar:</p>
                          <p className="text-[10.5px] text-slate-500 italic">Pergunta do paciente: "{aiDraft.basedOnQuestion}"</p>
                          <p className="text-[11px] text-slate-200 leading-relaxed">{aiDraft.text}</p>
                          <div className="flex items-center gap-2 pt-1">
                            <button onClick={() => decideAiDraft(item, true)} disabled={decidingDraft} className="inline-flex items-center gap-1 text-[10px] font-bold text-white next-brand-gradient-bg px-2.5 py-1.5 rounded-lg disabled:opacity-50">
                              {decidingDraft ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Aprovar e enviar
                            </button>
                            <button onClick={() => decideAiDraft(item, false)} disabled={decidingDraft} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg border border-next-border disabled:opacity-50">
                              <X className="w-3 h-3" /> Rejeitar
                            </button>
                          </div>
                        </div>
                      )}

                      <form onSubmit={(e) => { e.preventDefault(); sendReply(item); }} className="flex items-end gap-1.5">
                        <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={1} placeholder="Responder ao paciente..." className="flex-1 bg-slate-900 border border-next-border rounded-lg text-[10.5px] text-slate-200 px-2.5 py-2 resize-none" />
                        <button type="submit" disabled={sendingReply || !replyText.trim()} className="w-8 h-8 flex-shrink-0 inline-flex items-center justify-center next-brand-gradient-bg text-white rounded-lg disabled:opacity-50">
                          {sendingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3 h-3" />}
                        </button>
                      </form>
                    </div>
                  )}

                  {linkingItemId === item.id && (
                    <div className="mt-2 p-2.5 rounded-lg bg-slate-950/60 border border-next-border space-y-1.5">
                      <p className="text-[10px] text-slate-500">
                        {LINKABLE_TYPES[item.type] === 'appointment' ? 'Agendamentos reais' : 'Orçamentos reais'} de {item.patientName} criados depois desta solicitação — escolha o que corresponde a este pedido (confirmação manual, não é um vínculo automático):
                      </p>
                      {loadingCandidates ? (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Carregando...</p>
                      ) : linkCandidates.length === 0 ? (
                        <p className="text-[10px] text-slate-500">Nenhum candidato real encontrado ainda para este paciente.</p>
                      ) : (
                        <div className="space-y-1">
                          {linkCandidates.map(c => (
                            <button
                              key={c.id}
                              onClick={() => confirmLink(item, c.id, c.label)}
                              disabled={convertingId === item.id}
                              className="w-full text-left text-[10.5px] text-slate-300 bg-slate-900 hover:bg-slate-800 border border-next-border rounded-lg px-2.5 py-1.5 disabled:opacity-50"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <button onClick={() => setLinkingItemId(null)} className="text-[9.5px] text-slate-500 hover:text-slate-300 underline">cancelar</button>
                    </div>
                  )}
                </div>
                {!isDone ? (
                  <button
                    onClick={() => resolve(item)}
                    disabled={resolvingId === item.id}
                    className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-green-success bg-next-green-success/10 border border-next-green-success/25 px-2.5 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
                  >
                    {resolvingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Concluir
                  </button>
                ) : (
                  <span className="text-[9.5px] font-black uppercase text-next-green-success flex items-center gap-1 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> Feito</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
