/**
 * Educational Activities MVP (2026-08-29) — rules verification.
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyEducationActivities.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, getDocs, collection } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `EA_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
  const CLINIC = "ea-clinic-a";
  const COURSE = "ea-course-a";
  const TURMA = "ea-turma-a";

  console.log("=== Seeding fixtures ===");
  const professor = await clientAs("ea.professor@verify.local");
  const student1 = await clientAs("ea.student1@verify.local");
  const student2 = await clientAs("ea.student2@verify.local"); // enrolled elsewhere / not enrolled
  const outsider = await clientAs("ea.outsider@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clinic EA", ownerId: "seed-owner" });
  await adminDb.doc(`clinics/${CLINIC}/education_courses/${COURSE}`).set({ id: COURSE, name: "Curso EA" });
  await adminDb.doc(`clinics/${CLINIC}/education_turmas/${TURMA}`).set({ id: TURMA, clinicId: CLINIC, courseId: COURSE, name: "Turma EA", status: "em_andamento" });
  await adminDb.doc(`clinics/${CLINIC}/education_turmas/${TURMA}/staff/${professor.uid}`).set({ uid: professor.uid, role: "professor", assignedBy: "admin", active: true });
  await adminDb.doc(`clinics/${CLINIC}/education_enrollments/${TURMA}_${student1.uid}`).set({ clinicId: CLINIC, studentId: student1.uid, turmaId: TURMA, courseId: COURSE, status: "ativa" });
  console.log("=== Fixtures ready ===\n");

  console.log("=== 1. Professor cria atividade (draft) ===");
  const activityId = "act1";
  await expectAllowed(setDoc(doc(professor.db, "clinics", CLINIC, "education_activities", activityId), {
    clinicId: CLINIC, turmaId: TURMA, courseId: COURSE, templateId: "toxina_botulinica",
    title: "Toxina - Caso 1", description: "", educationalObjectives: "", instructions: "",
    modelPatientId: null, requiredFieldKeys: [], tutorPolicy: { allowExplainBeforeSubmit: true, allowAnalyzeOwnContent: true, revealReferenceAfterReview: true },
    status: "draft", required: true, professorId: professor.uid, professorName: "Prof",
    createdBy: professor.uid, createdAt: new Date(), updatedAt: new Date(),
  }), "Professor cria atividade draft");

  console.log("\n=== 2. Aluna NÃO enxerga atividade draft ===");
  await expectDenied(getDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId)), "Aluna lê atividade draft (negado, ainda não publicada)");

  console.log("\n=== 3. Professor publica ===");
  await expectAllowed(updateDoc(doc(professor.db, "clinics", CLINIC, "education_activities", activityId), { status: "published", updatedAt: new Date() }), "Professor publica atividade");

  console.log("\n=== 4. Aluna matriculada agora lê atividade publicada ===");
  await expectAllowed(getDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId)), "Aluna matriculada lê atividade publicada");

  console.log("\n=== 5. Aluna NÃO matriculada não lê ===");
  await expectDenied(getDoc(doc(student2.db, "clinics", CLINIC, "education_activities", activityId)), "Aluna sem matrícula lê atividade publicada (negado)");

  console.log("\n=== 6. Aluna cria a própria tentativa (draft) ===");
  const attemptId = "att1";
  await expectAllowed(setDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    clinicId: CLINIC, activityId, turmaId: TURMA, enrollmentId: `${TURMA}_${student1.uid}`,
    studentId: student1.uid, studentName: "Student1", templateId: "toxina_botulinica", attemptNumber: 1,
    status: "draft", structuredFields: {}, studentAnalysis: "", justification: "", strokesJson: null,
    overlayThumbnailBase64: null, images: {}, observations: "", aiInteractions: [], professorReview: null,
    createdAt: new Date(), updatedAt: new Date(), submittedAt: null,
  }), "Aluna cria tentativa draft");

  console.log("\n=== 7. Outra aluna tenta criar tentativa em nome da 1 (negado) ===");
  await expectDenied(setDoc(doc(student2.db, "clinics", CLINIC, "education_activities", activityId, "attempts", "att-fake"), {
    clinicId: CLINIC, activityId, turmaId: TURMA, enrollmentId: `${TURMA}_${student1.uid}`,
    studentId: student1.uid, studentName: "fake", templateId: "toxina_botulinica", attemptNumber: 1,
    status: "draft", structuredFields: {}, studentAnalysis: "", justification: "", strokesJson: null,
    overlayThumbnailBase64: null, images: {}, observations: "", aiInteractions: [], professorReview: null,
    createdAt: new Date(), updatedAt: new Date(), submittedAt: null,
  }), "Aluna 2 cria tentativa em nome da aluna 1");

  console.log("\n=== 8. Aluna edita o próprio draft ===");
  await expectAllowed(updateDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    studentAnalysis: "minha análise", updatedAt: new Date(),
  }), "Aluna edita o próprio draft");

  console.log("\n=== 9. Aluna tenta escrever professorReview diretamente (negado) ===");
  await expectDenied(updateDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    professorReview: { decision: "approved", comments: "auto-aprovado", drawingsJson: null, reviewedBy: student1.uid, reviewedByName: "x", reviewedAt: new Date() },
  }), "Aluna escreve professorReview diretamente");

  console.log("\n=== 10. Aluna submete (draft -> submitted) ===");
  await expectAllowed(updateDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    status: "submitted", submittedAt: new Date(), updatedAt: new Date(),
  }), "Aluna submete a tentativa");

  console.log("\n=== 11. Aluna NÃO consegue mais editar após submeter ===");
  await expectDenied(updateDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    studentAnalysis: "tentando mudar depois de enviar",
  }), "Aluna edita própria tentativa já enviada (negado)");

  console.log("\n=== 12. Professor revisa (só professorReview/status) ===");
  await expectAllowed(updateDoc(doc(professor.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    professorReview: { decision: "revision_requested", comments: "revisar região X", drawingsJson: null, reviewedBy: professor.uid, reviewedByName: "Prof", reviewedAt: new Date() },
    status: "revision_requested", updatedAt: new Date(),
  }), "Professor revisa a tentativa enviada");

  console.log("\n=== 13. Ninguém consegue mais alterar após revisão (imutável) ===");
  await expectDenied(updateDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    studentAnalysis: "tentando editar depois da revisão",
  }), "Aluna edita tentativa já revisada (negado)");
  await expectDenied(updateDoc(doc(professor.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId), {
    professorReview: { decision: "approved", comments: "segunda revisão", drawingsJson: null, reviewedBy: professor.uid, reviewedByName: "Prof", reviewedAt: new Date() },
  }), "Professor revisa de novo a mesma tentativa (negado, já revisada)");

  console.log("\n=== 14. Aluna cria a Tentativa 2 (novo doc, não edita a 1) ===");
  const attempt2Id = "att2";
  await expectAllowed(setDoc(doc(student1.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attempt2Id), {
    clinicId: CLINIC, activityId, turmaId: TURMA, enrollmentId: `${TURMA}_${student1.uid}`,
    studentId: student1.uid, studentName: "Student1", templateId: "toxina_botulinica", attemptNumber: 2,
    status: "draft", structuredFields: {}, studentAnalysis: "revisado", justification: "", strokesJson: null,
    overlayThumbnailBase64: null, images: {}, observations: "", aiInteractions: [], professorReview: null,
    createdAt: new Date(), updatedAt: new Date(), submittedAt: null,
  }), "Aluna cria Tentativa 2");

  console.log("\n=== 15. Outsider (sem vínculo algum) não lê nada disso ===");
  await expectDenied(getDoc(doc(outsider.db, "clinics", CLINIC, "education_activities", activityId, "attempts", attemptId)), "Outsider lê tentativa (negado)");
  await expectDenied(getDoc(doc(outsider.db, "clinics", CLINIC, "education_activities", activityId)), "Outsider lê atividade publicada (negado, sem vínculo)");

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((err) => { console.error("crashed:", err); process.exit(1); });
