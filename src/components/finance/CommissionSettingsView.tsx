import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Plus, 
  Users, 
  Target, 
  ShieldCheck, 
  Save, 
  Trash2, 
  AlertCircle,
  ToggleLeft as Toggle,
  Settings,
  Percent,
  CircleDollarSign,
  Edit2,
  CheckCircle,
  X,
  FileText
} from 'lucide-react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { TeamMember, CommissionRule, Role } from '../../types/finance';
import { DEFAULT_TREATMENT_CATALOG, TREATMENT_CATEGORIES } from '../../data/treatmentCatalog';

const ROLES: { value: string; label: string }[] = [
  { value: 'Dentista', label: 'Dentista' },
  { value: 'Médico', label: 'Médico' },
  { value: 'Secretária', label: 'Secretária' },
  { value: 'Financeiro', label: 'Financeiro' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Comercial', label: 'Comercial' },
  { value: 'Auxiliar', label: 'Auxiliar' },
  { value: 'Coordenador', label: 'Coordenador' },
  { value: 'Gestor', label: 'Gestor' },
  { value: 'Recepção', label: 'Recepção' },
  { value: 'Estagiário', label: 'Estagiário' },
  { value: 'Outro', label: 'Outro' },
  // Legacy backups
  { value: 'dentist', label: 'Dentista' },
  { value: 'doctor', label: 'Médico' },
  { value: 'secretary', label: 'Secretária' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'gestor', label: 'Gestor' },
  { value: 'vendedor', label: 'Comercial' },
  { value: 'auxiliar', label: 'Auxiliar' },
  { value: 'admin', label: 'Dono/Sócio' },
  { value: 'owner', label: 'Dono/Sócio' },
  { value: 'outro', label: 'Outro' }
];

export default function CommissionSettingsView() {
  const { clinic } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals and Active Edit States
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [memberForm, setMemberForm] = useState<any>({
    name: '',
    displayName: '',
    role: 'dentist',
    active: true,
    isProfessional: true,
    isCommissionable: true,
    defaultCommissionPercent: 30
  });

  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<any | null>(null);
  const [ruleForm, setRuleForm] = useState<any>({
    professionalId: '',
    professionalName: '',
    ruleType: 'default', // 'default' | 'category' | 'procedure'
    category: '',
    procedureName: '',
    commissionPercent: 10,
    active: true
  });

  // Load staff & rules
  useEffect(() => {
    if (!clinic) return;

    const unsubMembers = onSnapshot(query(collection(db, 'clinics', clinic.id, 'team_members')), (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/team_members`);
    });

    const unsubRules = onSnapshot(query(collection(db, 'clinics', clinic.id, 'commission_rules')), (snap) => {
      setRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/commission_rules`);
      setLoading(false);
    });

    return () => {
      unsubMembers();
      unsubRules();
    };
  }, [clinic]);

  // Open Modal to create team member
  const handleOpenNewMember = () => {
    setEditingMember(null);
    setMemberForm({
      name: '',
      displayName: '',
      role: 'dentist',
      active: true,
      isProfessional: true,
      isCommissionable: true,
      defaultCommissionPercent: 30
    });
    setShowMemberModal(true);
  };

  // Open Modal to edit team member
  const handleOpenEditMember = (member: any) => {
    setEditingMember(member);
    
    const isDocOrDentist = ['dentist', 'dentist_gp', 'especialista', 'doctor', 'Dentista', 'Médico'].includes(member.role || '');
    const isProfessional = member.isProfessional ?? member.attendance?.isProfessional ?? isDocOrDentist;
    const isCommissionable = member.isCommissionable ?? member.financial?.commissionEnabled ?? (member.commission_enabled !== false);
    const defaultPercent = member.defaultCommissionPercent ?? member.financial?.commissionPercent ?? (member.percentage || 0);

    setMemberForm({
      name: member.name || '',
      displayName: member.displayName || member.name || '',
      role: member.role || 'Dentista',
      active: member.active !== false,
      isProfessional,
      isCommissionable,
      defaultCommissionPercent: defaultPercent,
      // Nested structures
      financial: {
        commissionPercent: defaultPercent,
        commissionEnabled: isCommissionable,
        receiveFinancialSummary: member.financial?.receiveFinancialSummary ?? false
      },
      attendance: {
        isProfessional
      },
      marketing: {
        enabled: member.marketing?.enabled ?? false
      },
      secretary: {
        enabled: member.secretary?.enabled ?? false
      }
    });
    setShowMemberModal(true);
  };

  // Save team member
  const handleSaveMember = async () => {
    if (!clinic || !memberForm.name) {
      alert('Por favor, defina o nome do colaborador');
      return;
    }
    const path = `clinics/${clinic.id}/team_members`;
    
    // Construct nested attributes and equivalent flat keys to keep absolutely everything working
    const finalData = {
      name: memberForm.name,
      displayName: memberForm.displayName || memberForm.name,
      role: memberForm.role,
      active: !!memberForm.active,
      isProfessional: !!memberForm.attendance.isProfessional,
      isClinicalProvider: !!memberForm.attendance.isProfessional,
      isCommissionable: !!memberForm.financial.commissionEnabled,
      commission_enabled: !!memberForm.financial.commissionEnabled,
      defaultCommissionPercent: Number(memberForm.financial.commissionPercent),
      percentage: Number(memberForm.financial.commissionPercent),
      financial: {
        commissionPercent: Number(memberForm.financial.commissionPercent),
        commissionEnabled: !!memberForm.financial.commissionEnabled,
        receiveFinancialSummary: !!memberForm.financial.receiveFinancialSummary
      },
      attendance: {
        isProfessional: !!memberForm.attendance.isProfessional
      },
      marketing: {
        enabled: !!memberForm.marketing.enabled
      },
      secretary: {
        enabled: !!memberForm.secretary.enabled
      },
      updated_at: serverTimestamp(),
    };

    try {
      if (editingMember) {
        await updateDoc(doc(db, 'clinics', clinic.id, 'team_members', editingMember.id), finalData);
        // Also sync basic information (role and agenda serving) back to /members
        try {
          await updateDoc(doc(db, 'clinics', clinic.id, 'members', editingMember.id), {
            name: memberForm.name,
            role: memberForm.role,
            isClinicalProvider: !!memberForm.attendance.isProfessional
          });
        } catch (memberSyncErr) {
          console.warn("[finance] Synced back to /members skipped:", memberSyncErr);
        }
      } else {
        await addDoc(collection(db, 'clinics', clinic.id, 'team_members'), {
          ...finalData,
          created_at: serverTimestamp()
        });
      }
      setShowMemberModal(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  };

  // Delete team member
  const handleDeleteMember = async (id: string) => {
    if (!confirm('Deseja realmente remover este colaborador da equipe? (Isso não apagará as comissões passadas)')) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic!.id, 'team_members', id));
    } catch (e) {
      console.error(e);
    }
  };

  // Open Modal to create rule
  const handleOpenNewRule = () => {
    setEditingRule(null);
    setRuleForm({
      professionalId: members.find(m => m.isProfessional && m.isCommissionable)?.id || '',
      professionalName: '',
      ruleType: 'default',
      category: TREATMENT_CATEGORIES[0],
      procedureName: DEFAULT_TREATMENT_CATALOG[0].name,
      commissionPercent: 10,
      active: true
    });
    setShowRuleModal(true);
  };

  // Save commission rule
  const handleSaveRule = async () => {
    if (!clinic) return;
    
    const selectedProf = members.find(m => m.id === ruleForm.professionalId);
    const profId = ruleForm.professionalId || '';
    const profName = selectedProf?.displayName || selectedProf?.name || 'Regra Geral';

    const finalData = {
      professionalId: profId,
      professionalName: profName,
      // backward compatibility fields
      member_id: profId,
      member_name: profName,
      name: ruleForm.ruleType === 'default' 
        ? `Comissão Padrão - ${profName}` 
        : ruleForm.ruleType === 'category' 
          ? `${ruleForm.category} - ${profName}` 
          : `${ruleForm.procedureName} - ${profName}`,
      ruleType: ruleForm.ruleType,
      category: ruleForm.ruleType === 'category' ? ruleForm.category : '',
      procedureName: ruleForm.ruleType === 'procedure' ? ruleForm.procedureName : '',
      commissionPercent: Number(ruleForm.commissionPercent),
      // backward compatibility keys
      percentage: Number(ruleForm.commissionPercent),
      commission_type: ruleForm.ruleType === 'procedure' ? 'procedure' : 'sale',
      active: ruleForm.active !== false,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingRule) {
        await updateDoc(doc(db, 'clinics', clinic.id, 'commission_rules', editingRule.id), finalData);
      } else {
        await addDoc(collection(db, 'clinics', clinic.id, 'commission_rules'), {
          ...finalData,
          createdAt: serverTimestamp()
        });
      }
      setShowRuleModal(false);
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar regra');
    }
  };

  // Toggle rule status quick action
  const handleToggleRuleActive = async (rule: any) => {
    if (!clinic) return;
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'commission_rules', rule.id), {
        active: !rule.active,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Delete commission rule
  const handleDeleteRule = async (id: string) => {
    if (!confirm('Deseja realmente excluir esta regra de comissão?')) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic!.id, 'commission_rules', id));
    } catch (e) {
      console.error(e);
    }
  };

  // Form helpers
  const handleRoleChange = (roleVal: Role) => {
    const isDocOrDentist = roleVal === 'dentist' || roleVal === 'doctor';
    setMemberForm({
      ...memberForm,
      role: roleVal,
      isProfessional: isDocOrDentist,
      isCommissionable: isDocOrDentist,
      defaultCommissionPercent: isDocOrDentist ? 30 : 0
    });
  };

  return (
    <div className="space-y-12">
      {/* Team Section */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-3">
              <Users className="w-6 h-6 text-indigo-600" />
              Equipe & Colaboradores Clinicos
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Configure o perfil comissionável de cada profissional</p>
          </div>
          <button 
            onClick={() => {
              window.dispatchEvent(new CustomEvent('navigate-view', { detail: 'settings' }));
            }}
            className="w-full sm:w-auto bg-indigo-600 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <Users className="w-4 h-4" />
            Gerenciar Equipe
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {members.map(member => {
            const isProf = member.isProfessional ?? (member.role === 'dentist' || member.role === 'doctor');
            const isComm = member.isCommissionable ?? (member.commission_enabled !== false);
            const isActive = member.active !== false;
            const defPct = member.defaultCommissionPercent ?? (member.percentage || 0);

            return (
              <div key={member.id} className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500 font-bold text-xl uppercase shrink-0">
                      {(member.name || 'C')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-900 text-sm truncate">{member.name}</h3>
                      <p className="text-[9px] text-indigo-600 font-black uppercase tracking-widest leading-none mt-1">
                        {ROLES.find(r => r.value === member.role)?.label || String(member.role).toUpperCase()}
                      </p>
                    </div>
                    <div className="shrink-0">
                       <span className={`inline-block w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} title={isActive ? 'Ativo' : 'Inativo'}></span>
                    </div>
                  </div>

                  <div className="space-y-2 py-3 border-t border-b border-slate-100 my-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Membro Clínico / Atendimento:</span>
                      <span className={`font-bold uppercase text-[10px] ${isProf ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {isProf ? 'Sim' : 'Não'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Participa de Comissões:</span>
                      <span className={`font-bold uppercase text-[10px] ${isComm ? 'text-emerald-650' : 'text-slate-400'}`}>
                        {isComm ? 'Sim' : 'Não'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Comissão Padrão:</span>
                      <span className="font-black text-slate-800 font-mono text-sm">
                        {defPct}%
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-2">
                  <button 
                    onClick={() => handleDeleteMember(member.id)}
                    className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-all"
                    title="Excluir Colaborador"
                  >
                    <Trash2 className="w-4.5 h-4.5" />
                  </button>
                  <button 
                    onClick={() => handleOpenEditMember(member)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all flex items-center gap-1.5"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Configurar
                  </button>
                </div>
              </div>
            );
          })}
          {members.length === 0 && (
            <div className="col-span-full py-12 text-center bg-white border border-slate-200 rounded-[32px] text-slate-400 text-xs italic">
              Nenhum colaborador cadastrado. Adicione um novo membro acima.
            </div>
          )}
        </div>
      </section>

      {/* Rules Section (Part 2) */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-3">
              <Target className="w-6 h-6 text-teal-600" />
              Regras Especializadas de Comissão
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Configure regras customizadas por categoria ou procedimento por profissional</p>
          </div>
          <button 
            onClick={handleOpenNewRule}
            className="w-full sm:w-auto bg-teal-650 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-teal-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nova Regra por Profissional
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {rules.map(rule => {
            const ruleT = rule.ruleType || 'default';
            const targetName = rule.professionalName || 'Todos';

            return (
              <div key={rule.id} className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 ${rule.active ? 'bg-teal-50 text-teal-600' : 'bg-slate-50 text-slate-400'} rounded-2xl flex items-center justify-center shrink-0`}>
                        <Percent className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm leading-tight">{targetName}</h3>
                        <p className="text-[9px] text-indigo-600 font-black uppercase tracking-widest mt-1">
                          {ruleT === 'default' 
                            ? 'Padrão Profissional (Geral)' 
                            : ruleT === 'category' 
                              ? `Por Categoria: ${rule.category}` 
                              : `Por Procedimento: ${rule.procedureName}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-slate-950 tracking-tighter">{rule.commissionPercent ?? rule.percentage}%</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Comissão</p>
                    </div>
                  </div>

                  <div className="h-6 mb-4">
                    {ruleT === 'procedure' && (
                      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg shrink-0">
                        {rule.procedureName}
                      </span>
                    )}
                    {ruleT === 'category' && (
                      <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-3 py-1.5 rounded-lg shrink-0">
                        Categoria: {rule.category}
                      </span>
                    )}
                    {ruleT === 'default' && (
                      <span className="text-[10px] font-bold text-indigo-750 bg-indigo-50 px-3 py-1.5 rounded-lg shrink-0">
                        Comissão base de contingência
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-50">
                  <button 
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-2 hover:bg-rose-50 px-3 py-2 rounded-xl transition-all"
                  >
                    <Trash2 className="w-4 h-4" /> Excluir
                  </button>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-black uppercase tracking-tighter ${rule.active ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {rule.active ? 'Ativa' : 'Inativa'}
                    </span>
                    <button 
                      onClick={() => handleToggleRuleActive(rule)}
                      className={`w-12 h-6 rounded-full p-1 transition-colors ${rule.active ? 'bg-emerald-500' : 'bg-slate-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${rule.active ? 'translate-x-6' : 'translate-x-0'}`}></div>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {rules.length === 0 && (
            <div className="col-span-full py-16 text-center bg-white border border-slate-200 rounded-[32px] text-slate-450 italic text-xs">
              Nenhuma regra comissionável customizada salva. Regras específicas substituem a comissão padrão de procedimento.
            </div>
          )}
        </div>
      </section>

      {/* Member Modal (Add/Edit) */}
      {showMemberModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 overflow-y-auto max-h-[90vh] relative"
          >
            <button 
              onClick={() => setShowMemberModal(false)}
              className="absolute top-6 right-6 p-1 text-slate-400 hover:text-slate-650 hover:bg-slate-100 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

             <h2 className="text-xl font-black text-slate-900 tracking-tight">
              {editingMember ? 'Configurações Financeiras & Acessos' : 'Novo Colaborador'}
            </h2>
            <p className="text-xs text-slate-400 font-medium mb-6">Ajuste comissões, recebimento de relatórios e permissões operacionais do colaborador.</p>
            
            <div className="space-y-5">
              {/* Profile Details (Readonly) */}
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Nome Completo</span>
                  <span className="text-sm font-bold text-slate-800">{memberForm.name || 'Sem nome'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Cargo principal</span>
                    <span className="text-xs font-bold text-indigo-600">
                      {ROLES.find(r => r.value === memberForm.role)?.label || String(memberForm.role || '').toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">DisplayName</span>
                    <span className="text-xs font-bold text-slate-600">{memberForm.displayName || memberForm.name}</span>
                  </div>
                </div>
              </div>

              {/* isProfessional toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Profissional de Atendimento</span>
                  <span className="text-[9px] text-slate-400">Atende pacientes na agenda clínica</span>
                </div>
                <button 
                  onClick={() => setMemberForm({
                    ...memberForm, 
                    attendance: { ...memberForm.attendance, isProfessional: !memberForm.attendance?.isProfessional }
                  })}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${memberForm.attendance?.isProfessional ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${memberForm.attendance?.isProfessional ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* isCommissionable toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Participa de Comissões</span>
                  <span className="text-[9px] text-slate-400">Permite filtros e geração automática de repasses</span>
                </div>
                <button 
                  onClick={() => setMemberForm({
                    ...memberForm,
                    financial: { ...memberForm.financial, commissionEnabled: !memberForm.financial?.commissionEnabled }
                  })}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${memberForm.financial?.commissionEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${memberForm.financial?.commissionEnabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* defaultCommissionPercent */}
              {memberForm.financial?.commissionEnabled && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Percentual de Comissão Padrão (%)</label>
                  <div className="relative">
                    <input 
                      type="number"
                      min={0}
                      max={100}
                      value={memberForm.financial?.commissionPercent ?? 0}
                      onChange={e => setMemberForm({
                        ...memberForm,
                        financial: { ...memberForm.financial, commissionPercent: Number(e.target.value) }
                      })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all pr-8"
                      placeholder="Ex: 30"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">%</span>
                  </div>
                </div>
              )}

              {/* receiveFinancialSummary toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Receber Resumo Financeiro</span>
                  <span className="text-[9px] text-slate-400">Envia resumo das movimentações por e-mail/relatórios</span>
                </div>
                <button 
                  onClick={() => setMemberForm({
                    ...memberForm,
                    financial: { ...memberForm.financial, receiveFinancialSummary: !memberForm.financial?.receiveFinancialSummary }
                  })}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${memberForm.financial?.receiveFinancialSummary ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${memberForm.financial?.receiveFinancialSummary ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* secretaryEnabled toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Painel de Secretária Geral</span>
                  <span className="text-[9px] text-slate-400">Vincula o colaborador a atendimentos de recepção</span>
                </div>
                <button 
                  onClick={() => setMemberForm({
                    ...memberForm,
                    secretary: { ...memberForm.secretary, enabled: !memberForm.secretary?.enabled }
                  })}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${memberForm.secretary?.enabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${memberForm.secretary?.enabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* marketingEnabled toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Mapeamento de Marketing</span>
                  <span className="text-[9px] text-slate-400">Ativa atribuição e relatórios de captura de campanhas</span>
                </div>
                <button 
                  onClick={() => setMemberForm({
                    ...memberForm,
                    marketing: { ...memberForm.marketing, enabled: !memberForm.marketing?.enabled }
                  })}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${memberForm.marketing?.enabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${memberForm.marketing?.enabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Colaborador Ativo</span>
                  <span className="text-[9px] text-slate-400">Permite filtros e novos agendamentos</span>
                </div>
                <button 
                  onClick={() => setMemberForm({...memberForm, active: !memberForm.active})}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${memberForm.active ? 'bg-emerald-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${memberForm.active ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => setShowMemberModal(false)} 
                className="flex-1 py-3 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-slate-600"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveMember}
                className="flex-1 py-3 bg-indigo-650 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-600/10 hover:bg-indigo-700 transition"
              >
                Salvar Configurações
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Rule Modal (Add/Edit) */}
      {showRuleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 overflow-y-auto max-h-[90vh] relative"
          >
            <button 
              onClick={() => setShowRuleModal(false)}
              className="absolute top-6 right-6 p-1 text-slate-400 hover:text-slate-650 hover:bg-slate-100 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-xl font-black text-slate-900 tracking-tight">Nova Regra Especializada</h2>
            <p className="text-xs text-slate-400 font-medium mb-6">Aplique regras customizadas de repasse financeiro por profissional.</p>
            
            <div className="space-y-5">
              {/* Professional Select */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Profissional Comissionável</label>
                <select 
                  value={ruleForm.professionalId}
                  onChange={e => setRuleForm({...ruleForm, professionalId: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-teal-500 focus:bg-white outline-none transition-all"
                >
                  <option value="">Selecione o profissional...</option>
                  {members.filter(m => (m.isProfessional || m.role === 'dentist' || m.role === 'doctor') && (m.isCommissionable || m.commission_enabled !== false)).map(m => (
                    <option key={m.id} value={m.id}>{m.displayName || m.name}</option>
                  ))}
                </select>
              </div>

              {/* Rule Type Selector */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Tipo de Regra</label>
                <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl">
                  {['default', 'category', 'procedure'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setRuleForm({...ruleForm, ruleType: type})}
                      className={`py-2 rounded-lg text-[9px] font-black uppercase tracking-tight transition-all ${ruleForm.ruleType === type ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      {type === 'default' ? 'Padrão' : type === 'category' ? 'Categoria' : 'Procedimento'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category selector */}
              {ruleForm.ruleType === 'category' && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Categoria Clínico-Procedimental</label>
                  <select 
                    value={ruleForm.category}
                    onChange={e => setRuleForm({...ruleForm, category: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-teal-500 focus:bg-white outline-none transition-all"
                  >
                    {TREATMENT_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Procedure Name selection */}
              {ruleForm.ruleType === 'procedure' && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Procedimento Específico</label>
                  <select 
                    value={ruleForm.procedureName}
                    onChange={e => setRuleForm({...ruleForm, procedureName: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-teal-500"
                  >
                    {DEFAULT_TREATMENT_CATALOG.map(item => (
                      <option key={item.id} value={item.name}>{item.name} ({item.category})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Commission Percentage input */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Percentual de Comissão (%)</label>
                <div className="relative">
                  <input 
                    type="number"
                    min={0}
                    max={100}
                    value={ruleForm.commissionPercent}
                    onChange={e => setRuleForm({...ruleForm, commissionPercent: Number(e.target.value)})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black focus:ring-2 focus:ring-teal-500 focus:bg-white outline-none pr-8"
                    placeholder="Ex: 30"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400">%</span>
                </div>
              </div>

              {/* Active rule toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Regra Ativa</span>
                  <span className="text-[9px] text-slate-400">Desative temporariamente sem excluir</span>
                </div>
                <button 
                  onClick={() => setRuleForm({...ruleForm, active: !ruleForm.active})}
                  className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${ruleForm.active ? 'bg-emerald-500' : 'bg-slate-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${ruleForm.active ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => setShowRuleModal(false)} 
                className="flex-1 py-3 text-slate-400 font-bold text-[10px] uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveRule}
                disabled={!ruleForm.professionalId}
                className="flex-1 py-3 bg-teal-650 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-teal-650/10 transition"
              >
                Gerar Regra
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
