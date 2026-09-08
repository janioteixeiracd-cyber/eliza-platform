/**
 * DUAL ROLE — CLINIC + ACADEMY checkpoint: seeds 3 test identities against the
 * local emulators so the real login flow (LoginView -> AuthContext) can be
 * exercised in the browser for cases A/B/C.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedDualRoleFixtures.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();

const CLINIC_ID = "dr-clinic-a";
const COURSE_ID = "dr-course-a";

async function makeUser(email) {
  const app = initializeApp(firebaseConfig, `DR_${email.replace(/[^a-zA-Z0-9]/g, "_")}`);
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
  await deleteApp(app);
  return user.uid;
}

async function main() {
  console.log("=== Seeding clinic + course ===");
  await adminDb.doc(`clinics/${CLINIC_ID}`).set({ id: CLINIC_ID, name: "Clínica Teste Dual Role", ownerId: "seed-owner", slug: "clinica-teste-dual-role", academyEnabled: true }, { merge: true });
  await adminDb.doc(`clinics/${CLINIC_ID}/education_courses/${COURSE_ID}`).set({ id: COURSE_ID, name: "Curso Teste Dual Role", active: true }, { merge: true });

  console.log("=== Case A: staff only ===");
  const staffOnlyUid = await makeUser("dr.staffonly@verify.local");
  await adminDb.doc(`clinics/${CLINIC_ID}/members/${staffOnlyUid}`).set({
    uid: staffOnlyUid, role: "admin", status: "active", active: true, name: "Staff Only",
  });

  console.log("=== Case B: student only ===");
  const studentOnlyUid = await makeUser("dr.studentonly@verify.local");
  await adminDb.doc(`clinics/${CLINIC_ID}/education_students/${studentOnlyUid}`).set({
    id: studentOnlyUid, authUid: studentOnlyUid, name: "Student Only", emailLowercase: "dr.studentonly@verify.local",
    clinicId: CLINIC_ID, courseId: COURSE_ID, status: "ativo", mustChangePassword: true,
  });

  console.log("=== Case C: staff + student (dual role) ===");
  const dualUid = await makeUser("dr.dualrole@verify.local");
  await adminDb.doc(`clinics/${CLINIC_ID}/members/${dualUid}`).set({
    uid: dualUid, role: "member", status: "active", active: true, name: "Dual Role Person", isClinicalProvider: true,
  });
  await adminDb.doc(`clinics/${CLINIC_ID}/education_students/${dualUid}`).set({
    id: dualUid, authUid: dualUid, name: "Dual Role Person", emailLowercase: "dr.dualrole@verify.local",
    clinicId: CLINIC_ID, courseId: COURSE_ID, status: "ativo", mustChangePassword: true,
  });

  console.log("\n=== Done ===");
  console.log(JSON.stringify({ CLINIC_ID, staffOnlyUid, studentOnlyUid, dualUid }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed script crashed:", err);
  process.exit(1);
});
