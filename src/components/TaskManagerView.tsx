import React, { useState, useEffect } from 'react';
import { 
  ClipboardCheck, 
  Plus, 
  Calendar, 
  User, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Filter, 
  Search,
  X,
  Target,
  Eye,
  ExternalLink,
  Tag,
  Briefcase,
  HelpCircle,
  Activity,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  limit,
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc, 
  deleteDoc 
} from 'firebase/firestore';

interface Task {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string; // low, medium, high, critical
  responsibleUid: string;
  responsibleName?: string;
  dueDate: string;
  status: string; // pending, done
  impact: string; 
  createdAt: any;
  patientId?: string;
  patientName?: string;
  source?: string;
}

// Normalize any task/pending item format found in Firestore
function normalizePriorityItem(item: any): Task {
  const id = item.id || "";
  
  // Title mapping & fallbacks
  let title = item.title || item.titulo || item.name;
  if (!title) {
    if (item.type === "missing_clinical_evolution") {
      title = "Evolução Clínica Pendente";
    } else {
      title = "Pendência sem título";
    }
  }

  // Due Date (prazo) mapping & normalization
  const rawDate = item.dueDate || item.deadline || item.prazo || item.date;
  let dueDate = "";
  if (rawDate) {
    try {
      if (typeof rawDate === 'string') {
        dueDate = rawDate.split('T')[0];
      } else if (rawDate.toDate) {
        dueDate = rawDate.toDate().toISOString().split('T')[0];
      } else {
        dueDate = new Date(rawDate).toISOString().split('T')[0];
      }
    } catch (_) {
      dueDate = String(rawDate);
    }
  }

  // Responsible mapping & fallbacks
  let responsibleName = item.responsibleName || item.responsible || item.responsavel || item.professionalName;
  if (!responsibleName) {
    responsibleName = "Sem responsável";
  }

  // Description mapping & fallbacks
  let description = item.description || item.descricao || item.notes;
  if (!description) {
    if (item.type === "missing_clinical_evolution") {
      const pName = item.patientName || "Paciente";
      const docName = responsibleName !== "Sem responsável" ? responsibleName : "o profissional responsável";
      const dateStr = dueDate ? new Date(dueDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'da consulta';
      description = `Registrar a evolução clínica para o paciente ${pName} referente ao atendimento realizado em ${dateStr} por ${docName}.`;
    } else {
      description = "Sem descrição cadastrada";
    }
  }

  // Impact mapping & fallbacks
  let impact = item.impact || item.impacto;
  if (!impact) {
    impact = "Impacto não definido";
  }

  // Priority mapping
  let priority = item.priority || item.prioridade || "Média";

  // Status mapping
  const rawStatus = String(item.status || "pending").toLowerCase();
  let status = "pending";
  if (["done", "concluido", "concluída", "resolved", "finalizado", "resolvido"].includes(rawStatus)) {
    status = "done";
  }

  // Source / Origem mapping
  let source = item.source || item.origem;
  if (!source) {
    if (item.type === "missing_clinical_evolution" || item.createdBySystem) {
      source = "Monitor Clínico";
    } else {
      source = "Manual";
    }
  }

  const patientId = item.patientId || item.pacienteId || item.patient_id || null;
  const patientName = item.patientName || item.paciente || item.patient_name || null;

  return {
    id,
    title,
    description,
    category: item.category || item.categoria || (item.type === 'missing_clinical_evolution' ? 'Clínico' : 'Gestão'),
    priority,
    responsibleUid: item.responsibleUid || item.professionalId || "",
    responsibleName,
    dueDate,
    status,
    impact,
    createdAt: item.createdAt || null,
    patientId: patientId ? String(patientId) : undefined,
    patientName: patientName ? String(patientName) : undefined,
    source
  };
}

export default function TaskManagerView({ onSelectPatient }: { onSelectPatient?: (patientId: string) => void }) {
  const { clinic, profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedTaskDetails, setSelectedTaskDetails] = useState<Task | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'Gestão',
    priority: 'Média',
    impact: 'Operacional',
    dueDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (!clinic) {
      console.log("[ELIZA] task manager wait state: clinic not yet loaded");
      return;
    }
    console.log("[ELIZA] entering tasks bootstrap");
    const path = `clinics/${clinic.id}/pending_items`;
    console.log(`[ELIZA] loading tasks query for ${path}...`);
    const q = query(
      collection(db, 'clinics', clinic.id, 'pending_items'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const unsub = onSnapshot(q, (snap) => {
      console.log(`[ELIZA] tasks loaded: ${snap.size} docs`);
      setTasks(snap.docs.map(d => normalizePriorityItem({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error(`[ELIZA] ERROR in tasks: ${err.message}`);
      handleFirestoreError(err, OperationType.GET, path);
    });
    return () => {
      console.log("[ELIZA] exiting tasks bootstrap");
      unsub();
    };
  }, [clinic]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !profile) return;
    setLoading(true);
    const path = `clinics/${clinic.id}/pending_items`;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'pending_items'), {
        ...formData,
        responsibleUid: profile.uid,
        responsibleName: profile.name || "Colaborador",
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      setFormData({ title: '', description: '', category: 'Gestão', priority: 'Média', impact: 'Operacional', dueDate: new Date().toISOString().split('T')[0] });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setLoading(false);
    }
  };

  const toggleTaskStatus = async (task: Task) => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/pending_items/${task.id}`;
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'pending_items', task.id), {
        status: newStatus
      });
      // Update local state in case details modal is looking at it
      if (selectedTaskDetails && selectedTaskDetails.id === task.id) {
        setSelectedTaskDetails({ ...selectedTaskDetails, status: newStatus });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const filteredTasks = tasks.filter(t => filterStatus === 'all' ? true : t.status === filterStatus);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6 lg:p-10 custom-scrollbar">
      <div className="max-w-7xl mx-auto animate-fade-in">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                <ClipboardCheck className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Gestão de Prioridades</h1>
            </div>
            <p className="text-sm font-medium text-slate-500">Controle de tarefas, prazos, responsáveis e impacto clínico ou financeiro.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-3"
          >
            <Plus className="w-4 h-4" />
            Nova Pendência
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
           <div className="flex gap-2">
              {['all', 'pending', 'done'].map(status => (
                <button 
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    filterStatus === status ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {status === 'all' ? 'Tudo' : status === 'pending' ? 'Pendentes' : 'Concluídas'}
                </button>
              ))}
           </div>
           <div className="flex items-center gap-2 text-slate-400 text-xs font-bold bg-white px-4 py-2 rounded-xl border border-slate-100">
              <Clock className="w-4 h-4 text-indigo-500" />
              <span className="text-slate-700">{tasks.filter(t => t.status === 'pending').length} itens pendentes</span>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTasks.length === 0 ? (
            <div className="col-span-full py-32 text-center bg-white rounded-[2.5rem] border border-slate-100 shadow-sm">
               <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-300 mx-auto mb-6">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
               </div>
               <h3 className="text-base font-bold text-slate-700 uppercase tracking-widest">Nenhuma pendência {filterStatus === 'done' ? 'concluída' : 'ativa'}</h3>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2 leading-relaxed max-w-xs mx-auto">Sua clínica está com todas as prioridades organizadas.</p>
            </div>
          ) : (
            filteredTasks.map((task) => {
              const belongsToPatient = !!task.patientId && !!task.patientName;
              
              const isFinancial = String(task.impact).toLowerCase().includes('finan');
              const isClinical = String(task.impact).toLowerCase().includes('clín') || String(task.impact).toLowerCase().includes('clin');
              const isCrm = String(task.impact).toLowerCase().includes('crm') || String(task.impact).toLowerCase().includes('vend');
              
              const isCritical = String(task.priority).toLowerCase().includes('crít') || String(task.priority).toLowerCase().includes('crit');
              const isHigh = String(task.priority).toLowerCase().includes('alt');
              const isLow = String(task.priority).toLowerCase().includes('baix');

              return (
                <motion.div 
                  key={task.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`bg-white rounded-[2.5rem] border group transition-all duration-300 flex flex-col justify-between ${
                    task.status === 'done' ? 'border-slate-100 opacity-60 shadow-none' : 'border-slate-200 hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-900/5'
                  }`}
                >
                  <div className="p-8 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-6">
                        <div className={`p-2.5 rounded-xl ${
                          isFinancial ? 'bg-emerald-50 text-emerald-600' :
                          isClinical ? 'bg-indigo-50 text-indigo-600' :
                          isCrm ? 'bg-amber-50 text-amber-600' :
                          'bg-slate-50 text-slate-600'
                        }`}>
                          <Target className="w-4 h-4 animate-pulse" />
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg ${
                          isCritical ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                          isHigh ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                          isLow ? 'bg-slate-50 text-slate-400' :
                          'bg-indigo-50 text-indigo-500 border border-indigo-100'
                        }`}>
                          {task.priority || "Impacto não definido"}
                        </span>
                      </div>
                      
                      <h3 className={`text-base font-bold text-slate-900 mb-2 leading-snug tracking-tight ${task.status === 'done' ? 'line-through text-slate-400' : ''}`}>
                        {task.title}
                      </h3>
                      <p className="text-xs text-slate-500 font-medium leading-relaxed mb-4 line-clamp-3">
                        {task.description}
                      </p>

                      {belongsToPatient && (
                        <div className="mb-4 p-3 bg-teal-50/50 rounded-2xl border border-teal-100/30 flex items-center justify-between">
                          <div className="flex items-center gap-2 max-w-[70%]">
                            <User className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                            <span className="text-[10px] font-bold text-teal-950 truncate">
                              {task.patientName}
                            </span>
                          </div>
                          {onSelectPatient && task.patientId && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectPatient(task.patientId!);
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-teal-200 hover:bg-teal-600 hover:text-white text-teal-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                            >
                              <span>Ver Ficha</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-4 border-t border-slate-100 text-xs text-slate-600">
                       <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Responsável</p>
                          <p className="text-[10px] font-black text-slate-800 truncate">{task.responsibleName}</p>
                       </div>
                       <div className="text-right">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Origem</p>
                          <p className="text-[10px] font-black text-slate-800 truncate">{task.source}</p>
                       </div>
                       <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Impacto</p>
                          <p className="text-[10px] font-black text-slate-800 truncate">{task.impact}</p>
                       </div>
                       <div className="text-right">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Prazo</p>
                          <p className="text-[10px] font-black text-slate-800">
                            {task.dueDate ? new Date(task.dueDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem prazo'}
                          </p>
                       </div>
                    </div>
                  </div>

                  <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button 
                      onClick={() => toggleTaskStatus(task)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all ${
                        task.status === 'done' 
                          ? 'bg-emerald-50 border border-emerald-100 text-emerald-600 hover:bg-emerald-100' 
                          : 'bg-white border border-slate-200 text-slate-400 hover:border-emerald-200 hover:text-emerald-500 hover:bg-emerald-50/30'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        {task.status === 'done' ? 'Concluída' : 'Concluir'}
                      </span>
                    </button>
                    
                    <button 
                      onClick={() => setSelectedTaskDetails(task)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-500 hover:text-indigo-600 rounded-xl transition-all"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Detalhes</span>
                    </button>

                    <button 
                      onClick={async () => {
                        if (!clinic) return;
                        const taskPath = `clinics/${clinic.id}/pending_items/${task.id}`;
                        if (confirm('Deseja excluir esta pendência?')) {
                          try {
                            await deleteDoc(doc(db, 'clinics', clinic.id, 'pending_items', task.id));
                          } catch (err) {
                            handleFirestoreError(err, OperationType.DELETE, taskPath);
                          }
                        }
                      }}
                      className="p-2 text-slate-300 hover:text-rose-500 transition-colors rounded-xl"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal: Ver Detalhes */}
      <AnimatePresence>
        {selectedTaskDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setSelectedTaskDetails(null)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }} 
              className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <div className={`h-2.5 ${selectedTaskDetails.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-600'}`} />
              <div className="p-10">
                <header className="flex justify-between items-start mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded ${
                        selectedTaskDetails.status === 'done' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'
                      }`}>
                        {selectedTaskDetails.status === 'done' ? 'Resolvida' : 'Em Aberto / Pendente'}
                      </span>
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
                      {selectedTaskDetails.title}
                    </h3>
                  </div>
                  <button 
                    onClick={() => setSelectedTaskDetails(null)} 
                    className="p-3 bg-slate-50 text-slate-400 rounded-2xl hover:text-rose-500 transition-all shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 py-6 border-y border-slate-100 mb-8">
                  <div className="md:col-span-2 space-y-6">
                    <div>
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Descrição Detalhada</h4>
                      <p className="text-sm font-medium text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {selectedTaskDetails.description}
                      </p>
                    </div>

                    {selectedTaskDetails.patientId && selectedTaskDetails.patientName && (
                      <div className="p-4 bg-teal-50/50 rounded-2xl border border-teal-100/30 flex items-center justify-between">
                        <div>
                          <p className="text-[8px] font-black text-teal-600 uppercase tracking-widest mb-1">Paciente Vinculado</p>
                          <p className="text-sm font-black text-teal-950">{selectedTaskDetails.patientName}</p>
                        </div>
                        {onSelectPatient && (
                          <button 
                            onClick={() => {
                              setSelectedTaskDetails(null);
                              onSelectPatient(selectedTaskDetails.patientId!);
                            }}
                            className="flex items-center gap-2 px-4 py-2 border border-teal-200 bg-teal-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-700 hover:border-teal-300 transition-all shadow-md shadow-teal-600/10"
                          >
                            <span>Abrir Prontuário</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50/80 rounded-2.5xl p-6 space-y-4 self-start">
                    <div>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Prazo Estimado</span>
                      <span className="text-xs font-bold text-slate-800">
                        {selectedTaskDetails.dueDate ? new Date(selectedTaskDetails.dueDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem Prazo'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Prioridade / Urgência</span>
                      <span className="text-xs font-bold text-slate-800">
                        {selectedTaskDetails.priority}
                      </span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Impacto Clínico/Geral</span>
                      <span className="text-xs font-bold text-slate-800">
                        {selectedTaskDetails.impact}
                      </span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Profissional Responsável</span>
                      <span className="text-xs font-bold text-slate-800">
                        {selectedTaskDetails.responsibleName}
                      </span>
                    </div>
                    <div>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Canal de Origem</span>
                      <span className="text-xs font-bold text-slate-800 text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded">
                        {selectedTaskDetails.source}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 justify-between items-center">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => toggleTaskStatus(selectedTaskDetails)}
                      className={`px-5 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        selectedTaskDetails.status === 'done' 
                          ? 'bg-amber-100 hover:bg-amber-200 text-amber-700' 
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/10'
                      }`}
                    >
                      {selectedTaskDetails.status === 'done' ? 'Reabrir Prioridade' : 'Marcar como Concluída'}
                    </button>
                    <button 
                      onClick={async () => {
                        if (!clinic) return;
                        const taskPath = `clinics/${clinic.id}/pending_items/${selectedTaskDetails.id}`;
                        if (confirm('Deseja excluir esta pendência?')) {
                          try {
                            await deleteDoc(doc(db, 'clinics', clinic.id, 'pending_items', selectedTaskDetails.id));
                            setSelectedTaskDetails(null);
                          } catch (err) {
                            handleFirestoreError(err, OperationType.DELETE, taskPath);
                          }
                        }
                      }}
                      className="px-5 py-3.5 rounded-2xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-500 text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                      Excluir
                    </button>
                  </div>
                  <button 
                    onClick={() => setSelectedTaskDetails(null)} 
                    className="px-6 py-3.5 rounded-2xl border border-slate-200 hover:border-slate-300 text-slate-400 text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Nova Pendência */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
             <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-xl bg-white rounded-[3rem] shadow-2xl overflow-hidden">
                <div className="h-2 bg-indigo-600" />
                <div className="p-10">
                   <header className="flex justify-between items-center mb-10">
                      <div>
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight">Nova Prioridade</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de Pendências</p>
                      </div>
                      <button onClick={() => setIsModalOpen(false)} className="p-3 bg-slate-50 text-slate-400 rounded-2xl hover:text-rose-500 transition-all">
                        <X className="w-5 h-5" />
                      </button>
                   </header>

                   <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Título da Tarefa</label>
                        <input 
                          required
                          value={formData.title}
                          onChange={(e) => setFormData({...formData, title: e.target.value})}
                          className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-indigo-500 text-slate-800"
                          placeholder="O que precisa ser feito?"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Prioridade</label>
                           <select 
                            value={formData.priority}
                            onChange={(e) => setFormData({...formData, priority: e.target.value})}
                            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none text-slate-800"
                           >
                              <option>Baixa</option>
                              <option>Média</option>
                              <option>Alta</option>
                              <option>Crítica</option>
                           </select>
                        </div>
                        <div className="space-y-2">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Impacto</label>
                           <select 
                            value={formData.impact}
                            onChange={(e) => setFormData({...formData, impact: e.target.value})}
                            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none text-slate-800"
                           >
                              <option>Operacional</option>
                              <option>Financeiro</option>
                              <option>Clínico</option>
                              <option>CRM / Vendas</option>
                           </select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Data Limite (Prazo)</label>
                        <input 
                          type="date"
                          value={formData.dueDate}
                          onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
                          className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold outline-none text-slate-800"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Detalhes (Opcional)</label>
                        <textarea 
                          value={formData.description}
                          onChange={(e) => setFormData({...formData, description: e.target.value})}
                          className="w-full h-32 px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-indigo-500 resize-none text-slate-800"
                          placeholder="Instruções adicionais de como realizar esta tarefa..."
                        />
                      </div>

                      <div className="pt-6 flex gap-4">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-4 border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Cancelar</button>
                        <button 
                          type="submit"
                          disabled={loading}
                          className="flex-1 bg-slate-900 text-white py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10 hover:bg-indigo-600 transition-all flex items-center justify-center gap-3"
                        >
                          {loading ? 'Sincronizando...' : 'Lançar Prioridade'}
                        </button>
                      </div>
                   </form>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
