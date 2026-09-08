/**
 * Prova, empiricamente contra o emulador, o comportamento das novas regras
 * de firestore.rules pra WhatsApp Embedded Signup (plano
 * vast-yawning-hamster.md v4, emenda #1 do bloqueador de regras
 * sobrepostas): membro comum e owner IGUALMENTE não conseguem escrever
 * direto em integrations/whatsapp (só Admin SDK); membro comum consegue ler
 * o doc sanitizado whatsapp_status mas não o completo; coleções
 * server-only (whatsapp_connection_attempts, whatsapp_processed_events,
 * whatsapp_phone_index) ficam totalmente fechadas pro client; e um caminho
 * irmão não tocado (patients) continua funcionando como antes — prova de
 * que a exclusão do coringa não teve efeito colateral.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppEmbeddedSignupRules.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();

let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}`); fail++; }
}

const apps = [];
async function clientAs(email) {
  const app = initializeApp(firebaseConfig, `WAER_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  let user;
  try {
    user = (await createUserWithEmailAndPassword(auth, email, "TestPass123!")).user;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") user = (await signInWithEmailAndPassword(auth, email, "TestPass123!")).user;
    else throw err;
  }
  return { db, uid: user.uid };
}

async function expectDenied(promise, label) {
  try { await promise; check(label, false); }
  catch (err) { check(`${label} (${err.code || err.message})`, err.code === "permission-denied" || /permission/i.test(String(err.message))); }
}
async function expectAllowed(promise, label) {
  try { await promise; check(label, true); }
  catch (err) { check(`${label} — unexpected error: ${err.code || err.message}`, false); }
}

async function main() {
  const CLINIC = "waer-clinic-a";

  console.log("=== Seeding fixtures ===");
  const member = await clientAs("waer.member@verify.local"); // plain member, no admin role
  const owner = await clientAs("waer.owner@verify.local"); // real owner of the clinic

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Teste WAER", ownerId: owner.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${member.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/members/${owner.uid}`).set({ role: "owner", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/pending_items/seed1`).set({ title: "Seed pending item", status: "pending" });

  // Seed real via Admin SDK (bypassa regras) — exatamente o caminho que a
  // implementação real usará (server-side, nunca client).
  await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).set({
    status: "conectado", provider: "meta", phoneNumberId: "123", wabaId: "456",
    accessTokenSecretName: "eliza-wa-token-waer-clinic-a", accessTokenSecretVersion: "1",
  });
  await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).set({
    status: "conectado", provider: "meta", displayPhoneNumber: "5511999990000",
  });
  console.log("=== Fixtures ready ===\n");

  console.log("--- 1. Membro comum: NÃO consegue ler o doc completo (só owner/admin) ---");
  await expectDenied(getDoc(doc(member.db, "clinics", CLINIC, "integrations", "whatsapp")), "Membro comum lê integrations/whatsapp");

  console.log("\n--- 2. Membro comum: CONSEGUE ler o doc sanitizado (whatsapp_status) ---");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC, "integrations", "whatsapp_status")), "Membro comum lê integrations/whatsapp_status");

  console.log("\n--- 3. Membro comum: escrita negada em ambos ---");
  await expectDenied(setDoc(doc(member.db, "clinics", CLINIC, "integrations", "whatsapp"), { status: "conectado" }, { merge: true }), "Membro comum grava integrations/whatsapp");
  await expectDenied(updateDoc(doc(member.db, "clinics", CLINIC, "integrations", "whatsapp_status"), { status: "erro" }), "Membro comum grava integrations/whatsapp_status");
  await expectDenied(deleteDoc(doc(member.db, "clinics", CLINIC, "integrations", "whatsapp")), "Membro comum apaga integrations/whatsapp");

  console.log("\n--- 4. Owner: LÊ o doc completo normalmente ---");
  await expectAllowed(getDoc(doc(owner.db, "clinics", CLINIC, "integrations", "whatsapp")), "Owner lê integrations/whatsapp");

  console.log("\n--- 5. Owner: escrita direta TAMBÉM negada (só Admin SDK, mesmo pra quem tem o cargo certo) ---");
  await expectDenied(setDoc(doc(owner.db, "clinics", CLINIC, "integrations", "whatsapp"), { status: "conectado" }, { merge: true }), "Owner grava integrations/whatsapp direto");
  await expectDenied(deleteDoc(doc(owner.db, "clinics", CLINIC, "integrations", "whatsapp")), "Owner apaga integrations/whatsapp direto");

  console.log("\n--- 6. Coleções server-only totalmente fechadas pro client, mesmo pro owner ---");
  await expectDenied(getDoc(doc(member.db, "clinics", CLINIC, "whatsapp_connection_attempts", "att1")), "Membro lê whatsapp_connection_attempts");
  await expectDenied(getDoc(doc(owner.db, "clinics", CLINIC, "whatsapp_connection_attempts", "att1")), "Owner lê whatsapp_connection_attempts");
  await expectDenied(getDoc(doc(member.db, "clinics", CLINIC, "whatsapp_processed_events", "evt1")), "Membro lê whatsapp_processed_events");
  await expectDenied(getDoc(doc(owner.db, "whatsapp_phone_index", "5511999990000")), "Owner lê whatsapp_phone_index (top-level)");

  console.log("\n--- 7. Confirmação: caminho irmão não excluído do coringa continua funcionando (zero efeito colateral) ---");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC, "pending_items", "seed1")), "Membro lê pending_items (não tocado por esta mudança)");
  await expectAllowed(setDoc(doc(member.db, "clinics", CLINIC, "pending_items", "seed2"), { title: "Novo", status: "pending" }), "Membro cria pending_item (não tocado)");

  // ---- 8. whatsapp_settings/config (rodada de production-readiness) ----
  // Preferências não-sensíveis do painel manual (defaultSendMode etc.) —
  // consumidas por MedicalRecordView.tsx pra decidir Enviar pela ELIZA vs
  // WhatsApp externo, pra QUALQUER membro (não é config sensível, é
  // operacional). Escrita, por outro lado, só Admin SDK (mesma disciplina
  // do resto — o coringa deixava QUALQUER membro sobrescrever antes desta
  // rodada, sem validação nenhuma).
  await adminDb.doc(`clinics/${CLINIC}/whatsapp_settings/config`).set({
    apiNumber: "5511999990000", legacyClinicNumber: "5511988880000",
    defaultSendMode: "eliza_api", allowOpenExternalWhatsApp: true,
  });
  console.log("\n--- 8. whatsapp_settings/config: leitura pra qualquer membro, escrita só Admin SDK ---");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC, "whatsapp_settings", "config")), "Membro comum LÊ whatsapp_settings/config (defaultSendMode alimenta um botão operacional de toda a equipe)");
  await expectAllowed(getDoc(doc(owner.db, "clinics", CLINIC, "whatsapp_settings", "config")), "Owner lê whatsapp_settings/config");
  await expectDenied(setDoc(doc(member.db, "clinics", CLINIC, "whatsapp_settings", "config"), { defaultSendMode: "open_whatsapp" }, { merge: true }), "Membro comum grava whatsapp_settings/config (negado — coringa dava escrita antes desta rodada)");
  await expectDenied(setDoc(doc(owner.db, "clinics", CLINIC, "whatsapp_settings", "config"), { defaultSendMode: "open_whatsapp" }, { merge: true }), "Owner grava whatsapp_settings/config direto (negado — só Admin SDK via /api/whatsapp/manual-config)");

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Audit script crashed:", err);
  process.exit(1);
});
