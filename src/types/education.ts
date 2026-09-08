export type CourseType = 'presencial' | 'online' | 'mentoria' | 'residência' | 'imersão' | 'especialização' | 'workshop';
export type CourseStatus = 'planejado' | 'em_andamento' | 'finalizado' | 'cancelado';
export type ModuleProcedureStatus = 'planejado' | 'confirmado' | 'em_execução' | 'realizado' | 'cancelado';
export type ModelPatientStatus = 'interessado' | 'selecionado' | 'confirmado' | 'atendido' | 'desistiu' | 'contraindicado';
export type StudentStatus = 'ativo' | 'inativo' | 'concluído' | 'suspenso';
export type EducationUserRole = 'admin_curso' | 'professor' | 'auxiliar' | 'aluno' | 'somente_visualizacao';

export interface EducationCourse {
  id: string;
  name: string;
  type: CourseType;
  professorId: string;
  professorName: string;
  supportStaff: string;
  startDate: string;
  endDate: string;
  durationHours: number;
  location: string;
  maxStudents: number;
  status: CourseStatus;
  price: number;
  observations: string;
  createdAt: any;
}

export interface CourseModule {
  id: string;
  courseId: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  mainTopic: string;
  program: string;
  relatedProcedures: string[];
  requiredMaterials: string[];
  professorId: string;
  professorName: string;
  observations: string;
  createdAt: any;
}

export interface ModuleProcedure {
  id: string;
  courseId: string;
  moduleId: string;
  procedure: string;
  patientId: string;
  patientName: string;
  professorId: string;
  professorName: string;
  studentId: string;
  studentName: string;
  status: ModuleProcedureStatus;
  materialsPredicted: string[];
  clinicalNotes: string;
  beforePhoto?: string;
  afterPhoto?: string;
  evolutionNotes: string;
  complications: string;
  createdAt: any;
}

export interface ModelPatient {
  id: string;
  patientClinicId?: string; // Original clinic patient reference if imported
  name: string;
  cpf: string;
  phone: string;
  birthDate: string;
  address: string;
  chiefComplaint: string;
  desiredProcedure: string;
  courseId: string;
  moduleId: string;
  status: ModelPatientStatus;
  
  // Clinical / Anamnese data
  medicalHistory: string;
  medications: string;
  allergies: string;
  contraindications: string;
  planning: string;
  postOpInstructions: string;
  imageConsentSigned: boolean;
  tcleSigned: boolean;
  
  createdAt: any;
  updatedAt?: any;
}

export interface ModelPatientLog {
  id: string;
  patientId: string;
  studentId: string;
  studentName: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  date: string;
  time: string;
  revisedByProfessor: boolean;
}

export interface EducationStudent {
  id: string;
  name: string;
  cpf: string;
  councilNumber?: string; // CRO/CRM
  profession: string;
  phone: string;
  email: string;
  courseId: string; // Course linked to
  batchName: string; // Turma
  startDate: string;
  endDate: string;
  status: StudentStatus;
  
  // Permissions
  permViewSchedule: boolean;
  permViewPatients: boolean;
  permEditPatientRecords: boolean;
  permAttachPhotos: boolean;
  permWriteEvolution: boolean;
  permViewMaterials: boolean;
  permViewPlannedProcedures: boolean;
  permDownloadCertificate: boolean;
  permAccessAfterEnd: boolean;
  accessExpirationDate: string;
  
  createdAt: any;
}

export interface CourseMaterial {
  id: string;
  courseId: string;
  title: string;
  type: 'pdf' | 'doc' | 'video' | 'link' | 'slides' | 'other';
  url: string;
  uploaderName: string;
  createdAt: any;
}

export interface CourseFinance {
  id: string;
  courseId: string;
  studentPrice: number;
  totalStudents: number;
  revenueEstimated: number;
  operationalCost: number;
  sellerCommission: number;
  netEstimatedProfit: number;
  paymentMethod: string;
  installments: number;
  discountOffered: number;
}

