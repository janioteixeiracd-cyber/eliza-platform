/**
 * FIRESTORE RULES HARDENING 1 — verification.
 *
 * Confirms the expanded wildcard exclusion (executions, billing, members,
 * invites, education_students, ai_usage_logs, treatment_catalog,
 * education_courses/modules/procedures/patients) actually closes the gaps
 * the audit found, without regressing anything else. Also surfaces (tests,
 * does NOT fix) two pre-existing gaps found while building this suite that
 * live in the NAMED rules themselves, not in the wildcard — self-promotion
 * via members' and education_students' unrestricted self-update clauses.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyRulesHardening1.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `H1_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
// For findings we EXPECT to still be open (pre-existing, out of this
// checkpoint's scope) — proves the gap is real rather than assumed.
async function expectAllowedFinding(promise, label) {
  try { await promise; check(`[ACHADO SEPARADO] ${label}`, true); }
  catch (err) { check(`[achado NÃO reproduzido] ${label} (${err.code || err.message})`, false); }
}

async function main() {
  const CLINIC_A = "h1-clinic-a";
  const CLINIC_B = "h1-clinic-b";

  console.log("=== Seeding fixtures ===");
  const owner = await clientAs("h1.owner@verify.local");
  const admin1 = await clientAs("h1.admin@verify.local");
  const member = await clientAs("h1.member@verify.local"); // plain, non-admin, non-clinical
  const provider = await clientAs("h1.provider@verify.local"); // isClinicalProvider
  const otherProvider = await clientAs("h1.otherprovider@verify.local");
  const memberB = await clientAs("h1.member.b@verify.local");
  const newInvitee = await clientAs("h1.newinvitee@verify.local"); // signed in, NOT yet a member of clinic A
  const platformAdmin = await clientAs("h1.platformadmin@verify.local");
  const selfPromoteVictim = await clientAs("h1.selfpromote@verify.local"); // isolated — this test mutates its own role, must never be reused after

  await adminDb.doc(`clinics/${CLINIC_A}`).set({ name: "Clinic A", ownerId: owner.uid });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${owner.uid}`).set({ role: "owner", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${admin1.uid}`).set({ role: "admin", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${member.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${selfPromoteVictim.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${provider.uid}`).set({ role: "member", status: "active", active: true, isClinicalProvider: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${otherProvider.uid}`).set({ role: "member", status: "active", active: true, isClinicalProvider: true });
  await adminDb.doc(`clinics/${CLINIC_B}/members/${memberB.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`platform_admins/${platformAdmin.uid}`).set({ active: true, role: "super_admin" });

  const patientA = await adminDb.collection(`clinics/${CLINIC_A}/patients`).add({ name: "Paciente H1" });
  const planA = await adminDb.collection(`clinics/${CLINIC_A}/patients/${patientA.id}/clinical_plans`).add({ procedureName: "Toxina" });
  const draftExecRef = adminDb.collection(`clinics/${CLINIC_A}/patients/${patientA.id}/clinical_plans/${planA.id}/executions`).doc();
  await draftExecRef.set({ status: "draft", startedBy: provider.uid, structuredFields: {} });
  const confirmedExecRef = adminDb.collection(`clinics/${CLINIC_A}/patients/${patientA.id}/clinical_plans/${planA.id}/executions`).doc();
  await confirmedExecRef.set({ status: "confirmed", startedBy: provider.uid, structuredFields: {} });

  await adminDb.doc(`clinics/${CLINIC_A}/billing/subscription`).set({ status: "active", planId: "assistant" });
  await adminDb.doc(`clinics/${CLINIC_A}/invites/inv1`).set({ status: "pending", email: "someone@example.com", role: "member", expiresAt: null });
  await adminDb.doc(`clinics/${CLINIC_A}/education_students/${member.uid}_stub`).set({ authUid: "someone-else", name: "Some Student", status: "ativo" });
  await adminDb.doc(`clinics/${CLINIC_A}/treatment_catalog/tc1`).set({ name: "Limpeza" });
  await adminDb.doc(`clinics/${CLINIC_A}/pending_items/pi1`).set({ title: "Item", status: "pending" });
  await adminDb.doc(`clinics/${CLINIC_A}/appointments/ap1`).set({ status: "scheduled" });
  await adminDb.doc(`clinics/${CLINIC_A}/financial_entries/fe1`).set({ amount: 100 });
  console.log("=== Fixtures ready ===\n");

  // ===================== 1. ClinicalExecution =====================
  console.log("--- ClinicalExecution ---");
  const newDraftRef = doc(collection(provider.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions"));
  await expectAllowed(
    setDoc(newDraftRef, { status: "draft", startedBy: provider.uid, structuredFields: {} }),
    "Clinical provider autorizado cria execução (draft)"
  );
  await expectDenied(
    updateDoc(doc(provider.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", confirmedExecRef.id), { structuredFields: { x: 1 } }),
    "Execução confirmed: UPDATE negado mesmo pro clinical provider dono (named rule já bloqueava; confirma que segue bloqueado sem o coringa)"
  );
  await expectDenied(
    deleteDoc(doc(admin1.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", confirmedExecRef.id)),
    "Execução confirmed: DELETE negado mesmo pro admin da clínica"
  );
  await expectAllowed(
    setDoc(doc(provider.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", confirmedExecRef.id, "addenda", "add1"), { text: "Correção", createdBy: provider.uid }),
    "Addendum: create permitido pro clinical provider (append-only)"
  );
  await expectDenied(
    updateDoc(doc(provider.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", confirmedExecRef.id, "addenda", "add1"), { text: "Editado" }),
    "Addendum: UPDATE sempre negado (append-only), mesmo pro autor"
  );
  await expectDenied(
    updateDoc(doc(member.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", draftExecRef.id), { structuredFields: { hacked: true } }),
    "[FECHADO] Membro comum não-clínico NÃO altera execução (draft) pelo coringa"
  );
  await expectDenied(
    updateDoc(doc(member.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id, "executions", confirmedExecRef.id), { structuredFields: { hacked: true } }),
    "[FECHADO] Membro comum não-clínico NÃO altera execução confirmed pelo coringa (era o achado da auditoria)"
  );

  // ===================== 2. Billing =====================
  console.log("\n--- Billing ---");
  await expectDenied(setDoc(doc(member.db, "clinics", CLINIC_A, "billing", "subscription"), { status: "active", planId: "ceo" }), "[FECHADO] Membro comum NÃO altera billing (era o achado da auditoria)");
  await expectDenied(setDoc(doc(owner.db, "clinics", CLINIC_A, "billing", "subscription"), { status: "active", planId: "ceo" }), "Owner da clínica também NÃO escreve billing (regra nomeada é platformAdmin-only, isso é restauração do design original, não algo novo)");
  await expectAllowed(setDoc(doc(platformAdmin.db, "clinics", CLINIC_A, "billing", "subscription"), { status: "active", planId: "ceo" }), "Platform Admin escreve billing normalmente");
  await expectAllowed(getDoc(doc(owner.db, "clinics", CLINIC_A, "billing", "subscription")), "Owner continua LENDO billing normalmente (regra nomeada permite leitura)");

  // ===================== 3. Members =====================
  console.log("\n--- Members ---");
  await expectDenied(
    setDoc(doc(member.db, "clinics", CLINIC_A, "members", "novo-membro-forjado"), { role: "member", status: "active", active: true }),
    "[FECHADO] Membro comum NÃO cria outro membro pelo coringa"
  );
  await expectDenied(deleteDoc(doc(member.db, "clinics", CLINIC_A, "members", admin1.uid)), "[FECHADO] Membro comum NÃO apaga outro membro pelo coringa");
  await expectAllowed(
    setDoc(doc(admin1.db, "clinics", CLINIC_A, "members", "novo-membro-legitimo"), { role: "member", status: "active", active: true }),
    "Admin da clínica cria membro normalmente"
  );
  // Pre-existing gap, NOT introduced/fixed by this hardening — the named
  // rule's own self-update clause has no field restriction. Reported, not
  // fixed (fixing it would mean rewriting the members rule itself, out of
  // this checkpoint's scope).
  // Isolated user for this one check — it mutates its own role for real,
  // and must never be reused by a later assertion that assumes "plain
  // member" (this bug was caught the hard way: an earlier version of this
  // script reused `member` here, which then silently promoted itself to
  // admin and made every subsequent "member should be denied" check below
  // pass for the wrong reason — the actor was secretly an admin by then).
  await expectAllowed(
    updateDoc(doc(selfPromoteVictim.db, "clinics", CLINIC_A, "members", selfPromoteVictim.uid), { role: "admin" }),
    "[ACHADO SEPARADO, NÃO CORRIGIDO] Membro comum consegue se autopromover a admin — vem da própria regra nomeada (self-update sem restrição de campo), não do coringa"
  );

  // ===================== 4. Invites =====================
  console.log("\n--- Invites ---");
  await expectDenied(setDoc(doc(member.db, "clinics", CLINIC_A, "invites", "novo-convite"), { status: "pending", email: "x@y.com" }), "[FECHADO] Membro comum NÃO cria convite pelo coringa");
  await expectDenied(deleteDoc(doc(member.db, "clinics", CLINIC_A, "invites", "inv1")), "[FECHADO] Membro comum NÃO revoga convite pelo coringa");
  await expectDenied(getDoc(doc(member.db, "clinics", CLINIC_A, "invites", "inv1")), "[FECHADO] Membro comum NÃO lê a lista de convites pelo coringa (regra nomeada é admin/owner-only)");
  await expectAllowed(setDoc(doc(admin1.db, "clinics", CLINIC_A, "invites", "novo-convite-2"), { status: "pending", email: "x@y.com" }), "Admin da clínica cria convite normalmente");
  await expectDenied(
    getDoc(doc(newInvitee.db, "clinics", CLINIC_A, "invites", "inv1")),
    "[REGRESSÃO EM POTENCIAL, JÁ EXISTIA ANTES] Pessoa nova (logada, ainda não é membro) tentando ler o próprio convite por token — regra nomeada exige admin/owner, e agora nem o coringa cobre mais isso"
  );

  // ===================== 5. education_students =====================
  console.log("\n--- education_students ---");
  const studentDocId = `${member.uid}_stub`;
  await expectDenied(
    updateDoc(doc(member.db, "clinics", CLINIC_A, "education_students", studentDocId), { status: "suspenso" }),
    "[FECHADO] Membro comum/professor NÃO altera aluna arbitrária pelo coringa"
  );
  await expectAllowed(
    updateDoc(doc(admin1.db, "clinics", CLINIC_A, "education_students", studentDocId), { status: "suspenso" }),
    "Admin da clínica continua alterando aluna normalmente"
  );

  // ===================== 6. ai_usage_logs =====================
  console.log("\n--- ai_usage_logs ---");
  await expectDenied(setDoc(doc(member.db, "clinics", CLINIC_A, "ai_usage_logs", "log1"), { provider: "openai" }), "[FECHADO] Membro comum NÃO escreve ai_usage_logs via client SDK");
  await expectDenied(setDoc(doc(admin1.db, "clinics", CLINIC_A, "ai_usage_logs", "log2"), { provider: "openai" }), "[FECHADO] Admin da clínica também NÃO escreve ai_usage_logs via client SDK (só Admin SDK deveria)");
  await expectAllowed(getDoc(doc(admin1.db, "clinics", CLINIC_A, "pending_items", "pi1")), "(sanity) Admin continua conseguindo ler outras coleções normalmente");

  // ===================== 7. education_courses/modules/procedures/patients + treatment_catalog =====================
  console.log("\n--- Catálogo/currículo (write admin-only) ---");
  await expectDenied(setDoc(doc(member.db, "clinics", CLINIC_A, "treatment_catalog", "novo"), { name: "x" }), "[FECHADO] Membro comum NÃO escreve treatment_catalog pelo coringa");
  await expectAllowed(setDoc(doc(admin1.db, "clinics", CLINIC_A, "treatment_catalog", "novo-admin"), { name: "x" }), "Admin escreve treatment_catalog normalmente");

  // ===================== REGRESSÃO =====================
  console.log("\n--- Regressão: coleções operacionais genéricas, intocadas ---");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC_A, "pending_items", "pi1")), "pending_items: membro comum continua lendo");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC_A, "patients", patientA.id)), "patients: fluxo normal de paciente continua funcionando");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC_A, "appointments", "ap1")), "appointments: agenda continua funcionando");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC_A, "financial_entries", "fe1")), "financial_entries: financeiro operacional continua funcionando");
  await expectAllowed(getDoc(doc(member.db, "clinics", CLINIC_A, "patients", patientA.id, "clinical_plans", planA.id)), "clinical_plans (não é a subárvore de executions): continua funcionando pelo coringa");

  console.log("\n--- Isolamento entre clínicas (coleções recém-excluídas) ---");
  await expectDenied(getDoc(doc(memberB.db, "clinics", CLINIC_A, "billing", "subscription")), "Membro da Clínica B não lê billing da Clínica A");
  // NOT fixed by this checkpoint, and NOT a regression from it — a
  // SEPARATE, pre-existing top-level rule (match /{path=**}/members/{id} {
  // allow read: if isSignedIn(); }, declared outside clinics/{clinicId}
  // for collectionGroup support) independently grants read access to any
  // signed-in user for any clinic's members docs, regardless of the
  // {subcollection=**} wildcard this checkpoint scoped to. Reported, not
  // fixed here — same "don't expand scope" principle as the members
  // self-promotion finding above.
  await expectAllowedFinding(
    getDoc(doc(memberB.db, "clinics", CLINIC_A, "members", owner.uid)),
    "Membro da Clínica B lê members da Clínica A via a regra de collectionGroup separada (match /{path=**}/members/{id}), não a que este checkpoint corrigiu"
  );

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Hardening verification script crashed:", err);
  process.exit(1);
});
