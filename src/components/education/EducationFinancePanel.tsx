import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  limit
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { 
  DollarSign, 
  Plus, 
  Search, 
  Users, 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle2, 
  Clock, 
  Trash2,
  Calendar,
  Landmark,
  FileCheck2,
  AlertTriangle,
  UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface EducationFinancePanelProps {
  clinicId: string;
  staff: any[];
  educationPatients: any[];
  courses: any[];
}

export default function EducationFinancePanel({
  clinicId,
  staff,
  educationPatients,
  courses
}: EducationFinancePanelProps) {
  // Sync general clinic financial entries to recognize education transactions
  const [financialEntries, setFinancialEntries] = useState<any[]>([]);
  // Sync general clinic patients to prevent duplication
  const [clinicPatients, setClinicPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [selectedPatientSource, setSelectedPatientSource] = useState<'education' | 'clinical' | 'custom'>('custom');
  const [selectedPatientRef, setSelectedPatientRef] = useState<any | null>(null);

  const [newEntry, setNewEntry] = useState({
    description: '',
    amount: '',
    status: 'pago', // 'pago' | 'pendente'
    paymentMethod: 'PIX',
    caixa: 'Caixa Geral',
    responsibleId: '',
    customPatientName: ''
  });

  // Query general clinic patients to prevent duplication
  useEffect(() => {
    if (!clinicId) return;
    const qPatients = query(collection(db, 'clinics', clinicId, 'patients'), limit(200));
    const unsubP = onSnapshot(qPatients, (snap) => {
      setClinicPatients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("Error loaded general clinic patients for finance integration:", err));

    return unsubP;
  }, [clinicId]);

  // Query and sync real-time financial entries from 'financial_entries' collection
  useEffect(() => {
    if (!clinicId) return;
    const qEntries = query(collection(db, 'clinics', clinicId, 'financial_entries'));
    
    const unsubE = onSnapshot(qEntries, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Group & filter all financial entries marked with Education tag
      const filtered = list.filter((e: any) => 
        e.isEducation === true ||
        e.source === 'eliza_education' ||
        String(e.category).toLowerCase().includes('education') ||
        String(e.category).toLowerCase().includes('educação') ||
        String(e.description).toUpperCase().includes('[ELIZA EDUCATION]')
      );
      // Sort by newest date
      setFinancialEntries(filtered.sort((a: any, b: any) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
      }));
      setLoading(false);
    }, (err) => console.error("Error loaded financial entries:", err));

    return unsubE;
  }, [clinicId]);

  // Financial summary calculations
  const totalReceived = financialEntries
    .filter(e => e.status === 'pago' || e.status === 'paid')
    .reduce((sum, e) => sum + (parseFloat(e.amount || e.value) || 0), 0);

  const totalPending = financialEntries
    .filter(e => e.status === 'pendente' || e.status === 'pending')
    .reduce((sum, e) => sum + (parseFloat(e.amount || e.value) || 0), 0);

  const handleSaveTransaction = async () => {
    if (!newEntry.description || !newEntry.amount) {
      alert("Por favor, preencha a descrição e o valor da transação.");
      return;
    }

    try {
      let patientId = null;
      let patientName = '';

      if (selectedPatientSource === 'education' && selectedPatientRef) {
        patientId = selectedPatientRef.patientClinicId || selectedPatientRef.id;
        patientName = selectedPatientRef.name;
      } else if (selectedPatientSource === 'clinical' && selectedPatientRef) {
        patientId = selectedPatientRef.id;
        patientName = selectedPatientRef.name;
      } else {
        patientName = newEntry.customPatientName || 'Lançamento Avulso';
      }

      const responsibleObj = staff.find(s => s.id === newEntry.responsibleId);

      const entryPayload = {
        description: `[ELIZA Education] ${newEntry.description}`,
        amount: parseFloat(newEntry.amount),
        value: parseFloat(newEntry.amount),
        category: 'ELIZA Education',
        isEducation: true,
        source: 'eliza_education',
        type: 'receita',
        status: newEntry.status === 'pago' ? 'pago' : 'pendente',
        
        patientId: patientId,
        patient_id: patientId,
        patientName: patientName,
        patient_name: patientName,

        caixa: newEntry.caixa || 'Caixa Geral',
        caixa_utilizado: newEntry.caixa || 'Caixa Geral',
        paymentMethod: newEntry.paymentMethod,
        payment_method: newEntry.paymentMethod,

        sale_responsible_id: newEntry.responsibleId || null,
        responsibleName: responsibleObj?.name || null,

        date: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        competence_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        createdAt: serverTimestamp(),
        createdBy: 'system'
      };

      await addDoc(collection(db, 'clinics', clinicId, 'financial_entries'), entryPayload);
      
      // Reset form states
      setIsAddModalOpen(false);
      setNewEntry({
        description: '',
        amount: '',
        status: 'pago',
        paymentMethod: 'PIX',
        caixa: 'Caixa Geral',
        responsibleId: '',
        customPatientName: ''
      });
      setSelectedPatientRef(null);
      setSelectedPatientSource('custom');
      setPatientSearchQuery('');
    } catch (err) {
      console.error("Error creating education transaction:", err);
      alert("Erro ao criar transação.");
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!confirm("Excluir lançamento financeiro permanente?")) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinicId, 'financial_entries', id));
    } catch (err) {
      console.error("Error deleting financial transaction:", err);
    }
  };

  // Filter existing financial transactions table list based on text search
  const filteredTransactions = financialEntries.filter(e => {
    const text = `${e.description} ${e.patientName || ''} ${e.caixa || ''}`.toLowerCase();
    return text.includes(searchTerm.toLowerCase());
  });

  // Autocomplete patient search lists combined to avoid duplicates
  const filteredEducationPatients = educationPatients.filter(p => 
    p.name?.toLowerCase().includes(patientSearchQuery.toLowerCase())
  );

  const filteredClinicalPatients = clinicPatients.filter(p => {
    // Avoid listing patients who are already in education list with same name to avoid duplicates
    const inEducation = educationPatients.some(ed => ed.name?.toLowerCase() === p.name?.toLowerCase() || ed.patientClinicId === p.id);
    return !inEducation && p.name?.toLowerCase().includes(patientSearchQuery.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Banner de Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-6 rounded-3xl border border-slate-200 gap-4">
        <div className="text-left space-y-1">
          <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600 animate-pulse" />
            Painel Financeiro - ELIZA Education
          </h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
            Valores integrados diretamente nas finanças gerais da <span className="text-teal-600 font-black">Eliza Clínica</span>
          </p>
        </div>

        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md flex items-center gap-2 cursor-pointer self-stretch sm:self-auto justify-center"
        >
          <Plus className="w-4 h-4" />
          <span>Receber Pagamento</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-emerald-50/50 border border-emerald-100 p-6 rounded-3xl text-left shadow-xs">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Recebido (Education)</span>
            <ArrowUpRight className="w-5 h-5 text-emerald-600" />
          </div>
          <h3 className="text-xl sm:text-2xl font-black tracking-tight text-emerald-800 mt-4">
            R$ {totalReceived.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
          <p className="text-[9px] font-semibold text-emerald-700 uppercase mt-1 tracking-wider">Soma de receitas pagas</p>
        </div>

        <div className="bg-amber-50/40 border border-amber-100 p-6 rounded-3xl text-left shadow-xs">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contas Pendentes (Education)</span>
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-xl sm:text-2xl font-black tracking-tight text-amber-850 mt-4">
            R$ {totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
          <p className="text-[9px] font-semibold text-amber-700 uppercase mt-1 tracking-wider">Aguardando recebimento</p>
        </div>

        <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl text-left shadow-xs sm:col-span-2 lg:col-span-1">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Aparato Integrado</span>
            <Landmark className="w-5 h-5 text-slate-500" />
          </div>
          <h3 className="text-xl sm:text-2xl font-black tracking-tight text-slate-800 mt-4">
            100% Automático
          </h3>
          <p className="text-[9px] font-semibold text-slate-500 uppercase mt-1 tracking-wider">Evita duplo cadastro de pacientes</p>
        </div>
      </div>

      {/* Tabela de Transações e Busca */}
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
        <header className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Buscar por descrição, paciente ou conta..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
            />
          </div>
          <span className="px-3 py-1.5 bg-slate-100 text-slate-650 text-[10px] font-bold uppercase rounded-lg self-start">
            {filteredTransactions.length} Lançamentos Encontrados
          </span>
        </header>

        {loading ? (
          <div className="p-12 text-center text-slate-450 font-bold uppercase text-[10px]">
            Carregando transações do banco de dados...
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-12 text-center text-slate-450 space-y-2">
            <p className="font-bold uppercase text-[10.5px]">Nenhum lançamento financeiro da ELIZA Education encontrado.</p>
            <p className="text-[9.5px] font-medium text-slate-400">Clique em "Receber Pagamento" para criar o primeiro movimento.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 font-black uppercase text-[9px] tracking-wider">
                  <th className="p-4 pl-6">Data</th>
                  <th className="p-4">Descrição</th>
                  <th className="p-4 font-extrabold text-teal-700">Paciente</th>
                  <th className="p-4">Conta de Destino</th>
                  <th className="p-4">Pagamento</th>
                  <th className="p-4">Valor</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 pr-6 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700 select-none">
                {filteredTransactions.map((e) => {
                  const isPaid = e.status === 'pago' || e.status === 'paid';
                  const dateStr = e.date ? new Date(e.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '--';

                  return (
                    <tr key={e.id} className="hover:bg-slate-50/30 transition-all">
                      <td className="p-4 pl-6 font-semibold text-slate-400">{dateStr}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="p-1 px-1.5 bg-slate-900 text-white text-[8px] font-black rounded uppercase tracking-wider">
                            ELIZA ED.
                          </span>
                          <span className="font-sans font-extrabold uppercase text-[11px] text-slate-805">
                            {String(e.description).replace('[ELIZA Education] ', '')}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 font-black uppercase text-teal-600 text-[10.5px]">
                        👤 {e.patientName || 'Avulso / Não atribuído'}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5 font-bold">
                          <Landmark className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-slate-600 uppercase text-[10.5px]">{e.caixa || 'Caixa Geral'}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 border border-slate-200 bg-slate-50 rounded-md text-[9.5px] font-black text-slate-500 uppercase">
                          {e.paymentMethod || 'PIX'}
                        </span>
                      </td>
                      <td className="p-4 font-black text-slate-900 text-[11.5px]">
                        R$ {(e.amount || e.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase inline-flex items-center gap-1 ${
                          isPaid 
                            ? 'bg-emerald-50 text-emerald-800' 
                            : 'bg-amber-100 text-amber-900'
                        }`}>
                          {isPaid ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {isPaid ? 'Pago' : 'Pendente'}
                        </span>
                      </td>
                      <td className="p-4 pr-6 text-right">
                        <button 
                          onClick={() => handleDeleteTransaction(e.id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 border border-transparent rounded hover:border-rose-100 transition-all cursor-pointer"
                          title="Excluir Lançamento"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Receber Pagamento */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-slate-950/75 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden text-left flex flex-col"
            >
              <header className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                  Novo Recebimento - ELIZA Education
                </h3>
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-1 px-2 border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold rounded-lg cursor-pointer text-slate-500"
                >
                  Cancelar
                </button>
              </header>

              <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh] custom-scrollbar">
                {/* Descrição */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Descrição do Lançamento</label>
                  <input 
                    type="text"
                    value={newEntry.description}
                    onChange={(e) => setNewEntry({...newEntry, description: e.target.value})}
                    placeholder="Ex: Matrícula Curso Residência HOF - Turma A"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>

                {/* Paciente search and selection */}
                <div className="space-y-2 bg-slate-100/50 p-4 rounded-2xl border border-slate-200/60">
                  <label className="text-[9px] font-black text-slate-450 uppercase block">Origem do Pagador (Paciente-Modelo / Aluno)</label>
                  
                  <div className="flex gap-2 pb-2">
                    {[
                      { key: 'education', label: 'Pacientes-Modelo Ed.' },
                      { key: 'clinical', label: 'Pacientes Gerais' },
                      { key: 'custom', label: 'Digitar Nome' }
                    ].map(tab => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => {
                          setSelectedPatientSource(tab.key as any);
                          setSelectedPatientRef(null);
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                          selectedPatientSource === tab.key
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {selectedPatientSource !== 'custom' ? (
                    <div className="space-y-2 relative">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input 
                          type="text"
                          placeholder="Comece a digitar para selecionar o paciente..."
                          value={patientSearchQuery}
                          onChange={(e) => setPatientSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                        />
                      </div>

                      {/* Autocomplete suggestions dropdown scroll */}
                      {patientSearchQuery && !selectedPatientRef && (
                        <div className="bg-white border border-slate-200 rounded-xl max-h-40 overflow-y-auto shadow-lg text-[11px] font-bold divide-y divide-slate-100 divide-dashed custom-scrollbar">
                          {selectedPatientSource === 'education' && (
                            <>
                              {filteredEducationPatients.length === 0 ? (
                                <p className="p-3 text-slate-400 uppercase text-[9px] font-black text-center">Nenhum paciente-modelo com este nome</p>
                              ) : (
                                filteredEducationPatients.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedPatientRef(p);
                                      setPatientSearchQuery(p.name);
                                    }}
                                    className="w-full text-left p-2.5 px-4 hover:bg-slate-50 text-slate-700 flex justify-between items-center uppercase"
                                  >
                                    <span>{p.name} ({p.desiredProcedure || 'Desejado'})</span>
                                    <span className="text-[8px] bg-teal-100 text-teal-800 rounded px-1.5 font-black">PACIENTE ED</span>
                                  </button>
                                ))
                              )}
                            </>
                          )}

                          {selectedPatientSource === 'clinical' && (
                            <>
                              {filteredClinicalPatients.length === 0 ? (
                                <p className="p-3 text-slate-400 uppercase text-[9px] font-black text-center">Nenhum paciente geral com este nome</p>
                              ) : (
                                filteredClinicalPatients.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedPatientRef(p);
                                      setPatientSearchQuery(p.name);
                                    }}
                                    className="w-full text-left p-2.5 px-4 hover:bg-slate-50 text-slate-700 flex justify-between items-center uppercase"
                                  >
                                    <span>{p.name}</span>
                                    <span className="text-[8px] bg-slate-900 text-white rounded px-1.5 font-black">PAT CLÍNICO</span>
                                  </button>
                                ))
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {selectedPatientRef && (
                        <div className="p-2 px-3.5 bg-emerald-50 border border-emerald-100 rounded-xl flex justify-between items-center">
                          <span className="text-emerald-800 uppercase font-black text-[11px] flex items-center gap-1.5">
                            <UserCheck className="w-4 h-4 text-emerald-600" />
                            {selectedPatientRef.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPatientRef(null);
                              setPatientSearchQuery('');
                            }}
                            className="text-slate-400 hover:text-rose-500 text-[10px] font-bold uppercase transition-all"
                          >
                            Alterar
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input 
                      type="text"
                      placeholder="Nome completo do pagador / paciente..."
                      value={newEntry.customPatientName}
                      onChange={(e) => setNewEntry({...newEntry, customPatientName: e.target.value})}
                      className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    />
                  )}
                </div>

                {/* Valor e Status */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Valor do Recebimento (R$)</label>
                    <input 
                      type="number"
                      value={newEntry.amount}
                      onChange={(e) => setNewEntry({...newEntry, amount: e.target.value})}
                      placeholder="Ex: 1500.00"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Status do Lançamento</label>
                    <select 
                      value={newEntry.status}
                      onChange={(e) => setNewEntry({...newEntry, status: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    >
                      <option value="pago">🟢 Recebido / Pago</option>
                      <option value="pendente">🟡 Pendente / Aberto</option>
                    </select>
                  </div>
                </div>

                {/* Meio e Conta */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Meio de Recebimento</label>
                    <select 
                      value={newEntry.paymentMethod}
                      onChange={(e) => setNewEntry({...newEntry, paymentMethod: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    >
                      <option value="PIX">⚡ PIX</option>
                      <option value="Boleto">📄 Boleto Bancário</option>
                      <option value="Cartão de Crédito">💳 Cartão de Crédito</option>
                      <option value="Cartão de Débito">💳 Cartão de Débito</option>
                      <option value="Dinheiro">💵 Dinheiro</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Conta / Caixa do Recebimento</label>
                    <select 
                      value={newEntry.caixa}
                      onChange={(e) => setNewEntry({...newEntry, caixa: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    >
                      <option value="Caixa Geral">🏦 Caixa Geral de Finanças</option>
                      <option value="Caixa Educação">🎓 Caixa Escola / Educação</option>
                      <option value="Banco Itaú">🔵 Banco Itaú</option>
                      <option value="Banco Bradesco">🔴 Banco Bradesco</option>
                      <option value="Banco Inter">🟠 Banco Inter</option>
                    </select>
                  </div>
                </div>

                {/* Professor / Responsável */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Professor ou Responsável pela Venda</label>
                  <select 
                    value={newEntry.responsibleId}
                    onChange={(e) => setNewEntry({...newEntry, responsibleId: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="">-- Selecionar Responsável --</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.role || 'Membro'})</option>
                    ))}
                  </select>
                </div>
              </div>

              <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0 bg-slate-50">
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 bg-white rounded-2xl text-[10.5px] font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveTransaction}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[10.5px] font-black uppercase tracking-widest shadow-lg transition-all"
                >
                  Salvar Recebimento
                </button>
              </footer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
