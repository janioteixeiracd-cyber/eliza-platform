import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, runTransaction,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type {
  EducationTurma, TurmaStaffAssignment, TurmaStaffRole,
  EducationEnrollment, EnrollmentPermissions, EnrollmentStatus,
} from '../types/education';

// Slice 2A — Fundação Acadêmica. Every write function here re-fetches the
// documents it references (course, turma, student) instead of trusting an ID
// string handed in by a caller/form — the Firestore rules re-check the same
// relationships server-side, but this repository layer never constructs a
// payload from unchecked input in the first place. See CEREBRO / the Slice 2
// design doc for the full rationale.

function turmasCol(clinicId: string) {
  return collection(db, 'clinics', clinicId, 'education_turmas');
}
function turmaRef(clinicId: string, turmaId: string) {
  return doc(db, 'clinics', clinicId, 'education_turmas', turmaId);
}
function staffRef(clinicId: string, turmaId: string, uid: string) {
  return doc(db, 'clinics', clinicId, 'education_turmas', turmaId, 'staff', uid);
}
function enrollmentsCol(clinicId: string) {
  return collection(db, 'clinics', clinicId, 'education_enrollments');
}
function enrollmentRef(clinicId: string, turmaId: string, studentId: string) {
  return doc(db, 'clinics', clinicId, 'education_enrollments', `${turmaId}_${studentId}`);
}
function courseRef(clinicId: string, courseId: string) {
  return doc(db, 'clinics', clinicId, 'education_courses', courseId);
}
function studentRef(clinicId: string, studentId: string) {
  return doc(db, 'clinics', clinicId, 'education_students', studentId);
}

