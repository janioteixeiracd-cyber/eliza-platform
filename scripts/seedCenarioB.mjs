/**
 * Adds synthetic data for Cenário B of the "ELIZA Consciência Ativa"
 * homologation script: a new patient with a real clinical plan (one clearly
 * identified procedure) structurally linked to today's appointment via
 * appointment.clinicalPlanRef, so the propose_clinical_evolution action has
 * a real plannedProcedureName to reason about.
 *
 * Deliberately does NOT write any evolution or any clinical_plans execution
 * doc -- the whole point of this scenario is testing what ELIZA does with
 * "Fiz o que estava planejado" against a patient/appointment that has
 * exactly zero prior clinical writes.
 *
 * The appointment is seeded as 'confirmado' on purpose (same reasoning as
 * seedCenarioA.mjs): the gap detector only runs on a live status transition
 * to 'finalizado' made through the Agenda UI.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedCenarioB.mjs
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
const OWNER_UID = "rnxr7J841dvZ61m1XJyIOmymLWAp"; // Dra. Ana Demo, from seedEmulator.mjs

const PATIENT_ID = "patient-004";
const PLANNING_ID = "plan-b-restauracao-001";
const VERSION_ID = "v1";
const PROCEDURE_ID = "restauracao_dentistica_26";
const PROCEDURE_NAME = "Restauração do dente 26";
const APPOINTMENT_ID = "appt-b-001";

async function main() {
  const now = Timestamp.now();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  // 1. New synthetic patient
  await db.doc(`clinics/${CLINIC_ID}/patients/${PATIENT_ID}`).set({
    name: "Patrícia Andrade Lima",
    cpf: "444.444.444-44",
    birthDate: "1990-06-15",
    phone: "5511999990004",
    email: "patricia.lima@example.com",
    address: "Rua dos Testes, 400",
    status: "active",
    createdAt: now,
  }, { merge: true });

  // 2. Clinical plan (parent doc)
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

  // 3. Clinical plan version — the one clearly identified procedure
  await planRef.collection("versions").doc(VERSION_ID).set({
    versionNumber: 1,
    procedureId: PROCEDURE_ID,
    procedureName: PROCEDURE_NAME,
    category: "dentistica_restauradora",
    images: [],
    structuredFields: {},
    strokesJson: JSON.stringify({ strokes: [], textNotes: [] }),
    overlayThumbnailBase64: null,
    objective: "Restaurar função e estética do dente 26 após lesão de cárie oclusal.",
    clinicalEvaluation: "Cárie oclusal moderada no dente 26, sem sinais de comprometimento pulpar.",
    aiAnalysis: null,
    dataSufficiency: "ok",
    caveats: [],
    stage: "planning",
    professionalId: OWNER_UID,
    professionalName: "Dra. Ana Demo",
    createdAt: now,
  }, { merge: true });

  // 4. Today's appointment, structurally linked to the plan, seeded as
  //    'confirmado' so the tester transitions it to 'finalizado' themselves.
  await db.doc(`clinics/${CLINIC_ID}/appointments/${APPOINTMENT_ID}`).set({
    patientId: PATIENT_ID,
    patientName: "Patrícia Andrade Lima",
    date: dateStr,
    time: "15:00",
    status: "confirmado",
    procedure: PROCEDURE_NAME,
    clinicalPlanRef: { planningId: PLANNING_ID, versionId: VERSION_ID, procedureId: PROCEDURE_ID },
    staffId: OWNER_UID,
    staffName: "Dra. Ana Demo",
    duration: 45,
    createdAt: now,
  }, { merge: true });

  console.log("[seed-cenario-b] Done. No evolution written, no execution written.");
  console.log(`  Paciente: Patrícia Andrade Lima (${PATIENT_ID})`);
  console.log(`  Atendimento: ${APPOINTMENT_ID}, hoje (${dateStr}) 15:00, status inicial 'confirmado'`);
  console.log(`  Planejamento vinculado: ${PLANNING_ID} / versão ${VERSION_ID}`);
  console.log(`  Procedimento planejado: "${PROCEDURE_NAME}" (procedureId: ${PROCEDURE_ID})`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[seed-cenario-b] FAILED:", err);
  process.exit(1);
});
