/**
 * Adds synthetic data for the Cenário B3 homologation (multi-turn
 * conversation on the same cognitive gap: question -> insufficient answer
 * -> real clinical description). Brand-new patient/appointment, distinct
 * tooth from B1/B2, never reusing Patrícia/Rafael or their scenarios.
 *
 * Same reasoning as seedCenarioB.mjs/seedCenarioB2.mjs: writes only the
 * plan + version + appointment (no evolution stub, no gap, no proposal),
 * seeded as 'confirmado' so the real status-change handler in the Agenda UI
 * is what fires cognitive-gap detection.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedCenarioB3.mjs
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
const OWNER_UID = "PwxKi10wip9zOho02YWIWgap2DNa"; // current demo user, post-restart

const PATIENT_ID = "patient-006";
const PLANNING_ID = "plan-b3-restauracao-001";
const VERSION_ID = "v1";
const PROCEDURE_ID = "restauracao_resina_46_b3";
const PROCEDURE_NAME = "Restauração em resina composta do dente 46";
const APPOINTMENT_ID = "appt-b3-001";

async function main() {
  const now = Timestamp.now();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  await db.doc(`clinics/${CLINIC_ID}/patients/${PATIENT_ID}`).set({
    name: "Camila Ferreira Duarte",
    cpf: "666.666.666-66",
    birthDate: "1995-11-03",
    phone: "5511999990006",
    email: "camila.duarte@example.com",
    address: "Rua dos Testes B3, 600",
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
    objective: "Restaurar função e estética do dente 46 após lesão de cárie oclusal.",
    clinicalEvaluation: "Cárie oclusal moderada no dente 46, sem sinais de comprometimento pulpar.",
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
    patientName: "Camila Ferreira Duarte",
    date: dateStr,
    time: "17:00",
    status: "confirmado",
    procedure: PROCEDURE_NAME,
    clinicalPlanRef: { planningId: PLANNING_ID, versionId: VERSION_ID, procedureId: PROCEDURE_ID },
    staffId: OWNER_UID,
    staffName: "Dra. Ana Demo",
    duration: 45,
    createdAt: now,
  }, { merge: true });

  console.log("[seed-cenario-b3] Done. No evolution written, no execution written, no gap, no proposal.");
  console.log(`  Paciente: Camila Ferreira Duarte (${PATIENT_ID})`);
  console.log(`  Atendimento: ${APPOINTMENT_ID}, hoje (${dateStr}) 17:00, status inicial 'confirmado'`);
  console.log(`  Planejamento vinculado: ${PLANNING_ID} / versão ${VERSION_ID}`);
  console.log(`  Procedimento planejado: "${PROCEDURE_NAME}" (procedureId: ${PROCEDURE_ID})`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[seed-cenario-b3] FAILED:", err);
  process.exit(1);
});
