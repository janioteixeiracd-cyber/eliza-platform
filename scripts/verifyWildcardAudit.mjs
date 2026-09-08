/**
 * Audit of the firestore.rules generic wildcard (`match /{subcollection=**}`
 * under clinics/{clinicId}) after the Slice 2A exclusion was added. Proves,
 * empirically against the emulator, both that nothing regressed for
 * collections that legitimately rely on the wildcard, AND that two
 * pre-existing (not introduced by Slice 2A) gaps really exist — never take
 * "should be fine" on faith for a rules change.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWildcardAudit.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `WCA_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
// For findings we EXPECT to still be open (pre-existing, not fixed here) —
// inverse of expectDenied: proves the gap is real, not assumed.
async function expectAllowedFinding(promise, label) {
  try { await promise; check(`[ACHADO CONFIRMADO] ${label}`, true); }
  catch (err) { check(`[achado NÃO reproduzido — pode já estar corrigido] ${label} (${err.code || err.message})`, false); }
}

async function main() {
  const CLINIC_A = "wca-clinic-a";
  const CLINIC_B = "wca-clinic-b";

  console.log("=== Seeding fixtures ===");
  const memberA = await clientAs("wca.member.a@verify.local"); // plain member, no admin role
  const memberB = await clientAs("wca.member.b@verify.local"); // plain member of a DIFFERENT clinic
  const studentOnlyA = await clientAs("wca.studentonly.a@verify.local"); // education_students doc, NO members doc
  const clinicalProviderA = await clientAs("wca.provider.a@verify.local"); // isClinicalProvider, for the executions finding

  await adminDb.doc(`clinics/${CLINIC_A}/members/${memberA.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_B}/members/${memberB.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${clinicalProviderA.uid}`).set({ role: "member", status: "active", active: true, isClinicalProvider: true });
  await adminDb.doc(`clinics/${CLINIC_A}/education_students/${studentOnlyA.uid}`).set({ authUid: studentOnlyA.uid, name: "Student Only", status: "ativo" });

  await adminDb.doc(`clinics/${CLINIC_A}/pending_items/seed1`).set({ title: "Seed pending item", status: "pending" });

  const patientA = await adminDb.collection(`clinics/${CLINIC_A}/patients`).add({ name: "Paciente Teste WCA" });
  const planA = await adminDb.collection(`clinics/${CLINIC_A}/patients/${patientA.id}/clinical_plans`).add({ procedureName: "Toxina" });
  const execA = await adminDb.collection(`clinics/${CLINIC_A}/patients/${patientA.id}/clinical_plans/${planA.id}/executions`).add({
    status: "confirmed", startedBy: clinicalProviderA.uid, structuredFields: {},
  });
  await adminDb.doc(`clinics/${CLINIC_A}/billing/subscription`).set({ status: "active", planId: "assistant" });
  console.log("=== Fixtures ready ===\n");

  // ------------------------------------------------------------
  console.log("--- 1. Membro válido continua acessando fluxo existente que depende do coringa (pending_items) ---");
  await expectAllowed(getDoc(doc(memberA.db, "clinics", CLINIC_A, "pending_items", "seed1")), "Membro lê pending_items da própria clínica (bucket A, via wildcard)");
  await expectAllowed(
    setDoc(doc(memberA.db, "clinics", CLINIC_A, "pending_items", "seed2"), { title: "Novo item", status: "pending" }),
    "Membro cria pending_item na própria clínica (via wildcard)"
  );

  console.log("\n--- 2. Usuário de outra clínica continua negado ---");
  await expectDenied(getDoc(doc(memberB.db, "clinics", CLINIC_A, "pending_items", "seed1")), "Membro da Clínica B lê pending_items da Clínica A");
  await expectDenied(getDoc(doc(memberB.db, "clinics", CLINIC_A, "patients", patientA.id)), "Membro da Clínica B lê paciente da Clínica A");

  console.log("\n--- 3. Aluna sem doc de membro (só education_students) NÃO ganha acesso por isClinicMember ---");
  await expectDenied(getDoc(doc(studentOnlyA.db, "clinics", CLINIC_A, "pending_items", "seed1")), "Aluna pura (sem members doc) lê pending_items via wildcard");
  await expectDenied(getDoc(doc(studentOnlyA.db, "clinics", CLINIC_A, "billing", "subscription")), "Aluna pura lê billing (bucket sensível)");

  console.log("\n--- 4. Coleção clínica real e não-nomeada (patients) continua funcionando pra membro (nada quebrou) ---");
  await expectAllowed(getDoc(doc(memberA.db, "clinics", CLINIC_A, "patients", patientA.id)), "Membro lê paciente real da própria clínica (bucket B puro, via wildcard)");

  console.log("\n--- 5. ACHADO: execução clínica CONFIRMADA (imutável por design) ainda pode ser alterada via wildcard ---");
  await expectAllowedFinding(
    updateDoc(doc(memberA.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", execA.id), { structuredFields: { hacked: true } }),
    "Membro comum (não isClinicalProvider) altera execução já confirmada — deveria ser bloqueado pela regra nomeada de imutabilidade"
  );

  console.log("\n--- 6. ACHADO: billing (assinatura) pode ser reescrito por qualquer membro via wildcard ---");
  await expectAllowedFinding(
    setDoc(doc(memberA.db, "clinics", CLINIC_A, "billing", "subscription"), { status: "active", planId: "ceo" }),
    "Membro comum reescreve o próprio status de assinatura da clínica — deveria ser platformAdmin-only"
  );

  console.log("\n--- 7. Confirmação: exclusão do Slice 2A não afetou nada além de education_turmas/education_enrollments ---");
  // Already proven by the 24/24 in verifySlice2AFoundation.mjs; here we just
  // reconfirm a random OTHER collection under the same clinic still resolves
  // through the (still-permissive-for-it) wildcard exactly as before.
  await expectAllowed(getDoc(doc(memberA.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id)), "Membro lê clinical_plans (não excluído do wildcard) normalmente");

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Audit script crashed:", err);
  process.exit(1);
});
