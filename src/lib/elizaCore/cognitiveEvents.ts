/**
 * ELIZA Consciência Ativa — Cognitive Events layer.
 *
 * Deliberately separate from insightEngine.ts: the Insight Engine produces
 * analytical insights (patterns/opportunities across the whole clinic's
 * data). This layer produces CognitiveGaps — an operational lacuna tied to
 * one specific real event (here: one appointment) that ELIZA should
 * proactively ask a human about. Both layers are equally deterministic — no
 * AI call happens anywhere in this file — they just answer different
 * questions ("what's worth noticing" vs "what did I just observe that
 * needs a person's input").
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Insight } from "./types";

// Os 4 tipos novos são "standing gaps" — reaproveitam Insight[] já
// calculado por insightEngine.ts, promovidos via insightGapBridge.ts.
// Diferente do tipo original (por appointmentId específico), são por
// clínica+tipo (ver deterministicGapId, sourceEventId="standing").
export type CognitiveEventType =
  | "finished_appointment_without_clinical_update"
  | "overdue_financial_risk"
  | "stale_open_budgets"
  | "recall_backlog"
  | "operational_pending_backlog";

export interface CognitiveGap {
  id: string; // deterministic pending_items doc id — see deterministicGapId()
  type: "eliza_cognitive_gap";
  cognitiveType: CognitiveEventType;
  source: "Eliza Consciência";
  status: "pending" | "resolved";
  clinicId: string;
  patientId: string;
  patientName: string;
  appointmentId: string;
  appointmentTime: string | null;
  professionalName: string | null;
  /** Real member uid, taken from appointment.dentistUid when present — null on appointments created before dentistUid existed, or left unset. */
  professionalUid: string | null;
  missingEvolution: boolean;
  missingConfirmedExecution: boolean;
  pendingPlannedProcedures: { procedureId: string; procedureName: string; planningId: string; versionId: string }[];
  priority: "Alta" | "Média";
  dedupeKey: string;
  sourceEventId: string;
  title: string;
  description: string;
  createdAt: any;
  resolvedAt: any | null;
  resolvedBy: string | null;
  // Só presente nos 4 "standing gaps" (ver insightGapBridge.ts) — o
  // Insight completo que motivou a promoção, pro front renderizar via
  // InsightCard.tsx já existente sem re-buscar nada.
  insightSnapshot?: Insight;
}

// The doc ID IS the dedupe key. Firestore's create() on a specific ID is
// atomic server-side — two concurrent callers can never both succeed, so
// this needs no transaction and no read-then-write race window.
export function deterministicGapId(cognitiveType: CognitiveEventType, sourceEventId: string): string {
  return `${cognitiveType}__${sourceEventId}`;
}

/**
 * Deterministic detector for "atendimento finalizado sem evolução
 * compatível e/ou sem execução confirmada do planejamento vinculado".
 *
 * Idempotent in both directions:
 * - If the gap still applies, ensures exactly one open pending_item exists
 *   (never duplicates, even under concurrent calls, via the atomic create()
 *   below).
 * - If the gap no longer applies (e.g. someone already registered the
 *   evolution) but an earlier run left an open pending_item, resolves it.
 *   Safe to call again for the same appointment at any time.
 */
