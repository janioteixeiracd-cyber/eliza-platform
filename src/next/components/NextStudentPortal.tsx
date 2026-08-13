import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GraduationCap, BookOpen, ClipboardList, Wand2, Award, Camera, Loader2, Send,
  AlertTriangle, Check, X, Sparkles, Lock, PenTool
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDoc, secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, doc as fsDoc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import AcademyPlanningCanvas from './AcademyPlanningCanvas';

type StudentTab = 'cursos' | 'casos' | 'ia' | 'certificado';

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
  { id: 'casos', label: 'Meus Casos', icon: ClipboardList },
  { id: 'ia', label: 'IA Educacional', icon: Wand2 },
  { id: 'certificado', label: 'Certificado', icon: Award },
];

export default function NextStudentPortal() {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [activeTab, setActiveTab] = useState<StudentTab>('cursos');
  const [message, setMessage] = useState<string | null>(null);
  const showMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4500); };

  const [student, setStudent] = useState<StudentDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [modules, setModules] = useState<ModuleDoc[]>([]);
  const [cases, setCases] = useState<StudentCase[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    if (!clinic?.id || !user?.uid) return;
    setLoading(true);
    try {
      const sSnap = await secureGetDoc<StudentDoc>(fsDoc(db, 'clinics', clinic.id, 'education_students', user.uid), { addAuditLog });
      const studentData = sSnap.exists() ? ({ id: sSnap.id, ...sSnap.data() } as StudentDoc) : null;
      setStudent(studentData);

      if (studentData?.courseId) {
        const cSnap = await secureGetDoc<CourseDoc>(fsDoc(db, 'clinics', clinic.id, 'education_courses', studentData.courseId), { addAuditLog });
        setCourse(cSnap.exists() ? ({ id: cSnap.id, ...cSnap.data() } as CourseDoc) : null);

        const mSnap = await secureGetDocs<ModuleDoc>(query(collection(db, 'clinics', clinic.id, 'education_modules'), where('courseId', '==', studentData.courseId), limit(100)), 'education_modules', { addAuditLog });
        setModules(mSnap.docs.map(d => ({ id: d.id, lessons: [], ...d.data() } as ModuleDoc)).filter(m => m.visibleToStudents));
      }

      const casesSnap = await secureGetDocs<StudentCase>(query(collection(db, 'clinics', clinic.id, 'education_student_cases'), where('studentId', '==', user.uid), limit(100)), 'education_student_cases', { addAuditLog });
      setCases(casesSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudentCase)));
    } catch (err) {
      console.warn('Failed to load real student portal data:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); }, [clinic?.id, user?.uid]);

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
    if (!clinic?.id || !user?.uid || !student) return;
    if (Object.keys(caseForm.images).length === 0) { showMessage('Anexe ao menos uma foto.'); return; }
    setSavingCase(true);
    try {
      const payload = {
        studentId: user.uid, studentName: student.name, studentEmail: student.email || profile?.email || '',
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

      {/* MEUS CURSOS */}
      {activeTab === 'cursos' && (
        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
          {student.permViewSchedule === false ? (
            <p className="text-xs text-slate-500 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Sem permissão para ver o cronograma do curso.</p>
          ) : !course ? (
            <p className="text-xs text-slate-500">Você ainda não está vinculado a nenhum curso.</p>
          ) : modules.length === 0 ? (
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
      )}

      {/* MEUS CASOS */}
      {activeTab === 'casos' && (
        <div className="space-y-4">
          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-next-purple-neon" /> Meus Casos ({cases.length})</h3>
              {student.permAttachPhotos !== false && (
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
                        {c.status === 'approved' && firstImage && (
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
