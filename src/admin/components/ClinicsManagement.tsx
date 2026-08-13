import React, { useState } from 'react';
import { 
  Building2, 
  Search, 
  Settings, 
  Eye, 
  ShieldAlert,
  ChevronRight,
  TrendingUp,
  MoreVertical,
  ExternalLink,
  Activity,
  Loader2,
  Plus,
  X,
  User,
  Mail,
  Phone,
  FileText
} from 'lucide-react';
import { useAdmin } from '../../contexts/AdminContext';

interface ClinicSummary {
  id: string;
  name: string;
  ownerName?: string;
  ownerEmail?: string;
  phone?: string;
  planId?: string;
  status?: string;
  patientCount?: number;
  userCount?: number;
  createdAt?: any;
  lastActivity?: any;
}

export default function ClinicsManagement() {
  const {
    clinics,
    enterSupportMode,
    isLoading,
    createClinic,
    updateClinicStatus,
    updateClinicPlan,
    addClinicSupportNote,
    plans
  } = useAdmin();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isJumping, setIsJumping] = useState<string | null>(null);

  // Modal / Form states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState<any | null>(null);
  const [showPlanModal, setShowPlanModal] = useState<any | null>(null);
  const [showNoteModal, setShowNoteModal] = useState<any | null>(null);

  // New Clinic Form state
  const [newClinicName, setNewClinicName] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [newStatus, setNewStatus] = useState('trial');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mutation states
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [noteText, setNoteText] = useState('');
  const [isActionPending, setIsActionPending] = useState(false);

  const activePlans = plans.filter((p: any) => p.active !== false);
  const statusList = ['active', 'trial', 'blocked', 'suspended', 'cancelled', 'internal'];

  const filteredClinics = clinics.filter((c: ClinicSummary) => 
    c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.ownerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSupportMode = async (clinicId: string) => {
    setIsJumping(clinicId);
    try {
      await enterSupportMode(clinicId);
    } catch (err) {
      console.error("Failed to enter support mode", err);
    } finally {
      setIsJumping(null);
    }
  };

  const handleCreateClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClinicName || !newOwnerEmail) return;
    setIsSubmitting(true);
    try {
      await createClinic({
        name: newClinicName,
        ownerName: newOwnerName,
        ownerEmail: newOwnerEmail,
        phone: newPhone,
        planId: newPlanId,
        status: newStatus
      });
      // Reset form
      setNewClinicName('');
      setNewOwnerName('');
      setNewOwnerEmail('');
      setNewPhone('');
      setNewPlanId('trial');
      setNewStatus('trial');
      setShowCreateModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveStatus = async () => {
    if (!showStatusModal) return;
    setIsActionPending(true);
    try {
      await updateClinicStatus(showStatusModal.id, selectedStatus);
      setShowStatusModal(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsActionPending(false);
    }
  };

  const handleSavePlan = async () => {
    if (!showPlanModal) return;
    setIsActionPending(true);
    try {
      await updateClinicPlan(showPlanModal.id, selectedPlan);
      setShowPlanModal(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsActionPending(false);
    }
  };

  const handleSaveNote = async () => {
    if (!showNoteModal || !noteText.trim()) return;
    setIsActionPending(true);
    try {
      await addClinicSupportNote(showNoteModal.id, noteText);
      setNoteText('');
      setShowNoteModal(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsActionPending(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Gerenciamento de Clínicas</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Controle de unidades e assinaturas ELIZA</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="PESQUISAR CLÍNICA OU E-MAIL..."
              className="pl-11 pr-6 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all w-full"
            />
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-teal-600/15 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Nova Clínica
          </button>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 flex items-center justify-between">
            <div>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Clinicas Ativas</p>
               <h3 className="text-xl font-black text-slate-900">{clinics.filter(c => c.status === 'active' || c.status === 'ativo').length}</h3>
            </div>
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
               <TrendingUp className="w-5 h-5" />
            </div>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 flex items-center justify-between">
            <div>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Em Teste (Trial)</p>
               <h3 className="text-xl font-black text-slate-900">{clinics.filter(c => c.status === 'trial').length}</h3>
            </div>
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
               <Activity className="w-5 h-5" />
            </div>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 flex items-center justify-between">
            <div>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Bloqueadas / Suspensas</p>
               <h3 className="text-xl font-black text-rose-600">{clinics.filter(c => c.status === 'blocked' || c.status === 'suspended').length}</h3>
            </div>
            <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
               <ShieldAlert className="w-5 h-5" />
            </div>
         </div>
      </div>

      {/* Main Clinics Grid */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Clínica / Unidade', 'Proprietário', 'Plano', 'Status', 'WhatsApp', 'Ações'].map((h) => (
                  <th key={h} className="px-8 py-5 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClinics.length > 0 ? filteredClinics.map((clinic) => (
                <tr key={clinic.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-teal-50 text-teal-700 rounded-xl flex items-center justify-center font-black text-xs">
                        {clinic.name ? clinic.name[0]?.toUpperCase() : 'C'}
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{clinic.name}</p>
                        <p className="text-[9px] text-slate-400 font-mono">ID: {clinic.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">{clinic.ownerName || 'Sem Proprietário'}</p>
                    <p className="text-[9px] text-slate-400 font-medium">{clinic.ownerEmail}</p>
                  </td>
                  <td className="px-8 py-6">
                    <span className="px-3 py-1 bg-slate-100 text-[9px] font-black uppercase text-slate-500 rounded-lg">{clinic.planId || clinic.plan || 'Standard'}</span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        clinic.status === 'active' || clinic.status === 'ativo' ? 'bg-emerald-500' : 
                        clinic.status === 'trial' ? 'bg-blue-500' : 'bg-rose-500'
                      } animate-pulse`}></div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${
                        clinic.status === 'active' || clinic.status === 'ativo' ? 'text-emerald-600' : 
                        clinic.status === 'trial' ? 'text-blue-600' : 'text-rose-600'
                      }`}>{clinic.status}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${clinic.whatsappStatus === 'connected' ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                        {clinic.whatsappStatus === 'connected' ? 'Ativo' : 'Offline'}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={() => handleSupportMode(clinic.id)}
                         disabled={isJumping !== null}
                         className="p-2 bg-slate-50 hover:bg-teal-50 hover:text-teal-600 text-slate-400 rounded-lg border border-transparent hover:border-teal-100 transition-all disabled:opacity-50" 
                         title="Abrir como Suporte"
                       >
                         {isJumping === clinic.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                       </button>

                       {/* Status changer */}
                       <button 
                         onClick={() => {
                           setShowStatusModal(clinic);
                           setSelectedStatus(clinic.status || 'trial');
                         }}
                         className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-transparent hover:border-slate-200 transition-all"
                         title="Alterar Status"
                       >
                         <Settings className="w-4 h-4" />
                       </button>

                       {/* Plan changer */}
                       <button 
                         onClick={() => {
                           setShowPlanModal(clinic);
                           setSelectedPlan(clinic.planId || clinic.plan || 'trial');
                         }}
                         className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-transparent hover:border-slate-200 transition-all"
                         title="Alterar Plano"
                       >
                         <FileText className="w-4 h-4" />
                       </button>

                       {/* Add Note */}
                       <button 
                         onClick={() => {
                           setShowNoteModal(clinic);
                           setNoteText('');
                         }}
                         className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-transparent hover:border-slate-200 transition-all font-black text-[9px] uppercase tracking-tighter"
                         title="Criar Nota de Suporte"
                       >
                         Nota
                       </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center opacity-30">
                    <Building2 className="w-12 h-12 mx-auto mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nenhuma clínica encontrada para este filtro</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- CREATE CLINIC MODAL --- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Nova Unidade / Clínica</h3>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Cadastro Geral do Sistema</p>
                </div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateClinic} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Nome da Clínica</label>
                  <input 
                    required
                    value={newClinicName}
                    onChange={(e) => setNewClinicName(e.target.value)}
                    placeholder="EX: ODONTO EXPRESS"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Nome do Proprietário</label>
                  <input 
                    required
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    placeholder="EX: DR. JOÃO SILVA"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">E-mail Proprietário</label>
                  <input 
                    required
                    type="email"
                    value={newOwnerEmail}
                    onChange={(e) => setNewOwnerEmail(e.target.value)}
                    placeholder="EX: JOAO@CLINICA.COM"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Telefone Contato</label>
                  <input 
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="EX: +55 (11) 99999-9999"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Plano Inicial</label>
                  <select 
                    value={newPlanId}
                    onChange={(e) => setNewPlanId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
                  >
                    <option value="">-- SEM PLANO --</option>
                    {activePlans.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name?.toUpperCase()}</option>
                    ))}
                  </select>
                  {activePlans.length === 0 && (
                    <p className="text-[9px] text-amber-600 font-bold mt-1">Nenhum plano cadastrado ainda — crie um em "Assinaturas".</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Status Inicial</label>
                  <select 
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
                  >
                    {statusList.map(s => (
                      <option key={s} value={s}>{s.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 flex gap-4">
                <button 
                  type="button" 
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Cadastrando...' : 'Criar Unidade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ALTER STATUS MODAL --- */}
      {showStatusModal && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-md shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Alterar Status da Unidade</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{showStatusModal.name}</p>
            
            <div className="space-y-2">
              <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Novo Status</label>
              <select 
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
              >
                {statusList.map(s => (
                  <option key={s} value={s}>{s.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-4">
              <button onClick={() => setShowStatusModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-xl">Cancelar</button>
              <button onClick={handleSaveStatus} disabled={isActionPending} className="flex-1 py-3 bg-teal-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl disabled:opacity-50">
                {isActionPending ? 'Processando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ALTER PLAN MODAL --- */}
      {showPlanModal && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-md shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Alterar Plano da Unidade</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{showPlanModal.name}</p>
            
            <div className="space-y-2">
              <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Novo Plano</label>
              <select 
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
              >
                <option value="">-- SEM PLANO --</option>
                {activePlans.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name?.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-4">
              <button onClick={() => setShowPlanModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-xl">Cancelar</button>
              <button onClick={handleSavePlan} disabled={isActionPending} className="flex-1 py-3 bg-teal-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl disabled:opacity-50">
                {isActionPending ? 'Processando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ADD NOTE MODAL --- */}
      {showNoteModal && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-lg shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Adicionar Nota de Suporte</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{showNoteModal.name}</p>
            
            <div className="space-y-2">
              <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Texto da Nota</label>
              <textarea 
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Insira detalhes de auditoria técnica ou anotações de suporte..."
                rows={5}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all resize-none"
              />
            </div>

            <div className="flex gap-4">
              <button onClick={() => setShowNoteModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-xl">Cancelar</button>
              <button onClick={handleSaveNote} disabled={isActionPending || !noteText.trim()} className="flex-1 py-3 bg-teal-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl disabled:opacity-50">
                {isActionPending ? 'Salvando...' : 'Salvar Nota'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
