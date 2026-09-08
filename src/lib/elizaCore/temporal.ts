/**
 * ELIZA Intelligence v2 — Temporal Layer.
 *
 * Deterministic only, same discipline as insightEngine.ts: every number
 * here comes from real documents, every comparison is arithmetic done in
 * TypeScript. The LLM is never asked to compute a delta or decide whether a
 * change is "relevant" — it may only explain a change this layer already
 * detected, and only ever as tendência/correlação/hipótese, never as causa
 * comprovada (see detectTemporalChanges below).
 *
 * Reliability is per-metric and explicit — see the MetricReliability docs
 * on each function. Nothing here estimates a metric it can't compute; it
 * marks it "unavailable" and says why (rule 8 of the approved plan).
 */
import type { Firestore } from "firebase-admin/firestore";
import { normalizeFinancialEntry } from "../../utils/financialHelpers";
import { assessDataQuality, type DataQualityAssessment } from "./dataQuality";

export type MetricReliability = "ok" | "partial" | "unavailable";

export interface MetricComparison {
  key: string;
  label: string;
  unit: "currency" | "count" | "percent";
  current: number | null;
  previous: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  reliability: MetricReliability;
  reliabilityNote?: string;
  /** Same signal as reliability/reliabilityNote, in the high/medium/low vocabulary the Intelligence layer surfaces — computed here, never by the LLM. */
  dataQuality: DataQualityAssessment;
}

export interface TemporalPeriod {
  label: string;
  from: string;
  to: string;
}

export interface TemporalOverviewResult {
  currentPeriod: TemporalPeriod;
  previousPeriod: TemporalPeriod;
  metrics: Record<
    | "receita"
    | "atendimentos"
    | "ticketMedio"
    | "cancelamentos"
    | "orcamentosCriados"
    | "pendencias"
    | "solicitacoesPortal",
    MetricComparison
  >;
  perf: { docsRead: number; calcMs: number };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toDateSafe(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v?.toDate === "function") return v.toDate();
    if (v?.seconds !== undefined) return new Date(v.seconds * 1000);
    const match = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function inRange(d: Date | null, from: Date, to: Date): boolean {
  return !!d && d >= from && d <= to;
}

function pct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null; // division by zero — not a meaningful %, leave null rather than "infinite"
  return ((current - previous) / previous) * 100;
}

function comparison(
  key: string,
  label: string,
  unit: MetricComparison["unit"],
  current: number | null,
  previous: number | null,
  reliability: MetricReliability,
  reliabilityNote?: string
): MetricComparison {
  return {
    key,
    label,
    unit,
    current,
    previous,
    deltaAbs: current != null && previous != null ? current - previous : null,
    deltaPct: pct(current, previous),
    reliability,
    reliabilityNote,
    dataQuality: assessDataQuality(reliability, reliabilityNote),
  };
}

/**
 * Rolling N-day window: current = [now-days, now], previous = [now-2*days,
 * now-days) — equivalent-length immediately-preceding period, same
 * methodology already validated in server.ts's /api/eliza/ask (elapsed-days
 * comparison, not full-calendar-month) so a partial "today" never makes a
 * period look artificially worse.
 */
function getRollingWindow(days: number, now: Date = new Date()): { currentPeriod: TemporalPeriod; previousPeriod: TemporalPeriod; currentFrom: Date; currentTo: Date; previousFrom: Date; previousTo: Date } {
  const currentTo = new Date(now);
  const currentFrom = new Date(now);
  currentFrom.setDate(currentFrom.getDate() - days);
  const previousTo = new Date(currentFrom);
  const previousFrom = new Date(currentFrom);
  previousFrom.setDate(previousFrom.getDate() - days);

  return {
    currentPeriod: { label: `Últimos ${days} dias`, from: ymd(currentFrom), to: ymd(currentTo) },
    previousPeriod: { label: `${days} dias anteriores`, from: ymd(previousFrom), to: ymd(previousTo) },
    currentFrom,
    currentTo,
    previousFrom,
    previousTo,
  };
}

