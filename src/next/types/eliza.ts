// Shared shapes for the ELIZA Intelligence v2 orchestrator (POST /api/eliza/ask)
// — used by every screen that talks to it (Assistente Central, Home,
// Prontuário, Planejamento) so none of them re-declare their own version.

export type InsightSeverity = 'risco' | 'atencao' | 'oportunidade' | 'info';
export type InsightCategory = 'agenda' | 'financeiro' | 'orcamentos' | 'recall' | 'pendencias' | 'paciente';
export type ScreenType = 'home' | 'financeiro' | 'paciente' | 'planejamento' | 'geral';

export interface InsightEvidenceItem {
  id: string;
  label: string;
  value?: number;
  detail?: string;
}

export interface InsightEvidence {
  label: string;
  basis: 'fato' | 'calculo';
  items: InsightEvidenceItem[];
}

export type InsightActionType = 'create_task' | 'prepare_message' | 'prepare_campaign' | 'create_appointment_request' | 'propose_clinical_evolution';

export interface InsightSuggestedAction {
  actionType: InsightActionType;
  label: string;
  prefillInput: Record<string, any>;
}

export interface AssistantInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  basis: 'fato' | 'calculo';
  evidence: InsightEvidence;
  priorityScore: number;
  priorityFactors: string[];
  suggestedActions?: InsightSuggestedAction[];
  aiExplanation?: string;
  recommendation?: string;
}

/** One prior turn, sent back on the next ask() so "esses horários" resolves — see server.ts systemPrompt rule 9. */
export interface ConversationHistoryTurn {
  question: string;
  summary: string;
}

// ---- Temporal Layer (POST /api/eliza/temporal-overview) -------------------

export type MetricReliability = 'ok' | 'partial' | 'unavailable';

export type DataQualityLevel = 'high' | 'medium' | 'low';

export interface DataQualityAssessment {
  level: DataQualityLevel;
  reason: string;
}

export interface TemporalPeriod {
  label: string;
  from: string;
  to: string;
}

export interface TemporalMetric {
  key: string;
  label: string;
  unit: 'currency' | 'count' | 'percent';
  current: number | null;
  previous: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  reliability: MetricReliability;
  reliabilityNote?: string;
  dataQuality: DataQualityAssessment;
}

export type TemporalInterpretationType = 'tendencia' | 'correlacao' | 'hipotese';

export interface TemporalChange {
  id: string;
  metricKey: string;
  title: string;
  description: string;
  magnitudePct: number;
  direction: 'up' | 'down';
  reliability: MetricReliability;
  reliabilityNote?: string;
  interpretationType: TemporalInterpretationType;
  evidence: { currentPeriod: TemporalPeriod; previousPeriod: TemporalPeriod; current: number; previous: number; unit: TemporalMetric['unit'] };
  aiInterpretation?: string;
}

export interface TemporalOverviewResponse {
  currentPeriod: TemporalPeriod;
  previousPeriod: TemporalPeriod;
  metrics: Record<
    'receita' | 'atendimentos' | 'ticketMedio' | 'cancelamentos' | 'orcamentosCriados' | 'pendencias' | 'solicitacoesPortal',
    TemporalMetric
  >;
  changes: TemporalChange[];
  meta: { durationMs: number; docsRead: number; calcMs: number; modelInputBytes: number };
}

export interface PeriodComparison {
  currentMonth: { from: string; to: string; receitaRecebida: number; atendimentos: number };
  previousMonth: { from: string; to: string; receitaRecebida: number; atendimentos: number };
  deltaReceita: number;
  deltaReceitaPct: number | null;
  deltaAtendimentos: number;
  deltaTicketMedioPct: number | null;
}

export interface AssistantAnswer {
  summary: string;
  insights: AssistantInsight[];
  periodComparison?: PeriodComparison | null;
  dataSufficiency: 'ok' | 'insufficient';
  caveats: string[];
  /** Set when the question named a patient by text (not already on their screen) and exactly one real match was found — lets the UI offer "Abrir prontuário" even when asked from Home/elsewhere. */
  resolvedPatientId?: string | null;
  resolvedPatientName?: string | null;
  /** Perf telemetry for this call — response time, prompt size, tools actually invoked. */
  meta?: { durationMs: number; modelInputBytes: number; toolsCalled: string[] };
}