export interface EducationAuditLog {
  id: string;
  type: string; // Mapped event type
  userId: string;
  userName: string;
  userEmail: string;
  clinicId: string;
  timestamp: any;
  details: string;
}

// --- Slice 2A: Fundação Acadêmica (Turma + Matrícula) -----------------------
//
// education_students continues to be the identity doc (name, cpf, auth link,
// status) and — for now — still carries the legacy courseId/batchName/perm*
// fields untouched (see CEREBRO: this slice is additive-only, no write to
// education_students happens here). A student's real course history/access
// lives in education_enrollments from this slice forward.

export type TurmaStatus = 'planejada' | 'em_andamento' | 'concluida' | 'cancelada';
export type EnrollmentStatus = 'ativa' | 'concluida' | 'trancada' | 'cancelada';
export type TurmaStaffRole = 'professor' | 'auxiliar';

export interface EducationTurma {
  id: string;
  clinicId: string;
  courseId: string; // FK -> education_courses/{courseId}, same clinic
  name: string;
  startDate: string; // ISO date
  endDate: string;
  status: TurmaStatus;
  maxStudents: number | null;
  // Denormalized index of this turma's education_activities doc ids —
  // exists ONLY because Firestore cannot prove a `list` query safe when the
  // rule needs a per-document nested lookup (education_activities' read rule
  // checks hasValidEnrollment()/isTurmaStaff(), both cross-collection). A
  // get() on each id here (never a list()) sidesteps that limitation
  // entirely — same "deterministic id + get()" pattern already used for
  // enrollments/members elsewhere in this codebase.
  activityIds?: string[];
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

// clinics/{clinicId}/education_turmas/{turmaId}/staff/{uid} — doc id is the
// staff member's uid (deterministic, same convention as clinics/{id}/members).
// Never readable by students (firestore.rules) — carries assignedBy, which is
// exactly the authorization provenance a bare professorIds[]/auxiliarIds[]
// array on the turma doc could not give us.
export interface TurmaStaffAssignment {
  uid: string;
  role: TurmaStaffRole;
  assignedBy: string; // uid of the admin who assigned — never self-assignable
  assignedAt: any;
  active: boolean; // soft-remove preserves history of who taught this turma
}

// The 9 flags that used to live directly on EducationStudent (see above) —
// all reclassified as enrollment-scoped: what a student can do depends on
// which course she's actively enrolled in, decided by that course's staff,
// not a single global capability on her identity.
export interface EnrollmentPermissions {
  permViewSchedule: boolean;
  permViewPatients: boolean;
  permEditPatientRecords: boolean;
  permAttachPhotos: boolean;
  permWriteEvolution: boolean;
  permViewMaterials: boolean;
  permViewPlannedProcedures: boolean;
  permDownloadCertificate: boolean;
  permAccessAfterEnd: boolean;
}

export interface EducationEnrollment {
  id: string; // deterministic: `${turmaId}_${studentId}`
  clinicId: string;
  studentId: string; // FK -> education_students/{studentId}, same clinic
  turmaId: string; // FK -> education_turmas/{turmaId}, same clinic
  courseId: string; // always derived from the turma at write time, never trusted from a form field
  status: EnrollmentStatus;
  permissions: EnrollmentPermissions;
  accessExpirationDate: string | null; // ISO date; gates THIS enrollment only, never login itself
  enrolledAt: any;
  enrolledBy: string; // uid of the admin who created it — never equal to studentId
  completedAt: any | null;
  certificateIssued: boolean;
  certificateCode: string | null;
  certificateIssuedAt: any | null;

  // Migration identity (Slice 2B, not implemented yet) — only present on
  // docs created by a backfill run. Rollback must key off migrationId, never
  // off migratedFromLegacy alone (see CEREBRO for the incident this avoids).
  migratedFromLegacy: boolean;
  migrationId?: string;
  migrationVersion?: string;
  migratedAt?: any;

