import React, { useState, useEffect } from 'react';
import { 
  Users, 
  DollarSign, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Filter, 
  MoreHorizontal,
  ChevronRight,
  TrendingUp,
  Search,
  Calendar,
  Wallet,
  ArrowUpRight,
  AlertCircle,
  Briefcase,
  Layers,
  Award,
  Check
} from 'lucide-react';
import { collection, query, onSnapshot, where, orderBy, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Commission, CommissionStatus } from '../../types/finance';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DEFAULT_TREATMENT_CATALOG, TREATMENT_CATEGORIES } from '../../data/treatmentCatalog';

const parseDate = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val.seconds) {
    return new Date(val.seconds * 1000);
  }
  return new Date(val);
};

export default function CommissionsView() {
  const { clinic } = useAuth();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<CommissionStatus | 'all'>('all');
  
  // View mode switcher: 'lists' (Geral) or 'professional' (Relatório por Profissional)
  const [activeView, setActiveView] = useState<'lists' | 'professional'>('professional');
  
  // Date & Member Filters for Professional report
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<string>('all');

  // Extra filters (Part 6)
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCommissionStatus, setSelectedCommissionStatus] = useState<string>('all');
  const [selectedProcedure, setSelectedProcedure] = useState<string>('all');

  // Load team members
  useEffect(() => {
    if (!clinic) return;
    const teamPath = `clinics/${clinic.id}/team_members`;
    const unsub = onSnapshot(collection(db, teamPath), (snap) => {
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("Error loading team members:", err);
    });
    return () => unsub();
  }, [clinic]);

  // Load commissions
  useEffect(() => {
    if (!clinic) return;

    const commissionsPath = `clinics/${clinic.id}/commissions`;
    let q = query(
      collection(db, 'clinics', clinic.id, 'commissions'),
      orderBy('generated_at', 'desc'),
      limit(250)
    );

    if (filterStatus !== 'all' && activeView === 'lists') {
      q = query(q, where('status', '==', filterStatus));
    }

    const unsub = onSnapshot(q, (snap) => {
      setCommissions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Commission)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, commissionsPath);
      setLoading(false);
    });

    return () => unsub();
  }, [clinic, filterStatus, activeView]);

  const handleUpdateStatus = async (id: string, status: CommissionStatus) => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/commissions/${id}`;
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'commissions', id), {
        status,
        updated_at: serverTimestamp(),
        paid_at: status === 'paid' ? serverTimestamp() : null
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  };

  // Bulk update commissions for the active filters
  const handleBulkUpdateStatus = async (fromStatus: CommissionStatus | 'any', toStatus: CommissionStatus) => {
    if (!clinic) return;
    
    const targets = filteredCommissionsForReport.filter(c => fromStatus === 'any' || c.status === fromStatus);
    
    if (targets.length === 0) {
      alert("Nenhuma comissão elegível para atualização no período e profissional selecionado.");
      return;
    }

    const message = toStatus === 'approved' 
      ? `Aprovar todas as ${targets.length} comissões deste profissional?`
      : `Marcar todas as ${targets.length} comissões prontas como PAGAS para este profissional?`;

    if (!confirm(message)) return;

    try {
      setLoading(true);
      for (const c of targets) {
        await updateDoc(doc(db, 'clinics', clinic.id, 'commissions', c.id), {
          status: toStatus,
          updated_at: serverTimestamp(),
          paid_at: toStatus === 'paid' ? serverTimestamp() : null
        });
      }
      alert(`Atualizadas ${targets.length} comissões com sucesso!`);
    } catch (err) {
      console.error("Bulk update failed:", err);
      alert("Falha ao atualizar comissões em lote.");
    } finally {
      setLoading(false);
    }
  };

  const totals = {
    pending: commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + c.commission_amount, 0),
    paid: commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + c.commission_amount, 0),
    approved: commissions.filter(c => c.status === 'approved').reduce((sum, c) => sum + c.commission_amount, 0),
  };

  const statusMap: Record<CommissionStatus, { label: string, color: string, bg: string, icon: any }> = {
    pending: { label: 'Pendente', color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
    approved: { label: 'Aprovada', color: 'text-indigo-600', bg: 'bg-indigo-50', icon: CheckCircle2 },
    paid: { label: 'Pago', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: Wallet },
    canceled: { label: 'Cancelada', color: 'text-rose-600', bg: 'bg-rose-50', icon: XCircle },
    on_hold: { label: 'Em espera', color: 'text-slate-500', bg: 'bg-slate-50', icon: AlertCircle }
  };

  const typeMap = {
    sale: { label: 'Venda', icon: Briefcase },
    recovery: { label: 'Recuperação', icon: TrendingUp },
    procedure: { label: 'Procedimento', icon: ArrowUpRight },
    fixed: { label: 'Fixo', icon: Wallet },
    tiered: { label: 'Progressivo', icon: TrendingUp },
    custom: { label: 'Personalizado', icon: MoreHorizontal }
  };

  const monthsBr = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  // Professional Report filtering logic
  const filteredCommissionsForReport = commissions.filter(c => {
    // 1. Filter by professional
    if (selectedMemberId !== 'all' && c.member_id !== selectedMemberId) {
      return false;
    }

    // Convert date
    const dateObj = parseDate(c.generated_at);
    
    // 2. Filter by Year
    if (dateObj.getFullYear() !== selectedYear) return false;

    // 3. Filter by Month
    if (dateObj.getMonth() !== selectedMonth) return false;

    // 4. Filter by Day
    if (selectedDay !== 'all' && dateObj.getDate() !== Number(selectedDay)) return false;

    // 5. Filter by Status (Part 6)
    if (selectedCommissionStatus !== 'all' && c.status !== selectedCommissionStatus) {
      return false;
    }

    const norm = (s: string) => String(s || '').toLowerCase().trim();
    const notesStr = String(c.notes || '').toLowerCase();

    // 6. Filter by Category (Part 6)
    if (selectedCategory !== 'all') {
      const categoryToMatch = norm(selectedCategory);
      // Check notes or match via catalog
      const hasCatInNotes = notesStr.includes(`categoria: ${categoryToMatch}`) || notesStr.includes(categoryToMatch);
      let matchCatalog = false;
      if (!hasCatInNotes) {
        matchCatalog = DEFAULT_TREATMENT_CATALOG.some(item => norm(item.category) === categoryToMatch && notesStr.includes(norm(item.name)));
      }
      if (!hasCatInNotes && !matchCatalog) return false;
    }

    // 7. Filter by Procedure (Part 6)
    if (selectedProcedure !== 'all') {
      const procedureToMatch = norm(selectedProcedure);
      const hasProcInNotes = notesStr.includes(procedureToMatch);
      if (!hasProcInNotes) return false;
    }

    return true;
  });

  // Calculate stats for active selection
  const reportStats = {
    performedCount: filteredCommissionsForReport.length,
    totalBase: filteredCommissionsForReport.reduce((sum, c) => sum + (c.base_amount || 0), 0),
    totalCommission: filteredCommissionsForReport.reduce((sum, c) => sum + (c.commission_amount || 0), 0),
    pendingCommission: filteredCommissionsForReport.filter(c => c.status === 'pending').reduce((sum, c) => sum + c.commission_amount, 0),
    approvedCommission: filteredCommissionsForReport.filter(c => c.status === 'approved').reduce((sum, c) => sum + c.commission_amount, 0),
    paidCommission: filteredCommissionsForReport.filter(c => c.status === 'paid').reduce((sum, c) => sum + c.commission_amount, 0),
  };

  return (
    <div className="space-y-10">
      {/* View Selector Mode Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
         <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Painel de Comissões</h2>
            <p className="text-xs text-slate-400 font-medium mt-1">Gerencie comissionamentos, acompanhe a produção por colaboradores e execute pagamentos rápidos.</p>
         </div>
         <div className="flex bg-slate-100 p-1 rounded-2xl w-fit shrink-0">
           <button 
             onClick={() => setActiveView('professional')}
             className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${activeView === 'professional' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
           >
             <Award className="w-4 h-4 text-emerald-600" /> Relatório por Profissional
           </button>
           <button 
             onClick={() => setActiveView('lists')}
             className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${activeView === 'lists' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
           >
             <Layers className="w-4 h-4" /> Todos os Lançamentos
           </button>
         </div>
      </div>

      {loading && (
        <div className="py-20 text-center text-slate-400 font-bold text-xs uppercase tracking-widest">
           Carregando dados financeiros...
        </div>
      )}

      {!loading && activeView === 'lists' && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
               <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                     <Clock className="w-5 h-5" />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pendentes</p>
               </div>
               <p className="text-3xl font-black text-slate-900 tracking-tighter">R$ {totals.pending.toLocaleString('pt-BR')}</p>
               <p className="text-[10px] text-slate-400 mt-2 font-medium">Aguardando aprovação</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
               <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                     <Wallet className="w-5 h-5" />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pagos no Mês</p>
               </div>
               <p className="text-3xl font-black text-slate-900 tracking-tighter">R$ {totals.paid.toLocaleString('pt-BR')}</p>
               <p className="text-[10px] text-slate-400 mt-2 font-medium">Comissão liquidada</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
               <div className="flex items-center gap-3 mb-4 text-slate-400">
                  <Users className="w-5 h-5" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Colaboradores</p>
               </div>
               <p className="text-3xl font-black text-slate-900 tracking-tighter">{new Set(commissions.map(c => c.member_id)).size}</p>
               <p className="text-[10px] text-slate-400 mt-2 font-medium">Com comissões registradas</p>
            </div>

            <div className="bg-indigo-600 rounded-[32px] p-8 shadow-lg shadow-indigo-600/30 text-white">
               <div className="flex items-center gap-3 mb-4 opacity-80">
                  <TrendingUp className="w-5 h-5" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Total Previsto</p>
               </div>
               <p className="text-3xl font-black tracking-tighter">R$ {(totals.pending + totals.approved).toLocaleString('pt-BR')}</p>
               <p className="text-[10px] mt-2 font-medium opacity-80">Próximas liberações</p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-white border border-slate-200 rounded-3xl h-20 flex items-center px-8 shadow-sm gap-6">
            <div className="relative flex-1">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
              <input 
                className="w-full bg-transparent border-none text-sm font-bold placeholder:text-slate-300 focus:ring-0 pl-8"
                placeholder="Buscar colaboradores na lista geral..."
              />
            </div>
            
            <div className="flex items-center gap-2">
              {Object.entries(statusMap).map(([status, config]) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status as any)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filterStatus === status ? config.bg + ' ' + config.color : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {config.label}
                </button>
              ))}
              <button onClick={() => setFilterStatus('all')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filterStatus === 'all' ? 'bg-slate-900 text-white' : 'text-slate-400'}`}>
                Tudo
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-[40px] overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Data</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Colaborador</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Origem / Tipo</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Base</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Comissão</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Status</th>
                  <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100"></th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => {
                  const statusConfig = statusMap[c.status];
                  const typeConfig = typeMap[c.commission_type] || typeMap.custom;
                  return (
                    <tr key={c.id} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-6 border-b border-slate-50">
                        <p className="text-sm font-bold text-slate-900">{format(parseDate(c.generated_at), 'dd MMM', { locale: ptBR })}</p>
                        <p className="text-[10px] text-slate-400 font-medium">#{c.id.slice(-6)}</p>
                      </td>
                      <td className="px-8 py-6 border-b border-slate-50">
                        <p className="text-sm font-bold text-slate-900">{c.member_name}</p>
                        <p className="text-[10px] text-indigo-600 font-black uppercase tracking-tighter">Responsável</p>
                      </td>
                      <td className="px-8 py-6 border-b border-slate-50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center shrink-0">
                             <typeConfig.icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-900 uppercase">Paciente: {c.patient_name || 'N/A'}</p>
                            <p className="text-[10px] text-slate-400 font-medium">{typeConfig.label}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6 border-b border-slate-50">
                        <p className="text-sm font-black text-slate-900 tracking-tighter">R$ {c.base_amount.toLocaleString('pt-BR')}</p>
                        {c.percentage && <p className="text-[10px] text-slate-400 font-bold uppercase">{c.percentage}% aplicados</p>}
                      </td>
                      <td className="px-8 py-6 border-b border-slate-50">
                        <p className="text-sm font-black text-teal-600 tracking-tighter">R$ {c.commission_amount.toLocaleString('pt-BR')}</p>
                      </td>
                      <td className="px-8 py-6 border-b border-slate-50">
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${statusConfig.bg} ${statusConfig.color}`}>
                          <statusConfig.icon className="w-3 h-3" />
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-8 py-6 border-b border-slate-50 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {c.status === 'pending' && (
                            <button 
                              onClick={() => handleUpdateStatus(c.id, 'approved')}
                              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                              title="Aprovar"
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                          )}
                          {c.status === 'approved' && (
                            <button 
                              onClick={() => handleUpdateStatus(c.id, 'paid')}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                              title="Marcar como Pago"
                            >
                              <Wallet className="w-5 h-5" />
                            </button>
                          )}
                          <button className="p-2 text-slate-300 hover:text-slate-600 rounded-lg">
                            <MoreHorizontal className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {commissions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 text-xs italic font-medium">Nenhuma comissão registrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && activeView === 'professional' && (
        <div className="space-y-8">
          {/* Specialized Interactive Filter Engine Block */}
          <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm space-y-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Filter className="w-4 h-4 text-emerald-600" /> Organizar Procedimentos e Recebimentos por Profissionais
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Professional Select */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador / Profissional</label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold"
                >
                  <option value="all">Apenas Profissionais Comissionáveis</option>
                  {teamMembers
                    .filter(m => {
                      const isProf = m.isProfessional ?? (m.role === 'dentist' || m.role === 'doctor');
                      const isComm = m.isCommissionable ?? (m.commission_enabled !== false);
                      const isActive = m.active !== false;
                      return isProf && isComm && isActive;
                    })
                    .map(m => (
                      <option key={m.id} value={m.id}>{m.displayName || m.name} ({m.role === 'dentist' ? 'Dentista' : m.role === 'doctor' ? 'Médico' : m.role})</option>
                    ))
                  }
                </select>
              </div>

              {/* Year Select */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ano</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold font-mono"
                >
                  <option value={2026}>2026</option>
                  <option value={2025}>2025</option>
                  <option value={2024}>2024</option>
                </select>
              </div>

              {/* Month Select */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mês</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold"
                >
                  {monthsBr.map((m, idx) => (
                    <option key={idx} value={idx}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Day Select */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dia do Mês</label>
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold font-mono"
                >
                  <option value="all">Todos os Dias</option>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1)).map(day => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </div>

              {/* Category Select (Part 6) */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Categoria</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold"
                >
                  <option value="all">Todas as Categorias</option>
                  {TREATMENT_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Status Select (Part 6) */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status da Comissão</label>
                <select
                  value={selectedCommissionStatus}
                  onChange={(e) => setSelectedCommissionStatus(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold"
                >
                  <option value="all">Todos os Status</option>
                  <option value="pending">Pendente</option>
                  <option value="approved">Aprovada</option>
                  <option value="paid">Pago</option>
                  <option value="canceled">Cancelada</option>
                  <option value="on_hold">Em Espera</option>
                </select>
              </div>

              {/* Procedure Select (Part 6) */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Procedimento</label>
                <select
                  value={selectedProcedure}
                  onChange={(e) => setSelectedProcedure(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold"
                >
                  <option value="all font-semibold">Qualquer Procedimento Cadastrado</option>
                  {DEFAULT_TREATMENT_CATALOG.map(item => (
                    <option key={item.id} value={item.name}>{item.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Metrics for filtered report */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
               <h5 className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-3">Produção / Realizado</h5>
               <p className="text-2xl font-black text-slate-800 tracking-tight">R$ {reportStats.totalBase.toLocaleString('pt-BR')}</p>
               <p className="text-[10px] text-slate-400 font-medium mt-1">Valor base de {reportStats.performedCount} procedimentos</p>
            </div>

            <div className="bg-amber-50/50 border border-amber-200 rounded-[32px] p-8 shadow-sm">
               <h5 className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-3">A Liberar (Pendente)</h5>
               <p className="text-2xl font-black text-amber-700 tracking-tight">R$ {reportStats.pendingCommission.toLocaleString('pt-BR')}</p>
               <p className="text-[10px] text-amber-500 font-bold mt-1">Aguardando aprovação</p>
            </div>

            <div className="bg-indigo-50 border border-indigo-200 rounded-[32px] p-8 shadow-sm">
               <h5 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3">Pronto p/ Pagar (Aprovadas)</h5>
               <p className="text-2xl font-black text-indigo-700 tracking-tight">R$ {reportStats.approvedCommission.toLocaleString('pt-BR')}</p>
               <p className="text-[10px] text-indigo-500 font-bold mt-1">Comissões aprovadas</p>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-[32px] p-8 shadow-sm">
               <h5 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-3">Comissão Paga</h5>
               <p className="text-2xl font-black text-emerald-700 tracking-tight">R$ {reportStats.paidCommission.toLocaleString('pt-BR')}</p>
               <p className="text-[10px] text-emerald-500 font-bold mt-1">Comissões liquidadas</p>
            </div>
          </div>

          {/* Action Bulk triggers for ease of payments */}
          {selectedMemberId !== 'all' && (
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-slate-50 border border-slate-100 p-6 rounded-3xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-lg flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">
                    Facilitador de Pagamentos: {teamMembers.find(t => t.id === selectedMemberId)?.name || "Colaborador"}
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold font-sans mt-0.5">
                    Período selecionado: {selectedDay !== 'all' ? `${selectedDay} de ` : ''}{monthsBr[selectedMonth]} de {selectedYear}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => handleBulkUpdateStatus('pending', 'approved')}
                  disabled={reportStats.pendingCommission <= 0}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-indigo-650 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all shadow-sm"
                >
                  Aprovar Todas do Período
                </button>
                <button
                  onClick={() => handleBulkUpdateStatus('approved', 'paid')}
                  disabled={reportStats.approvedCommission <= 0}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all shadow-sm"
                >
                  Marcar Todas como Pago
                </button>
              </div>
            </div>
          )}

          {/* List of Procedures / Commissions for Selected Professional */}
          <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
            <div className="p-8 border-b border-slate-100 bg-slate-50/20">
               <h4 className="text-sm font-black text-slate-700 uppercase tracking-tight">Recibos e Comissões Detalhadas</h4>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Data</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Profissional</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Paciente</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Valor Procedimento</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Fórmula / Comissão</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Status</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100"></th>
                </tr>
              </thead>
              <tbody>
                {filteredCommissionsForReport.map((c) => {
                  const statusConfig = statusMap[c.status];
                  return (
                    <tr key={c.id} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-5 border-b border-slate-50 font-mono font-bold text-xs text-slate-700">
                        {format(parseDate(c.generated_at), 'dd/MM/yyyy HH:mm')}
                      </td>
                      <td className="px-8 py-5 border-b border-slate-50 font-bold text-xs text-slate-800">
                        {c.member_name}
                      </td>
                      <td className="px-8 py-5 border-b border-slate-50 font-bold text-xs text-slate-800 uppercase">
                        {c.patient_name || "N/A"}
                      </td>
                      <td className="px-8 py-5 border-b border-slate-50 text-xs font-black text-slate-900 tracking-tighter">
                        R$ {c.base_amount.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-8 py-5 border-b border-slate-50 text-xs font-black text-teal-600 tracking-tighter">
                        R$ {c.commission_amount.toLocaleString('pt-BR')} {c.percentage ? `(${c.percentage}%)` : ''}
                      </td>
                      <td className="px-8 py-5 border-b border-slate-50">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${statusConfig.bg} ${statusConfig.color}`}>
                          <statusConfig.icon className="w-3 h-3" />
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-8 py-5 border-b border-slate-50 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {c.status === 'pending' && (
                            <button 
                              onClick={() => handleUpdateStatus(c.id, 'approved')}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded-lg transition-all"
                              title="Aprovar"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          {c.status === 'approved' && (
                            <button 
                              onClick={() => handleUpdateStatus(c.id, 'paid')}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 border border-emerald-200 rounded-lg transition-all"
                              title="Pagar"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredCommissionsForReport.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-450 text-xs italic font-semibold">
                      Nenhum procedimento ou recebimento encontrado para os critérios selecionados nesta busca.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
