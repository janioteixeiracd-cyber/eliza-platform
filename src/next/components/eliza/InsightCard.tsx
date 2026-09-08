import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, TrendingUp, Info, Lightbulb, ChevronDown, ChevronUp, Gauge, Loader2, Check, X, AlertCircle } from 'lucide-react';
import { useElizaActions } from '../../hooks/useElizaActions';
import type { AssistantInsight, InsightSeverity, InsightSuggestedAction } from '../../types/eliza';

const SEVERITY_META: Record<InsightSeverity, { label: string; icon: React.ElementType; classes: string }> = {
  risco: { label: 'Risco', icon: ShieldAlert, classes: 'bg-next-red-alert/10 border-next-red-alert/25 text-next-red-alert' },
  atencao: { label: 'Atenção', icon: AlertTriangle, classes: 'bg-next-orange-insight/10 border-next-orange-insight/25 text-next-orange-insight' },
  oportunidade: { label: 'Oportunidade', icon: TrendingUp, classes: 'bg-next-green-success/10 border-next-green-success/25 text-next-green-success' },
  info: { label: 'Info', icon: Info, classes: 'bg-next-ia-blue/10 border-next-ia-blue/25 text-next-ia-blue' },
};

// Actions that reach a real patient over WhatsApp when approved — the
// confirm step below shows an explicit warning for these, since it's not
// reversible once sent (matches ACTIONS_REQUIRING_ADMIN in actions.ts).
const SENSITIVE_ACTIONS = new Set(['prepare_message', 'prepare_campaign']);

type ActionState = 'idle' | 'proposing' | 'previewing' | 'approving' | 'done' | 'error';

