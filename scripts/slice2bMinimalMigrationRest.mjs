/**
 * Same migration as slice2bMinimalMigration.mjs, but via Firestore REST +
 * `gcloud auth print-access-token` instead of firebase-admin's ADC — the
 * ADC path only had read access in this environment (write failed with
 * PERMISSION_DENIED), while the interactive gcloud identity already proved
 * it can write (firestore.rules/indexes deploys earlier this session).
 *
 * Run with: node scripts/slice2bMinimalMigrationRest.mjs
 */
import { execSync } from 'child_process';

const PROJECT = 'elisa-494703';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOKEN = execSync('gcloud auth print-access-token').toString().trim();

const CLINIC_ID = 'l9GzEcXT7uhcYHgRVVhe';
const COURSE_ID = 'WxjMGpFq2XDiuORerZEd';
const MIGRATION_ID = 'slice2b-min-2026-08-29';
const MIGRATION_VERSION = '1';
const ENROLLED_BY = 'PnEUUeLkWIVyIdIbcynwqBa6Wv72';

function sv(s) { return { stringValue: s }; }
function bv(b) { return { booleanValue: !!b }; }
function nv() { return { nullValue: null }; }
function tsNow() { return { timestampValue: new Date().toISOString() }; }
function mv(obj) { return { mapValue: { fields: obj } }; }

async function firestoreFetch(path, method, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log('=== Lendo docs das 2 alunas (pra copiar permissões/accessExpirationDate reais) ===');
  const vivian = await firestoreFetch(`clinics/${CLINIC_ID}/education_students/B81SJmpcc1eOL69CHOFR08CMJM63`, 'GET');
  const denise = await firestoreFetch(`clinics/${CLINIC_ID}/education_students/student_1781316613667`, 'GET');
  const vf = vivian.fields;
  const df = denise.fields;
  console.log('Vivian accessExpirationDate:', vf.accessExpirationDate?.stringValue);
  console.log('Denise accessExpirationDate:', df.accessExpirationDate?.stringValue);

  console.log('\n=== Criando Turma A ===');
  const turmaId = `turma_${Date.now()}`;
  await firestoreFetch(`clinics/${CLINIC_ID}/education_turmas?documentId=${turmaId}`, 'POST', {
    fields: {
      clinicId: sv(CLINIC_ID),
      courseId: sv(COURSE_ID),
      name: sv('Turma A'),
      startDate: sv('2026-06-13'),
      endDate: sv('2026-07-13'),
      status: sv('em_andamento'),
      maxStudents: nv(),
      createdBy: sv(ENROLLED_BY),
      createdAt: tsNow(),
      updatedAt: tsNow(),
    },
  });
  console.log('Turma criada:', turmaId);

  const students = [
    { id: 'B81SJmpcc1eOL69CHOFR08CMJM63', name: 'Vivian Areco Louveira', fields: vf },
    { id: 'student_1781316613667', name: 'Denise Farias Costa', fields: df },
  ];

  for (const s of students) {
    const enrollmentId = `${turmaId}_${s.id}`;
    const f = s.fields;
    await firestoreFetch(`clinics/${CLINIC_ID}/education_enrollments?documentId=${enrollmentId}`, 'POST', {
      fields: {
        clinicId: sv(CLINIC_ID),
        studentId: sv(s.id),
        turmaId: sv(turmaId),
        courseId: sv(COURSE_ID),
        status: sv('ativa'),
        permissions: mv({
          permViewSchedule: bv(f.permViewSchedule?.booleanValue),
          permViewPatients: bv(f.permViewPatients?.booleanValue),
          permEditPatientRecords: bv(f.permEditPatientRecords?.booleanValue),
          permAttachPhotos: bv(f.permAttachPhotos?.booleanValue),
          permWriteEvolution: bv(f.permWriteEvolution?.booleanValue),
          permViewMaterials: bv(f.permViewMaterials?.booleanValue),
          permViewPlannedProcedures: bv(f.permViewPlannedProcedures?.booleanValue),
          permDownloadCertificate: bv(f.permDownloadCertificate?.booleanValue),
          permAccessAfterEnd: bv(f.permAccessAfterEnd?.booleanValue),
        }),
        accessExpirationDate: f.accessExpirationDate?.stringValue ? sv(f.accessExpirationDate.stringValue) : nv(),
        enrolledAt: tsNow(),
        enrolledBy: sv(ENROLLED_BY),
        completedAt: nv(),
        certificateIssued: bv(false),
        certificateCode: nv(),
        certificateIssuedAt: nv(),
        migratedFromLegacy: bv(true),
        migrationId: sv(MIGRATION_ID),
        migrationVersion: sv(MIGRATION_VERSION),
        migratedAt: tsNow(),
        createdAt: tsNow(),
        updatedAt: tsNow(),
      },
    });
    console.log(`Matrícula criada para ${s.name}:`, enrollmentId);
  }

  console.log('\n=== Validando leitura de volta ===');
  const t = await firestoreFetch(`clinics/${CLINIC_ID}/education_turmas/${turmaId}`, 'GET');
  console.log('Turma lida OK:', t.fields.name.stringValue, t.fields.status.stringValue);
  for (const s of students) {
    const enrollmentId = `${turmaId}_${s.id}`;
    const e = await firestoreFetch(`clinics/${CLINIC_ID}/education_enrollments/${enrollmentId}`, 'GET');
    console.log(`Matrícula ${s.name} lida OK: status=${e.fields.status.stringValue}, studentId=${e.fields.studentId.stringValue}, accessExpirationDate=${e.fields.accessExpirationDate?.stringValue}`);
  }

  console.log('\n=== Concluído ===');
  console.log(JSON.stringify({ turmaId, migrationId: MIGRATION_ID, courseId: COURSE_ID, clinicId: CLINIC_ID }, null, 2));
}

main().catch((err) => { console.error('Migration script crashed:', err.message); process.exit(1); });
