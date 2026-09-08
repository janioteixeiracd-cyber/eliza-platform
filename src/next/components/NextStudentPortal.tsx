import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GraduationCap, BookOpen, ClipboardList, Wand2, Award, Camera, Loader2, Send,
  AlertTriangle, Check, X, Sparkles, Lock, PenTool, Eye, ArrowRight, MessageCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDoc, secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, doc as fsDoc, getDoc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import AcademyPlanningCanvas from './AcademyPlanningCanvas';
import ClinicalFichaPanel, { type WorkspacePoint, type PointRecord } from './ClinicalFichaPanel';
import DoseColorLegend from './DoseColorLegend';
import { AcademyEnrollmentService } from '../../services/academyEnrollmentService';
import { AcademyActivityService } from '../../services/academyActivityService';
import { getTemplateForId } from '../../lib/planningTemplates';
import { DEFAULT_DOSE_COLOR_PREFS, colorForDose, prefillPointRecord, type ToxinaWorkspacePrefs } from '../../lib/doseColorPrefs';
import type { EducationEnrollment, EducationActivity, StudentAttempt } from '../../types/education';

type StudentTab = 'cursos' | 'atividades' | 'casos' | 'ia' | 'certificado';

interface StudentDoc {
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
}

interface CourseDoc { id: string; name: string; status: string; endDate?: string; }

interface ModuleDoc {
  id: string; courseId: string; name: string; date?: string; startTime?: string; endTime?: string;
  summary?: string; status: string; visibleToStudents?: boolean;
  lessons: { id: string; title: string; description?: string; duration?: string; supportMaterial?: string }[];
}

const ANGLES: { key: string; label: string }[] = [
  { key: 'frontal', label: 'Frontal' },
  { key: 'profileRight', label: 'Perfil Direito' },
  { key: 'profileLeft', label: 'Perfil Esquerdo' },
  { key: 'smile', label: 'Sorriso' },
  { key: 'intraoral', label: 'Intraoral' },
  { key: 'other', label: 'Outro' },
];

