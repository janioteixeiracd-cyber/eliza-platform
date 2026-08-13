import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  AlertCircle, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  BrainCircuit,
  MessageSquare,
  Sparkles,
  ArrowRight,
  TrendingDown,
  X,
  Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc 
} from 'firebase/firestore';
import { getGenAI } from '../lib/gemini';
import { AI_CONFIG } from '../config/ai';

interface Issue {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  reportedBy: string;
  createdAt: any;
  aiDiagnosis?: string;
  aiActionPlan?: string;
}

export default function ClinicRadarView() {
  const { clinic, profile } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'Financeiro',
    priority: 'Média'
  });

  useEffect(() => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/clinic_issues`;
    const q = query(
      collection(db, 'clinics', clinic.id, 'clinic_issues'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() } as Issue)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, path);
    });
    return () => unsub();
  }, [clinic]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !profile) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'clinic_issues'), {
        ...formData,
        status: 'Aberto',
        reportedBy: profile.name,
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      setFormData({ title: '', description: '', category: 'Financeiro', priority: 'Média' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/clinic_issues`);
    } finally {
      setLoading(false);
    }
  };

  const analyzeIssue = async (issue: Issue) => {
    if (!clinic) return;
    setAnalyzingId(issue.id);
    try {
      const ai = getGenAI();
      const prompt = `
        Aja como ELIZA, a assistente gerencial inteligente desta clínica odontológica.
        Recebi o seguinte relato de um problema operacional:
        
        Título: ${issue.title}
        Descrição: ${issue.description}
        Categoria: ${issue.category}
        Prioridade: ${issue.priority}
        
        Sua tarefa:
        1. Gere um diagnóstico resumido (máximo 3 frases) em um tom profissional, porém empático e prático.
        2. Crie um plano de ação curto com 3 passos práticos para mitigar ou resolver este problema.
        
        Responda em formato JSON:
        {
          "diagnosis": "...",
          "plan": "1. ... \n2. ... \n3. ..."
        }
      `;

      const result = await ai.models.generateContent({
        model: AI_CONFIG.model,
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });
      const responseText = result.text;
      const cleaned = responseText.replace(/```json|```/g, '').trim();
      const analysis = JSON.parse(cleaned);

      await updateDoc(doc(db, 'clinics', clinic.id, 'clinic_issues', issue.id), {
        aiDiagnosis: analysis.diagnosis,
        aiActionPlan: analysis.plan,
        status: 'Analisado'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clinics/${clinic.id}/clinic_issues/${issue.id}`);
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6 lg:p-10 custom-scrollbar">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-teal-400 shadow-lg">
                <Activity className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Radar da Clínica</h1>
            </div>
            <p className="text-sm font-medium text-slate-500">Mapeie problemas e receba diagnósticos operacionais da ELIZA.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-teal-600 hover:bg-teal-700 text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-teal-600/20 transition-all flex items-center justify-center gap-3"
          >
            <Plus className="w-4 h-4" />
            Reportar Problema
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Dashboard Summary */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                 <Filter className="w-3 h-3" /> Status Geral
               </h3>
               <div className="space-y-4">
                 {[
                   { label: 'Em Aberto', count: issues.filter(i => i.status === 'Aberto').length, color: 'text-amber-600', bg: 'bg-amber-50' },
                   { label: 'Analisados', count: issues.filter(i => i.status === 'Analisado').length, color: 'text-teal-600', bg: 'bg-teal-50' },
                   { label: 'Resolvidos', count: issues.filter(i => i.status === 'Resolvido').length, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                 ].map(stat => (
                   <div key={stat.label} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                     <span className="text-xs font-bold text-slate-600">{stat.label}</span>
                     <span className={`px-3 py-1 ${stat.bg} ${stat.color} rounded-lg text-[10px] font-black`}>{stat.count}</span>
                   </div>
                 ))}
               </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-[3rem] text-white shadow-xl relative overflow-hidden group">
               <div className="absolute -top-10 -right-10 w-32 h-32 bg-teal-400/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-1000" />
               <Sparkles className="w-6 h-6 text-teal-400 mb-6" />
               <h4 className="text-sm font-bold mb-2">Dica da ELIZA</h4>
               <p className="text-[11px] font-medium text-slate-400 leading-relaxed mb-6">
                 Reporte problemas recorrentes para que eu possa identificar padrões de gargalos em sua clínica.
               </p>
               <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                 <p className="text-[9px] font-black text-teal-400 uppercase tracking-widest mb-1">Última Análise</p>
                 <p className="text-[10px] font-medium text-slate-300">"Possível falha no fluxo de recepção identificada nas últimas 48h."</p>
               </div>
            </div>
          </div>

          {/* Issues List */}
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-4 bg-white p-4 rounded-[2rem] border border-slate-200 shadow-sm mb-6">
              <Search className="w-5 h-5 text-slate-400 ml-2" />
              <input 
                placeholder="Buscar problemas reportados..." 
                className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
              />
            </div>

            <div className="space-y-6">
              {issues.length === 0 ? (
                <div className="bg-white rounded-[3rem] border-2 border-dashed border-slate-200 p-20 text-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-300 mx-auto mb-6">
                    <MessageSquare className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-slate-600 mb-2">Tudo parece estar em ordem.</h3>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">Nenhum problema operacional foi reportado até o momento. Use o radar para documentar desafios.</p>
                </div>
              ) : (
                issues.map((issue) => (
                  <motion.div 
                    key={issue.id}
                    layoutId={issue.id}
                    className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden hover:border-teal-200 transition-all group"
                  >
                    <div className="p-8">
                       <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                         <div className="flex items-center gap-3">
                            <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest ${
                              issue.priority === 'Crítica' ? 'bg-rose-50 text-rose-600' :
                              issue.priority === 'Alta' ? 'bg-orange-50 text-orange-600' :
                              'bg-indigo-50 text-indigo-600'
                            }`}>
                              Prioridade {issue.priority}
                            </span>
                            <span className="px-4 py-1.5 bg-slate-100 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-500">
                              {issue.category}
                            </span>
                         </div>
                         <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                            <Clock className="w-3 h-3" />
                            {issue.createdAt ? new Date(issue.createdAt.toDate()).toLocaleDateString('pt-BR') : 'Recent'}
                         </div>
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                          <div>
                             <h4 className="text-lg font-bold text-slate-900 mb-3">{issue.title}</h4>
                             <p className="text-sm text-slate-600 leading-relaxed font-medium mb-6">{issue.description}</p>
                             <div className="flex items-center gap-3">
                               <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-400">
                                 {issue.reportedBy?.[0]}
                               </div>
                               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reportado por {issue.reportedBy}</p>
                             </div>
                          </div>

                          <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100 relative">
                             {issue.aiDiagnosis ? (
                               <div className="space-y-6">
                                  <div className="flex items-center gap-2 mb-2">
                                     <Sparkles className="w-4 h-4 text-teal-600" />
                                     <h5 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Diagnóstico da ELIZA</h5>
                                  </div>
                                  <p className="text-xs font-semibold text-slate-700 leading-relaxed">{issue.aiDiagnosis}</p>
                                  <div className="pt-4 border-t border-slate-200">
                                     <h5 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3">Plano de Ação Sugerido</h5>
                                     <div className="text-[11px] font-medium text-slate-600 whitespace-pre-line leading-relaxed">
                                        {issue.aiActionPlan}
                                     </div>
                                  </div>
                               </div>
                             ) : (
                               <div className="h-full flex flex-col items-center justify-center py-4">
                                  <BrainCircuit className={`w-10 h-10 text-slate-200 mb-4 ${analyzingId === issue.id ? 'animate-pulse' : ''}`} />
                                  <button 
                                    onClick={() => analyzeIssue(issue)}
                                    disabled={analyzingId === issue.id}
                                    className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-600 transition-all flex items-center gap-2 shadow-lg"
                                  >
                                    {analyzingId === issue.id ? (
                                      <>Analisando...</>
                                    ) : (
                                      <>Solicitar Análise IA</>
                                    )}
                                  </button>
                               </div>
                             )}
                          </div>
                       </div>
                    </div>
                    <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                       <div className="flex gap-4">
                         <button className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-teal-600 transition-colors">Adicionar Comentário</button>
                         {issue.status !== 'Resolvido' && (
                           <button 
                            onClick={async () => {
                              if (!clinic) return;
                              const path = `clinics/${clinic.id}/clinic_issues/${issue.id}`;
                              try {
                                await updateDoc(doc(db, 'clinics', clinic.id, 'clinic_issues', issue.id), {
                                  status: 'Resolvido'
                                });
                              } catch (err) {
                                handleFirestoreError(err, OperationType.UPDATE, path);
                              }
                            }}
                            className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline"
                           >
                            Marcar como Resolvido
                           </button>
                         )}
                       </div>
                       <span className="text-[10px] font-bold text-slate-400">ID #{issue.id.slice(-4)}</span>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Novo Problema */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsModalOpen(false)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }} 
              className="relative w-full max-w-xl bg-white rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <div className="h-2 bg-teal-600" />
              <div className="p-10">
                <div className="flex justify-between items-center mb-10">
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">Reportar Desafio</h3>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Radar Operacional</p>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="p-3 bg-slate-50 text-slate-400 rounded-2xl hover:text-rose-500 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Título do Problema</label>
                    <input 
                      required
                      value={formData.title}
                      onChange={(e) => setFormData({...formData, title: e.target.value})}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-teal-500 transition-all" 
                      placeholder="Ex: Falta de encaixe no período da tarde"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Categoria</label>
                      <select 
                        value={formData.category}
                        onChange={(e) => setFormData({...formData, category: e.target.value})}
                        className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none"
                      >
                        <option>Financeiro</option>
                        <option>Agenda</option>
                        <option>Operacional</option>
                        <option>Time</option>
                        <option>Marketing</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Prioridade</label>
                      <select 
                        value={formData.priority}
                        onChange={(e) => setFormData({...formData, priority: e.target.value})}
                        className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest outline-none"
                      >
                        <option>Baixa</option>
                        <option>Média</option>
                        <option>Alta</option>
                        <option>Crítica</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Descrição</label>
                    <textarea 
                      required
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      className="w-full h-32 px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-teal-500 transition-all resize-none" 
                      placeholder="Descreva o que está acontecendo em detalhes..."
                    />
                  </div>

                  <div className="pt-6 flex gap-4">
                    <button 
                      type="button" 
                      onClick={() => setIsModalOpen(false)}
                      className="flex-1 py-4 border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 hover:bg-slate-50 transition-all"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10 hover:bg-teal-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {loading ? 'Processando...' : (
                        <>
                          <Send className="w-4 h-4" />
                          Lançar no Radar
                        </>
                      )}
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
