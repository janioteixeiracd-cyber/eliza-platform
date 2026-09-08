/**
 * Targeted check: the bug found live in production was specifically a `list`
 * (collection query) on appointments/financial_entries failing under the
 * generic {subcollection=**} wildcard — a `getDoc` on the same path always
 * worked, which is why the existing Hardening 1 regression test (getDoc-only)
 * never caught it. This script exercises getDocs() explicitly.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyAppointmentsFinancialListFix.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, collection, getDocs } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `LF_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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

async function main() {
  const CLINIC_A = "lf-clinic-a";
  const CLINIC_B = "lf-clinic-b";

  console.log("=== Seeding fixtures ===");
  const member = await clientAs("lf.member@verify.local");
  const memberB = await clientAs("lf.member.b@verify.local");

  await adminDb.doc(`clinics/${CLINIC_A}/members/${member.uid}`).set({ uid: member.uid, role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_B}/members/${memberB.uid}`).set({ uid: memberB.uid, role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/appointments/ap1`).set({ status: "scheduled" });
  await adminDb.doc(`clinics/${CLINIC_A}/appointments/ap2`).set({ status: "finalizado" });
  await adminDb.doc(`clinics/${CLINIC_A}/financial_entries/fe1`).set({ amount: 100 });
  console.log("=== Fixtures ready ===\n");

  console.log("=== 1. Membro lista appointments (list, não get) da própria clínica ===");
  try {
    const snap = await getDocs(collection(member.db, "clinics", CLINIC_A, "appointments"));
    check("Membro lista appointments (list) — retornou 2 docs", snap.size === 2);
  } catch (err) {
    check(`Membro lista appointments (list) — ERRO: ${err.code || err.message}`, false);
  }

  console.log("\n=== 2. Membro lista financial_entries (list) da própria clínica ===");
  try {
    const snap = await getDocs(collection(member.db, "clinics", CLINIC_A, "financial_entries"));
    check("Membro lista financial_entries (list) — retornou 1 doc", snap.size === 1);
  } catch (err) {
    check(`Membro lista financial_entries (list) — ERRO: ${err.code || err.message}`, false);
  }

  console.log("\n=== 3. Membro de outra clínica NÃO lista appointments da Clínica A ===");
  try {
    const snap = await getDocs(collection(memberB.db, "clinics", CLINIC_A, "appointments"));
    check("Membro da Clínica B lista appointments da Clínica A — deveria falhar mas retornou " + snap.size + " docs", false);
  } catch (err) {
    check(`Membro da Clínica B lista appointments da Clínica A NEGADO (${err.code})`, err.code === "permission-denied");
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("List-fix verification script crashed:", err);
  process.exit(1);
});
