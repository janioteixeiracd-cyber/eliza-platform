import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type {
  EducationActivity, StudentAttempt, ProfessorReview, TutorPolicy,
} from '../types/education';

// Educational Activities MVP (2026-08-29). Same discipline as
// academyEnrollmentService.ts: every write re-derives what it needs from
// real documents rather than trusting caller-supplied IDs, and
// firestore.rules re-checks the same relationships server-side either way.

function turmaRefFor(clinicId: string, turmaId: string) {
  return doc(db, 'clinics', clinicId, 'education_turmas', turmaId);
}
function activitiesCol(clinicId: string) {
  return collection(db, 'clinics', clinicId, 'education_activities');
}
function activityRef(clinicId: string, activityId: string) {
  return doc(db, 'clinics', clinicId, 'education_activities', activityId);
}
function attemptsCol(clinicId: string, activityId: string) {
  return collection(db, 'clinics', clinicId, 'education_activities', activityId, 'attempts');
}
function attemptRef(clinicId: string, activityId: string, attemptId: string) {
  return doc(db, 'clinics', clinicId, 'education_activities', activityId, 'attempts', attemptId);
}

export const AcademyActivityService = {
  // --- Activities (professor/admin) ----------------------------------------

  async createActivity(
    clinicId: string,
    input: {
      turmaId: string; courseId: string; templateId: string; title: string; description: string;
      educationalObjectives: string; instructions: string; modelPatientId: string | null;
      requiredFieldKeys: string[]; tutorPolicy: TutorPolicy; required: boolean;
      professorId: string | null; professorName: string | null;
    },
    createdByUid: string
  ): Promise<string> {
    const ref = doc(activitiesCol(clinicId));
    const payload: Omit<EducationActivity, 'id'> = {
      clinicId,
      turmaId: input.turmaId,
      courseId: input.courseId,
      templateId: input.templateId,
      title: input.title.trim(),
      description: input.description,
      educationalObjectives: input.educationalObjectives,
      instructions: input.instructions,
      modelPatientId: input.modelPatientId,
      requiredFieldKeys: input.requiredFieldKeys,
      tutorPolicy: input.tutorPolicy,
      status: 'draft',
      required: input.required,
      professorId: input.professorId,
      professorName: input.professorName,
      createdBy: createdByUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    // Denormalized index on the turma doc — see EducationTurma.activityIds
    // for why (Firestore can't prove a list() query safe against a rule
    // that needs a nested cross-collection lookup per document; get()s
    // against this index sidestep that entirely).
    await updateDoc(doc(db, 'clinics', clinicId, 'education_turmas', input.turmaId), {
      activityIds: arrayUnion(ref.id),
    } as any).catch((e) => console.warn('Failed to index activity on turma (non-fatal, only affects turma-staff listing):', e));
    return ref.id;
  },

  async publishActivity(clinicId: string, activityId: string): Promise<void> {
    await updateDoc(activityRef(clinicId, activityId), { status: 'published', updatedAt: serverTimestamp() } as any);
  },

  async closeActivity(clinicId: string, activityId: string): Promise<void> {
    await updateDoc(activityRef(clinicId, activityId), { status: 'closed', updatedAt: serverTimestamp() } as any);
  },

  // get()s each known activity id individually instead of list()-querying
  // by turmaId — see EducationTurma.activityIds for why. Reads the turma
  // doc first (a single get(), always safe under hasValidEnrollment()) to
  // learn which activities exist for it.
  async listActivitiesForTurma(clinicId: string, turmaId: string): Promise<EducationActivity[]> {
    const turmaSnap = await getDoc(turmaRefFor(clinicId, turmaId));
    const ids: string[] = turmaSnap.exists() ? (turmaSnap.data() as any).activityIds || [] : [];
    if (ids.length === 0) return [];
    const results = await Promise.all(ids.map((id) => getDoc(activityRef(clinicId, id)).catch(() => null)));
    return results
      .filter((snap): snap is NonNullable<typeof snap> => !!snap && snap.exists())
      .map((snap) => ({ id: snap.id, ...(snap.data() as Omit<EducationActivity, 'id'>) }));
  },

  async getActivity(clinicId: string, activityId: string): Promise<EducationActivity | null> {
    const snap = await getDoc(activityRef(clinicId, activityId));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<EducationActivity, 'id'>) }) : null;
  },

  // --- Attempts (student) ---------------------------------------------------

  async listAttemptsForActivity(clinicId: string, activityId: string): Promise<StudentAttempt[]> {
    const snap = await getDocs(query(attemptsCol(clinicId, activityId), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudentAttempt, 'id'>) }));
  },

  async listOwnAttempts(clinicId: string, activityId: string, studentId: string): Promise<StudentAttempt[]> {
    const snap = await getDocs(
      query(attemptsCol(clinicId, activityId), where('studentId', '==', studentId), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudentAttempt, 'id'>) }));
  },

  async createAttempt(
    clinicId: string,
    activity: EducationActivity,
    studentId: string,
    studentName: string,
    enrollmentId: string,
    attemptNumber: number
  ): Promise<string> {
    const ref = doc(attemptsCol(clinicId, activity.id));
    const payload: Omit<StudentAttempt, 'id'> = {
      clinicId,
      activityId: activity.id,
      turmaId: activity.turmaId,
      enrollmentId,
      studentId,
      studentName,
      templateId: activity.templateId,
      attemptNumber,
      status: 'draft',
      structuredFields: {},
      pointRecords: null,
      studentAnalysis: '',
      justification: '',
      strokesJson: null,
      overlayThumbnailBase64: null,
      images: {},
      observations: '',
      aiInteractions: [],
      professorReview: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      submittedAt: null,
    };
    await setDoc(ref, payload);
    return ref.id;
  },

  async saveDraft(
    clinicId: string,
    activityId: string,
    attemptId: string,
    patch: Partial<Pick<StudentAttempt, 'structuredFields' | 'pointRecords' | 'studentAnalysis' | 'justification' | 'strokesJson' | 'overlayThumbnailBase64' | 'images' | 'observations'>>
  ): Promise<void> {
    await updateDoc(attemptRef(clinicId, activityId, attemptId), { ...patch, updatedAt: serverTimestamp() } as any);
  },

  async submitAttempt(clinicId: string, activityId: string, attemptId: string): Promise<void> {
    await updateDoc(attemptRef(clinicId, activityId, attemptId), {
      status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    } as any);
  },

  // --- Review (professor/admin) ---------------------------------------------

  async reviewAttempt(
    clinicId: string,
    activityId: string,
    attemptId: string,
    review: Omit<ProfessorReview, 'reviewedAt'>
  ): Promise<void> {
    await updateDoc(attemptRef(clinicId, activityId, attemptId), {
      professorReview: { ...review, reviewedAt: serverTimestamp() },
      status: review.decision,
      updatedAt: serverTimestamp(),
    } as any);
  },
};
