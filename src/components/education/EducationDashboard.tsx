import React from 'react';
import { 
  GraduationCap, 
  Calendar, 
  Users, 
  HeartPulse, 
  Activity, 
  AlertCircle, 
  ClipboardCheck, 
  FileCheck,
  Clock,
  ChevronRight,
  TrendingUp,
  Award
} from 'lucide-react';

interface EducationDashboardProps {
  courses: any[];
  students: any[];
  patients: any[];
  metrics: {
    activeCoursesCount: number;
    nextModuleDate: string;
    nextModuleName: string;
    activeStudentsCount: number;
    patientsTodayCount: number;
    proceduresTodayCount: number;
    clinicalPendingsCount: number;
    adminPendingsCount: number;
  };
  onNavigateTab: (tab: string) => void;
  recentLogs: any[];
}

export default function EducationDashboard({
  courses,
  students,
  patients,
  metrics,
  onNavigateTab,
  recentLogs
}: EducationDashboardProps) {
  
  const cards = [
    {
      title: "Curso em Andamento",
      value: metrics.activeCoursesCount,
      subtitle: `${courses.filter(c => c.status === 'em_andamento').length} turmas ativas`,
      color: "bg-teal-50 border-teal-100 text-teal-700",
      icon: GraduationCap,
      tab: "courses"
    },
    {
      title: "Próximo Módulo",
      value: metrics.nextModuleName || "Nenhum",
      subtitle: metrics.nextModuleDate ? `Agenda: ${metrics.nextModuleDate}` : "Sem aulas agendadas",
      color: "bg-sky-50 border-sky-100 text-sky-700",
      icon: Calendar,
      tab: "courses"
    },
    {
      title: "Alunos Presentes / Ativos",
      value: metrics.activeStudentsCount,
      subtitle: "Liberados no período",
      color: "bg-violet-50 border-violet-100 text-violet-700",
      icon: Users,
      tab: "students"
    },
    {
      title: "Pacientes e Procedimentos",
      value: `${metrics.patientsTodayCount} Pacientes / ${metrics.proceduresTodayCount} Proc`,
      subtitle: "Selecionados para hoje",
      color: "bg-emerald-50 border-emerald-100 text-emerald-700",
      icon: HeartPulse,
      tab: "patients"
    }
  ];

  const pendings = [
    {
      title: "Pendências Clínicas",
      value: metrics.clinicalPendingsCount,
      desc: "Anamneses ou TCLE pendentes",
      color: "border-rose-100 text-rose-700 bg-rose-50/50",
      icon: AlertCircle,
      tab: "patients"
    },
    {
      title: "Pendências Administrativas",
      value: metrics.adminPendingsCount,
      desc: "Contratos ou parcelas em aberto",
      color: "border-amber-100 text-amber-755 bg-amber-50/50",
      icon: ClipboardCheck,
      tab: "finance"
    }
  ];

  return (
    <div className="space-y-8">
      {/* Banner / Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 sm:p-10 rounded-[2rem] text-white flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
        <div className="space-y-2">
          <span className="px-3 py-1 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-full text-[10px] font-black uppercase tracking-widest">
            Módulo Premium Ativo
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">ELIZA Education</h2>
          <p className="text-xs text-slate-400 font-medium max-w-xl">
            Bem-vindo à central de inteligência acadêmica. Gerencie imersões, residências, mentoria, alunos, certidões clínicas de pacientes-modelo e o acompanhamento de comissões em ambiente educacional.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <button 
            onClick={() => onNavigateTab('ai_assistant')}
            className="px-5 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md shadow-teal-600/10 flex items-center gap-2 cursor-pointer"
          >
            <Activity className="w-4 h-4 animate-pulse" />
            <span>ELIZA Consultoria IA</span>
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <div 
            key={i} 
            onClick={() => onNavigateTab(card.tab)}
            className={`p-6 border rounded-3xl transition-all shadow-xs cursor-pointer hover:scale-[1.01] hover:shadow-md ${card.color}`}
          >
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {card.title}
              </span>
              <card.icon className="w-5 h-5 opacity-70" />
            </div>
            <h3 className="text-xl sm:text-2xl font-black tracking-tighter mt-4">
              {card.value}
            </h3>
            <p className="text-[10px] font-semibold opacity-70 mt-1 uppercase tracking-tight">
              {card.subtitle}
            </p>
          </div>
        ))}
      </div>

      {/* Section split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Pending items and Quick summaries */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-4 mb-6 flex items-center justify-between">
              <span>ALERTAS DE PENDÊNCIA</span>
              <span className="p-1 px-2.5 bg-rose-50 text-rose-700 text-[9px] rounded-md font-bold">Atenção</span>
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pendings.map((p, i) => (
                <div 
                  key={i}
                  onClick={() => onNavigateTab(p.tab)}
                  className={`p-5 rounded-2xl border flex items-start gap-4 cursor-pointer hover:border-slate-300 transition-all ${p.color}`}
                >
                  <div className="p-3 bg-white rounded-xl shadow-xs shrink-0">
                    <p.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{p.title}</h5>
                    <h3 className="text-xl font-bold tracking-tight mt-1">{p.value}</h3>
                    <p className="text-[9.5px] font-bold text-slate-400 mt-0.5">{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Guidelines */}
            <div className="mt-6 p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-left">
              <p className="text-[10.5px] text-slate-500 font-medium leading-relaxed">
                👉 <span className="font-bold text-slate-700">Dica Pedagógica:</span> Para que os alunos consigam baixar seus certificados, certifique-se de que a presença foi validada, o curso está finalizado e não constam pendências administrativas ou financeiras.
              </p>
            </div>
          </div>

          {/* Quick Schedule Today / Próximas Atividades */}
          <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200">
            <div className="flex justify-between items-center mb-6">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                CRONOGRAMA ACADÊMICO RECENTE
              </h4>
              <button 
                onClick={() => onNavigateTab('courses')}
                className="text-[10px] font-bold text-teal-600 hover:text-teal-700 uppercase tracking-widest flex items-center gap-1 cursor-pointer"
              >
                <span>Ver Cursos</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {courses.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-6 text-center">Nenhum curso cadastrado ainda.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {courses.slice(0, 5).map(course => (
                  <div key={course.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="p-1 px-2.5 bg-slate-100 text-slate-700 text-[8px] font-bold uppercase rounded-md">
                          {course.type}
                        </span>
                        <span className={`w-2 h-2 rounded-full ${
                          course.status === 'em_andamento' ? 'bg-emerald-500 animate-pulse' :
                          course.status === 'planejado' ? 'bg-amber-400' :
                          course.status === 'finalizado' ? 'bg-slate-400' : 'bg-red-500'
                        }`} />
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{course.status}</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase mt-1 tracking-tight">{course.name}</h4>
                      <p className="text-[9.5px] text-slate-400 mt-1">Data: {course.startDate} a {course.endDate} | Carga: {course.durationHours}h</p>
                    </div>

                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase">PROFESSOR</p>
                      <p className="text-xs font-bold text-slate-700 mt-0.5">{course.professorName || "Não definido"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Audit Logs and Mini metrics */}
        <div className="lg:col-span-4 space-y-6 text-left">
          {/* Audit Logs */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-4 mb-4">
              HISTÓRICO ACADÊMICO (AUDITORIA)
            </h4>

            {recentLogs.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic py-6 text-center">Nenhum evento registrado ainda.</p>
            ) : (
              <div className="space-y-3.5 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                {recentLogs.slice(0, 10).map((log, i) => (
                  <div key={i} className="text-left text-[11px] leading-relaxed border-b border-dashed border-slate-100 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 font-bold mb-1">
                      <span>{log.type}</span>
                      <span>{log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
                    <p className="text-[10.5px] font-bold text-slate-700">{log.details}</p>
                    <p className="text-[9.5px] text-slate-400 mt-0.5">Operador: {log.userName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Info Box */}
          <div className="bg-slate-900 text-white p-6 rounded-[2rem] flex flex-col gap-4 relative overflow-hidden">
            <Award className="absolute -right-6 -bottom-6 w-32 h-32 text-slate-800/40" />
            
            <div className="relative space-y-2">
              <span className="p-1 px-2.5 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-md font-bold text-[8px] uppercase">
                Add-on Premium
              </span>
              <h4 className="text-xs font-black uppercase tracking-widest mt-2">Diferencial Clínico</h4>
              <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                Além de realizar atendimentos assistenciais, clínicas que lecionam cursos aumentam em até <span className="text-teal-400 font-bold">2.4x</span> o reaproveitamento de materiais de estoque e qualificam seus fornecedores em processos de comissão estruturada.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
