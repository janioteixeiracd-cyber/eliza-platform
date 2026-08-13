import React, { useState } from 'react';
import { 
  FileCheck, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  User, 
  Calendar, 
  MessageSquare,
  Sparkles,
  ChevronRight,
  ClipboardList,
  Eye,
  Camera,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface StudentCasesManagerProps {
  cases: any[];
  courses: any[];
  onUpdateCaseStatus: (caseId: string, status: 'pending' | 'approved' | 'adjust' | 'rejected', feedback: string) => Promise<void>;
  onTriggerProfessorDrawing?: (caseObj: any) => void;
}

export default function StudentCasesManager({
  cases,
  courses,
  onUpdateCaseStatus,
  onTriggerProfessorDrawing
}: StudentCasesManagerProps) {
  
  const [selectedCase, setSelectedCase] = useState<any | null>(null);
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Status mapping
  const statusConfig = {
    pending: {
      label: 'Aguardando Análise',
      color: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: Clock
    },
    approved: {
      label: 'Aprovado',
      color: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      icon: CheckCircle2
    },
    adjust: {
      label: 'Solicitar Ajustes',
      color: 'bg-sky-50 text-sky-800 border-sky-100',
      icon: AlertTriangle
    },
    rejected: {
      label: 'Rejeitado',
      color: 'bg-rose-50 text-rose-850 border-rose-200',
      icon: XCircle
    }
  };

  const handleApplyReview = async (newStatus: 'approved' | 'adjust' | 'rejected') => {
    if (!selectedCase) return;
    setIsSubmitting(true);
    try {
      await onUpdateCaseStatus(selectedCase.id, newStatus, feedbackText);
      setSelectedCase({
        ...selectedCase,
        status: newStatus,
        professorFeedback: feedbackText
      });
      alert(`Caso atualizado para status: ${statusConfig[newStatus].label}`);
    } catch (e: any) {
      console.error(e);
      alert("Falha ao salvar auditoria de caso: " + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* View Header */}
      <div className="text-left select-none">
        <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Casos Recebidos dos Alunos</h2>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Avalie fotos clínicas, libere planejamentos faciais e defina o gabarito do professor para os alunos compararem.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
        
        {/* Left Side: Cases List */}
        <div className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200">
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 border-b border-slate-100 pb-3 flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4 text-teal-605" /> FILA DE AUDITORIA DE CASOS
          </h3>

          {cases.length === 0 ? (
            <div className="text-center text-slate-400 italic py-16 text-xs space-y-2">
              <Camera className="w-10 h-10 text-slate-200 mx-auto" />
              <p>Nenhum aluno enviou casos clínicos ou fotos ainda.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-y-auto max-h-[60vh] pr-1 custom-scrollbar space-y-2">
              {cases.map(item => {
                const conf = statusConfig[item.status as keyof typeof statusConfig] || statusConfig.pending;
                const courseName = courses.find(c => c.id === item.courseId)?.name || 'Curso em andamento';
                const createdDate = item.createdAt?.seconds 
                  ? new Date(item.createdAt.seconds * 1000).toLocaleDateString('pt-BR') 
                  : 'Recentemente';

                const isSelected = selectedCase?.id === item.id;

                return (
                  <div 
                    key={item.id}
                    onClick={() => {
                      setSelectedCase(item);
                      setFeedbackText(item.professorFeedback || '');
                    }}
                    className={`p-4 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all border ${
                      isSelected 
                        ? 'bg-slate-50/80 border-slate-350 shadow-sm' 
                        : 'bg-white border-slate-100'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1 flex-1 min-w-0">
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase inline-flex items-center gap-1 border ${conf.color}`}>
                          <conf.icon className="w-2.5 h-2.5" />
                          {conf.label}
                        </span>
                        <h4 className="text-xs font-black text-slate-850 truncate uppercase tracking-tight">{item.patientCode}</h4>
                        <p className="text-[10px] text-slate-500 font-semibold">{item.studentName} • Turma {item.batchName}</p>
                        <p className="text-[9px] text-slate-400 truncate mt-1">{courseName}</p>
                      </div>

                      <div className="text-right text-[9px] font-bold text-slate-400 shrink-0">
                        {createdDate}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Case Details & Feedback Action Hub */}
        <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200">
          <AnimatePresence mode="wait">
            {selectedCase ? (
              <motion.div 
                key={selectedCase.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Profile header case info */}
                <div className="border-b border-slate-100 pb-4">
                  <div className="flex flex-wrap gap-2 items-center justify-between">
                    <span className="text-[9px] font-black text-teal-605 uppercase tracking-widest block">AUDITORIA DE CASO</span>
                    <span className={`px-2.5 py-0.5 rounded-full border text-[8px] font-black uppercase ${statusConfig[selectedCase.status as keyof typeof statusConfig]?.color}`}>
                      {statusConfig[selectedCase.status as keyof typeof statusConfig]?.label}
                    </span>
                  </div>
                  <h3 className="text-md font-black text-slate-850 uppercase tracking-tight mt-1">Identificação / Código: {selectedCase.patientCode}</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-semibold">Ficha enviada por: <span className="font-extrabold text-slate-700">{selectedCase.studentName}</span> • Tipo: <span className="font-extrabold text-slate-700 uppercase">{selectedCase.caseType}</span></p>
                </div>

                {/* Patient Complaint Section */}
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1 bg-slate-50 p-4 border border-slate-100 rounded-2xl">
                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Queixa Principal</span>
                    <p className="text-slate-805 font-bold leading-normal">{selectedCase.chiefComplaint || "Nenhuma queixa descrita."}</p>
                  </div>
                  <div className="space-y-1 bg-slate-50 p-4 border border-slate-100 rounded-2xl">
                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Observações Clínicas</span>
                    <p className="text-slate-805 font-bold leading-normal">{selectedCase.clinicalNotes || "Sem observações adicionais."}</p>
                  </div>
                </div>

                {/* Submitted Photos Gallery Grid */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 leading-none">
                    <Camera className="w-4 h-4 text-slate-450" /> Fotos Clínicas do Aluno
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(selectedCase.images || {}).map(([key, value]) => {
                      if (!value) return null;
                      
                      // Match visual labels
                      const nameTags: Record<string, string> = {
                        frontal: 'Frontal',
                        profileRight: 'Perfil Dir.',
                        profileLeft: 'Perfil Esq.',
                        smile: 'Sorriso',
                        intraoral: 'Intraoral',
                        other: 'Outra'
                      };

                      return (
                        <div key={key} className="bg-slate-50 rounded-2xl border border-slate-150 overflow-hidden relative group aspect-square">
                          <img 
                            src={value as string} 
                            alt={key} 
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-slate-950/80 to-transparent text-white select-none">
                            <span className="text-[9.5px] font-black uppercase tracking-wider block">{nameTags[key] || key}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Action panel status adjustments */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black text-slate-450 uppercase pl-1 block">Feedback do Professor / Gabarito Educativo</label>
                    <textarea 
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Escreva comentários anatômicos, correções sobre o enquadramento ou o roteiro ideal de diagnóstico deste caso..."
                      rows={3}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button 
                      onClick={() => handleApplyReview('approved')}
                      disabled={isSubmitting}
                      className="flex-1 min-w-[120px] py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[9.5px] rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40"
                    >
                      Aprovar Fotos
                    </button>
                    <button 
                      onClick={() => handleApplyReview('adjust')}
                      disabled={isSubmitting}
                      className="flex-1 min-w-[120px] py-3 bg-sky-600 hover:bg-sky-700 text-white font-black uppercase tracking-widest text-[9.5px] rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40"
                    >
                      Solicitar Ajustes
                    </button>
                    <button 
                      onClick={() => handleApplyReview('rejected')}
                      disabled={isSubmitting}
                      className="flex-1 min-w-[120px] py-3 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-widest text-[9.5px] rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40"
                    >
                      Rejeitar Caso
                    </button>
                  </div>
                  
                  {/* Option for teacher to pre-annotate/draw as professor landmark answer */}
                  {selectedCase.status === 'approved' && onTriggerProfessorDrawing && (
                    <div className="p-4 bg-teal-50 border border-teal-100 rounded-2xl flex items-center justify-between text-teal-900 mt-2">
                      <div className="space-y-1">
                        <span className="text-[9px] font-black uppercase block text-teal-800">Desenho do Professor (Gabarito)</span>
                        <p className="text-[10px] leading-normal font-semibold text-teal-700">Abra a foto aprobada no editor e trace as marcações ideais para servir de gabarito para os alunos.</p>
                      </div>
                      <button 
                        onClick={() => onTriggerProfessorDrawing(selectedCase)}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[9px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                      >
                        <Layers className="w-3.5 h-3.5" /> Abrir Editor
                      </button>
                    </div>
                  )}

                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col justify-center items-center text-slate-400 py-32 space-y-2">
                <FileCheck className="w-12 h-12 text-slate-200 mb-2" />
                <p className="text-xs italic text-center px-8">Selecione um caso enviado por alunos na lista à esquerda para revisar os dados, fotos clínicas e auditorias de HOF.</p>
              </div>
            )}
          </AnimatePresence>
        </div>

      </div>

    </div>
  );
}
