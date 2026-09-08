import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, Gauge, Lightbulb, DollarSign, Users, Receipt, XCircle, ClipboardList, FileText, MessageSquare, Sparkles, ChevronRight, ChevronUp as ChevronUpIcon } from 'lucide-react';
import { useElizaTemporal } from '../../hooks/useElizaTemporal';
import type { TemporalOverviewResponse, TemporalMetric, TemporalChange } from '../../types/eliza';

// Light-theme-only icon + semantic tone per metric key — purely decorative,
// hidden in Dark Mode via .eliza-metric-icon's default display:none (see
// index.css), so this never changes how the card looks today.
const METRIC_ICON: Record<string, { Icon: typeof DollarSign; tone: 'purple' | 'violet' | 'blue' | 'green' | 'red' }> = {
  receita: { Icon: DollarSign, tone: 'purple' },
  atendimentos: { Icon: Users, tone: 'violet' },
  ticketMedio: { Icon: Receipt, tone: 'blue' },
  cancelamentos: { Icon: XCircle, tone: 'red' },
  orcamentosCriados: { Icon: ClipboardList, tone: 'purple' },
  pendencias: { Icon: FileText, tone: 'green' },
  solicitacoesPortal: { Icon: MessageSquare, tone: 'purple' },
};

function formatValue(m: TemporalMetric): string {
  if (m.current == null) return '—';
  if (m.unit === 'currency') return m.current.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return String(Math.round(m.current));
}

const RELIABILITY_LABEL: Record<string, string> = {
  ok: '',
  partial: 'com ressalva',
  unavailable: 'indisponível',
};

function MetricCard({ metric }: { metric: TemporalMetric }) {
  const unavailable = metric.reliability === 'unavailable' || metric.current == null;
  const Arrow = metric.deltaPct == null ? Minus : metric.deltaPct >= 0 ? TrendingUp : TrendingDown;
  const arrowColor = metric.deltaPct == null ? 'text-slate-500' : metric.deltaPct >= 0 ? 'text-next-green-success' : 'text-next-red-alert';

  const iconEntry = METRIC_ICON[metric.key];

  return (
    <div className="next-glass-panel rounded-xl p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        {iconEntry && (
          <div className="eliza-metric-icon" data-tone={iconEntry.tone}>
            <iconEntry.Icon className="w-4 h-4" />
          </div>
        )}
        <div className="flex-1 flex items-center justify-between gap-1 min-w-0">
          <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-500 truncate">{metric.label}</span>
          {metric.reliability !== 'ok' && (
            <span title={metric.reliabilityNote} className="text-next-orange-insight flex-shrink-0">
              <AlertTriangle className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>
      {unavailable ? (
        <p className="text-[11px] text-slate-500 italic">Indisponível{metric.reliabilityNote ? ` — ${metric.reliabilityNote}` : ''}</p>
      ) : (
        <>
          <p className="text-sm font-extrabold text-slate-100">{formatValue(metric)}</p>
          <div className={`flex items-center gap-1 text-[10.5px] font-bold ${arrowColor}`}>
            <Arrow className="w-3 h-3" />
            <span>{metric.deltaPct != null ? `${metric.deltaPct >= 0 ? '+' : ''}${metric.deltaPct.toFixed(1)}%` : '—'}</span>
            {RELIABILITY_LABEL[metric.reliability] && <span className="text-slate-500 font-normal">({RELIABILITY_LABEL[metric.reliability]})</span>}
          </div>
        </>
      )}
    </div>
  );
}

const INTERPRETATION_LABEL: Record<string, string> = {
  tendencia: 'Tendência (cálculo)',
  correlacao: 'Correlação (inferência)',
  hipotese: 'Hipótese (inferência)',
};

// Secondary/compact presentation on purpose — .eliza-insight-card (the
// premium purple treatment) is reserved for where ELIZA's interpretation is
// the star (Insight em Foco). These are deterministic trend deltas, a
// different layer of the DADOS → MUDANÇA → INTERPRETAÇÃO → AÇÃO hierarchy.
function ChangeCard({ change }: { change: TemporalChange }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${change.direction === 'up' ? 'bg-next-green-success/10 border-next-green-success/25' : 'bg-next-red-alert/10 border-next-red-alert/25'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-wider opacity-80">{INTERPRETATION_LABEL[change.interpretationType]}</span>
        <span className="text-[9px] font-mono opacity-70 flex items-center gap-1"><Gauge className="w-3 h-3" />{change.magnitudePct.toFixed(1)}%</span>
      </div>
      <p className="text-[11px] font-bold leading-snug mt-0.5">{change.title}</p>
      <p className="text-[10.5px] leading-snug mt-0.5 opacity-90">{change.description}</p>
      {change.reliabilityNote && (
        <p className="text-[10px] leading-snug mt-1 opacity-75 italic">⚠ {change.reliabilityNote}</p>
      )}
      {change.aiInterpretation && (
        <p className="text-[10.5px] leading-snug mt-1.5 flex items-start gap-1 opacity-90">
          <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>{change.aiInterpretation}</span>
        </p>
      )}
    </div>
  );
}

export default function TemporalOverviewPanel() {
  const { getOverview } = useElizaTemporal();
  const [data, setData] = useState<TemporalOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getOverview(30);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Falha ao calcular a visão temporal.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-md font-bold text-slate-200 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-next-purple-neon" />
            <span>Tendência {data ? `(${data.currentPeriod.label})` : '(Últimos 30 dias)'}</span>
          </h2>
          <p className="text-[11px] text-slate-500">Comparado com o período equivalente imediatamente anterior — cálculo determinístico, sem estimativa.</p>
        </div>
        <button onClick={load} disabled={loading} title="Atualizar" className="p-1.5 rounded-lg border border-next-border text-slate-400 hover:text-slate-200 hover:border-next-border-glow disabled:opacity-50 flex-shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Calculando tendências reais...</div>
      ) : error ? (
        <div className="text-center py-8 text-xs text-next-red-alert">{error}</div>
      ) : data ? (
        <>
          {/* DADOS layer — KPIs come first, immediately under the header. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {Object.values(data.metrics).map((m) => <MetricCard key={m.key} metric={m} />)}
          </div>

          {/* MUDANÇA layer — a compact, collapsed-by-default indicator.
              Detail (ChangeCard) only renders once expanded, and uses a
              secondary/compact style — the premium .eliza-insight-card
              treatment is reserved for Insight em Foco (INTERPRETAÇÃO). */}
          {data.changes.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setChangesExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-2 text-left next-glass-panel rounded-lg px-3 py-2 hover:border-next-border-glow transition-colors"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                  <Sparkles className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  ELIZA detectou {data.changes.length} mudança(s) relevante(s)
                </span>
                <span className="text-[10px] font-bold text-next-purple-light flex items-center gap-1 flex-shrink-0">
                  {changesExpanded ? 'Ocultar' : 'Ver mudanças'}
                  {changesExpanded ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </span>
              </button>
              {changesExpanded && (
                <div className="space-y-2">
                  {data.changes.map((c) => <ChangeCard key={c.id} change={c} />)}
                </div>
              )}
            </div>
          )}

          <p className="text-[9.5px] font-mono text-slate-600">
            {data.meta.docsRead} documento(s) lido(s) · cálculo {data.meta.calcMs}ms · resposta total {data.meta.durationMs}ms
          </p>
        </>
      ) : null}
    </div>
  );
}