interface StudentCase {
  id: string;
  studentId: string;
  patientCode?: string;
  chiefComplaint?: string;
  clinicalNotes?: string;
  images: Record<string, string>;
  drawings?: Record<string, string>;
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

function formatDate(d: any): string {
  try {
    if (!d) return '';
    if (typeof d === 'string') return new Date(d).toLocaleDateString('pt-BR');
    if (d.toDate) return d.toDate().toLocaleDateString('pt-BR');
    return new Date(d).toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function compressImage(file: File, maxSize = 600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas indisponível')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TABS: { id: StudentTab; label: string; icon: any }[] = [
  { id: 'cursos', label: 'Meus Cursos', icon: BookOpen },
  { id: 'atividades', label: 'Atividades', icon: ClipboardList },
  { id: 'casos', label: 'Meus Casos', icon: ClipboardList },
  { id: 'ia', label: 'IA Educacional', icon: Wand2 },
  { id: 'certificado', label: 'Certificado', icon: Award },
];

const ATTEMPT_STATUS_META: Record<string, { label: string; classes: string }> = {
  draft: { label: 'Rascunho', classes: 'bg-slate-800 border-next-border text-slate-400' },
  submitted: { label: 'Enviado — aguardando correção', classes: 'bg-next-purple-neon/10 border-next-purple-neon/20 text-next-purple-neon' },
  revision_requested: { label: 'Revisão solicitada', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  approved: { label: 'Aprovado', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
};

// previewStudentId lets an admin open this exact same portal read-only for a
// chosen student (Eliza Academy → Alunos → "Visualizar como aluno") instead
// of building a second, parallel view — every fetch below targets this id
// instead of the logged-in user's own uid when it's set, and every handler
// that would write something as if the student did it is short-circuited.
export default function NextStudentPortal({ previewStudentId }: { previewStudentId?: string } = {}) {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isPreview = !!previewStudentId;
  const effectiveUid = previewStudentId || user?.uid;

  const [activeTab, setActiveTab] = useState<StudentTab>('cursos');
  const [message, setMessage] = useState<string | null>(null);
  const showMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4500); };

  const [student, setStudent] = useState<StudentDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [modules, setModules] = useState<ModuleDoc[]>([]);
  const [cases, setCases] = useState<StudentCase[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    if (!clinic?.id || !effectiveUid) return;
    setLoading(true);
    try {
      const sSnap = await secureGetDoc<StudentDoc>(fsDoc(db, 'clinics', clinic.id, 'education_students', effectiveUid), { addAuditLog });
      const studentData = sSnap.exists() ? ({ id: sSnap.id, ...sSnap.data() } as StudentDoc) : null;
      setStudent(studentData);

      if (studentData?.courseId) {
        const cSnap = await secureGetDoc<CourseDoc>(fsDoc(db, 'clinics', clinic.id, 'education_courses', studentData.courseId), { addAuditLog });
        setCourse(cSnap.exists() ? ({ id: cSnap.id, ...cSnap.data() } as CourseDoc) : null);

        const mSnap = await secureGetDocs<ModuleDoc>(query(collection(db, 'clinics', clinic.id, 'education_modules'), where('courseId', '==', studentData.courseId), limit(100)), 'education_modules', { addAuditLog });
        setModules(mSnap.docs.map(d => ({ id: d.id, lessons: [], ...d.data() } as ModuleDoc)).filter(m => m.visibleToStudents));
      }

      const casesSnap = await secureGetDocs<StudentCase>(query(collection(db, 'clinics', clinic.id, 'education_student_cases'), where('studentId', '==', effectiveUid), limit(100)), 'education_student_cases', { addAuditLog });
      setCases(casesSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudentCase)));
    } catch (err) {
      console.warn('Failed to load real student portal data:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); }, [clinic?.id, effectiveUid]);

  // --- Atividades (Slice 2B mínimo — turma/matrícula real) -----------------

  const [enrollments, setEnrollments] = useState<EducationEnrollment[]>([]);
  const [activities, setActivities] = useState<EducationActivity[]>([]);
  // Fase F (Home do aluno) — own-attempt status per activity, fetched once
  // alongside the activity list itself, so "continuar aprendendo" / "próxima
  // atividade" / "aguardando ação" below are all derived from real attempt
  // docs, never invented.
  const [attemptsByActivity, setAttemptsByActivity] = useState<Record<string, StudentAttempt[]>>({});
  const [selectedActivity, setSelectedActivity] = useState<EducationActivity | null>(null);
  const [ownAttempts, setOwnAttempts] = useState<StudentAttempt[]>([]);
  const [activeAttempt, setActiveAttempt] = useState<StudentAttempt | null>(null);
  const [attemptForm, setAttemptForm] = useState<{ structuredFields: Record<string, string | boolean>; pointRecords: Record<string, PointRecord>; studentAnalysis: string; justification: string; observations: string; strokesJson: string | null; overlayThumbnailBase64: string | null; images: Record<string, string> }>({
    structuredFields: {}, pointRecords: {}, studentAnalysis: '', justification: '', observations: '', strokesJson: null, overlayThumbnailBase64: null, images: {},
  });
  const [savingAttempt, setSavingAttempt] = useState(false);
  const [isAttemptCanvasOpen, setIsAttemptCanvasOpen] = useState(false);
  const [tutorAnswer, setTutorAnswer] = useState<string | null>(null);
  const [tutorLoading, setTutorLoading] = useState<string | null>(null); // mode currently loading

  // Clinical Learning Workspace (2026-08-29) — live mirror of the anatomical
  // canvas's point strokes (via onPointsChange) and the shared bidirectional
  // highlight between the map and the ficha's point table.
  const [workspacePoints, setWorkspacePoints] = useState<WorkspacePoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [deleteRequestedPointId, setDeleteRequestedPointId] = useState<string | null>(null);

  const handleWorkspacePointsChange = (points: WorkspacePoint[]) => {
    setWorkspacePoints(points);
    setAttemptForm((v) => {
      const next: Record<string, PointRecord> = {};
      const zones = selectedActivity ? getTemplateForId(selectedActivity.templateId).clinicalWorkspace?.muscleZones : undefined;
      for (const p of points) {
        if (v.pointRecords[p.id]) { next[p.id] = v.pointRecords[p.id]; continue; }
        const prefill = prefillPointRecord(p, zones, workspacePrefs.muscleDefaults);
        next[p.id] = { muscle: prefill?.muscle || '', unidades: prefill?.unidades || '', observacao: '' };
      }
      return { ...v, pointRecords: next };
    });
  };

  // Cor-por-dose (2026-08-30) — mesma preferência de clínica usada em
  // Planejamento IA/Execução (ver doseColorPrefs.ts); aqui só leitura, quem
  // ajusta a paleta é a equipe da clínica, não o aluno.
  const [workspacePrefs, setWorkspacePrefs] = useState<ToxinaWorkspacePrefs>(DEFAULT_DOSE_COLOR_PREFS);
  useEffect(() => {
    if (!clinic?.id) return;
    (async () => {
      try {
        const snap = await getDoc(fsDoc(db, 'clinics', clinic.id, 'settings', 'toxinaWorkspacePrefs'));
        if (snap.exists()) {
          const data = snap.data() as Partial<ToxinaWorkspacePrefs>;
          setWorkspacePrefs({
            colorRules: data.colorRules || DEFAULT_DOSE_COLOR_PREFS.colorRules,
            muscleDefaults: data.muscleDefaults || DEFAULT_DOSE_COLOR_PREFS.muscleDefaults,
          });
        }
      } catch (e) { console.error('Failed to load toxinaWorkspacePrefs:', e); }
    })();
  }, [clinic?.id]);
  const pointColorFor = (pointId: string) => colorForDose(attemptForm.pointRecords[pointId]?.unidades, workspacePrefs.colorRules);

  const fetchActivities = async () => {
    if (!clinic?.id || !effectiveUid) return;
    try {
      const myEnrollments = await AcademyEnrollmentService.listEnrollmentsForStudent(clinic.id, effectiveUid);
      setEnrollments(myEnrollments.filter(e => e.status === 'ativa'));
      const allActivities: EducationActivity[] = [];
      for (const enr of myEnrollments.filter(e => e.status === 'ativa')) {
        const turmaActivities = await AcademyActivityService.listActivitiesForTurma(clinic.id, enr.turmaId);
        allActivities.push(...turmaActivities.filter(a => a.status === 'published'));
      }
      setActivities(allActivities);

      const attemptEntries = await Promise.all(
        allActivities.map(async (a) => [a.id, await AcademyActivityService.listOwnAttempts(clinic.id, a.id, effectiveUid)] as const)
      );
      setAttemptsByActivity(Object.fromEntries(attemptEntries));
    } catch (err) {
      console.warn('Failed to load real activities:', err);
    }
  };
  useEffect(() => { fetchActivities(); }, [clinic?.id, effectiveUid]);

  const openActivity = async (activity: EducationActivity) => {
    if (!clinic?.id || !effectiveUid) return;
    setSelectedActivity(activity);
    setTutorAnswer(null);
    try {
      const attempts = await AcademyActivityService.listOwnAttempts(clinic.id, activity.id, effectiveUid);
      setOwnAttempts(attempts);
      // The attempt in focus is the MOST RECENT one overall (attempts[0],
      // already ordered desc by createdAt) — draft or not. A submitted/
      // reviewed attempt still needs to be "active" so the read-only status
      // card renders instead of falling through to an empty editable form
      // (which would silently start a brand new attempt on next save).
      // Only "Criar nova tentativa" (after a revision request) explicitly
      // resets this to null to start a fresh one.
      const latest = attempts[0] || null;
      setWorkspacePoints([]);
      setSelectedPointId(null);
      if (latest) {
        setActiveAttempt(latest);
        setAttemptForm({
          structuredFields: latest.structuredFields || {}, pointRecords: latest.pointRecords || {}, studentAnalysis: latest.studentAnalysis || '',
          justification: latest.justification || '', observations: latest.observations || '',
          strokesJson: latest.strokesJson || null, overlayThumbnailBase64: latest.overlayThumbnailBase64 || null,
          images: latest.images || {},
        });
      } else {
        setActiveAttempt(null);
        setAttemptForm({ structuredFields: {}, pointRecords: {}, studentAnalysis: '', justification: '', observations: '', strokesJson: null, overlayThumbnailBase64: null, images: {} });
      }
    } catch (err) {
      console.warn('Failed to load real attempts:', err);
    }
  };

  // Keeps the Home dashboard's per-activity attempt data live within the
  // same session — without this, saving a draft/submitting/etc. while inside
  // an activity wouldn't show up in "continuar aprendendo" back on Meus
  // Cursos until a full page reload re-ran fetchActivities().
  useEffect(() => {
    if (!selectedActivity) return;
    setAttemptsByActivity((prev) => ({ ...prev, [selectedActivity.id]: ownAttempts }));
  }, [ownAttempts, selectedActivity]);

  const goToActivity = (activity: EducationActivity) => {
    setActiveTab('atividades');
    openActivity(activity);
  };

  // Fase F (Home do aluno) — everything below is derived purely from
  // `activities` + `attemptsByActivity` (already fetched, real Firestore
  // data) and `cases`. No invented metrics (no score, no "average", no
  // completion percentage beyond a literal count of approved activities).
  const activityStates = useMemo(() => activities.map((a) => {
    const attempts = attemptsByActivity[a.id] || [];
    return { activity: a, attempts, latest: attempts[0] || null };
  }), [activities, attemptsByActivity]);

  const inProgressActivities = useMemo(() => activityStates.filter((s) => s.latest?.status === 'draft'), [activityStates]);
  const notStartedActivities = useMemo(() => activityStates.filter((s) => !s.latest), [activityStates]);
  const needsActionActivities = useMemo(() => activityStates.filter((s) => s.latest?.status === 'revision_requested'), [activityStates]);
  const approvedActivitiesCount = useMemo(() => activityStates.filter((s) => s.latest?.status === 'approved').length, [activityStates]);
  const casesNeedingAction = useMemo(() => cases.filter((c) => c.status === 'adjust'), [cases]);

  const recentProfessorFeedback = useMemo(() => {
    const items: { activityTitle: string; decision: 'approved' | 'revision_requested'; comments: string; reviewedAt: any }[] = [];
    for (const s of activityStates) {
      for (const att of s.attempts) {
        if (att.professorReview) {
          items.push({ activityTitle: s.activity.title, decision: att.professorReview.decision, comments: att.professorReview.comments, reviewedAt: att.professorReview.reviewedAt });
        }
      }
    }
    items.sort((a, b) => {
      const ta = a.reviewedAt?.toDate ? a.reviewedAt.toDate().getTime() : new Date(a.reviewedAt || 0).getTime();
      const tb = b.reviewedAt?.toDate ? b.reviewedAt.toDate().getTime() : new Date(b.reviewedAt || 0).getTime();
      return tb - ta;
    });
    return items.slice(0, 3);
  }, [activityStates]);

  const ensureDraftAttempt = async (): Promise<StudentAttempt | null> => {
    if (isPreview) return activeAttempt;
    if (activeAttempt) return activeAttempt;
    if (!clinic?.id || !effectiveUid || !selectedActivity || !student) return null;
    const enrollment = enrollments.find(e => e.turmaId === selectedActivity.turmaId);
    if (!enrollment) { showMessage('Matrícula não encontrada para esta turma.'); return null; }
    const attemptNumber = ownAttempts.length + 1;
    const newId = await AcademyActivityService.createAttempt(clinic.id, selectedActivity, effectiveUid, student.name, enrollment.id, attemptNumber);
    const fresh: StudentAttempt = {
      id: newId, clinicId: clinic.id, activityId: selectedActivity.id, turmaId: selectedActivity.turmaId,
      enrollmentId: enrollment.id, studentId: effectiveUid, studentName: student.name, templateId: selectedActivity.templateId,
      attemptNumber, status: 'draft', structuredFields: {}, pointRecords: null, studentAnalysis: '', justification: '', strokesJson: null,
      overlayThumbnailBase64: null, images: {}, observations: '', aiInteractions: [], professorReview: null,
      createdAt: new Date(), updatedAt: new Date(), submittedAt: null,
    };
    setActiveAttempt(fresh);
    setOwnAttempts(prev => [fresh, ...prev]);
    return fresh;
  };

  const handleAttemptPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      setAttemptForm(v => ({ ...v, images: { ...v.images, principal: dataUrl } }));
    } catch { showMessage('Falha ao processar a imagem.'); }
  };

  const handleSaveAttemptDraft = async (silent = false) => {
    if (isPreview) return;
    if (!clinic?.id) return;
    setSavingAttempt(true);
    try {
      const attempt = await ensureDraftAttempt();
      if (!attempt || !selectedActivity) return;
      await AcademyActivityService.saveDraft(clinic.id, selectedActivity.id, attempt.id, attemptForm);
      addAuditLog({ collection: 'education_activities', action: 'WRITE', status: 'SUCCESS', details: `Rascunho de tentativa salvo (escrita real).` });
      if (!silent) showMessage('Rascunho salvo de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao salvar: ${err?.message || err}`);
    } finally {
      setSavingAttempt(false);
    }
  };

  const handleSubmitAttempt = async () => {
    if (isPreview) return;
    if (!clinic?.id || !selectedActivity) return;
    setSavingAttempt(true);
    try {
      const attempt = await ensureDraftAttempt();
      if (!attempt) return;
      await AcademyActivityService.saveDraft(clinic.id, selectedActivity.id, attempt.id, attemptForm);
      await AcademyActivityService.submitAttempt(clinic.id, selectedActivity.id, attempt.id);
      addAuditLog({ collection: 'education_activities', action: 'WRITE', status: 'SUCCESS', details: `Tentativa enviada para correção do professor (escrita real).` });
      showMessage('Enviado de verdade para o professor — a partir de agora fica congelado.');
      await openActivity(selectedActivity);
    } catch (err: any) {
      showMessage(`Falha ao enviar: ${err?.message || err}`);
    } finally {
      setSavingAttempt(false);
    }
  };

  const handleAskTutor = async (mode: 'explain' | 'analyze' | 'post_review') => {
    if (isPreview) return;
    if (!clinic?.id || !user?.uid || !selectedActivity) return;
    setTutorLoading(mode);
    setTutorAnswer(null);
    try {
      let attempt = activeAttempt;
      // Only 'analyze' operates on an editable draft — save her latest edits
      // first so the AI reasons about what's actually on screen. 'post_review'
      // always targets an already-submitted/reviewed attempt (frozen by
      // firestore.rules the moment status left 'draft'), so saving here would
      // just throw permission-denied against an immutable doc for no reason.
      if (mode === 'analyze') {
        attempt = await ensureDraftAttempt();
        if (attempt) await AcademyActivityService.saveDraft(clinic.id, selectedActivity.id, attempt.id, attemptForm);
      }
      const idToken = await user.getIdToken();
      const res = await fetch('/api/eliza/academy-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          clinicId: clinic.id, turmaId: selectedActivity.turmaId, activityId: selectedActivity.id,
          attemptId: attempt?.id || null, mode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao consultar a ELIZA.');
      setTutorAnswer(data.answer);
      addAuditLog({ collection: 'education_activities', action: 'READ', status: 'SUCCESS', details: `ELIZA Tutora respondeu (modo: ${mode}, chamada real).` });
    } catch (err: any) {
      showMessage(`ELIZA: ${err?.message || err}`);
    } finally {
      setTutorLoading(null);
    }
  };

  // --- Envio de caso ---------------------------------------------------

  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);
  const [caseForm, setCaseForm] = useState<{ patientCode: string; chiefComplaint: string; clinicalNotes: string; images: Record<string, string> }>({ patientCode: '', chiefComplaint: '', clinicalNotes: '', images: {} });
  const [uploadingAngle, setUploadingAngle] = useState<string | null>(null);
  const [savingCase, setSavingCase] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleAngleFileSelected = async (angleKey: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAngle(angleKey);
    try {
      const dataUrl = await compressImage(file);
      setCaseForm(v => ({ ...v, images: { ...v.images, [angleKey]: dataUrl } }));
    } catch (err) {
      showMessage('Falha ao processar a imagem.');
    } finally {
      setUploadingAngle(null);
    }
  };

  const handleSubmitCase = async () => {
    if (isPreview) return;
    if (!clinic?.id || !effectiveUid || !student) return;
    if (Object.keys(caseForm.images).length === 0) { showMessage('Anexe ao menos uma foto.'); return; }
    setSavingCase(true);
    try {
      const payload = {
        studentId: effectiveUid, studentName: student.name, studentEmail: student.email || profile?.email || '',
        courseId: student.courseId || null, batchName: student.batchName || null,
        patientCode: caseForm.patientCode.trim() || null, chiefComplaint: caseForm.chiefComplaint.trim() || null,
        clinicalNotes: caseForm.clinicalNotes.trim() || null, images: caseForm.images,
        status: 'pending' as const, createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'clinics', clinic.id, 'education_student_cases'), payload);
      setCases(prev => [{ id: ref.id, ...payload } as StudentCase, ...prev]);
      addAuditLog({ collection: 'education_student_cases', action: 'WRITE', status: 'SUCCESS', details: `Caso clínico enviado por "${student.name}" (escrita real).` });
      setCaseForm({ patientCode: '', chiefComplaint: '', clinicalNotes: '', images: {} });
      setIsNewCaseOpen(false);
      showMessage('Caso enviado de verdade para revisão do professor.');
    } catch (err: any) {
      showMessage(`Falha ao enviar: ${err?.message || err}`);
    } finally {
      setSavingCase(false);
    }
  };

  // --- Anotação da própria foto -------------------------------------------

  const [canvasCase, setCanvasCase] = useState<StudentCase | null>(null);
  const [canvasAngle, setCanvasAngle] = useState<string | null>(null);

  const handleSaveOwnDrawing = async (drawingsJson: string, overlayPng?: string) => {
    if (isPreview) return;
    if (!clinic?.id || !canvasCase || !canvasAngle) return;
    try {
      const drawings = { ...(canvasCase.drawings || {}), [canvasAngle]: drawingsJson };
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'education_student_cases', canvasCase.id), { drawings, updatedAt: serverTimestamp() });
      setCases(prev => prev.map(c => c.id === canvasCase.id ? { ...c, drawings } : c));
      addAuditLog({ collection: 'education_student_cases', action: 'WRITE', status: 'SUCCESS', details: `Anotação do aluno salva no caso (escrita real).` });
      showMessage('Anotação salva de verdade.');
      setCanvasCase(null);
      setCanvasAngle(null);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    }
  };

