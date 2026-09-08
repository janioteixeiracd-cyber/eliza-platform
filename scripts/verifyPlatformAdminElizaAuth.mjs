/**
 * Prova, chamando a função real authenticateElizaRequest()
 * (src/lib/elizaCore/auth.ts) contra o Firestore/Auth emulator com um ID
 * token real, que um Platform Admin (platform_admins/{uid}.active===true)
 * passa a ser reconhecido como isOwnerOrAdmin mesmo sendo apenas "member"
 * comum (não ownerId, não role Dono/Gerente/admin) na clínica — o bug que
 * fazia a Eliza recusar financeiro pra Super Admin. Também confirma que um
 * membro comum sem platform_admins continua sem acesso, e que
 * canAccessFinance() segue a mesma decisão.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node node_modules/tsx/dist/cli.mjs scripts/verifyPlatformAdminElizaAuth.mjs
 */
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
import { authenticateElizaRequest, canAccessFinance } from "../src/lib/elizaCore/auth.ts";

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
async function idTokenFor(email) {
  const app = initializeApp(firebaseConfig, `PA_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  let cred;
  try { cred = await createUserWithEmailAndPassword(auth, email, "TestPass123!"); }
  catch (err) {
    if (err.code === "auth/email-already-in-use") cred = await signInWithEmailAndPassword(auth, email, "TestPass123!");
    else throw err;
  }
  return { uid: cred.user.uid, token: await cred.user.getIdToken() };
}

async function main() {
  const CLINIC = "platadm-clinic-" + Date.now();

  console.log("=== Seeding fixtures ===");
  const owner = await idTokenFor("platadm.owner@verify.local");
  const regularMember = await idTokenFor("platadm.regular@verify.local");
  const platformAdminMember = await idTokenFor("platadm.super@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Platform Admin Test", ownerId: owner.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${owner.uid}`).set({ uid: owner.uid, role: "Dono", status: "active", active: true, name: "Owner" });
  await adminDb.doc(`clinics/${CLINIC}/members/${regularMember.uid}`).set({ uid: regularMember.uid, role: "member", status: "active", active: true, name: "Secretária" });
  await adminDb.doc(`clinics/${CLINIC}/members/${platformAdminMember.uid}`).set({ uid: platformAdminMember.uid, role: "member", status: "active", active: true, name: "Super Admin" });
  await adminDb.doc(`platform_admins/${platformAdminMember.uid}`).set({ active: true, name: "Super Admin" });

  console.log("\n--- Membro comum (sem platform_admins) não é owner/admin ---");
  const regularAuthed = await authenticateElizaRequest({
    headers: { authorization: `Bearer ${regularMember.token}` },
    body: { clinicId: CLINIC },
  });
  check("regular member: isOwnerOrAdmin === false", regularAuthed.isOwnerOrAdmin === false, `got ${regularAuthed.isOwnerOrAdmin}`);
  check("regular member: canAccessFinance === false", canAccessFinance(regularAuthed) === false);

  console.log("\n--- Owner literal (ownerId) continua reconhecido, sem depender de platform_admins ---");
  const ownerAuthed = await authenticateElizaRequest({
    headers: { authorization: `Bearer ${owner.token}` },
    body: { clinicId: CLINIC },
  });
  check("owner: isOwnerOrAdmin === true", ownerAuthed.isOwnerOrAdmin === true);
  check("owner: canAccessFinance === true", canAccessFinance(ownerAuthed) === true);

  console.log("\n--- Platform Admin (member comum + platform_admins/{uid}.active=true) é reconhecido como owner/admin — o fix ---");
  const platformAdminAuthed = await authenticateElizaRequest({
    headers: { authorization: `Bearer ${platformAdminMember.token}` },
    body: { clinicId: CLINIC },
  });
  check("platform admin: isOwnerOrAdmin === true (era false antes do fix)", platformAdminAuthed.isOwnerOrAdmin === true, `got ${platformAdminAuthed.isOwnerOrAdmin}`);
  check("platform admin: canAccessFinance === true", canAccessFinance(platformAdminAuthed) === true);
  check("platform admin: memberRole continua 'member' (a checagem não reescreve o role real)", platformAdminAuthed.memberRole === "member", `got ${platformAdminAuthed.memberRole}`);

  console.log("\n--- platform_admins com active=false não conta (sem escalar por engano) ---");
  await adminDb.doc(`platform_admins/${regularMember.uid}`).set({ active: false, name: "Ex-admin" });
  const revokedAuthed = await authenticateElizaRequest({
    headers: { authorization: `Bearer ${regularMember.token}` },
    body: { clinicId: CLINIC },
  });
  check("platform_admins.active=false: isOwnerOrAdmin === false", revokedAuthed.isOwnerOrAdmin === false, `got ${revokedAuthed.isOwnerOrAdmin}`);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