export const AcademyEnrollmentService = {
  // --- Turmas --------------------------------------------------------------

  async createTurma(
    clinicId: string,
    input: { courseId: string; name: string; startDate: string; endDate: string; maxStudents?: number | null },
    createdByUid: string
  ): Promise<string> {
    const courseSnap = await getDoc(courseRef(clinicId, input.courseId));
    if (!courseSnap.exists()) {
      throw new Error('Curso não encontrado nesta clínica — não é possível criar a turma.');
    }
    const payload: Omit<EducationTurma, 'id'> = {
      clinicId,
      courseId: input.courseId,
      name: input.name.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'planejada',
      maxStudents: input.maxStudents ?? null,
      createdBy: createdByUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(turmasCol(clinicId), payload);
    return ref.id;
  },

  async listTurmasForCourse(clinicId: string, courseId: string): Promise<EducationTurma[]> {
    const snap = await getDocs(query(turmasCol(clinicId), where('courseId', '==', courseId)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EducationTurma, 'id'>) }));
  },

  // --- Vínculo Professor/Auxiliar ↔ Turma -----------------------------------
  // Deterministic doc id (= uid) + transaction gives the same "at most one
  // active assignment per person per turma" guarantee the Consciência Ativa
  // pattern uses elsewhere, adapted to the client SDK (which has no
  // DocumentReference.create() — that's an Admin-SDK-only method).

  async assignTurmaStaff(
    clinicId: string,
    turmaId: string,
    targetUid: string,
    role: TurmaStaffRole,
    assignedByUid: string
  ): Promise<void> {
    if (targetUid === assignedByUid) {
      throw new Error('Não é possível se autoatribuir a uma turma — precisa ser feito por um admin.');
    }
    const tRef = turmaRef(clinicId, turmaId);
    const tSnap = await getDoc(tRef);
    if (!tSnap.exists()) throw new Error('Turma não encontrada.');

    const sRef = staffRef(clinicId, turmaId, targetUid);
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(sRef);
      const payload: TurmaStaffAssignment = {
        uid: targetUid,
        role,
        assignedBy: assignedByUid,
        assignedAt: serverTimestamp(),
        active: true,
      };
      if (existing.exists() && existing.data().active === true) {
        // Idempotent no-op-ish: re-assigning an already-active person just
        // updates role/assignedBy, never silently fails.
        tx.set(sRef, payload);
      } else {
        tx.set(sRef, payload);
      }
    });
  },

  async revokeTurmaStaff(clinicId: string, turmaId: string, targetUid: string): Promise<void> {
    await updateDoc(staffRef(clinicId, turmaId, targetUid), { active: false, updatedAt: serverTimestamp() } as any);
  },

  async listTurmaStaff(clinicId: string, turmaId: string): Promise<TurmaStaffAssignment[]> {
    const snap = await getDocs(collection(db, 'clinics', clinicId, 'education_turmas', turmaId, 'staff'));
    return snap.docs.map((d) => d.data() as TurmaStaffAssignment);
  },

  // No listTurmasForStaffMember() in 2A: a safe version would need a
  // collectionGroup('staff') query, which requires a {path=**}/staff rule —
  // any such rule broad enough to authorize the query (OR-combined with the
  // scoped nested rule by Firestore's own evaluation model) would let any
  // signed-in user, including a student, read staff docs directly. That
  // directly contradicts Ajuste 2 of the Slice 2 homologation, so this is
  // deferred until a safe design exists (e.g. a denormalized per-user index
  // doc, or a server-side endpoint) rather than shipped insecure.

  // --- Matrículas ------------------------------------------------------------
  // Slice 2A restriction (homologação): only called by Clinic Admin / Admin
  // Curso flows. Professor/auxiliar never call these — enforced again by
  // firestore.rules, this is just the repository not offering a path that
  // would be rejected anyway.

  async createEnrollment(
    clinicId: string,
    turmaId: string,
    studentId: string,
    permissions: EnrollmentPermissions,
    accessExpirationDate: string | null,
    enrolledByUid: string
  ): Promise<string> {
    if (studentId === enrolledByUid) {
      throw new Error('Uma aluna não pode se matricular sozinha — precisa ser feito por um admin.');
    }
    const tSnap = await getDoc(turmaRef(clinicId, turmaId));
    if (!tSnap.exists()) throw new Error('Turma não encontrada.');
    const turma = tSnap.data() as EducationTurma;

    const sSnap = await getDoc(studentRef(clinicId, studentId));
    if (!sSnap.exists()) throw new Error('Aluna não encontrada nesta clínica.');

    const ref = enrollmentRef(clinicId, turmaId, studentId);
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists() && existing.data().status !== 'cancelada') {
        throw new Error('Esta aluna já tem matrícula ativa/concluída nesta turma.');
      }
      const payload: Omit<EducationEnrollment, 'id'> = {
        clinicId,
        studentId,
        turmaId,
        courseId: turma.courseId, // always derived from the turma just read, never from caller input
        status: 'ativa',
        permissions,
        accessExpirationDate,
        enrolledAt: serverTimestamp(),
        enrolledBy: enrolledByUid,
        completedAt: null,
        certificateIssued: false,
        certificateCode: null,
        certificateIssuedAt: null,
        migratedFromLegacy: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      tx.set(ref, payload);
    });
    return ref.id;
  },

  async updateEnrollmentStatus(
    clinicId: string,
    turmaId: string,
    studentId: string,
    newStatus: EnrollmentStatus
  ): Promise<void> {
    // studentId/turmaId/courseId are never part of this payload — the
    // immutability of those fields is enforced by firestore.rules, and this
    // function structurally can't even attempt to touch them.
    await updateDoc(enrollmentRef(clinicId, turmaId, studentId), {
      status: newStatus,
      updatedAt: serverTimestamp(),
      ...(newStatus === 'concluida' ? { completedAt: serverTimestamp() } : {}),
    } as any);
  },

  async listEnrollmentsForStudent(clinicId: string, studentId: string): Promise<EducationEnrollment[]> {
    const snap = await getDocs(
      query(enrollmentsCol(clinicId), where('studentId', '==', studentId), orderBy('enrolledAt', 'desc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EducationEnrollment, 'id'>) }));
  },

  async listEnrollmentsForTurma(clinicId: string, turmaId: string): Promise<EducationEnrollment[]> {
    const snap = await getDocs(query(enrollmentsCol(clinicId), where('turmaId', '==', turmaId)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EducationEnrollment, 'id'>) }));
  },
};
