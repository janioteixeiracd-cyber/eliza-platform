/**
 * Ponte entre insightEngine.ts (Insight[] já calculado, determinístico,
 * zero Firestore/IA) e cognitiveEvents.ts (pending_items reais, que
 * disparam proatividade visível — ver ElizaAssistantContext.tsx). Não
 * inventa nenhuma detecção nova: só decide, com um limiar fixo sobre o
 * priorityScore que o motor já calcula, se um insight de alta relevância
 * vira um gap "de estado permanente" da clínica (diferente do gap por
 * atendimento em cognitiveEvents.ts, que é por appointmentId específico).
 *
 * Deliberadamente separado de insightEngine.ts (que não deve saber de
 * Firestore/escrita) e de cognitiveEvents.ts (hoje só sobre o evento
 * único de atendimento finalizado).
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Insight } from "./types";
import type { CognitiveEventType, CognitiveGap } from "./cognitiveEvents";
import { deterministicGapId, resolveCognitiveGap } from "./cognitiveEvents";

export const GAP_PROMOTION_SCORE_THRESHOLD = 50;

export type StandingCheckpoint = "financeiro_open" | "agenda_open";

interface StandingGapRule {
  cognitiveType: CognitiveEventType;
  insightId: string;
  checkpoint: StandingCheckpoint;
}

const STANDING_GAP_RULES: StandingGapRule[] = [
  { cognitiveType: "overdue_financial_risk", insightId: "financeiro-vencidas", checkpoint: "financeiro_open" },
  { cognitiveType: "stale_open_budgets", insightId: "orcamentos-abertos", checkpoint: "financeiro_open" },
  { cognitiveType: "recall_backlog", insightId: "recall-candidatos", checkpoint: "agenda_open" },
  { cognitiveType: "operational_pending_backlog", insightId: "pendencias-operacionais", checkpoint: "agenda_open" },
];

// Extraída como função pura só pra ser testável sem Firestore (ver
// scripts/verifyElizaGapPromotion.mjs) — nunca inventa um segundo cálculo
// de relevância, só lê o priorityScore que o motor já produziu.
export function shouldPromoteGap(insight: Insight | undefined): boolean {
  return !!insight && insight.priorityScore >= GAP_PROMOTION_SCORE_THRESHOLD;
}

// "standing" — não há uma entidade (appointmentId) por trás, é um estado
// da clínica como um todo: um único gap por clinicId por cognitiveType.
function standingGapId(cognitiveType: CognitiveEventType): string {
  return deterministicGapId(cognitiveType, "standing");
}

/**
 * Reavalia os gaps "de estado permanente" de um checkpoint específico.
 * Idempotente nos dois sentidos, mesmo espírito de
 * detectFinishedAppointmentWithoutClinicalUpdate:
 * - Se o insight cruza o limiar, garante exatamente um pending_item aberto
 *   (create() atômico na primeira vez; update() nas seguintes, pra manter
 *   o snapshot em dia sem duplicar).
 * - Se deixou de cruzar e existe um pending_item aberto, resolve.
 */
export async function checkStandingGaps(
  db: Firestore,
  clinicId: string,
  checkpoint: StandingCheckpoint,
  insights: Insight[]
): Promise<CognitiveGap[]> {
  const results: CognitiveGap[] = [];

  for (const rule of STANDING_GAP_RULES.filter((r) => r.checkpoint === checkpoint)) {
    const insight = insights.find((i) => i.id === rule.insightId);
    const gapId = standingGapId(rule.cognitiveType);
    const gapRef = db.doc(`clinics/${clinicId}/pending_items/${gapId}`);

    if (shouldPromoteGap(insight)) {
      const gap: CognitiveGap = {
        id: gapId,
        type: "eliza_cognitive_gap",
        cognitiveType: rule.cognitiveType,
        source: "Eliza Consciência",
        status: "pending",
        clinicId,
        patientId: "",
        patientName: "",
        appointmentId: "",
        appointmentTime: null,
        professionalName: null,
        professionalUid: null,
        missingEvolution: false,
        missingConfirmedExecution: false,
        pendingPlannedProcedures: [],
        priority: insight!.severity === "risco" ? "Alta" : "Média",
        dedupeKey: gapId,
        sourceEventId: "standing",
        title: insight!.title,
        description: insight!.description,
        createdAt: new Date(),
        resolvedAt: null,
        resolvedBy: null,
        insightSnapshot: insight,
      };

      try {
        // Primeira vez: dispara o onSnapshot 'added' que abre o popup.
        await gapRef.create(gap);
        results.push(gap);
      } catch (err: any) {
        if (err?.code === 6 /* gRPC ALREADY_EXISTS */ || /already exists/i.test(String(err?.message || ""))) {
          // Já existe — atualiza o snapshot/prioridade e garante 'pending'.
          // Standing gaps hoje só são resolvidos por auto-correção do
          // sistema (nenhum fluxo de dismissal manual existe pra esses 4
          // tipos ainda) — então, se a condição voltou a cruzar o limiar
          // depois de ter sido auto-resolvida, isso é uma recorrência real
          // e precisa reabrir (reentra no filtro status=='pending' do
          // onSnapshot, disparando o popup de novo). Se no futuro existir
          // dismissal manual pra standing gaps, essa reabertura precisará
          // respeitar isso (ex.: checar resolvedBy !== uid humano).
          await gapRef.update({
            insightSnapshot: insight, title: insight!.title, description: insight!.description, priority: gap.priority,
            status: "pending", resolvedAt: null, resolvedBy: null,
          });
          results.push(gap);
        } else {
          throw err;
        }
      }
    } else {
      const existing = await gapRef.get();
      if (existing.exists && existing.data()?.status === "pending") {
        await resolveCognitiveGap(db, clinicId, gapId, "system:self-correction");
      }
    }
  }

  return results;
}
