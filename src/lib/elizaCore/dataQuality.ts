/**
 * ELIZA Intelligence — Data Quality indicator.
 *
 * Small and deterministic on purpose: a fixed mapping from the reliability
 * signal a tool/metric already computed (never estimated, never decided by
 * the LLM) to a level any consumer — UI or model — can read at a glance.
 * This does not replace MetricReliability (temporal.ts); it's the
 * human-facing label on top of it, kept in one place so every metric uses
 * the same three words instead of each screen inventing its own wording.
 */

export type DataQualityLevel = "high" | "medium" | "low";

export interface DataQualityAssessment {
  level: DataQualityLevel;
  reason: string;
}

const REASON_BY_LEVEL: Record<DataQualityLevel, string> = {
  high: "Cobertura completa — todos os registros relevantes têm o dado necessário.",
  medium: "Cobertura parcial — parte dos registros não tem o dado necessário.",
  low: "Sem cobertura suficiente para calcular com confiança.",
};

/**
 * Maps an already-computed reliability signal ('ok'|'partial'|'unavailable',
 * the vocabulary used across tools.ts/insightEngine.ts/temporal.ts) to the
 * high/medium/low + reason the plan asked for. `note`, when given, is
 * itself deterministic (built from a real count, e.g. "38 lançamentos sem
 * paidAt") — this function never invents a reason on its own.
 */
export function assessDataQuality(reliability: "ok" | "partial" | "unavailable", note?: string): DataQualityAssessment {
  const level: DataQualityLevel = reliability === "ok" ? "high" : reliability === "partial" ? "medium" : "low";
  return { level, reason: note || REASON_BY_LEVEL[level] };
}
