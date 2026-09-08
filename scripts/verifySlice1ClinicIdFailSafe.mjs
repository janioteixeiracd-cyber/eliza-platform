/**
 * Slice 1 verification — confirms the data-shape assumptions behind the
 * clinicId fail-safe fix in AuthContext.tsx (syncProfile / loginWithEmail):
 * does NOT re-implement the fix, just proves the exact resolution expression
 * (`studentDocObj.clinicId || studentRef.parent?.parent?.id`) behaves as
 * expected for a normally-created student, an orphaned/malformed student
 * doc, and a staff member — against the real emulator + real rules.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifySlice1ClinicIdFailSafe.mjs
 */
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collectionGroup, query, where, getDocs } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

// Client SDK: used for every READ below, so reads go through the real
// firestore.rules exactly like the app does. Admin SDK: used ONLY to seed
// fixtures the client SDK isn't allowed to write (the orphaned/malformed
// doc in test 2 — that's the point, a real user can't create that shape,
// this script simulates a pre-existing bad state to prove the fail-safe
// catches it if it's ever encountered).
const app = initializeApp(firebaseConfig, "SLICE1_VERIFY");
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();

async function getOrCreateUser(email, password) {
  try {
    return (await createUserWithEmailAndPassword(auth, email, password)).user;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      return (await signInWithEmailAndPassword(auth, email, password)).user;
    }
    throw err;
  }
}

let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}`); fail++; }
}

async function resolveClinicIdLikeAuthContext(authUid) {
  // Mirrors the exact read + expression used in syncProfile()/loginWithEmail().
  const q = query(collectionGroup(db, "education_students"), where("authUid", "==", authUid));
  const snap = await getDocs(q);
  if (snap.empty) return { found: false };
  const d = snap.docs[0];
  const data = d.data();
  const resolvedClinicId = data.clinicId || d.ref.parent?.parent?.id;
  return { found: true, resolvedClinicId, path: d.ref.path };
}

async function main() {
  const TEST_CLINIC_ID = "slice1-verify-clinic";

  console.log("=== 1. Normally-created student (real subcollection path, no clinicId field) ===");
  const goodEmail = "slice1.good@verify.local";
  const goodUid = (await getOrCreateUser(goodEmail, "TestPass123!")).uid;
  await adminDb.doc(`clinics/${TEST_CLINIC_ID}/education_students/${goodUid}`).set({
    authUid: goodUid, uid: goodUid, email: goodEmail, emailLowercase: goodEmail,
    name: "Good Student", status: "ativo",
  });
  const goodResult = await resolveClinicIdLikeAuthContext(goodUid);
  check("student doc found via collectionGroup", goodResult.found);
  check(`resolvedClinicId resolves to real clinic (got: ${goodResult.resolvedClinicId})`, goodResult.resolvedClinicId === TEST_CLINIC_ID);
  check("resolution did NOT need the old hardcoded fallback", goodResult.resolvedClinicId !== "l9GzEcXT7uhcYHgRVVhe");

  console.log("=== 2. Orphaned/malformed student doc (root-level, no clinic parent, no clinicId field) ===");
  const badEmail = "slice1.bad@verify.local";
  const badUid = (await getOrCreateUser(badEmail, "TestPass123!")).uid;
  await adminDb.doc(`education_students/${badUid}`).set({
    authUid: badUid, uid: badUid, email: badEmail, emailLowercase: badEmail,
    name: "Orphaned Student", status: "ativo",
  });
  const badResult = await resolveClinicIdLikeAuthContext(badUid);
  check("orphaned student doc found via collectionGroup (still readable)", badResult.found);
  check(`resolvedClinicId is falsy — this is exactly what makes the new fail-safe throw (got: ${badResult.resolvedClinicId})`, !badResult.resolvedClinicId);

  console.log("=== 3. Staff member (no education_students doc at all) is untouched by this code path ===");
  const staffEmail = "slice1.staff@verify.local";
  const staffUid = (await getOrCreateUser(staffEmail, "TestPass123!")).uid;
  await adminDb.doc(`clinics/${TEST_CLINIC_ID}/members/${staffUid}`).set({
    uid: staffUid, email: staffEmail, name: "Staff Member", role: "admin",
  });
  const staffResult = await resolveClinicIdLikeAuthContext(staffUid);
  check("staff member has NO matching education_students doc (student branch never runs for staff)", staffResult.found === false);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  await signOut(auth);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exit(1);
});