export async function getTemporalOverview(
  db: Firestore,
  clinicId: string,
  opts: { days?: number; includeFinance: boolean }
): Promise<TemporalOverviewResult> {
  const startedAt = Date.now();
  let docsRead = 0;
  const days = opts.days ?? 30;
  const { currentPeriod, previousPeriod, currentFrom, currentTo, previousFrom, previousTo } = getRollingWindow(days);

  // ---- Financeiro: receita (cash, by paidAt) + ticket médio -------------
  let receita = comparison("receita", "Receita recebida", "currency", null, null, "unavailable", "Sem permissão de acesso financeiro para este usuário.");
  let atendimentos = comparison("atendimentos", "Atendimentos", "count", null, null, "ok");
  let ticketMedio = comparison("ticketMedio", "Ticket médio", "currency", null, null, "unavailable");

  // Appointments are read once and reused for atendimentos + cancelamentos.
  const apptSnap = await db.collection(`clinics/${clinicId}/appointments`).limit(3000).get();
  docsRead += apptSnap.size;
  let apptCurrent = 0, apptPrevious = 0, cancelCurrent = 0, cancelPrevious = 0;
  apptSnap.forEach((doc) => {
    const data = doc.data();
    const d = toDateSafe(data.date);
    const isCancelled = data.status === "cancelado";
    if (inRange(d, currentFrom, currentTo)) {
      apptCurrent++;
      if (isCancelled) cancelCurrent++;
    } else if (inRange(d, previousFrom, previousTo)) {
      apptPrevious++;
      if (isCancelled) cancelPrevious++;
    }
  });
  atendimentos = comparison("atendimentos", "Atendimentos", "count", apptCurrent, apptPrevious, "ok");

  // Cancelamentos: bucketed by the appointment's SCHEDULED date, using the
  // CURRENT status — there is no history of when the cancellation itself
  // happened (status/updatedAt get overwritten on every edit; status_events
  // only started being recorded from this deploy on, so it has no
  // pre-existing history to compare against yet). This is "% of what was
  // scheduled in this window that ended up cancelled", not "cancellations
  // that occurred during this window" — different question, stated plainly.
  const cancelamentos = comparison(
    "cancelamentos",
    "Cancelamentos",
    "count",
    cancelCurrent,
    cancelPrevious,
    "partial",
    "Contado pela data agendada do atendimento, não pela data em que o cancelamento aconteceu (esse dado não existe para o histórico anterior a este recurso)."
  );

  if (opts.includeFinance) {
    const finSnap = await db.collection(`clinics/${clinicId}/financial_entries`).limit(6000).get();
    docsRead += finSnap.size;
    let receitaCurrent = 0, receitaPrevious = 0;
    let paidMissingPaidAt = 0;
    finSnap.forEach((doc) => {
      const e = normalizeFinancialEntry({ id: doc.id, ...doc.data() });
      if (!e || e.type !== "income") return;
      if (e.status === "paid" && !e.paidAt) paidMissingPaidAt++;
      const paidAt = toDateSafe(e.paidAt);
      if (!paidAt) return;
      if (inRange(paidAt, currentFrom, currentTo)) receitaCurrent += e.paidAmount;
      else if (inRange(paidAt, previousFrom, previousTo)) receitaPrevious += e.paidAmount;
    });
    const receitaReliability: MetricReliability = paidMissingPaidAt > 0 ? "partial" : "ok";
    receita = comparison(
      "receita",
      "Receita recebida",
      "currency",
      receitaCurrent,
      receitaPrevious,
      receitaReliability,
      paidMissingPaidAt > 0 ? `${paidMissingPaidAt} lançamento(s) pago(s) sem data de pagamento registrada — não entram na soma.` : undefined
    );

    ticketMedio = comparison(
      "ticketMedio",
      "Ticket médio",
      "currency",
      apptCurrent > 0 ? receitaCurrent / apptCurrent : null,
      apptPrevious > 0 ? receitaPrevious / apptPrevious : null,
      apptCurrent > 0 && apptPrevious > 0 ? "ok" : "unavailable",
      apptCurrent === 0 || apptPrevious === 0 ? "Sem atendimentos suficientes em um dos dois períodos para calcular." : undefined
    );
  }

  // ---- Orçamentos criados (createdAt — reliable) -------------------------
  const quotSnap = await db.collectionGroup("quotations").limit(4000).get();
  docsRead += quotSnap.size;
  let quotCurrent = 0, quotPrevious = 0;
  quotSnap.forEach((doc) => {
    if (!doc.ref.path.startsWith(`clinics/${clinicId}/`)) return;
    const d = toDateSafe(doc.data().createdAt);
    if (inRange(d, currentFrom, currentTo)) quotCurrent++;
    else if (inRange(d, previousFrom, previousTo)) quotPrevious++;
  });
  const orcamentosCriados = comparison("orcamentosCriados", "Orçamentos criados", "count", quotCurrent, quotPrevious, "ok");

  // ---- Pendências + Solicitações do Portal (createdAt — reliable) -------
  const pendingSnap = await db.collection(`clinics/${clinicId}/pending_items`).limit(4000).get();
  docsRead += pendingSnap.size;
  let pendCurrent = 0, pendPrevious = 0, portalCurrent = 0, portalPrevious = 0;
  pendingSnap.forEach((doc) => {
    const data = doc.data();
    const d = toDateSafe(data.createdAt);
    const isPortal = data.source === "Portal do Paciente";
    if (inRange(d, currentFrom, currentTo)) {
      pendCurrent++;
      if (isPortal) portalCurrent++;
    } else if (inRange(d, previousFrom, previousTo)) {
      pendPrevious++;
      if (isPortal) portalPrevious++;
    }
  });
  const pendencias = comparison("pendencias", "Pendências criadas", "count", pendCurrent, pendPrevious, "ok");
  const solicitacoesPortal = comparison("solicitacoesPortal", "Solicitações do Portal", "count", portalCurrent, portalPrevious, "ok");

  return {
    currentPeriod,
    previousPeriod,
    metrics: { receita, atendimentos, ticketMedio, cancelamentos, orcamentosCriados, pendencias, solicitacoesPortal },
    perf: { docsRead, calcMs: Date.now() - startedAt },
  };
}

