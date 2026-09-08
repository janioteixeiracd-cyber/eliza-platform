/**
 * FIRESTORE RULES HARDENING 2 — verification.
 *
 * Scope (strictly): members privilege escalation via self-update, and the
 * cross-clinic collectionGroup('members') read leak. Nothing else touched.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyRulesHardening2.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, updateDoc, getDoc, getDocs, collection, collectionGroup, query, where, serverTimestamp } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `H2_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
  const CLINIC_A = "h2-clinic-a";
  const CLINIC_B = "h2-clinic-b";

  console.log("=== Seeding fixtures ===");
  const admin1 = await clientAs("h2.admin@verify.local");
  const member = await clientAs("h2.member@verify.local");
  const otherMember = await clientAs("h2.othermember@verify.local");
  const memberB = await clientAs("h2.member.b@verify.local");
  const studentA = await clientAs("h2.student.a@verify.local");
  const noLink = await clientAs("h2.nolink@verify.local"); // signed in, no membership/student doc anywhere

  await adminDb.doc(`clinics/${CLINIC_A}/members/${admin1.uid}`).set({ uid: admin1.uid, role: "admin", status: "active", active: true, name: "Admin One" });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${member.uid}`).set({ uid: member.uid, role: "member", status: "active", active: true, name: "Plain Member", isClinicalProvider: false, courseRole: null, accessFinancial: false });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${otherMember.uid}`).set({ uid: otherMember.uid, role: "member", status: "active", active: true, name: "Other Member" });
  await adminDb.doc(`clinics/${CLINIC_B}/members/${memberB.uid}`).set({ uid: memberB.uid, role: "member", status: "active", active: true, name: "Member B" });
  await adminDb.doc(`clinics/${CLINIC_A}/education_students/${studentA.uid}`).set({ authUid: studentA.uid, name: "Student A", status: "ativo" });

  const selfRef = doc(member.db, "clinics", CLINIC_A, "members", member.uid);

  console.log("=== 1. Membro comum tenta mudar role para admin ===");
  await expectDenied(updateDoc(selfRef, { role: "admin" }), "role -> admin NEGADO");

  console.log("\n=== 2. Membro comum tenta mudar courseRole ===");
  await expectDenied(updateDoc(selfRef, { courseRole: "admin_curso" }), "courseRole NEGADO");

  console.log("\n=== 3. Membro comum tenta conceder permissão a si mesmo ===");
  await expectDenied(updateDoc(selfRef, { accessFinancial: true }), "accessFinancial -> true NEGADO");
  await expectDenied(updateDoc(selfRef, { isClinicalProvider: true }), "isClinicalProvider -> true NEGADO");
  await expectDenied(updateDoc(selfRef, { isAdminRole: true }), "isAdminRole -> true NEGADO");

  console.log("\n=== 4. Membro comum tenta mudar clinicId ===");
  await expectDenied(updateDoc(selfRef, { clinicId: CLINIC_B }), "clinicId NEGADO");

  console.log("\n=== 4b. Manipular status de acesso / reativar membership removida ===");
  await expectDenied(updateDoc(selfRef, { active: false }), "active NEGADO (nem pra se autodesativar)");
  await expectDenied(updateDoc(selfRef, { status: "removed" }), "status NEGADO");
  // Simulate a removed membership trying to self-reactivate.
  await adminDb.doc(`clinics/${CLINIC_A}/members/${member.uid}`).update({ active: false, status: "removed" });
  await expectDenied(updateDoc(selfRef, { active: true, status: "active" }), "membro removido NÃO consegue se reativar sozinho");
  await adminDb.doc(`clinics/${CLINIC_A}/members/${member.uid}`).update({ active: true, status: "active" }); // restore for later checks

  console.log("\n=== 5. Membro comum altera apenas campo de perfil autorizado ===");
  await expectAllowed(updateDoc(selfRef, { name: "Novo Nome", photoURL: "https://example.com/p.png" }), "name/photoURL PERMITIDO");
  // Mixing an authorized field with a forbidden one in the SAME write must
  // still be denied — the allowlist is on the whole write, not per-field.
  await expectDenied(updateDoc(selfRef, { name: "Nome Escalado", role: "admin" }), "name+role juntos NEGADO (allowlist é do write inteiro)");

  console.log("\n=== 6. Admin autorizado altera papel de outro membro ===");
  await expectAllowed(
    updateDoc(doc(admin1.db, "clinics", CLINIC_A, "members", otherMember.uid), { role: "admin", updatedAt: serverTimestamp() }),
    "Admin altera role de outro membro normalmente"
  );

  console.log("\n=== 7-9. Leitura cross-clinic (member/aluno/nenhum vínculo) ===");
  await expectDenied(getDoc(doc(memberB.db, "clinics", CLINIC_A, "members", admin1.uid)), "Membro da Clínica B lê members da Clínica A NEGADO");
  await expectDenied(getDoc(doc(studentA.db, "clinics", CLINIC_A, "members", admin1.uid)), "Aluna da própria Clínica A tentando ler members via caminho direto (ela não é staff) NEGADO");
  // Cross-clinic student check: student of A has no link to B at all.
  await expectDenied(getDoc(doc(studentA.db, "clinics", CLINIC_B, "members", memberB.uid)), "Aluna da Clínica A lê members da Clínica B NEGADO");

  console.log("\n=== 10. collectionGroup para enumerar membros de outra clínica ===");
  // memberB tries to use the collectionGroup itself to find CLINIC_A's admin.
  const enumQ = query(collectionGroup(memberB.db, "members"), where("role", "==", "admin"));
  const enumSnap = await getDocs(enumQ).catch(() => null);
  const leaked = enumSnap ? enumSnap.docs.filter((d) => d.ref.path.includes(CLINIC_A)) : [];
  check("collectionGroup NÃO retorna nenhum doc de outra clínica (mesmo filtrando por campo, não por uid)", leaked.length === 0);

  await expectDenied(
    getDocs(query(collectionGroup(noLink.db, "members"), where("uid", "==", admin1.uid))),
    "Usuário sem vínculo válido tenta enumerar via collectionGroup NEGADO"
  );

  console.log("\n=== 11. Fluxo legítimo: resolução de clínica no login (self-lookup via collectionGroup) continua funcionando ===");
  const selfLookup = await getDocs(query(collectionGroup(member.db, "members"), where("uid", "==", member.uid)));
  check("Membro encontra a PRÓPRIA membership via collectionGroup (mesma query do AuthContext.tsx)", !selfLookup.empty && selfLookup.docs[0].id === member.uid);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Hardening 2 verification script crashed:", err);
  process.exit(1);
});
