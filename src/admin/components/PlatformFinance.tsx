import React, { useState } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { CreditCard, TrendingUp, DollarSign, Calendar, ChevronRight, Award, Edit3, Settings, Plus, X, Loader2, Trash2 } from 'lucide-react';

export default function PlatformFinance() {
  const { clinics, plans, updateClinicPlan, createPlan, updatePlan, deactivatePlan, isLoading } = useAdmin();
  const [selectedClinic, setSelectedClinic] = useState<any | null>(null);
  const [newPlan, setNewPlan] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ name: '', price: '', description: '', maxUsers: '', active: true });
  const [savingPlan, setSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const activePlans = plans.filter((p: any) => p.active !== false);

  const planCounts = activePlans.reduce((acc: Record<string, number>, plan: any) => {
    acc[plan.id] = clinics.filter((c: any) => (c.planId || c.plan) === plan.id).length;
    return acc;
  }, {} as Record<string, number>);

  const handleUpdatePlan = async () => {
    if (!selectedClinic) return;
    setIsUpdating(true);
    try {
      await updateClinicPlan(selectedClinic.id, newPlan);
      setSelectedClinic(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsUpdating(false);
    }
  };

  const openNewPlan = () => {
    setEditingPlanId(null);
    setPlanForm({ name: '', price: '', description: '', maxUsers: '', active: true });
    setPlanError(null);
    setIsPlanModalOpen(true);
  };
  const openEditPlan = (plan: any) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name || '', price: plan.price != null ? String(plan.price) : '',
      description: plan.description || '', maxUsers: plan.maxUsers != null ? String(plan.maxUsers) : '',
      active: plan.active !== false,
    });
    setPlanError(null);
    setIsPlanModalOpen(true);
  };

  const handleSavePlan = async () => {
    if (!planForm.name.trim()) return;
    setSavingPlan(true);
    setPlanError(null);
    try {
      const payload = {
        name: planForm.name.trim(),
        price: Number(planForm.price) || 0,
        description: planForm.description.trim() || undefined,
        maxUsers: planForm.maxUsers ? Number(planForm.maxUsers) : null,
        active: planForm.active,
      };
      if (editingPlanId) {
        await updatePlan(editingPlanId, payload);
      } else {
        await createPlan(payload);
      }
      setIsPlanModalOpen(false);
    } catch (e: any) {
      setPlanError(e?.message || 'Falha ao salvar plano.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleDeactivatePlan = async (planId: string) => {
    if (!confirm('Desativar este plano? Clínicas já vinculadas continuam vinculadas, mas ele some das opções para novas atribuições.')) return;
    await deactivatePlan(planId);
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Assinaturas e Planos</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Gestão de pacotes SaaS e limites das clínicas</p>
        </div>
        <button
          onClick={openNewPlan}
          className="px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-teal-600/15"
        >
          <Plus className="w-4 h-4" /> Novo Plano
        </button>
      </header>

      {/* Grid of Plans */}
      {activePlans.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-dashed border-slate-200 p-12 text-center text-slate-400 space-y-3">
          <Award className="w-10 h-10 mx-auto stroke-1" />
          <p className="text-[11px] font-black uppercase tracking-widest">Nenhum plano cadastrado ainda</p>
          <p className="text-[10px] font-medium">Crie o primeiro plano pra poder atribuí-lo às clínicas.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {activePlans.map((plan: any) => (
            <div key={plan.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest truncate">{plan.name}</span>
                <Award className="w-4 h-4 text-teal-600 shrink-0" />
              </div>
              <h3 className="text-xl font-black text-slate-900">{planCounts[plan.id] || 0}</h3>
              <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">unidades · R$ {(plan.price || 0).toLocaleString('pt-BR')}/mês</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => openEditPlan(plan)} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[8.5px] font-black uppercase rounded-lg transition-colors">Editar</button>
                <button onClick={() => handleDeactivatePlan(plan.id)} className="py-1.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Clinics Plan management list */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Contratos e Planos por Unidade</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Clínica', 'Plano Atual', 'Status', 'Ações'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clinics.map((c: any) => {
                  const plan = plans.find((p: any) => p.id === (c.planId || c.plan));
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{c.name}</p>
                        <p className="text-[9px] text-slate-400 font-mono">{c.id}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-teal-50 text-teal-700 text-[9px] font-black uppercase rounded-lg border border-teal-100">
                          {plan?.name || c.planId || c.plan || 'Sem plano'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[9px] font-black uppercase tracking-wider ${c.status === 'active' ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => {
                            setSelectedClinic(c);
                            setNewPlan(c.planId || c.plan || '');
                          }}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          <Edit3 className="w-3 h-3" /> Alterar Plano
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal/Form to edit */}
        {selectedClinic ? (
          <div className="bg-slate-900 rounded-[2.5rem] text-white p-8 space-y-6 flex flex-col justify-between shadow-2xl border border-slate-800 animate-in fade-in duration-300">
            <div>
              <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
                <CreditCard className="w-6 h-6 text-teal-400" />
              </div>
              <h3 className="text-lg font-black tracking-tight mb-2 uppercase">Alterar Plano</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Clínica Selecionada:</p>
              <p className="text-sm font-black text-white uppercase mt-0.5">{selectedClinic.name}</p>

              <div className="mt-6 space-y-4">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Novo Plano</label>
                <div className="grid grid-cols-2 gap-2">
                  {activePlans.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => setNewPlan(p.id)}
                      className={`py-3 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all truncate px-2 ${
                        newPlan === p.id
                        ? 'bg-teal-600 border-teal-500 text-white'
                        : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {activePlans.length === 0 && <p className="text-[9px] text-amber-400">Nenhum plano cadastrado ainda.</p>}
              </div>
            </div>

            <div className="pt-6 flex gap-3">
              <button
                onClick={() => setSelectedClinic(null)}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpdatePlan}
                disabled={isUpdating}
                className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
              >
                {isUpdating ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-[2.5rem] p-8 text-center flex flex-col items-center justify-center space-y-4 text-slate-400 min-h-[350px]">
            <Settings className="w-12 h-12 stroke-1 opacity-60" />
            <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
              Selecione uma clínica na lista para alterar suas características de contratação e plano.
            </p>
          </div>
        )}
      </div>

      {/* PLAN MODAL */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingPlan && setIsPlanModalOpen(false)}>
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-md shadow-2xl p-8 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{editingPlanId ? 'Editar plano' : 'Novo plano'}</h3>
              <button onClick={() => setIsPlanModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Nome do plano *</label>
              <input autoFocus value={planForm.name} onChange={(e) => setPlanForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Preço mensal (R$)</label>
                <input type="number" value={planForm.price} onChange={(e) => setPlanForm(v => ({ ...v, price: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all" />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Limite de usuários</label>
                <input type="number" value={planForm.maxUsers} onChange={(e) => setPlanForm(v => ({ ...v, maxUsers: e.target.value }))} placeholder="sem limite" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Descrição</label>
              <textarea value={planForm.description} onChange={(e) => setPlanForm(v => ({ ...v, description: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all h-16 resize-none" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={planForm.active} onChange={(e) => setPlanForm(v => ({ ...v, active: e.target.checked }))} className="w-4 h-4 accent-teal-600" />
              <span className="text-[10px] font-bold text-slate-600 uppercase">Plano ativo (disponível pra atribuir)</span>
            </label>
            {planError && <p className="text-[10px] text-rose-600 font-bold">{planError}</p>}
            <button
              onClick={handleSavePlan}
              disabled={savingPlan || !planForm.name.trim()}
              className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {savingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {savingPlan ? 'Salvando...' : 'Salvar plano'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
