/**
 * Adds one synthetic appointment to the emulator's demo-clinic-001,
 * matching Cenário A of the "ELIZA Consciência Ativa" homologation script.
 * Seeded as 'confirmado' on purpose: the gap detector only runs on a live
 * status transition to 'finalizado' made through the Agenda UI
 * (NextAgenda.tsx calls POST /api/eliza/cognitive-events/check-appointment
 * only inside that transition handler) -- it does not re-scan appointments
 * that are already 'finalizado' on load. The tester marks it Finalizado
 * themselves in the browser, which is what actually fires detection.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedCenarioA.mjs
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

async function main() {
  const now = Timestamp.now();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");

  await db.doc(`clinics/${CLINIC_ID}/appointments/appt-004`).set({
    patientId: "patient-001",
    patientName: "João Pereira da Silva",
    date: `${y}-${m}-${d}`,
    time: "11:00",
    status: "confirmado",
    procedure: "Consulta de avaliação",
    staffId: "rnxr7J841dvZ61m1XJyIOmymLWAp",
    staffName: "Dra. Ana Demo",
    duration: 30,
    createdAt: now,
  }, { merge: true });

  console.log("[seed-cenario-a] appt-004 created: confirmado, patient-001 (João Pereira da Silva), no evolution recorded yet. Mark it Finalizado in the Agenda UI to trigger detection.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[seed-cenario-a] FAILED:", err);
  process.exit(1);
});
