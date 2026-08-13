import React, { useState } from 'react';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  User, 
  BookOpen, 
  ExternalLink,
  Info,
  MapPin,
  ClipboardList
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface EducationSchedulerProps {
  courses: any[];
  modules: any[];
  procedures: any[];
  patients: any[];
  onNavigateTab: (tab: string) => void;
}

// Hours of the clinical academic day
const HOURS_ARRAY = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00 to 20:00

export default function EducationScheduler({
  courses,
  modules,
  procedures,
  patients,
  onNavigateTab
}: EducationSchedulerProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  // Helper to format Date as YYYY-MM-DD
  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Find Friday and Saturday for the selected week/date
  const getSelectedWeekDays = (baseDate: Date) => {
    const currentDay = baseDate.getDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
    
    // Friday of this week
    const fri = new Date(baseDate);
    const diffToFri = 5 - currentDay;
    fri.setDate(baseDate.getDate() + diffToFri);

    // Saturday of this week
    const sat = new Date(baseDate);
    const diffToSat = 6 - currentDay;
    sat.setDate(baseDate.getDate() + diffToSat);

    return { friday: fri, saturday: sat };
  };

  const { friday, saturday } = getSelectedWeekDays(currentDate);

  // States
  const [selectedSlot, setSelectedSlot] = useState<any | null>(null);

  // Navigation helpers
  const handlePrevWeek = () => {
    const prev = new Date(currentDate);
    prev.setDate(currentDate.getDate() - 7);
    setCurrentDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(currentDate);
    next.setDate(currentDate.getDate() + 7);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Helper to match dates (support multiple date strings like YYYY-MM-DD or DD/MM/YYYY)
  const isSameDate = (dateStr1: string, dateObj: Date) => {
    if (!dateStr1) return false;
    
    // Convert dateStr1 from YYYY-MM-DD or DD/MM/YYYY to a uniform YYYY-MM-DD key
    let clean1 = dateStr1.trim();
    if (clean1.includes('/')) {
      const parts = clean1.split('/');
      if (parts.length === 3) {
        clean1 = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    
    const key = formatDateKey(dateObj);
    return clean1 === key;
  };

  // Get course module and procedures for Friday/Saturday
  const getDayActivities = (date: Date) => {
    // 1. Find modules on this day
    const dayModules = modules.filter(m => isSameDate(m.date, date));
    
    // 2. Find procedures on this day (tied to modules on this day)
    const dayProcedures = procedures.filter(p => {
      const parentModule = dayModules.find(m => m.id === p.moduleId);
      return !!parentModule;
    });

    return { dayModules, dayProcedures };
  };

  // Helper to format a time string (e.g. 09:00) to index/position
  const parseHour = (timeStr: string) => {
    if (!timeStr) return 8;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10);
  };

  // Navigation handlers for the selected module and patient
  const handleToClinicalRecord = (patientClinicId: string) => {
    if (!patientClinicId) {
      alert("Paciente-modelo sem prontuário clínico individual vinculado no sistema.");
      return;
    }
    setSelectedSlot(null);
    window.dispatchEvent(new CustomEvent('select-patient', { detail: { patientId: patientClinicId } }));
  };

  const handleToEducationPatient = () => {
    setSelectedSlot(null);
    onNavigateTab('patients');
  };

  // Render slots for a day
  const renderDayColumn = (dateObj: Date, label: string) => {
    const { dayModules, dayProcedures } = getDayActivities(dateObj);
    const formattedDate = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const isToday = formatDateKey(dateObj) === formatDateKey(new Date());

    return (
      <div className="flex-1 min-w-[280px] bg-slate-50/50 rounded-3xl border border-slate-200 p-4 transition-all">
        {/* Day Header */}
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-black uppercase text-slate-800 tracking-tight flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${isToday ? 'bg-teal-500 animate-pulse' : 'bg-slate-350'}`}></span>
              {label}
            </h3>
            <span className="text-[10px] text-slate-500 font-bold mt-0.5 block">{formattedDate}</span>
          </div>
          {dayModules.length > 0 && (
            <span className="px-2 py-0.5 bg-slate-200/80 text-slate-700 text-[8.5px] font-black uppercase rounded-lg">
              {dayModules.length} {dayModules.length === 1 ? 'Módulo' : 'Módulos'}
            </span>
          )}
        </div>

        {/* Hour Grid slots */}
        <div className="space-y-2 relative min-h-[400px]">
          {HOURS_ARRAY.map(hour => {
            // Find module or procedures scheduled at this hour
            const hourModule = dayModules.find(m => {
              const startH = parseHour(m.startTime);
              const endH = parseHour(m.endTime) || (startH + 4);
              return hour >= startH && hour < endH;
            });

            // Find procedures for this hour
            const hourProcedures = dayProcedures.filter(p => {
              const moduleOfProc = dayModules.find(m => m.id === p.moduleId);
              if (!moduleOfProc) return false;
              const startH = parseHour(moduleOfProc.startTime);
              return Math.floor(startH) === hour;
            });

            const hasClass = !!hourModule;

            return (
              <div 
                key={hour} 
                className={`p-3 rounded-2xl border transition-all relative ${
                  hasClass 
                    ? 'bg-slate-100 border-slate-200 shadow-xs group cursor-pointer hover:border-slate-350' 
                    : 'bg-white border-slate-150 hover:bg-slate-50/50'
                }`}
                onClick={() => {
                  if (hasClass) {
                    setSelectedSlot({
                      hour,
                      date: dateObj,
                      module: hourModule,
                      procedures: hourProcedures,
                      course: courses.find(c => c.id === hourModule.courseId)
                    });
                  }
                }}
              >
                {/* Time Indicator */}
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {String(hour).padStart(2, '0')}:00
                  </span>
                  {hasClass && (
                    <span className="text-[8.5px] font-black text-slate-500 uppercase tracking-wide bg-slate-250 px-1.5 py-0.5 rounded-md">
                      CURSO PREMIUM
                    </span>
                  )}
                </div>

                {/* Slot Content */}
                {hasClass ? (
                  <div className="mt-2 text-left">
                    <p className="text-[10px] font-black uppercase text-teal-750 font-sans tracking-tight">
                      {courses.find(c => c.id === hourModule.courseId)?.name || 'Curso Acadêmico'}
                    </p>
                    <p className="text-xs font-black text-slate-800 uppercase mt-0.5 line-clamp-1">
                      {hourModule.name}
                    </p>
                    
                    {hourProcedures.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {hourProcedures.map((proc, pIdx) => {
                          const patientData = patients.find(pat => pat.id === proc.patientId || pat.name === proc.patientName);
                          return (
                            <div key={pIdx} className="p-1.5 rounded-lg bg-white/90 border border-slate-200 text-[10px] font-bold">
                              <p className="text-[9px] uppercase font-black text-slate-400">PROCEDIMENTO & PACIENTE-MODELO</p>
                              <p className="text-slate-800 uppercase text-xs font-black line-clamp-1 mt-0.5">{proc.procedure}</p>
                              <p className="text-teal-600 uppercase text-[10px] font-black mt-0.5">👤 {proc.patientName || "Sem Nome"}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[9.5px] italic text-slate-450 mt-1.5 font-bold">
                        Sem práticas clínicas agendadas neste horário.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-left min-h-[14px]">
                    <span className="text-[9px] text-slate-350 font-black uppercase tracking-wider block">LIVRE PARA ATENDIMENTOS OU MONTAGEM</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 rounded-3xl border border-slate-200 gap-4">
        <div className="space-y-0.5 text-left">
          <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <Calendar className="w-5 h-5 text-teal-600" />
            Agenda Acadêmica Individualizada
          </h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
            Imersões Especializadas — Foco Exclusivo em <span className="text-teal-600 font-black">Sextas e Sábados</span>
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto self-stretch sm:self-auto">
          <button 
            onClick={handlePrevWeek}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer text-slate-600"
            title="Semana Anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <button 
            onClick={handleToday}
            className="px-3.5 py-2 border border-slate-200 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-55 transition-all text-slate-700 font-sans cursor-pointer"
          >
            Este Fim de Semana
          </button>

          <button 
            onClick={handleNextWeek}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-55 cursor-pointer text-slate-600"
            title="Próxima Semana"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Week Title Indicator */}
      <div className="text-center">
        <span className="px-5 py-2 bg-slate-900 text-white rounded-full text-[10px] font-black uppercase tracking-widest inline-block shadow-sm">
          Fim de Semana: {friday.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} — {saturday.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} de {friday.getFullYear()}
        </span>
      </div>

      {/* Calendar Grid columns for Friday and Saturday */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6">
        {renderDayColumn(friday, 'Sexta-Feira')}
        {renderDayColumn(saturday, 'Sábado acadêmico')}
      </div>

      {/* Modal / Overlay for details */}
      <AnimatePresence>
        {selectedSlot && (
          <div className="fixed inset-0 bg-slate-950/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden text-left flex flex-col"
            >
              <header className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <span className="px-2 py-0.5 bg-slate-200 text-slate-700 text-[8px] font-black uppercase rounded-md tracking-wider">
                    {selectedSlot.course?.type || 'CURSO'}
                  </span>
                  <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase mt-1">
                    {selectedSlot.course?.name || 'Aula / Atividade'}
                  </h3>
                </div>
                <button 
                  onClick={() => setSelectedSlot(null)}
                  className="p-1 px-2 border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold rounded-lg cursor-pointer text-slate-500"
                >
                  Fechar
                </button>
              </header>

              <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh] custom-scrollbar">
                {/* Module Details info card */}
                <div className="p-4 rounded-2xl bg-slate-100/70 border border-slate-200/60 space-y-2">
                  <h4 className="text-[10px] font-black uppercase text-slate-400">Módulo Ativo</h4>
                  <p className="text-sm font-black text-slate-800 uppercase leading-snug">{selectedSlot.module?.name}</p>
                  
                  <div className="grid grid-cols-2 gap-4 pt-2 mt-2 border-t border-slate-200/50 text-[10px] font-bold text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-teal-600" />
                      <span>{selectedSlot.module?.startTime || '08:00'} - {selectedSlot.module?.endTime || '20:00'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-teal-600" />
                      <span>{selectedSlot.module?.workload || "4 Horas"}</span>
                    </div>
                  </div>
                </div>

                {/* Related Procedures with Patient redirection triggers */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                    Atendimentos e Pacientes-Modelo vinculados ({selectedSlot.procedures.length})
                  </h4>

                  {selectedSlot.procedures.length > 0 ? (
                    <div className="space-y-4">
                      {selectedSlot.procedures.map((proc: any, idx: number) => {
                        const patObj = patients.find(pa => pa.id === proc.patientId || pa.name === proc.patientName);
                        const patClinicId = patObj?.patientClinicId || proc.patientId;

                        return (
                          <div key={idx} className="p-4 rounded-2xl border border-teal-100 bg-teal-50/15 space-y-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[9px] font-black text-teal-700 bg-teal-100 px-2 py-0.5 rounded uppercase">
                                  {proc.procedure}
                                </span>
                                <h5 className="text-xs font-black text-slate-850 uppercase mt-2">
                                  Paciente: <span className="text-teal-700 font-extrabold">{proc.patientName}</span>
                                </h5>
                                {proc.studentName && (
                                  <p className="text-[10px] text-slate-500 font-bold mt-1">
                                    Aluno executor: <span className="text-slate-800">{proc.studentName}</span>
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Redirect buttons with clinical vs academic routes */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-teal-100/50">
                              <button 
                                onClick={() => {
                                  if (patClinicId) {
                                    handleToClinicalRecord(patClinicId);
                                  } else {
                                    alert("Consenso de paciente-modelo: este paciente não possui uma ficha clínica vinculada no cadastro de pacientes da clínica.");
                                  }
                                }}
                                className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Prontuário Particular</span>
                              </button>

                              <button 
                                onClick={handleToEducationPatient}
                                className="w-full py-2 border border-slate-250 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                              >
                                <ClipboardList className="w-3.5 h-3.5" />
                                <span>Ficha no Education</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center p-6 border border-dashed border-slate-200 rounded-2xl">
                      <Info className="w-6 h-6 text-slate-350 mx-auto mb-2" />
                      <p className="text-[10px] font-bold text-slate-450 uppercase leading-normal">
                        Nenhum procedimento com paciente-modelo cadastrado para este módulo ainda.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
