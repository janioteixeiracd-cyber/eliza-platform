/**
 * Prova, contra o Firestore emulator via Admin SDK, que checkStandingGaps()
 * (src/lib/elizaCore/insightGapBridge.ts) se comporta corretamente fim a
 * fim — não é um teste de firestore.rules (essa função só roda no server,
 * nunca é chamada pelo client), é um teste da lógica de create/update/
 * resolve contra o Firestore real do emulador.
 *
 * Cobre o item 3 da seção "Verificação" do plano de Fase 1:
 *   1. Insight acima do limiar -> cria pending_item (status pending).
 *   2. Reconfirmação (ainda acima do limiar) -> update(), não duplica
 *      (mesmo doc ID, snapshot/título atualizados).
 *   3. Insight cai abaixo do limiar -> resolve (status vira resolved).
 *   4. Checkpoint filtra regras corretamente (agenda_open não mexe nos
 *      gaps de financeiro_open, e vice-versa).
 *   5. Concorrência: duas chamadas simultâneas pro mesmo gap -> exatamente
 *      1 doc, sem lançar erro (create() atômico + fallback pra update()).
 *   6. severity 'risco' -> priority 'Alta'; outra severity -> 'Média'.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node node_modules/tsx/dist/cli.mjs scripts/verifyElizaStandingGapEmulator.mjs
 */
import admin from "firebase-admin";
import { checkStandingGaps, GAP_PROMOTION_SCORE_THRESHOLD } from "../src/lib/elizaCore/insightGapBridge.ts";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST not set.");
  process.exit(1);
}

admin.initializeApp({ projectId: "elisa-494703" });
const adminDb = admin.firestore();

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

function insight(id, priorityScore, overrides = {}) {
  return {
    id,
    category: "financeiro",
    severity: "risco",
    title: `Título ${id} score=${priorityScore}`,
    description: `Descrição ${id} score=${priorityScore}`,
    basis: "calculo",
    evidence: { label: "e", basis: "calculo", items: [] },
    priorityScore,
    priorityFactors: [],
    ...overrides,
  };
}

