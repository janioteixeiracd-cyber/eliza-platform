import React, { useState } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  BookOpen, 
  Layers, 
  Clock, 
  DollarSign, 
  Users, 
  Activity, 
  Image,
  AlertCircle,
  CheckCircle2,
  CalendarDays,
  FileText,
  HelpCircle,
  Check,
  ArrowLeft,
  X,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Video,
  FileDown,
  Award
} from 'lucide-react';

interface CourseManagerProps {
  courses: any[];
  onSaveCourse: (course: any) => Promise<void>;
  onDeleteCourse: (courseId: string) => Promise<void>;
  
  // Modules
  modules: any[];
  onSaveModule: (mod: any) => Promise<void>;
  onDeleteModule: (moduleId: string) => Promise<void>;

  // Procedures
  procedures: any[];
  onSaveProcedure: (proc: any) => Promise<void>;
  onDeleteProcedure: (procId: string) => Promise<void>;
  
  // Model Patients
  patients: any[];
  staff: any[];
}

export default function CourseManager({
  courses,
  onSaveCourse,
  onDeleteCourse,
  modules,
  onSaveModule,
  onDeleteModule,
  procedures,
  onSaveProcedure,
  onDeleteProcedure,
  patients,
  staff
}: CourseManagerProps) {
  
  const [selectedCourse, setSelectedCourse] = useState<any | null>(null);
  const [selectedModule, setSelectedModule] = useState<any | null>(null);
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [isModuleModalOpen, setIsModuleModalOpen] = useState(false);
  const [isProcedureModalOpen, setIsProcedureModalOpen] = useState(false);

  // Form states
  const [editingCourse, setEditingCourse] = useState<any | null>(null);
  const [editingModule, setEditingModule] = useState<any | null>(null);
  const [editingProcedure, setEditingProcedure] = useState<any | null>(null);

  // Lessons/Aulas management states
  const [isLessonModalOpen, setIsLessonModalOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<any | null>(null);
  const [lessonIndex, setLessonIndex] = useState<number | null>(null);
  const [activeModuleTab, setActiveModuleTab] = useState<'lessons' | 'objectives' | 'procedures' | 'syllabus'>('lessons');
  const [activeModalFormTab, setActiveModalFormTab] = useState<'basic' | 'curriculum' | 'ai'>('basic');

  // ELIZA IA Pedagogical Assistant states
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiSelectedPromptOption, setAiSelectedPromptOption] = useState<string>('text_improvement');
  const [aiPromptIdea, setAiPromptIdea] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const initCourseForm = (c: any = null) => {
    setEditingCourse(c ? { ...c } : {
      name: '',
      type: 'presencial',
      professorName: '',
      supportStaff: '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      durationHours: 16,
      location: '',
      maxStudents: 10,
      status: 'planejado',
      price: 1500,
      observations: ''
    });
    setIsCourseModalOpen(true);
  };

  const initModuleForm = (m: any = null) => {
    // Reset AI panel on open
    setIsAiPanelOpen(false);
    setActiveModalFormTab('basic');
    setAiResult(null);
    setAiError(null);
    setAiPromptIdea('');

    setEditingModule(m ? {
      ...m,
      summary: m.summary || '',
      description: m.description || '',
      objectives: m.objectives || '',
      workload: m.workload || m.durationHours || '',
      type: m.type || 'Teórico',
      status: m.status || 'Rascunho',
      visibleToStudents: m.visibleToStudents !== undefined ? m.visibleToStudents : true,
      lessons: m.lessons || []
    } : {
      courseId: selectedCourse?.id || '',
      name: '',
      date: new Date().toISOString().slice(0, 10),
      startTime: '08:00',
      endTime: '12:00',
      mainTopic: '',
      program: '',
      relatedProcedures: ['Toxina botulínica'],
      requiredMaterials: '',
      professorName: selectedCourse?.professorName || '',
      observations: '',
      summary: '',
      description: '',
      objectives: '',
      workload: '',
      type: 'Teórico',
      status: 'Rascunho',
      visibleToStudents: true,
      lessons: []
    });
    setIsModuleModalOpen(true);
  };

  const handleCallELIZAAI = async () => {
    if (!editingModule || (!editingModule.name && !aiPromptIdea)) {
      setAiError('Por favor, informe pelo menos o nome do módulo ou uma ideia de conteúdo para que a ELIZA possa trabalhar!');
      return;
    }

    setIsAiLoading(true);
    setAiError(null);
    setAiResult(null);

    const title = editingModule.name || "Módulo Integrado";
    const customIdea = aiPromptIdea || "";
    const existingDesc = editingModule.description || "";
    const existingMaterials = editingModule.requiredMaterials || "";

    let promptContents = "";

    if (aiSelectedPromptOption === 'text_improvement') {
      promptContents = `Você é a ELIZA IA, uma assistente pedagógica especialista em andragogia, harmonização facial e odontologia estética.
Seu objetivo é refinar e expandir os seguintes detalhes acadêmicos de um módulo:
- Nome/Título atual: "${title}"
- Descrição/Ementa atual: "${existingDesc}"
- Materiais atuais: "${existingMaterials}"
- Ideias adicionais do professor: "${customIdea}"

Refine o título para torná-lo mais técnico, elegante e acadêmico. Sugira uma ementa pedagógica rica em conceitos clínicos práticos e ordene os objetivos de aprendizagem sequencialmente.
Sua resposta deve seguir estritamente o formato abaixo, separando as seções com as tags indicadas de forma idêntica:

[TITULO]
(Título refinado)
[/TITULO]

[RESUMO]
(Um resumo de 1 ou 2 parágrafos conectando teoria e prática)
[/RESUMO]

[DESCRICAO]
(Ementa curricular completa e expandida)
[/DESCRICAO]

[OBJETIVOS]
(Lista organizada por marcadores detalhando técnicas, anatomia, e intercorrências)
[/OBJETIVOS]`;
    } else if (aiSelectedPromptOption === 'draft_from_title') {
      promptContents = `Você é a ELIZA IA, uma assistente pedagógica de HOF e odontologia clínica.
Seu objetivo é rascunhar um plano curricular estruturado apenas a partir do título do módulo.
- Título do Módulo: "${title}"
- Requisitos informativos ou foco complementar: "${customIdea}"

Gere descrição detalhada, resumo de competências e objetivos claros.
Sua resposta deve seguir estritamente o formato abaixo:

[TITULO]
(Título refinado técnico e oficial)
[/TITULO]

[RESUMO]
(Resumo curto de 3 linhas focado em segurança clínica)
[/RESUMO]

[DESCRICAO]
(Ementa curricular conceitual e prática robusta)
[/DESCRICAO]

[OBJETIVOS]
(Marcadores claros dos objetivos de competências)
[/OBJETIVOS]

[CARGA]
(Sugerir carga horária, ex: "8 horas")
[/CARGA]`;
    } else {
      // Full structure with lesson sequence!
      promptContents = `Você é a ELIZA IA, assistente andragógica mestre. Crie um módulo completo com roteiro de aulas a partir desta ideia ou título:
- Título/Tema base: "${title}"
- Ideia central proposta: "${customIdea}"

Deduza o título oficial perfeito, o resumo pedagógico, a ementa, os objetivos e gere entre 3 e 5 lições/aulas sequenciais, informando título, duração e descrição.
Sua resposta deve conter os blocos de forma estrita no formato de tags:

[TITULO]
(Título oficial refinado)
[/TITULO]

[RESUMO]
(Resumo conceitual)
[/RESUMO]

[DESCRICAO]
(Ementa completa)
[/DESCRICAO]

[OBJETIVOS]
(Objetivos pedagógicos e competências clínicas)
[/OBJETIVOS]

[CARGA]
(Carga horária sugerida, ex: "12 horas")
[/CARGA]

[AULAS]
Gere cada aula em uma linha única contendo o padrão estrito de delimitadores:
AULA: (Nome ou tema da aula) | DURACAO: (tempo, ex: 45 min) | DESCRICAO: (Resumo curricular de um parágrafo da aula)
(Mínimo 3 e máximo 5 aulas, divididas por quebra de linha. Se atente ao formato da linha: "AULA: ... | DURACAO: ... | DESCRICAO: ...")
[/AULAS]`;
    }

    try {
      const response = await fetch('/api/ai/generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-3.5-flash',
          contents: promptContents
        })
      });

      if (!response.ok) {
        throw new Error('Falha ao obter resposta do servidor da ELIZA.');
      }

      const resData = await response.json();
      const text = resData.text || '';

      const extractSection = (tag: string, source: string): string => {
        const regex = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'i');
        const match = source.match(regex);
        return match ? match[1].trim() : '';
      };

      const finalTitulo = extractSection('TITULO', text);
      const finalResumo = extractSection('RESUMO', text);
      const finalDescricao = extractSection('DESCRICAO', text);
      const finalObjetivos = extractSection('OBJETIVOS', text);
      const finalCarga = extractSection('CARGA', text);
      const rawAulasSection = extractSection('AULAS', text);

      const parsedLessons: any[] = [];
      if (rawAulasSection) {
        const lines = rawAulasSection.split('\n');
        lines.forEach(line => {
          if (line.includes('AULA:') || line.includes('AULA')) {
            const titleMatch = line.match(/AULA:\s*([^|]+)/i) || line.match(/AULA\s*([^|]+)/i);
            const durationMatch = line.match(/DURACAO:\s*([^|]+)/i) || line.match(/DURACAO\s*([^|]+)/i);
            const descMatch = line.match(/DESCRICAO:\s*(.*)/i) || line.match(/DESCRICAO\s*(.*)/i);

            if (titleMatch) {
              parsedLessons.push({
                title: titleMatch[1].trim(),
                duration: durationMatch ? durationMatch[1].trim() : '1h',
                description: descMatch ? descMatch[1].trim() : 'Delineamento e competências práticas elaborados pela ELIZA IA.',
                type: 'Vídeo',
                supportMaterial: '',
                externalLink: '',
                status: 'Publicado'
              });
            }
          }
        });
      }

      const resultPayload = {
        title: finalTitulo || title,
        summary: finalResumo,
        description: finalDescricao,
        objectives: finalObjetivos,
        workload: finalCarga || '4 horas',
        lessons: parsedLessons
      };

      setAiResult(resultPayload);
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || 'Erro de comunicação ou parsing com a inteligência artificial da ELIZA.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleApplyAiSuggestions = () => {
    if (!aiResult || !editingModule) return;
    setEditingModule({
      ...editingModule,
      name: aiResult.title || editingModule.name,
      summary: aiResult.summary || editingModule.summary,
      description: aiResult.description || editingModule.description,
      objectives: aiResult.objectives || editingModule.objectives,
      workload: aiResult.workload || editingModule.workload,
      lessons: aiResult.lessons && aiResult.lessons.length > 0 
        ? aiResult.lessons 
        : editingModule.lessons
    });
    setIsAiPanelOpen(false);
    setAiResult(null);
    setAiPromptIdea('');
  };

  const initProcedureForm = (p: any = null) => {
    setEditingProcedure(p ? { ...p } : {
      courseId: selectedCourse?.id || '',
      moduleId: selectedModule?.id || '',
      procedure: 'Toxina botulínica',
      patientId: '',
      patientName: '',
      professorName: selectedCourse?.professorName || '',
      studentName: '',
      status: 'planejado',
      materialsPredicted: '',
      clinicalNotes: '',
      beforePhoto: '',
      afterPhoto: '',
      evolutionNotes: '',
      complications: ''
    });
    setIsProcedureModalOpen(true);
  };

  const handleSaveCourseForm = async () => {
    if (!editingCourse.name) return;
    await onSaveCourse(editingCourse);
    setIsCourseModalOpen(false);
    setEditingCourse(null);
  };

  const handleSaveModuleForm = async () => {
    if (!editingModule.name) return;
    const payload = {
      ...editingModule,
      relatedProcedures: Array.isArray(editingModule.relatedProcedures) 
        ? editingModule.relatedProcedures 
        : String(editingModule.relatedProcedures).split(',').map(v => v.trim())
    };
    await onSaveModule(payload);
    if (selectedModule && selectedModule.id === payload.id) {
      setSelectedModule(payload);
    }
    setIsModuleModalOpen(false);
    setEditingModule(null);
  };

  const handleReorderModules = async (direction: 'up' | 'down', currentIndex: number) => {
    const sorted = [...filteredModules].sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 999;
      const orderB = b.order !== undefined ? b.order : 999;
      return orderA - orderB;
    });

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;

    const currentModule = sorted[currentIndex];
    const targetModule = sorted[targetIndex];

    const currentOrder = currentModule.order !== undefined ? currentModule.order : currentIndex;
    const targetOrder = targetModule.order !== undefined ? targetModule.order : targetIndex;

    await onSaveModule({ ...currentModule, order: targetOrder });
    await onSaveModule({ ...targetModule, order: currentOrder });
    
    // If the currently selected module is one of these, update its selectedModule reference locally as well
    if (selectedModule && (selectedModule.id === currentModule.id || selectedModule.id === targetModule.id)) {
      if (selectedModule.id === currentModule.id) {
        setSelectedModule({ ...currentModule, order: targetOrder });
      } else {
        setSelectedModule({ ...targetModule, order: currentOrder });
      }
    }
  };

  const handleReorderLesson = async (direction: 'up' | 'down', index: number) => {
    if (!selectedModule) return;
    const currentLessons = selectedModule.lessons ? [...selectedModule.lessons] : [];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= currentLessons.length) return;
    
    // Swap elements
    const temp = currentLessons[index];
    currentLessons[index] = currentLessons[target];
    currentLessons[target] = temp;
    
    const updatedModule = {
      ...selectedModule,
      lessons: currentLessons
    };
    await onSaveModule(updatedModule);
    setSelectedModule(updatedModule);
  };

  const handleDeleteLesson = async (index: number) => {
    if (!selectedModule || !confirm('Deseja realmente excluir esta aula?')) return;
    const currentLessons = selectedModule.lessons ? [...selectedModule.lessons] : [];
    currentLessons.splice(index, 1);
    
    const updatedModule = {
      ...selectedModule,
      lessons: currentLessons
    };
    await onSaveModule(updatedModule);
    setSelectedModule(updatedModule);
  };

  const handleSaveLessonModal = async () => {
    if (!selectedModule || !editingLesson || !editingLesson.title) return;
    
    const currentLessons = selectedModule.lessons ? [...selectedModule.lessons] : [];
    if (lessonIndex !== null) {
      currentLessons[lessonIndex] = { ...editingLesson };
    } else {
      currentLessons.push({
        ...editingLesson,
        id: Math.random().toString(36).substring(2, 9)
      });
    }
    
    const updatedModule = {
      ...selectedModule,
      lessons: currentLessons
    };
    await onSaveModule(updatedModule);
    setSelectedModule(updatedModule);
    setIsLessonModalOpen(false);
    setEditingLesson(null);
    setLessonIndex(null);
  };

  const handleSaveProcedureForm = async () => {
    if (!editingProcedure.procedure) return;
    
    // Look up patientName if patientId is provided
    let pName = editingProcedure.patientName;
    if (editingProcedure.patientId) {
      const selectedPat = patients.find(pat => pat.id === editingProcedure.patientId);
      if (selectedPat) {
        pName = selectedPat.name;
      }
    }

    await onSaveProcedure({
      ...editingProcedure,
      patientName: pName,
      materialsPredicted: Array.isArray(editingProcedure.materialsPredicted)
        ? editingProcedure.materialsPredicted
        : String(editingProcedure.materialsPredicted).split(',').map(v => v.trim())
    });
    setIsProcedureModalOpen(false);
    setEditingProcedure(null);
  };

  // Filter objects
  const filteredModules = modules.filter(m => m.courseId === selectedCourse?.id);
  const filteredProcedures = procedures.filter(p => p.moduleId === selectedModule?.id);

  return (
    <div className="space-y-6">
      
      {/* If looking at details inside a course */}
      {selectedCourse ? (
        <div className="space-y-6">
          
          {/* Header Bar */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
            <div>
              <button 
                onClick={() => {
                  setSelectedCourse(null);
                  setSelectedModule(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-bold uppercase tracking-widest cursor-pointer mb-2"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar aos Cursos
              </button>
              <div className="flex items-center gap-3">
                <span className="p-1 px-2 pb-0.5 text-[9px] bg-teal-50 border border-teal-100 text-teal-700 rounded-md font-bold uppercase">
                  {selectedCourse.type}
                </span>
                <span className="text-[10px] text-slate-400 font-bold uppercase">{selectedCourse.startDate} a {selectedCourse.endDate}</span>
              </div>
              <h2 className="text-xl font-black text-slate-800 uppercase mt-1">{selectedCourse.name}</h2>
              <p className="text-xs text-slate-400 mt-1">Carga Horária: <span className="font-bold text-slate-655">{selectedCourse.durationHours} hrs</span> | Professor Responsável: <span className="font-bold text-slate-700">{selectedCourse.professorName}</span></p>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => initCourseForm(selectedCourse)}
                className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-600 border border-slate-200 transition-all cursor-pointer"
                title="Editar Curso"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Split A: Module selection list */}
            <div className="lg:col-span-5 bg-white p-6 rounded-[2rem] border border-slate-200 text-left">
              <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-teal-600" /> MÓDULOS DO CURSO
                </h3>
                <button 
                  onClick={() => initModuleForm()}
                  className="p-1.5 bg-teal-600 text-white hover:bg-teal-700 rounded-lg text-xs font-bold uppercase tracking-tight flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Módulo
                </button>
              </div>

              {filteredModules.length === 0 ? (
                <div className="py-12 text-center text-slate-400 italic text-xs">
                  Nenhum módulo criado para este curso. Comece adicionando um!
                </div>
              ) : (
                <div className="space-y-3.5">
                  {[...filteredModules]
                    .sort((a, b) => {
                      const orderA = a.order !== undefined ? a.order : 999;
                      const orderB = b.order !== undefined ? b.order : 999;
                      return orderA - orderB;
                    })
                    .map((m, index, arr) => {
                      const isFirst = index === 0;
                      const isLast = index === arr.length - 1;
                      return (
                        <div 
                          key={m.id}
                          onClick={() => setSelectedModule(m)}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer text-left flex items-start gap-2.5 ${
                            selectedModule?.id === m.id 
                              ? 'border-teal-200 bg-teal-50/10 shadow-xs' 
                              : 'border-slate-150 hover:bg-slate-50'
                          }`}
                        >
                          {/* Reordering Controls */}
                          <div className="flex flex-col items-center justify-center gap-0.5 border-r pr-2 border-slate-150 shrink-0">
                            <button 
                              disabled={isFirst}
                              onClick={(e) => { e.stopPropagation(); handleReorderModules('up', index); }}
                              className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-100 rounded disabled:opacity-20 transition-all cursor-pointer"
                              title="Subir Módulo"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              disabled={isLast}
                              onClick={(e) => { e.stopPropagation(); handleReorderModules('down', index); }}
                              className="p-1 text-slate-400 hover:text-teal-600 hover:bg-slate-100 rounded disabled:opacity-20 transition-all cursor-pointer"
                              title="Descer Módulo"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-1">
                              <span className="text-[9px] font-black uppercase text-slate-450 flex items-center gap-1.5">
                                {m.status === 'Publicado' ? (
                                  <span className="flex items-center gap-0.5 text-teal-600">
                                    <Eye className="w-2.5 h-2.5" /> Publicado
                                  </span>
                                ) : m.status === 'Oculto' ? (
                                  <span className="flex items-center gap-0.5 text-slate-400">
                                    <EyeOff className="w-2.5 h-2.5" /> Oculto
                                  </span>
                                ) : (
                                  <span className="text-amber-500 shrink-0">Rascunho</span>
                                )}
                                <span className="text-slate-300">•</span>
                                <span>MÓDULO {index + 1}</span>
                              </span>
                              <div className="flex gap-1 flex-shrink-0">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); initModuleForm(m); }}
                                  className="p-1 text-slate-600 hover:bg-slate-100 rounded-md transition-all cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); if (confirm('Excluir módulo?')) onDeleteModule(m.id); }}
                                  className="p-1 text-rose-500 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            
                            <h4 className="text-xs font-black text-slate-800 uppercase mt-1.5 leading-snug line-clamp-2">{m.name}</h4>
                            <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase flex items-center gap-1">📅 {m.date} | ⏰ {m.startTime}-{m.endTime}</p>
                            {m.summary && <p className="text-[9.5px] text-slate-455 line-clamp-1 mt-1 font-semibold italic">"{m.summary}"</p>}
                            {m.lessons && m.lessons.length > 0 && (
                              <span className="inline-block mt-2 text-[8px] bg-slate-100 text-slate-600 font-extrabold px-1.5 py-0.5 rounded tracking-wide uppercase">
                                {m.lessons.length} {m.lessons.length === 1 ? 'Aula' : 'Aulas'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Split B: Selected Module Details & Curriculum Grade */}
            <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 text-left flex flex-col min-h-[500px]">
              {selectedModule ? (
                <div className="space-y-6 flex-1 flex flex-col">
                  
                  {/* Module Details Header */}
                  <div className="border-b border-slate-100 pb-4 shrink-0">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <span className="text-[9px] font-black text-teal-600 uppercase tracking-widest block mb-1">
                          Gestão de Conteúdo • MÓDULO {selectedModule.type || "Geral"}
                        </span>
                        <h3 className="text-md font-black text-slate-805 uppercase leading-snug">{selectedModule.name}</h3>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase inline-block ${
                        selectedModule.status === 'Publicado' ? 'bg-teal-50 text-teal-700 border border-teal-100' :
                        selectedModule.status === 'Oculto' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-800 border border-amber-100'
                      }`}>
                        {selectedModule.status || 'Rascunho'}
                      </span>
                    </div>

                    {selectedModule.summary && (
                      <p className="text-xs text-slate-500 font-medium italic mt-2">
                        "{selectedModule.summary}"
                      </p>
                    )}
                  </div>

                  {/* Sub-Tabs Bar */}
                  <div className="flex border-b border-slate-100 p-0.5 bg-slate-50 rounded-xl shrink-0">
                    {[
                      { id: 'lessons', label: 'Grade de Aulas', count: selectedModule.lessons?.length || 0 },
                      { id: 'objectives', label: 'Ementa & Foco' },
                      { id: 'procedures', label: 'Prática Clínica', count: filteredProcedures.length },
                      { id: 'syllabus', label: 'Dados Gerais' }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveModuleTab(tab.id as any)}
                        className={`flex-1 py-1.5 text-center rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                          activeModuleTab === tab.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-400 hover:text-slate-700'
                        }`}
                      >
                        {tab.label} {tab.count !== undefined && tab.count > 0 ? `(${tab.count})` : ''}
                      </button>
                    ))}
                  </div>

                  {/* Tab Body Content */}
                  <div className="flex-1 overflow-y-auto">
                    
                    {/* 1. LESSONS / AULAS TAB */}
                    {activeModuleTab === 'lessons' && (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5 font-sans">
                            <BookOpen className="w-4 h-4 text-teal-600" /> Aulas Planejadas
                          </h4>
                          <button 
                            onClick={() => {
                              setEditingLesson({
                                title: '',
                                description: '',
                                type: 'Vídeo',
                                duration: '45 min',
                                supportMaterial: '',
                                externalLink: '',
                                status: 'Publicado'
                              });
                              setLessonIndex(null);
                              setIsLessonModalOpen(true);
                            }}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white pb-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar Aula
                          </button>
                        </div>

                        {(!selectedModule.lessons || selectedModule.lessons.length === 0) ? (
                          <div className="py-12 border border-dashed border-slate-200 rounded-2xl text-center text-slate-400 italic text-xs">
                            Nenhuma aula cadastrada para este módulo ainda. Adicione a primeira acima!
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {selectedModule.lessons.map((lesson: any, idx: number) => {
                              const isFirstL = idx === 0;
                              const isLastL = idx === selectedModule.lessons.length - 1;
                              return (
                                <div key={lesson.id || idx} className="p-4 bg-slate-50/50 border border-slate-200 rounded-2xl flex items-start gap-3 relative hover:bg-slate-50 transition-all">
                                  
                                  {/* Lesson Reorder Control Keys */}
                                  <div className="flex flex-col items-center justify-center gap-0.5 shrink-0 self-center border-r pr-2 border-slate-200">
                                    <button 
                                      disabled={isFirstL}
                                      onClick={() => handleReorderLesson('up', idx)}
                                      className="p-1 text-slate-400 hover:text-teal-600 disabled:opacity-20 transition-all cursor-pointer bg-transparent border-none"
                                      title="Subir Aula"
                                    >
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      disabled={isLastL}
                                      onClick={() => handleReorderLesson('down', idx)}
                                      className="p-1 text-slate-400 hover:text-teal-600 disabled:opacity-20 transition-all cursor-pointer bg-transparent border-none"
                                      title="Descer Aula"
                                    >
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  {/* Lesson details info */}
                                  <div className="flex-1 min-w-0 text-left">
                                    <div className="flex justify-between items-start gap-2">
                                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">
                                        Aula {idx + 1} • {lesson.type || "Vídeo"}
                                      </span>
                                      <div className="flex gap-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[7.5px] font-black uppercase ${
                                          lesson.status === 'Publicado' ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'
                                        }`}>
                                          {lesson.status || 'Publicado'}
                                        </span>
                                      </div>
                                    </div>

                                    <h5 className="text-xs font-black text-slate-805 uppercase mt-1 leading-snug">{lesson.title}</h5>
                                    
                                    {lesson.description && (
                                      <p className="text-[10.5px] text-slate-500 font-medium mt-1 leading-relaxed">
                                        {lesson.description}
                                      </p>
                                    )}

                                    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-dashed border-slate-200 text-[9.5px] text-slate-400 font-bold">
                                      {lesson.duration && (
                                        <span>⏰ Duração: <span className="text-slate-600">{lesson.duration}</span></span>
                                      )}
                                      {lesson.supportMaterial && (
                                        <span className="truncate max-w-[200px]">📂 Anexos: <span className="text-slate-600">{lesson.supportMaterial}</span></span>
                                      )}
                                      {lesson.externalLink && (
                                        <span className="text-teal-600 font-medium truncate max-w-[150px]">
                                          🔗 Link: {lesson.externalLink}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Edit/Delete action triggers */}
                                  <div className="flex flex-col gap-1 shrink-0 self-start">
                                    <button 
                                      onClick={() => {
                                        setEditingLesson({ ...lesson });
                                        setLessonIndex(idx);
                                        setIsLessonModalOpen(true);
                                      }}
                                      className="p-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg cursor-pointer"
                                      title="Editar Aula"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteLesson(idx)}
                                      className="p-1 bg-white border border-slate-200 hover:bg-rose-50 text-rose-500 hover:border-rose-200 rounded-lg cursor-pointer animate-none"
                                      title="Excluir Aula"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>

                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 2. OBJECTIVES & SYLLABUS TAB */}
                    {activeModuleTab === 'objectives' && (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest font-sans">Ementa Curricular</h4>
                          <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl text-xs font-medium text-slate-705 leading-relaxed min-h-[100px] whitespace-pre-line text-left">
                            {selectedModule.description || selectedModule.program || "Ementa oficial e cronograma conceitual não preenchidos para este módulo clínico."}
                          </div>
                        </div>

                        <div className="space-y-1 pt-2">
                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1 font-sans">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Objetivos de Aprendizagem
                          </h4>
                          <div className="p-4 bg-emerald-50/10 border border-emerald-100 rounded-2xl text-xs font-medium text-slate-705 leading-relaxed whitespace-pre-line text-left">
                            {selectedModule.objectives || "Objetivos de andragogia e competências técnicas ainda não descritos para este módulo."}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3. PRACTICAL PROCEDURES TAB */}
                    {activeModuleTab === 'procedures' && (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black text-slate-805 uppercase tracking-widest flex items-center gap-1.5 font-sans">
                            <Activity className="w-4 h-4 text-emerald-500" /> Prática Clínica Planejada
                          </h4>
                          <button 
                            onClick={() => initProcedureForm()}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white pb-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar Prática
                          </button>
                        </div>

                        {filteredProcedures.length === 0 ? (
                          <div className="py-12 border border-dashed border-slate-200 rounded-2xl text-center text-slate-400 italic text-xs">
                            Nenhum atendimento clínico/procedimento agendado para este módulo.
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {filteredProcedures.map(proc => (
                              <div key={proc.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/30 text-left relative overflow-hidden">
                                
                                <div className="absolute right-4 top-4 flex gap-1.5">
                                  <button 
                                    onClick={() => initProcedureForm(proc)}
                                    className="p-1.5 px-2.5 text-[9px] font-extrabold uppercase border border-slate-200 bg-white rounded-lg hover:bg-slate-50 text-slate-600"
                                  >
                                    Editar
                                  </button>
                                  <button 
                                    onClick={() => { if (confirm('Excluir procedimento?')) onDeleteProcedure(proc.id); }}
                                    className="p-1 px-1.5 text-rose-500 hover:bg-rose-50 border border-transparent rounded hover:border-rose-100"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <span className={`px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase inline-block ${
                                  proc.status === 'realizado' ? 'bg-emerald-50 text-emerald-800' :
                                  proc.status === 'confirmado' ? 'bg-sky-50 text-sky-850' :
                                  proc.status === 'em_execução' ? 'bg-amber-100 text-amber-900 font-bold animate-pulse' :
                                  proc.status === 'cancelado' ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {proc.status}
                                </span>

                                <h4 className="text-xs font-black text-slate-805 uppercase mt-2 pr-20">{proc.procedure}</h4>
                                
                                <p className="text-[10px] text-slate-500 mt-1 font-bold">
                                  Paciente-Modelo: <span className="text-teal-600 font-black uppercase text-[10.5px]">{proc.patientName || "Não vinculado"}</span>
                                </p>

                                <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-dashed border-slate-200 text-[9px] text-slate-400 font-bold uppercase">
                                  <div>
                                    <p>RESPONSÁVEL</p>
                                    <p className="text-slate-700 mt-0.5">{proc.professorName || "Dr Resposta"}</p>
                                  </div>
                                  <div>
                                    <p>ALUNO EXECUTOR / OBSERVADOR</p>
                                    <p className="text-slate-700 mt-0.5">{proc.studentName || "Equipe / Sem designação"}</p>
                                  </div>
                                </div>

                                {(proc.evolutionNotes || proc.clinicalNotes) && (
                                  <div className="mt-3 p-3 rounded-lg bg-white border border-slate-150 text-[10px] font-medium text-slate-600 leading-relaxed">
                                    {proc.clinicalNotes && <p><span className="font-bold text-slate-700">Planejamento:</span> {proc.clinicalNotes}</p>}
                                    {proc.evolutionNotes && <p className="mt-1"><span className="font-bold text-slate-700">Evolução:</span> {proc.evolutionNotes}</p>}
                                    {proc.complications && <p className="mt-1 font-bold text-rose-600">⚠️ Intercorrências: {proc.complications}</p>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 4. GENERAL DETAILS TAB */}
                    {activeModuleTab === 'syllabus' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-xs font-medium text-slate-700">
                          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 space-y-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Data do Módulo</span>
                            <p className="text-slate-800 font-black text-xs uppercase">{selectedModule.date || "Não informada"}</p>
                          </div>
                          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 space-y-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Horário Previsto</span>
                            <p className="text-slate-800 font-black text-xs uppercase">{selectedModule.startTime || "00:00"} às {selectedModule.endTime || "00:00"}</p>
                          </div>
                          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 space-y-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Carga Horária</span>
                            <p className="text-slate-800 font-black text-xs uppercase">{selectedModule.workload || "4 horas"}</p>
                          </div>
                          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 space-y-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Professor Ministrante</span>
                            <p className="text-slate-800 font-black text-xs uppercase">{selectedModule.professorName || "Não designado"}</p>
                          </div>
                        </div>

                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 text-xs text-slate-700 space-y-1">
                          <span className="text-[9px] font-bold text-slate-400 uppercase block pl-0.5 mb-1">Materiais Necessários Gerais</span>
                          <p className="bg-white p-3 border border-slate-200 rounded-xl font-semibold text-slate-850">
                            {selectedModule.requiredMaterials || "Nenhum material listado como compulsório."}
                          </p>
                        </div>

                        {selectedModule.observations && (
                          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150 text-xs text-slate-700 space-y-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block pl-0.5 mb-1">Observações de Logística</span>
                            <p className="bg-white p-3 border border-slate-200 rounded-xl text-slate-650 leading-relaxed font-semibold">
                              {selectedModule.observations}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col justify-center items-center text-slate-400 py-16 flex-1 text-center font-sans">
                  <Layers className="w-10 h-10 text-slate-200 mb-2" />
                  <p className="text-xs italic">Selecione um módulo do painel esquerdo para visualizar as aulas, ementas e objetivos pedagógicos do programa.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Main Title Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Cursos & Turmas Cadastradas</h2>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Painel Geral de Gerenciamento de Programas</p>
            </div>
            
            <button 
              onClick={() => initCourseForm()}
              className="px-5 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 flex items-center gap-2 cursor-pointer shadow-md select-none mt-1 sm:mt-0"
            >
              <Plus className="w-4 h-4" /> Novo Curso
            </button>
          </div>

          {/* Courses Grid */}
          {courses.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-[2rem] border border-slate-200 text-slate-400 italic text-xs">
              Nenhum curso ou turma planejado no momento. Comece cadastrando o primeiro!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map(course => {
                const courseModsCount = modules.filter(m => m.courseId === course.id).length;
                const courseProcsCount = procedures.filter(p => p.courseId === course.id).length;

                return (
                  <div key={course.id} className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
                    <div className="p-6 sm:p-7 text-left space-y-4">
                      
                      {/* Top Row status */}
                      <div className="flex justify-between items-center">
                        <span className="p-1 px-2 text-[8px] bg-slate-100 font-bold text-slate-655 border border-slate-200 rounded uppercase">
                          {course.type}
                        </span>
                        
                        <span className={`text-[9.5px] font-black uppercase flex items-center gap-1 px-2.5 py-0.5 rounded-full ${
                          course.status === 'em_andamento' ? 'bg-emerald-50 text-emerald-800' :
                          course.status === 'planejado' ? 'bg-amber-50 text-amber-800' :
                          course.status === 'finalizado' ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-800'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            course.status === 'em_andamento' ? 'bg-emerald-500 animate-pulse' :
                            course.status === 'planejado' ? 'bg-amber-500' :
                            course.status === 'finalizado' ? 'bg-slate-400' : 'bg-rose-500'
                          }`} />
                          {course.status}
                        </span>
                      </div>

                      {/* Course Identity */}
                      <div className="space-y-1">
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight line-clamp-2 min-h-[40px] leading-snug">
                          {course.name}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">📅 {course.startDate} a {course.endDate}</p>
                      </div>

                      {/* Core features block */}
                      <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-50 text-center text-[10.5px]">
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Aulas/Módulos</p>
                          <p className="text-xs font-black text-slate-700 mt-1">{courseModsCount}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Carga H.</p>
                          <p className="text-xs font-black text-slate-700 mt-1">{course.durationHours}h</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Alunos Max</p>
                          <p className="text-xs font-black text-slate-700 mt-1">{course.maxStudents}</p>
                        </div>
                      </div>

                      {/* Teacher details snippet */}
                      <div className="text-[11px] text-slate-500">
                        <p className="font-bold">Professor: <span className="text-slate-800 font-bold">{course.professorName || "Não definido"}</span></p>
                        {course.price > 0 && <p className="font-bold text-slate-655 mt-1">Investimento: <span className="text-teal-655 font-black">R$ {parseFloat(course.price as any).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></p>}
                      </div>
                    </div>

                    {/* Bottom action controls */}
                    <div className="bg-slate-50 p-4 px-6 border-t border-slate-100 flex justify-between gap-2">
                      <button 
                        onClick={() => setSelectedCourse(course)}
                        className="flex-1 py-2.5 bg-white border border-slate-200 text-teal-700 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-teal-50 hover:border-teal-200 transition-all cursor-pointer"
                      >
                        Grade & Aulas
                      </button>
                      <button 
                        onClick={() => { if(confirm('Excluir este curso e doações de módulo associadas?')) onDeleteCourse(course.id); }}
                        className="p-2.5 hover:bg-rose-50 text-rose-500 rounded-xl border border-transparent hover:border-rose-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────── */}
      {/* 1. Modal: CADASTRO / EDIÇÃO DE CURSO */}
      {isCourseModalOpen && editingCourse && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-teal-600" />
                {editingCourse.id ? 'Editar Informações do Curso' : 'Cadastrar Novo Curso'}
              </h3>
              <button onClick={() => { setIsCourseModalOpen(false); setEditingCourse(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Nome do Curso</label>
                <input 
                  type="text"
                  value={editingCourse.name}
                  onChange={(e) => setEditingCourse({...editingCourse, name: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  placeholder="Ex: Rinomodelação Estruturada Avançada"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Tipo do Curso</label>
                  <select 
                    value={editingCourse.type}
                    onChange={(e) => setEditingCourse({...editingCourse, type: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="presencial">Curso Presencial</option>
                    <option value="online">Curso Online</option>
                    <option value="mentoria">Mentoria</option>
                    <option value="residência">Mini-Residência</option>
                    <option value="imersão">Imersão</option>
                    <option value="especialização">Especialização</option>
                    <option value="workshop">Workshop</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Carga Horária (horas)</label>
                  <input 
                    type="number"
                    value={editingCourse.durationHours}
                    onChange={(e) => setEditingCourse({...editingCourse, durationHours: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Professor Responsável</label>
                <input 
                  type="text"
                  value={editingCourse.professorName}
                  onChange={(e) => setEditingCourse({...editingCourse, professorName: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  placeholder="Ex: Dr. Juninho Teixeira"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Data de Início</label>
                  <input 
                    type="date"
                    value={editingCourse.startDate}
                    onChange={(e) => setEditingCourse({...editingCourse, startDate: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Data de Término</label>
                  <input 
                    type="date"
                    value={editingCourse.endDate}
                    onChange={(e) => setEditingCourse({...editingCourse, endDate: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 col-span-2">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Local / Sala</label>
                  <input 
                    type="text"
                    value={editingCourse.location}
                    onChange={(e) => setEditingCourse({...editingCourse, location: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    placeholder="Ex: Auditório B ou Online"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Valor Curso (R$)</label>
                  <input 
                    type="number"
                    value={editingCourse.price}
                    onChange={(e) => setEditingCourse({...editingCourse, price: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Máximo de Alunos</label>
                  <input 
                    type="number"
                    value={editingCourse.maxStudents}
                    onChange={(e) => setEditingCourse({...editingCourse, maxStudents: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Status Geral</label>
                  <select 
                    value={editingCourse.status}
                    onChange={(e) => setEditingCourse({...editingCourse, status: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="planejado">Planejado</option>
                    <option value="em_andamento">Em Andamento</option>
                    <option value="finalizado">Finalizado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Observações Adicionais</label>
                <textarea 
                  value={editingCourse.observations}
                  onChange={(e) => setEditingCourse({...editingCourse, observations: e.target.value})}
                  rows={2}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                  placeholder="Instruções sobre vestimenta, materiais de estudos recomendados, etc."
                />
              </div>
            </div>

            <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={() => { setIsCourseModalOpen(false); setEditingCourse(null); }}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveCourseForm}
                className="flex-1 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
              >
                Salvar Curso
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 2. Modal: CADASTRO / EDIÇÃO DE MÓDULO */}
      {isModuleModalOpen && editingModule && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
                <Layers className="w-5 h-5 text-teal-600" />
                {editingModule.id ? 'Editar Detalhes do Módulo' : 'Adicionar Módulo / Aula'}
              </h3>
              <button onClick={() => { setIsModuleModalOpen(false); setEditingModule(null); }} className="text-slate-400 hover:text-slate-600 border-none bg-transparent">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="flex border-b border-slate-100 p-0.5 bg-slate-50 shrink-0">
              {[
                { id: 'basic', label: 'Básico' },
                { id: 'curriculum', label: 'Ementa & Foco' },
                { id: 'ai', label: '💡 ELIZA IA Assist' }
              ].map(tab => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveModalFormTab(tab.id as any)}
                  className={`flex-1 py-2 text-center rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                    activeModalFormTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 custom-scrollbar">
              {/* TAB 1: BASIC DADOS GERAIS */}
              {activeModalFormTab === 'basic' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Nome do Módulo / Título da Aula</label>
                    <input 
                      type="text"
                      value={editingModule.name}
                      onChange={(e) => setEditingModule({...editingModule, name: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none font-sans"
                      placeholder="Ex: Anatomia Nasal Aplicada e Zoneamento Facial"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1 col-span-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Data da Aula</label>
                      <input 
                        type="date"
                        value={editingModule.date}
                        onChange={(e) => setEditingModule({...editingModule, date: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Início</label>
                      <input 
                        type="time"
                        value={editingModule.startTime}
                        onChange={(e) => setEditingModule({...editingModule, startTime: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Fim</label>
                      <input 
                        type="time"
                        value={editingModule.endTime}
                        onChange={(e) => setEditingModule({...editingModule, endTime: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Professor Ministrante</label>
                      <input 
                        type="text"
                        value={editingModule.professorName}
                        onChange={(e) => setEditingModule({...editingModule, professorName: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Tipo do Módulo</label>
                      <select 
                        value={editingModule.type || 'Teórico'}
                        onChange={(e) => setEditingModule({...editingModule, type: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none font-sans"
                      >
                        <option value="Teórico">Teórico</option>
                        <option value="Teórico-Prático">Teórico-Prático</option>
                        <option value="Prática de Atendimento">Prática Clínica</option>
                        <option value="Workshop Reduzido">Workshop Reduzido</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Tema Principal da Aula</label>
                    <input 
                      type="text"
                      value={editingModule.mainTopic}
                      onChange={(e) => setEditingModule({...editingModule, mainTopic: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      placeholder="Ex: Estruturação nasal com ácido hialurônico"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-150">
                    <div className="space-y-0.5 text-left">
                      <span className="text-[9.5px] font-black text-slate-905 uppercase">Listar na Grade do Aluno</span>
                      <p className="text-[8.5px] text-slate-400 font-bold leading-normal">Módulos com visibilidade ativa ficam acessíveis para as aulas do estudante.</p>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setEditingModule({ ...editingModule, visibleToStudents: !editingModule.visibleToStudents })}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        editingModule.visibleToStudents !== false ? 'bg-teal-600' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        editingModule.visibleToStudents !== false ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: CURRICULUM EMENTA & OBJETIVOS */}
              {activeModalFormTab === 'curriculum' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Status do Módulo</label>
                      <select 
                        value={editingModule.status || 'Rascunho'}
                        onChange={(e) => setEditingModule({...editingModule, status: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      >
                        <option value="Rascunho">🟡 Rascunho</option>
                        <option value="Publicado">🟢 Publicado</option>
                        <option value="Oculto">🔴 Oculto</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Carga Horária Estimada</label>
                      <input 
                        type="text"
                        value={editingModule.workload}
                        onChange={(e) => setEditingModule({...editingModule, workload: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                        placeholder="Ex: 8 horas acadêmicas"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Resumo Breve / Destaque</label>
                    <input 
                      type="text"
                      value={editingModule.summary || ''}
                      onChange={(e) => setEditingModule({...editingModule, summary: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      placeholder="Ex: Introdução à volumização com ênfase em anatomia facial prática."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Ementa Curricular Detalhada (Descrição)</label>
                    <textarea 
                      value={editingModule.description || ''}
                      onChange={(e) => setEditingModule({...editingModule, description: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none font-sans"
                      placeholder="Cronograma estruturado, conceitos teóricos, técnicas abordadas..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Objetivos de Competência & Aprendizagem</label>
                    <textarea 
                      value={editingModule.objectives || ''}
                      onChange={(e) => setEditingModule({...editingModule, objectives: e.target.value})}
                      rows={2}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none font-sans"
                      placeholder="Ex: - Dominar o zoneamento tri-estratégico nasal.&#10;- Saber contornar intercorrência com hialuronidase."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Materiais de Apoio Necessários</label>
                    <input 
                      type="text"
                      value={editingModule.requiredMaterials}
                      onChange={(e) => setEditingModule({...editingModule, requiredMaterials: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                      placeholder="Ex: Seringas, Cânulas 22G, Luvas estéreis"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Observações de Logística</label>
                    <textarea 
                      value={editingModule.observations}
                      onChange={(e) => setEditingModule({...editingModule, observations: e.target.value})}
                      rows={2}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none font-sans"
                      placeholder="Instruções de logística, vestimenta, equipamentos extras..."
                    />
                  </div>
                </div>
              )}

              {/* TAB 3: ELIZA IA PEDAGOGICAL TOOL */}
              {activeModalFormTab === 'ai' && (
                <div className="space-y-4">
                  <div className="p-4 bg-teal-50/10 rounded-2xl border border-teal-100 flex gap-3 text-left">
                    <Sparkles className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-[10px] font-black text-teal-700 uppercase tracking-widest pl-0.5">ELIZA IA Assistant Andragógico</h4>
                      <p className="text-[9.5px] text-[#a1a1aa] font-bold leading-relaxed mt-1">
                        Utilize a inteligência artificial generativa da ELIZA para lapidar o linguajar técnico do módulo, listar objetivos de andragogia ou planejar o roteiro de sub-aulas sequenciais recomendadas.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-left">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Qual operação deseja executar?</label>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: 'text_improvement', label: '🪄 Refinar & Expandir Título e Ementa', desc: 'Melhora o vocabulário técnico e preenche objetivos clínicos de segurança.' },
                        { id: 'draft_from_title', label: '📝 Rascunhar Ementa Inteira pelo Título', desc: 'Estrutura descrição, objetivos de competência e carga horária a partir do nome do módulo.' },
                        { id: 'full_draft_sequence', label: '🎓 Desenhar Ementa Completa + Sequência de sub-aulas', desc: 'Gera ementa idealizada e monta de 3 a 5 sub-aulas integradas com tempo e tema definido.' }
                      ].map(opt => (
                        <label 
                          key={opt.id} 
                          onClick={() => setAiSelectedPromptOption(opt.id)}
                          className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-0.5 ${
                            aiSelectedPromptOption === opt.id 
                              ? 'border-teal-500 bg-teal-50/20' 
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-[10px] font-black text-slate-805 uppercase">{opt.label}</span>
                          <span className="text-[8.5px] text-slate-450 font-bold leading-tight">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Instruções ou Foco Complementar (Opcional)</label>
                    <textarea 
                      value={aiPromptIdea}
                      onChange={(e) => setAiPromptIdea(e.target.value)}
                      rows={2}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none font-sans"
                      placeholder="Ex: Focar e insistir em anatomia vascular nasal palpável e zoneamento de segurança anti-necrose..."
                    />
                  </div>

                  {aiError && (
                    <div className="p-3 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[10.5px] font-bold text-left">
                      ❌ {aiError}
                    </div>
                  )}

                  {/* AI Output Result Box */}
                  {aiResult && (
                    <div className="p-4 bg-teal-50/10 rounded-2xl border border-teal-150 space-y-3.5 text-left text-xs max-h-[180px] overflow-y-auto custom-scrollbar">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-teal-600 text-white text-[8px] font-black uppercase tracking-wider">RECOMENDAÇÃO DA ELIZA IA</span>
                      <div>
                        <p className="text-[9px] text-[#a1a1aa] font-black uppercase">Título Recomendado</p>
                        <p className="text-slate-800 font-black uppercase text-xs mt-0.5">{aiResult.title}</p>
                      </div>
                      {aiResult.summary && (
                        <div>
                          <p className="text-[9px] text-[#a1a1aa] font-black uppercase">Resumo Curricular Curto</p>
                          <p className="text-slate-700 font-semibold italic mt-0.5">"{aiResult.summary}"</p>
                        </div>
                      )}
                      {aiResult.description && (
                        <div>
                          <p className="text-[9px] text-[#a1a1aa] font-black uppercase">Ementa Proposta</p>
                          <p className="text-slate-600 font-medium whitespace-pre-line mt-0.5">{aiResult.description}</p>
                        </div>
                      )}
                      {aiResult.objectives && (
                        <div>
                          <p className="text-[9px] text-[#a1a1aa] font-black uppercase">Objetivos de Competência</p>
                          <p className="text-slate-650 font-medium whitespace-pre-line mt-0.5">{aiResult.objectives}</p>
                        </div>
                      )}
                      {aiResult.workload && (
                        <div>
                          <p className="text-[9px] text-[#a1a1aa] font-black uppercase">Carga Horária Sugerida</p>
                          <p className="text-slate-800 font-bold mt-0.5">{aiResult.workload}</p>
                        </div>
                      )}
                      {aiResult.lessons && aiResult.lessons.length > 0 && (
                        <div>
                          <p className="text-[9px] text-[#a1a1aa] font-black uppercase mb-1.5">Aulas Práticas Integradas ({aiResult.lessons.length})</p>
                          <div className="space-y-1.5">
                            {aiResult.lessons.map((l: any, i: number) => (
                              <div key={i} className="p-2 border border-teal-100 bg-white rounded-lg">
                                <p className="text-[9px] font-black text-teal-600 uppercase">Aula {i+1}: {l.title} ({l.duration})</p>
                                <p className="text-[9.5px] text-slate-500 font-medium leading-relaxed mt-0.5">{l.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button 
                        type="button"
                        onClick={handleApplyAiSuggestions}
                        className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest text-center transition-all cursor-pointer"
                      >
                        ✔️ Aplicar Sugestões ao Formulário
                      </button>
                    </div>
                  )}

                  <button 
                    type="button"
                    disabled={isAiLoading}
                    onClick={handleCallELIZAAI}
                    className="w-full py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-slate-800 transition-all cursor-pointer shadow-sm disabled:opacity-45"
                  >
                    {isAiLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                        Aguarde, Processando Currículo...
                      </span>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 ml-0.5" />
                        Processar e Lapidar com ELIZA IA
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={() => { setIsModuleModalOpen(false); setEditingModule(null); }}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveModuleForm}
                className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-700 transition-all shadow-lg"
              >
                Salvar Módulo
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 3. Modal: CADASTRO / EDIÇÃO DE PROCEDIMENTO PRÁTICO */}
      {isProcedureModalOpen && editingProcedure && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-505" />
                {editingProcedure.id ? 'Evolução do Procedimento Prático' : 'Agendar Prática / Lançar Atendimento'}
              </h3>
              <button onClick={() => { setIsProcedureModalOpen(false); setEditingProcedure(null); }} className="text-slate-400 hover:text-slate-600 border-none bg-transparent">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 custom-scrollbar">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Procedimento Clínico</label>
                  <select 
                    value={editingProcedure.procedure}
                    onChange={(e) => setEditingProcedure({...editingProcedure, procedure: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  >
                    <option value="Toxina botulínica">Toxina Botulínica</option>
                    <option value="Preenchimento labial">Preenchimento Labial</option>
                    <option value="Rinomodelação">Rinomodelação Espacial</option>
                    <option value="Bioestimulador">Bioestimulador de Colágeno</option>
                    <option value="Fios de tração">Fios de Tração HOF</option>
                    <option value="Liplift">Lip Lift Cirúrgico</option>
                    <option value="Implante dentário">Implante Dentário</option>
                    <option value="Prótese">Prótese / Lente de Contato</option>
                    <option value="Cirurgia estética facial">Cirurgia Estética Facial</option>
                    <option value="Limpeza de pele">Limpeza de Pele Profunda</option>
                    <option value="Outros">Outros procedimentos</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Status da Realização</label>
                  <select 
                    value={editingProcedure.status}
                    onChange={(e) => setEditingProcedure({...editingProcedure, status: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="planejado">Planejado</option>
                    <option value="confirmado">Confirmado / Presença</option>
                    <option value="em_execução">Em Execução Clínica</option>
                    <option value="realizado">Realizado / Concluído</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Vincular Paciente-Modelo</label>
                <select 
                  value={editingProcedure.patientId}
                  onChange={(e) => setEditingProcedure({...editingProcedure, patientId: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                >
                  <option value="">-- Selecione o Paciente-Modelo --</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.desiredProcedure})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Professor Supervisor</label>
                  <input 
                    type="text"
                    value={editingProcedure.professorName}
                    onChange={(e) => setEditingProcedure({...editingProcedure, professorName: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Aluno Executor ou Observador</label>
                  <input 
                    type="text"
                    value={editingProcedure.studentName}
                    onChange={(e) => setEditingProcedure({...editingProcedure, studentName: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    placeholder="Ex: Dra. Ana Luiza"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Insumos e Planejamento Prévio</label>
                <input 
                  type="text"
                  value={editingProcedure.clinicalNotes}
                  onChange={(e) => setEditingProcedure({...editingProcedure, clinicalNotes: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  placeholder="Ex: Preenchedor Densidade Média 1.5ml, Hialuronidase de reserva."
                />
              </div>

              <div className="space-y-1 bg-teal-50/20 p-4 rounded-2xl border border-teal-100">
                <h4 className="text-[9.5px] font-black text-teal-700 uppercase tracking-wider mb-2">Evolução de Sessão Prática</h4>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[8.5px] font-black text-slate-450 uppercase">Nota de Evolução Clínica</label>
                    <textarea 
                      value={editingProcedure.evolutionNotes}
                      onChange={(e) => setEditingProcedure({...editingProcedure, evolutionNotes: e.target.value})}
                      rows={2}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                      placeholder="Relate como ocorreu a aplicação, dose administrada, resposta fisiológica e reações imediatas."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[8.5px] font-black text-slate-450 uppercase text-rose-500">⚠️ Se Houver, Relate Intercorrências / Complicações</label>
                    <input 
                      type="text"
                      value={editingProcedure.complications}
                      onChange={(e) => setEditingProcedure({...editingProcedure, complications: e.target.value})}
                      className="w-full px-4 py-2 bg-white border border-rose-100 rounded-xl text-xs outline-none focus:border-rose-300"
                      placeholder="Ex: Eritema excessivo, isquemia imediata revertida com massagem e pomada."
                    />
                  </div>
                </div>
              </div>
            </div>

            <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={() => { setIsProcedureModalOpen(false); setEditingProcedure(null); }}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveProcedureForm}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg transition-all"
              >
                Salvar Evolução
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 4. Modal: CADASTRO / EDIÇÃO DE AULA (LESSON) */}
      {isLessonModalOpen && editingLesson && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
                <Video className="w-5 h-5 text-teal-600" />
                {lessonIndex !== null ? 'Editar Aula do Módulo' : 'Adicionar Aula / Atividade'}
              </h3>
              <button 
                onClick={() => { setIsLessonModalOpen(false); setEditingLesson(null); setLessonIndex(null); }} 
                className="text-slate-400 hover:text-slate-600 border-none bg-transparent"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Título / Tema da Aula</label>
                <input 
                  type="text"
                  value={editingLesson.title || ''}
                  onChange={(e) => setEditingLesson({...editingLesson, title: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none font-sans"
                  placeholder="Ex: Demarcação Facial para Preenchimento Zigomático"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Formato / Categoria</label>
                  <select 
                    value={editingLesson.type || 'Vídeo'}
                    onChange={(e) => setEditingLesson({...editingLesson, type: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="Vídeo">🎥 Vídeo-aula Online</option>
                    <option value="Leitura">📄 PDF ou Bibliografia</option>
                    <option value="Prática Clínica">🩺 Atendimento Médico Prático</option>
                    <option value="Workshop">🏫 Hands-on Individual</option>
                    <option value="Quiz/Avaliação">✍️ Questionário / Prova</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Durabilidade Sugerida</label>
                  <input 
                    type="text"
                    value={editingLesson.duration || ''}
                    onChange={(e) => setEditingLesson({...editingLesson, duration: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none font-sans"
                    placeholder="Ex: 45 min, 1h 30m"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Visão Pedagógica (Ementa da Aula)</label>
                <textarea 
                  value={editingLesson.description || ''}
                  onChange={(e) => setEditingLesson({...editingLesson, description: e.target.value})}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none font-sans"
                  placeholder="Descreva o conteúdo curricular que será transmitido aos alunos ..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Material Adicional / Links do Drive</label>
                <input 
                  type="text"
                  value={editingLesson.supportMaterial || ''}
                  onChange={(e) => setEditingLesson({...editingLesson, supportMaterial: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none font-sans"
                  placeholder="Ex: Slides em PDF, Ficha de Termo de Consentimento"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Endereço de Link Externo (Vimeo / Youtube / Drive)</label>
                <input 
                  type="text"
                  value={editingLesson.externalLink || ''}
                  onChange={(e) => setEditingLesson({...editingLesson, externalLink: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none font-sans"
                  placeholder="Ex: https://vimeo.com/... ou link de aula"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Estado de Liberação da Aula</label>
                <select 
                  value={editingLesson.status || 'Publicado'}
                  onChange={(e) => setEditingLesson({...editingLesson, status: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                >
                  <option value="Publicado">🟢 Publicado (Disponível)</option>
                  <option value="Rascunho">🟡 Pendente (Rascunho)</option>
                </select>
              </div>
            </div>

            <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={() => { setIsLessonModalOpen(false); setEditingLesson(null); setLessonIndex(null); }}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
              >
                Voltar
              </button>
              <button 
                onClick={handleSaveLessonModal}
                className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg transition-all"
              >
                Gravar Aula
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
