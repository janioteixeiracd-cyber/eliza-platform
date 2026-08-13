import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GraduationCap, BookOpen, Users, Wallet, LayoutDashboard, Plus, Save, X, Trash2,
  Loader2, Search, ChevronUp, ChevronDown, Sparkles, AlertTriangle, ShieldAlert,
  Lock, Eye, EyeOff, CalendarDays, ListChecks, UserPlus, RefreshCw, Check, Wand2,
  FileText, ThumbsUp, ThumbsDown, PenTool, Printer, Award, Image as ImageIcon
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, doc as fsDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { InviteService } from '../../services/inviteService';
import AcademyPlanningCanvas from './AcademyPlanningCanvas';

type AcademyTab = 'dashboard' | 'cursos' | 'pacientes' | 'alunos' | 'casos' | 'documentos' | 'financeiro';

// A real Firebase Auth account is created with this password (see
// InviteService.createEducationStudent below) — must not be a fixed,
// guessable default shared by every new student across every clinic.
function generateTempPassword(): string {
  return `Eliza${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

interface Lesson { id: string; title: string; description?: string; duration?: string; supportMaterial?: string; }

interface Course {
  id: string;
  name: string;
  type: string;
  professorName?: string;
  supportStaff?: string;
  startDate?: string;
  endDate?: string;
  durationHours?: number;
  location?: string;
  maxStudents?: number;
  status: string;
  price?: number;
  observations?: string;
  createdAt?: any;
}

interface CourseModule {
  id: string;
  courseId: string;
  name: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  mainTopic?: string;
  program?: string;
  objectives?: string;
  summary?: string;
  description?: string;
  workload?: string;
  status: string;
  visibleToStudents?: boolean;
  lessons: Lesson[];
  createdAt?: any;
}

interface ModelPatient {
  id: string;
  name: string;
  cpf?: string;
  phone?: string;
  birthDate?: string;
  chiefComplaint?: string;
  desiredProcedure?: string;
  courseId?: string;
  status: string;
  medicalHistory?: string;
  medications?: string;
  allergies?: string;
  contraindications?: string;
  imageConsentSigned?: boolean;
  tcleSigned?: boolean;
  patientClinicId?: string;
  createdAt?: any;
}

interface Student {
  id: string;
  name: string;
  email?: string;
  courseId?: string;
  batchName?: string;
  status: string;
  accessExpirationDate?: string | null;
  permViewSchedule?: boolean;
  permViewPatients?: boolean;
  permEditPatientRecords?: boolean;
  permAttachPhotos?: boolean;
  permWriteEvolution?: boolean;
  permViewMaterials?: boolean;
  permViewPlannedProcedures?: boolean;
  permDownloadCertificate?: boolean;
  permAccessAfterEnd?: boolean;
  certificateIssued?: boolean;
  certificateCode?: string;
  certificateIssuedAt?: any;
  createdAt?: any;
}

interface StudentCase {
  id: string;
  studentId: string;
  studentName?: string;
  courseId?: string | null;
  batchName?: string | null;
  patientCode?: string | null;
  chiefComplaint?: string | null;
  clinicalNotes?: string | null;
  images: Record<string, string>;
  drawings?: Record<string, string>;
  professorDrawings?: Record<string, string>;
  status: 'pending' | 'approved' | 'adjust' | 'rejected';
  professorFeedback?: string;
  createdAt?: any;
}

const CASE_STATUS_META: Record<string, { label: string; classes: string }> = {
  pending: { label: 'Em análise', classes: 'bg-slate-800 border-next-border text-slate-400' },
  approved: { label: 'Aprovado', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  adjust: { label: 'Ajustes solicitados', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  rejected: { label: 'Rejeitado', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
};

interface DocTemplate { id: string; name: string; content: string; }

const DOC_TEMPLATES: DocTemplate[] = [
  { id: 'contrato_aluno', name: 'Contrato de Prestação de Serviços Educacionais', content:
`CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS

Contratante: {{nomeAluno}}, CPF/documento a apresentar.
Contratada: {{nomeClinica}}.
Curso: {{nomeCurso}} — Turma: {{turma}}.
Data de início: {{dataAtual}}.

O presente contrato regula a prestação de serviços educacionais referentes ao curso acima identificado, incluindo carga horária, materiais e condições de participação, conforme informado no ato da matrícula.` },
  { id: 'termo_matricula', name: 'Termo de Matrícula', content:
`TERMO DE MATRÍCULA

Aluno(a): {{nomeAluno}}
Curso: {{nomeCurso}} — Turma: {{turma}}
Data: {{dataAtual}}

Declaro estar ciente e de acordo com o conteúdo programático, carga horária e condições de participação do curso acima, confirmando minha matrícula junto a {{nomeClinica}}.` },
  { id: 'termo_responsabilidade', name: 'Termo de Responsabilidade', content:
`TERMO DE RESPONSABILIDADE

Aluno(a): {{nomeAluno}}
Curso: {{nomeCurso}}
Data: {{dataAtual}}

Declaro estar ciente de que a prática clínica supervisionada envolve procedimentos reais em pacientes-modelo, assumindo responsabilidade por seguir as orientações do corpo docente e os protocolos de biossegurança de {{nomeClinica}}.` },
  { id: 'termo_uso_imagem', name: 'Termo de Uso de Imagem', content:
`TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM

Aluno(a): {{nomeAluno}}
Curso: {{nomeCurso}}
Data: {{dataAtual}}

Autorizo {{nomeClinica}} a utilizar imagens capturadas durante as atividades práticas do curso para fins didáticos e de divulgação institucional, resguardado o sigilo dos pacientes envolvidos.` },
  { id: 'termo_paciente_modelo', name: 'Termo de Consentimento — Paciente-Modelo', content:
`TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO — PACIENTE-MODELO

Paciente: {{nomePaciente}}
Curso vinculado: {{nomeCurso}}
Data: {{dataAtual}}

Declaro ter sido informado(a) de que o atendimento será realizado por aluno(a) em formação, sob supervisão direta do corpo docente de {{nomeClinica}}, e concordo em participar voluntariamente como paciente-modelo.` },
  { id: 'tcle_procedimento', name: 'TCLE — Procedimento Prático', content:
`TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO PARA PROCEDIMENTO

Paciente: {{nomePaciente}}
Procedimento: a definir conforme módulo prático — {{nomeCurso}}
Data: {{dataAtual}}

Fui informado(a) sobre a natureza, os riscos e os benefícios do procedimento a ser realizado em ambiente de ensino supervisionado em {{nomeClinica}}, e autorizo sua realização.` },
];

function compileDocTemplate(content: string, vars: Record<string, string>): string {
  let out = content;
  Object.entries(vars).forEach(([tag, val]) => { out = out.split(`{{${tag}}}`).join(val || ''); });
  return out;
}

interface EduFinancialEntry {
  id: string;
  description: string;
  amount: number;
  status: string;
  paymentMethod?: string;
  date?: any;
  courseId?: string | null;
}

interface RealPatientOption { id: string; name: string; phone?: string; cpf?: string; birthDate?: string; }

const COURSE_TYPES = ['Presencial', 'Online', 'Mentoria', 'Residência', 'Imersão', 'Especialização', 'Workshop'];
const COURSE_STATUS = ['planejado', 'em_andamento', 'finalizado', 'cancelado'];
const COURSE_STATUS_META: Record<string, { label: string; classes: string }> = {
  planejado: { label: 'Planejado', classes: 'bg-slate-800 border-next-border text-slate-400' },
  em_andamento: { label: 'Em Andamento', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  finalizado: { label: 'Finalizado', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
  cancelado: { label: 'Cancelado', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
};
const MODULE_STATUS = ['Rascunho', 'Publicado', 'Oculto'];
const PATIENT_STATUS = ['interessado', 'selecionado', 'confirmado', 'atendido', 'desistiu', 'contraindicado'];
const PATIENT_STATUS_META: Record<string, { label: string; classes: string }> = {
  interessado: { label: 'Interessado', classes: 'bg-slate-800 border-next-border text-slate-400' },
  selecionado: { label: 'Selecionado', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
  confirmado: { label: 'Confirmado', classes: 'bg-next-purple-neon/10 border-next-purple-neon/20 text-next-purple-light' },
  atendido: { label: 'Atendido', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  desistiu: { label: 'Desistiu', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  contraindicado: { label: 'Contraindicado', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
};

const STUDENT_PERMISSIONS: { key: keyof Student; label: string }[] = [
  { key: 'permViewSchedule', label: 'Ver cronograma do curso' },
  { key: 'permViewPatients', label: 'Ver pacientes-modelo' },
  { key: 'permEditPatientRecords', label: 'Editar prontuário do paciente-modelo' },
  { key: 'permAttachPhotos', label: 'Anexar fotos' },
  { key: 'permWriteEvolution', label: 'Escrever evolução clínica' },
  { key: 'permViewMaterials', label: 'Ver materiais de aula' },
  { key: 'permViewPlannedProcedures', label: 'Ver procedimentos planejados' },
  { key: 'permDownloadCertificate', label: 'Baixar certificado ao concluir' },
  { key: 'permAccessAfterEnd', label: 'Manter acesso após o fim do curso' },
];
const DEFAULT_STUDENT_PERMS: Partial<Student> = {
  permViewSchedule: true, permViewPatients: true, permEditPatientRecords: false, permAttachPhotos: true,
  permWriteEvolution: true, permViewMaterials: true, permViewPlannedProcedures: true, permDownloadCertificate: true,
  permAccessAfterEnd: false,
};

function formatDate(d: any): string {
  try {
    if (!d) return '';
    if (typeof d === 'string') return new Date(d).toLocaleDateString('pt-BR');
    if (d.toDate) return d.toDate().toLocaleDateString('pt-BR');
    return new Date(d).toLocaleDateString('pt-BR');
  } catch { return ''; }
}
function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function newId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

const TABS: { id: AcademyTab; label: string; icon: any }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cursos', label: 'Cursos & Aulas', icon: BookOpen },
  { id: 'pacientes', label: 'Pacientes-Modelo', icon: Users },
  { id: 'alunos', label: 'Alunos', icon: GraduationCap },
  { id: 'casos', label: 'Casos de Alunos', icon: ListChecks },
  { id: 'documentos', label: 'Documentos', icon: FileText },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet },
];

export default function NextAcademy() {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;

  const [activeTab, setActiveTab] = useState<AcademyTab>('dashboard');
  const [message, setMessage] = useState<string | null>(null);
  const showMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4500); };

  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [modelPatients, setModelPatients] = useState<ModelPatient[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [financialEntries, setFinancialEntries] = useState<EduFinancialEntry[]>([]);
  const [cases, setCases] = useState<StudentCase[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    if (!clinic?.id) return;
    setLoading(true);
    try {
      const cSnap = await secureGetDocs<Course>(query(collection(db, 'clinics', clinic.id, 'education_courses'), limit(100)), 'education_courses', { addAuditLog });
      setCourses(cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Course)));

      const mSnap = await secureGetDocs<CourseModule>(query(collection(db, 'clinics', clinic.id, 'education_modules'), limit(300)), 'education_modules', { addAuditLog });
      setModules(mSnap.docs.map(d => ({ id: d.id, lessons: [], ...d.data() } as CourseModule)));

      const pSnap = await secureGetDocs<ModelPatient>(query(collection(db, 'clinics', clinic.id, 'education_patients'), limit(200)), 'education_patients', { addAuditLog });
      setModelPatients(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ModelPatient)));

      const sSnap = await secureGetDocs<Student>(query(collection(db, 'clinics', clinic.id, 'education_students'), limit(200)), 'education_students', { addAuditLog });
      setStudents(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as Student)));

      const fSnap = await secureGetDocs<EduFinancialEntry>(query(collection(db, 'clinics', clinic.id, 'financial_entries'), where('isEducation', '==', true), limit(200)), 'financial_entries', { addAuditLog });
      setFinancialEntries(fSnap.docs.map(d => ({ id: d.id, ...d.data() } as EduFinancialEntry)));

      const caseSnap = await secureGetDocs<StudentCase>(query(collection(db, 'clinics', clinic.id, 'education_student_cases'), limit(200)), 'education_student_cases', { addAuditLog });
      setCases(caseSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudentCase)));
    } catch (err) {
      console.warn('Failed to load real Eliza Academy data:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); }, [clinic?.id]);

  // --- Dashboard ----------------------------------------------------------
  const todayStr = new Date().toISOString().split('T')[0];
  const kpis = useMemo(() => ({
    activeCourses: courses.filter(c => c.status === 'em_andamento').length,
    activeStudents: students.filter(s => s.status === 'ativo').length,
    modelPatients: modelPatients.length,
    upcomingModules: modules.filter(m => (m.date || '') >= todayStr).length,
  }), [courses, students, modelPatients, modules, todayStr]);

  // --- Cursos & Aulas -------------------------------------------------------

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const selectedCourse = courses.find(c => c.id === selectedCourseId) || null;
  const courseModules = useMemo(() => modules.filter(m => m.courseId === selectedCourseId).sort((a, b) => (a.date || '').localeCompare(b.date || '')), [modules, selectedCourseId]);

  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState({ name: '', type: COURSE_TYPES[0], professorName: '', startDate: '', endDate: '', durationHours: '', location: '', maxStudents: '', status: 'planejado', price: '', observations: '' });
  const [savingCourse, setSavingCourse] = useState(false);
  const [pendingDeleteCourseId, setPendingDeleteCourseId] = useState<string | null>(null);

  const openNewCourse = () => {
    setEditingCourseId(null);
    setCourseForm({ name: '', type: COURSE_TYPES[0], professorName: profile?.name || '', startDate: '', endDate: '', durationHours: '', location: '', maxStudents: '', status: 'planejado', price: '', observations: '' });
    setIsCourseModalOpen(true);
  };
  const openEditCourse = (c: Course) => {
    setEditingCourseId(c.id);
    setCourseForm({
      name: c.name, type: c.type, professorName: c.professorName || '', startDate: c.startDate || '', endDate: c.endDate || '',
      durationHours: c.durationHours ? String(c.durationHours) : '', location: c.location || '', maxStudents: c.maxStudents ? String(c.maxStudents) : '',
      status: c.status, price: c.price ? String(c.price) : '', observations: c.observations || '',
    });
    setIsCourseModalOpen(true);
  };

  const handleSaveCourse = async () => {
    if (!clinic?.id || !courseForm.name.trim()) return;
    setSavingCourse(true);
    try {
      const payload = {
        name: courseForm.name.trim(), type: courseForm.type, professorName: courseForm.professorName.trim() || null,
        startDate: courseForm.startDate || null, endDate: courseForm.endDate || null,
        durationHours: Number(courseForm.durationHours) || null, location: courseForm.location.trim() || null,
        maxStudents: Number(courseForm.maxStudents) || null, status: courseForm.status,
        price: Number(courseForm.price) || 0, observations: courseForm.observations.trim() || null,
        updatedAt: serverTimestamp(),
      };
      if (editingCourseId) {
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_courses', editingCourseId), payload);
        setCourses(prev => prev.map(c => c.id === editingCourseId ? { ...c, ...payload } as Course : c));
        addAuditLog({ collection: 'education_courses', action: 'WRITE', status: 'SUCCESS', details: `Curso "${payload.name}" atualizado (escrita real).` });
      } else {
        const ref = await addDoc(collection(db, 'clinics', clinic.id, 'education_courses'), { ...payload, createdAt: serverTimestamp() });
        setCourses(prev => [{ id: ref.id, ...payload } as Course, ...prev]);
        addAuditLog({ collection: 'education_courses', action: 'WRITE', status: 'SUCCESS', details: `Curso "${payload.name}" criado (escrita real).` });
      }
      showMessage('Curso salvo de verdade.');
      setIsCourseModalOpen(false);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingCourse(false);
    }
  };

  const handleDeleteCourse = async (c: Course) => {
    if (!clinic?.id || !isAdmin) return;
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'education_courses', c.id));
      setCourses(prev => prev.filter(x => x.id !== c.id));
      if (selectedCourseId === c.id) setSelectedCourseId(null);
      addAuditLog({ collection: 'education_courses', action: 'WRITE', status: 'SUCCESS', details: `Curso "${c.name}" excluído (escrita real).` });
      showMessage(`Curso "${c.name}" excluído.`);
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setPendingDeleteCourseId(null);
    }
  };

  // --- Módulos & Aulas -----------------------------------------------------

  const [isModuleModalOpen, setIsModuleModalOpen] = useState(false);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [moduleForm, setModuleForm] = useState({ name: '', date: '', startTime: '', endTime: '', mainTopic: '', program: '', objectives: '', summary: '', description: '', workload: '', status: 'Rascunho', visibleToStudents: false, lessons: [] as Lesson[] });
  const [savingModule, setSavingModule] = useState(false);
  const [pendingDeleteModuleId, setPendingDeleteModuleId] = useState<string | null>(null);

  const openNewModule = () => {
    setEditingModuleId(null);
    setModuleForm({ name: '', date: '', startTime: '', endTime: '', mainTopic: '', program: '', objectives: '', summary: '', description: '', workload: '', status: 'Rascunho', visibleToStudents: false, lessons: [] });
    setIsModuleModalOpen(true);
  };
  const openEditModule = (m: CourseModule) => {
    setEditingModuleId(m.id);
    setModuleForm({
      name: m.name, date: m.date || '', startTime: m.startTime || '', endTime: m.endTime || '', mainTopic: m.mainTopic || '',
      program: m.program || '', objectives: m.objectives || '', summary: m.summary || '', description: m.description || '',
      workload: m.workload || '', status: m.status, visibleToStudents: !!m.visibleToStudents, lessons: m.lessons || [],
    });
    setIsModuleModalOpen(true);
  };

  const handleSaveModule = async () => {
    if (!clinic?.id || !selectedCourseId || !moduleForm.name.trim()) return;
    setSavingModule(true);
    try {
      const payload = { ...moduleForm, courseId: selectedCourseId, updatedAt: serverTimestamp() };
      if (editingModuleId) {
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_modules', editingModuleId), payload);
        setModules(prev => prev.map(m => m.id === editingModuleId ? { ...m, ...payload } as CourseModule : m));
        addAuditLog({ collection: 'education_modules', action: 'WRITE', status: 'SUCCESS', details: `Módulo "${payload.name}" atualizado (escrita real).` });
      } else {
        const ref = await addDoc(collection(db, 'clinics', clinic.id, 'education_modules'), { ...payload, createdAt: serverTimestamp() });
        setModules(prev => [...prev, { id: ref.id, ...payload } as CourseModule]);
        addAuditLog({ collection: 'education_modules', action: 'WRITE', status: 'SUCCESS', details: `Módulo "${payload.name}" criado (escrita real).` });
      }
      showMessage('Módulo salvo de verdade.');
      setIsModuleModalOpen(false);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingModule(false);
    }
  };

  const handleDeleteModule = async (m: CourseModule) => {
    if (!clinic?.id || !isAdmin) return;
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'education_modules', m.id));
      setModules(prev => prev.filter(x => x.id !== m.id));
      addAuditLog({ collection: 'education_modules', action: 'WRITE', status: 'SUCCESS', details: `Módulo "${m.name}" excluído (escrita real).` });
      showMessage(`Módulo "${m.name}" excluído.`);
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setPendingDeleteModuleId(null);
    }
  };

  const addLesson = () => setModuleForm(v => ({ ...v, lessons: [...v.lessons, { id: newId('lesson'), title: '', description: '', duration: '' }] }));
  const updateLesson = (idx: number, patch: Partial<Lesson>) => setModuleForm(v => ({ ...v, lessons: v.lessons.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  const removeLesson = (idx: number) => setModuleForm(v => ({ ...v, lessons: v.lessons.filter((_, i) => i !== idx) }));
  const moveLesson = (idx: number, dir: -1 | 1) => setModuleForm(v => {
    const arr = [...v.lessons];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return v;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    return { ...v, lessons: arr };
  });

  // --- IA de conteúdo do módulo ---------------------------------------------
  const [aiModuleBrief, setAiModuleBrief] = useState('');
  const [aiModuleLoading, setAiModuleLoading] = useState(false);
  const [aiModuleError, setAiModuleError] = useState<string | null>(null);

  const handleGenerateModuleContent = async () => {
    if (!aiModuleBrief.trim() || !clinic?.id) return;
    setAiModuleLoading(true);
    setAiModuleError(null);
    try {
      const prompt = `Você é a Eliza, assistente pedagógica para cursos de odontologia/estética. Monte o conteúdo de um módulo de curso a partir deste briefing do professor: "${aiModuleBrief.trim()}".
${moduleForm.name ? `Nome do módulo já definido: "${moduleForm.name}".` : ''}
Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{"summary":"resumo curto do módulo","description":"descrição detalhada","objectives":"objetivos de aprendizagem","workload":"carga horária estimada, ex: 4h","program":"programa/ementa em tópicos","lessons":[{"title":"título da aula","description":"o que será ensinado","duration":"ex: 45min"}]}
Gere entre 2 e 6 aulas. Baseie-se apenas no briefing fornecido.`;
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'academy_module_content',
        clinicId: clinic.id,
      });
      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente reformular o briefing.');
      const parsed = JSON.parse(jsonMatch[0]);
      const lessons: Lesson[] = Array.isArray(parsed.lessons)
        ? parsed.lessons.map((l: any) => ({ id: newId('lesson'), title: String(l?.title || ''), description: String(l?.description || ''), duration: String(l?.duration || '') }))
        : [];
      setModuleForm(v => ({
        ...v,
        summary: String(parsed.summary || v.summary), description: String(parsed.description || v.description),
        objectives: String(parsed.objectives || v.objectives), workload: String(parsed.workload || v.workload),
        program: String(parsed.program || v.program), lessons: lessons.length > 0 ? lessons : v.lessons,
      }));
      addAuditLog({ collection: 'education_modules', action: 'WRITE', status: 'SUCCESS', details: `Conteúdo de módulo gerado por IA real (revise antes de salvar).` });
    } catch (err: any) {
      setAiModuleError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAiModuleLoading(false);
    }
  };

  // --- Eliza IA: construtor de curso completo -------------------------------
  interface DraftModule { name: string; mainTopic: string; summary: string; description: string; objectives: string; program: string; workload: string; lessons: Lesson[] }
  interface CourseDraft { courseName: string; courseType: string; durationHours: string; modules: DraftModule[] }

  const [isAiCourseBuilderOpen, setIsAiCourseBuilderOpen] = useState(false);
  const [aiCourseIdea, setAiCourseIdea] = useState('');
  const [aiCourseModuleCount, setAiCourseModuleCount] = useState('4');
  const [aiCourseAudience, setAiCourseAudience] = useState('');
  const [aiCourseLoading, setAiCourseLoading] = useState(false);
  const [aiCourseError, setAiCourseError] = useState<string | null>(null);
  const [aiCourseDraft, setAiCourseDraft] = useState<CourseDraft | null>(null);
  const [expandedDraftModule, setExpandedDraftModule] = useState<number | null>(0);
  const [creatingFullCourse, setCreatingFullCourse] = useState(false);

  const openAiCourseBuilder = () => {
    setAiCourseIdea(''); setAiCourseModuleCount('4'); setAiCourseAudience('');
    setAiCourseDraft(null); setAiCourseError(null); setExpandedDraftModule(0);
    setIsAiCourseBuilderOpen(true);
  };

  const handleGenerateFullCourse = async () => {
    if (!aiCourseIdea.trim() || !clinic?.id) return;
    setAiCourseLoading(true);
    setAiCourseError(null);
    try {
      const moduleCount = Math.min(Math.max(Number(aiCourseModuleCount) || 4, 1), 12);
      const prompt = `Você é a Eliza, assistente pedagógica para cursos de odontologia/estética. Um professor quer montar um curso completo com a sua ajuda.
Ideia/tema do curso: "${aiCourseIdea.trim()}"
${aiCourseAudience.trim() ? `Público-alvo: "${aiCourseAudience.trim()}"` : ''}
Quantidade de módulos desejada: ${moduleCount}

Proponha um curso completo, capricha nas ideias e deixe o conteúdo bem estruturado e atraente. Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{
  "courseName": "nome atrativo para o curso",
  "courseType": "um destes valores exatos: Presencial, Online, Mentoria, Residência, Imersão, Especialização, Workshop",
  "durationHours": "carga horária total estimada em número, ex: 40",
  "modules": [
    {
      "name": "nome do módulo",
      "mainTopic": "tema central do módulo",
      "summary": "resumo curto e atrativo",
      "description": "descrição detalhada do que será abordado",
      "objectives": "objetivos de aprendizagem, em tópicos",
      "program": "programa/ementa em tópicos",
      "workload": "carga horária estimada do módulo, ex: 6h",
      "lessons": [{"title":"título da aula","description":"o que será ensinado","duration":"ex: 45min"}]
    }
  ]
}
Gere exatamente ${moduleCount} módulos, cada um com 2 a 5 aulas, em ordem pedagógica lógica (do básico ao avançado). Seja específico e prático, nada genérico.`;
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'academy_course_builder',
        clinicId: clinic.id,
      });
      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente reformular a ideia.');
      const parsed = JSON.parse(jsonMatch[0]);
      const modulesRaw = Array.isArray(parsed.modules) ? parsed.modules : [];
      const draftModules: DraftModule[] = modulesRaw.map((m: any) => ({
        name: String(m?.name || ''), mainTopic: String(m?.mainTopic || ''), summary: String(m?.summary || ''),
        description: String(m?.description || ''), objectives: String(m?.objectives || ''), program: String(m?.program || ''),
        workload: String(m?.workload || ''),
        lessons: Array.isArray(m?.lessons) ? m.lessons.map((l: any) => ({ id: newId('lesson'), title: String(l?.title || ''), description: String(l?.description || ''), duration: String(l?.duration || '') })) : [],
      }));
      if (draftModules.length === 0) throw new Error('A Eliza não retornou módulos. Tente detalhar melhor a ideia do curso.');
      setAiCourseDraft({
        courseName: String(parsed.courseName || aiCourseIdea.trim()),
        courseType: COURSE_TYPES.includes(parsed.courseType) ? parsed.courseType : COURSE_TYPES[0],
        durationHours: String(parsed.durationHours || ''),
        modules: draftModules,
      });
      setExpandedDraftModule(0);
      addAuditLog({ collection: 'education_courses', action: 'WRITE', status: 'SUCCESS', details: `Curso completo esboçado por IA real (${draftModules.length} módulos, revise antes de criar).` });
    } catch (err: any) {
      setAiCourseError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAiCourseLoading(false);
    }
  };

  const updateDraftMeta = (patch: Partial<Pick<CourseDraft, 'courseName' | 'courseType' | 'durationHours'>>) =>
    setAiCourseDraft(v => v ? { ...v, ...patch } : v);
  const updateDraftModule = (idx: number, patch: Partial<DraftModule>) =>
    setAiCourseDraft(v => v ? { ...v, modules: v.modules.map((m, i) => i === idx ? { ...m, ...patch } : m) } : v);
  const removeDraftModule = (idx: number) =>
    setAiCourseDraft(v => v ? { ...v, modules: v.modules.filter((_, i) => i !== idx) } : v);
  const addDraftModule = () =>
    setAiCourseDraft(v => {
      if (!v) return v;
      const modules = [...v.modules, { name: 'Novo módulo', mainTopic: '', summary: '', description: '', objectives: '', program: '', workload: '', lessons: [] }];
      setExpandedDraftModule(modules.length - 1);
      return { ...v, modules };
    });
  const updateDraftLesson = (moduleIdx: number, lessonIdx: number, patch: Partial<Lesson>) =>
    setAiCourseDraft(v => v ? { ...v, modules: v.modules.map((m, i) => i === moduleIdx ? { ...m, lessons: m.lessons.map((l, j) => j === lessonIdx ? { ...l, ...patch } : l) } : m) } : v);
  const addDraftLesson = (moduleIdx: number) =>
    setAiCourseDraft(v => v ? { ...v, modules: v.modules.map((m, i) => i === moduleIdx ? { ...m, lessons: [...m.lessons, { id: newId('lesson'), title: '', description: '', duration: '' }] } : m) } : v);
  const removeDraftLesson = (moduleIdx: number, lessonIdx: number) =>
    setAiCourseDraft(v => v ? { ...v, modules: v.modules.map((m, i) => i === moduleIdx ? { ...m, lessons: m.lessons.filter((_, j) => j !== lessonIdx) } : m) } : v);

  const handleCreateFullCourse = async () => {
    if (!clinic?.id || !aiCourseDraft || !aiCourseDraft.courseName.trim() || aiCourseDraft.modules.length === 0) return;
    setCreatingFullCourse(true);
    try {
      const coursePayload = {
        name: aiCourseDraft.courseName.trim(), type: aiCourseDraft.courseType, professorName: profile?.name || null,
        startDate: null, endDate: null, durationHours: Number(aiCourseDraft.durationHours) || null, location: null,
        maxStudents: null, status: 'planejado', price: 0, observations: 'Criado com a Eliza IA a partir de uma ideia de curso.',
        updatedAt: serverTimestamp(),
      };
      const courseRef = await addDoc(collection(db, 'clinics', clinic.id, 'education_courses'), { ...coursePayload, createdAt: serverTimestamp() });
      setCourses(prev => [{ id: courseRef.id, ...coursePayload } as Course, ...prev]);
      addAuditLog({ collection: 'education_courses', action: 'WRITE', status: 'SUCCESS', details: `Curso "${coursePayload.name}" criado pela Eliza IA (escrita real).` });

      const newModules: CourseModule[] = [];
      for (const dm of aiCourseDraft.modules) {
        if (!dm.name.trim()) continue;
        const modulePayload = {
          name: dm.name.trim(), date: '', startTime: '', endTime: '', mainTopic: dm.mainTopic, program: dm.program,
          objectives: dm.objectives, summary: dm.summary, description: dm.description, workload: dm.workload,
          status: 'Rascunho', visibleToStudents: false, lessons: dm.lessons, courseId: courseRef.id, updatedAt: serverTimestamp(),
        };
        const moduleRef = await addDoc(collection(db, 'clinics', clinic.id, 'education_modules'), { ...modulePayload, createdAt: serverTimestamp() });
        newModules.push({ id: moduleRef.id, ...modulePayload } as CourseModule);
      }
      setModules(prev => [...prev, ...newModules]);
      addAuditLog({ collection: 'education_modules', action: 'WRITE', status: 'SUCCESS', details: `${newModules.length} módulos criados pela Eliza IA para o curso "${coursePayload.name}" (escrita real).` });

      showMessage(`Curso "${coursePayload.name}" criado com ${newModules.length} módulos de verdade!`);
      setSelectedCourseId(courseRef.id);
      setIsAiCourseBuilderOpen(false);
      setAiCourseDraft(null);
    } catch (err: any) {
      setAiCourseError(`Falha ao criar o curso: ${err?.message || err}`);
    } finally {
      setCreatingFullCourse(false);
    }
  };

  // --- Pacientes-Modelo ------------------------------------------------------

  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [patientForm, setPatientForm] = useState({ name: '', cpf: '', phone: '', birthDate: '', chiefComplaint: '', desiredProcedure: '', courseId: '', status: 'interessado', medicalHistory: '', medications: '', allergies: '', contraindications: '', imageConsentSigned: false, tcleSigned: false, patientClinicId: '' });
  const [savingPatient, setSavingPatient] = useState(false);
  const [pendingDeletePatientId, setPendingDeletePatientId] = useState<string | null>(null);

  const [importSearchTerm, setImportSearchTerm] = useState('');
  const [importResults, setImportResults] = useState<RealPatientOption[]>([]);
  const [searchingImport, setSearchingImport] = useState(false);

  const openNewPatient = () => {
    setEditingPatientId(null);
    setPatientForm({ name: '', cpf: '', phone: '', birthDate: '', chiefComplaint: '', desiredProcedure: '', courseId: '', status: 'interessado', medicalHistory: '', medications: '', allergies: '', contraindications: '', imageConsentSigned: false, tcleSigned: false, patientClinicId: '' });
    setImportSearchTerm('');
    setImportResults([]);
    setIsPatientModalOpen(true);
  };
  const openEditPatient = (p: ModelPatient) => {
    setEditingPatientId(p.id);
    setPatientForm({
      name: p.name, cpf: p.cpf || '', phone: p.phone || '', birthDate: p.birthDate || '', chiefComplaint: p.chiefComplaint || '',
      desiredProcedure: p.desiredProcedure || '', courseId: p.courseId || '', status: p.status, medicalHistory: p.medicalHistory || '',
      medications: p.medications || '', allergies: p.allergies || '', contraindications: p.contraindications || '',
      imageConsentSigned: !!p.imageConsentSigned, tcleSigned: !!p.tcleSigned, patientClinicId: p.patientClinicId || '',
    });
    setIsPatientModalOpen(true);
  };

  const handleSearchImport = async () => {
    if (!clinic?.id || !importSearchTerm.trim()) return;
    setSearchingImport(true);
    try {
      const snap = await secureGetDocs<RealPatientOption>(query(collection(db, 'clinics', clinic.id, 'patients'), limit(300)), 'patients', { addAuditLog });
      const term = importSearchTerm.trim().toLowerCase();
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() } as RealPatientOption)).filter(p => (p.name || '').toLowerCase().includes(term));
      setImportResults(results.slice(0, 8));
    } catch (err) {
      console.warn('Failed to search real patients for import:', err);
    } finally {
      setSearchingImport(false);
    }
  };

  const applyImportedPatient = (p: RealPatientOption) => {
    setPatientForm(v => ({ ...v, name: p.name, cpf: p.cpf || '', phone: p.phone || '', birthDate: p.birthDate || '', patientClinicId: p.id }));
    setImportResults([]);
    setImportSearchTerm('');
  };

  const handleSavePatient = async () => {
    if (!clinic?.id || !patientForm.name.trim()) return;
    setSavingPatient(true);
    try {
      const payload = { ...patientForm, name: patientForm.name.trim(), updatedAt: serverTimestamp() };
      if (editingPatientId) {
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_patients', editingPatientId), payload);
        setModelPatients(prev => prev.map(p => p.id === editingPatientId ? { ...p, ...payload } as ModelPatient : p));
        addAuditLog({ collection: 'education_patients', action: 'WRITE', status: 'SUCCESS', details: `Paciente-modelo "${payload.name}" atualizado (escrita real).` });
      } else {
        const ref = await addDoc(collection(db, 'clinics', clinic.id, 'education_patients'), { ...payload, createdAt: serverTimestamp() });
        setModelPatients(prev => [{ id: ref.id, ...payload } as ModelPatient, ...prev]);
        addAuditLog({ collection: 'education_patients', action: 'WRITE', status: 'SUCCESS', details: `Paciente-modelo "${payload.name}" criado (escrita real).` });
      }
      showMessage('Paciente-modelo salvo de verdade.');
      setIsPatientModalOpen(false);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingPatient(false);
    }
  };

  const handleDeletePatient = async (p: ModelPatient) => {
    if (!clinic?.id || !isAdmin) return;
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'education_patients', p.id));
      setModelPatients(prev => prev.filter(x => x.id !== p.id));
      addAuditLog({ collection: 'education_patients', action: 'WRITE', status: 'SUCCESS', details: `Paciente-modelo "${p.name}" excluído (escrita real).` });
      showMessage(`"${p.name}" excluído.`);
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setPendingDeletePatientId(null);
    }
  };

  // --- Alunos --------------------------------------------------------------

  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: '', email: '', password: generateTempPassword(), courseId: '', batchName: '', accessExpirationDate: '', ...DEFAULT_STUDENT_PERMS });
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [createStudentError, setCreateStudentError] = useState<string | null>(null);
  const [lastCreatedStudentCredentials, setLastCreatedStudentCredentials] = useState<{ name: string; email: string; password: string } | null>(null);
  const [pendingDeleteStudentId, setPendingDeleteStudentId] = useState<string | null>(null);
  const [updatingStudentId, setUpdatingStudentId] = useState<string | null>(null);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    if (!newStudent.name.trim() || !newStudent.email.trim() || !newStudent.password.trim()) {
      setCreateStudentError('Nome, e-mail e senha temporária são obrigatórios.');
      return;
    }
    if (newStudent.password.trim().length < 6) {
      setCreateStudentError('A senha temporária precisa ter no mínimo 6 caracteres.');
      return;
    }
    setCreatingStudent(true);
    setCreateStudentError(null);
    try {
      const { name, email, password, courseId, batchName, accessExpirationDate, ...perms } = newStudent;
      await InviteService.createEducationStudent(clinic.id, {
        email: email.trim(), name: name.trim(), password: password.trim(),
        courseId: courseId || undefined, batchName: batchName.trim() || undefined,
        accessExpirationDate: accessExpirationDate || null, permissions: perms,
      });
      addAuditLog({ collection: 'education_students', action: 'WRITE', status: 'SUCCESS', details: `Login real de aluno criado para "${name.trim()}" (escrita real).` });
      setLastCreatedStudentCredentials({ name: name.trim(), email: email.trim(), password: password.trim() });
      setNewStudent({ name: '', email: '', password: generateTempPassword(), courseId: '', batchName: '', accessExpirationDate: '', ...DEFAULT_STUDENT_PERMS });
      setIsAddStudentOpen(false);
      showMessage('Login de aluno criado de verdade. Compartilhe a senha temporária.');
      await fetchAll();
    } catch (err: any) {
      setCreateStudentError(err?.message || 'Falha ao criar o aluno.');
    } finally {
      setCreatingStudent(false);
    }
  };

  const handleDeleteStudent = async (s: Student) => {
    if (!clinic?.id || !isAdmin) return;
    setUpdatingStudentId(s.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'education_students', s.id));
      setStudents(prev => prev.filter(x => x.id !== s.id));
      addAuditLog({ collection: 'education_students', action: 'WRITE', status: 'SUCCESS', details: `Vínculo de aluno "${s.name}" removido (escrita real).` });
      showMessage(`"${s.name}" removido (o login continua existindo, só perde acesso ao curso).`);
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setUpdatingStudentId(null);
      setPendingDeleteStudentId(null);
    }
  };

  // --- Financeiro ------------------------------------------------------------

  const [isFinFormOpen, setIsFinFormOpen] = useState(false);
  const [finForm, setFinForm] = useState({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX', courseId: '' });
  const [savingFin, setSavingFin] = useState(false);

  const handleAddFinEntry = async () => {
    if (!clinic?.id || !finForm.description.trim() || !finForm.amount) return;
    setSavingFin(true);
    try {
      const id = `edu-fin-${Date.now()}`;
      const payload = {
        description: `[ELIZA Education] ${finForm.description.trim()}`,
        type: 'income', category: 'Educação', amount: Number(finForm.amount) || 0,
        status: finForm.status, paymentMethod: finForm.paymentMethod,
        courseId: finForm.courseId || null, isEducation: true, source: 'eliza_education',
        date: new Date().toISOString(), createdAt: serverTimestamp(), createdBy: user?.uid || 'eliza_academy',
      };
      await setDoc(fsDoc(db, 'clinics', clinic.id, 'financial_entries', id), payload);
      setFinancialEntries(prev => [{ id, ...payload } as EduFinancialEntry, ...prev]);
      addAuditLog({ collection: 'financial_entries', action: 'WRITE', status: 'SUCCESS', details: `Lançamento financeiro do Academy (${formatCurrency(Number(finForm.amount))}) criado (escrita real).` });
      setFinForm({ description: '', amount: '', status: 'pending', paymentMethod: 'PIX', courseId: '' });
      setIsFinFormOpen(false);
      showMessage('Lançamento salvo de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingFin(false);
    }
  };

  const finTotals = useMemo(() => {
    const received = financialEntries.filter(f => f.status === 'paid').reduce((a, f) => a + (f.amount || 0), 0);
    const pending = financialEntries.filter(f => f.status !== 'paid').reduce((a, f) => a + (f.amount || 0), 0);
    return { received, pending };
  }, [financialEntries]);

  // --- Casos de Alunos (revisão do professor) -------------------------------

  const pendingCases = useMemo(() => cases.filter(c => c.status === 'pending'), [cases]);
  const reviewedCases = useMemo(() => cases.filter(c => c.status !== 'pending'), [cases]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const selectedCase = cases.find(c => c.id === selectedCaseId) || null;
  const [caseFeedback, setCaseFeedback] = useState('');
  const [savingCaseReview, setSavingCaseReview] = useState(false);
  const [canvasCase, setCanvasCase] = useState<StudentCase | null>(null);
  const [canvasAngle, setCanvasAngle] = useState<string | null>(null);

  const openCaseDetail = (c: StudentCase) => {
    setSelectedCaseId(c.id);
    setCaseFeedback(c.professorFeedback || '');
  };

  const handleReviewCase = async (status: StudentCase['status']) => {
    if (!clinic?.id || !selectedCase) return;
    setSavingCaseReview(true);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_student_cases', selectedCase.id), {
        status, professorFeedback: caseFeedback.trim() || null, updatedAt: serverTimestamp(),
      });
      setCases(prev => prev.map(c => c.id === selectedCase.id ? { ...c, status, professorFeedback: caseFeedback.trim() } : c));
      addAuditLog({ collection: 'education_student_cases', action: 'WRITE', status: 'SUCCESS', details: `Caso de "${selectedCase.studentName}" marcado como ${CASE_STATUS_META[status].label.toLowerCase()} (escrita real).` });
      showMessage('Revisão salva de verdade.');
      if (status === 'approved') {
        const firstAngle = Object.keys(selectedCase.images)[0];
        if (firstAngle) { setCanvasCase({ ...selectedCase, status }); setCanvasAngle(firstAngle); }
      }
      setSelectedCaseId(null);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingCaseReview(false);
    }
  };

  const handleSaveProfessorDrawing = async (drawingsJson: string) => {
    if (!clinic?.id || !canvasCase || !canvasAngle) return;
    try {
      const professorDrawings = { ...(canvasCase.professorDrawings || {}), [canvasAngle]: drawingsJson };
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_student_cases', canvasCase.id), { professorDrawings, updatedAt: serverTimestamp() });
      setCases(prev => prev.map(c => c.id === canvasCase.id ? { ...c, professorDrawings } : c));
      addAuditLog({ collection: 'education_student_cases', action: 'WRITE', status: 'SUCCESS', details: 'Gabarito do professor salvo no caso do aluno (escrita real).' });
      showMessage('Gabarito salvo de verdade.');
      setCanvasCase(null);
      setCanvasAngle(null);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    }
  };

  // --- Documentos: Contratos/Termos + Certificados ---------------------------

  const [docStudentId, setDocStudentId] = useState('');
  const [docTemplateId, setDocTemplateId] = useState(DOC_TEMPLATES[0].id);
  const [docPatientName, setDocPatientName] = useState('');
  const [compiledDoc, setCompiledDoc] = useState('');

  useEffect(() => {
    const tpl = DOC_TEMPLATES.find(t => t.id === docTemplateId);
    const student = students.find(s => s.id === docStudentId);
    const course = courses.find(c => c.id === student?.courseId);
    if (!tpl) return;
    setCompiledDoc(compileDocTemplate(tpl.content, {
      nomeAluno: student?.name || '', nomeClinica: (clinic as any)?.name || 'Clínica',
      nomeCurso: course?.name || '', turma: student?.batchName || '',
      nomePaciente: docPatientName, dataAtual: new Date().toLocaleDateString('pt-BR'),
    }));
  }, [docTemplateId, docStudentId, docPatientName, students, courses, clinic]);

  const handlePrintDoc = () => {
    const tpl = DOC_TEMPLATES.find(t => t.id === docTemplateId);
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) return;
    const html = `<!doctype html><html><head><title>${tpl?.name || 'Documento'}</title>
      <style>body{font-family:Georgia,'Times New Roman',serif;padding:40px;color:#111827;line-height:1.6;}h1{font-size:16px;text-align:center;margin-bottom:24px;}pre{white-space:pre-wrap;font-family:inherit;font-size:12.5px;}</style>
      </head><body><h1>${tpl?.name || ''}</h1><pre>${compiledDoc.replace(/</g, '&lt;')}</pre></body></html>`;
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => win.print(), 250);
  };

  const [certStudentId, setCertStudentId] = useState('');
  const [issuingCert, setIssuingCert] = useState(false);
  const certStudent = students.find(s => s.id === certStudentId) || null;
  const certCourse = courses.find(c => c.id === certStudent?.courseId) || null;
  const certEligible = !!certCourse && certCourse.status === 'finalizado' && !!certStudent && ['concluído', 'ativo'].includes((certStudent.status || '').toLowerCase()) && certStudent.permDownloadCertificate !== false;

  const handleIssueCertificate = async () => {
    if (!clinic?.id || !certStudent || !certEligible) return;
    setIssuingCert(true);
    try {
      const code = `EZ-${certStudent.id.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_students', certStudent.id), {
        certificateIssued: true, certificateCode: code, certificateIssuedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      setStudents(prev => prev.map(s => s.id === certStudent.id ? { ...s, certificateIssued: true, certificateCode: code, certificateIssuedAt: new Date().toISOString() } : s));
      addAuditLog({ collection: 'education_students', action: 'WRITE', status: 'SUCCESS', details: `Certificado emitido para "${certStudent.name}" (escrita real, código ${code}).` });
      showMessage('Certificado emitido de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setIssuingCert(false);
    }
  };

  const handlePrintCertificate = () => {
    if (!certStudent) return;
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) return;
    const html = `<!doctype html><html><head><title>Certificado</title>
      <style>body{font-family:Georgia,'Times New Roman',serif;padding:60px;text-align:center;color:#111827;}h1{font-size:22px;margin-bottom:8px;}p{font-size:13px;margin:6px 0;}.code{margin-top:30px;font-size:10px;color:#6b7280;font-family:monospace;}</style>
      </head><body>
      <h1>Certificado de Conclusão</h1>
      <p>Certificamos que <strong>${certStudent.name}</strong> concluiu o curso</p>
      <p><strong>${certCourse?.name || ''}</strong></p>
      <p>promovido por ${(clinic as any)?.name || 'Clínica'}.</p>
      <div class="code">Código de verificação: ${certStudent.certificateCode || ''}</div>
      </body></html>`;
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => win.print(), 250);
  };

  if (!clinic?.academyEnabled) {
    return (
      <div className="max-w-3xl mx-auto pb-16">
        <div className="next-glass-panel rounded-next-2xl p-10 text-center">
          <GraduationCap className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">Eliza Academy não está habilitado</p>
          <p className="text-xs text-slate-500 mt-1">Peça a um administrador para habilitar em Painel Admin → Clínica.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16 space-y-6 font-sans">
      <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
        <div className="relative z-10">
          <h1 className="text-2xl font-extrabold tracking-tight next-brand-gradient-text flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-next-purple-neon" />
            Eliza Academy
          </h1>
          <p className="text-slate-400 text-xs mt-1">Cursos, aulas, pacientes-modelo, alunos e financeiro de quem também ensina — tudo aqui grava de verdade no Firestore.</p>
        </div>
      </div>

      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 text-xs text-next-green-success font-semibold">
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-1 bg-slate-900/60 border border-next-border rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${activeTab === t.id ? 'next-brand-gradient-bg text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="next-glass-panel rounded-next-2xl p-10 flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-next-purple-neon" />
          <span className="text-xs font-mono text-slate-500">Carregando dados reais do Academy...</span>
        </div>
      ) : (
        <>
          {/* DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Cursos Ativos', value: kpis.activeCourses, icon: BookOpen },
                { label: 'Alunos Ativos', value: kpis.activeStudents, icon: GraduationCap },
                { label: 'Pacientes-Modelo', value: kpis.modelPatients, icon: Users },
                { label: 'Módulos Programados', value: kpis.upcomingModules, icon: CalendarDays },
              ].map(k => {
                const Icon = k.icon;
                return (
                  <div key={k.label} className="next-glass-panel rounded-next-2xl p-5">
                    <Icon className="w-5 h-5 text-next-purple-neon mb-2" />
                    <p className="text-2xl font-black text-slate-100">{k.value}</p>
                    <p className="text-[10.5px] text-slate-500 mt-0.5">{k.label}</p>
                  </div>
                );
              })}
              <div className="sm:col-span-2 lg:col-span-4 next-glass-panel rounded-next-2xl p-5">
                <h3 className="text-xs font-bold text-slate-200 mb-3">Cursos recentes</h3>
                {courses.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum curso cadastrado ainda — comece na aba "Cursos & Aulas".</p>
                ) : (
                  <div className="space-y-1.5">
                    {courses.slice(0, 5).map(c => {
                      const meta = COURSE_STATUS_META[c.status] || COURSE_STATUS_META.planejado;
                      return (
                        <div key={c.id} className="flex items-center justify-between bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                          <span className="text-xs font-semibold text-slate-200">{c.name}</span>
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${meta.classes}`}>{meta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CURSOS & AULAS */}
          {activeTab === 'cursos' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 next-glass-panel rounded-next-2xl p-4 space-y-2" style={{ maxHeight: '640px', overflowY: 'auto' }}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <h3 className="text-xs font-bold text-slate-200 flex-shrink-0">Cursos ({courses.length})</h3>
                  <div className="flex items-center gap-1.5">
                    <button onClick={openAiCourseBuilder} className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-gradient-to-r from-next-purple-neon to-fuchsia-500 px-2 py-1 rounded-lg shadow-next-glow-purple"><Sparkles className="w-3 h-3" /> Eliza IA</button>
                    <button onClick={openNewCourse} className="inline-flex items-center gap-1 text-[10px] font-bold text-white next-brand-gradient-bg px-2 py-1 rounded-lg"><Plus className="w-3 h-3" /> Novo</button>
                  </div>
                </div>
                {courses.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">Nenhum curso cadastrado.</p>
                ) : courses.map(c => {
                  const meta = COURSE_STATUS_META[c.status] || COURSE_STATUS_META.planejado;
                  return (
                    <button key={c.id} onClick={() => setSelectedCourseId(c.id)} className={`w-full text-left p-3 rounded-xl border transition-colors ${selectedCourseId === c.id ? 'bg-next-purple-neon/15 border-next-purple-neon/40' : 'bg-slate-900/40 border-next-border hover:border-next-border-glow'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-200 truncate">{c.name}</p>
                        <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded-md border flex-shrink-0 ${meta.classes}`}>{meta.label}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">{c.type} · {formatCurrency(c.price || 0)}</p>
                    </button>
                  );
                })}
              </div>

              <div className="lg:col-span-8 space-y-4">
                {!selectedCourse ? (
                  <div className="next-glass-panel rounded-next-2xl p-10 text-center">
                    <BookOpen className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-300">Selecione um curso</p>
                    <p className="text-xs text-slate-500 mt-1">Ou cadastre um novo curso na lista ao lado.</p>
                  </div>
                ) : (
                  <>
                    <div className="next-glass-panel rounded-next-2xl p-5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-100 truncate">{selectedCourse.name}</h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">{selectedCourse.professorName || 'Sem professor definido'} · {formatDate(selectedCourse.startDate)} — {formatDate(selectedCourse.endDate)} · {selectedCourse.durationHours || 0}h</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => openEditCourse(selectedCourse)} className="px-3 py-1.5 bg-slate-800 border border-next-border text-slate-300 text-[10.5px] font-bold rounded-lg">Editar</button>
                        {isAdmin && (pendingDeleteCourseId === selectedCourse.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleDeleteCourse(selectedCourse)} className="text-[9px] font-bold text-white bg-next-red-alert px-2 py-1.5 rounded">Confirmar</button>
                            <button onClick={() => setPendingDeleteCourseId(null)} className="text-slate-500"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <button onClick={() => setPendingDeleteCourseId(selectedCourse.id)} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert"><Trash2 className="w-3.5 h-3.5" /></button>
                        ))}
                      </div>
                    </div>

                    <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ListChecks className="w-4 h-4 text-next-purple-neon" /> Módulos ({courseModules.length})</h3>
                        <button onClick={openNewModule} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple"><Plus className="w-3.5 h-3.5" /> Novo módulo</button>
                      </div>
                      {courseModules.length === 0 ? (
                        <p className="text-xs text-slate-500">Nenhum módulo cadastrado ainda para este curso.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {courseModules.map(m => (
                            <div key={m.id} className="bg-slate-900/40 border border-next-border rounded-lg p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-200 truncate">{m.name}</p>
                                  <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(m.date)} {m.startTime ? `${m.startTime}-${m.endTime}` : ''} · {(m.lessons || []).length} aula(s)</p>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className="text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded-md border bg-slate-800 border-next-border text-slate-400">{m.status}</span>
                                  <button onClick={() => openEditModule(m)} className="px-2 py-1 bg-slate-800 border border-next-border text-slate-300 text-[9.5px] font-bold rounded-lg">Editar</button>
                                  {isAdmin && (pendingDeleteModuleId === m.id ? (
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => handleDeleteModule(m)} className="text-[9px] font-bold text-white bg-next-red-alert px-1.5 py-1 rounded">OK</button>
                                      <button onClick={() => setPendingDeleteModuleId(null)} className="text-slate-500"><X className="w-3 h-3" /></button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setPendingDeleteModuleId(m.id)} className="p-1 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert"><Trash2 className="w-3 h-3" /></button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* PACIENTES-MODELO */}
          {activeTab === 'pacientes' && (
            <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Users className="w-4 h-4 text-next-purple-neon" /> Pacientes-Modelo ({modelPatients.length})</h3>
                <button onClick={openNewPatient} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple"><Plus className="w-3.5 h-3.5" /> Novo</button>
              </div>
              {modelPatients.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">Nenhum paciente-modelo cadastrado ainda.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {modelPatients.map(p => {
                    const meta = PATIENT_STATUS_META[p.status] || PATIENT_STATUS_META.interessado;
                    return (
                      <div key={p.id} className="bg-slate-900/40 border border-next-border rounded-xl p-3 cursor-pointer hover:border-next-border-glow" onClick={() => openEditPatient(p)}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-200 truncate">{p.name}</p>
                          <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded-md border flex-shrink-0 ${meta.classes}`}>{meta.label}</span>
                        </div>
                        <p className="text-[10.5px] text-slate-500 mt-1 truncate">{p.desiredProcedure || p.chiefComplaint || 'Sem procedimento definido'}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {p.imageConsentSigned && <span className="text-[9px] text-next-green-success">✓ Consentimento imagem</span>}
                          {p.tcleSigned && <span className="text-[9px] text-next-green-success">✓ TCLE</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ALUNOS */}
          {activeTab === 'alunos' && (
            <div className="space-y-4">
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><GraduationCap className="w-4 h-4 text-next-purple-neon" /> Alunos ({students.length})</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={fetchAll} className="p-2 bg-slate-900/70 border border-next-border rounded-lg text-slate-400 hover:text-slate-200"><RefreshCw className="w-3.5 h-3.5" /></button>
                    <button onClick={() => { setCreateStudentError(null); setIsAddStudentOpen(true); }} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple"><UserPlus className="w-3.5 h-3.5" /> Adicionar aluno</button>
                  </div>
                </div>
                {students.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">Nenhum aluno cadastrado ainda.</p>
                ) : (
                  <div className="space-y-1.5">
                    {students.map(s => (
                      <div key={s.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-next-border rounded-lg p-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-200 truncate">{s.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono truncate">{s.email} {s.batchName ? `· ${s.batchName}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border bg-slate-800 border-next-border text-slate-400">{s.status}</span>
                          {pendingDeleteStudentId === s.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDeleteStudent(s)} disabled={updatingStudentId === s.id} className="text-[9px] font-bold text-white bg-next-red-alert px-1.5 py-1 rounded whitespace-nowrap">Confirmar</button>
                              <button onClick={() => setPendingDeleteStudentId(null)} className="text-slate-500"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <button onClick={() => setPendingDeleteStudentId(s.id)} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {lastCreatedStudentCredentials && (
                <div className="next-glass-panel rounded-next-2xl p-4 border-next-purple-neon/30 space-y-1.5">
                  <p className="text-xs font-bold text-next-purple-light flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Credenciais de "{lastCreatedStudentCredentials.name}" (conta real criada)</p>
                  <p className="text-[11px] text-slate-300 font-mono">E-mail: {lastCreatedStudentCredentials.email}</p>
                  <p className="text-[11px] text-slate-300 font-mono">Senha temporária: {lastCreatedStudentCredentials.password}</p>
                </div>
              )}
            </div>
          )}

          {/* FINANCEIRO */}
          {activeTab === 'financeiro' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="next-glass-panel rounded-next-2xl p-5">
                  <p className="text-[10px] font-mono text-slate-500 uppercase">Recebido</p>
                  <p className="text-xl font-black text-next-green-success mt-1">{formatCurrency(finTotals.received)}</p>
                </div>
                <div className="next-glass-panel rounded-next-2xl p-5">
                  <p className="text-[10px] font-mono text-slate-500 uppercase">Pendente</p>
                  <p className="text-xl font-black text-next-orange-insight mt-1">{formatCurrency(finTotals.pending)}</p>
                </div>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Wallet className="w-4 h-4 text-next-purple-neon" /> Lançamentos do Academy</h3>
                  <button onClick={() => setIsFinFormOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple"><Plus className="w-3.5 h-3.5" /> Novo lançamento</button>
                </div>
                {financialEntries.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum lançamento do Academy ainda.</p>
                ) : (
                  <div className="space-y-1.5">
                    {financialEntries.map(f => (
                      <div key={f.id} className="flex items-center justify-between bg-slate-900/40 border border-next-border rounded-lg p-2.5">
                        <div>
                          <p className="text-xs font-semibold text-slate-200">{f.description}</p>
                          <p className="text-[10px] text-slate-500">{formatDate(f.date)} · {f.paymentMethod}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-next-purple-light">{formatCurrency(f.amount)}</p>
                          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${f.status === 'paid' ? 'text-next-green-success bg-next-green-success/10' : 'text-next-orange-insight bg-next-orange-insight/10'}`}>{f.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <AnimatePresence>
                {isFinFormOpen && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="next-glass-panel rounded-next-2xl p-5 space-y-3 overflow-hidden">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Descrição</label>
                      <input value={finForm.description} onChange={(e) => setFinForm(v => ({ ...v, description: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Valor (R$)</label>
                        <input type="number" value={finForm.amount} onChange={(e) => setFinForm(v => ({ ...v, amount: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                        <select value={finForm.status} onChange={(e) => setFinForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                          <option value="pending">Pendente</option>
                          <option value="paid">Pago</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Método</label>
                        <select value={finForm.paymentMethod} onChange={(e) => setFinForm(v => ({ ...v, paymentMethod: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                          <option value="PIX">PIX</option>
                          <option value="Cartão">Cartão</option>
                          <option value="Dinheiro">Dinheiro</option>
                          <option value="Boleto">Boleto</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Curso vinculado (opcional)</label>
                      <select value={finForm.courseId} onChange={(e) => setFinForm(v => ({ ...v, courseId: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                        <option value="">— Nenhum —</option>
                        {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <button onClick={handleAddFinEntry} disabled={savingFin} className="inline-flex items-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                      {savingFin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>{savingFin ? 'Gravando...' : 'Salvar lançamento real'}</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* CASOS DE ALUNOS */}
          {activeTab === 'casos' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 space-y-4">
                <div className="next-glass-panel rounded-next-2xl p-4 space-y-2">
                  <h3 className="text-xs font-bold text-slate-200 mb-1">Pendentes ({pendingCases.length})</h3>
                  {pendingCases.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">Nenhum caso aguardando revisão.</p>
                  ) : pendingCases.map(c => (
                    <button key={c.id} onClick={() => openCaseDetail(c)} className={`w-full text-left p-3 rounded-xl border transition-colors ${selectedCaseId === c.id ? 'bg-next-purple-neon/15 border-next-purple-neon/40' : 'bg-slate-900/40 border-next-border hover:border-next-border-glow'}`}>
                      <p className="text-xs font-bold text-slate-200 truncate">{c.studentName}</p>
                      <p className="text-[10px] text-slate-500 truncate">{c.chiefComplaint || c.patientCode || 'Caso clínico'}</p>
                    </button>
                  ))}
                </div>
                <div className="next-glass-panel rounded-next-2xl p-4 space-y-2">
                  <h3 className="text-xs font-bold text-slate-200 mb-1">Já revisados ({reviewedCases.length})</h3>
                  {reviewedCases.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">Nenhum caso revisado ainda.</p>
                  ) : reviewedCases.map(c => {
                    const meta = CASE_STATUS_META[c.status];
                    return (
                      <button key={c.id} onClick={() => openCaseDetail(c)} className={`w-full text-left p-3 rounded-xl border transition-colors ${selectedCaseId === c.id ? 'bg-next-purple-neon/15 border-next-purple-neon/40' : 'bg-slate-900/40 border-next-border hover:border-next-border-glow'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-200 truncate">{c.studentName}</p>
                          <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded-md border flex-shrink-0 ${meta.classes}`}>{meta.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-7">
                {!selectedCase ? (
                  <div className="next-glass-panel rounded-next-2xl p-10 text-center">
                    <ListChecks className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-300">Selecione um caso</p>
                  </div>
                ) : (
                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-100">{selectedCase.studentName}</h3>
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${CASE_STATUS_META[selectedCase.status].classes}`}>{CASE_STATUS_META[selectedCase.status].label}</span>
                    </div>
                    <p className="text-xs text-slate-400">{selectedCase.chiefComplaint}</p>
                    {selectedCase.clinicalNotes && <p className="text-[11px] text-slate-500 italic">{selectedCase.clinicalNotes}</p>}
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(selectedCase.images || {}).map(([angle, url]) => (
                        <img key={angle} src={url} alt={angle} className="w-full aspect-square object-cover rounded-lg border border-next-border" />
                      ))}
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Feedback ao aluno</label>
                      <textarea value={caseFeedback} onChange={(e) => setCaseFeedback(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleReviewCase('approved')} disabled={savingCaseReview} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-next-green-success/15 border border-next-green-success/30 text-next-green-success font-bold text-[10.5px] rounded-lg disabled:opacity-50"><ThumbsUp className="w-3.5 h-3.5" /> Aprovar</button>
                      <button onClick={() => handleReviewCase('adjust')} disabled={savingCaseReview} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-next-orange-insight/15 border border-next-orange-insight/30 text-next-orange-insight font-bold text-[10.5px] rounded-lg disabled:opacity-50">Ajustes</button>
                      <button onClick={() => handleReviewCase('rejected')} disabled={savingCaseReview} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-next-red-alert/15 border border-next-red-alert/30 text-next-red-alert font-bold text-[10.5px] rounded-lg disabled:opacity-50"><ThumbsDown className="w-3.5 h-3.5" /> Rejeitar</button>
                    </div>
                    {selectedCase.status === 'approved' && Object.keys(selectedCase.images || {}).length > 0 && (
                      <button onClick={() => { setCanvasCase(selectedCase); setCanvasAngle(Object.keys(selectedCase.images)[0]); }} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg shadow-next-glow-purple"><PenTool className="w-3.5 h-3.5" /> Desenhar gabarito</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DOCUMENTOS */}
          {activeTab === 'documentos' && (
            <div className="space-y-4">
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><FileText className="w-4 h-4 text-next-purple-neon" /> Contratos e Termos</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Modelo</label>
                    <select value={docTemplateId} onChange={(e) => setDocTemplateId(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                      {DOC_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Aluno (opcional)</label>
                    <select value={docStudentId} onChange={(e) => setDocStudentId(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                      <option value="">— Nenhum —</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Nome do paciente-modelo (se aplicável)</label>
                    <input value={docPatientName} onChange={(e) => setDocPatientName(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                  </div>
                </div>
                <textarea value={compiledDoc} onChange={(e) => setCompiledDoc(e.target.value)} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11.5px] text-slate-200 px-3 py-2.5 h-56 font-mono leading-relaxed" />
                <button onClick={handlePrintDoc} className="inline-flex items-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple"><Printer className="w-3.5 h-3.5" /> Imprimir</button>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Award className="w-4 h-4 text-next-purple-neon" /> Certificados</h3>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Aluno</label>
                  <select value={certStudentId} onChange={(e) => setCertStudentId(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    <option value="">— Selecione —</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {certStudent && (
                  <div className="bg-slate-900/40 border border-next-border rounded-lg p-3 text-[11px] text-slate-400 space-y-1">
                    <p>Curso: {certCourse?.name || '—'} ({certCourse?.status || 'sem curso vinculado'})</p>
                    <p>Status da matrícula: {certStudent.status}</p>
                    <p>Permissão de certificado: {certStudent.permDownloadCertificate === false ? 'Não' : 'Sim'}</p>
                    {!certEligible && !certStudent.certificateIssued && <p className="text-amber-400">Requisitos ainda não atendidos (curso precisa estar finalizado, matrícula concluída/ativa e permissão marcada).</p>}
                  </div>
                )}
                {certStudent?.certificateIssued ? (
                  <div className="flex items-center justify-between gap-3 bg-next-green-success/10 border border-next-green-success/20 rounded-lg p-3">
                    <div>
                      <p className="text-xs font-bold text-next-green-success">Certificado já emitido</p>
                      <p className="text-[10.5px] text-slate-400 font-mono">{certStudent.certificateCode}</p>
                    </div>
                    <button onClick={handlePrintCertificate} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 border border-next-border text-slate-200 font-bold text-[10.5px] rounded-lg"><Printer className="w-3.5 h-3.5" /> Imprimir</button>
                  </div>
                ) : (
                  <button onClick={handleIssueCertificate} disabled={!certEligible || issuingCert} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple-strong disabled:opacity-50">
                    {issuingCert ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
                    <span>{issuingCert ? 'Emitindo...' : 'Emitir certificado real'}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ELIZA IA COURSE BUILDER MODAL */}
      <AnimatePresence>
        {isAiCourseBuilderOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !aiCourseLoading && !creatingFullCourse && setIsAiCourseBuilderOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Sparkles className="w-4 h-4 text-next-purple-neon" /> Eliza IA — Criar curso completo</h3>
                <button onClick={() => setIsAiCourseBuilderOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>

              {!aiCourseDraft ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-400">Conte a ideia do curso, quantos módulos você quer e para quem é — a Eliza monta a proposta completa (módulos, aulas, objetivos, programa) pra você revisar e criar de uma vez.</p>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Ideia / tema do curso *</label>
                    <textarea autoFocus value={aiCourseIdea} onChange={(e) => setAiCourseIdea(e.target.value)} placeholder="Ex: curso completo de harmonização facial para dentistas iniciantes, do básico às técnicas avançadas" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-20 resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Quantos módulos</label>
                      <input type="number" min={1} max={12} value={aiCourseModuleCount} onChange={(e) => setAiCourseModuleCount(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Público-alvo (opcional)</label>
                      <input value={aiCourseAudience} onChange={(e) => setAiCourseAudience(e.target.value)} placeholder="Ex: dentistas com CRO ativo" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                    </div>
                  </div>
                  {aiCourseError && <p className="text-[11px] text-next-red-alert">{aiCourseError}</p>}
                  <button onClick={handleGenerateFullCourse} disabled={aiCourseLoading || !aiCourseIdea.trim()} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple-strong disabled:opacity-50">
                    {aiCourseLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    <span>{aiCourseLoading ? 'A Eliza está montando o curso...' : 'Gerar curso com Eliza IA'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-950 border border-next-purple-neon/30 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono text-next-purple-neon uppercase flex items-center gap-1"><Sparkles className="w-3 h-3" /> Proposta da Eliza — revise tudo antes de criar</p>
                      <button onClick={() => setAiCourseDraft(null)} className="text-[10px] text-slate-400 hover:text-slate-200 underline">Recomeçar</button>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Nome do curso</label>
                      <input value={aiCourseDraft.courseName} onChange={(e) => updateDraftMeta({ courseName: e.target.value })} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Tipo</label>
                        <select value={aiCourseDraft.courseType} onChange={(e) => updateDraftMeta({ courseType: e.target.value })} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                          {COURSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Carga horária total (h)</label>
                        <input type="number" value={aiCourseDraft.durationHours} onChange={(e) => updateDraftMeta({ durationHours: e.target.value })} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono text-slate-500 uppercase">Módulos ({aiCourseDraft.modules.length})</p>
                      <button onClick={addDraftModule} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-300 border border-next-border px-2 py-1 rounded-lg hover:border-next-border-glow"><Plus className="w-3 h-3" /> Módulo</button>
                    </div>
                    {aiCourseDraft.modules.map((dm, idx) => {
                      const isExpanded = expandedDraftModule === idx;
                      return (
                        <div key={idx} className="bg-slate-900/40 border border-next-border rounded-xl overflow-hidden">
                          <button onClick={() => setExpandedDraftModule(isExpanded ? null : idx)} className="w-full flex items-center justify-between gap-2 p-3 text-left">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-200 truncate">{idx + 1}. {dm.name || 'Sem nome'}</p>
                              <p className="text-[10.5px] text-slate-500 truncate">{dm.mainTopic || 'Sem tema definido'} · {dm.lessons.length} aula(s)</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span onClick={(e) => { e.stopPropagation(); removeDraftModule(idx); }} className="text-slate-500 hover:text-next-red-alert p-1"><Trash2 className="w-3.5 h-3.5" /></span>
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="p-3 pt-0 space-y-2 border-t border-next-border">
                              <div className="grid grid-cols-2 gap-2 pt-2">
                                <div>
                                  <label className="text-[9.5px] font-mono text-slate-500 uppercase">Nome do módulo</label>
                                  <input value={dm.name} onChange={(e) => updateDraftModule(idx, { name: e.target.value })} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 mt-1" />
                                </div>
                                <div>
                                  <label className="text-[9.5px] font-mono text-slate-500 uppercase">Tema central</label>
                                  <input value={dm.mainTopic} onChange={(e) => updateDraftModule(idx, { mainTopic: e.target.value })} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 mt-1" />
                                </div>
                              </div>
                              <div>
                                <label className="text-[9.5px] font-mono text-slate-500 uppercase">Resumo</label>
                                <textarea value={dm.summary} onChange={(e) => updateDraftModule(idx, { summary: e.target.value })} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 mt-1 h-12 resize-none" />
                              </div>
                              <div>
                                <label className="text-[9.5px] font-mono text-slate-500 uppercase">Objetivos</label>
                                <textarea value={dm.objectives} onChange={(e) => updateDraftModule(idx, { objectives: e.target.value })} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 mt-1 h-12 resize-none" />
                              </div>
                              <div>
                                <label className="text-[9.5px] font-mono text-slate-500 uppercase">Programa / ementa</label>
                                <textarea value={dm.program} onChange={(e) => updateDraftModule(idx, { program: e.target.value })} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 mt-1 h-14 resize-none" />
                              </div>
                              <div>
                                <label className="text-[9.5px] font-mono text-slate-500 uppercase">Carga horária do módulo</label>
                                <input value={dm.workload} onChange={(e) => updateDraftModule(idx, { workload: e.target.value })} placeholder="ex: 6h" className="w-full bg-slate-950 border border-next-border rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 mt-1" />
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label className="text-[9.5px] font-mono text-slate-500 uppercase">Aulas ({dm.lessons.length})</label>
                                  <button onClick={() => addDraftLesson(idx)} className="inline-flex items-center gap-1 text-[9.5px] font-bold text-slate-300 border border-next-border px-1.5 py-0.5 rounded-md"><Plus className="w-2.5 h-2.5" /> Aula</button>
                                </div>
                                {dm.lessons.map((lesson, lIdx) => (
                                  <div key={lesson.id} className="flex items-start gap-1.5 bg-slate-950 border border-next-border rounded-lg p-2">
                                    <div className="flex-1 space-y-1">
                                      <input value={lesson.title} onChange={(e) => updateDraftLesson(idx, lIdx, { title: e.target.value })} placeholder="Título da aula" className="w-full bg-transparent text-[11px] text-slate-200 font-bold outline-none" />
                                      <input value={lesson.description || ''} onChange={(e) => updateDraftLesson(idx, lIdx, { description: e.target.value })} placeholder="Descrição" className="w-full bg-transparent text-[10.5px] text-slate-400 outline-none" />
                                    </div>
                                    <input value={lesson.duration || ''} onChange={(e) => updateDraftLesson(idx, lIdx, { duration: e.target.value })} placeholder="45min" className="w-16 bg-slate-900 border border-next-border rounded-md text-[10px] text-slate-300 px-1.5 py-1 text-center flex-shrink-0" />
                                    <button onClick={() => removeDraftLesson(idx, lIdx)} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {aiCourseError && <p className="text-[11px] text-next-red-alert">{aiCourseError}</p>}
                  <div className="flex gap-2">
                    <button onClick={handleGenerateFullCourse} disabled={aiCourseLoading} className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-xs rounded-xl disabled:opacity-50 flex-shrink-0">
                      {aiCourseLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      <span>Gerar de novo</span>
                    </button>
                    <button onClick={handleCreateFullCourse} disabled={creatingFullCourse || !aiCourseDraft.courseName.trim() || aiCourseDraft.modules.length === 0} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple-strong disabled:opacity-50">
                      {creatingFullCourse ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      <span>{creatingFullCourse ? 'Criando curso e módulos...' : `Criar curso e ${aiCourseDraft.modules.length} módulos de verdade`}</span>
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* COURSE MODAL */}
      <AnimatePresence>
        {isCourseModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingCourse && setIsCourseModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">{editingCourseId ? 'Editar curso' : 'Novo curso'}</h3>
                <button onClick={() => setIsCourseModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Nome do curso *</label>
                <input autoFocus value={courseForm.name} onChange={(e) => setCourseForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Tipo</label>
                  <select value={courseForm.type} onChange={(e) => setCourseForm(v => ({ ...v, type: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    {COURSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                  <select value={courseForm.status} onChange={(e) => setCourseForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    {COURSE_STATUS.map(s => <option key={s} value={s}>{COURSE_STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Professor</label>
                <input value={courseForm.professorName} onChange={(e) => setCourseForm(v => ({ ...v, professorName: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Início</label>
                  <input type="date" value={courseForm.startDate} onChange={(e) => setCourseForm(v => ({ ...v, startDate: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Fim</label>
                  <input type="date" value={courseForm.endDate} onChange={(e) => setCourseForm(v => ({ ...v, endDate: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Carga (h)</label>
                  <input type="number" value={courseForm.durationHours} onChange={(e) => setCourseForm(v => ({ ...v, durationHours: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Vagas</label>
                  <input type="number" value={courseForm.maxStudents} onChange={(e) => setCourseForm(v => ({ ...v, maxStudents: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Preço (R$)</label>
                  <input type="number" value={courseForm.price} onChange={(e) => setCourseForm(v => ({ ...v, price: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Local</label>
                <input value={courseForm.location} onChange={(e) => setCourseForm(v => ({ ...v, location: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Observações</label>
                <textarea value={courseForm.observations} onChange={(e) => setCourseForm(v => ({ ...v, observations: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none" />
              </div>
              <button onClick={handleSaveCourse} disabled={savingCourse || !courseForm.name.trim()} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                {savingCourse ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{savingCourse ? 'Gravando...' : 'Salvar curso real'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODULE MODAL */}
      <AnimatePresence>
        {isModuleModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingModule && setIsModuleModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">{editingModuleId ? 'Editar módulo' : 'Novo módulo'}</h3>
                <button onClick={() => setIsModuleModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>

              <div className="bg-slate-950 border border-next-purple-neon/30 rounded-xl p-3 space-y-2">
                <p className="text-[10.5px] text-slate-400 flex items-start gap-1.5"><Wand2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0 mt-0.5" />Descreva o módulo em uma frase e a Eliza monta resumo, objetivos, programa e a sequência de aulas — revise tudo antes de salvar.</p>
                <div className="flex gap-2">
                  <input value={aiModuleBrief} onChange={(e) => setAiModuleBrief(e.target.value)} placeholder="Ex: módulo introdutório de toxina botulínica, teórico-prático" className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                  <button onClick={handleGenerateModuleContent} disabled={aiModuleLoading || !aiModuleBrief.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50 flex-shrink-0">
                    {aiModuleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {aiModuleError && <p className="text-[11px] text-next-red-alert">{aiModuleError}</p>}
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Nome do módulo *</label>
                <input value={moduleForm.name} onChange={(e) => setModuleForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Data</label>
                  <input type="date" value={moduleForm.date} onChange={(e) => setModuleForm(v => ({ ...v, date: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Início</label>
                  <input type="time" value={moduleForm.startTime} onChange={(e) => setModuleForm(v => ({ ...v, startTime: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Fim</label>
                  <input type="time" value={moduleForm.endTime} onChange={(e) => setModuleForm(v => ({ ...v, endTime: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Resumo</label>
                <textarea value={moduleForm.summary} onChange={(e) => setModuleForm(v => ({ ...v, summary: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-14 resize-none" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Descrição</label>
                <textarea value={moduleForm.description} onChange={(e) => setModuleForm(v => ({ ...v, description: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-14 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Objetivos</label>
                  <textarea value={moduleForm.objectives} onChange={(e) => setModuleForm(v => ({ ...v, objectives: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-14 resize-none" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Programa / Ementa</label>
                  <textarea value={moduleForm.program} onChange={(e) => setModuleForm(v => ({ ...v, program: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-14 resize-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Carga horária</label>
                  <input value={moduleForm.workload} onChange={(e) => setModuleForm(v => ({ ...v, workload: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                  <select value={moduleForm.status} onChange={(e) => setModuleForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    {MODULE_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 bg-slate-900/50 border border-next-border rounded-lg px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={moduleForm.visibleToStudents} onChange={(e) => setModuleForm(v => ({ ...v, visibleToStudents: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                  <span className="text-[10.5px] text-slate-300">Visível p/ alunos</span>
                </label>
              </div>

              <div className="pt-2 border-t border-next-border">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-mono text-slate-500 uppercase">Aulas ({moduleForm.lessons.length})</p>
                  <button onClick={addLesson} className="text-[10px] font-bold text-slate-500 hover:text-slate-300">+ adicionar aula</button>
                </div>
                <div className="space-y-2">
                  {moduleForm.lessons.map((l, idx) => (
                    <div key={l.id} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5 space-y-1.5">
                      <div className="flex gap-1.5 items-center">
                        <div className="flex flex-col">
                          <button onClick={() => moveLesson(idx, -1)} className="text-slate-500 hover:text-slate-300"><ChevronUp className="w-3 h-3" /></button>
                          <button onClick={() => moveLesson(idx, 1)} className="text-slate-500 hover:text-slate-300"><ChevronDown className="w-3 h-3" /></button>
                        </div>
                        <input value={l.title} onChange={(e) => updateLesson(idx, { title: e.target.value })} placeholder="Título da aula" className="flex-1 bg-slate-950 border border-next-border rounded-lg text-xs font-bold text-slate-200 px-2.5 py-1.5" />
                        <input value={l.duration || ''} onChange={(e) => updateLesson(idx, { duration: e.target.value })} placeholder="Duração" className="w-24 bg-slate-950 border border-next-border rounded-lg text-xs text-slate-300 px-2.5 py-1.5" />
                        <button onClick={() => removeLesson(idx)} className="text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <textarea value={l.description || ''} onChange={(e) => updateLesson(idx, { description: e.target.value })} placeholder="Descrição" className="w-full bg-slate-950 border border-next-border rounded-lg text-xs text-slate-300 px-2.5 py-1.5 h-12 resize-none" />
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={handleSaveModule} disabled={savingModule || !moduleForm.name.trim()} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                {savingModule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{savingModule ? 'Gravando...' : 'Salvar módulo real'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODEL PATIENT MODAL */}
      <AnimatePresence>
        {isPatientModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingPatient && setIsPatientModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">{editingPatientId ? 'Editar paciente-modelo' : 'Novo paciente-modelo'}</h3>
                <div className="flex items-center gap-2">
                  {isAdmin && editingPatientId && (pendingDeletePatientId === editingPatientId ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDeletePatient(modelPatients.find(p => p.id === editingPatientId)!)} className="text-[9px] font-bold text-white bg-next-red-alert px-1.5 py-1 rounded">Confirmar</button>
                      <button onClick={() => setPendingDeletePatientId(null)} className="text-slate-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <button onClick={() => setPendingDeletePatientId(editingPatientId)} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert"><Trash2 className="w-3.5 h-3.5" /></button>
                  ))}
                  <button onClick={() => setIsPatientModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                </div>
              </div>

              {!editingPatientId && (
                <div className="bg-slate-950 border border-next-border rounded-xl p-3 space-y-2">
                  <p className="text-[10px] font-mono text-slate-500 uppercase">Importar de paciente real da clínica</p>
                  <div className="flex gap-2">
                    <input value={importSearchTerm} onChange={(e) => setImportSearchTerm(e.target.value)} placeholder="Buscar por nome..." className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" onKeyDown={(e) => { if (e.key === 'Enter') handleSearchImport(); }} />
                    <button onClick={handleSearchImport} disabled={searchingImport} className="px-3 py-2 bg-slate-800 border border-next-border rounded-lg text-slate-300">
                      {searchingImport ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {importResults.length > 0 && (
                    <div className="space-y-1">
                      {importResults.map(r => (
                        <button key={r.id} onClick={() => applyImportedPatient(r)} className="w-full text-left px-2.5 py-1.5 bg-slate-900/60 hover:bg-slate-800 rounded-lg text-xs text-slate-300">{r.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Nome *</label>
                <input value={patientForm.name} onChange={(e) => setPatientForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">CPF</label>
                  <input value={patientForm.cpf} onChange={(e) => setPatientForm(v => ({ ...v, cpf: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Telefone</label>
                  <input value={patientForm.phone} onChange={(e) => setPatientForm(v => ({ ...v, phone: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Curso vinculado</label>
                  <select value={patientForm.courseId} onChange={(e) => setPatientForm(v => ({ ...v, courseId: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    <option value="">— Nenhum —</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Status</label>
                  <select value={patientForm.status} onChange={(e) => setPatientForm(v => ({ ...v, status: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                    {PATIENT_STATUS.map(s => <option key={s} value={s}>{PATIENT_STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Queixa principal</label>
                <input value={patientForm.chiefComplaint} onChange={(e) => setPatientForm(v => ({ ...v, chiefComplaint: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Procedimento desejado</label>
                <input value={patientForm.desiredProcedure} onChange={(e) => setPatientForm(v => ({ ...v, desiredProcedure: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Alergias</label>
                  <input value={patientForm.allergies} onChange={(e) => setPatientForm(v => ({ ...v, allergies: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Contraindicações</label>
                  <input value={patientForm.contraindications} onChange={(e) => setPatientForm(v => ({ ...v, contraindications: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={patientForm.imageConsentSigned} onChange={(e) => setPatientForm(v => ({ ...v, imageConsentSigned: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-[10.5px] text-slate-300">Consentimento de imagem assinado</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={patientForm.tcleSigned} onChange={(e) => setPatientForm(v => ({ ...v, tcleSigned: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-[10.5px] text-slate-300">TCLE assinado</span>
                </label>
              </div>
              <button onClick={handleSavePatient} disabled={savingPatient || !patientForm.name.trim()} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                {savingPatient ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{savingPatient ? 'Gravando...' : 'Salvar paciente-modelo real'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NEW STUDENT MODAL */}
      <AnimatePresence>
        {isAddStudentOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !creatingStudent && setIsAddStudentOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><UserPlus className="w-4 h-4 text-next-purple-neon" /> Adicionar aluno</h3>
                <button onClick={() => !creatingStudent && setIsAddStudentOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-[11px] text-amber-400/90 mb-4 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Isto cria um login real (Firebase Auth) para o aluno.</p>

              <form onSubmit={handleCreateStudent} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Nome completo *</label>
                  <input autoFocus value={newStudent.name} onChange={(e) => setNewStudent(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">E-mail *</label>
                  <input type="email" value={newStudent.email} onChange={(e) => setNewStudent(v => ({ ...v, email: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Senha temporária *</label>
                  <div className="relative mt-1">
                    <input type={showStudentPassword ? 'text' : 'password'} value={newStudent.password} onChange={(e) => setNewStudent(v => ({ ...v, password: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 pr-9" />
                    <button type="button" onClick={() => setShowStudentPassword(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showStudentPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Curso</label>
                    <select value={newStudent.courseId} onChange={(e) => setNewStudent(v => ({ ...v, courseId: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                      <option value="">— Nenhum —</option>
                      {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Turma</label>
                    <input value={newStudent.batchName} onChange={(e) => setNewStudent(v => ({ ...v, batchName: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Acesso expira em (opcional)</label>
                  <input type="date" value={newStudent.accessExpirationDate} onChange={(e) => setNewStudent(v => ({ ...v, accessExpirationDate: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>

                <div className="pt-2 border-t border-next-border">
                  <p className="text-[10px] font-mono text-slate-500 uppercase mb-2">O que este aluno pode fazer</p>
                  <div className="space-y-1.5">
                    {STUDENT_PERMISSIONS.map(p => (
                      <label key={String(p.key)} className="flex items-center gap-2.5 bg-slate-900/40 border border-next-border rounded-lg px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={!!(newStudent as any)[p.key]} onChange={(e) => setNewStudent(v => ({ ...v, [p.key]: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                        <span className="text-[10.5px] text-slate-300">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {createStudentError && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{createStudentError}</p>}
                <button type="submit" disabled={creatingStudent} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                  {creatingStudent ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  <span>{creatingStudent ? 'Criando conta real...' : 'Criar login real do aluno'}</span>
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PROFESSOR GABARITO CANVAS */}
      <AnimatePresence>
        {canvasCase && canvasAngle && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-4xl">
              <AcademyPlanningCanvas
                imageUrl={canvasCase.images[canvasAngle]}
                initialDrawingsJson={canvasCase.professorDrawings?.[canvasAngle]}
                onSavePlanning={handleSaveProfessorDrawing}
                onClose={() => { setCanvasCase(null); setCanvasAngle(null); }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Cursos, módulos, pacientes-modelo, alunos, casos, documentos e financeiro gravam de verdade nesta clínica</span>
        </span>
      </div>
    </div>
  );
}
