import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Search, Filter, Clock, ArrowRight, TrendingUp, Briefcase, 
  Star, Trash2, Edit, Check, X, ChevronRight, AlertCircle, 
  UploadCloud, FileText, MessageSquare, HelpCircle, Activity, 
  Phone, ArrowUpRight, Play, Square, Award, CheckCircle2, 
  XCircle, Sliders, Settings, Layers, DollarSign, ClipboardCheck, 
  User, Trophy, Sparkles, FolderOpen, Heart, Percent, LayoutDashboard
} from 'lucide-react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, getDocs, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';

// Interfaces
interface Lead {
  id: string;
  name: string;
  interest: string;
  value: number;
  status: 'new' | 'contacted' | 'scheduled' | 'negotiating';
  priority: 'high' | 'medium' | 'low';
  leadSource?: string;
  conversorId?: string;
  conversorName?: string;
  lastActivity?: any;
}

interface CommercialSaleCommission {
  id: string;
  patientId: string;
  patientName: string;
  quotationId: string;
  quotationTitle: string;
  value: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  type: 'novo' | 'reativado' | 'vip' | 'ativo' | 'indicacao' | 'outro';
  responsibleId: string;
  responsibleName: string;
  leadSource: string;
  commissionPercent: number;
  commissionValue: number;
  date: string;
  observation?: string;
  reviewNotes?: string;
  evidence?: {
    name: string;
    type: string;
    dataUrl: string;
  }[];
}

interface RecallOpportunity {
  id: string;
  patientId: string;
  patientName: string;
  lastProcedure: string;
  overdueMonths: number;
  status: 'Pendente' | 'Contato realizado' | 'Consulta agendada' | 'Orçamento aprovado' | 'Procedimento realizado' | 'Comissão gerada';
  updatedAt: string;
  notes?: string;
}

