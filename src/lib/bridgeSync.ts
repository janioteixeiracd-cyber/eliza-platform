import type { Firestore, FieldValue as FieldValueType } from "firebase-admin/firestore";

/**
 * Escrita real da Simples Dental Bridge (ADR 0003 do repositório da Bridge).
 * Nunca toca campo de identidade do paciente (nome/CPF/telefone/prontuário)
 * — só cria/atualiza agendamento e lançamento financeiro, sempre referenciando
 * um `patientId` já existente e confirmado. Schema espelha exatamente o que
 * `CalendarView.tsx`/`PatientMigrationWizard.tsx` já escrevem hoje via UI —
 * não é um formato novo inventado à parte.
 *
 * Idempotência: `bridgeSourceId` (agendamento, id estável da consulta no
 * Simples Dental) / `bridgeIdempotencyKey` (financeiro, sem id estável do
 * lado Simples) identificam o documento já criado por uma sincronização
 * anterior — reenviar o mesmo evento faz `update`, nunca duplica.
 *
 * `staffId` fica de fora de propósito: a Bridge só tem o NOME do
 * profissional do Simples Dental, nunca o id real do funcionário na ELIZA —
 * mapear nome→staffId com segurança (evitando colisão de nomes) é um
 * problema separado, não resolvido aqui. Views que dependem de `staffId`
 * pra filtrar por profissional podem não mostrar corretamente um
 * agendamento criado pela Bridge até isso ser resolvido — limitação real,
 * documentada, não escondida.
 */

export interface BridgeSyncResult {
  action: "created" | "updated";
  docId: string;
}

export class BridgePatientNotFoundError extends Error {
  constructor(clinicId: string, patientId: string) {
    super(`Paciente ${patientId} não encontrado na clínica ${clinicId} — não é possível sincronizar sem um paciente real já confirmado.`);
    this.name = "BridgePatientNotFoundError";
  }
}

export interface BridgeAppointmentSyncPayload {
  bridgeSourceId: string;
  patientId: string;
  scheduledDate: string;
  scheduledTime: string;
  estimatedMinutes: number;
  professionalName: string;
  chairName: string | null;
}

export async function upsertAppointmentFromBridge(
  db: Firestore,
  fieldValue: typeof FieldValueType,
  clinicId: string,
  payload: BridgeAppointmentSyncPayload
): Promise<BridgeSyncResult> {
  const patientRef = db.doc(`clinics/${clinicId}/patients/${payload.patientId}`);
  const patientSnap = await patientRef.get();
  if (!patientSnap.exists) throw new BridgePatientNotFoundError(clinicId, payload.patientId);
  const patientName = (patientSnap.data() || {}).name || "";

  const apptsCol = db.collection(`clinics/${clinicId}/appointments`);
  const existingSnap = await apptsCol.where("bridgeSourceId", "==", payload.bridgeSourceId).limit(1).get();

  const docData: Record<string, unknown> = {
    patientId: payload.patientId,
    patientName,
    date: payload.scheduledDate,
    time: payload.scheduledTime,
    duration: payload.estimatedMinutes,
    staffName: payload.professionalName,
    chair: payload.chairName ?? null,
    procedure: "",
    status: "pendente",
    bridgeSourceId: payload.bridgeSourceId,
    source: "simples_dental_bridge",
    observations: "[BRIDGE_SYNC] Sincronizado automaticamente do Simples Dental.",
    createdBy: "bridge-sync",
    createdByName: "Simples Dental Bridge (automático)",
  };

  if (!existingSnap.empty) {
    const ref = existingSnap.docs[0]!.ref;
    await ref.update({ ...docData, updatedAt: fieldValue.serverTimestamp() });
    return { action: "updated", docId: ref.id };
  }
  const ref = await apptsCol.add({ ...docData, createdAt: fieldValue.serverTimestamp() });
  return { action: "created", docId: ref.id };
}

export interface BridgeFinancialEntrySyncPayload {
  bridgeIdempotencyKey: string;
  patientId: string;
  tipo: string;
  categoria: string | null;
  valor: number;
  situacao: string;
  dataPagamento: string | null;
  valorPago: number | null;
}

const SITUACAO_TO_ELIZA_STATUS: Record<string, string> = {
  pago: "pago",
  parcial: "parcial",
  pendente: "pendente",
};

export async function upsertFinancialEntryFromBridge(
  db: Firestore,
  fieldValue: typeof FieldValueType,
  clinicId: string,
  payload: BridgeFinancialEntrySyncPayload
): Promise<BridgeSyncResult> {
  const patientRef = db.doc(`clinics/${clinicId}/patients/${payload.patientId}`);
  const patientSnap = await patientRef.get();
  if (!patientSnap.exists) throw new BridgePatientNotFoundError(clinicId, payload.patientId);
  const patientName = (patientSnap.data() || {}).name || "";

  const entriesCol = db.collection(`clinics/${clinicId}/financial_entries`);
  const existingSnap = await entriesCol.where("bridgeIdempotencyKey", "==", payload.bridgeIdempotencyKey).limit(1).get();

  const status = SITUACAO_TO_ELIZA_STATUS[payload.situacao.toLowerCase()] ?? "pendente";
  const docData: Record<string, unknown> = {
    type: "receita",
    category: payload.categoria || "Simples Dental",
    patientId: payload.patientId,
    patient_id: payload.patientId,
    patientName,
    patient_name: patientName,
    description: `Lançamento sincronizado do Simples Dental (${payload.tipo})`,
    amount: payload.valor,
    value: payload.valor,
    paidAmount: payload.valorPago ?? 0,
    paid_amount: payload.valorPago ?? 0,
    status,
    dueDate: payload.dataPagamento ?? null,
    due_date: payload.dataPagamento ?? null,
    date: payload.dataPagamento ?? null,
    bridgeIdempotencyKey: payload.bridgeIdempotencyKey,
    source: "simples_dental_bridge",
    notes: "[BRIDGE_SYNC] Sincronizado automaticamente do Simples Dental.",
    createdBy: "bridge-sync",
  };

  let docId: string;
  let action: "created" | "updated";
  if (!existingSnap.empty) {
    const ref = existingSnap.docs[0]!.ref;
    await ref.update({ ...docData, updatedAt: fieldValue.serverTimestamp() });
    docId = ref.id;
    action = "updated";
  } else {
    const ref = await entriesCol.add({ ...docData, createdAt: fieldValue.serverTimestamp() });
    docId = ref.id;
    action = "created";
  }

  // Dual-write compatibility com o padrão já usado em PatientMigrationWizard.tsx —
  // algumas telas leem o financeiro pela subcoleção do paciente, não só a coleção top-level.
  await db.doc(`clinics/${clinicId}/patients/${payload.patientId}/financial/${docId}`).set(
    {
      description: docData.description,
      value: payload.valor,
      amount: payload.valor,
      status: status === "pago" ? "received" : "pending",
      category: docData.category,
      date: payload.dataPagamento ?? null,
      bridgeSynced: true,
    },
    { merge: true }
  );

  return { action, docId };
}
