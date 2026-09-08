/**
 * ELIZA Academy MVP (Toxina) — end-to-end browser test fixtures.
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedAcademyMvpFixtures.mjs
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

const CLINIC_ID = "mvp-clinic-a";
const COURSE_ID = "mvp-course-a";

async function makeUser(email) {
  const app = initializeApp(firebaseConfig, `MVP_${email.replace(/[^a-zA-Z0-9]/g, "_")}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
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
  console.log("=== Seeding clinic, course, professor, student ===");
  const professorUid = await makeUser("mvp.professor@verify.local");
  const studentUid = await makeUser("mvp.student@verify.local");

  await adminDb.doc(`clinics/${CLINIC_ID}`).set({ id: CLINIC_ID, name: "Clínica MVP Academy", ownerId: professorUid, slug: "clinica-mvp-academy", academyEnabled: true }, { merge: true });
  await adminDb.doc(`clinics/${CLINIC_ID}/members/${professorUid}`).set({ uid: professorUid, role: "owner", status: "active", active: true, name: "Professor MVP", accessCourses: true });
  await adminDb.doc(`clinics/${CLINIC_ID}/education_courses/${COURSE_ID}`).set({ id: COURSE_ID, name: "Curso MVP", status: "em_andamento", professorName: "Professor MVP" });

  const turmaRef = adminDb.doc(`clinics/${CLINIC_ID}/education_turmas/mvp-turma-a`);
  await turmaRef.set({ id: "mvp-turma-a", clinicId: CLINIC_ID, courseId: COURSE_ID, name: "Turma MVP A", status: "em_andamento", startDate: "2026-06-13", endDate: "2026-07-13", maxStudents: null, createdBy: professorUid });
  await adminDb.doc(`clinics/${CLINIC_ID}/education_turmas/mvp-turma-a/staff/${professorUid}`).set({ uid: professorUid, role: "professor", assignedBy: professorUid, assignedAt: new Date(), active: true });

  await adminDb.doc(`clinics/${CLINIC_ID}/education_students/${studentUid}`).set({ id: studentUid, authUid: studentUid, name: "Aluna MVP", emailLowercase: "mvp.student@verify.local", clinicId: CLINIC_ID, courseId: COURSE_ID, batchName: "Turma MVP A", status: "ativo" });
  await adminDb.doc(`clinics/${CLINIC_ID}/education_enrollments/mvp-turma-a_${studentUid}`).set({
    clinicId: CLINIC_ID, studentId: studentUid, turmaId: "mvp-turma-a", courseId: COURSE_ID, status: "ativa",
    permissions: { permViewSchedule: true, permViewPatients: true, permEditPatientRecords: false, permAttachPhotos: true, permWriteEvolution: false, permViewMaterials: true, permViewPlannedProcedures: true, permDownloadCertificate: false, permAccessAfterEnd: false },
    accessExpirationDate: "2027-01-01", enrolledAt: new Date(), enrolledBy: professorUid, completedAt: null,
    certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
  });

  console.log("\n=== Done ===");
  console.log(JSON.stringify({ CLINIC_ID, COURSE_ID, professorUid, studentUid }, null, 2));
}
main().catch((err) => { console.error(err); process.exit(1); });
