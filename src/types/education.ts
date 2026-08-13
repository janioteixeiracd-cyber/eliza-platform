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
