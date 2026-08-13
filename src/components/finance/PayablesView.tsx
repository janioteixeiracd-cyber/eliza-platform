import React, { useState, useEffect } from 'react';
import { 
  ArrowDownRight, 
  Plus, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  XCircle,
  MoreHorizontal,
  Search,
  Filter,
  CreditCard,
  Building2,
  Package,
  Layers,
  GraduationCap,
  Hammer
} from 'lucide-react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ClinicPayable, Priority, PayableStatus } from '../../types/finance';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CATEGORIES = [
  'aluguel', 'laboratório', 'materiais', 'folha/equipe', 'comissão', 'impostos', 'marketing', 'cartão/empréstimo', 'sistema/software', 'manutenção', 'outros'
];

export default function PayablesView() {
  const { clinic } = useAuth();
  const [payables, setPayables] = useState<ClinicPayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const [newPayable, setNewPayable] = useState<Partial<ClinicPayable>>({
    description: '',
    supplier: '',
    category: 'materiais',
    amount: 0,
    due_date: format(new Date(), 'yyyy-MM-dd'),
    status: 'open',
    priority: 'medium',
    is_recurring: false
  });

  useEffect(() => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/clinic_payables`;
    const unsub = onSnapshot(query(collection(db, 'clinics', clinic.id, 'clinic_payables'), orderBy('due_date', 'asc'), limit(50)), (snap) => {
      setPayables(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClinicPayable)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, path);
      setLoading(false);
    });
    return () => unsub();
  }, [clinic]);

  const handleAddPayable = async () => {
    if (!clinic || !newPayable.description || !newPayable.amount) return;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'clinic_payables'), {
        ...newPayable,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
      setShowAddModal(false);
      setNewPayable({ description: '', supplier: '', category: 'materiais', amount: 0, due_date: format(new Date(), 'yyyy-MM-dd'), status: 'open', priority: 'medium', is_recurring: false });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `clinics/${clinic.id}/clinic_payables`);
    }
  };

  const handleMarkAsPaid = async (id: string) => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/clinic_payables/${id}`;
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'clinic_payables', id), {
        status: 'paid',
        paid_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  };

  const totals = {
    open: payables.filter(p => p.status === 'open').reduce((sum, p) => sum + p.amount, 0),
    overdue: payables.filter(p => p.status === 'overdue' || (p.status === 'open' && new Date(p.due_date) < new Date())).reduce((sum, p) => sum + p.amount, 0),
    paidMonth: payables.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0),
  };

  const priorityMap: Record<Priority, { label: string, color: string, bg: string }> = {
    low: { label: 'Baixa', color: 'text-slate-500', bg: 'bg-slate-50' },
    medium: { label: 'Média', color: 'text-indigo-600', bg: 'bg-indigo-50' },
    high: { label: 'Alta', color: 'text-amber-600', bg: 'bg-amber-50' },
    critical: { label: 'Crítica', color: 'text-rose-600', bg: 'bg-rose-50' }
  };

  const statusMap: Record<PayableStatus, { label: string, color: string, bg: string, icon: any }> = {
    open: { label: 'Em Aberto', color: 'text-indigo-600', bg: 'bg-indigo-50', icon: Clock },
    paid: { label: 'Pago', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle2 },
    overdue: { label: 'Atrasado', color: 'text-rose-600', bg: 'bg-rose-50', icon: AlertCircle },
    negotiated: { label: 'Negociado', color: 'text-amber-600', bg: 'bg-amber-50', icon: RefreshCw },
    canceled: { label: 'Cancelado', color: 'text-slate-400', bg: 'bg-slate-50', icon: XCircle }
  };

  return (
    <div className="space-y-10">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                 <Calendar className="w-5 h-5" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Em Aberto</p>
           </div>
           <p className="text-3xl font-black text-slate-900 tracking-tighter">R$ {totals.open.toLocaleString('pt-BR')}</p>
           <p className="text-[10px] text-slate-400 mt-2 font-medium">Contas no radar</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
                 <AlertCircle className="w-5 h-5" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Atrasado</p>
           </div>
           <p className="text-3xl font-black text-rose-600 tracking-tighter">R$ {totals.overdue.toLocaleString('pt-BR')}</p>
           <p className="text-[10px] text-rose-400 mt-2 font-bold font-mono">Ação Necessária!</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                 <CheckCircle2 className="w-5 h-5" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pago no Mês</p>
           </div>
           <p className="text-3xl font-black text-slate-900 tracking-tighter">R$ {totals.paidMonth.toLocaleString('pt-BR')}</p>
           <p className="text-[10px] text-emerald-600 mt-2 font-bold uppercase tracking-tighter">Fluxo Positivo</p>
        </div>

        <div className="bg-slate-900 rounded-[32px] p-8 shadow-lg shadow-slate-900/20 text-white flex flex-col justify-between">
           <div className="flex items-center justify-between">
             <div className="flex items-center gap-3 opacity-60">
                <Plus className="w-5 h-5" />
                <p className="text-[10px] font-black uppercase tracking-widest">Nova Conta</p>
             </div>
             <button onClick={() => setShowAddModal(true)} className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-all">
                <Plus className="w-6 h-6" />
             </button>
           </div>
           <p className="text-xs font-medium opacity-80 leading-relaxed mt-4">Registre novas despesas da clínica para análise da IA.</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-[40px] overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Vencimento</th>
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Descrição / Fornecedor</th>
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Categoria</th>
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Prioridade</th>
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Valor</th>
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Status</th>
              <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100"></th>
            </tr>
          </thead>
          <tbody>
            {payables.map((p) => {
              const pConfig = priorityMap[p.priority];
              const sConfig = statusMap[p.status];
              const isOverdue = p.status === 'open' && new Date(p.due_date) < new Date();
              
              return (
                <tr key={p.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-8 py-6 border-b border-slate-50">
                    <p className={`text-sm font-black ${isOverdue ? 'text-rose-600' : 'text-slate-900'} tracking-tighter`}>
                       {format(new Date(p.due_date + 'T12:00:00'), 'dd MMM yyyy', { locale: ptBR })}
                    </p>
                    {isOverdue && <p className="text-[9px] text-rose-500 font-black uppercase tracking-tighter">Atrasado</p>}
                  </td>
                  <td className="px-8 py-6 border-b border-slate-50">
                    <p className="text-sm font-bold text-slate-900">{p.description}</p>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">{p.supplier || 'Sem fornecedor'}</p>
                  </td>
                  <td className="px-8 py-6 border-b border-slate-50">
                    <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg uppercase tracking-tighter">{p.category}</span>
                  </td>
                  <td className="px-8 py-6 border-b border-slate-50">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${pConfig.bg} ${pConfig.color}`}>
                       {pConfig.label}
                    </span>
                  </td>
                  <td className="px-8 py-6 border-b border-slate-50">
                    <p className="text-sm font-black text-slate-900 tracking-tighter">R$ {p.amount.toLocaleString('pt-BR')}</p>
                  </td>
                  <td className="px-8 py-6 border-b border-slate-50">
                    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${sConfig.bg} ${sConfig.color}`}>
                       {sConfig.label}
                    </span>
                  </td>
                  <td className="px-8 py-6 border-b border-slate-50 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       {p.status === 'open' && (
                         <button 
                           onClick={() => handleMarkAsPaid(p.id)}
                           className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                           title="Marcar como Pago"
                         >
                           <CheckCircle2 className="w-5 h-5" />
                         </button>
                       )}
                       <button className="p-2 text-slate-300 hover:text-slate-600">
                          <MoreHorizontal className="w-5 h-5" />
                       </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal - Simplified */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-md rounded-[40px] p-10 shadow-2xl">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-8">Cadastrar Despesa</h2>
              <div className="space-y-4">
                 <input 
                   placeholder="Descrição da conta"
                   value={newPayable.description}
                   onChange={e => setNewPayable({...newPayable, description: e.target.value})}
                   className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold"
                 />
                 <div className="flex gap-4">
                    <input 
                      type="number"
                      placeholder="Valor R$"
                      value={newPayable.amount || ''}
                      onChange={e => setNewPayable({...newPayable, amount: Number(e.target.value)})}
                      className="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold"
                    />
                    <input 
                      type="date"
                      value={newPayable.due_date}
                      onChange={e => setNewPayable({...newPayable, due_date: e.target.value})}
                      className="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold"
                    />
                 </div>
                 <select 
                    value={newPayable.category}
                    onChange={e => setNewPayable({...newPayable, category: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold"
                 >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                 </select>
                 <select 
                    value={newPayable.priority}
                    onChange={e => setNewPayable({...newPayable, priority: e.target.value as any})}
                    className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold"
                 >
                    <option value="low">PRIORIDADE BAIXA</option>
                    <option value="medium">PRIORIDADE MÉDIA</option>
                    <option value="high">PRIORIDADE ALTA</option>
                    <option value="critical">PRIORIDADE CRÍTICA</option>
                 </select>
              </div>
              <div className="mt-8 flex gap-4">
                 <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Cancelar</button>
                 <button onClick={handleAddPayable} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-600/20">Salvar Conta</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

function RefreshCw(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>;
}

function Clock(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