export async function detectFinishedAppointmentWithoutClinicalUpdate(
  db: Firestore,
  clinicId: string,
  appointmentId: string
): Promise<CognitiveGap | null> {
  const apptSnap = await db.doc(`clinics/${clinicId}/appointments/${appointmentId}`).get();
  if (!apptSnap.exists) return null;
  const appt = apptSnap.data() || {};

  const gapId = deterministicGapId("finished_appointment_without_clinical_update", appointmentId);
  const gapRef = db.doc(`clinics/${clinicId}/pending_items/${gapId}`);

  if (appt.status !== "finalizado") return null;
  const patientId = appt.patientId;
  if (!patientId || typeof patientId !== "string") return null;

  const patientSnap = await db.doc(`clinics/${clinicId}/patients/${patientId}`).get();
  if (!patientSnap.exists) return null;
  const patientName = patientSnap.data()?.name || "Paciente";

  const apptDate: string | undefined = appt.date; // 'YYYY-MM-DD', see NextAgenda.tsx's <input type="date">

  // --- Condição 1: evolução compatível (mesmo dia do atendimento) ---
  let missingEvolution = true;
  if (apptDate) {
    const treatmentsSnap = await db.collection(`clinics/${clinicId}/patients/${patientId}/treatments`).get();
    outer: for (const doc of treatmentsSnap.docs) {
      const evolutions = (doc.data()?.evolutions || []) as { date?: string; voided?: boolean }[];
      for (const ev of evolutions) {
        if (ev.voided) continue;
        const evDay = typeof ev.date === "string" ? ev.date.slice(0, 10) : null;
        if (evDay === apptDate) {
          missingEvolution = false;
          break outer;
        }
      }
    }
  }

  // --- Condição 2: execução confirmed vinculada, só quando há planejamento ---
  const planRef = appt.clinicalPlanRef as { planningId: string; versionId: string; procedureId?: string } | null | undefined;
  let missingConfirmedExecution = false;
  const pendingPlannedProcedures: CognitiveGap["pendingPlannedProcedures"] = [];
  if (planRef?.planningId && planRef?.versionId) {
    const execSnap = await db
      .collection(`clinics/${clinicId}/patients/${patientId}/clinical_plans/${planRef.planningId}/executions`)
      .where("appointmentId", "==", appointmentId)
      .where("status", "==", "confirmed")
      .limit(1)
      .get();
    missingConfirmedExecution = execSnap.empty;
    if (missingConfirmedExecution) {
      const versionSnap = await db
        .doc(`clinics/${clinicId}/patients/${patientId}/clinical_plans/${planRef.planningId}/versions/${planRef.versionId}`)
        .get();
      const procedureName = versionSnap.exists ? versionSnap.data()?.procedureName || "Procedimento planejado" : "Procedimento planejado";
      pendingPlannedProcedures.push({
        procedureId: planRef.procedureId || planRef.planningId,
        procedureName,
        planningId: planRef.planningId,
        versionId: planRef.versionId,
      });
    }
  }

  const gapExists = missingEvolution || missingConfirmedExecution;

  if (!gapExists) {
    const existing = await gapRef.get();
    if (existing.exists && existing.data()?.status === "pending") {
      await resolveCognitiveGap(db, clinicId, gapId, "system:self-correction");
    }
    return null;
  }

  const timeLabel: string | null = appt.time || null;
  const professionalName: string | null = appt.dentistName || null;
  const priority: CognitiveGap["priority"] = missingEvolution && missingConfirmedExecution ? "Alta" : "Média";

  const descriptionParts: string[] = [
    `O atendimento de ${patientName}${timeLabel ? `, finalizado às ${timeLabel},` : ""} ainda está sem evolução registrada.`,
  ];
  if (pendingPlannedProcedures.length > 0) {
    descriptionParts.push(`Encontrei também ${pendingPlannedProcedures.length} procedimento(s) planejado(s) ainda pendente(s).`);
  }
  descriptionParts.push("O que foi realizado hoje?");

  const gap: CognitiveGap = {
    id: gapId,
    type: "eliza_cognitive_gap",
    cognitiveType: "finished_appointment_without_clinical_update",
    source: "Eliza Consciência",
    status: "pending",
    clinicId,
    patientId,
    patientName,
    appointmentId,
    appointmentTime: timeLabel,
    professionalName,
    professionalUid: (appt as any).dentistUid || null,
    missingEvolution,
    missingConfirmedExecution,
    pendingPlannedProcedures,
    priority,
    dedupeKey: gapId,
    sourceEventId: appointmentId,
    title: `Atendimento sem evolução — ${patientName}`,
    description: descriptionParts.join(" "),
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
  };

  try {
    // Atomic: throws if this exact doc ID already exists instead of
    // overwriting — exactly one pending_item can ever exist per appointment,
    // even if two requests race.
    await gapRef.create(gap);
    return gap;
  } catch (err: any) {
    if (err?.code === 6 /* gRPC ALREADY_EXISTS */ || /already exists/i.test(String(err?.message || ""))) {
      const existing = await gapRef.get();
      return existing.exists ? (existing.data() as CognitiveGap) : null;
    }
    throw err;
  }
}

/** Marks a cognitive gap resolved. Safe to call more than once. */
export async function resolveCognitiveGap(db: Firestore, clinicId: string, gapId: string, resolvedBy: string): Promise<void> {
  const ref = db.doc(`clinics/${clinicId}/pending_items/${gapId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (snap.data()?.status === "resolved") return;
  await ref.update({ status: "resolved", resolvedAt: new Date(), resolvedBy });
}
