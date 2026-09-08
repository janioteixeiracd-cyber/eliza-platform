import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Send, Loader2, Info, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { useElizaAssistantContext } from '../context/ElizaAssistantContext';
import { useElizaAsk } from '../hooks/useElizaAsk';
import { useElizaActions } from '../hooks/useElizaActions';
import InsightCard from './eliza/InsightCard';
import type { AssistantAnswer, ScreenType } from '../types/eliza';
import { COGNITIVE_GAP_LABELS } from '../constants/cognitiveGapLabels';

interface ProposalTurnState {
  proposalId: string;
  summary: string;
  details: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'failed';
}

interface ConversationTurn {
  question: string;
  answer?: AssistantAnswer;
  error?: string;
  patientId?: string | null;
  /** Set only for the "propose_clinical_evolution" flow (ELIZA Consciência
   *  Ativa) — a structured proposal awaiting human confirmation, rendered
   *  differently from a normal answer and never auto-executed. */
  proposal?: ProposalTurnState;
}

// Os 4 tipos "standing gap" (Fase 1, ver insightGapBridge.ts) são
// informativos com ação sugerida pronta — diferente do gap de atendimento,
// nunca esperam uma resposta livre do profissional, então nunca setam
// activeGapContext (isso já acontece naturalmente: eles nunca têm
// appointmentId).
const STANDING_GAP_TYPES = new Set(['overdue_financial_risk', 'stale_open_budgets', 'recall_backlog', 'operational_pending_backlog']);

// Tabs where a second AI surface would be redundant (already a full-screen
// AI chat) or where there's no meaningful clinic data to be "present" in.
const HIDDEN_ON_TABS = new Set(['eliza', 'designSystem', 'roadmap', 'qa', 'demo']);

// Which orchestrator screenType each Next tab maps to — this is the one
// place that decides "financeiro tab → prioritize financial insights",
// "prontuário/planejamento → this is about the open patient", so every tab
// gets the right priority without each screen reimplementing it.
const TAB_TO_SCREEN_TYPE: Record<string, ScreenType> = {
  home: 'home',
  financeiro: 'financeiro',
  prontuario: 'paciente',
  facialPlanning: 'planejamento',
};

const PORTAL_TYPE_LABELS: Record<string, string> = {
  patient_portal_schedule_request: 'Solicitação de horário pelo Portal do Paciente',
  patient_portal_return_request: 'Solicitação de retorno pelo Portal do Paciente',
  patient_portal_quotation_interest: 'Interesse em orçamento pelo Portal do Paciente',
  patient_portal_message: 'Mensagem recebida pelo Portal do Paciente',
  patient_portal_anamnesis_submitted: 'Anamnese respondida pelo Portal do Paciente',
};

