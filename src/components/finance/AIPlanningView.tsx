import React, { useState, useEffect } from 'react';
import { 
  Brain, 
  Sparkles, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  ArrowRight, 
  Loader2,
  Calendar,
  CheckCircle2,
  ShieldCheck,
  Target,
  BarChart4,
  Filter,
  User,
  DollarSign,
  Briefcase,
  X,
  FileCheck,
  HelpCircle,
  Plus
} from 'lucide-react';
import { collection, query, onSnapshot, getDocs, limit, where, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { generateFinancialPlan } from '../../services/financialPlanner';
import { motion, AnimatePresence } from 'motion/react';
import { DEFAULT_TREATMENT_CATALOG, TREATMENT_CATEGORIES } from '../../data/treatmentCatalog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function AIPlanningView() {
  const { clinic } = useAuth();
  
  // Data State
  const [appointments, setAppointments] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [payables, setPayables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // AI Planner States
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPlan, setAiPlan] = useState<any>(null);

  // Active planning subtab: 'real' (Agenda & Financeiro) or 'ai' (Recomendações da IA)
  const [activeSubTab, setActiveSubTab] = useState<'real' | 'ai'>('real');

  // Filters State (Part 6)
  const [filterStaffId, setFilterStaffId] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterDay, setFilterDay] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterProcedure, setFilterProcedure] = useState<string>('all');

  // "Planejar Procedimento" Modal State (Part 4)
  const [selectedApt, setSelectedApt] = useState<any | null>(null);
  const [showPlanningModal, setShowPlanningModal] = useState(false);
  const [selectedProcedureName, setSelectedProcedureName] = useState<string>('');
  const [selectedProcedureCategory, setSelectedProcedureCategory] = useState<string>('');
  const [estimatedValue, setEstimatedValue] = useState<number>(150);

  // Load Real Firebase Data on Mount
  useEffect(() => {
    if (!clinic) return;

    // Listen to real appointments
    const unsubApts = onSnapshot(query(collection(db, 'clinics', clinic.id, 'appointments')), (snap) => {
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Listen to team members
    const unsubMembers = onSnapshot(query(collection(db, 'clinics', clinic.id, 'team_members')), (snap) => {
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Listen to rules
    const unsubRules = onSnapshot(query(collection(db, 'clinics', clinic.id, 'commission_rules')), (snap) => {
      setRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Listen to payables for AI Context
    const unsubPayables = onSnapshot(query(collection(db, 'clinics', clinic.id, 'clinic_payables')), (snap) => {
      setPayables(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => {
      unsubApts();
      unsubMembers();
      unsubRules();
      unsubPayables();
    };
  }, [clinic]);

  // Helper values & Category / Price Resolver
  const getAppointmentValue = (apt: any) => {
    if (typeof apt.value === 'number') return apt.value;
    if (typeof apt.price === 'number') return apt.price;
    if (typeof apt.estimatedValue === 'number') return apt.estimatedValue;
    // Walk back to catalog default
    const match = DEFAULT_TREATMENT_CATALOG.find(item => item.name.toLowerCase() === String(apt.procedure || '').toLowerCase());
    return match ? (match.defaultPrice || 0) : 0;
  };

  const getAppointmentCategory = (apt: any) => {
    if (apt.category) return apt.category;
    const match = DEFAULT_TREATMENT_CATALOG.find(item => item.name.toLowerCase() === String(apt.procedure || '').toLowerCase());
    return match ? match.category : 'Outros';
  };

  // Commission Estimator Engine based on Priority Rules (Part 3)
  const estimateCommissionForAppointment = (apt: any, staffMember: any, activeRules: any[]) => {
    if (!staffMember) return 0;
    
    const isProf = staffMember.isProfessional ?? (staffMember.role === 'dentist' || staffMember.role === 'doctor');
    const isComm = staffMember.isCommissionable ?? (staffMember.commission_enabled !== false);
    if (!isProf || !isComm) return 0;

    const value = getAppointmentValue(apt);
    if (value <= 0) return 0;

    const profId = staffMember.id;
    // Get rules loaded for this specific professional
    const profRules = activeRules.filter(r => r.active === true && (r.professionalId === profId || r.member_id === profId));

    const norm = (s: string) => String(s || '').toLowerCase().trim();
    const procName = apt.procedure || '';

    // Priority 1: Specific Procedure Rule
    const procRule = profRules.find(r => r.ruleType === 'procedure' && r.procedureName && norm(r.procedureName) === norm(procName));
    if (procRule) {
      const pct = procRule.commissionPercent !== undefined ? procRule.commissionPercent : (procRule.percentage || 0);
      return (value * pct) / 100;
    }

    // Priority 2: Category Rule
    const categoryName = getAppointmentCategory(apt);
    const catRule = profRules.find(r => r.ruleType === 'category' && r.category && norm(r.category) === norm(categoryName));
    if (catRule) {
      const pct = catRule.commissionPercent !== undefined ? catRule.commissionPercent : (catRule.percentage || 0);
      return (value * pct) / 100;
    }

    // Priority 3: Default Rule for professional
    const defRule = profRules.find(r => r.ruleType === 'default');
    if (defRule) {
      const pct = defRule.commissionPercent !== undefined ? defRule.commissionPercent : (defRule.percentage || 0);
      return (value * pct) / 100;
    }

    // Priority 4: Default percent directly configured on professional document
    if (typeof staffMember.defaultCommissionPercent === 'number') {
      return (value * staffMember.defaultCommissionPercent) / 100;
    }
    if (typeof staffMember.percentage === 'number') {
      return (value * staffMember.percentage) / 100;
    }

    return 0; // fallback to 0
  };

  // Date Checkers
  const isToday = (dateStr: string) => {
    try {
      const today = new Date();
      const check = new Date(dateStr + 'T12:00:00');
      return today.getFullYear() === check.getFullYear() &&
             today.getMonth() === check.getMonth() &&
             today.getDate() === check.getDate();
    } catch(e) { return false; }
  };

  const isThisWeek = (dateStr: string) => {
    try {
      const check = new Date(dateStr + 'T12:00:00');
      const today = new Date();
      const currentDay = today.getDay();
      const diff = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
      const startOfWeek = new Date(today.setDate(diff));
      startOfWeek.setHours(0,0,0,0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23,59,59,999);
      
      return check >= startOfWeek && check <= endOfWeek;
    } catch(e) { return false; }
  };

  // Filtering Team Members who actually attend patients on agenda (Part 4)
  const attendingProfessionals = teamMembers.filter(m => {
    const isProf = m.isProfessional ?? (m.role === 'dentist' || m.role === 'doctor');
    const isActive = m.active !== false;
    return isProf && isActive;
  });

  // Calculate high-level financial parameters based on agenda AND active filters (Part 5)
  // Let's compute forecasts for today, week, and overall filtered view!
  let forecastedRevenueToday = 0;
  let forecastedRevenueWeek = 0;
  let forecastedRevenueTotal = 0;
  let commissionEstimatedTotal = 0;

  let proceduresWithoutValueCount = 0;
  let patientsWithoutProcedureCount = 0;

  const forecastByProfessional: Record<string, { name: string; role: string; revenue: number; commission: number; appointmentsCount: number }> = {};

  appointments.forEach(apt => {
    const val = getAppointmentValue(apt);
    const cat = getAppointmentCategory(apt);
    const hasValue = val > 0;
    const hasPlannedProc = apt.procedure && apt.procedure !== 'Procedimento não planejado' && apt.procedure !== '';

    if (!hasPlannedProc) {
      patientsWithoutProcedureCount++;
    } else if (!hasValue) {
      proceduresWithoutValueCount++;
    }

    const dateStr = apt.date; // "YYYY-MM-DD"
    if (isToday(dateStr)) {
      forecastedRevenueToday += val;
    }
    if (isThisWeek(dateStr)) {
      forecastedRevenueWeek += val;
    }
    forecastedRevenueTotal += val;

    // Professional attribution
    const staff = teamMembers.find(m => m.id === apt.staffId);
    if (staff) {
      const isProf = staff.isProfessional ?? (staff.role === 'dentist' || staff.role === 'doctor');
      if (isProf) {
        const commEst = estimateCommissionForAppointment(apt, staff, rules);
        commissionEstimatedTotal += commEst;

        if (!forecastByProfessional[staff.id]) {
          forecastByProfessional[staff.id] = { 
            name: staff.displayName || staff.name, 
            role: staff.role, 
            revenue: 0, 
            commission: 0,
            appointmentsCount: 0 
          };
        }
        forecastByProfessional[staff.id].revenue += val;
        forecastByProfessional[staff.id].commission += commEst;
        forecastByProfessional[staff.id].appointmentsCount++;
      }
    }
  });

  const estimatedClinicBalance = forecastedRevenueTotal - commissionEstimatedTotal;

  // Apply filters for the appointments table (Part 6)
  const filteredAppointments = appointments.filter(apt => {
    // 1. Professional/Staff filter
    if (filterStaffId !== 'all' && apt.staffId !== filterStaffId) return false;

    // Convert date for month/day checks
    let dateObj: Date;
    try {
      dateObj = new Date(apt.date + 'T12:00:00');
    } catch(e) {
      return true;
    }

    // 2. Month Filter (0-11)
    if (filterMonth !== 'all' && dateObj.getMonth() !== Number(filterMonth)) return false;

    // 3. Day of Month Filter (1-31)
    if (filterDay !== 'all' && dateObj.getDate() !== Number(filterDay)) return false;

    // 4. Status Filter
    if (filterStatus !== 'all' && apt.status !== filterStatus) return false;

    // 5. Category Filter
    if (filterCategory !== 'all') {
      const cat = getAppointmentCategory(apt);
      if (cat.toLowerCase() !== filterCategory.toLowerCase()) return false;
    }

    // 6. Procedure Name Filter
    if (filterProcedure !== 'all') {
      if (apt.procedure !== filterProcedure) return false;
    }

    return true;
  });

  // Open "Planejar Procedimento" modal
  const handleOpenPlanProcedure = (apt: any) => {
    setSelectedApt(apt);
    setSelectedProcedureName(DEFAULT_TREATMENT_CATALOG[0].name);
    setSelectedProcedureCategory(DEFAULT_TREATMENT_CATALOG[0].category);
    setEstimatedValue(DEFAULT_TREATMENT_CATALOG[0].defaultPrice);
    setShowPlanningModal(true);
  };

  // Handle saving the planned procedure back to Firestore
  const handleSavePlannedProcedure = async () => {
    if (!clinic || !selectedApt) return;
    try {
      const aptRef = doc(db, 'clinics', clinic.id, 'appointments', selectedApt.id);
      await updateDoc(aptRef, {
        procedure: selectedProcedureName,
        category: selectedProcedureCategory,
        price: Number(estimatedValue),
        value: Number(estimatedValue),
        updated_at: serverTimestamp()
      });
      setShowPlanningModal(false);
      setSelectedApt(null);
    } catch(e) {
      console.error(e);
      alert('Falha ao salvar agendamento');
    }
  };

  // Change selected procedure dropdown and prefill value
  const handleProcedureDropdownChange = (nameInput: string) => {
    const match = DEFAULT_TREATMENT_CATALOG.find(item => item.name === nameInput);
    setSelectedProcedureName(nameInput);
    if (match) {
      setSelectedProcedureCategory(match.category);
      setEstimatedValue(match.defaultPrice);
    }
  };

  // Trigger ELIZA AI Financial Advisor with real-time extracted metrics!
  const handleGetAIEvaluation = async () => {
    if (!clinic) return;
    setAiLoading(true);
    try {
      // Gather dynamic context
      const context = {
        payables: payables,
        overdueReceivables: payables.filter(p => p.status === 'overdue' || p.status === 'open'),
        pendingCommissions: rules.map(r => r.name),
        agendaForecastToday: forecastedRevenueToday,
        agendaForecastWeek: forecastedRevenueWeek,
        agendaForecastTotal: forecastedRevenueTotal,
        estimatedCommissions: commissionEstimatedTotal,
        estimatedClinicBalance: estimatedClinicBalance,
        proceduresWithoutValueCount,
        patientsWithoutProcedureCount,
        historicalAverageReceipts: forecastedRevenueWeek * 4 || 45000,
        historicalAverageExpenses: payables.reduce((acc, p) => acc + (p.amount || 0), 0) || 32000
      };

      const result = await generateFinancialPlan(context as any);
      setAiPlan(result);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/planning_ai`);
    } finally {
      setAiLoading(false);
    }
  };

  const monthsBr = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const statusMap: Record<string, string> = {
    confirmado: 'Confirmado',
    pendente: 'Pendente',
    atendimento: 'Em Atendimento',
    cancelado: 'Cancelado',
    encaixe: 'Encaixe',
    retorno: 'Retorno',
    finalizado: 'Finalizado',
    aguardando: 'Aguardando',
    faltou: 'Falta'
  };

  return (
    <div className="space-y-10">
      {/* Dynamic Sub-navigation to offer both Real Forecast and AI generation */}
      <div className="flex border-b border-slate-200 pb-4 justify-between items-center flex-col sm:flex-row gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            Agenda Clínica & Fluxo Previsto
          </h2>
          <p className="text-xs text-slate-400 font-medium">Painel unificado de planejamento e faturamento futuro</p>
        </div>
        <div className="flex bg-slate-150 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveSubTab('real')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeSubTab === 'real' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Detalhamento da Agenda
          </button>
          <button
            onClick={() => {
              setActiveSubTab('ai');
              if (!aiPlan) handleGetAIEvaluation();
            }}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all focus:outline-none flex items-center gap-1.5 ${activeSubTab === 'ai' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-indigo-600'}`}
          >
            <Brain className="w-3.5 h-3.5" /> Recomendações Eliza AI
          </button>
        </div>
      </div>

      {loading && (
        <div className="py-20 text-center font-bold text-slate-400 text-xs uppercase tracking-widest">
          Carregando dados da agenda e comissionamento...
        </div>
      )}

      {!loading && activeSubTab === 'real' && (
        <div className="space-y-8">
          {/* Metrics Panel (Part 5) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Forecasted revenue today */}
            <div className="bg-white border border-slate-200 rounded-[30px] p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-50 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 leading-none flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span> Faturamento Previsto Hoje
              </h5>
              <p className="text-2xl font-black text-slate-900 tracking-tight">R$ {forecastedRevenueToday.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-slate-400 font-medium mt-2">Deste dia corrente</p>
            </div>

            {/* Forecasted revenue week */}
            <div className="bg-white border border-slate-200 rounded-[30px] p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 leading-none flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span> Faturamento Previsto da Semana
              </h5>
              <p className="text-2xl font-black text-slate-900 tracking-tight">R$ {forecastedRevenueWeek.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-slate-400 font-medium mt-2">Segunda a Domingo corrente</p>
            </div>

            {/* Balanço estimado clínica */}
            <div className="bg-white border border-slate-200 rounded-[30px] p-6 shadow-sm relative overflow-hidden">
              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 leading-none">Saldo Previsto Clínico (Líquido)</h5>
              <p className="text-2xl font-black text-teal-650 tracking-tight">R$ {estimatedClinicBalance.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-slate-400 font-medium mt-2">
                Menos R$ {commissionEstimatedTotal.toLocaleString('pt-BR')} comissões estimadas
              </p>
            </div>

            {/* Atencao de planejamento */}
            <div className={`rounded-[30px] p-6 shadow-sm text-slate-800 ${proceduresWithoutValueCount > 0 || patientsWithoutProcedureCount > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-slate-100'}`}>
              <h5 className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2 leading-none">Atenção e Pendências</h5>
              <div className="space-y-1 mt-3">
                <p className="text-xs font-bold text-slate-700 flex justify-between">
                  <span>Pacientes sem procedimento:</span>
                  <span className="font-black text-amber-700">{patientsWithoutProcedureCount}</span>
                </p>
                <p className="text-xs font-bold text-slate-700 flex justify-between">
                  <span>Procedimentos sem valor real:</span>
                  <span className="font-black text-amber-700">{proceduresWithoutValueCount}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Forecast by Professional breakdown list */}
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-600" /> Repasses e Produção Mapeada por Profissional
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(forecastByProfessional).map(([staffId, data]) => (
                <div key={staffId} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-between">
                  <div>
                    <h5 className="font-bold text-slate-900 text-sm">{data.name}</h5>
                    <p className="text-[9px] uppercase tracking-wider text-indigo-600 font-bold mb-3">{data.role}</p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Atendimentos na agenda:</span>
                        <span className="font-bold text-slate-705">{data.appointmentsCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Faturamento Previsto:</span>
                        <span className="font-black text-slate-850">R$ {data.revenue.toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="flex justify-between text-teal-650 font-semibold">
                        <span>Comissão Estimada:</span>
                        <span>R$ {data.commission.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {Object.keys(forecastByProfessional).length === 0 && (
                <div className="col-span-full text-center py-6 text-xs text-slate-400 italic">
                  Nenhum profissional com agendamentos planejados no momento.
                </div>
              )}
            </div>
          </div>

          {/* Interactive Filters Grid (Part 6) */}
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-slate-800 border-b border-slate-50 pb-3">
              <Filter className="w-4 h-4 text-indigo-500" />
              <h4 className="text-xs font-black text-indigo-550 uppercase tracking-widest mt-0.5">Filtrar Planejamento da Agenda</h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {/* filterStaffId */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Profissional</label>
                <select
                  value={filterStaffId}
                  onChange={e => setFilterStaffId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:bg-white outline-none"
                >
                  <option value="all">Filtro Profissional (Todos)</option>
                  {attendingProfessionals.map(m => (
                    <option key={m.id} value={m.id}>{m.displayName || m.name}</option>
                  ))}
                </select>
              </div>

              {/* filterMonth */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Mês</label>
                <select
                  value={filterMonth}
                  onChange={e => setFilterMonth(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:bg-white outline-none"
                >
                  <option value="all">Escolha o Mês (Sempre)</option>
                  {monthsBr.map((m, idx) => (
                    <option key={idx} value={idx}>{m}</option>
                  ))}
                </select>
              </div>

              {/* filterDay */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Dia</label>
                <select
                  value={filterDay}
                  onChange={e => setFilterDay(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold font-mono focus:bg-white outline-none"
                >
                  <option value="all font-sans">Escolha o Dia (Sempre)</option>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1)).map(day => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </div>

              {/* filterCategory */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Categoria</label>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:bg-white outline-none"
                >
                  <option value="all">Escolha a Categoria (Todas)</option>
                  {TREATMENT_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* filterStatus */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Status do Agendamento</label>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:bg-white outline-none"
                >
                  <option value="all">Filtro de Status (Todos)</option>
                  {Object.entries(statusMap).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* filterProcedure */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Procedimento Previsto</label>
                <select
                  value={filterProcedure}
                  onChange={e => setFilterProcedure(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:bg-white outline-none"
                >
                  <option value="all">Filtro de Procedimento (Qualquer)</option>
                  {DEFAULT_TREATMENT_CATALOG.map(item => (
                    <option key={item.id} value={item.name}>{item.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Listed appointments table with columns requested (Part 4) */}
          <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/10">
              <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Agendamentos Clínicos Planejados ({filteredAppointments.length})</h4>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em]">Data / Hora</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em]">Paciente</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em]">Profissional Responsável</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em]">Cadeira / Sala</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em]">Procedimento e Categoria</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em] text-right">Valor Previsto</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em] text-right">Est. Comissão</th>
                    <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.14em] text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.map(apt => {
                    const mappedVal = getAppointmentValue(apt);
                    const mappedCat = getAppointmentCategory(apt);
                    
                    const pStaff = teamMembers.find(m => m.id === apt.staffId);
                    const isCommEst = pStaff ? estimateCommissionForAppointment(apt, pStaff, rules) : 0;
                    
                    const hasPlanned = apt.procedure && apt.procedure !== 'Procedimento não planejado' && apt.procedure !== '';

                    let parsedDate = '';
                    try {
                      if (apt.date) {
                        const [y, m, d] = apt.date.split('-');
                        parsedDate = `${d}/${m}/${y}`;
                      }
                    } catch(e) {}

                    return (
                      <tr key={apt.id} className="group hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 border-b border-slate-100">
                          <p className="text-xs font-black text-slate-800">{parsedDate || apt.date}</p>
                          <p className="text-[10px] text-slate-450 font-bold mt-0.5">{apt.time || 'Sem horário'}</p>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100">
                          <p className="text-xs font-black text-slate-900 uppercase truncate max-w-[150px]">{apt.patientName || 'Paciente sem Nome'}</p>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${
                            apt.status === 'confirmado' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                            apt.status === 'pendente' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                            apt.status === 'finalizado' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {statusMap[apt.status] || apt.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100">
                          <p className="text-xs font-bold text-slate-800">{apt.staffName || 'Não Atribuído'}</p>
                          <p className="text-[9px] text-indigo-500 font-bold uppercase tracking-wider">{pStaff?.role || 'Apoio'}</p>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100">
                          <p className="text-xs font-medium text-slate-650">{apt.chair || 'Consultório 1'}</p>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100">
                          {hasPlanned ? (
                            <>
                              <p className="text-xs font-black text-slate-800">{apt.procedure}</p>
                              <p className="text-[9px] text-teal-600 font-bold">{mappedCat}</p>
                            </>
                          ) : (
                            <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100 inline-block animate-pulse">
                              Procedimento não planejado
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100 text-right">
                          <p className="text-xs font-black text-slate-900">R$ {mappedVal.toLocaleString('pt-BR')}</p>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100 text-right">
                          <p className="text-xs font-black text-teal-650">R$ {isCommEst.toLocaleString('pt-BR')}</p>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-100 text-right">
                          {!hasPlanned ? (
                            <button
                              onClick={() => handleOpenPlanProcedure(apt)}
                              className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                            >
                              Planejar procedimento
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenPlanProcedure(apt)}
                              className="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-slate-505 hover:bg-slate-100 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all"
                            >
                              Remodelar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAppointments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-slate-400 italic text-xs font-semibold">
                        Nenhum agendamento encontrado para os filtros selecionados neste intervalo da agenda líquida.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && activeSubTab === 'ai' && (
        <div className="space-y-10">
          <div className="bg-indigo-600 rounded-[48px] p-12 text-white relative overflow-hidden shadow-2xl shadow-indigo-600/20">
            <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10 flex flex-col items-center text-center max-w-2xl mx-auto">
              <div className="w-16 h-16 bg-white/15 backdrop-blur-md rounded-3xl flex items-center justify-center mb-6 ring-1 ring-white/20">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-3xl font-black tracking-tight mb-4 text-white">Planejamento Inteligente ELIZA</h2>
              <p className="text-indigo-100 font-medium text-sm leading-relaxed mb-6">
                Deixe que a ELIZA avalie o fluxo previsto dos agendamentos, comissões pendentes e repasses para gerar as prioridades ideais de caixa e faturamento estimado!
              </p>

              {/* Dynamic stats showing what was fed to AI */}
              <div className="flex flex-wrap justify-center gap-6 mb-10 text-xs">
                <span className="bg-white/10 px-3 py-1.5 rounded-xl text-white font-bold">
                  Agendas Mapeadas: {appointments.length} consultórios
                </span>
                <span className="bg-white/10 px-3 py-1.5 rounded-xl text-white font-bold">
                  Previsto Geral: R$ {forecastedRevenueTotal.toLocaleString('pt-BR')}
                </span>
              </div>

              <button 
                disabled={aiLoading}
                onClick={handleGetAIEvaluation}
                className="group bg-white text-indigo-600 px-10 py-5 rounded-[28px] font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 fill-indigo-600" />}
                {aiPlan ? 'Atualizar Diagnóstico de IA' : 'Gerar Planejamento Inteligente com IA'}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {aiPlan && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-10"
              >
                {/* Action Plans */}
                <div className="space-y-8">
                  <div className="bg-white border border-slate-200 rounded-[40px] p-10 shadow-sm">
                    <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-3 mb-8">
                      <Target className="w-6 h-6 text-indigo-600" />
                      Planos de Ação Sugeridos
                    </h3>
                    
                    <div className="space-y-6">
                      {['7 Dias', '15 Dias', '30 Dias'].map((period, i) => (
                        <div key={period} className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                          <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-3">{period}</p>
                          <p className="text-sm font-semibold text-slate-700 leading-relaxed">
                            {aiPlan.ActionPlans?.[period] || aiPlan.action_plan?.[period] || aiPlan["Plano de Ação"]?.[period] || "Análise indisponível. Focar na otimização de horários e planejamento clínico."}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Priorities */}
                  <div className="bg-white border border-slate-200 rounded-[40px] p-10 shadow-sm">
                    <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-3 mb-8">
                      <ShieldCheck className="w-6 h-6 text-emerald-600" />
                      Prioridades de Pagamento e Caixa
                    </h3>
                    <ul className="space-y-4">
                      {(aiPlan.Priorities || aiPlan.prioridades || ["Garantir recebimento integral de procedimentos agendados sem valor.", "Liberar comissões de atendimentos finalizados de forma imediata."]).map((item: string, i: number) => (
                        <li key={i} className="flex items-start gap-4">
                          <div className="w-6 h-6 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                             <CheckCircle2 className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-bold text-slate-700">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Calculations & Scenarios */}
                <div className="space-y-8">
                  <div className="bg-slate-900 rounded-[40px] p-10 shadow-xl text-white">
                    <h3 className="text-lg font-black tracking-tight flex items-center gap-3 mb-10">
                      <TrendingUp className="w-6 h-6 text-indigo-400" />
                      Cenários de Faturamento (Previsão Geral)
                    </h3>

                    <div className="space-y-8">
                      {[
                        { label: 'Cenário Conservador (Apenas Finalizados)', key: 'conservative', val: forecastedRevenueTotal * 0.7 },
                        { label: 'Cenário Provável (Atendimentos Confirmados)', key: 'probable', val: forecastedRevenueTotal * 0.9 },
                        { label: 'Cenário Otimista (Confirmados + Encaixes)', key: 'optimistic', val: forecastedRevenueTotal * 1.15 }
                      ].map(scenario => (
                        <div key={scenario.key}>
                          <div className="flex items-center justify-between mb-4">
                             <p className="text-[10px] font-black uppercase tracking-widest opacity-60 font-mono">{scenario.label}</p>
                             <p className="text-xl font-black tracking-tight italic text-indigo-200">
                               R$ {scenario.val.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                             </p>
                          </div>
                          <div className="h-3 w-full bg-white/10 rounded-full overflow-hidden">
                             <motion.div 
                               initial={{ width: 0 }}
                               animate={{ width: scenario.key === 'conservative' ? '45%' : scenario.key === 'probable' ? '70%' : '100%' }}
                               className={`h-full ${scenario.key === 'conservative' ? 'bg-rose-500' : scenario.key === 'probable' ? 'bg-indigo-500' : 'bg-emerald-500'}`}
                             ></motion.div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-12 p-6 bg-white/5 rounded-2xl border border-white/10">
                       <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mb-2">Diagnóstico de Planejamento da Clínica</p>
                       <p className="text-xs font-semibold leading-relaxed text-indigo-100">
                          {aiPlan.RiskAssessment || aiPlan.diagnostico_risco || "Fluxo mapeado com êxito. Identificamos procedimentos pendentes de precificação que podem expandir o faturamento da semana."}
                       </p>
                    </div>
                  </div>

                  {/* Focus on Collections or empty slots */}
                  <div className="bg-white border border-slate-200 rounded-[40px] p-10 shadow-sm">
                    <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-3 mb-8">
                      <Target className="w-6 h-6 text-amber-500" />
                      Foco Prioritário de Caixa
                    </h3>
                    <div className="space-y-4">
                      {(aiPlan.CollectionFocus || aiPlan.foco_cobranca || [
                        `Precificar os ${proceduresWithoutValueCount} procedimentos agendados sem valor definido para resguardar o pro-labore.`,
                        `Vincular tratamentos definitivos para os ${patientsWithoutProcedureCount} agendamentos com procedimento não planejado.`
                      ]).map((item: string, i: number) => (
                        <div key={i} className="flex items-center gap-4 p-4 bg-amber-50/50 rounded-2xl border border-amber-50">
                           <AlertCircle className="w-5 h-5 text-amber-600" />
                           <span className="text-sm font-bold text-slate-750">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Planejar Procedimento modal dialog */}
      {showPlanningModal && selectedApt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 relative"
          >
            <button 
              onClick={() => {
                setShowPlanningModal(false);
                setSelectedApt(null);
              }}
              className="absolute top-6 right-6 p-1 text-slate-400 hover:text-slate-650 hover:bg-slate-100 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-black text-slate-900 tracking-tight">Planejar Procedimento Clínico</h3>
            <p className="text-xs text-slate-400 font-medium mb-6">Associe um procedimento e valor estimado de pro-labore ao agendamento de <strong className="text-slate-800 uppercase">{selectedApt.patientName}</strong>.</p>

            <div className="space-y-5">
              {/* Select procedure */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Selecione o Procedimento do Catálogo</label>
                <select
                  value={selectedProcedureName}
                  onChange={e => handleProcedureDropdownChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all"
                >
                  {DEFAULT_TREATMENT_CATALOG.map(item => (
                    <option key={item.id} value={item.name}>{item.name} ({item.category})</option>
                  ))}
                </select>
              </div>

              {/* Show Category */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Categoria Mapeada</label>
                <input
                  type="text"
                  disabled
                  value={selectedProcedureCategory}
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-500 outline-none"
                />
              </div>

              {/* Price field */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Valor Previsto (R$)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={estimatedValue}
                    onChange={e => setEstimatedValue(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400">R$</span>
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={() => {
                  setShowPlanningModal(false);
                  setSelectedApt(null);
                }}
                className="flex-1 py-3 text-slate-400 font-bold text-[10px] uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleSavePlannedProcedure}
                className="flex-1 py-3 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-650/10 transition"
              >
                Salvar Planejamento
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