export default function CRMView() {
  const { clinic, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'funnel' | 'sales' | 'approvals' | 'collab' | 'ranking' | 'eliza_ai' | 'settings'>('funnel');
  
  // Dynamic State loaded from Firestore
  const [leads, setLeads] = useState<Lead[]>([]);
  const [commissions, setCommissions] = useState<CommercialSaleCommission[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [recalls, setRecalls] = useState<RecallOpportunity[]>([]);
  const [settings, setSettings] = useState<any>({
    novoPercent: 5,
    reativadoPercent: 3,
    reativadoVipPercent: 5,
    indicacaoPercent: 5,
    goal5: 100,
    goal10: 250,
    goal20: 500,
    goal30: 1000,
    leadSources: ['Instagram', 'Facebook', 'Google', 'WhatsApp', 'Site', 'Indicação', 'Paciente Antigo', 'Recall Inteligente', 'ELIZA IA', 'Outro']
  });

  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [isRequestCommissionOpen, setIsRequestCommissionOpen] = useState(false);
  const [selectedCollabId, setSelectedCollabId] = useState<string>('all');
  
  // Editing forms
  const [leadForm, setLeadForm] = useState({
    name: '', interest: 'Avaliação Geral', value: 0, priority: 'medium' as any, status: 'new' as any, leadSource: 'Instagram', conversorId: 'no_commission'
  });
  
  const [commissionForm, setCommissionForm] = useState({
    patientId: '', motive: 'Novo paciente' as any, description: '', value: 0, leadSource: 'WhatsApp', evidenceFile: null as any
  });

  const [editingCommissionId, setEditingCommissionId] = useState<string | null>(null);
  const [editCommFormData, setEditCommFormData] = useState<any>(null);
  const [commObs, setCommObs] = useState('');

  // Fallbacks for team and patient mapping
  const fallbackMembers = [
    { id: 'eliza_ia', name: 'ELIZA IA', role: 'Inteligência Artificial' },
    { id: 'michele', name: 'Michele', role: 'Consultora' },
    { id: 'nina', name: 'Nina', role: 'Recepcionista' },
    { id: 'janio', name: 'Janio', role: 'Gerente Comercial' },
    { id: 'no_commission', name: 'Sem Comissão', role: 'Nenhum' }
  ];

  const getCollabList = () => {
    const list = [...teamMembers];
    // Adicionar ELIZA IA e Sem Comissão se já não estiverem presentes
    if (!list.some(m => m.id === 'eliza_ia')) {
      list.push({ id: 'eliza_ia', name: 'ELIZA IA', role: 'Inteligência Artificial', active: true });
    }
    if (!list.some(m => m.id === 'no_commission')) {
      list.push({ id: 'no_commission', name: 'Sem Comissão', role: 'Sistema', active: true });
    }
    return list;
  };

  const getStaffMap = () => {
    const map: any = {};
    getCollabList().forEach(item => {
      map[item.id] = item.name;
    });
    return map;
  };

  // Bootstrap data loading
  useEffect(() => {
    if (!clinic) return;

    // 1. Loading Settings
    const unsubConfig = onSnapshot(doc(db, 'clinics', clinic.id, 'commercial_commissions_settings', 'config'), (snap) => {
      if (snap.exists()) {
        setSettings({ ...settings, ...snap.data() });
      }
    });

    // 2. Loading Leads
    const unsubLeads = onSnapshot(collection(db, 'clinics', clinic.id, 'leads'), (snap) => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() } as Lead)));
    });

    // 3. Loading Team Members
    const unsubTeam = onSnapshot(collection(db, 'clinics', clinic.id, 'team_members'), (snap) => {
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 4. Loading Patients list for selection
    const unsubPatients = onSnapshot(collection(db, 'clinics', clinic.id, 'patients'), (snap) => {
      setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 5. Loading Commercial Sale Commissions
    const unsubComms = onSnapshot(collection(db, 'clinics', clinic.id, 'commercial_sale_commissions'), (snap) => {
      setCommissions(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommercialSaleCommission)));
    });

    // 6. Loading Recall Opportunities and active overdue list
    const unsubRecall = onSnapshot(collection(db, 'clinics', clinic.id, 'commercial_recall_opportunities'), (snap) => {
      // If opportunities already exist, use them
      if (snap.size > 0) {
        setRecalls(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecallOpportunity)));
      } else {
        // Mock standard overdue list for initial visualization
        const mockRecalls: RecallOpportunity[] = [
          { id: 'rec-1', patientId: 'p-1', patientName: 'Guilherme Sampaio', lastProcedure: 'Preenchimento Hialurônico', overdueMonths: 8, status: 'Pendente', updatedAt: new Date().toISOString() },
          { id: 'rec-2', patientId: 'p-2', patientName: 'Regina Célia', lastProcedure: 'Toxina Botulínica', overdueMonths: 6, status: 'Contato realizado', updatedAt: new Date().toISOString() },
          { id: 'rec-3', patientId: 'p-3', patientName: 'Lucas Lima', lastProcedure: 'Rinomodelação', overdueMonths: 11, status: 'Consulta agendada', updatedAt: new Date().toISOString() }
        ];
        // Populate if empty to show recall integration directly to user!
        mockRecalls.forEach(async (r) => {
          await setDoc(doc(db, 'clinics', clinic.id, 'commercial_recall_opportunities', r.id), r);
        });
      }
    });

    return () => {
      unsubConfig();
      unsubLeads();
      unsubTeam();
      unsubPatients();
      unsubComms();
      unsubRecall();
    };
  }, [clinic]);

  // Handle addition of Lead
  const handleAddLead = async () => {
    if (!leadForm.name || !clinic) return;
    try {
      const selectedCollab = getCollabList().find(m => m.id === leadForm.conversorId);
      await addDoc(collection(db, 'clinics', clinic.id, 'leads'), {
        name: leadForm.name,
        interest: leadForm.interest,
        value: Number(leadForm.value),
        priority: leadForm.priority,
        status: leadForm.status,
        leadSource: leadForm.leadSource,
        conversorId: leadForm.conversorId,
        conversorName: selectedCollab ? selectedCollab.name : 'Sem Comissão',
        lastActivity: serverTimestamp(),
        createdAt: serverTimestamp()
      });
      setIsAddLeadOpen(false);
      setLeadForm({
        name: '', interest: 'Avaliação Geral', value: 0, priority: 'medium', status: 'new', leadSource: 'Instagram', conversorId: 'no_commission'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/leads`);
    }
  };

  // Move lead stage
  const moveLead = async (leadId: string, newStatus: any) => {
    if (!clinic) return;
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'leads', leadId), {
        status: newStatus,
        lastActivity: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/leads/${leadId}`);
    }
  };

  // Save admin edited settings
  const handleSaveSettings = async (updated: any) => {
    if (!clinic) return;
    try {
      await setDoc(doc(db, 'clinics', clinic.id, 'commercial_commissions_settings', 'config'), updated);
      setSettings(updated);
      alert('Configurações de comissão comercial atualizadas com sucesso!');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/commercial_commissions_settings/config`);
    }
  };

  // Update lead fields in cards
  const updateLeadField = async (leadId: string, field: string, val: any) => {
    if (!clinic) return;
    try {
      const payload: any = { [field]: val, lastActivity: serverTimestamp() };
      if (field === 'conversorId') {
        const c = getCollabList().find(m => m.id === val);
        payload.conversorName = c ? c.name : 'Sem Comissão';
      }
      await updateDoc(doc(db, 'clinics', clinic.id, 'leads', leadId), payload);
    } catch (err) {
      console.error(err);
    }
  };

  // Convert File to Base64 for evidence storage
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setCommissionForm(prev => ({
        ...prev,
        evidenceFile: {
          name: file.name,
          type: file.type,
          dataUrl: reader.result as string
        }
      }));
    };
    reader.readAsDataURL(file);
  };

  // Collaborator Requests Commission Participation
  const handleRequestCommission = async () => {
    if (!clinic || !commissionForm.patientId) return;
    try {
      const pat = patients.find(p => p.id === commissionForm.patientId) || { name: 'Paciente Selecionado' };
      const currentCollab = teamMembers.find(m => m.uid === user?.uid || m.id === user?.uid) || { id: user?.uid || 'user', name: user?.displayName || user?.email?.split('@')[0] || 'Colaborador' };
      
      const typeMap: any = {
        'Novo paciente': 'novo',
        'Reativação': 'reativado',
        'Indicação': 'indicacao',
        'Outro': 'outro'
      };

      const percent = typeMap[commissionForm.motive] === 'novo' ? settings.novoPercent : 
                      typeMap[commissionForm.motive] === 'reativado' ? settings.reativadoPercent : 
                      typeMap[commissionForm.motive] === 'indicacao' ? settings.indicacaoPercent : 5;
                      
      const calcValue = (commissionForm.value * percent) / 100;
      
      const listEvidences = commissionForm.evidenceFile ? [commissionForm.evidenceFile] : [];

      await addDoc(collection(db, 'clinics', clinic.id, 'commercial_sale_commissions'), {
        patientId: commissionForm.patientId,
        patientName: pat.name,
        quotationId: 'manual-' + Math.random().toString(36).substr(2, 9),
        quotationTitle: commissionForm.description || 'Venda declarada manualmente',
        value: Number(commissionForm.value),
        status: 'pending',
        type: typeMap[commissionForm.motive],
        responsibleId: currentCollab.id,
        responsibleName: currentCollab.name,
        leadSource: commissionForm.leadSource,
        commissionPercent: percent,
        commissionValue: calcValue,
        date: new Date().toISOString(),
        observation: `Participação solicitada manualmente por ${currentCollab.name}. Motivo: ${commissionForm.motive}.`,
        evidence: listEvidences,
        isRequested: true,
        createdAt: serverTimestamp()
      });

      setIsRequestCommissionOpen(false);
      setCommissionForm({ patientId: '', motive: 'Novo paciente', description: '', value: 0, leadSource: 'WhatsApp', evidenceFile: null });
      alert('Solicitação de participação comercial enviada com sucesso para aprovação do administrador!');
    } catch (err) {
      console.error(err);
    }
  };

  // Review a commission (Approve, reject, edit)
  const handleActionCommission = async (commId: string, action: 'approved' | 'rejected' | 'paid', reviewNotes = '', overridePercent?: number, overrideValue?: number) => {
    if (!clinic) return;
    try {
      const comm = commissions.find(c => c.id === commId);
      if (!comm) return;

      const payload: any = {
        status: action,
        reviewNotes: reviewNotes || comm.reviewNotes || '',
        updatedAt: serverTimestamp()
      };

      if (overridePercent !== undefined) {
        payload.commissionPercent = overridePercent;
        payload.commissionValue = (comm.value * overridePercent) / 100;
      }
      if (overrideValue !== undefined) {
        payload.commissionValue = overrideValue;
      }

      await updateDoc(doc(db, 'clinics', clinic.id, 'commercial_sale_commissions', commId), payload);
      setEditingCommissionId(null);
      setEditCommFormData(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Multi-conversor collision management 50/50, 100%, custom
  const handleResolveCollision = async (commId: string, rule: '100_one' | '50_50' | 'custom', firstCollabId: string, secondCollabId?: string, customPercentFirst?: number) => {
    if (!clinic) return;
    try {
      const comm = commissions.find(c => c.id === commId);
      if (!comm) return;

      const firstCollab = getCollabList().find(m => m.id === firstCollabId) || { name: 'Primeiro' };
      const totalAmount = comm.value;
      const initialPercent = comm.commissionPercent;
      const totalCommissionPossible = (totalAmount * initialPercent) / 100;

      if (rule === '100_one') {
        await updateDoc(doc(db, 'clinics', clinic.id, 'commercial_sale_commissions', commId), {
          responsibleId: firstCollabId,
          responsibleName: firstCollab.name,
          commissionValue: totalCommissionPossible,
          observation: `${comm.observation || ''} [Conflito Resolvido: 100% para ${firstCollab.name}]`,
          collisionAlert: false
        });
      } else if (rule === '50_50' && secondCollabId) {
        const secondCollab = getCollabList().find(m => m.id === secondCollabId) || { name: 'Segundo' };
        // We create a second commission doc split 50/50
        await updateDoc(doc(db, 'clinics', clinic.id, 'commercial_sale_commissions', commId), {
          responsibleId: firstCollabId,
          responsibleName: firstCollab.name,
          commissionValue: totalCommissionPossible / 2,
          observation: `${comm.observation || ''} [Conflito Resolvido: Divisão 50/50 de comissão com ${secondCollab.name}]`,
          collisionAlert: false
        });

        await addDoc(collection(db, 'clinics', clinic.id, 'commercial_sale_commissions'), {
          ...comm,
          id: `split-${commId}-${secondCollabId}`,
          responsibleId: secondCollabId,
          responsibleName: secondCollab.name,
          commissionValue: totalCommissionPossible / 2,
          observation: `Divisão 50/50 de comissão com ${firstCollab.name}. Ref: ${comm.quotationTitle}`,
          collisionAlert: false
        });
      } else if (rule === 'custom' && secondCollabId && customPercentFirst !== undefined) {
        const secondCollab = getCollabList().find(m => m.id === secondCollabId) || { name: 'Segundo' };
        const firstVal = (totalCommissionPossible * customPercentFirst) / 100;
        const secondVal = totalCommissionPossible - firstVal;

        await updateDoc(doc(db, 'clinics', clinic.id, 'commercial_sale_commissions', commId), {
          responsibleId: firstCollabId,
          responsibleName: firstCollab.name,
          commissionValue: firstVal,
          observation: `${comm.observation || ''} [Divisão Personalizada: ${customPercentFirst}% para ${firstCollab.name}]`,
          collisionAlert: false
        });

        await addDoc(collection(db, 'clinics', clinic.id, 'commercial_sale_commissions'), {
          ...comm,
          id: `split-${commId}-${secondCollabId}`,
          responsibleId: secondCollabId,
          responsibleName: secondCollab.name,
          commissionValue: secondVal,
          observation: `Divisão Personalizada: ${100 - customPercentFirst}% para ${secondCollab.name}. Ref: ${comm.quotationTitle}`,
          collisionAlert: false
        });
      }
      alert('Conflito de comissão solucionado com sucesso! Divisão registrada.');
    } catch (err) {
      console.error(err);
    }
  };

  // Move recall progress
  const advanceRecallStatus = async (id: string, currentStatus: string) => {
    if (!clinic) return;
    const stages: any[] = ['Pendente', 'Contato realizado', 'Consulta agendada', 'Orçamento aprovado', 'Procedimento realizado', 'Comissão gerada'];
    const nextIdx = stages.indexOf(currentStatus) + 1;
    if (nextIdx >= stages.length) return;

    const nextStatus = stages[nextIdx];
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'commercial_recall_opportunities', id), {
        status: nextStatus,
        updatedAt: new Date().toISOString()
      });

      // Se virar comissão gerada, cria opcionalmente
      if (nextStatus === 'Comissão gerada') {
        const r = recalls.find(rec => rec.id === id);
        if (r) {
          await addDoc(collection(db, 'clinics', clinic.id, 'commercial_sale_commissions'), {
            patientId: r.patientId,
            patientName: r.patientName,
            quotationId: `recall-${id}`,
            quotationTitle: `Reativação por Recall - ${r.lastProcedure}`,
            value: 1200, // valor simulado médio
            status: 'pending',
            type: 'reativado',
            responsibleId: 'eliza_ia', // Atribuído à ELIZA IA por padrão ou colab
            responsibleName: 'ELIZA IA',
            leadSource: 'Recall Inteligente',
            commissionPercent: settings.reativadoPercent,
            commissionValue: (1200 * settings.reativadoPercent) / 100,
            date: new Date().toISOString(),
            observation: `Oportunidade originada do Recall Inteligente concluída.`,
            createdAt: serverTimestamp()
          });
          alert('Venda de Reativação aprovada! Comissão gerada automaticamente atribuída à ELIZA IA.');
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Helper arrays for filters
  const filteredLeads = leads.filter(l => (l.name || '').toLowerCase().includes(searchTerm.toLowerCase()));
  
  // Aggregate sales figures
  const totalPipeline = leads.reduce((sum, l) => sum + (l.value || 0), 0);
  const totalCommercialSales = commissions.filter(c => c.status === 'approved' || c.status === 'paid').reduce((sum, c) => sum + c.value, 0);
  const elizaSales = commissions.filter(c => (c.status === 'approved' || c.status === 'paid') && c.responsibleId === 'eliza_ia').reduce((sum, c) => sum + c.value, 0);
  const elizaReactivated = commissions.filter(c => c.responsibleId === 'eliza_ia' && (c.type === 'reativado' || c.type === 'vip')).length;
  
  // Columns for standard Kanban
  const columns = [
    { id: 'new', label: 'Novos Leads', color: 'bg-blue-500' },
    { id: 'contacted', label: 'Contato Realizado', color: 'bg-amber-500' },
    { id: 'scheduled', label: 'Avaliação Agendada', color: 'bg-teal-500' },
    { id: 'negotiating', label: 'Em Negociação', color: 'bg-emerald-500' },
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Title Header */}
      <header className="px-8 py-5 bg-white border-b border-slate-200 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-teal-600 text-white p-1.5 rounded-xl block">
              <Briefcase className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
              CRM Comercial & Comissões ELIZA
            </h2>
          </div>
          <p className="text-xs text-slate-500 font-medium">Gere mais receitas e meça o faturamento de colaboradores e da inteligência artificial.</p>
        </div>
        
        {/* Sub-tabs switch */}
        <div className="flex overflow-x-auto bg-slate-100 p-1 rounded-2xl shrink-0 no-scrollbar gap-1">
          <button onClick={() => setActiveTab('funnel')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'funnel' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Funil de Leads</button>
          <button onClick={() => setActiveTab('sales')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'sales' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Vendas & Comissões</button>
          <button onClick={() => setActiveTab('approvals')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${activeTab === 'approvals' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
            Central de Aprovação
            {commissions.filter(c => c.status === 'pending').length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-black animate-pulse">
                {commissions.filter(c => c.status === 'pending').length}
              </span>
            )}
          </button>
          <button onClick={() => setActiveTab('collab')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'collab' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Painel Individual</button>
          <button onClick={() => setActiveTab('ranking')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'ranking' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Ranking & Metas</button>
          <button onClick={() => setActiveTab('eliza_ai')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${activeTab === 'eliza_ai' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-teal-600'}`}>
            <Sparkles className="w-3 h-3 text-teal-600" /> Dashboard ELIZA
          </button>
          <button onClick={() => setActiveTab('settings')} className={`p-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'settings' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`} title="Configurações de Comissão"><Settings className="w-4 h-4" /></button>
        </div>
      </header>

      {/* Main Panel views */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50">
        
        {/* TAB 1: FUNNEL */}
        {activeTab === 'funnel' && (
          <div className="p-8 space-y-6 h-full flex flex-col">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
              <div className="flex items-center gap-6">
                <div className="bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  <span className="text-[10px] font-black uppercase text-slate-400">Pipeline Total:</span>
                  <span className="text-sm font-black text-slate-900">R$ {totalPipeline.toLocaleString()}</span>
                </div>
                <div className="bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-500" />
                  <span className="text-[10px] font-black uppercase text-slate-400">Total Leads:</span>
                  <span className="text-sm font-black text-slate-900">{leads.length}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="relative flex-1 md:flex-initial">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" placeholder="Buscar lead..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 w-full md:w-56" />
                </div>
                <button onClick={() => setIsAddLeadOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs p-3 md:px-4 md:py-2 rounded-xl flex items-center gap-2 shadow-md shrink-0">
                  <Plus className="w-4 h-4" /> Novo Lead
                </button>
              </div>
            </div>

            {/* Kanban Columns */}
            <div className="flex-1 min-h-0 overflow-x-auto pb-4 flex gap-6 items-start custom-scrollbar">
              {columns.map(col => (
                <div key={col.id} className="min-w-[280px] w-[280px] bg-slate-100/60 p-4 rounded-3xl border border-slate-200 max-h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4 px-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${col.color}`} />
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">{col.label}</h4>
                    </div>
                    <span className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 rounded-full font-bold">
                      {filteredLeads.filter(l => l.status === col.id).length}
                    </span>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar min-h-0 pb-4">
                    {filteredLeads.filter(l => l.status === col.id).map(lead => (
                      <div key={lead.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div>
                          <h5 className="text-xs font-black text-slate-900">{lead.name}</h5>
                          <p className="text-[10px] text-slate-500 mt-0.5">{lead.interest}</p>
                        </div>

                        {/* Origem e Responsavel Editable dropdowns */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold text-slate-400 block uppercase">Origem</span>
                            <select value={lead.leadSource || 'Instagram'} onChange={(e) => updateLeadField(lead.id, 'leadSource', e.target.value)} className="w-full text-[10px] bg-slate-50 border-none rounded p-1 outline-none font-medium">
                              {settings.leadSources.map((s: string) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold text-slate-400 block uppercase">Conversor</span>
                            <select value={lead.conversorId || 'no_commission'} onChange={(e) => updateLeadField(lead.id, 'conversorId', e.target.value)} className="w-full text-[10px] bg-slate-50 border-none rounded p-1 outline-none font-medium">
                              {getCollabList().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <span className="text-[11px] font-black text-slate-900 border-t border-slate-50 pt-1">R$ {lead.value?.toLocaleString()}</span>
                          <div className="flex items-center gap-1">
                            {columns.filter(c => c.id !== lead.status).map(c => (
                              <button key={c.id} onClick={() => moveLead(lead.id, c.id)} className="p-1.5 bg-slate-50 hover:bg-teal-50 hover:text-teal-600 rounded text-slate-400 transition-all border border-slate-100" title={`Mover para ${c.label}`}>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}

                    {filteredLeads.filter(l => l.status === col.id).length === 0 && (
                      <div className="py-8 text-center text-[10px] text-slate-400 italic">Vazio</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: SALES & COMMISSIONS GRID */}
        {activeTab === 'sales' && (
          <div className="p-8 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Vendas e Comissões Detalhadas</h3>
                <p className="text-xs text-slate-500">Classificação inteligente de orçamentos e definição de responsáveis.</p>
              </div>
              <div className="flex items-center gap-4 w-full md:w-auto">
                <select value={selectedCollabId} onChange={(e) => setSelectedCollabId(e.target.value)} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none">
                  <option value="all">Filtro: Todos Colaboradores</option>
                  {getCollabList().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-400 text-[10px] uppercase font-bold">
                    <th className="p-5">Paciente / Venda</th>
                    <th className="p-5">Valor</th>
                    <th className="p-5">Classificação / Comissão %</th>
                    <th className="p-5">Origem / Conversor</th>
                    <th className="p-5">Calculado</th>
                    <th className="p-5">Status</th>
                    <th className="p-5 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {commissions
                    .filter(c => selectedCollabId === 'all' || c.responsibleId === selectedCollabId)
                    .map(comm => (
                      <tr key={comm.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-5">
                          <p className="font-bold text-slate-900">{comm.patientName}</p>
                          <span className="text-[10px] text-slate-400">{comm.quotationTitle}</span>
                        </td>
                        <td className="p-5 font-bold text-slate-700">
                          R$ {comm.value?.toLocaleString()}
                        </td>
                        <td className="p-5">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-100">
                              {comm.type === 'novo' ? 'Paciente Novo' : 
                               comm.type === 'reativado' ? 'Paciente Reativado' : 
                               comm.type === 'vip' ? 'Reativado VIP' : 
                               comm.type === 'indicacao' ? 'Indicação Externa' : 'Paciente Ativo'}
                            </span>
                            <span className="font-bold text-slate-500">({comm.commissionPercent}%)</span>
                          </div>
                          {comm.observation && <p className="text-[9px] text-slate-400 mt-1 italic">{comm.observation}</p>}
                        </td>
                        <td className="p-5 space-y-1">
                          <p className="text-[11px] font-medium text-slate-700 flex items-center gap-1">
                            <span className="text-slate-400 text-[9px]">Origem:</span>
                            <span className="font-black">{comm.leadSource || 'WhatsApp'}</span>
                          </p>
                          <p className="text-[11px] font-medium text-slate-700 flex items-center gap-1">
                            <span className="text-slate-400 text-[9px]">Feed:</span>
                            <span className="text-teal-600 font-black">{comm.responsibleName}</span>
                          </p>
                        </td>
                        <td className="p-5 font-black text-emerald-600">
                          R$ {comm.commissionValue?.toLocaleString()}
                        </td>
                        <td className="p-5">
                          <span className={`px-2 py-1 rounded-full text-[9px] font-bold ${
                            comm.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            comm.status === 'paid' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                            comm.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-100' :
                            'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}>
                            {comm.status === 'approved' ? 'Aprovado' :
                             comm.status === 'paid' ? 'Pago' :
                             comm.status === 'rejected' ? 'Negado' : 'Pendente'}
                          </span>
                        </td>
                        <td className="p-5 text-right">
                          <button onClick={() => {
                            setEditingCommissionId(comm.id);
                            setEditCommFormData({
                              type: comm.type,
                              commissionPercent: comm.commissionPercent,
                              commissionValue: comm.commissionValue,
                              leadSource: comm.leadSource,
                              responsibleId: comm.responsibleId,
                              reviewNotes: comm.reviewNotes || ''
                            });
                          }} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-900" title="Editar comissão">
                            <Edit className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}

                  {commissions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 italic">Nenhuma comissão comercial gerada ainda. Os orçamentos aprovados ou solicitações manuais de equipação aparecerão aqui de forma instantânea.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* INTEGRATION SECTION: RECALL INTELIGENTE RE-ACTIVATIONS */}
            <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Oportunidades Ativas de Recall Inteligente HOF</h3>
              </div>
              <p className="text-xs text-slate-500">Pacientes que completaram o ciclo biológico de Botox ou Preenchimento e foram reativados. Rastreie a conversão do lead até a comissão final.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {recalls.map(r => (
                  <div key={r.id} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 space-y-4 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-black text-slate-900">{r.patientName}</h4>
                        <span className="text-[10px] bg-teal-100/50 text-teal-700 px-2 py-0.5 rounded-full font-bold inline-block mt-1">{r.lastProcedure}</span>
                      </div>
                      <span className="text-[9px] text-red-500 font-bold">Vencido há {r.overdueMonths}m</span>
                    </div>

                    {/* Progress tracking display */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[9px] text-slate-400 uppercase font-black">
                        <span>Progresso Comercial</span>
                        <span className="text-teal-600">{r.status}</span>
                      </div>
                      <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex gap-0.5">
                        <div className={`h-full flex-1 ${['Pendente', 'Contato realizado', 'Consulta agendada', 'Orçamento aprovado', 'Procedimento realizado', 'Comissão gerada'].indexOf(r.status) >= 0 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                        <div className={`h-full flex-1 ${['Contato realizado', 'Consulta agendada', 'Orçamento aprovado', 'Procedimento realizado', 'Comissão gerada'].indexOf(r.status) >= 0 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                        <div className={`h-full flex-1 ${['Consulta agendada', 'Orçamento aprovado', 'Procedimento realizado', 'Comissão gerada'].indexOf(r.status) >= 0 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                        <div className={`h-full flex-1 ${['Orçamento aprovado', 'Procedimento realizado', 'Comissão gerada'].indexOf(r.status) >= 0 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                        <div className={`h-full flex-1 ${['Procedimento realizado', 'Comissão gerada'].indexOf(r.status) >= 0 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                        <div className={`h-full flex-1 ${['Comissão gerada'].indexOf(r.status) >= 0 ? 'bg-teal-500' : 'bg-slate-200'}`} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-200/50 pt-3 mt-1">
                      <span className="text-[9px] text-slate-400 font-medium">Último contato hoje</span>
                      {r.status !== 'Comissão gerada' ? (
                        <button onClick={() => advanceRecallStatus(r.id, r.status)} className="text-[10px] bg-white border border-slate-200 text-teal-700 font-bold px-3 py-1.5 rounded-lg hover:bg-teal-50 flex items-center gap-1 shadow-sm transition-all">
                          Avançar Etapa <ArrowRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">Concluído! <CheckCircle2 className="w-3.5 h-3.5" /></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CENTRAL DE APROVACAO */}
        {activeTab === 'approvals' && (
          <div className="p-8 space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Comissões Pendentes (Central de Aprovação)</h3>
              <p className="text-xs text-slate-500">Valide as evidências fornecidas pelos colaboradores para as conversões e autorize comissões.</p>
            </div>

            <div className="space-y-4">
              {commissions.filter(c => c.status === 'pending').map(comm => (
                <div key={comm.id} className="bg-white border border-slate-200 rounded-[2.5rem] p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6">
                  
                  <div className="space-y-4 flex-1">
                    <div className="flex items-start gap-4">
                      <div className="bg-amber-50 border border-amber-200 text-amber-700 p-3 rounded-2xl">
                        <Clock className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h4 className="text-sm font-black text-slate-900">{comm.patientName}</h4>
                          <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">Ref: {comm.id}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{comm.quotationTitle}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl text-xs">
                      <div>
                        <span className="text-[9px] text-slate-400 block uppercase font-bold">Solicitante / Conversor</span>
                        <p className="font-bold text-slate-800">{comm.responsibleName}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 block uppercase font-bold">Valor da Venda</span>
                        <p className="font-bold text-slate-800">R$ {comm.value?.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 block uppercase font-bold">Tipo Selecionado</span>
                        <p className="font-bold text-teal-700 uppercase tracking-wider text-[10px]">
                          {comm.type === 'novo' ? 'Paciente Novo' : 
                           comm.type === 'reativado' ? 'Paciente Reativado' : 
                           comm.type === 'vip' ? 'Reativado VIP' : 
                           comm.type === 'indicacao' ? 'Indicação Externa' : 'Paciente Ativo'}
                        </p>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 block uppercase font-bold">Comissão Sugerida</span>
                        <p className="font-black text-emerald-600">R$ {comm.commissionValue?.toLocaleString()} ({comm.commissionPercent}%)</p>
                      </div>
                    </div>

                    {comm.observation && (
                      <div className="p-3 bg-teal-50/50 border border-teal-100 rounded-xl text-xs text-teal-800 italic">
                        <strong>Obs:</strong> {comm.observation}
                      </div>
                    )}

                    {/* Evidence Attachment Viewer directly inside request */}
                    {comm.evidence && comm.evidence.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-[9px] text-slate-400 block uppercase font-black">Evidência / Comprovante Anexo</span>
                        <div className="flex flex-wrap gap-4">
                          {comm.evidence.map((ev, i) => (
                            <div key={i} className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-3 rounded-xl max-w-sm">
                              <FileText className="w-5 h-5 text-teal-600" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-black text-slate-900 truncate">{ev.name}</p>
                                <p className="text-[9px] text-slate-400 lowercase">{ev.type}</p>
                              </div>
                              {ev.dataUrl && (
                                <a href={ev.dataUrl} download={ev.name} className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 p-2 rounded text-[10px] font-bold">Baixar</a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions buttons panel */}
                  <div className="flex flex-col justify-center gap-3 shrink-0 md:w-56 border-t md:border-t-0 md:border-l border-slate-200/60 pt-4 md:pt-0 md:pl-6">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase">Observação de Revisão</label>
                      <textarea value={commObs} onChange={(e) => setCommObs(e.target.value)} placeholder="Adicionar notas..." className="w-full text-xs p-2 bg-slate-50 border border-slate-100 rounded-xl" rows={2} />
                    </div>
                    
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        await handleActionCommission(comm.id, 'approved', commObs);
                        setCommObs('');
                      }} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm">
                        <Check className="w-3.5 h-3.5" /> Aprovar
                      </button>
                      <button onClick={async () => {
                        await handleActionCommission(comm.id, 'rejected', commObs);
                        setCommObs('');
                      }} className="flex-1 py-2 bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-100 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5">
                        <X className="w-3.5 h-3.5" /> Negar
                      </button>
                    </div>
                  </div>

                </div>
              ))}

              {commissions.filter(c => c.status === 'pending').length === 0 && (
                <div className="p-12 text-center bg-white border border-slate-200 rounded-[2rem] text-slate-400 italic">Central limpa! Nenhuma comissão pendente de aprovação no momento.</div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: COLLABORATOR INDIVIDUAL DASHBOARD */}
        {activeTab === 'collab' && (
          <div className="p-8 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Painel do Colaborador</h3>
                <p className="text-xs text-slate-500">Acompanhe suas vendas, comissões aprovadas/pendentes, metas, e solicite participação comercial.</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setIsRequestCommissionOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-sm">
                  <Plus className="w-4 h-4" /> Solicitar Participação Comercial
                </button>
              </div>
            </div>

            {/* Simulated selected collaborator selector for demo testing */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-teal-50 p-2.5 rounded-xl text-teal-700">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Vendo histórico de:</p>
                  <select value={selectedCollabId === 'all' ? 'eliza_ia' : selectedCollabId} onChange={(e) => setSelectedCollabId(e.target.value)} className="font-bold text-slate-900 text-sm bg-transparent border-none p-0 outline-none cursor-pointer">
                    {getCollabList().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="h-10 w-px bg-slate-200 hidden md:block"></div>

              <div className="text-right">
                <span className="text-[9px] text-slate-400 block uppercase font-bold">Bônus Mensal Estimado</span>
                <p className="text-lg font-black text-emerald-600">
                  R$ {(() => {
                    const reactSnap = commissions.filter(c => c.responsibleId === selectedCollabId && (c.status === 'approved' || c.status === 'paid') && (c.type === 'reativado' || c.type === 'vip')).length;
                    if (reactSnap >= 30) return settings.goal30;
                    if (reactSnap >= 20) return settings.goal20;
                    if (reactSnap >= 10) return settings.goal10;
                    if (reactSnap >= 5) return settings.goal5;
                    return 0;
                  })().toLocaleString()}
                </p>
              </div>
            </div>

            {/* Individual Stats Grid */}
            {(() => {
              const activeId = selectedCollabId === 'all' ? 'eliza_ia' : selectedCollabId;
              const colComms = commissions.filter(c => c.responsibleId === activeId);
              const approvedSales = colComms.filter(c => c.status === 'approved' || c.status === 'paid');
              
              const stats = {
                salesVal: approvedSales.reduce((acc, c) => acc + c.value, 0),
                novosCount: approvedSales.filter(c => c.type === 'novo').length,
                reativadosCount: approvedSales.filter(c => c.type === 'reativado' || c.type === 'vip').length,
                indicacaoCount: approvedSales.filter(c => c.type === 'indicacao').length,
                commApproved: colComms.filter(c => c.status === 'approved').reduce((acc, c) => acc + c.commissionValue, 0),
                commPaid: colComms.filter(c => c.status === 'paid').reduce((acc, c) => acc + c.commissionValue, 0),
                commPending: colComms.filter(c => c.status === 'pending').reduce((acc, c) => acc + c.commissionValue, 0)
              };

              return (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-1">
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Total de Vendas</span>
                      <p className="text-xl font-extrabold text-slate-900">R$ {stats.salesVal?.toLocaleString()}</p>
                      <div className="flex gap-2 text-[9px] text-slate-500 mt-2">
                        <span>{stats.novosCount} Novos</span>
                        <span>•</span>
                        <span>{stats.reativadosCount} Reativados</span>
                        <span>•</span>
                        <span>{stats.indicacaoCount} Inds</span>
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-1">
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Comissões Aprovadas</span>
                      <p className="text-xl font-extrabold text-emerald-600">R$ {stats.commApproved?.toLocaleString()}</p>
                      <span className="text-[9px] text-slate-400">Pronto para fechamento</span>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-1">
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Comissões Pendentes</span>
                      <p className="text-xl font-extrabold text-amber-500">R$ {stats.commPending?.toLocaleString()}</p>
                      <span className="text-[9px] text-slate-400">Em análise do admin</span>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-1">
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Comissões Pagas</span>
                      <p className="text-xl font-extrabold text-blue-600">R$ {stats.commPaid?.toLocaleString()}</p>
                      <span className="text-[9px] text-slate-400">Transferências liquidadas</span>
                    </div>
                  </div>

                  {/* Progressive Goal Tracker */}
                  <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Meta Mensal: Reativação de Pacientes</h4>
                        <p className="text-xs text-slate-500 mt-0.5">Recupere pacientes inativos e ganhe bônus progressivos acumulados na plataforma.</p>
                      </div>
                      <span className="bg-teal-50 text-teal-700 border border-teal-100 font-extrabold text-xs px-3 py-1.5 rounded-xl">
                        {stats.reativadosCount} Pacientes Reativados
                      </span>
                    </div>

                    <div className="space-y-4">
                      {/* Meter bar */}
                      <div className="h-4 w-full bg-slate-100 rounded-full border border-slate-200 overflow-hidden relative flex">
                        <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, (stats.reativadosCount / 30) * 100)}%` }} />
                        
                        {/* Target ticks on progress bar */}
                        <div className="absolute left-[16.6%] top-0 bottom-0 w-px bg-slate-300" />
                        <div className="absolute left-[33.3%] top-0 bottom-0 w-px bg-slate-300" />
                        <div className="absolute left-[66.6%] top-0 bottom-0 w-px bg-slate-300" />
                      </div>

                      {/* Goal Steps */}
                      <div className="grid grid-cols-4 gap-4 text-center text-xs pt-1">
                        <div className={stats.reativadosCount >= 5 ? 'text-teal-700 font-bold' : 'text-slate-400'}>
                          <p className="font-extrabold">Bônus 5 Pacientes</p>
                          <span className="text-[10px]">R$ {settings.goal5}</span>
                          <p className="text-[9px] mt-1">{stats.reativadosCount >= 5 ? '✓ Conquistado' : 'Faltam ' + Math.max(0, 5 - stats.reativadosCount)}</p>
                        </div>
                        <div className={stats.reativadosCount >= 10 ? 'text-teal-700 font-bold' : 'text-slate-400'}>
                          <p className="font-extrabold">Bônus 10 Pacientes</p>
                          <span className="text-[10px]">R$ {settings.goal10}</span>
                          <p className="text-[9px] mt-1">{stats.reativadosCount >= 10 ? '✓ Conquistado' : 'Faltam ' + Math.max(0, 10 - stats.reativadosCount)}</p>
                        </div>
                        <div className={stats.reativadosCount >= 20 ? 'text-teal-700 font-bold' : 'text-slate-400'}>
                          <p className="font-extrabold">Bônus 20 Pacientes</p>
                          <span className="text-[10px]">R$ {settings.goal20}</span>
                          <p className="text-[9px] mt-1">{stats.reativadosCount >= 20 ? '✓ Conquistado' : 'Faltam ' + Math.max(0, 20 - stats.reativadosCount)}</p>
                        </div>
                        <div className={stats.reativadosCount >= 30 ? 'text-teal-700 font-bold' : 'text-slate-400'}>
                          <p className="font-extrabold">Bônus 30 Pacientes</p>
                          <span className="text-[10px]">R$ {settings.goal30}</span>
                          <p className="text-[9px] mt-1">{stats.reativadosCount >= 30 ? '✓ Conquistado' : 'Faltam ' + Math.max(0, 30 - stats.reativadosCount)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 5: RANKING COMERCIAL */}
        {activeTab === 'ranking' && (
          <div className="p-8 space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Ranking Comercial Mensal</h3>
              <p className="text-xs text-slate-500">Acompanhamento saudável do desempenho de vendas e reativação de pacientes.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-400 text-[10px] uppercase font-bold">
                    <th className="p-5">Posição</th>
                    <th className="p-5">Colaborador</th>
                    <th className="p-5 text-center">Novos</th>
                    <th className="p-5 text-center">Reativações</th>
                    <th className="p-5 text-center">Indicações</th>
                    <th className="p-5">Receita Gerada</th>
                    <th className="p-5">Comissões</th>
                    <th className="p-5">Meta Bônus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {getCollabList()
                    .filter(c => c.id !== 'no_commission')
                    .map((col, idx) => {
                      const colComms = commissions.filter(c => c.responsibleId === col.id && (c.status === 'approved' || c.status === 'paid'));
                      const valSales = colComms.reduce((acc, c) => acc + c.value, 0);
                      const commVal = colComms.reduce((acc, c) => acc + c.commissionValue, 0);
                      const reat = colComms.filter(c => c.type === 'reativado' || c.type === 'vip').length;
                      const novos = colComms.filter(c => c.type === 'novo').length;
                      const ind = colComms.filter(c => c.type === 'indicacao').length;

                      // calculate bonus step
                      let bonus = 0;
                      if (reat >= 30) bonus = settings.goal30;
                      else if (reat >= 20) bonus = settings.goal20;
                      else if (reat >= 10) bonus = settings.goal10;
                      else if (reat >= 5) bonus = settings.goal5;

                      return (
                        <tr key={col.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-5 font-black text-slate-900">
                            {idx === 0 ? '🥇 1º' : idx === 1 ? '🥈 2º' : idx === 2 ? '🥉 3º' : `${idx + 1}º`}
                          </td>
                          <td className="p-5">
                            <p className="font-bold text-slate-900">{col.name}</p>
                            <span className="text-[10px] text-slate-400">{col.role || 'Colaborador'}</span>
                          </td>
                          <td className="p-5 text-center font-bold text-slate-700">{novos}</td>
                          <td className="p-5 text-center font-bold text-slate-700">{reat}</td>
                          <td className="p-5 text-center font-bold text-slate-700">{ind}</td>
                          <td className="p-5 font-bold text-slate-900">R$ {valSales?.toLocaleString()}</td>
                          <td className="p-5 font-bold text-emerald-600">R$ {commVal?.toLocaleString()}</td>
                          <td className="p-5">
                            {bonus > 0 ? (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded text-[10px] font-bold">
                                + R$ {bonus} (Metas)
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Sem bônus</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: DASHBOARD ELIZA IA */}
        {activeTab === 'eliza_ai' && (
          <div className="p-8 space-y-6">
            <div className="bg-teal-900 text-white p-8 rounded-[2.5rem] relative overflow-hidden shadow-lg shadow-teal-900/10">
              <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-teal-800 rounded-full opacity-60" />
              <div className="absolute left-1/3 bottom-0 translate-y-24 w-80 h-80 bg-teal-800 rounded-full opacity-30" />
              
              <div className="relative space-y-4">
                <span className="bg-teal-800 text-teal-200 px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase inline-flex items-center gap-1.5 border border-teal-700">
                  <Sparkles className="w-3.5 h-3.5 text-teal-300 animate-pulse" /> Inteligência Conversional AI Ativa
                </span>
                <h3 className="text-xl md:text-2xl font-black">Performance Comercial da ELIZA IA</h3>
                <p className="text-xs text-teal-100 max-w-xl leading-relaxed">A ELIZA atua de forma autónoma através do Recall Inteligente e mensagens automáticas gerando agendamentos e recuperando orçamentos pendentes.</p>
              </div>
            </div>

            {/* Performance KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-2">
                <span className="text-[9px] text-slate-400 font-black block uppercase tracking-wider">Faturamento Gerado</span>
                <p className="text-2xl font-black text-slate-900">R$ {elizaSales.toLocaleString()}</p>
                <div className="h-1 bg-teal-500 rounded-full w-2/3" />
                <span className="text-[9px] text-slate-400 block mt-1">Acumulado recuperado por IA</span>
              </div>

              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-2">
                <span className="text-[9px] text-slate-400 font-black block uppercase tracking-wider">Pacientes Reativados</span>
                <p className="text-2xl font-black text-slate-900">{elizaReactivated}</p>
                <div className="h-1 bg-teal-500 rounded-full w-1/2" />
                <span className="text-[9px] text-slate-400 block mt-1">Retornos promovidos p/ eliza</span>
              </div>

              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-2">
                <span className="text-[9px] text-slate-400 font-black block uppercase tracking-wider">Consultas Agendadas</span>
                <p className="text-2xl font-black text-slate-900">{Math.ceil(elizaReactivated * 1.4)}</p>
                <div className="h-1 bg-teal-500 rounded-full w-3/4" />
                <span className="text-[9px] text-slate-400 block mt-1">Agendadas por Recall HOF</span>
              </div>

              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-2">
                <span className="text-[9px] text-slate-400 font-black block uppercase tracking-wider">Taxa de Conversão</span>
                <p className="text-2xl font-black text-slate-900">72%</p>
                <div className="h-1 bg-teal-500 rounded-full w-[72%]" />
                <span className="text-[9px] text-slate-400 block mt-1">Superior à média humana (45%)</span>
              </div>
            </div>

            {/* AI Conversions history log */}
            <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Últimas Conversões Efetuadas pela ELIZA IA</h4>
              <div className="space-y-4">
                {commissions
                  .filter(c => c.responsibleId === 'eliza_ia' && (c.status === 'approved' || c.status === 'paid'))
                  .map(comm => (
                    <div key={comm.id} className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
                      <div className="space-y-1">
                        <p className="font-extrabold text-slate-900">{comm.patientName}</p>
                        <p className="text-[10px] text-slate-500">{comm.quotationTitle}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-emerald-600">R$ {comm.value?.toLocaleString()}</p>
                        <span className="text-[9px] text-slate-400">Classificação: {comm.type}</span>
                      </div>
                    </div>
                  ))}

                {commissions.filter(c => c.responsibleId === 'eliza_ia' && (c.status === 'approved' || c.status === 'paid')).length === 0 && (
                  <div className="text-center py-6 text-slate-400 italic">Nenhum orçamento convertido formalmente pela ELIZA IA no período atual.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: SETTINGS & COMISSÃO COMERCIAL CONFIGS (ADMIN-ONLY) */}
        {activeTab === 'settings' && (
          <div className="p-8 space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Configurações de Comissão Comercial</h3>
              <p className="text-xs text-slate-500">Defina os percentuais padrão sugeridos pela ELIZA na aprovação de tratamentos e orçamentos.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 space-y-8 shadow-sm max-w-3xl">
              <div className="space-y-6">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Regras de Comissão Padrão %</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Paciente Novo</label>
                    <div className="relative">
                      <input type="number" value={settings.novoPercent} onChange={(e) => setSettings({ ...settings, novoPercent: Number(e.target.value) })} className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none" />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-xs">%</span>
                    </div>
                    <span className="text-[10px] text-slate-500 block">Aplicado quando o paciente não tem consultas anteriores na ficha.</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Paciente Reativado</label>
                    <div className="relative">
                      <input type="number" value={settings.reativadoPercent} onChange={(e) => setSettings({ ...settings, reativadoPercent: Number(e.target.value) })} className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none" />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-xs">%</span>
                    </div>
                    <span className="text-[10px] text-slate-500 block">Aplicado a pacientes há mais de 180 dias inativos na clínica.</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Paciente Reativado VIP</label>
                    <div className="relative">
                      <input type="number" value={settings.reativadoVipPercent} onChange={(e) => setSettings({ ...settings, reativadoVipPercent: Number(e.target.value) })} className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none" />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-xs">%</span>
                    </div>
                    <span className="text-[10px] text-slate-500 block">Aplicado a pacientes há mais de 365 dias inativos na clínica.</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Indicação Externa</label>
                    <div className="relative">
                      <input type="number" value={settings.indicacaoPercent} onChange={(e) => setSettings({ ...settings, indicacaoPercent: Number(e.target.value) })} className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none" />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-xs">%</span>
                    </div>
                    <span className="text-[10px] text-slate-500 block">Parceiro ou colega que encaminhou o lead.</span>
                  </div>
                </div>
              </div>

              {/* Monthly incentives config */}
              <div className="space-y-6 pt-6 border-t border-slate-100">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Incentivos de Reativação Comercial</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">5 Reativados</label>
                    <input type="number" value={settings.goal5} onChange={(e) => setSettings({...settings, goal5: Number(e.target.value)})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">10 Reativados</label>
                    <input type="number" value={settings.goal10} onChange={(e) => setSettings({...settings, goal10: Number(e.target.value)})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">20 Reativados</label>
                    <input type="number" value={settings.goal20} onChange={(e) => setSettings({...settings, goal20: Number(e.target.value)})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">30 Reativados</label>
                    <input type="number" value={settings.goal30} onChange={(e) => setSettings({...settings, goal30: Number(e.target.value)})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
                  </div>
                </div>
              </div>

              {/* Lead Sources editor */}
              <div className="space-y-4 pt-6 border-t border-slate-100">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest block">Origens de Leads Habilitadas</h4>
                <div className="flex flex-wrap gap-2">
                  {settings.leadSources.map((src: string, i: number) => (
                    <span key={src} className="bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px] px-3 py-1.5 rounded-full flex items-center gap-1.5">
                      {src}
                      <button onClick={() => {
                        const next = settings.leadSources.filter((s: string) => s !== src);
                        setSettings({ ...settings, leadSources: next });
                      }} className="hover:text-red-600 block"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  
                  {/* Quick Add lead source */}
                  <button onClick={() => {
                    const extra = prompt('Nome da nova origem de lead:');
                    if (extra) {
                      setSettings({ ...settings, leadSources: [...settings.leadSources, extra] });
                    }
                  }} className="bg-teal-50 hover:bg-teal-100 border border-dashed border-teal-200 text-teal-700 font-bold text-[10px] px-3 py-1.5 rounded-full">+ Nova Origem</button>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100">
                <button onClick={() => handleSaveSettings(settings)} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs px-6 py-3 rounded-2xl shadow-lg shadow-teal-600/15">Salvar Configurações</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* MODAL 1: ADICIONAR LEAD */}
      <AnimatePresence>
        {isAddLeadOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div onClick={() => setIsAddLeadOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="relative bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-lg w-full">
              <h4 className="text-base font-black text-slate-900 mb-6 flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-teal-600" /> Cadastrar Novo Lead Comercial
              </h4>

              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Nome do Lead *</label>
                    <input type="text" value={leadForm.name} onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" placeholder="Ex: Lucas Mendes" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Serviço de Interesse</label>
                    <input type="text" value={leadForm.interest} onChange={(e) => setLeadForm({ ...leadForm, interest: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" placeholder="Ex: Botox, Lentes" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Valor Estimado (R$)</label>
                    <input type="number" value={leadForm.value} onChange={(e) => setLeadForm({ ...leadForm, value: Number(e.target.value) })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Prioridade</label>
                    <select value={leadForm.priority} onChange={(e) => setLeadForm({ ...leadForm, priority: e.target.value as any })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      <option value="high">Alta</option>
                      <option value="medium">Média</option>
                      <option value="low">Baixa</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Origem do Lead *</label>
                    <select value={leadForm.leadSource} onChange={(e) => setLeadForm({ ...leadForm, leadSource: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      {settings.leadSources.map((s: string) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Responsável Conversão *</label>
                    <select value={leadForm.conversorId} onChange={(e) => setLeadForm({ ...leadForm, conversorId: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      {getCollabList().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button onClick={() => setIsAddLeadOpen(false)} className="flex-1 py-3 border border-slate-200 font-bold uppercase tracking-widest text-[10px] text-slate-400 rounded-2xl">Cancelar</button>
                <button onClick={handleAddLead} className="flex-1 py-3 bg-teal-600 text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl shadow-lg shadow-teal-600/15">Cadastrar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: REQUEST COMMISSION PARTICIPATION */}
      <AnimatePresence>
        {isRequestCommissionOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div onClick={() => setIsRequestCommissionOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="relative bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-lg w-full">
              <h4 className="text-base font-black text-slate-900 mb-6 flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-teal-600" /> Solicitar Participação Comercial
              </h4>

              <div className="space-y-4 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase block">Paciente Relacionado *</label>
                  <select value={commissionForm.patientId} onChange={(e) => setCommissionForm({ ...commissionForm, patientId: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <option value="">Selecione o paciente...</option>
                    {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block">Motivo do Pedido *</label>
                    <select value={commissionForm.motive} onChange={(e) => setCommissionForm({ ...commissionForm, motive: e.target.value as any })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      <option value="Novo paciente">Novo paciente (5% sugerido)</option>
                      <option value="Reativação">Reativação (3% sugerido)</option>
                      <option value="Indicação">Indicação Externa (5% sugerido)</option>
                      <option value="Outro">Outro Motivo</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block font-black text-slate-900">Valor Estimado Venda (R$) *</label>
                    <input type="number" value={commissionForm.value} onChange={(e) => setCommissionForm({ ...commissionForm, value: Number(e.target.value) })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block">Origem do Lead</label>
                    <select value={commissionForm.leadSource} onChange={(e) => setCommissionForm({ ...commissionForm, leadSource: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      {settings.leadSources.map((s: string) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block">Como provar? Enviar Anexo (Evidência)</label>
                    <input type="file" onChange={handleFileChange} className="w-full text-[10px]" accept="image/*,application/pdf,audio/*" />
                    <span className="text-[9px] text-slate-400 block mt-1">Anexe um print do WhatsApp, PDF de orçamento ou Áudio.</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase block">Justificativa / Descrição</label>
                  <textarea value={commissionForm.description} onChange={(e) => setCommissionForm({ ...commissionForm, description: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" rows={3} placeholder="Escreva detalhadamente como contribuiu com essa conversão estética..." />
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button onClick={() => setIsRequestCommissionOpen(false)} className="flex-1 py-3 border border-slate-200 font-bold uppercase tracking-widest text-[10px] text-slate-400 rounded-2xl">Cancelar</button>
                <button onClick={handleRequestCommission} className="flex-1 py-3 bg-teal-600 text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl shadow-lg">Enviar Solicitação</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: EDIT INTELIGENTE COMMISSION */}
      <AnimatePresence>
        {editingCommissionId && editCommFormData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div onClick={() => { setEditingCommissionId(null); setEditCommFormData(null); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="relative bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-lg w-full">
              <h4 className="text-base font-black text-slate-900 mb-6 flex items-center gap-2">
                <Percent className="w-5 h-5 text-teal-600" /> Ajustar Ajustes da Comissão Comercial (Admin)
              </h4>

              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Responsável Conversão</label>
                    <select value={editCommFormData.responsibleId} onChange={(e) => setEditCommFormData({ ...editCommFormData, responsibleId: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      {getCollabList().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Origem do Lead</label>
                    <select value={editCommFormData.leadSource} onChange={(e) => setEditCommFormData({ ...editCommFormData, leadSource: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      {settings.leadSources.map((s: string) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Classificação Paciente</label>
                    <select value={editCommFormData.type} onChange={(e) => setEditCommFormData({ ...editCommFormData, type: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                      <option value="novo">Paciente Novo</option>
                      <option value="reativado">Paciente Reativado</option>
                      <option value="vip">Reativado VIP</option>
                      <option value="ativo">Paciente Ativo</option>
                      <option value="indicacao">Indicação Externa</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Comissão Percentual %</label>
                    <input type="number" value={editCommFormData.commissionPercent} onChange={(e) => {
                      const pct = Number(e.target.value);
                      const comm = commissions.find(c => c.id === editingCommissionId);
                      setEditCommFormData({ ...editCommFormData, commissionPercent: pct, commissionValue: comm ? (comm.value * pct) / 100 : 0 });
                    }} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Valor Líquido da Comissão (R$)</label>
                  <input type="number" value={editCommFormData.commissionValue} onChange={(e) => setEditCommFormData({ ...editCommFormData, commissionValue: Number(e.target.value) })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" />
                </div>

                {/* Collisions handling inline directly under admin edit popup! */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-amber-900 text-[11px]">Gerenciar Divisão / Conflitos</p>
                      <p className="text-[10px] text-amber-800">Se mais de um colaborador ajudou neste lead, divida a comissão abaixo:</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => handleResolveCollision(editingCommissionId, '100_one', editCommFormData.responsibleId)} className="bg-white border border-slate-200 hover:bg-slate-50 py-1.5 rounded-lg text-[9px] font-black text-slate-700 uppercase">100% Um</button>
                    <button onClick={() => {
                      const other = prompt('Digite o ID do segundo colaborador para dividir 50/50:');
                      if (other) {
                        handleResolveCollision(editingCommissionId, '50_50', editCommFormData.responsibleId, other);
                      }
                    }} className="bg-white border border-slate-200 hover:bg-slate-50 py-1.5 rounded-lg text-[9px] font-black text-slate-700 uppercase">Divisão 50/50</button>
                    <button onClick={() => {
                      const other = prompt('ID do segundo colaborador:');
                      const firstPct = Number(prompt('Qual percentual do valor vai para o primeiro? (Ex: 70):'));
                      if (other && !isNaN(firstPct)) {
                        handleResolveCollision(editingCommissionId, 'custom', editCommFormData.responsibleId, other, firstPct);
                      }
                    }} className="bg-white border border-slate-200 hover:bg-slate-50 py-1.5 rounded-lg text-[9px] font-black text-slate-700 uppercase">Personalizado</button>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button onClick={() => { setEditingCommissionId(null); setEditCommFormData(null); }} className="flex-1 py-3 border border-slate-200 font-bold uppercase text-[10px] text-slate-400 rounded-2xl">Fechar</button>
                <button onClick={async () => {
                  const comm = commissions.find(c => c.id === editingCommissionId);
                  if (comm) {
                    await updateDoc(doc(db, 'clinics', clinic.id, 'commercial_sale_commissions', editingCommissionId), {
                      responsibleId: editCommFormData.responsibleId,
                      responsibleName: getCollabList().find(m => m.id === editCommFormData.responsibleId)?.name || 'Sem Comissão',
                      leadSource: editCommFormData.leadSource,
                      type: editCommFormData.type,
                      commissionPercent: editCommFormData.commissionPercent,
                      commissionValue: editCommFormData.commissionValue,
                      updatedAt: serverTimestamp()
                    });
                    setEditingCommissionId(null);
                    setEditCommFormData(null);
                    alert('Alterações salvas com sucesso!');
                  }
                }} className="flex-1 py-3 bg-teal-600 text-white font-bold uppercase text-[10px] rounded-2xl shadow-lg">Salvar Modificações</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