  createdAt: any;
  updatedAt: any;
}

// --- Educational Activities (Toxina/Preenchimento MVP, 2026-08-29) ----------
//
// Reuses PlanningCore's ProcedureTemplate (src/lib/planningTemplates.ts) via
// `templateId` — no second planning engine. An activity is the professor's
// assignment (published to a turma); a StudentAttempt is what one student
// produces against it. Append-only across revisions: a revision requested by
// the professor creates a NEW attempt doc (attemptNumber + 1), the previous
// attempt is never edited again — see firestore.rules for the immutability
// enforcement (not just a client convention).

export type ActivityStatus = 'draft' | 'published' | 'closed';
export type AttemptStatus = 'draft' | 'submitted' | 'revision_requested' | 'approved';
export type TutorInteractionMode = 'explain' | 'analyze' | 'post_review';

// Anti-gabarito / anti-prompt-injection contract (see server.ts's
// /api/eliza/academy-tutor): revealReferenceAfterReview gates whether the
// professor's own review content is ever READ into an AI prompt at all —
// never a "don't reveal this" instruction sitting next to data the model can
// still see. When false, the server structurally never fetches
// professorReview for the 'post_review' prompt, regardless of what the
// student asks the assistant to do.
export interface TutorPolicy {
  allowExplainBeforeSubmit: boolean;
  allowAnalyzeOwnContent: boolean;
  revealReferenceAfterReview: boolean;
}

export interface EducationActivity {
  id: string;
  clinicId: string;
  turmaId: string;
  courseId: string;
  templateId: string; // PlanningCore ProcedureTemplate id (e.g. 'toxina_botulinica')
  title: string;
  description: string;
  educationalObjectives: string;
  instructions: string;
  modelPatientId: string | null;
  requiredFieldKeys: string[]; // subset of the template's field keys mandatory for THIS activity
  tutorPolicy: TutorPolicy;
  status: ActivityStatus;
  required: boolean;
  professorId: string | null;
  professorName: string | null;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export interface ProfessorReview {
  decision: 'approved' | 'revision_requested';
  comments: string;
  // Professor's own reference/gabarito marking over the same image — a
  // SEPARATE layer from the student's `strokesJson`/`pointRecords` below,
  // never merged into them. Optional: a professor can review with just
  // `comments`, never required to draw a reference. Was already declared
  // (always written as null) but never actually populated until the
  // Clinical Learning Workspace (2026-08-29) gave it a real editor.
  drawingsJson: string | null;
  referencePointRecords: Record<string, { muscle: string; unidades: string; observacao: string }> | null;
  reviewedBy: string;
  reviewedByName: string;
  reviewedAt: any;
}

export interface AttemptAiInteraction {
  mode: TutorInteractionMode;
  question: string | null;
  answer: string;
  createdAt: any;
}

export interface StudentAttempt {
  id: string;
  clinicId: string;
  activityId: string;
  turmaId: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  templateId: string;
  attemptNumber: number;
  status: AttemptStatus;
  structuredFields: Record<string, string | boolean>;
  // Clinical Learning Workspace (2026-08-29): one row per point-type stroke
  // in `strokesJson`, keyed by that stroke's id — "Ponto N ↔ músculo ↔
  // unidades ↔ observação" from the anatomical map. Optional/absent for
  // templates without `clinicalWorkspace` (e.g. Preenchimento for now).
  pointRecords: Record<string, { muscle: string; unidades: string; observacao: string }> | null;
  studentAnalysis: string;
  justification: string;
  strokesJson: string | null;
  overlayThumbnailBase64: string | null;
  images: Record<string, string>;
  observations: string;
  aiInteractions: AttemptAiInteraction[];
  professorReview: ProfessorReview | null;
  createdAt: any;
  updatedAt: any;
  submittedAt: any | null;
}