async function main() {
  const CLINIC = "standing-gap-emu-" + Date.now();
  const pendingItems = () => adminDb.collection(`clinics/${CLINIC}/pending_items`);

  console.log("=== 1. Insight acima do limiar -> cria pending_item ===");
  {
    const insights = [insight("financeiro-vencidas", GAP_PROMOTION_SCORE_THRESHOLD)];
    const gaps = await checkStandingGaps(adminDb, CLINIC, "financeiro_open", insights);
    check("Retornou 1 gap", gaps.length === 1, `len=${gaps.length}`);

    const gapId = "overdue_financial_risk__standing";
    const snap = await pendingItems().doc(gapId).get();
    check("Doc foi criado", snap.exists);
    const data = snap.data();
    check("status = pending", data?.status === "pending", `status=${data?.status}`);
    check("cognitiveType correto", data?.cognitiveType === "overdue_financial_risk");
    check("type = eliza_cognitive_gap", data?.type === "eliza_cognitive_gap");
    check("dedupeKey = id", data?.dedupeKey === gapId);
    check("insightSnapshot presente com o priorityScore certo", data?.insightSnapshot?.priorityScore === GAP_PROMOTION_SCORE_THRESHOLD);
    check("title veio do insight", data?.title === insights[0].title);

    const allDocs = await pendingItems().get();
    check("Só esse gap existe (stale_open_budgets não foi tocado — não estava nos insights)", allDocs.size === 1, `size=${allDocs.size}`);
  }

  console.log("\n--- 2. Insight abaixo do limiar (49) NÃO cria stale_open_budgets ---");
  {
    const insights = [insight("orcamentos-abertos", GAP_PROMOTION_SCORE_THRESHOLD - 1)];
    const gaps = await checkStandingGaps(adminDb, CLINIC, "financeiro_open", insights);
    check("Não retornou gap novo", gaps.length === 0, `len=${gaps.length}`);
    const snap = await pendingItems().doc("stale_open_budgets__standing").get();
    check("Doc não foi criado", !snap.exists);
  }

  console.log("\n--- 3. Reconfirmação (ainda acima do limiar, título mudou) -> update(), não duplica ---");
  {
    const insights = [insight("financeiro-vencidas", GAP_PROMOTION_SCORE_THRESHOLD + 30)];
    const gaps = await checkStandingGaps(adminDb, CLINIC, "financeiro_open", insights);
    check("Retornou 1 gap", gaps.length === 1);

    const gapId = "overdue_financial_risk__standing";
    const snap = await pendingItems().doc(gapId).get();
    const data = snap.data();
    check("Título atualizado pro novo score", data?.title === insights[0].title, `title=${data?.title}`);
    check("insightSnapshot atualizado", data?.insightSnapshot?.priorityScore === GAP_PROMOTION_SCORE_THRESHOLD + 30);
    check("status continua pending (update não mexeu nisso)", data?.status === "pending");

    const allDocs = await pendingItems().get();
    check("Ainda só 1 doc (não duplicou)", allDocs.size === 1, `size=${allDocs.size}`);
  }

  console.log("\n--- 4. checkStandingGaps('agenda_open', ...) não mexe nos gaps de financeiro_open ---");
  {
    const insights = [insight("recall-candidatos", GAP_PROMOTION_SCORE_THRESHOLD)];
    await checkStandingGaps(adminDb, CLINIC, "agenda_open", insights);
    const finGap = await pendingItems().doc("overdue_financial_risk__standing").get();
    check("Gap de financeiro continua intacto (pending)", finGap.data()?.status === "pending");
    const recallGap = await pendingItems().doc("recall_backlog__standing").get();
    check("Gap novo de agenda foi criado", recallGap.exists && recallGap.data()?.status === "pending");
  }

  console.log("\n--- 5. Insight cai abaixo do limiar -> resolve o gap existente ---");
  {
    const insights = [insight("financeiro-vencidas", GAP_PROMOTION_SCORE_THRESHOLD - 1)];
    const gaps = await checkStandingGaps(adminDb, CLINIC, "financeiro_open", insights);
    check("checkStandingGaps não retorna o gap resolvido na lista", gaps.length === 0, `len=${gaps.length}`);

    const gapId = "overdue_financial_risk__standing";
    const snap = await pendingItems().doc(gapId).get();
    const data = snap.data();
    check("status virou resolved", data?.status === "resolved", `status=${data?.status}`);
    check("resolvedBy = system:self-correction", data?.resolvedBy === "system:self-correction", `resolvedBy=${data?.resolvedBy}`);
    check("resolvedAt presente", !!data?.resolvedAt);
  }

  console.log("\n--- 6. Insight some completamente (não passado no array) -> também resolve ---");
  {
    // recall_backlog está pending desde o passo 4; chamar com insights=[]
    // (nenhum insight desse tipo presente) deve resolver, igual a score baixo.
    await checkStandingGaps(adminDb, CLINIC, "agenda_open", []);
    const snap = await pendingItems().doc("recall_backlog__standing").get();
    check("recall_backlog resolvido quando o insight desaparece do array", snap.data()?.status === "resolved", `status=${snap.data()?.status}`);
  }

  console.log("\n--- 7. Depois de resolved, insight sobe de novo -> REABRE (recorrência real deve renotificar) ---");
  {
    const insights = [insight("financeiro-vencidas", GAP_PROMOTION_SCORE_THRESHOLD + 5)];
    const gaps = await checkStandingGaps(adminDb, CLINIC, "financeiro_open", insights);
    check("Retornou o gap", gaps.length === 1);
    const snap = await pendingItems().doc("overdue_financial_risk__standing").get();
    const data = snap.data();
    check("status voltou a 'pending' (reentra no filtro do onSnapshot, dispara popup de novo)", data?.status === "pending", `status=${data?.status}`);
    check("resolvedAt limpo", data?.resolvedAt === null, `resolvedAt=${data?.resolvedAt}`);
    check("resolvedBy limpo", data?.resolvedBy === null, `resolvedBy=${data?.resolvedBy}`);
  }

  console.log("\n--- 8. priority: severity 'risco' -> 'Alta'; outra severity -> 'Média' ---");
  {
    const CLINIC2 = CLINIC + "-b";
    const riscoInsight = insight("financeiro-vencidas", 80, { severity: "risco" });
    await checkStandingGaps(adminDb, CLINIC2, "financeiro_open", [riscoInsight]);
    const riscoSnap = await adminDb.doc(`clinics/${CLINIC2}/pending_items/overdue_financial_risk__standing`).get();
    check("severity risco -> priority Alta", riscoSnap.data()?.priority === "Alta", `priority=${riscoSnap.data()?.priority}`);

    const oportunidadeInsight = insight("orcamentos-abertos", 80, { severity: "oportunidade" });
    await checkStandingGaps(adminDb, CLINIC2, "financeiro_open", [oportunidadeInsight]);
    const opSnap = await adminDb.doc(`clinics/${CLINIC2}/pending_items/stale_open_budgets__standing`).get();
    check("severity oportunidade -> priority Média", opSnap.data()?.priority === "Média", `priority=${opSnap.data()?.priority}`);
  }

  console.log("\n--- 9. Concorrência: duas chamadas simultâneas pro mesmo gap novo -> exatamente 1 doc, sem lançar ---");
  {
    const CLINIC3 = CLINIC + "-c";
    const insights = [insight("pendencias-operacionais", 90)];
    const [r1, r2] = await Promise.all([
      checkStandingGaps(adminDb, CLINIC3, "agenda_open", insights),
      checkStandingGaps(adminDb, CLINIC3, "agenda_open", insights),
    ]);
    check("Nenhuma das duas chamadas lançou (ambas resolveram, uma via create() outra via update())", true);
    const allDocs = await adminDb.collection(`clinics/${CLINIC3}/pending_items`).get();
    check("Exatamente 1 doc (create() atômico preveniu duplicata)", allDocs.size === 1, `size=${allDocs.size}`);
    const snap = allDocs.docs[0];
    check("status pending", snap.data()?.status === "pending");
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