// ============================================================================
// Change detection — deterministic magnitude threshold, no AI involved.
// ============================================================================

export type TemporalInterpretationType = "tendencia" | "correlacao" | "hipotese";

export interface TemporalChange {
  id: string;
  metricKey: string;
  title: string;
  description: string;
  magnitudePct: number;
  direction: "up" | "down";
  reliability: MetricReliability;
  reliabilityNote?: string;
  interpretationType: TemporalInterpretationType;
  evidence: { currentPeriod: TemporalPeriod; previousPeriod: TemporalPeriod; current: number; previous: number; unit: MetricComparison["unit"] };
  aiInterpretation?: string;
}

const MAGNITUDE_THRESHOLD_PCT = 15;
// Below this absolute previous-period value, a % change is mostly noise
// (e.g. 1→2 is "+100%" but meaningless) — skip it rather than alarm on it.
const MIN_MEANINGFUL_PREVIOUS: Record<string, number> = {
  receita: 200,
  atendimentos: 3,
  ticketMedio: 0, // derived; gated by its inputs already
  cancelamentos: 2,
  orcamentosCriados: 2,
  pendencias: 3,
  solicitacoesPortal: 2,
};

export function detectTemporalChanges(overview: TemporalOverviewResult): TemporalChange[] {
  const changes: TemporalChange[] = [];

  for (const metric of Object.values(overview.metrics)) {
    if (metric.reliability === "unavailable") continue;
    if (metric.deltaPct == null || metric.current == null || metric.previous == null) continue;
    if (Math.abs(metric.deltaPct) < MAGNITUDE_THRESHOLD_PCT) continue;
    const minPrevious = MIN_MEANINGFUL_PREVIOUS[metric.key] ?? 0;
    if (Math.abs(metric.previous) < minPrevious) continue;

    const direction: "up" | "down" = metric.deltaPct >= 0 ? "up" : "down";
    changes.push({
      id: `temporal-${metric.key}`,
      metricKey: metric.key,
      title: `${metric.label} ${direction === "up" ? "subiu" : "caiu"} ${Math.abs(metric.deltaPct).toFixed(1)}%`,
      description: `${metric.label}: ${overview.currentPeriod.label} = ${metric.current.toFixed(2)}, ${overview.previousPeriod.label} = ${metric.previous.toFixed(2)}.`,
      magnitudePct: Math.abs(metric.deltaPct),
      direction,
      reliability: metric.reliability,
      reliabilityNote: metric.reliabilityNote,
      // Deterministic layer only ever calls its own detections "tendência"
      // (a metric moved) — it never claims correlation or cause between
      // two different metrics; that inference, if asked for, is the model's
      // job downstream, under the same causality rule as periodComparison.
      interpretationType: "tendencia",
      evidence: { currentPeriod: overview.currentPeriod, previousPeriod: overview.previousPeriod, current: metric.current, previous: metric.previous, unit: metric.unit },
    });
  }

  changes.sort((a, b) => b.magnitudePct - a.magnitudePct);
  return changes;
}
