/**
 * Slice 2B — minimal, deterministic migration (2026-08-29).
 *
 * Scope: ONLY the 1 turma + 2 enrollments identified as unambiguous by the
 * dry-run (see CEREBRO). Explicitly excludes "aluno teste"
 * (QHzcgiH8zCcLPaNEtV58qvH8S9L2) — already-expired accessExpirationDate,
 * empty CPF/phone, not one of the 2 real students the user named. Uses the
 * Admin SDK directly (this is a one-off migration script, not a client
 * action) with real migration provenance fields so it's auditable and, if
 * ever necessary, reversible by migrationId — never touches
 * education_students (additive only, per the Slice 2 design).
 *
 * Run with: node scripts/slice2bMinimalMigration.mjs
 */
import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'elisa-494703' });
const db = admin.firestore();

const CLINIC_ID = 'l9GzEcXT7uhcYHgRVVhe';
const COURSE_ID = 'WxjMGpFq2XDiuORerZEd';
const MIGRATION_ID = 'slice2b-min-2026-08-29';
const MIGRATION_VERSION = '1';
const ENROLLED_BY = 'PnEUUeLkWIVyIdIbcynwqBa6Wv72'; // janioteixeiracd@gmail.com, real production owner/admin

const STUDENTS = [
  { id: 'B81SJmpcc1eOL69CHOFR08CMJM63', name: 'Vivian Areco Louveira' },
  { id: 'student_1781316613667', name: 'Denise Farias Costa' },
];

async function main() {
  const now = admin.firestore.FieldValue.serverTimestamp();

  console.log('=== Criando Turma A ===');
  const turmaRef = db.collection('clinics').doc(CLINIC_ID).collection('education_turmas').doc();
  await turmaRef.set({
    clinicId: CLINIC_ID,
    courseId: COURSE_ID,
    name: 'Turma A',
    startDate: '2026-06-13',
    endDate: '2026-07-13',
    status: 'em_andamento',
    maxStudents: null,
    createdBy: ENROLLED_BY,
    createdAt: now,
    updatedAt: now,
  });
  console.log('Turma criada:', turmaRef.id);

  for (const s of STUDENTS) {
    const studentSnap = await db.collection('clinics').doc(CLINIC_ID).collection('education_students').doc(s.id).get();
    if (!studentSnap.exists) {
      console.error(`PULANDO ${s.name} — doc não encontrado (${s.id})`);
      continue;
    }
    const student = studentSnap.data();
    const enrollmentId = `${turmaRef.id}_${s.id}`;
    const enrollmentRef = db.collection('clinics').doc(CLINIC_ID).collection('education_enrollments').doc(enrollmentId);
    await enrollmentRef.set({
      clinicId: CLINIC_ID,
      studentId: s.id,
      turmaId: turmaRef.id,
      courseId: COURSE_ID,
      status: 'ativa',
      permissions: {
        permViewSchedule: !!student.permViewSchedule,
        permViewPatients: !!student.permViewPatients,
        permEditPatientRecords: !!student.permEditPatientRecords,
        permAttachPhotos: !!student.permAttachPhotos,
        permWriteEvolution: !!student.permWriteEvolution,
        permViewMaterials: !!student.permViewMaterials,
        permViewPlannedProcedures: !!student.permViewPlannedProcedures,
        permDownloadCertificate: !!student.permDownloadCertificate,
        permAccessAfterEnd: !!student.permAccessAfterEnd,
      },
      accessExpirationDate: student.accessExpirationDate || null,
      enrolledAt: now,
      enrolledBy: ENROLLED_BY,
      completedAt: null,
      certificateIssued: false,
      certificateCode: null,
      certificateIssuedAt: null,
      migratedFromLegacy: true,
      migrationId: MIGRATION_ID,
      migrationVersion: MIGRATION_VERSION,
      migratedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Matrícula criada para ${s.name}:`, enrollmentId);
  }

  console.log('\n=== Concluído ===');
  console.log(JSON.stringify({ turmaId: turmaRef.id, migrationId: MIGRATION_ID, courseId: COURSE_ID, clinicId: CLINIC_ID }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration script crashed:', err);
  process.exit(1);
});
