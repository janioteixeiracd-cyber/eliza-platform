/**
 * Seeds a small synthetic (non-real) test photo into a demo patient's
 * Imagens gallery, so Planejamento IA / Execução can be exercised
 * end-to-end in the emulator without needing the browser's native file
 * picker (which browser automation can't drive). Uses the already-approved
 * anatomical illustration asset, downsized well under the app's 800KB
 * client-side limit. NEVER touches production — refuses without emulator
 * env vars.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedSyntheticPatientPhoto.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import sharp from "sharp";
import { readFileSync } from "fs";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}
initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "elisa-494703" });
const db = getFirestore();

const CLINIC_ID = "demo-clinic-001";
const PATIENT_ID = "patient-001";

async function main() {
  const resized = await sharp("public/academy/anatomia-facial-feminino.png")
    .resize(500)
    .jpeg({ quality: 70 })
    .toBuffer();
  console.log(`[seed] resized image: ${(resized.length / 1024).toFixed(0)}KB`);
  const base64 = `data:image/jpeg;base64,${resized.toString("base64")}`;
  const id = `img-synthetic-test-${Date.now()}`;
  await db.doc(`clinics/${CLINIC_ID}/patients/${PATIENT_ID}/images/${id}`).set({
    title: "Foto sintética de teste (Clinical Learning Workspace)",
    category: "Exame/Foto",
    description: "Imagem de teste não real, usada só para verificar o workspace clínico no emulador.",
    url: base64,
    date: FieldValue.serverTimestamp(),
  });
  console.log(`[seed] images/${id} created for ${PATIENT_ID}`);
  process.exit(0);
}
main();
