/**
 * Fase A (catálogo de tratamentos + profissional real no Orçamento/Agendamento)
 * — verificação contra o Firestore emulator via client SDK, provando que:
 *
 *  1. A regra de `treatment_catalog` continua exatamente como antes desta
 *     fase (leitura por qualquer membro da clínica, escrita só admin/owner)
 *     — a Fase A não tocou em firestore.rules, isto é só uma confirmação.
 *  2. Um membro comum (sem ser admin) consegue ler `clinics/{id}/members`
 *     — necessário pro hook useClinicalProviders funcionar pra qualquer
 *     usuário logado, não só admins.
 *  3. `quotations` aceita um doc "antigo" simulado (sem professionalUid/
 *     professionalName/paymentMethod/installments) tanto pra leitura quanto
 *     pra escrita — os campos novos nunca viram exigência de regra, só de
 *     validação client-side.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyFaseATreatmentCatalogAndProfessional.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, getDocs, collection, serverTimestamp } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

const apps = [];
async function clientAs(email) {
  const app = initializeApp(firebaseConfig, `FA_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  let user;
  try { user = (await createUserWithEmailAndPassword(auth, email, "TestPass123!")).user; }
  catch (err) {
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
  const CLINIC = "fasea-clinic-" + Date.now();

  console.log("=== Seeding fixtures ===");
  const admin1 = await clientAs("fasea.admin@verify.local");
  const member = await clientAs("fasea.member@verify.local");
  const provider = await clientAs("fasea.provider@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Fase A", ownerId: admin1.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${admin1.uid}`).set({ uid: admin1.uid, role: "admin", status: "active", active: true, name: "Admin" });
  await adminDb.doc(`clinics/${CLINIC}/members/${member.uid}`).set({ uid: member.uid, role: "member", status: "active", active: true, name: "Secretária", isClinicalProvider: false });
  await adminDb.doc(`clinics/${CLINIC}/members/${provider.uid}`).set({ uid: provider.uid, role: "member", status: "active", active: true, name: "Dra. Ana", isClinicalProvider: true });

  console.log("\n--- 1. Regra de treatment_catalog: leitura livre, escrita só admin/owner ---");
  const catalogRef = doc(member.db, "clinics", CLINIC, "treatment_catalog", "treat-1");
  await expectAllowed(getDocs(collection(member.db, "clinics", CLINIC, "treatment_catalog")), "Membro comum lê treatment_catalog (coleção vazia, mas sem permission-denied)");
  await expectDenied(
    setDoc(catalogRef, { name: "Toxina Botulínica", category: "Harmonização Facial", subcategory: "Toxina", defaultPrice: 1200, description: "", estimatedDuration: 30, requiresFaces: false, requiresRegion: false, active: true }),
    "Membro comum ESCREVE em treatment_catalog"
  );
  const catalogRefAsAdmin = doc(admin1.db, "clinics", CLINIC, "treatment_catalog", "treat-1");
  await expectAllowed(
    setDoc(catalogRefAsAdmin, { name: "Toxina Botulínica", category: "Harmonização Facial", subcategory: "Toxina", defaultPrice: 1200, description: "", estimatedDuration: 30, requiresFaces: false, requiresRegion: false, active: true, updatedAt: serverTimestamp() }),
    "Admin ESCREVE em treatment_catalog"
  );
  await expectAllowed(getDoc(doc(provider.db, "clinics", CLINIC, "treatment_catalog", "treat-1")), "Profissional clínico lê o item recém-criado");

  console.log("\n--- 2. Membro comum (não-admin) lê clinics/{id}/members (necessário pro useClinicalProviders) ---");
  await expectAllowed(getDocs(collection(member.db, "clinics", CLINIC, "members")), "Secretária lê a lista de membros da clínica");
  await expectAllowed(getDocs(collection(provider.db, "clinics", CLINIC, "members")), "Profissional clínico lê a lista de membros da clínica");

  console.log("\n--- 3. quotations aceita doc 'antigo' (sem professionalUid/paymentMethod/installments) ---");
  const patientId = "patient-1";
  await adminDb.doc(`clinics/${CLINIC}/patients/${patientId}`).set({ name: "Paciente Teste" });
  const oldStyleQuotationRef = doc(provider.db, "clinics", CLINIC, "patients", patientId, "quotations", "q-old");
  await expectAllowed(
    setDoc(oldStyleQuotationRef, {
      title: "Orçamento antigo (pré-Fase A)",
      items: [{ description: "Consulta", value: 150, quantity: 1 }], // sem professionalUid/professionalName
      status: "draft",
      totalValue: 150,
      createdAt: serverTimestamp(),
    }),
    "Grava orçamento sem professionalUid/paymentMethod/installments (regra não exige)"
  );
  await expectAllowed(getDoc(oldStyleQuotationRef), "Lê de volta o orçamento 'antigo' sem erro");
  await expectAllowed(
    updateDoc(oldStyleQuotationRef, {
      items: [{ description: "Consulta", value: 150, quantity: 1, professionalUid: provider.uid, professionalName: "Dra. Ana" }],
      paymentMethod: "PIX",
      installments: 1,
    }),
    "Atualiza o orçamento 'antigo' adicionando os campos novos da Fase A"
  );

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exit(1);
});
