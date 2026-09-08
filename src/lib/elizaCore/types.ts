/**
 * ELIZA Intelligence v2 — shared types for the deterministic tool layer and
 * the insight engine built on top of it.
 *
 * Confiabilidade model (see plan item 4): every number the user sees traces
 * back to one of two origins —
 *   - FATO: a value read directly from a document (a count, a status).
 *   - CALCULO: a value deterministically derived from facts (a sum, a %
 *     change, a comparison) — computed in TypeScript, never by the LLM.
 * The LLM is only ever allowed to add INFERENCIA (a contextual reading of
 * calculated data) and SUGESTAO (a recommended action) on top of insights
 * that already exist — it never originates a fato or calculo itself, and
 * every insight it discusses must already carry real evidence.
 */

export type EvidenceBasis = "fato" | "calculo";

export interface EvidenceItem {
  id: string;
  label: string;
  value?: number;
  detail?: string;
}

export interface EvidenceGroup {
  label: string;
  basis: EvidenceBasis;
  items: EvidenceItem[];
}

export type InsightCategory = "agenda" | "financeiro" | "orcamentos" | "recall" | "pendencias" | "paciente";
export type InsightSeverity = "risco" | "atencao" | "oportunidade" | "info";

// Same 4 write actions approved for the Action Layer (src/lib/elizaCore/actions.ts)
// — the insight engine only ever points at these, it never introduces a new one.
export type InsightActionType = "create_task" | "prepare_message" | "prepare_campaign" | "create_appointment_request";

export interface InsightSuggestedAction {
  actionType: InsightActionType;
  label: string;
  /** Passed as-is as the `input` of POST /api/eliza/actions/propose. */
  prefillInput: Record<string, any>;
}

/**
 * Emitted only by the deterministic Insight Engine (rule-based, no LLM
 * call). `aiExplanation`/`recommendation` are filled in later, by the
 * orchestrator, from the model's response — the insight's existence and its
 * numbers are decided before the model is ever called.
 *
 * `priorityScore`/`priorityFactors` are computed the same way: a fixed
 * deterministic formula in insightEngine.ts (urgência/severidade, impacto
 * financeiro, prazo, pacientes afetados, oportunidade de conversão). The
 * model may later explain *why* something ranks where it does, but it never
 * computes or overrides the number itself.
 */
export interface Insight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  basis: EvidenceBasis;
  evidence: EvidenceGroup;
  priorityScore: number;
  priorityFactors: string[];
  suggestedActions?: InsightSuggestedAction[];
  aiExplanation?: string;
  recommendation?: string;
}

export interface ToolCallEvidenceRecord {
  tool: string;
  clinicId: string;
  calledAt: string;
  durationMs: number;
  resultSummary: string;
}