export default function NextElizaAssistant({ activeTab }: { activeTab: string }) {
  const { screenContext, portalNotifications, consumePortalNotification, pendingClinicalProposal, consumePendingClinicalProposal } = useElizaAssistantContext();
  const { ask } = useElizaAsk();
  const { propose, approve, reject } = useElizaActions();
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // ELIZA Consciência Ativa: while set, the next free-text reply is routed
  // to propose_clinical_evolution instead of the generic /api/eliza/ask —
  // the professional is answering a specific cognitive gap, not asking a
  // question. Cleared once that proposal is approved/rejected, or the
  // person switches screens/starts a fresh conversation.
  const [activeGapContext, setActiveGapContext] = useState<{ gapId: string; appointmentId: string; patientId: string | null } | null>(null);
  // Human's pick among treatmentCandidates when a proposal's treatment
  // resolution came back "ambiguous" — keyed by turn index. Confirm stays
  // disabled for that turn until a choice is made; see the render block.
  const [treatmentSelections, setTreatmentSelections] = useState<Record<number, string>>({});
  // Presença ativa pros 4 novos "standing gaps": diferente de
  // activeGapContext (que exige resposta), estes só precisam ficar
  // visíveis até serem vistos — true quando um chega com o popup fechado,
  // limpo assim que o popup abre.
  const [hasUnseenStandingGap, setHasUnseenStandingGap] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, asking]);

  // Abrir o painel "vê" qualquer standing gap recém-chegado — limpa o sinal.
  useEffect(() => {
    if (isOpen) setHasUnseenStandingGap(false);
  }, [isOpen]);

  // Fresh conversation whenever the user switches screens — an answer
  // grounded in the Agenda's data would be misleading if carried into
  // Financeiro, so we don't pretend continuity across tabs.
  useEffect(() => {
    setTurns([]);
    setActiveGapContext(null);
  }, [screenContext.tabLabel]);

  // Achado B3-R fix: recover a proposal that was already "pending" (preview
  // shown, professional never clicked Confirmar/Cancelar) after a reload —
  // it never stopped existing in Firestore, only the in-memory conversation
  // that showed it was lost. Fires once, only into an empty conversation
  // (never overwrites something already on screen), and renders through the
  // exact same proposal-turn UI already used for a freshly-created one —
  // same proposalId, same preview, same Confirmar/Cancelar buttons. Scoped
  // to exactly the one proposal the context resolved (see
  // ElizaAssistantContext.tsx) — its own gapId/appointmentId/patientId, never
  // mixed with another conversation's.
  useEffect(() => {
    if (!pendingClinicalProposal) return;
    if (turns.length > 0) return;
    const p = pendingClinicalProposal;
    setIsOpen(true);
    setTurns([{
      question: COGNITIVE_GAP_LABELS['finished_appointment_without_clinical_update'] || 'Pendência detectada pela ELIZA',
      patientId: p.patientId,
      proposal: { proposalId: p.proposalId, summary: p.preview.summary, details: p.preview.details, status: 'pending' },
    }]);
    setActiveGapContext({ gapId: p.gapId, appointmentId: p.appointmentId, patientId: p.patientId });
    consumePendingClinicalProposal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClinicalProposal]);

  // Proactive trigger: a new pending_item from the Patient Portal pops the
  // assistant open with what already happened — no extra AI call, the
  // title/description saved by server.ts's patient-portal routes (which,
  // for anamnesis submissions, already embeds the AI dossiê summary) is the
  // answer.
  useEffect(() => {
    if (portalNotifications.length === 0) return;
    const next = portalNotifications[portalNotifications.length - 1];
    setIsOpen(true);

    if (next.type === 'eliza_cognitive_gap') {
      // Os 4 "standing gaps" (Fase 1) trazem o Insight completo já
      // calculado por insightEngine.ts — renderiza via InsightCard (ícone,
      // severidade, botão de ação) igual a uma resposta normal, nunca
      // esperando resposta livre. O gap original (atendimento sem
      // evolução) continua sem card sintético — a descrição já é a
      // mensagem real, e É essa a diferença: só ele seta
      // activeGapContext, porque só ele tem appointmentId.
      const isStandingGap = STANDING_GAP_TYPES.has(next.cognitiveType || '');
      setTurns(prev => [...prev, {
        question: COGNITIVE_GAP_LABELS[next.cognitiveType || ''] || 'Pendência detectada pela ELIZA',
        answer: {
          summary: next.description || next.title,
          insights: isStandingGap && next.insightSnapshot ? [next.insightSnapshot] : [],
          dataSufficiency: 'ok',
          caveats: [],
        },
        patientId: next.patientId,
      }]);
      if (next.appointmentId) {
        setActiveGapContext({ gapId: next.id, appointmentId: next.appointmentId, patientId: next.patientId });
      }
      if (isStandingGap && !isOpen) {
        setHasUnseenStandingGap(true);
      }
      consumePortalNotification(next.id);
      return;
    }

    setTurns(prev => [...prev, {
      question: PORTAL_TYPE_LABELS[next.type] || 'Chegou uma solicitação nova do Portal do Paciente',
      answer: {
        summary: next.description || next.title,
        insights: [{
          id: `portal-${next.id}`,
          category: 'pendencias',
          severity: 'atencao',
          basis: 'fato',
          title: next.title || 'Nova solicitação do Portal',
          description: next.description || '',
          evidence: { label: 'Origem', basis: 'fato', items: [{ id: next.id, label: next.patientName }] },
          recommendation: `Revisar e responder ${next.patientName} o quanto antes.`,
          priorityScore: 25,
          priorityFactors: ['requer atenção'],
        }],
        dataSufficiency: 'ok',
        caveats: [],
      },
      patientId: next.patientId,
    }]);
    consumePortalNotification(next.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalNotifications]);

  if (HIDDEN_ON_TABS.has(activeTab)) return null;

  // ELIZA Consciência Ativa: the professional's answer to a cognitive gap
  // is never a normal question — it goes through propose_clinical_evolution
  // (AI interprets + cross-checks the plan, never writes on its own), and
  // the result is a proposal awaiting explicit confirmation, not an answer.
  async function handleGapReply(gap: { gapId: string; appointmentId: string; patientId: string | null }, text: string) {
    setQuestion('');
    setAsking(true);
    setTurns(prev => [...prev, { question: text, patientId: gap.patientId }]);
    try {
      // Only gapId + the free-text answer go to the server — patientId/
      // appointmentId are re-derived there from the trusted pending_item
      // doc itself, never trusted from this client call.
      const result = await propose('propose_clinical_evolution', {
        gapId: gap.gapId,
        professionalResponse: text,
      });
      if (result.type === 'clarification') {
        // A question or an insufficient/ambiguous reply — never a proposal.
        // Rendered as a normal answered turn (no Confirmar/Cancelar), and
        // activeGapContext is deliberately left untouched so the next
        // message the professional types is still routed here, keeping the
        // same gap conversation going until a real description arrives.
        setTurns(prev => prev.map((t, i) => (i === prev.length - 1 ? {
          ...t,
          answer: { summary: result.message, insights: [], dataSufficiency: 'ok', caveats: [] },
        } : t)));
        return;
      }
      const { proposalId, preview } = result;
      setTurns(prev => prev.map((t, i) => (i === prev.length - 1 ? { ...t, proposal: { proposalId, summary: preview.summary, details: preview.details, status: 'pending' } } : t)));
    } catch (err: any) {
      setTurns(prev => prev.map((t, i) => (i === prev.length - 1 ? { ...t, error: err?.message || 'Não consegui interpretar essa resposta agora.' } : t)));
    } finally {
      setAsking(false);
    }
  }

  async function handleConfirmProposal(turnIndex: number, proposalId: string) {
    // Only ever sends selectedTreatmentId — the one override the server
    // whitelists — and only when the treatment resolution actually needed
    // a human pick (ambiguous). Never sent otherwise.
    const selectedTreatmentId = treatmentSelections[turnIndex];
    try {
      await approve(proposalId, selectedTreatmentId ? { selectedTreatmentId } : undefined);
      setTurns(prev => prev.map((t, i) => (i === turnIndex && t.proposal ? { ...t, proposal: { ...t.proposal, status: 'approved' } } : t)));
    } catch (err: any) {
      setTurns(prev => prev.map((t, i) => (i === turnIndex && t.proposal ? { ...t, proposal: { ...t.proposal, status: 'failed' }, error: err?.message || 'Falha ao gravar.' } : t)));
    } finally {
      setActiveGapContext(null);
    }
  }

  async function handleCancelProposal(turnIndex: number, proposalId: string) {
    try { await reject(proposalId); } catch { /* best-effort */ }
    setTurns(prev => prev.map((t, i) => (i === turnIndex && t.proposal ? { ...t, proposal: { ...t.proposal, status: 'rejected' } } : t)));
    setActiveGapContext(null);
  }

  async function handleAsk() {
    const q = question.trim();
    if (!q || asking) return;
    if (activeGapContext) {
      return handleGapReply(activeGapContext, q);
    }
    setQuestion('');
    setAsking(true);
    // Last few answered turns of THIS conversation — lets "esses horários"/
    // "esse paciente" resolve to what was just discussed (server.ts
    // systemPrompt rule 9). Built from state, not a separate history the
    // hook tracks, so it always matches exactly what's on screen.
    const conversationHistory = turns
      .filter((t) => t.answer)
      .slice(-3)
      .map((t) => ({ question: t.question, summary: t.answer!.summary }));
    setTurns(prev => [...prev, { question: q }]);
    try {
      const answer = await ask(q, {
        screenType: TAB_TO_SCREEN_TYPE[activeTab] || 'geral',
        patientId: screenContext.patientId,
        pageContext: { tabLabel: screenContext.tabLabel || activeTab, summary: screenContext.summary },
        conversationHistory,
      });
      setTurns(prev => prev.map((t, i) => (i === prev.length - 1 ? { ...t, answer, patientId: answer.resolvedPatientId || screenContext.patientId } : t)));
    } catch (err: any) {
      setTurns(prev => prev.map((t, i) => (i === prev.length - 1 ? { ...t, error: err?.message || 'Falha ao consultar a Eliza AI.' } : t)));
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(v => !v)}
        className="fixed z-40 w-14 h-14 rounded-full next-brand-gradient-bg text-white shadow-next-glow-purple-strong flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))', right: 'calc(1.5rem + env(safe-area-inset-right))' }}
        aria-label="Assistente Eliza"
        title="Pergunte à Eliza sobre esta tela"
      >
        <Sparkles className="w-6 h-6" />
        {/* Presença ativa: uma pendência cognitiva real aguardando resposta
            (o profissional fechou o popup antes de responder), OU um
            standing gap novo (risco financeiro, orçamento parado, recall,
            pendência operacional) ainda não visto. */}
        {(activeGapContext || hasUnseenStandingGap) && !isOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-next-red-alert border-2 border-white animate-pulse" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="fixed z-50 w-[400px] max-w-[calc(100vw-3rem)] h-[620px] max-h-[calc(100vh-8rem)] next-glass-panel rounded-next-2xl shadow-next-glow-purple-strong flex flex-col overflow-hidden"
              style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))', right: 'calc(1.5rem + env(safe-area-inset-right))' }}
            >
              <div className="relative overflow-hidden flex-shrink-0 p-4 border-b border-next-border">
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)' }} />
                </div>
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-xl next-brand-gradient-bg flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight">Eliza Intelligence</p>
                      <p className="text-[10px] text-slate-400 truncate">{screenContext.tabLabel || 'Contexto geral'} · dados cruzados em tempo real</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {turns.length > 0 && (
                      <button onClick={() => setTurns([])} title="Nova conversa" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                {turns.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4">
                    <Sparkles className="w-6 h-6 text-next-purple-neon mb-3" />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Pergunte algo real — a Eliza cruza agenda, financeiro, orçamentos, recall e pendências antes de responder.
                    </p>
                  </div>
                )}

                {turns.map((t, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] bg-slate-800/80 border border-next-border rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs text-slate-200">
                        {t.question}
                      </div>
                    </div>
                    {t.error && (
                      <div className="flex justify-start">
                        <div className="max-w-[85%] bg-next-red-alert/10 border border-next-red-alert/25 rounded-2xl rounded-tl-sm px-3.5 py-2 text-[11px] text-next-red-alert">
                          {t.error}
                        </div>
                      </div>
                    )}
                    {t.answer && (
                      <div className="flex justify-start">
                        <div className="max-w-[92%] w-full next-glass-panel rounded-2xl rounded-tl-sm p-3.5 space-y-2.5">
                          <p className="text-xs text-slate-200 leading-relaxed">{t.answer.summary}</p>
                          {t.answer.dataSufficiency === 'insufficient' && (
                            <p className="text-[10px] text-slate-500 italic flex items-center gap-1"><Info className="w-3 h-3" /> Dados insuficientes para uma conclusão completa.</p>
                          )}
                          {t.answer.periodComparison && (
                            <div className="rounded-lg border border-next-border bg-slate-900/60 px-2.5 py-2 text-[10.5px]">
                              <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1">Comparação de períodos (cálculo)</p>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-300">
                                <span>Receita {t.answer.periodComparison.currentMonth.from}→{t.answer.periodComparison.currentMonth.to}</span>
                                <span className="text-right font-mono">R$ {t.answer.periodComparison.currentMonth.receitaRecebida.toFixed(2)}</span>
                                <span>Receita mês anterior</span>
                                <span className="text-right font-mono">R$ {t.answer.periodComparison.previousMonth.receitaRecebida.toFixed(2)}</span>
                                <span>Atendimentos (atual vs anterior)</span>
                                <span className="text-right font-mono">{t.answer.periodComparison.currentMonth.atendimentos} vs {t.answer.periodComparison.previousMonth.atendimentos}</span>
                                <span className="font-bold">Δ Receita</span>
                                <span className={`text-right font-mono font-bold ${t.answer.periodComparison.deltaReceita < 0 ? 'text-next-red-alert' : 'text-next-green-success'}`}>
                                  R$ {t.answer.periodComparison.deltaReceita.toFixed(2)}{t.answer.periodComparison.deltaReceitaPct != null ? ` (${t.answer.periodComparison.deltaReceitaPct.toFixed(1)}%)` : ''}
                                </span>
                              </div>
                            </div>
                          )}
                          {t.answer.insights.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              {t.answer.insights.map((ins) => <InsightCard key={ins.id} insight={ins} />)}
                            </div>
                          )}
                          {t.answer.caveats.length > 0 && (
                            <div className="pt-1 space-y-0.5">
                              {t.answer.caveats.map((c, ci) => (
                                <p key={ci} className="text-[10px] text-slate-500 italic">⚠ {c}</p>
                              ))}
                            </div>
                          )}
                          {t.patientId && (
                            <button
                              onClick={() => window.open(`/next?tab=prontuario&patientId=${t.patientId}`, '_blank')}
                              className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 px-2.5 py-1.5 rounded-lg hover:bg-next-purple-neon/20"
                            >
                              Abrir prontuário do paciente
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {t.proposal && (
                      <div className="flex justify-start">
                        <div className="max-w-[92%] w-full next-glass-panel rounded-2xl rounded-tl-sm p-3.5 space-y-2.5 border-next-purple-neon/30">
                          <p className="text-[9px] font-black uppercase tracking-wider text-next-purple-light flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Proposta de evolução clínica — aguardando confirmação
                          </p>

                          {Array.isArray(t.proposal.details.proceduresUnderstoodAsDone) && t.proposal.details.proceduresUnderstoodAsDone.length > 0 && (
                            <div className="text-[11px]">
                              <p className="text-slate-400 font-bold mb-0.5">Entendi que hoje foi realizado:</p>
                              <ul className="space-y-0.5 pl-3">
                                {t.proposal.details.proceduresUnderstoodAsDone.map((p: string, pi: number) => (
                                  <li key={pi} className="text-slate-200">– {p}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="text-[11px]">
                            <p className="text-slate-400 font-bold mb-0.5">Vou registrar a seguinte evolução:</p>
                            <p className="text-xs text-slate-200 leading-relaxed bg-slate-900/60 rounded-lg px-2.5 py-2">{t.proposal.details.evolutionText}</p>
                          </div>

                          {t.proposal.details.plannedProcedureName && (
                            t.proposal.details.willMarkPlanCompleted ? (
                              // Strengthened per review: this consequence — a
                              // planned procedure being marked done — must be
                              // impossible to miss, not just a colored line
                              // mixed in with the rest of the text.
                              <div className="rounded-lg border border-next-green-success/40 bg-next-green-success/10 px-2.5 py-2">
                                <p className="text-[9px] font-black uppercase tracking-wider text-next-green-success mb-0.5">Esta proposta também marca um procedimento como realizado</p>
                                <p className="text-[11px] font-bold text-slate-100 flex items-center gap-1"><Check className="w-3.5 h-3.5 text-next-green-success flex-shrink-0" /> {t.proposal.details.plannedProcedureName}</p>
                              </div>
                            ) : (
                              <p className="text-[10.5px] leading-snug text-slate-400">O procedimento planejado "{t.proposal.details.plannedProcedureName}" não foi claramente confirmado — vai ficar pendente.</p>
                            )
                          )}

                          {Array.isArray(t.proposal.details.caveats) && t.proposal.details.caveats.length > 0 && (
                            <div className="space-y-0.5 pt-1 border-t border-next-border/60">
                              {t.proposal.details.caveats.map((c: string, ci: number) => (
                                <p key={ci} className="text-[10px] text-amber-400 italic flex items-start gap-1">
                                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" /> {c}
                                </p>
                              ))}
                            </div>
                          )}

                          {t.proposal.status === 'pending' && t.proposal.details.treatmentResolutionMode === 'ambiguous' && (
                            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 space-y-1.5">
                              <p className="text-[10px] font-bold text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0" /> Encontrei mais de uma ficha possível — escolha em qual devo registrar:</p>
                              <select
                                value={treatmentSelections[i] || ''}
                                onChange={(e) => setTreatmentSelections((prev) => ({ ...prev, [i]: e.target.value }))}
                                className="w-full bg-slate-900 border border-next-border rounded-lg text-[11px] text-slate-200 px-2 py-1.5"
                              >
                                <option value="">Selecione uma ficha...</option>
                                {(t.proposal.details.treatmentCandidates || []).map((c: { id: string; description: string }) => (
                                  <option key={c.id} value={c.id}>{c.description}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {t.proposal.status === 'pending' && (
                            <div className="flex gap-1.5 pt-1">
                              <button
                                onClick={() => handleConfirmProposal(i, t.proposal!.proposalId)}
                                disabled={t.proposal.details.treatmentResolutionMode === 'ambiguous' && !treatmentSelections[i]}
                                className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg next-brand-gradient-bg text-white disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Check className="w-3 h-3" /> Confirmar e gravar
                              </button>
                              <button
                                onClick={() => handleCancelProposal(i, t.proposal!.proposalId)}
                                className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-next-border text-slate-400 hover:text-slate-200"
                              >
                                <X className="w-3 h-3" /> Cancelar
                              </button>
                            </div>
                          )}
                          {t.proposal.status === 'approved' && (
                            <p className="text-[10.5px] font-bold text-next-green-success flex items-center gap-1 pt-1"><Check className="w-3 h-3" /> Gravado e auditado.</p>
                          )}
                          {t.proposal.status === 'rejected' && (
                            <p className="text-[10.5px] text-slate-500 italic pt-1">Cancelado — nada foi gravado.</p>
                          )}
                          {t.proposal.status === 'failed' && (
                            <p className="text-[10.5px] text-next-red-alert pt-1">Falha ao gravar — tente novamente.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {asking && (
                  <div className="flex justify-start">
                    <div className="next-glass-panel rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 text-next-purple-neon animate-spin" />
                      <span className="text-[11px] text-slate-400">Cruzando agenda, financeiro, orçamentos e recall...</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 p-3 border-t border-next-border flex items-center gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !asking) handleAsk(); }}
                  placeholder={activeGapContext ? 'Descreva o que foi realizado...' : 'Como está minha clínica hoje?'}
                  className="flex-1 bg-slate-900 border border-next-border rounded-xl text-xs text-slate-200 placeholder-slate-600 px-3 py-2.5 focus:outline-none focus:border-next-purple-neon"
                />
                <button
                  onClick={handleAsk}
                  disabled={asking || !question.trim()}
                  className="w-9 h-9 rounded-xl next-brand-gradient-bg text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0"
                >
                  {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
