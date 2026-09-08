/**
 * One-off fix (2026-08-29): Denise's education_students doc lived under a
 * stale placeholder id (student_1781316613667) instead of her real Firebase
 * Auth UID (81ZWe44aQsMs5lLaIIttTQW0ONn1) — the exact relink the app's
 * existing Slice 1 auto-relink logic would do on her next login, done here
 * proactively so it happens BEFORE she logs in (the app's relink only
 * touches education_students, never education_enrollments, so doing it here
 * lets both be fixed atomically together and avoid a window where her
 * freshly-created enrollment points at an id nothing will match anymore).
 * Does NOT touch her separate auto-created "Dra. Denise Farias" clinic/
 * membership — that is a different, ambiguous finding reported separately,
 * not resolved by this script.
 */
import { execSync } from 'child_process';

const PROJECT = 'elisa-494703';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOKEN = execSync('gcloud auth print-access-token').toString().trim();

const CLINIC_ID = 'l9GzEcXT7uhcYHgRVVhe';
const OLD_ID = 'student_1781316613667';
const REAL_UID = '81ZWe44aQsMs5lLaIIttTQW0ONn1';
const TURMA_ID = 'turma_1787993938734';

async function ff(path, method, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
function sv(s) { return { stringValue: s }; }
function tsNow() { return { timestampValue: new Date().toISOString() }; }

async function main() {
  console.log('=== 1. Relinking education_students ===');
  const oldStudent = await ff(`clinics/${CLINIC_ID}/education_students/${OLD_ID}`, 'GET');
  const fields = { ...oldStudent.fields, id: sv(REAL_UID), authUid: sv(REAL_UID), updatedAt: tsNow() };
  await ff(`clinics/${CLINIC_ID}/education_students?documentId=${REAL_UID}`, 'POST', { fields });
  await ff(`clinics/${CLINIC_ID}/education_students/${OLD_ID}`, 'DELETE');
  console.log('education_students relinked:', OLD_ID, '->', REAL_UID);

  console.log('\n=== 2. Recreating enrollment under corrected studentId ===');
  const oldEnrollmentId = `${TURMA_ID}_${OLD_ID}`;
  const oldEnrollment = await ff(`clinics/${CLINIC_ID}/education_enrollments/${oldEnrollmentId}`, 'GET');
  const newEnrollmentId = `${TURMA_ID}_${REAL_UID}`;
  const enrollmentFields = { ...oldEnrollment.fields, studentId: sv(REAL_UID), updatedAt: tsNow() };
  await ff(`clinics/${CLINIC_ID}/education_enrollments?documentId=${newEnrollmentId}`, 'POST', { fields: enrollmentFields });
  await ff(`clinics/${CLINIC_ID}/education_enrollments/${oldEnrollmentId}`, 'DELETE');
  console.log('enrollment relinked:', oldEnrollmentId, '->', newEnrollmentId);

  console.log('\n=== 3. Validando ===');
  const s = await ff(`clinics/${CLINIC_ID}/education_students/${REAL_UID}`, 'GET');
  console.log('education_students:', s.fields.name.stringValue, 'id/authUid corretos:', s.fields.id.stringValue === REAL_UID, s.fields.authUid.stringValue === REAL_UID);
  const e = await ff(`clinics/${CLINIC_ID}/education_enrollments/${newEnrollmentId}`, 'GET');
  console.log('enrollment:', e.fields.studentId.stringValue === REAL_UID ? 'studentId correto' : 'ERRO', 'status:', e.fields.status.stringValue);
}

main().catch((err) => { console.error('Fix script crashed:', err.message); process.exit(1); });
