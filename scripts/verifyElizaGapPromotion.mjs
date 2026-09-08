/**
 * Prova, importando as funções reais (src/lib/elizaCore/insightGapBridge.ts
 * e cognitiveEvents.ts), que:
 *  - shouldPromoteGap() respeita o limiar exato GAP_PROMOTION_SCORE_THRESHOLD
 *    (49 não promove, 50 promove) pros 4 tipos novos de standing gap;
 *  - deterministicGapId() (reaproveitada de cognitiveEvents.ts, mesma
 *    função que o gap original de atendimento usa) é determinística: mesma
 *    entrada sempre gera o mesmo ID, entradas diferentes geram IDs
 *    diferentes.
 *
 * Puro Node/TS, sem Firestore — roda em milissegundos.
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs scripts/verifyElizaGapPromotion.mjs
 */
import { shouldPromoteGap, GAP_PROMOTION_SCORE_THRESHOLD } from "../src/lib/elizaCore/insightGapBridge.ts";
import { deterministicGapId } from "../src/lib/elizaCore/cognitiveEvents.ts";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

function insight(priorityScore) {
  return {
    id: "x", category: "financeiro", severity: "risco", title: "t", description: "d",
    basis: "calculo", evidence: { label: "e", basis: "calculo", items: [] },
    priorityScore, priorityFactors: [],
  };
}

console.log(`--- Limiar (GAP_PROMOTION_SCORE_THRESHOLD = ${GAP_PROMOTION_SCORE_THRESHOLD}) ---`);
check(`score ${GAP_PROMOTION_SCORE_THRESHOLD - 1} -> NÃO promove`, shouldPromoteGap(insight(GAP_PROMOTION_SCORE_THRESHOLD - 1)) === false);
check(`score ${GAP_PROMOTION_SCORE_THRESHOLD} -> promove`, shouldPromoteGap(insight(GAP_PROMOTION_SCORE_THRESHOLD)) === true);
check(`score ${GAP_PROMOTION_SCORE_THRESHOLD + 10} -> promove`, shouldPromoteGap(insight(GAP_PROMOTION_SCORE_THRESHOLD + 10)) === true);

console.log("\n--- Insight ausente (undefined) — nunca promove ---");
check("undefined -> false, nunca lança", shouldPromoteGap(undefined) === false);

console.log("\n--- Os 4 tipos novos, mesmo limiar (a função é agnóstica ao tipo, só olha o score) ---");
for (const cognitiveType of ["overdue_financial_risk", "stale_open_budgets", "recall_backlog", "operational_pending_backlog"]) {
  check(`${cognitiveType}: score 49 -> false`, shouldPromoteGap(insight(49)) === false);
  check(`${cognitiveType}: score 50 -> true`, shouldPromoteGap(insight(50)) === true);
}

console.log("\n--- deterministicGapId: determinístico e único por (tipo, evento) ---");
const idA1 = deterministicGapId("overdue_financial_risk", "standing");
const idA2 = deterministicGapId("overdue_financial_risk", "standing");
check("mesma entrada -> mesmo ID", idA1 === idA2);
check("formato esperado: cognitiveType__sourceEventId", idA1 === "overdue_financial_risk__standing");

const idB = deterministicGapId("stale_open_budgets", "standing");
check("tipo diferente -> ID diferente", idA1 !== idB);

const idC = deterministicGapId("finished_appointment_without_clinical_update", "appt-123");
check("tipo original (por appointmentId) continua funcionando igual", idC === "finished_appointment_without_clinical_update__appt-123");

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
