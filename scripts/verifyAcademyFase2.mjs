/**
 * End-to-end verification of Eliza Academy Fase 2 against the LOCAL emulators,
 * using the real client SDK (same code path the browser uses) so firestore.rules
 * are genuinely enforced -- this is not an admin-bypass script.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyAcademyFase2.mjs
 */
import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, addDoc, collection,
  collectionGroup, query, where, getDocs, updateDoc, serverTimestamp,
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

const CLINIC_ID = "demo-clinic-001";
const PROF_EMAIL = "demo@eliza.local";
const PROF_PASSWORD = "DemoEliza123!";
const STUDENT_EMAIL = "fase2.verify@academyteste.com";
const STUDENT_PASSWORD = "Eliza12345";

const app = initializeApp(firebaseConfig, "VERIFY_APP");
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

const secondaryApp = initializeApp(firebaseConfig, "VERIFY_SECONDARY_APP");
const secondaryAuth = getAuth(secondaryApp);
connectAuthEmulator(secondaryAuth, "http://127.0.0.1:9099", { disableWarnings: true });

let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}`); fail++; }
}

async function main() {
  console.log("=== 1. Login as professor ===");
  const profCred = await signInWithEmailAndPassword(auth, PROF_EMAIL, PROF_PASSWORD);
  check("professor signed in", !!profCred.user.uid);
  const profUid = profCred.user.uid;

  console.log("=== 2. Enable Academy on clinic ===");
  await setDoc(doc(db, "clinics", CLINIC_ID), { academyEnabled: true }, { merge: true });
  const clinicSnap = await getDoc(doc(db, "clinics", CLINIC_ID));
  check("academyEnabled=true persisted", clinicSnap.data()?.academyEnabled === true);

  console.log("=== 3. Create course + visible module (as professor) ===");
  const courseRef = await addDoc(collection(db, "clinics", CLINIC_ID, "education_courses"), {
    title: "Curso Verificação Fase 2",
    status: "ativo",
    createdBy: profUid,
    createdAt: serverTimestamp(),
  });
  await addDoc(collection(db, "clinics", CLINIC_ID, "education_modules"), {
    courseId: courseRef.id,
    title: "Módulo 1 - Verificação",
    visibleToStudents: true,
    lessons: [{ id: "l1", title: "Aula 1", content: "Conteúdo de teste" }],
    createdAt: serverTimestamp(),
  });
  const modsSnap = await getDocs(query(collection(db, "clinics", CLINIC_ID, "education_modules"), where("courseId", "==", courseRef.id)));
  check("module created and readable", modsSnap.size === 1);

  console.log("=== 4. Create student (secondary auth app + primary db, mirrors inviteService) ===");
  let studentUid;
  try {
    const existing = await signInWithEmailAndPassword(secondaryAuth, STUDENT_EMAIL, STUDENT_PASSWORD);
    studentUid = existing.user.uid;
    await signOut(secondaryAuth);
  } catch {
    const created = await createUserWithEmailAndPassword(secondaryAuth, STUDENT_EMAIL, STUDENT_PASSWORD);
    studentUid = created.user.uid;
    await signOut(secondaryAuth);
  }
  await setDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid), {
    authUid: studentUid, uid: studentUid, email: STUDENT_EMAIL, emailLowercase: STUDENT_EMAIL,
    name: "Aluno Verificação Fase 2", courseId: courseRef.id, status: "ativo",
    accessExpirationDate: null, permViewSchedule: true, permAttachPhotos: true,
    permWriteEvolution: true, permViewMaterials: true, permDownloadCertificate: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, "users", studentUid), {
    uid: studentUid, name: "Aluno Verificação Fase 2", email: STUDENT_EMAIL,
    role: "aluno", defaultClinicId: CLINIC_ID, clinicId: CLINIC_ID,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true });
  const studentDocCheck = await getDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid));
  check("student doc created", studentDocCheck.exists());

  await signOut(auth);

  console.log("=== 5. Login as student (post-auth pre-check path — the actual bug fix) ===");
  const studentCred = await signInWithEmailAndPassword(auth, STUDENT_EMAIL, STUDENT_PASSWORD);
  check("student signed in", !!studentCred.user.uid);

  // This is exactly the query AuthContext.tsx now runs AFTER auth (the fix under test).
  const postAuthQ = query(collectionGroup(db, "education_students"), where("emailLowercase", "==", STUDENT_EMAIL));
  const postAuthSnap = await getDocs(postAuthQ);
  check("post-auth education_students lookup succeeds (was hanging pre-auth before the fix)", !postAuthSnap.empty);

  console.log("=== 6. Student reads own course modules ===");
  const studentModsSnap = await getDocs(query(collection(db, "clinics", CLINIC_ID, "education_modules"), where("courseId", "==", courseRef.id), where("visibleToStudents", "==", true)));
  check("student can read visible modules", studentModsSnap.size === 1);

  console.log("=== 7. Student submits a case (mirrors NextStudentPortal case submission) ===");
  const caseRef = await addDoc(collection(db, "clinics", CLINIC_ID, "education_student_cases"), {
    studentId: studentUid, studentName: "Aluno Verificação Fase 2", courseId: courseRef.id,
    status: "pending", clinicalNotes: "Caso de verificação automatizada Fase 2",
    photos: { frontal: "data:image/jpeg;base64,FAKE_TEST_PHOTO" },
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  const caseSnap = await getDoc(caseRef);
  check("case written and readable by student", caseSnap.exists() && caseSnap.data().status === "pending");

  await signOut(auth);

  console.log("=== 8. Login as professor again, review + approve the case ===");
  await signInWithEmailAndPassword(auth, PROF_EMAIL, PROF_PASSWORD);
  const allCasesSnap = await getDocs(collection(db, "clinics", CLINIC_ID, "education_student_cases"));
  check("professor can list student cases", allCasesSnap.docs.some(d => d.id === caseRef.id));

  await updateDoc(caseRef, {
    status: "approved", professorFeedback: "Ótimo caso, aprovado na verificação automatizada.",
    reviewedAt: serverTimestamp(), reviewedBy: profUid,
  });
  const approvedSnap = await getDoc(caseRef);
  check("case approved with feedback", approvedSnap.data().status === "approved");

  console.log("=== 9. Professor saves gabarito drawing on the case (AcademyPlanningCanvas save) ===");
  // Matches AcademyPlanningCanvas's onSavePlanning(drawingsJson: string) contract and
  // NextAcademy.tsx's handleSaveProfessorDrawing, which stores professorDrawings as
  // Record<angle, JSON string> — not raw nested arrays (Firestore can't store those).
  const drawingsJson = JSON.stringify({
    strokes: [{ id: "s1", type: "pen", color: "#ff0000", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }],
    textNotes: [],
  });
  await updateDoc(caseRef, { professorDrawings: { frontal: drawingsJson }, updatedAt: serverTimestamp() });
  const drawingSnap = await getDoc(caseRef);
  check("professor drawing persisted under professorDrawings (distinct from student's own drawings)", drawingSnap.data().professorDrawings?.frontal === drawingsJson);

  console.log("=== 10. Certificate issuance (course finalizado + student concluído) ===");
  await updateDoc(doc(db, "clinics", CLINIC_ID, "education_courses", courseRef.id), { status: "finalizado" });
  await updateDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid), { status: "concluído" });
  const courseFinal = await getDoc(doc(db, "clinics", CLINIC_ID, "education_courses", courseRef.id));
  const studentFinal = await getDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid));
  const certEligible = courseFinal.data().status === "finalizado"
    && ["concluído", "ativo"].includes(studentFinal.data().status)
    && studentFinal.data().permDownloadCertificate !== false;
  check("certificate eligibility gate computes true (matches NextAcademy.tsx certEligible logic)", certEligible === true);

  const certCode = `EZ-${studentUid.slice(0, 6)}-${Date.now()}`;
  await updateDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid), {
    certificateIssued: true, certificateCode: certCode, certificateIssuedAt: serverTimestamp(),
  });
  const certSnap = await getDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid));
  check("certificate persisted with real code", certSnap.data().certificateIssued === true && certSnap.data().certificateCode === certCode);

  console.log("=== 11. Student reads own issued certificate ===");
  await signOut(auth);
  await signInWithEmailAndPassword(auth, STUDENT_EMAIL, STUDENT_PASSWORD);
  const studentCertSnap = await getDoc(doc(db, "clinics", CLINIC_ID, "education_students", studentUid));
  check("student can read own certificate code after issuance", studentCertSnap.data().certificateCode === certCode);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFICATION SCRIPT ERROR:", err);
  process.exit(1);
});
