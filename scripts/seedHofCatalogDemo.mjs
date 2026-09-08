/**
 * Seeds procedure_catalog entries for Toxina Botulínica / Preenchimento
 * Facial into the demo clinic, for testing the real-patient Clinical
 * Learning Workspace wiring (Planejamento -> Execução) in the emulator.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedHofCatalogDemo.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}
initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "elisa-494703" });
const db = getFirestore();

const CLINIC_ID = "demo-clinic-001";

async function main() {
  const entries = [
    { id: "hof_toxina_botulinica", name: "Toxina Botulínica", templateId: "toxina_botulinica" },
    { id: "hof_preenchimento_facial", name: "Preenchimento Facial", templateId: "preenchimento_facial" },
  ];
  for (const e of entries) {
    await db.doc(`clinics/${CLINIC_ID}/procedure_catalog/${e.id}`).set({
      procedureId: e.id,
      category: "harmonizacao_orofacial",
      name: e.name,
      active: true,
      templateId: e.templateId,
    });
    console.log(`[seed] procedure_catalog/${e.id} created`);
  }
  process.exit(0);
}
main();