// Single rendering of an ELIZA Intelligence insight — used by the floating
// Assistente Central and by the Home Opportunity Deck alike, so there is
// exactly one place that knows how to draw fato/cálculo vs inferência vs
// sugestão, the priority score, the evidence drill-down, and the
// contextual action buttons (propose → confirm/cancel, same Action Layer
// used everywhere else — no new write path introduced here).
export default function InsightCard({ insight }: { insight: AssistantInsight }) {
  const [expanded, setExpanded] = useState(false);
  const [factorsExpanded, setFactorsExpanded] = useState(false);
  const { propose, approve, reject } = useElizaActions();

  const [activeAction, setActiveAction] = useState<InsightSuggestedAction | null>(null);
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [previewSummary, setPreviewSummary] = useState('');
  const [actionError, setActionError] = useState('');
  const [resultMessage, setResultMessage] = useState('');

  const meta = SEVERITY_META[insight.severity];
  const Icon = meta.icon;
  const hasEvidence = insight.evidence?.items?.length > 0;
  const hasActions = insight.suggestedActions && insight.suggestedActions.length > 0;

  async function handlePropose(action: InsightSuggestedAction) {
    setActiveAction(action);
    setActionState('proposing');
    setActionError('');
    try {
      const result = await propose(action.actionType, action.prefillInput);
      // Insight-suggested actions never route to propose_clinical_evolution
      // (that flow only starts from a cognitive gap in NextElizaAssistant),
      // so a clarification here would be unexpected — surface it as an
      // error rather than silently proceeding without a proposalId.
      if (result.type === 'clarification') {
        throw new Error(result.message || 'Não foi possível preparar esta ação agora.');
      }
      setProposalId(result.proposalId);
      setPreviewSummary(result.preview.summary);
      setActionState('previewing');
    } catch (err: any) {
      setActionError(err?.message || 'Falha ao preparar a ação.');
      setActionState('error');
    }
  }

  async function handleConfirm() {
    if (!proposalId) return;
    setActionState('approving');
    try {
      await approve(proposalId);
      setResultMessage('Feito — ação executada e registrada.');
      setActionState('done');
    } catch (err: any) {
      setActionError(err?.message || 'Falha ao executar a ação.');
      setActionState('error');
    }
  }

  async function handleCancel() {
    if (proposalId) {
      try { await reject(proposalId); } catch { /* best-effort */ }
    }
    resetAction();
  }

  function resetAction() {
    setActiveAction(null);
    setActionState('idle');
    setProposalId(null);
    setPreviewSummary('');
    setActionError('');
    setResultMessage('');
  }

  return (
    <div data-severity={insight.severity} className={`eliza-insight-card rounded-xl border px-3.5 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${meta.classes}`}>
      <div className="flex items-start gap-2.5">
        <div className="eliza-insight-icon w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="eliza-insight-tag text-[9px] font-black uppercase tracking-wider opacity-80 px-1.5 py-0.5 rounded">{meta.label} · {insight.category}</span>
            {typeof insight.priorityScore === 'number' && (
              <button
                onClick={() => setFactorsExpanded((v) => !v)}
                title="Score de prioridade (determinístico)"
                className="flex items-center gap-1 text-[9px] font-mono font-bold opacity-70 hover:opacity-100 flex-shrink-0"
              >
                <Gauge className="w-3 h-3" />
                {insight.priorityScore}
              </button>
            )}
          </div>
          <p className="text-[11px] font-bold leading-snug mt-0.5">{insight.title}</p>
          <p className="text-[10.5px] leading-snug mt-0.5 opacity-90">{insight.description}</p>

          {factorsExpanded && insight.priorityFactors?.length > 0 && (
            <ul className="mt-1 space-y-0.5 pl-4 border-l border-current/20">
              {insight.priorityFactors.map((f, i) => (
                <li key={i} className="text-[10px] opacity-85">• {f}</li>
              ))}
            </ul>
          )}

          {/* Executive first layer: title → description → number/CTA above.
              Inferência/sugestão/evidência (the technical layer) only show
              once the person asks for them, via the single toggle below. */}
          {(insight.aiExplanation || insight.recommendation || hasEvidence) && (
            <div className="mt-1.5">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide opacity-75 hover:opacity-100"
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Ver análise completa
              </button>
              {expanded && (
                <div className="mt-1.5 space-y-1.5">
                  {insight.aiExplanation && (
                    <p className="text-[10.5px] leading-snug flex items-start gap-1 opacity-90">
                      <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span><span className="font-black uppercase text-[8.5px] tracking-wider">Inferência: </span>{insight.aiExplanation}</span>
                    </p>
                  )}
                  {insight.recommendation && (
                    <p className="text-[10.5px] leading-snug opacity-90">
                      <span className="font-black uppercase text-[8.5px] tracking-wider">Sugestão: </span>{insight.recommendation}
                    </p>
                  )}
                  {hasEvidence && (
                    <ul className="space-y-0.5 pl-4 border-l border-current/20">
                      {insight.evidence.items.map((item) => (
                        <li key={item.id} className="text-[10px] opacity-85 flex items-center justify-between gap-2">
                          <span className="truncate">{item.label}</span>
                          <span className="flex-shrink-0 font-mono">{item.value != null ? `R$ ${item.value.toFixed(2)}` : item.detail || ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {hasActions && actionState === 'idle' && (
            <div className="mt-2 pt-2 border-t border-current/15 flex flex-wrap gap-1.5">
              {insight.suggestedActions!.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handlePropose(action)}
                  className="eliza-insight-cta text-[9.5px] font-bold px-2 py-1 rounded-md border border-current/25 bg-black/10 hover:bg-black/20 transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {activeAction && actionState === 'proposing' && (
            <div className="mt-2 pt-2 border-t border-current/15 flex items-center gap-1.5 text-[10.5px] opacity-90">
              <Loader2 className="w-3 h-3 animate-spin" /> Preparando "{activeAction.label}"...
            </div>
          )}

          {activeAction && actionState === 'previewing' && (
            <div className="mt-2 pt-2 border-t border-current/15 space-y-1.5">
              <p className="text-[10.5px] leading-snug bg-black/10 rounded-md p-2">{previewSummary}</p>
              {SENSITIVE_ACTIONS.has(activeAction.actionType) && (
                <p className="text-[9.5px] flex items-start gap-1 opacity-90">
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" /> Confirmar envia uma mensagem real pelo WhatsApp agora — não é reversível.
                </p>
              )}
              <div className="flex gap-1.5">
                <button onClick={handleConfirm} className="flex items-center gap-1 text-[9.5px] font-bold px-2 py-1 rounded-md bg-current/20 hover:bg-current/30">
                  <Check className="w-3 h-3" /> Confirmar
                </button>
                <button onClick={handleCancel} className="flex items-center gap-1 text-[9.5px] font-bold px-2 py-1 rounded-md border border-current/25 hover:bg-black/10">
                  <X className="w-3 h-3" /> Cancelar
                </button>
              </div>
            </div>
          )}

          {activeAction && actionState === 'approving' && (
            <div className="mt-2 pt-2 border-t border-current/15 flex items-center gap-1.5 text-[10.5px] opacity-90">
              <Loader2 className="w-3 h-3 animate-spin" /> Executando...
            </div>
          )}

          {actionState === 'done' && (
            <div className="mt-2 pt-2 border-t border-current/15 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[10.5px] font-bold"><Check className="w-3 h-3" /> {resultMessage}</span>
              <button onClick={resetAction} className="text-[9.5px] underline opacity-70 hover:opacity-100">fechar</button>
            </div>
          )}

          {actionState === 'error' && (
            <div className="mt-2 pt-2 border-t border-current/15 space-y-1">
              <p className="text-[10.5px] text-next-red-alert">{actionError}</p>
              <button onClick={resetAction} className="text-[9.5px] underline opacity-70 hover:opacity-100">fechar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