  // --- IA Educacional --------------------------------------------------

  const [aiCaseId, setAiCaseId] = useState<string | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const approvedCases = useMemo(() => cases.filter(c => c.status === 'approved'), [cases]);

  const handleRunAiAnalysis = async (c: StudentCase) => {
    if (!clinic?.id) return;
    setAiCaseId(c.id);
    setAiAnalyzing(true);
    setAiError(null);
    setAiResult(null);
    try {
      const prompt = `Você é a Eliza, inteligência clínica educacional para cursos de odontologia/estética. Este é um caso clínico de um aluno, já aprovado pelo professor. Analise as imagens anexadas e produza:
1) Diagnóstico de simetria facial;
2) Mapeamento de zonas de risco (vasos/nervos) relevantes para o procedimento indicado na queixa;
3) Sequência de tratamento sugerida;
4) Dicas pedagógicas para o aluno.
Queixa principal relatada: "${c.chiefComplaint || 'não informada'}". Notas clínicas do aluno: "${c.clinicalNotes || 'nenhuma'}".
Responda em português, de forma didática e organizada em parágrafos curtos. Baseie-se apenas no que está visível nas imagens e no relato — nunca invente achados.`;
      const parts: any[] = [{ text: prompt }];
      Object.values(c.images || {}).forEach(dataUrl => {
        const base64Data = (dataUrl || '').split(',')[1];
        if (base64Data) parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data } });
      });
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts }],
        taskType: 'academy_case_analysis',
        clinicId: clinic.id,
      });
      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || 'Não consegui gerar uma análise.';
      setAiResult(rawText.trim());
      addAuditLog({ collection: 'education_student_cases', action: 'WRITE', status: 'SUCCESS', details: `Análise educacional de IA real gerada para o caso do aluno.` });
    } catch (err: any) {
      setAiError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // --- Access gating ------------------------------------------------------

  const isExpired = student?.accessExpirationDate && !student?.permAccessAfterEnd
    ? new Date(student.accessExpirationDate) < new Date()
    : false;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto pb-16 flex flex-col items-center justify-center py-20 gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-next-purple-neon" />
        <span className="text-xs font-mono text-slate-500">Carregando seu portal...</span>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="max-w-3xl mx-auto pb-16">
        <div className="next-glass-panel rounded-next-2xl p-10 text-center">
          <GraduationCap className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">Cadastro de aluno não encontrado</p>
          <p className="text-xs text-slate-500 mt-1">Fale com a coordenação do curso.</p>
        </div>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="max-w-3xl mx-auto pb-16">
        <div className="next-glass-panel rounded-next-2xl p-10 text-center">
          <Lock className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">Acesso expirado</p>
          <p className="text-xs text-slate-500 mt-1">Seu acesso ao portal expirou em {formatDate(student.accessExpirationDate)}. Fale com a coordenação do curso.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-16 space-y-6 font-sans">
      <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
        <div className="relative z-10">
          <h1 className="text-2xl font-extrabold tracking-tight next-brand-gradient-text flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-next-purple-neon" />
            Portal do Aluno
          </h1>
          <p className="text-slate-400 text-xs mt-1">Olá, {student.name}{course ? ` — ${course.name}` : ''}. Envie casos, acompanhe o feedback do professor e use a IA educacional.</p>
        </div>
      </div>

      {isPreview && (
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 flex items-center gap-2">
          <Eye className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-[11px] text-amber-400 font-semibold">Modo visualização (admin) — somente leitura. Nenhuma ação aqui é enviada como se fosse do aluno.</p>
        </div>
      )}

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

      {/* MEUS CURSOS — Home do aluno (Fase F, 2026-08-29) */}
      {activeTab === 'cursos' && (
        <div className="space-y-4">
          {!course ? (
            <div className="next-glass-panel rounded-next-2xl p-5">
              <p className="text-xs text-slate-500">Você ainda não está vinculado a nenhum curso.</p>
            </div>
          ) : (
            <>
              <div className="next-glass-panel rounded-next-2xl p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-mono text-slate-500 uppercase">Curso</p>
                  <p className="text-sm font-bold text-slate-100">{course.name}</p>
                  {student.batchName && <p className="text-[11px] text-slate-500 mt-0.5">Turma: {student.batchName}</p>}
                </div>
                {activities.length > 0 && (
                  <div className="text-right">
                    <p className="text-[9px] font-mono text-slate-500 uppercase">Atividades concluídas</p>
                    <p className="text-sm font-bold text-next-purple-light">{approvedActivitiesCount} de {activities.length}</p>
                  </div>
                )}
              </div>

              {(inProgressActivities.length > 0 || notStartedActivities.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {inProgressActivities[0] && (
                    <button onClick={() => goToActivity(inProgressActivities[0].activity)} className="text-left next-glass-panel rounded-next-2xl p-4 border border-transparent hover:border-next-purple-neon/40 transition-colors">
                      <p className="text-[9.5px] font-bold text-next-purple-neon uppercase flex items-center gap-1.5"><PenTool className="w-3.5 h-3.5" /> Continuar aprendendo</p>
                      <p className="text-xs font-bold text-slate-100 mt-1.5">{inProgressActivities[0].activity.title}</p>
                      <p className="text-[10.5px] text-slate-500 mt-1">Rascunho salvo — retome de onde parou.</p>
                    </button>
                  )}
                  {notStartedActivities[0] && (
                    <button onClick={() => goToActivity(notStartedActivities[0].activity)} className="text-left next-glass-panel rounded-next-2xl p-4 border border-transparent hover:border-next-purple-neon/40 transition-colors">
                      <p className="text-[9.5px] font-bold text-slate-400 uppercase flex items-center gap-1.5"><ArrowRight className="w-3.5 h-3.5" /> Próxima atividade</p>
                      <p className="text-xs font-bold text-slate-100 mt-1.5">{notStartedActivities[0].activity.title}</p>
                      <p className="text-[10.5px] text-slate-500 mt-1">Ainda não iniciada.</p>
                    </button>
                  )}
                </div>
              )}

              {activities.length > 0 && inProgressActivities.length === 0 && notStartedActivities.length === 0 && needsActionActivities.length === 0 && (
                <div className="next-glass-panel rounded-next-2xl p-4 flex items-center gap-2">
                  <Check className="w-4 h-4 text-next-green-success flex-shrink-0" />
                  <p className="text-xs text-slate-300">Você está em dia com todas as atividades publicadas.</p>
                </div>
              )}

              {(needsActionActivities.length > 0 || casesNeedingAction.length > 0) && (
                <div className="next-glass-panel rounded-next-2xl p-5">
                  <p className="text-[9.5px] font-bold text-amber-400 uppercase flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> Aguardando sua ação</p>
                  <div className="space-y-1.5">
                    {needsActionActivities.map((s) => (
                      <button key={s.activity.id} onClick={() => goToActivity(s.activity)} className="w-full text-left flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 hover:border-amber-500/40 transition-colors">
                        <span className="text-[11px] font-semibold text-slate-200">{s.activity.title}</span>
                        <span className="text-[9px] font-black uppercase text-amber-400 flex-shrink-0">Revisão solicitada</span>
                      </button>
                    ))}
                    {casesNeedingAction.map((c) => (
                      <button key={c.id} onClick={() => setActiveTab('casos')} className="w-full text-left flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 hover:border-amber-500/40 transition-colors">
                        <span className="text-[11px] font-semibold text-slate-200">{c.chiefComplaint || c.patientCode || 'Caso clínico'}</span>
                        <span className="text-[9px] font-black uppercase text-amber-400 flex-shrink-0">Ajustes solicitados</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {recentProfessorFeedback.length > 0 && (
                <div className="next-glass-panel rounded-next-2xl p-5">
                  <p className="text-[9.5px] font-bold text-slate-400 uppercase flex items-center gap-1.5 mb-2"><MessageCircle className="w-3.5 h-3.5" /> Feedback recente do professor</p>
                  <div className="space-y-2">
                    {recentProfessorFeedback.map((f, i) => (
                      <div key={i} className="bg-slate-900/40 border border-next-border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-slate-200">{f.activityTitle}</span>
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border flex-shrink-0 ${f.decision === 'approved' ? 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' : 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight'}`}>{f.decision === 'approved' ? 'Aprovado' : 'Revisão solicitada'}</span>
                        </div>
                        {f.comments && <p className="text-[11px] text-slate-400 mt-1.5">{f.comments}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => setActiveTab('ia')} className="w-full flex items-center gap-3 next-glass-panel rounded-next-2xl p-4 border border-transparent hover:border-next-purple-neon/40 transition-colors text-left">
                <div className="w-9 h-9 rounded-xl next-brand-gradient-bg flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-white" /></div>
                <div>
                  <p className="text-xs font-bold text-slate-200">Converse com a ELIZA</p>
                  <p className="text-[10.5px] text-slate-500">Tire dúvidas, entenda correções e analise seus casos aprovados.</p>
                </div>
              </button>
            </>
          )}

          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <p className="text-[9.5px] font-bold text-slate-500 uppercase">Cronograma do curso</p>
            {student.permViewSchedule === false ? (
              <p className="text-xs text-slate-500 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Sem permissão para ver o cronograma do curso.</p>
            ) : !course ? null : modules.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum módulo publicado ainda para o seu curso.</p>
            ) : (
              <div className="space-y-2">
                {modules.map(m => (
                  <div key={m.id} className="bg-slate-900/40 border border-next-border rounded-lg p-3">
                    <p className="text-xs font-bold text-slate-200">{m.name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(m.date)} {m.startTime ? `${m.startTime}-${m.endTime}` : ''}</p>
                    {m.summary && <p className="text-[11px] text-slate-400 mt-1.5">{m.summary}</p>}
                    {student.permViewMaterials !== false && (m.lessons || []).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {m.lessons.map(l => (
                          <p key={l.id} className="text-[10.5px] text-slate-400">• {l.title} {l.duration ? `(${l.duration})` : ''}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ATIVIDADES */}
      {activeTab === 'atividades' && (
        <div className="space-y-4">
          {!selectedActivity ? (
            <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
              {activities.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma atividade publicada ainda para a sua turma.</p>
              ) : activities.map(a => (
                <button key={a.id} onClick={() => openActivity(a)} className="w-full text-left bg-slate-900/40 border border-next-border rounded-lg p-3 hover:border-next-purple-neon/40 transition-colors">
                  <p className="text-xs font-bold text-slate-200">{a.title}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{getTemplateForId(a.templateId).aiContext.split('.')[0]}.</p>
                  {a.description && <p className="text-[11px] text-slate-400 mt-1.5">{a.description}</p>}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <button onClick={() => setSelectedActivity(null)} className="text-[11px] text-slate-400 hover:text-slate-200 font-semibold">← Voltar às atividades</button>

              <div className="next-glass-panel rounded-next-2xl p-5">
                <h2 className="text-lg font-extrabold text-slate-100">{selectedActivity.title}</h2>
                {selectedActivity.description && <p className="text-xs text-slate-400 mt-1">{selectedActivity.description}</p>}
                {selectedActivity.educationalObjectives && <p className="text-[11px] text-slate-500 mt-2"><span className="font-bold text-slate-400">Objetivos:</span> {selectedActivity.educationalObjectives}</p>}
                {selectedActivity.instructions && <p className="text-[11px] text-slate-500 mt-1"><span className="font-bold text-slate-400">Instruções:</span> {selectedActivity.instructions}</p>}
              </div>

              {/* Histórico de tentativas anteriores */}
              {ownAttempts.filter(a => a.id !== activeAttempt?.id).length > 0 && (
                <div className="space-y-2">
                  {ownAttempts.filter(a => a.id !== activeAttempt?.id).map(att => (
                    <div key={att.id} className="next-glass-panel rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-bold text-slate-300">Tentativa {att.attemptNumber}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${ATTEMPT_STATUS_META[att.status]?.classes}`}>{ATTEMPT_STATUS_META[att.status]?.label}</span>
                      </div>
                      {att.professorReview && (
                        <p className="text-[11px] text-slate-400 mt-1.5"><span className="font-bold">Professor:</span> {att.professorReview.comments}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {activeAttempt && activeAttempt.status !== 'draft' ? (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-200">Tentativa {activeAttempt.attemptNumber}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${ATTEMPT_STATUS_META[activeAttempt.status]?.classes}`}>{ATTEMPT_STATUS_META[activeAttempt.status]?.label}</span>
                  </div>
                  {activeAttempt.professorReview && (
                    <div className="bg-slate-900/40 border border-next-border rounded-lg p-3 mt-2">
                      <p className="text-[11px] font-bold text-slate-300">Correção do professor</p>
                      <p className="text-[11px] text-slate-400 mt-1">{activeAttempt.professorReview.comments}</p>
                    </div>
                  )}
                  {!isPreview && selectedActivity.tutorPolicy.revealReferenceAfterReview && activeAttempt.professorReview && (
                    <button onClick={() => handleAskTutor('post_review')} disabled={tutorLoading === 'post_review'} className="w-full mt-2 flex items-center justify-center gap-1.5 next-brand-gradient-bg text-white text-[11px] font-bold py-2 rounded-lg disabled:opacity-50">
                      {tutorLoading === 'post_review' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Entender a correção com a ELIZA
                    </button>
                  )}
                  {tutorAnswer && (
                    <div className="bg-next-purple-neon/5 border border-next-purple-neon/20 rounded-lg p-3 mt-2">
                      <p className="text-[10px] font-bold text-next-purple-neon uppercase">ELIZA Tutora — apoio educacional, não substitui a avaliação do professor</p>
                      <p className="text-[11.5px] text-slate-300 mt-1.5 whitespace-pre-wrap">{tutorAnswer}</p>
                    </div>
                  )}
                  {!isPreview && activeAttempt.status === 'revision_requested' && (
                    <button onClick={async () => { setActiveAttempt(null); setTutorAnswer(null); setWorkspacePoints([]); setSelectedPointId(null); setAttemptForm({ structuredFields: {}, pointRecords: {}, studentAnalysis: '', justification: '', observations: '', strokesJson: null, overlayThumbnailBase64: null, images: {} }); }}
                      className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold py-2 rounded-lg">
                      Criar nova tentativa (revisão)
                    </button>
                  )}
                </div>
              ) : isPreview ? (
                <div className="next-glass-panel rounded-next-2xl p-8 text-center">
                  <p className="text-xs text-slate-500">Este aluno ainda não enviou nenhuma tentativa para esta atividade.</p>
                </div>
              ) : getTemplateForId(selectedActivity.templateId).clinicalWorkspace ? (
                // Clinical Learning Workspace (2026-08-29) — ficha visual +
                // mapa anatômico interativo lado a lado, em vez da lista
                // vertical de campos. Reaproveita o mesmo AcademyPlanningCanvas
                // (sobre o asset anatômico fixo, não a foto do caso) e o mesmo
                // ClinicalFichaPanel usado depois pela correção do professor.
                (() => {
                  const template = getTemplateForId(selectedActivity.templateId);
                  const ws = template.clinicalWorkspace!;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                        <ClinicalFichaPanel
                          template={template}
                          caseLabel={selectedActivity.title}
                          dateLabel={new Date().toLocaleDateString('pt-BR')}
                          professionalLabel={student.name}
                          headerFieldValues={attemptForm.structuredFields}
                          onHeaderFieldChange={(key, value) => setAttemptForm(v => ({ ...v, structuredFields: { ...v.structuredFields, [key]: value } }))}
                          points={workspacePoints}
                          pointRecords={attemptForm.pointRecords}
                          onPointRecordChange={(id, patch) => setAttemptForm(v => ({ ...v, pointRecords: { ...v.pointRecords, [id]: { ...(v.pointRecords[id] || { muscle: '', unidades: '', observacao: '' }), ...patch } } }))}
                          onDeletePoint={(id) => setDeleteRequestedPointId(id)}
                          selectedPointId={selectedPointId}
                          onSelectPoint={setSelectedPointId}
                          observations={attemptForm.observations}
                          onObservationsChange={(v) => setAttemptForm(prev => ({ ...prev, observations: v }))}
                        />
                        <div className="next-glass-panel rounded-next-2xl p-4 space-y-3">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Mapa Anatômico — use a ferramenta "Ponto" pra marcar</p>
                          <DoseColorLegend rules={workspacePrefs.colorRules} readOnly pointValueLabel={ws.pointValueLabel} />
                          <AcademyPlanningCanvas
                            imageUrl={ws.anatomicalAssetUrl}
                            initialDrawingsJson={attemptForm.strokesJson || undefined}
                            enabledTools={template.executionCanvasTools}
                            onPointsChange={handleWorkspacePointsChange}
                            selectedPointId={selectedPointId}
                            onSelectPoint={setSelectedPointId}
                            deleteRequestedPointId={deleteRequestedPointId}
                            onSavePlanning={(drawingsJson, overlayPng) => {
                              setAttemptForm(v => ({ ...v, strokesJson: drawingsJson, overlayThumbnailBase64: overlayPng || v.overlayThumbnailBase64 }));
                            }}
                            pointColorFor={pointColorFor}
                          />
                        </div>
                      </div>

                      <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Sua análise do caso</label>
                          <textarea value={attemptForm.studentAnalysis} onChange={e => setAttemptForm(v => ({ ...v, studentAnalysis: e.target.value }))} rows={3} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Justificativa do planejamento</label>
                          <textarea value={attemptForm.justification} onChange={e => setAttemptForm(v => ({ ...v, justification: e.target.value }))} rows={3} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Foto de referência do caso (opcional)</label>
                          <input type="file" accept="image/*" onChange={handleAttemptPhoto} className="mt-1 text-[11px] text-slate-400" />
                          {attemptForm.images.principal && <img src={attemptForm.images.principal} className="mt-2 w-full max-w-xs rounded-lg border border-next-border" />}
                        </div>

                        {template.executionSafetyNotes.map((n, i) => (
                          <p key={i} className="text-[10px] text-slate-500 italic">{n}</p>
                        ))}

                        <div className="flex flex-col gap-2 pt-2 border-t border-next-border">
                          {selectedActivity.tutorPolicy.allowExplainBeforeSubmit && (
                            <button onClick={() => handleAskTutor('explain')} disabled={!!tutorLoading} className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold py-2 rounded-lg disabled:opacity-50">
                              {tutorLoading === 'explain' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Perguntar como abordar a atividade
                            </button>
                          )}
                          {selectedActivity.tutorPolicy.allowAnalyzeOwnContent && (
                            <button onClick={() => handleAskTutor('analyze')} disabled={!!tutorLoading} className="flex items-center justify-center gap-1.5 next-brand-gradient-bg text-white text-[11px] font-bold py-2 rounded-lg disabled:opacity-50">
                              {tutorLoading === 'analyze' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Analisar meu planejamento com a ELIZA
                            </button>
                          )}
                        </div>

                        {tutorAnswer && (
                          <div className="bg-next-purple-neon/5 border border-next-purple-neon/20 rounded-lg p-3">
                            <p className="text-[10px] font-bold text-next-purple-neon uppercase">ELIZA Tutora — apoio educacional, não substitui a avaliação do professor</p>
                            <p className="text-[11.5px] text-slate-300 mt-1.5 whitespace-pre-wrap">{tutorAnswer}</p>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button onClick={() => handleSaveAttemptDraft(false)} disabled={savingAttempt} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 rounded-lg disabled:opacity-50">
                            {savingAttempt ? 'Salvando...' : 'Salvar rascunho'}
                          </button>
                          <button onClick={handleSubmitAttempt} disabled={savingAttempt} className="flex-1 next-brand-gradient-bg text-white text-xs font-bold py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
                            <Send className="w-3.5 h-3.5" /> Enviar ao professor
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
                  <p className="text-xs font-bold text-slate-300">Ficha — {getTemplateForId(selectedActivity.templateId).templateId === 'toxina_botulinica' ? 'Toxina Botulínica' : 'Preenchimento Facial'}</p>

                  {/* Academy's ficha de aplicação is the execution-style data (produto,
                      lote, validade, unidades...) — the same fields the real clinical
                      Planejamento → Execução flow (NextMedicalRecord.tsx) uses, not the
                      planning-side `clinicalFields` (which stay empty for these
                      templates on purpose; see planningTemplates.ts). This previously
                      read `clinicalFields`, which meant the ficha rendered zero
                      structured fields for Toxina — bug found and fixed 2026-08-29. */}
                  {getTemplateForId(selectedActivity.templateId).executionFields.map(f => (
                    <div key={f.key}>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">{f.label}</label>
                      {f.type === 'boolean' ? (
                        <button onClick={() => setAttemptForm(v => ({ ...v, structuredFields: { ...v.structuredFields, [f.key]: !v.structuredFields[f.key] } }))}
                          className={`mt-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border ${attemptForm.structuredFields[f.key] ? 'bg-next-purple-neon/20 border-next-purple-neon text-next-purple-neon' : 'bg-slate-900 border-next-border text-slate-400'}`}>
                          {attemptForm.structuredFields[f.key] ? 'Sim' : 'Não'}
                        </button>
                      ) : f.type === 'textarea' ? (
                        <textarea value={String(attemptForm.structuredFields[f.key] || '')} onChange={e => setAttemptForm(v => ({ ...v, structuredFields: { ...v.structuredFields, [f.key]: e.target.value } }))}
                          placeholder={f.placeholder} rows={2} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                      ) : f.type === 'select' ? (
                        <select value={String(attemptForm.structuredFields[f.key] || '')} onChange={e => setAttemptForm(v => ({ ...v, structuredFields: { ...v.structuredFields, [f.key]: e.target.value } }))}
                          className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2">
                          <option value="">— Selecione —</option>
                          {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input type="text" value={String(attemptForm.structuredFields[f.key] || '')} onChange={e => setAttemptForm(v => ({ ...v, structuredFields: { ...v.structuredFields, [f.key]: e.target.value } }))}
                          placeholder={f.placeholder} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                      )}
                    </div>
                  ))}

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Sua análise do caso</label>
                    <textarea value={attemptForm.studentAnalysis} onChange={e => setAttemptForm(v => ({ ...v, studentAnalysis: e.target.value }))} rows={3} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Justificativa do planejamento</label>
                    <textarea value={attemptForm.justification} onChange={e => setAttemptForm(v => ({ ...v, justification: e.target.value }))} rows={3} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Observações</label>
                    <textarea value={attemptForm.observations} onChange={e => setAttemptForm(v => ({ ...v, observations: e.target.value }))} rows={2} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Foto do caso</label>
                    <input type="file" accept="image/*" onChange={handleAttemptPhoto} className="mt-1 text-[11px] text-slate-400" />
                    {attemptForm.images.principal && (
                      <div className="mt-2 relative">
                        <img src={attemptForm.overlayThumbnailBase64 || attemptForm.images.principal} className="w-full max-w-xs rounded-lg border border-next-border" />
                        <button onClick={() => setIsAttemptCanvasOpen(true)} className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-next-purple-neon"><PenTool className="w-3.5 h-3.5" /> {attemptForm.strokesJson ? 'Editar marcações' : 'Marcar/desenhar no canvas'}</button>
                      </div>
                    )}
                  </div>

                  {getTemplateForId(selectedActivity.templateId).executionSafetyNotes.map((n, i) => (
                    <p key={i} className="text-[10px] text-slate-500 italic">{n}</p>
                  ))}

                  <div className="flex flex-col gap-2 pt-2 border-t border-next-border">
                    {selectedActivity.tutorPolicy.allowExplainBeforeSubmit && (
                      <button onClick={() => handleAskTutor('explain')} disabled={!!tutorLoading} className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold py-2 rounded-lg disabled:opacity-50">
                        {tutorLoading === 'explain' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Perguntar como abordar a atividade
                      </button>
                    )}
                    {selectedActivity.tutorPolicy.allowAnalyzeOwnContent && (
                      <button onClick={() => handleAskTutor('analyze')} disabled={!!tutorLoading} className="flex items-center justify-center gap-1.5 next-brand-gradient-bg text-white text-[11px] font-bold py-2 rounded-lg disabled:opacity-50">
                        {tutorLoading === 'analyze' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Analisar meu planejamento com a ELIZA
                      </button>
                    )}
                  </div>

                  {tutorAnswer && (
                    <div className="bg-next-purple-neon/5 border border-next-purple-neon/20 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-next-purple-neon uppercase">ELIZA Tutora — apoio educacional, não substitui a avaliação do professor</p>
                      <p className="text-[11.5px] text-slate-300 mt-1.5 whitespace-pre-wrap">{tutorAnswer}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => handleSaveAttemptDraft(false)} disabled={savingAttempt} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 rounded-lg disabled:opacity-50">
                      {savingAttempt ? 'Salvando...' : 'Salvar rascunho'}
                    </button>
                    <button onClick={handleSubmitAttempt} disabled={savingAttempt} className="flex-1 next-brand-gradient-bg text-white text-xs font-bold py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Enviar ao professor
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isAttemptCanvasOpen && attemptForm.images.principal && (
        <AcademyPlanningCanvas
          imageUrl={attemptForm.images.principal}
          initialDrawingsJson={attemptForm.strokesJson || undefined}
          enabledTools={selectedActivity ? getTemplateForId(selectedActivity.templateId).executionCanvasTools : undefined}
          onClose={() => setIsAttemptCanvasOpen(false)}
          onSavePlanning={(drawingsJson, overlayPng) => {
            setAttemptForm(v => ({ ...v, strokesJson: drawingsJson, overlayThumbnailBase64: overlayPng || v.overlayThumbnailBase64 }));
            setIsAttemptCanvasOpen(false);
          }}
        />
      )}

      {/* MEUS CASOS */}
      {activeTab === 'casos' && (
        <div className="space-y-4">
          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-next-purple-neon" /> Meus Casos ({cases.length})</h3>
              {!isPreview && student.permAttachPhotos !== false && (
                <button onClick={() => setIsNewCaseOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple"><Send className="w-3.5 h-3.5" /> Enviar caso</button>
              )}
            </div>
            {student.permAttachPhotos === false && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Sem permissão para anexar fotos/enviar casos.</p>
            )}
            {cases.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">Nenhum caso enviado ainda.</p>
            ) : (
              <div className="space-y-2">
                {cases.map(c => {
                  const meta = CASE_STATUS_META[c.status] || CASE_STATUS_META.pending;
                  const firstImage = Object.values(c.images || {})[0];
                  return (
                    <div key={c.id} className="bg-slate-900/40 border border-next-border rounded-lg p-3 flex items-center gap-3">
                      {firstImage && <img src={firstImage} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-200 truncate">{c.chiefComplaint || c.patientCode || 'Caso clínico'}</p>
                        <p className="text-[10px] text-slate-500">{formatDate(c.createdAt)}</p>
                        {c.professorFeedback && <p className="text-[10.5px] text-slate-400 mt-1 italic">"{c.professorFeedback}"</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${meta.classes}`}>{meta.label}</span>
                        {!isPreview && c.status === 'approved' && firstImage && (
                          <button onClick={() => { setCanvasCase(c); setCanvasAngle(Object.keys(c.images)[0]); }} className="inline-flex items-center gap-1 text-[9.5px] font-bold text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 px-2 py-1 rounded-lg">
                            <PenTool className="w-3 h-3" /> Anotar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* IA EDUCACIONAL */}
      {activeTab === 'ia' && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-next-2xl p-6 next-brand-gradient-bg shadow-next-glow-purple-strong">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl pointer-events-none bg-white/10" />
            <div className="relative z-10 flex items-center gap-4">
              <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center text-white border border-white/20 flex-shrink-0"><Wand2 className="w-7 h-7" /></div>
              <div>
                <h3 className="text-base font-black text-white tracking-tight">IA Educacional</h3>
                <p className="text-white/80 text-[11px] mt-1">Disponível para casos já aprovados pelo professor — a Eliza analisa suas fotos de verdade e sugere diagnóstico, riscos e sequência de tratamento.</p>
              </div>
            </div>
          </div>

          {approvedCases.length === 0 ? (
            <div className="next-glass-panel rounded-next-2xl p-8 text-center">
              <p className="text-xs text-slate-500">Nenhum caso aprovado ainda. Assim que o professor aprovar um caso seu, a análise de IA fica disponível aqui.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvedCases.map(c => (
                <div key={c.id} className="next-glass-panel rounded-next-2xl p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-200">{c.chiefComplaint || c.patientCode || 'Caso aprovado'}</p>
                    <button onClick={() => handleRunAiAnalysis(c)} disabled={aiAnalyzing && aiCaseId === c.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg shadow-next-glow-purple disabled:opacity-50">
                      {aiAnalyzing && aiCaseId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Analisar com IA
                    </button>
                  </div>
                  {aiCaseId === c.id && aiError && <p className="text-[11px] text-next-red-alert">{aiError}</p>}
                  {aiCaseId === c.id && aiResult && (
                    <div className="bg-slate-900/60 border border-next-border rounded-lg p-3 text-[11.5px] text-slate-300 leading-relaxed whitespace-pre-wrap">{aiResult}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CERTIFICADO */}
      {activeTab === 'certificado' && (
        <div className="next-glass-panel rounded-next-2xl p-8 text-center space-y-3">
          <Award className="w-10 h-10 text-next-purple-neon mx-auto" />
          {student.permDownloadCertificate === false ? (
            <p className="text-xs text-slate-500">Seu cadastro não tem permissão para certificado neste curso.</p>
          ) : student.certificateIssued ? (
            <>
              <p className="text-sm font-bold text-slate-200">Certificado emitido</p>
              <p className="text-xs text-slate-500">Código de verificação: <span className="font-mono text-next-purple-light">{student.certificateCode}</span></p>
              <p className="text-[10.5px] text-slate-600">Emitido em {formatDate(student.certificateIssuedAt)}. Peça a impressão à coordenação do curso (aba Documentos).</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-300">Certificado ainda não emitido</p>
              <p className="text-xs text-slate-500 mt-1">Ele é liberado pela coordenação quando o curso é finalizado e sua matrícula está concluída.</p>
            </>
          )}
        </div>
      )}

      {/* NEW CASE MODAL */}
      <AnimatePresence>
        {isNewCaseOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingCase && setIsNewCaseOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">Enviar caso clínico</h3>
                <button onClick={() => setIsNewCaseOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Identificação do paciente (opcional, sem nome real)</label>
                <input value={caseForm.patientCode} onChange={(e) => setCaseForm(v => ({ ...v, patientCode: e.target.value }))} placeholder="Ex: Paciente A" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Queixa principal</label>
                <input value={caseForm.chiefComplaint} onChange={(e) => setCaseForm(v => ({ ...v, chiefComplaint: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
              </div>
              {student.permWriteEvolution !== false && (
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Notas clínicas</label>
                  <textarea value={caseForm.clinicalNotes} onChange={(e) => setCaseForm(v => ({ ...v, clinicalNotes: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none" />
                </div>
              )}
              <div>
                <p className="text-[10px] font-mono text-slate-500 uppercase mb-1.5">Fotos (envie ao menos uma)</p>
                <div className="grid grid-cols-3 gap-2">
                  {ANGLES.map(a => (
                    <div key={a.key} className="text-center">
                      <input ref={(el) => { fileInputRefs.current[a.key] = el; }} type="file" accept="image/*" onChange={(e) => handleAngleFileSelected(a.key, e)} className="hidden" />
                      <button onClick={() => fileInputRefs.current[a.key]?.click()} className="w-full aspect-square rounded-lg bg-slate-900/60 border border-dashed border-next-border flex items-center justify-center overflow-hidden">
                        {uploadingAngle === a.key ? <Loader2 className="w-4 h-4 animate-spin text-next-purple-neon" /> : caseForm.images[a.key] ? <img src={caseForm.images[a.key]} alt={a.label} className="w-full h-full object-cover" /> : <Camera className="w-4 h-4 text-slate-600" />}
                      </button>
                      <p className="text-[8.5px] text-slate-500 mt-1">{a.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={handleSubmitCase} disabled={savingCase} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                {savingCase ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{savingCase ? 'Enviando...' : 'Enviar caso real para revisão'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* OWN DRAWING CANVAS MODAL */}
      <AnimatePresence>
        {canvasCase && canvasAngle && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-4xl">
              <AcademyPlanningCanvas
                imageUrl={canvasCase.images[canvasAngle]}
                initialDrawingsJson={canvasCase.drawings?.[canvasAngle]}
                onSavePlanning={handleSaveOwnDrawing}
                onClose={() => { setCanvasCase(null); setCanvasAngle(null); }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Casos e anotações gravam de verdade no seu curso</span>
        </span>
      </div>
    </div>
  );
}
