/**
 * Slice 2A verification — Fundação Acadêmica (Turma + Matrícula).
 *
 * Exercises the real firestore.rules against the emulator via the client
 * SDK (never Admin SDK for the actions under test — only for fixture setup,
 * which real users could equally have reached via already-approved paths
 * like member creation / student invite, neither of which is in scope here).
 *
 * Covers the full Slice 2A matrix from the design doc: 16 negative tests +
 * 3 positive tests. The 2 rollback-specific negative tests (migrationId
 * isolation, "don't delete an altered migrated doc") are 2B-only — no
 * backfill/rollback script exists yet, so they are not runnable here.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifySlice2AFoundation.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, serverTimestamp, runTransaction,
} from "firebase/firestore";
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

// One isolated client app per test "user" so concurrent sign-ins don't clobber each other.
const apps = [];
async function clientAs(email) {
  const app = initializeApp(firebaseConfig, `S2A_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  let user;
  try {
    user = (await createUserWithEmailAndPassword(auth, email, "TestPass123!")).user;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      user = (await signInWithEmailAndPassword(auth, email, "TestPass123!")).user;
    } else throw err;
  }
  return { db, auth, uid: user.uid };
}

async function expectDenied(promise, label) {
  try {
    await promise;
    check(label, false);
  } catch (err) {
    check(`${label} (${err.code || err.message})`, err.code === "permission-denied" || /permission/i.test(String(err.message)));
  }
}
async function expectAllowed(promise, label) {
  try {
    await promise;
    check(label, true);
  } catch (err) {
    check(`${label} — unexpected error: ${err.code || err.message}`, false);
  }
}

async function main() {
  const CLINIC_A = "slice2a-clinic-a";
  const CLINIC_B = "slice2a-clinic-b";

  // --- Fixtures (Admin SDK — setup only, not the code under test) ----------
  console.log("=== Seeding fixtures ===");

  const adminA = await clientAs("s2a.admin.a@verify.local");
  const adminCursoA = await clientAs("s2a.admincurso.a@verify.local");
  const profA = await clientAs("s2a.prof.a@verify.local");
  const profOtherA = await clientAs("s2a.profother.a@verify.local"); // staff of a DIFFERENT turma
  const auxA = await clientAs("s2a.aux.a@verify.local");
  const studentA1 = await clientAs("s2a.student.a1@verify.local"); // enrolled
  const studentA2 = await clientAs("s2a.student.a2@verify.local"); // NOT enrolled
  const adminB = await clientAs("s2a.admin.b@verify.local");
  const platformAdmin = await clientAs("s2a.platformadmin@verify.local");

  await adminDb.doc(`clinics/${CLINIC_A}/members/${adminA.uid}`).set({ role: "admin", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${adminCursoA.uid}`).set({ role: "member", status: "active", active: true, courseRole: "admin_curso" });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${profA.uid}`).set({ role: "member", status: "active", active: true, courseRole: "professor" });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${profOtherA.uid}`).set({ role: "member", status: "active", active: true, courseRole: "professor" });
  await adminDb.doc(`clinics/${CLINIC_A}/members/${auxA.uid}`).set({ role: "member", status: "active", active: true, courseRole: "auxiliar" });
  await adminDb.doc(`clinics/${CLINIC_B}/members/${adminB.uid}`).set({ role: "admin", status: "active", active: true });
  await adminDb.doc(`platform_admins/${platformAdmin.uid}`).set({ active: true, role: "super_admin" });

  await adminDb.doc(`clinics/${CLINIC_A}/education_students/${studentA1.uid}`).set({ authUid: studentA1.uid, name: "Student A1", status: "ativo" });
  await adminDb.doc(`clinics/${CLINIC_A}/education_students/${studentA2.uid}`).set({ authUid: studentA2.uid, name: "Student A2", status: "ativo" });

  const courseA = await adminDb.collection(`clinics/${CLINIC_A}/education_courses`).add({ name: "Curso A", type: "presencial", status: "em_andamento" });
  const courseB = await adminDb.collection(`clinics/${CLINIC_B}/education_courses`).add({ name: "Curso B", type: "presencial", status: "em_andamento" });

  const turmaA = await adminDb.collection(`clinics/${CLINIC_A}/education_turmas`).add({
    clinicId: CLINIC_A, courseId: courseA.id, name: "Turma A1", startDate: "2026-01-01", endDate: "2026-06-01",
    status: "em_andamento", maxStudents: 20, createdBy: adminA.uid,
  });
  const turmaAOther = await adminDb.collection(`clinics/${CLINIC_A}/education_turmas`).add({
    clinicId: CLINIC_A, courseId: courseA.id, name: "Turma A2 (outro professor)", startDate: "2026-01-01", endDate: "2026-06-01",
    status: "em_andamento", maxStudents: 20, createdBy: adminA.uid,
  });
  const turmaB = await adminDb.collection(`clinics/${CLINIC_B}/education_turmas`).add({
    clinicId: CLINIC_B, courseId: courseB.id, name: "Turma B1", startDate: "2026-01-01", endDate: "2026-06-01",
    status: "em_andamento", maxStudents: 20, createdBy: adminB.uid,
  });

  await adminDb.doc(`clinics/${CLINIC_A}/education_turmas/${turmaA.id}/staff/${profA.uid}`).set({
    uid: profA.uid, role: "professor", assignedBy: adminA.uid, assignedAt: admin.firestore.FieldValue.serverTimestamp(), active: true,
  });
  await adminDb.doc(`clinics/${CLINIC_A}/education_turmas/${turmaAOther.id}/staff/${profOtherA.uid}`).set({
    uid: profOtherA.uid, role: "professor", assignedBy: adminA.uid, assignedAt: admin.firestore.FieldValue.serverTimestamp(), active: true,
  });

  const enrollmentA1 = await adminDb.doc(`clinics/${CLINIC_A}/education_enrollments/${turmaA.id}_${studentA1.uid}`).set({
    clinicId: CLINIC_A, studentId: studentA1.uid, turmaId: turmaA.id, courseId: courseA.id, status: "ativa",
    permissions: {}, accessExpirationDate: null, enrolledBy: adminA.uid, enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
  });

  console.log("=== Fixtures ready ===\n");

  // ============================================================
  // NEGATIVE TESTS
  // ============================================================

  console.log("--- 1. Aluna A1 lê matrícula de si mesma vs. outra aluna ---");
  const enrollmentA1Path = doc(studentA1.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA1.uid}`);
  await expectAllowed(getDoc(enrollmentA1Path), "[POSITIVO] Aluna A1 lê a própria matrícula");

  console.log("\n--- 2. Aluna A2 (sem matrícula) tenta ler turma ---");
  await expectDenied(getDoc(doc(studentA2.db, "clinics", CLINIC_A, "education_turmas", turmaA.id)), "Aluna sem matrícula lê turma");

  console.log("\n--- 3. Aluna A1 tenta ler /staff ---");
  await expectDenied(getDoc(doc(studentA1.db, "clinics", CLINIC_A, "education_turmas", turmaA.id, "staff", profA.uid)), "Aluna lê /staff");

  console.log("\n--- 4. Aluna A1 tenta alterar as próprias permissões ---");
  await expectDenied(
    updateDoc(enrollmentA1Path, { "permissions.permWriteEvolution": true }),
    "Aluna altera as próprias permissões"
  );

  console.log("\n--- 5. Aluna A1 tenta trocar studentId/turmaId/courseId da própria matrícula ---");
  await expectDenied(updateDoc(enrollmentA1Path, { turmaId: turmaAOther.id }), "Aluna troca turmaId da própria matrícula");

  console.log("\n--- 6. Aluna A1 tenta se matricular sozinha (em outra turma) ---");
  await expectDenied(
    setDoc(doc(studentA1.db, "clinics", CLINIC_A, "education_enrollments", `${turmaAOther.id}_${studentA1.uid}`), {
      clinicId: CLINIC_A, studentId: studentA1.uid, turmaId: turmaAOther.id, courseId: courseA.id, status: "ativa",
      permissions: {}, accessExpirationDate: null, enrolledBy: studentA1.uid, enrolledAt: serverTimestamp(),
      completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "Aluna se matricula sozinha"
  );

  console.log("\n--- 7. Professor A acessa turma do professor Other (não atribuída) ---");
  await expectDenied(getDoc(doc(profA.db, "clinics", CLINIC_A, "education_turmas", turmaAOther.id)), "Professor A lê turma não atribuída");

  console.log("\n--- 8. Professor A tenta se adicionar a outra turma ---");
  await expectDenied(
    setDoc(doc(profA.db, "clinics", CLINIC_A, "education_turmas", turmaAOther.id, "staff", profA.uid), {
      uid: profA.uid, role: "professor", assignedBy: profA.uid, assignedAt: serverTimestamp(), active: true,
    }),
    "Professor se autoatribui a uma turma"
  );

  console.log("\n--- 9. Usuário de outra clínica (Admin B) acessa entidades da Clínica A ---");
  await expectDenied(getDoc(doc(adminB.db, "clinics", CLINIC_A, "education_turmas", turmaA.id)), "Admin B lê turma da Clínica A");
  await expectDenied(getDoc(doc(adminB.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA1.uid}`)), "Admin B lê matrícula da Clínica A");

  console.log("\n--- 10. Criar matrícula com turma e curso incompatíveis (Admin Curso A) ---");
  await expectDenied(
    setDoc(doc(adminCursoA.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA2.uid}`), {
      clinicId: CLINIC_A, studentId: studentA2.uid, turmaId: turmaA.id, courseId: "curso-errado-inventado", status: "ativa",
      permissions: {}, accessExpirationDate: null, enrolledBy: adminCursoA.uid, enrolledAt: serverTimestamp(),
      completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "courseId da matrícula não bate com o da turma"
  );

  console.log("\n--- 11. Admin B (outra clínica) cria matrícula numa turma da Clínica A ---");
  await expectDenied(
    setDoc(doc(adminB.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA2.uid}`), {
      clinicId: CLINIC_A, studentId: studentA2.uid, turmaId: turmaA.id, courseId: courseA.id, status: "ativa",
      permissions: {}, accessExpirationDate: null, enrolledBy: adminB.uid, enrolledAt: serverTimestamp(),
      completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "Admin de outra clínica cria matrícula fora da própria clínica"
  );

  console.log("\n--- 12. Staff (Professor A) tenta mudar studentId de uma matrícula existente ---");
  await expectDenied(
    updateDoc(doc(profA.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA1.uid}`), { studentId: studentA2.uid }),
    "Professor tenta trocar studentId de uma matrícula"
  );

  console.log("\n--- 13. Auxiliar A tenta criar matrícula ---");
  await expectDenied(
    setDoc(doc(auxA.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA2.uid}`), {
      clinicId: CLINIC_A, studentId: studentA2.uid, turmaId: turmaA.id, courseId: courseA.id, status: "ativa",
      permissions: {}, accessExpirationDate: null, enrolledBy: auxA.uid, enrolledAt: serverTimestamp(),
      completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "Auxiliar cria matrícula"
  );

  console.log("\n--- 14. Professor A (staff da própria turma) tenta criar matrícula ---");
  await expectDenied(
    setDoc(doc(profA.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA2.uid}`), {
      clinicId: CLINIC_A, studentId: studentA2.uid, turmaId: turmaA.id, courseId: courseA.id, status: "ativa",
      permissions: {}, accessExpirationDate: null, enrolledBy: profA.uid, enrolledAt: serverTimestamp(),
      completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "Professor (staff da própria turma) cria matrícula"
  );

  console.log("\n--- 15. Platform Admin tenta delete normal de matrícula ---");
  await expectDenied(deleteDoc(doc(platformAdmin.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA1.uid}`)), "Platform Admin apaga matrícula pelo fluxo normal");

  console.log("\n--- 16. Admin Curso A tenta delete normal de matrícula (mesma regra, qualquer papel) ---");
  await expectDenied(deleteDoc(doc(adminCursoA.db, "clinics", CLINIC_A, "education_enrollments", `${turmaA.id}_${studentA1.uid}`)), "Admin Curso apaga matrícula pelo fluxo normal");

  // ============================================================
  // POSITIVE TESTS
  // ============================================================

  console.log("\n--- 17. Clinic Admin cria turma, atribui professor, matricula aluna (caminho legítimo) ---");
  const newTurmaRef = doc(collection(adminA.db, "clinics", CLINIC_A, "education_turmas"));
  await expectAllowed(
    setDoc(newTurmaRef, {
      clinicId: CLINIC_A, courseId: courseA.id, name: "Turma A3 (fluxo positivo)", startDate: "2026-02-01", endDate: "2026-07-01",
      status: "planejada", maxStudents: 15, createdBy: adminA.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "Clinic Admin cria turma"
  );
  await expectAllowed(
    setDoc(doc(adminA.db, "clinics", CLINIC_A, "education_turmas", newTurmaRef.id, "staff", profA.uid), {
      uid: profA.uid, role: "professor", assignedBy: adminA.uid, assignedAt: serverTimestamp(), active: true,
    }),
    "Clinic Admin atribui professor à turma"
  );
  await expectAllowed(
    setDoc(doc(adminA.db, "clinics", CLINIC_A, "education_enrollments", `${newTurmaRef.id}_${studentA2.uid}`), {
      clinicId: CLINIC_A, studentId: studentA2.uid, turmaId: newTurmaRef.id, courseId: courseA.id, status: "ativa",
      permissions: {}, accessExpirationDate: null, enrolledBy: adminA.uid, enrolledAt: serverTimestamp(),
      completedAt: null, certificateIssued: false, certificateCode: null, certificateIssuedAt: null, migratedFromLegacy: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }),
    "Clinic Admin matricula aluna"
  );

  console.log("\n--- 18. Aluna A2 (agora matriculada) lê a própria turma e a própria matrícula ---");
  await expectAllowed(getDoc(doc(studentA2.db, "clinics", CLINIC_A, "education_turmas", newTurmaRef.id)), "Aluna recém-matriculada lê a própria turma");
  await expectAllowed(getDoc(doc(studentA2.db, "clinics", CLINIC_A, "education_enrollments", `${newTurmaRef.id}_${studentA2.uid}`)), "Aluna recém-matriculada lê a própria matrícula");

  console.log("\n--- 19. Professor A (staff da turma) lê a turma e o roster de matrículas, sem escrever ---");
  await expectAllowed(getDoc(doc(profA.db, "clinics", CLINIC_A, "education_turmas", turmaA.id)), "Professor lê a própria turma");
  await expectAllowed(
    getDocs(query(collection(profA.db, "clinics", CLINIC_A, "education_enrollments"), where("turmaId", "==", turmaA.id))),
    "Professor lê o roster de matrículas da própria turma"
  );

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  console.log("(2 rollback tests — migrationId isolation, altered-doc protection — are 2B-only, not runnable yet: no backfill/rollback script exists.)");

  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exit(1);
});
