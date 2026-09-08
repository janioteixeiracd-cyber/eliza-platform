/**
 * Cenário B3 (segunda tentativa, servidor já reiniciado com a correção
 * carregada): novo paciente/atendimento, distinto de Camila/appt-b3-001
 * (cuja proposal incorreta, gerada pelo servidor desatualizado, foi
 * preservada como evidência e não deve ser reutilizada).
 *
 * Mesmo padrão dos seeds anteriores: só plano + versão + atendimento,
 * seedado como 'confirmado' para que a transição real na Agenda dispare a
 * detecção do gap.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedCenarioB3v2.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST not set. This script only runs against the local emulator.");
  process.exit(1);
}

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "elisa-494703";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const CLINIC_ID = "demo-clinic-001";
const OWNER_UID = "PwxKi10wip9zOho02YWIWgap2DNa";

const PATIENT_ID = "patient-007";
const PLANNING_ID = "plan-b3v2-restauracao-001";
const VERSION_ID = "v1";
const PROCEDURE_ID = "restauracao_resina_36_b3v2";
const PROCEDURE_NAME = "Restauração em resina composta do dente 36";
const APPOINTMENT_ID = "appt-b3v2-001";

async function main() {
  const now = Timestamp.now();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  await db.doc(`clinics/${CLINIC_ID}/patients/${PATIENT_ID}`).set({
    name: "Bruno Almeida Rocha",
    cpf: "777.777.777-77",
    birthDate: "1982-09-21",
    phone: "5511999990007",
    email: "bruno.rocha@example.com",
    address: "Rua dos Testes B3v2, 700",
    status: "active",
    createdAt: now,
  }, { merge: true });

  const planRef = db.doc(`clinics/${CLINIC_ID}/patients/${PATIENT_ID}/clinical_plans/${PLANNING_ID}`);
  await planRef.set({
    patientId: PATIENT_ID,
    procedureId: PROCEDURE_ID,
    procedureName: PROCEDURE_NAME,
    category: "dentistica_restauradora",
    currentVersionId: VERSION_ID,
    currentVersionNumber: 1,
    createdAt: now,
    createdBy: OWNER_UID,
    updatedAt: now,
  }, { merge: true });

  await planRef.collection("versions").doc(VERSION_ID).set({
    versionNumber: 1,
    procedureId: PROCEDURE_ID,
    procedureName: PROCEDURE_NAME,
    category: "dentistica_restauradora",
    images: [],
    structuredFields: {},
    strokesJson: JSON.stringify({ strokes: [], textNotes: [] }),
    overlayThumbnailBase64: null,
    objective: "Restaurar função e estética do dente 36 após lesão de cárie oclusal.",
    clinicalEvaluation: "Cárie oclusal moderada no dente 36, sem sinais de comprometimento pulpar.",
    aiAnalysis: null,
    dataSufficiency: "ok",
    caveats: [],
    stage: "planning",
    professionalId: OWNER_UID,
    professionalName: "Dra. Ana Demo",
    createdAt: now,
  }, { merge: true });

  await db.doc(`clinics/${CLINIC_ID}/appointments/${APPOINTMENT_ID}`).set({
    patientId: PATIENT_ID,
    patientName: "Bruno Almeida Rocha",
    date: dateStr,
    time: "18:00",
    status: "confirmado",
    procedure: PROCEDURE_NAME,
    clinicalPlanRef: { planningId: PLANNING_ID, versionId: VERSION_ID, procedureId: PROCEDURE_ID },
    staffId: OWNER_UID,
    staffName: "Dra. Ana Demo",
    duration: 45,
    createdAt: now,
  }, { merge: true });

  console.log("[seed-cenario-b3v2] Done. No evolution written, no execution written, no gap, no proposal.");
  console.log(`  Paciente: Bruno Almeida Rocha (${PATIENT_ID})`);
  console.log(`  Atendimento: ${APPOINTMENT_ID}, hoje (${dateStr}) 18:00, status inicial 'confirmado'`);
  console.log(`  Planejamento vinculado: ${PLANNING_ID} / versão ${VERSION_ID}`);
  console.log(`  Procedimento planejado: "${PROCEDURE_NAME}" (procedureId: ${PROCEDURE_ID})`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[seed-cenario-b3v2] FAILED:", err);
  process.exit(1);
});
