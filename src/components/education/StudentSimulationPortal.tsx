import React, { useState } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  BookOpen, 
  Clock, 
  Users, 
  AlertCircle,
  CheckCircle2,
  FileText,
  HelpCircle,
  ArrowLeft,
  X,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Video,
  FileDown,
  Award,
  LogOut,
  GraduationCap,
  FileCheck,
  BrainCircuit,
  Camera,
  HeartPulse,
  MessageSquare,
  ShieldAlert,
  UserCheck
} from 'lucide-react';
import InteractivePlanningCanvas from './InteractivePlanningCanvas';
import { getGenAI } from '../../lib/gemini';

interface StudentSimulationPortalProps {
  activeStudentObject: any;
  students: any[];
  courses: any[];
  modules: any[];
  procedures: any[];
  studentCases: any[];
  setIsStudentSimulationActive: (active: boolean) => void;
  setSimulatedStudentId: (id: string) => void;
  handleSaveStudentCase: (caseData: any) => Promise<void>;
  handleSaveCaseDrawing: (caseId: string, category: string, drawingsJson: string, base64Overlay?: string) => Promise<void>;
}

export default function StudentSimulationPortal({
  activeStudentObject,
  students,
  courses,
  modules,
  procedures,
  studentCases,
  setIsStudentSimulationActive,
  setSimulatedStudentId,
  handleSaveStudentCase,
  handleSaveCaseDrawing
}: StudentSimulationPortalProps) {

  // Derived student states
  const [studentTab, setStudentTab] = useState<'courses' | 'cases' | 'ai_assistant' | 'library'>('courses');
  const [isCreateCaseModalOpen, setIsCreateCaseModalOpen] = useState(false);
  const [caseForm, setCaseForm] = useState({
    patientCode: '',
    caseType: 'Harmonização Facial',
    chiefComplaint: '',
    clinicalNotes: '',
    images: {
      frontal: '',
      profileRight: '',
      profileLeft: '',
      smile: '',
      intraoral: '',
      other: ''
    }
  });

  const [isCompressing, setIsCompressing] = useState(false);
  const [isGeneratingCaseAI, setIsGeneratingCaseAI] = useState<boolean>(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<string>('');
  const [activeAiCaseId, setActiveAiCaseId] = useState<string>('');
  const [showProfessorStandardCompare, setShowProfessorStandardCompare] = useState<boolean>(false);
  const [activePlanningImage, setActivePlanningImage] = useState<{ id: string; category: string; url: string; item: any } | null>(null);

  const studentCourse = courses.find(c => c.id === activeStudentObject.courseId);
  const studentCourseModules = modules.filter(m => m.courseId === activeStudentObject.courseId);
  const studentProceduresAssigned = procedures.filter(p => p.studentName === activeStudentObject.name || p.studentName === activeStudentObject.email);
  
  // List of student's own cases
  const ownCases = studentCases.filter(c => c.studentId === activeStudentObject.id || c.studentEmail === activeStudentObject.email);

  // Handle image upload with auto-scaling downscale
  const handleFileChange = async (category: string, file: File | null) => {
    if (!file) return;
    setIsCompressing(true);
    try {
      const compressedBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 600;
            const MAX_HEIGHT = 600;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl);
          };
        };
        reader.onerror = error => reject(error);
      });

      setCaseForm(prev => ({
        ...prev,
        images: {
          ...prev.images,
          [category]: compressedBase64
        }
      }));
    } catch (err) {
      console.error("Failed compressing file upload", err);
      alert("Erro ao otimizar e subir foto.");
    } finally {
      setIsCompressing(false);
    }
  };

  const submitNewStudentCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseForm.patientCode.trim() || !caseForm.chiefComplaint.trim()) {
      alert("Preencha ao menos o Código do Caso e a Queixa Principal.");
      return;
    }

    await handleSaveStudentCase({
      ...caseForm,
      studentId: activeStudentObject.id,
      studentName: activeStudentObject.name,
      studentEmail: activeStudentObject.email,
      courseId: activeStudentObject.courseId,
      batchName: activeStudentObject.batchName,
      status: 'pending'
    });

    setIsCreateCaseModalOpen(false);
    setCaseForm({
      patientCode: '',
      caseType: 'Harmonização Facial',
      chiefComplaint: '',
      clinicalNotes: '',
      images: {
        frontal: '',
        profileRight: '',
        profileLeft: '',
        smile: '',
        intraoral: '',
        other: ''
      }
    });
  };

  // Run secure educational AI walkthrough using Gemini SDK proxy
  const runEducationalAIAnalysis = async (cObj: any) => {
    setIsGeneratingCaseAI(true);
    setActiveAiCaseId(cObj.id);
    setAiAnalysisResult('');
    setShowProfessorStandardCompare(false);

    try {
      const textNotes = Object.entries(cObj.drawings || {}).map(([key, drawJson]: any) => {
        try {
          const parsed = JSON.parse(drawJson);
          const words = (parsed.textNotes || []).map((n: any) => `"${n.text}"`).join(', ');
          const linesCount = (parsed.strokes || []).filter((s: any) => s.type !== 'eraser').length;
          return `Na foto ${key}, o estudante realizou ${linesCount} traçados/marcações de HOF${words ? ` e incluiu as observações: ${words}` : ''}.`;
        } catch {
          return `Na foto ${key}, o estudante realizou anotações gráficas.`;
        }
      }).join('\n');

      const systemAndPrompt = `Como professora de Harmonização Oficial e Odontologia Estética da ELIZA Education, forneça um parecer pedagógico completo e acolhedor para o seguinte caso clínico acadêmico:
Identificação do Caso: ${cObj.patientCode}
Modalidade de Estudo: ${cObj.caseType}
Queixa Principal do Paciente: "${cObj.chiefComplaint}"
Observações Clínicas Relatadas: "${cObj.clinicalNotes || 'Nenhuma registrada'}"

MARCAÇÕES FOTOGRÁFICAS EXECUTADAS PELO ALUNO:
${textNotes || 'O aluno não incluiu textos adicionais no desenho da imagem ainda.'}

Formate sua resposta em Markdown elegante contendo seções claras:
1. **ANÁLISE DE SIMETRIA E DIAGNÓSTICO ACADÊMICO**: Avalie as proporções relatadas, indicando as áreas faciais prioritárias para intervenção.
2. **MAREAMENTO DE RISCO ANATÔMICO**: Liste explicitamente as artérias, veias, forames e trajetos nervosos faciais de extremo perigo correlacionados com este procedimento (como artéria facial, ramos temporais, forame mentoniano, etc.).
3. **PLANO DE TRATAMENTO & SÍNTESE TERAPÊUTICA**: Proponha uma sequência ideal explicada passo a passo (ex: volumização de terço médio antes de preencher sulco nasogeniano).
4. **COMENTÁRIO PEDAGÓGICO**: Dicas construtivas de posicionamento clínico e anatomia palpatória.`;

      const aiClient = getGenAI();
      const response = await aiClient.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: systemAndPrompt
      });

      if (response.text) {
        setAiAnalysisResult(response.text);
      } else {
        setAiAnalysisResult("A IA não gerou retorno estruturado agora.");
      }
    } catch (err: any) {
      console.error("Educational AI error:", err);
      setAiAnalysisResult("A ELIZA AI não conseguiu processar sua análise agora: " + err.message);
    } finally {
      setIsGeneratingCaseAI(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar scroll-smooth space-y-6 text-left max-w-7xl mx-auto pb-32 p-6 md:px-8 animate-fade-in select-none">
      
      {/* Warning simulated header */}
      <div className="bg-[#1e1b4b] text-white p-4 px-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-semibold shadow-sm border border-indigo-900/40">
        <div className="flex items-center gap-2">
          <span className="p-1 px-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded font-bold uppercase tracking-widest text-[9px] animate-pulse">
            Laboratório Ativo
          </span>
          <span>Você está no Portal do Aluno: <span className="font-extrabold text-teal-400 uppercase">{activeStudentObject.name}</span></span>
        </div>

        <button 
          type="button"
          onClick={() => {
            setIsStudentSimulationActive(false);
            setSimulatedStudentId('');
          }}
          className="p-1.5 px-3 bg-white text-indigo-950 font-black tracking-widest text-[9.5px] uppercase rounded-xl hover:bg-slate-100 flex items-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" /> Sair do Portal
        </button>
      </div>

      {/* Portal top sub-navigation menu */}
      <div className="flex border-b border-slate-200 pb-2 gap-6 overflow-x-auto select-none custom-scrollbar pb-1">
        {[
          { id: 'courses', label: 'Cursos & Grade', icon: GraduationCap },
          { id: 'cases', label: 'Casos Clínicos & Planejamento', icon: FileCheck },
          { id: 'ai_assistant', label: 'ELIZA IA Educacional', icon: BrainCircuit },
          { id: 'library', label: 'Biblioteca & Certificados', icon: FileText },
        ].map(sb => {
          const IsAct = studentTab === sb.id;
          return (
            <button
              key={sb.id}
              type="button"
              onClick={() => setStudentTab(sb.id as any)}
              className={`pb-2 text-[11px] font-black uppercase tracking-widest outline-none border-b-2 transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
                IsAct ? 'text-indigo-600 border-indigo-600 font-black' : 'text-slate-400 hover:text-slate-600 border-transparent'
              }`}
            >
              <sb.icon className="w-4 h-4 shrink-0" />
              <span>{sb.label}</span>
            </button>
          );
        })}
      </div>

      {/* Interactive canvas editor portal overlay */}
      {activePlanningImage && (
        <div className="fixed inset-0 bg-slate-950/95 z-[105] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl">
            <InteractivePlanningCanvas 
              imageUrl={activePlanningImage.url}
              initialDrawingsJson={activePlanningImage.item.drawings?.[activePlanningImage.category]}
              onSavePlanning={(drawingsJson, base64Overlay) => {
                handleSaveCaseDrawing(activePlanningImage.id, activePlanningImage.category, drawingsJson, base64Overlay);
                setActivePlanningImage(null);
              }}
              onClose={() => setActivePlanningImage(null)}
            />
            
            {/* Image Category Switcher bottom list */}
            <div className="flex justify-center gap-3 mt-4 select-none">
              {Object.entries(activePlanningImage.item.images || {}).map(([cat, url]) => {
                if (!url) return null;
                const tags: Record<string, string> = {
                  frontal: 'Frontal',
                  profileRight: 'Perfil Dir.',
                  profileLeft: 'Perfil Esq.',
                  smile: 'Sorriso',
                  intraoral: 'Intraoral',
                  other: 'Outra'
                };
                return (
                  <button
                    key={cat}
                    onClick={() => setActivePlanningImage({ ...activePlanningImage, category: cat, url: url as string })}
                    className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all border cursor-pointer ${
                      activePlanningImage.category === cat 
                        ? 'bg-teal-600 text-white border-teal-500 shadow'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {tags[cat] || cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create new student case uploads */}
      {isCreateCaseModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 z-[110] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6 sm:p-8 w-full max-w-2xl select-none text-left shadow-2xl relative animate-fade-in space-y-6">
            
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Enviar Novo Caso Clínico Escolar</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Submeta suas fotos de HOF para liberação de planejamentos anatômicos</p>
              </div>
              <button 
                onClick={() => setIsCreateCaseModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitNewStudentCase} className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black text-slate-450 uppercase pl-1 block">Código do Caso / Iniciais do Paciente</label>
                  <input 
                    type="text"
                    required
                    placeholder="Ex: Dra. Ana - Paciente J.M"
                    value={caseForm.patientCode}
                    onChange={(e) => setCaseForm({ ...caseForm, patientCode: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-600/10"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black text-slate-450 uppercase pl-1 block">Tipo de Caso Acadêmico</label>
                  <select
                    value={caseForm.caseType}
                    onChange={(e) => setCaseForm({ ...caseForm, caseType: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 outline-none"
                  >
                    <option>Harmonização Facial</option>
                    <option>Toxina Botulínica</option>
                    <option>Fios de Sustentação</option>
                    <option>Preenchedores Cutâneos</option>
                    <option>Lipo de Papada Mecânica</option>
                    <option>Odontologia Estética</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black text-slate-450 uppercase pl-1 block">Queixa Principal do Paciente</label>
                  <textarea 
                    required
                    placeholder="Descreva a queixa principal trazida pelo paciente-modelo..."
                    rows={3}
                    value={caseForm.chiefComplaint}
                    onChange={(e) => setCaseForm({ ...caseForm, chiefComplaint: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-600/10 resize-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black text-slate-450 uppercase pl-1 block">Observações Clínicas Gerais</label>
                  <textarea 
                    placeholder="Anamnese rápida, restrições, marcas de preferência..."
                    rows={3}
                    value={caseForm.clinicalNotes}
                    onChange={(e) => setCaseForm({ ...caseForm, clinicalNotes: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-600/10 resize-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-700 uppercase pl-1 block">Carregar Fotos Clínicas do Paciente</label>
                
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {[
                    { key: 'frontal', name: 'Frontal' },
                    { key: 'profileRight', name: 'Perfil Dir.' },
                    { key: 'profileLeft', name: 'Perfil Esq.' },
                    { key: 'smile', name: 'Sorriso' },
                    { key: 'intraoral', name: 'Intraoral' },
                    { key: 'other', name: 'Outra/Papada' }
                  ].map(spec => {
                    const hasImg = !!(caseForm.images as any)[spec.key];
                    return (
                      <div key={spec.key} className="border border-slate-200 rounded-2xl p-2.5 flex flex-col items-center justify-between text-center bg-slate-50 gap-2 min-h-[110px]">
                        <span className="text-[9px] font-black text-slate-455 uppercase leading-none">{spec.name}</span>
                        {hasImg ? (
                          <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-200 bg-white relative">
                            <img src={(caseForm.images as any)[spec.key]} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setCaseForm(p => ({ ...p, images: { ...p.images, [spec.key]: '' } }))}
                              className="absolute top-0 right-0 bg-rose-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[8px] cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="w-10 h-10 border border-dashed border-slate-300 rounded-xl flex items-center justify-center text-slate-350 bg-white cursor-pointer hover:bg-slate-100 transition-all relative">
                            <Camera className="w-5 h-5" />
                            <input 
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleFileChange(spec.key, e.target.files?.[0] || null)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                          </div>
                        )}
                        <span className="text-[8px] font-black text-indigo-600 uppercase tracking-widest">
                          {hasImg ? 'Salvo' : 'Subir'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-50 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateCaseModalOpen(false)}
                  className="px-5 py-3 border border-slate-200 text-slate-500 rounded-xl font-bold uppercase text-[9.5px] cursor-pointer hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCompressing}
                  className="px-6 py-3 bg-indigo-650 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[9.5px] rounded-xl shadow-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isCompressing ? 'Armazenando...' : 'Submeter Caso Estético'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Tab 1: courses curriculum status */}
      {studentTab === 'courses' && (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
            
            {/* Left Column: Grade information */}
            <div className="md:col-span-8 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 text-left space-y-4">
              <h3 className="text-xs font-black text-slate-805 uppercase tracking-widest border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-indigo-650" /> Grade Curricular & Conclusão
              </h3>

              {studentCourse ? (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-150 p-4 rounded-2xl">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">{studentCourse.name}</h4>
                      <p className="text-[10px] text-slate-450 font-bold uppercase mt-1">Status do Curso: <span className="text-indigo-600 font-extrabold">{studentCourse.status}</span></p>
                    </div>
                    {studentCourse.status === 'finalizado' && (
                      <span className="bg-emerald-50 text-emerald-800 text-[9px] font-black uppercase p-1.5 px-3 rounded-full border border-emerald-200 shrink-0">
                        Curso Concluído
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-wide">Módulos de Aula Ativos</span>
                    
                    {studentCourseModules.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Nenhum módulo disponibilizado para esta turma ainda.</p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {studentCourseModules.map((m, idx) => (
                          <div key={m.id} className="py-3 flex justify-between items-center gap-4">
                            <div>
                              <p className="text-xs font-extrabold text-slate-800 uppercase tracking-tight">{idx + 1}. {m.name}</p>
                              <p className="text-[10px] text-slate-450 font-bold uppercase mt-0.5">{m.date} | Tema: {m.mainTopic || 'Clínico'}</p>
                            </div>
                            <span className="text-[9px] bg-slate-100 text-slate-600 font-black uppercase p-1 px-2.5 rounded-lg">
                              {m.lessons?.length || 0} Aulas
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Você não foi atrelado a nenhuma turma ativa da Eliza School.</p>
              )}
            </div>

            {/* Right Column: Procedures checklist */}
            <div className="md:col-span-4 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 text-left space-y-4">
              <h3 className="text-xs font-black text-slate-805 uppercase tracking-widest border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <HeartPulse className="w-4 h-4 text-rose-500" /> Seus Procedimentos Práticos
              </h3>

              {studentProceduresAssigned.length === 0 ? (
                <div className="text-center text-slate-400 italic py-16 text-xs">
                  <p>Nenhuma prática clínica agendada ou sob sua tutela ainda.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {studentProceduresAssigned.map(proc => (
                    <div key={proc.id} className="p-4 border border-slate-150 hover:border-slate-200 bg-slate-50/45 rounded-xl text-left">
                      <span className="text-[8px] bg-indigo-50 text-indigo-800 border border-indigo-100 font-black uppercase p-0.5 px-2.5 rounded">
                        {proc.status}
                      </span>
                      <h4 className="text-xs font-black text-slate-805 uppercase mt-2">{proc.procedure}</h4>
                      <p className="text-[10px] text-slate-455 font-semibold mt-1">Paciente-Modelo: <span className="font-bold text-slate-700">{proc.patientName}</span></p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Tab 2: clinical cases list & drawings editors activation */}
      {studentTab === 'cases' && (
        <div className="space-y-6">
          <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-6">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">Histórico de Casos Enviados</h3>
                <p className="text-[11px] text-slate-450 font-semibold">Consulte o status das suas fotos, faça traçados de HOF e analise-os clinicamente</p>
              </div>
              
              <button
                type="button"
                onClick={() => setIsCreateCaseModalOpen(true)}
                className="px-5 py-3 bg-indigo-650 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[9.5px] rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Enviar Caso de HOF
              </button>
            </div>

            {ownCases.length === 0 ? (
              <div className="text-center text-slate-405 italic py-16 text-xs space-y-2">
                <Camera className="w-10 h-10 text-slate-200 mx-auto" />
                <p>Você ainda não cadastrou nenhum caso de harmonização estética para avaliação.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {ownCases.map(item => {
                  const created = item.createdAt?.seconds 
                    ? new Date(item.createdAt.seconds * 1000).toLocaleDateString('pt-BR') 
                    : 'Recente';

                  // Badges matching statuses
                  const badges: Record<string, string> = {
                    pending: 'bg-amber-50 text-amber-800 border-amber-200',
                    approved: 'bg-emerald-50 text-emerald-850 border-emerald-250',
                    adjust: 'bg-sky-50 text-sky-850 border-sky-150',
                    rejected: 'bg-rose-50 text-rose-850 border-rose-200'
                  };

                  const bLabels: Record<string, string> = {
                    pending: 'Aguardando Aprovação de Foto',
                    approved: 'Aprovado - Planejamento Ativo',
                    adjust: 'Ajuste Solicitado pelo Professor',
                    rejected: 'Rejeitado por Critérios Técnicos'
                  };

                  return (
                    <div key={item.id} className="border border-slate-200 rounded-2xl p-5 bg-slate-50/20 text-left space-y-4">
                      
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-0.5">
                          <span className={`px-2 py-0.5 text-[8.5px] border rounded font-black uppercase inline-block leading-none ${badges[item.status] || badges.pending}`}>
                            {bLabels[item.status] || item.status}
                          </span>
                          <h4 className="text-xs font-black text-slate-850 uppercase tracking-tight mt-1">Identificação: {item.patientCode}</h4>
                          <p className="text-[10px] text-slate-500 font-bold uppercase">Tipo: {item.caseType} | {created}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-[11px] bg-white border border-slate-150 p-3 rounded-xl">
                        <div>
                          <span className="text-[8px] text-slate-400 pl-0.5 font-bold uppercase block leading-none mb-1">Queixa Principal</span>
                          <p className="font-semibold text-slate-705 truncate">{item.chiefComplaint}</p>
                        </div>
                        <div>
                          <span className="text-[8px] text-slate-400 pl-0.5 font-bold uppercase block leading-none mb-1">Comentários Clínica</span>
                          <p className="font-semibold text-slate-705 truncate">{item.clinicalNotes || "Sem notas."}</p>
                        </div>
                      </div>

                      {/* Approved images available for canvas drawing planner execution */}
                      {item.images && Object.keys(item.images).length > 0 && (
                        <div className="space-y-2">
                          <span className="text-[9px] font-black text-slate-400 pl-0.5 uppercase tracking-wider block">Estudo e Planejamento Geométrico</span>
                          
                          <div className="grid grid-cols-3 gap-2">
                            {Object.entries(item.images).map(([key, val]) => {
                              if (!val) return null;
                              const tags: Record<string, string> = {
                                frontal: 'Frontal',
                                profileRight: 'Perfil Dir.',
                                profileLeft: 'Perfil Esq.',
                                smile: 'Sorriso',
                                intraoral: 'Intraoral',
                                other: 'Outro'
                              };

                              return (
                                <div key={key} className="border border-slate-200 bg-white p-2 rounded-xl flex flex-col items-center justify-between text-center gap-1.5 min-h-[90px]">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-655 leading-none">{tags[key] || key}</span>
                                  <div className="w-10 h-10 rounded border border-slate-100 overflow-hidden bg-slate-50 relative shrink-0">
                                    {item.overlays?.[key] ? (
                                      <div className="relative w-full h-full">
                                        <img src={val as string} className="w-full h-full object-cover" />
                                        <img src={item.overlays[key]} className="absolute inset-0 w-full h-full object-cover z-10" />
                                      </div>
                                    ) : (
                                      <img src={val as string} className="w-full h-full object-cover" />
                                    )}
                                  </div>
                                  
                                  {item.status === 'approved' ? (
                                    <button
                                      type="button"
                                      onClick={() => setActivePlanningImage({ id: item.id, category: key, url: val as string, item })}
                                      className="w-full py-1 bg-slate-900 border border-slate-900 hover:bg-slate-850 text-white rounded text-[8px] font-black uppercase tracking-widest cursor-pointer leading-none"
                                    >
                                      Desenhar
                                    </button>
                                  ) : (
                                    <span className="text-[8px] text-slate-400 font-extrabold uppercase leading-none pb-1">Aguarde...</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Interactive professor feedback answer key if active */}
                      {item.professorFeedback && (
                        <div className="p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl space-y-1 text-xs">
                          <span className="text-[9px] text-indigo-850 font-black uppercase tracking-widest block flex items-center gap-1">
                            <MessageSquare className="w-3.5 h-3.5" /> Gabarito / Feedback do Professor
                          </span>
                          <p className="text-indigo-905 font-bold leading-normal">{item.professorFeedback}</p>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      )}

      {/* Tab 3: Smart custom educational AI walkthroughs */}
      {studentTab === 'ai_assistant' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left items-stretch">
            
            {/* Left Side: choose case to analyze */}
            <div className="lg:col-span-4 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200">
              <h3 className="text-xs font-black text-slate-850 uppercase tracking-widest mb-4 border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <BrainCircuit className="w-4 h-4 text-indigo-655" /> Selecione o Caso para IA
              </h3>

              {ownCases.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-12 text-center">Nenhum caso escolar com planejamentos faciais ativos salvos no banco para consultar.</p>
              ) : (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 text-left">
                  {ownCases.map(item => {
                    const drawsCount = Object.keys(item.drawings || {}).length;
                    const isSelected = activeAiCaseId === item.id;

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (item.status !== 'approved') {
                            alert("O caso precisa ser pré-aprovado em fotos pelo professor para permitir consultas da ELIZA AI.");
                            return;
                          }
                          runEducationalAIAnalysis(item);
                        }}
                        className={`p-4 border rounded-2xl cursor-pointer hover:bg-slate-50 transition-all ${
                          isSelected 
                            ? 'bg-slate-50 border-indigo-500 shadow-sm' 
                            : 'bg-white border-slate-100'
                        }`}
                      >
                        <span className="text-[8px] bg-slate-100 rounded p-0.5 px-2 font-black text-slate-510 uppercase inline-block mb-1">
                          {item.caseType}
                        </span>
                        <h4 className="text-xs font-black text-slate-805 uppercase truncate">{item.patientCode}</h4>
                        <div className="flex justify-between items-center text-[9px] text-slate-450 mt-2 font-bold uppercase tracking-wider">
                          <span>Planejamentos: {drawsCount} fotos</span>
                          {item.professorFeedback && <span className="text-emerald-600 font-extrabold text-[8px]">● Gabarito Pronto</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Side: Render AI walkthrough */}
            <div className="lg:col-span-8 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-855 uppercase tracking-widest mb-4 border-b border-slate-100 pb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-605" /> Feedback e Metodologia Clínica da ELIZA IA
                  </span>
                  {activeAiCaseId && (
                    <span className="text-[9px] text-slate-450 font-semibold uppercase">Caso Selecionado</span>
                  )}
                </h3>

                {isGeneratingCaseAI ? (
                  <div className="py-24 text-center space-y-4">
                    <Sparkles className="w-12 h-12 text-indigo-505 animate-spin mx-auto" />
                    <div className="space-y-1">
                      <p className="text-xs text-slate-800 font-black uppercase tracking-wider animate-pulse">ELIZA IA analisando simetrias corporais e marcações estéticas...</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest pl-1 leading-none">Mapeando riscos coronarianos clínicos de vasos faciais</p>
                    </div>
                  </div>
                ) : aiAnalysisResult ? (
                  <div className="space-y-6">
                    
                    {/* Markdown rendering with clean typography styling */}
                    <div className="prose prose-slate max-w-none text-xs text-slate-705 leading-relaxed space-y-4">
                      {aiAnalysisResult.split('\n\n').map((paragraph, idx) => {
                        if (paragraph.startsWith('###')) {
                          return <h4 key={idx} className="text-xs font-black uppercase tracking-wide text-slate-900 border-l-2 border-indigo-600 pl-2 mt-6">{paragraph.replace('###', '').trim()}</h4>;
                        }
                        if (paragraph.startsWith('**')) {
                          return <h4 key={idx} className="text-xs font-black uppercase text-indigo-705 mt-4">{paragraph.replace(/\*\*/g, '').trim()}</h4>;
                        }
                        return <p key={idx} className="font-semibold text-slate-705 text-justify">{paragraph}</p>;
                      })}
                    </div>

                    {/* Display Comparative Option alongside professor comment keys */}
                    <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5 flex-1">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-0.5 block">Auditório Pedagógico Comparativo</span>
                        <p className="text-[10.5px] font-semibold text-slate-500">Compare o relatório gerado por IA com as diretrizes do gabarito oficial.</p>
                      </div>

                      <button 
                        onClick={() => {
                          const foundCase = studentCases.find(c => c.id === activeAiCaseId);
                          if (!foundCase?.professorFeedback) {
                            alert("Seu professor responsável ainda não oficializou o gabarito deste caso.");
                            return;
                          }
                          setShowProfessorStandardCompare(!showProfessorStandardCompare);
                        }}
                        className={`px-4 py-2 text-[9.5px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer ${
                          showProfessorStandardCompare 
                            ? 'bg-emerald-600 text-white' 
                            : 'bg-slate-900 text-white hover:bg-slate-850'
                        }`}
                      >
                        {showProfessorStandardCompare ? 'Ocultar Comparação' : 'Visualizar Gabarito Lado a Lado'}
                      </button>
                    </div>

                    {showProfessorStandardCompare && (
                      <div className="p-5 bg-emerald-50/50 border border-emerald-250 rounded-3xl grid grid-cols-2 gap-4 text-xs animate-fade-in text-left">
                        <div className="space-y-2">
                          <span className="text-[9px] text-emerald-800 font-black uppercase tracking-widest block border-b border-emerald-200 pb-1.5 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" /> ELIZA IA Educacional
                          </span>
                          <p className="text-slate-700 font-semibold italic text-[11px] leading-relaxed">
                            Diagnóstico automatizado focado nas queixas clínicas em profundidade, fornecendo mapeamento cirúrgico de perigos e sequências lineares de agulhamento cosmético.
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <span className="text-[9px] text-teal-800 font-black uppercase tracking-widest block border-b border-teal-200 pb-1.5 flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5" /> Gabarito do Professor
                          </span>
                          <p className="text-teal-905 font-bold leading-relaxed text-[11.5px]">
                            "{studentCases.find(c => c.id === activeAiCaseId)?.professorFeedback}"
                          </p>
                        </div>
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="py-24 text-center text-slate-405 italic text-xs space-y-2">
                    <BrainCircuit className="w-12 h-12 text-slate-200 mx-auto" />
                    <p>Selecione um dos seus casos aprovados à esquerda para gerar o parecer e o mapeamento anatômico de HOF por IA.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Student download shortcuts bibliografies certificates */}
      {studentTab === 'library' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left items-stretch">
          
          {/* Library list */}
          <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 space-y-4">
            <h3 className="text-xs font-black text-slate-805 uppercase tracking-widest border-b border-slate-100 pb-3 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-650" /> Biblioteca de Apoio & Bibliografia Recomendada
            </h3>

            <div className="divide-y divide-slate-100 space-y-3">
              {[
                { title: 'Anatomia e Escultura Facial Orientada a HOF', file: 'PDF • 14.2 MB', author: 'Dr. Juninho Teixeira' },
                { title: 'Fios de Dermosustentação de PDO: Técnica de Vetores de Tração', file: 'PDF • 8.4 MB', author: 'Dra. Elisa Harmonização' },
                { title: 'Gabarito Clínico de Toxina Botulínica Tipo A', file: 'PDF • 5.1 MB', author: 'Cooperação Pedagógica ELIZA' }
              ].map((docItem, idx) => (
                <div key={idx} className="pt-3 flex items-center justify-between gap-4 text-xs">
                  <div className="space-y-0.5">
                    <h4 className="font-extrabold text-slate-800 uppercase tracking-tight">{docItem.title}</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{docItem.author} | {docItem.file}</p>
                  </div>

                  <button 
                    onClick={() => alert(`Iniciando download seguro de: ${docItem.title}`)}
                    className="px-3 py-1.5 bg-slate-900 text-white rounded text-[8px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all cursor-pointer inline-block shrink-0 leading-none"
                  >
                    Baixar
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Certificate download shortcut */}
          <div className="bg-slate-900 text-white p-6 rounded-[2rem] text-left flex flex-col justify-center relative overflow-hidden">
            <Award className="absolute -right-6 -bottom-6 w-24 h-24 text-slate-800/50" />
            <div className="relative space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider">Download do Certificado Escolar</h4>
              <p className="text-[10px] text-slate-400 leading-normal font-semibold mt-1">Sua credencial de conclusão fica disponível assim que o professor oficializar o encerramento do curso e validação de presença.</p>
              
              <button 
                onClick={() => {
                  if (studentCourse?.status !== 'finalizado') {
                    alert("Atenção: O curso ainda não foi finalizado pela coordenação pedagógica ou professor examinador.");
                    return;
                  }
                  if (!activeStudentObject.permDownloadCertificate) {
                    alert("O download deste certificado não foi autorizado pelo professor examinador.");
                    return;
                  }
                  alert(`Iniciou download certificado de: ${activeStudentObject.name}`);
                }}
                className="px-5 py-3 bg-teal-600 text-white rounded-xl text-[9.5px] font-black uppercase tracking-widest hover:bg-teal-700 transition-all cursor-pointer mt-4 flex items-center gap-1.5 shadow inline-flex"
              >
                <Award className="w-3.5 h-3.5 animate-bounce" /> Emitir Credencial de HOF
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
