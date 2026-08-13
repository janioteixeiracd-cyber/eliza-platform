import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Smartphone, 
  Plus, 
  Trash2, 
  Edit3, 
  CheckCircle, 
  X, 
  Loader2, 
  AlertTriangle, 
  Sparkles, 
  Send,
  Lock,
  Calendar,
  DollarSign,
  ClipboardList
} from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';

interface ElizaInternaSettingsProps {
  clinic: {
    id: string;
    [key: string]: any;
  };
}

const DEFAULT_COMMANDS = [
  "agenda hoje",
  "minha agenda amanhã",
  "meu faturamento hoje",
  "meu faturamento do mês",
  "horários livres hoje",
  "horários livres essa semana",
  "pacientes de hoje",
  "planejamento da semana",
  "pendências de hoje"
];

export default function ElizaInternaSettings({ clinic }: ElizaInternaSettingsProps) {
  const [accessList, setAccessList] = useState<any[]>([]);
  const [clinicStaff, setClinicStaff] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [testSummaryLoading, setTestSummaryLoading] = useState<string | null>(null);
  const [summaryTestReport, setSummaryTestReport] = useState<any | null>(null);

  // Modal State
  const [isOpen, setIsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    professionalId: '',
    name: '',
    phone: '',
    role: 'Dentista',
    permissions: ['visualizar_agenda'] as string[],
    dailySummaryEnabled: true,
    dailySummaryTime: '08:00',
    allowedCommands: [...DEFAULT_COMMANDS],
    active: true
  });

  // Fetch whatsapp accesses, clinic staff members, and logs of commands
  useEffect(() => {
    if (!clinic?.id) return;

    // 1. Fetch authorized professionals
    const unsubAccess = onSnapshot(
      collection(db, 'clinics', clinic.id, 'staff_whatsapp_access'),
      (snap) => {
        setAccessList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/staff_whatsapp_access`)
    );

    // 2. Fetch existing clinic staff members
    const unsubStaff = onSnapshot(
      collection(db, 'clinics', clinic.id, 'team_members'),
      (snap) => {
        setClinicStaff(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/team_members`)
    );

    // 3. Fetch logs of commands (last 30)
    const unsubLogs = onSnapshot(
      collection(db, 'clinics', clinic.id, 'staff_commands'),
      (snap) => {
        const sortedLogs = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a: any, b: any) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
          });
        setLogs(sortedLogs.slice(0, 30));
      },
      (err) => handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/staff_commands`)
    );

    return () => {
      unsubAccess();
      unsubStaff();
      unsubLogs();
    };
  }, [clinic?.id]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setFormData({
      professionalId: '',
      name: '',
      phone: '',
      role: 'Dentista',
      permissions: ['visualizar_agenda'],
      dailySummaryEnabled: true,
      dailySummaryTime: '08:00',
      allowedCommands: [...DEFAULT_COMMANDS],
      active: true
    });
    setIsOpen(true);
  };

  const handleOpenEdit = (item: any) => {
    setEditingItem(item);
    setFormData({
      professionalId: item.professionalId || '',
      name: item.name || '',
      phone: item.phone || '',
      role: item.role || 'Dentista',
      permissions: item.permissions || ['visualizar_agenda'],
      dailySummaryEnabled: item.dailySummaryEnabled !== false,
      dailySummaryTime: item.dailySummaryTime || '08:00',
      allowedCommands: item.allowedCommands || [...DEFAULT_COMMANDS],
      active: item.active !== false
    });
    setIsOpen(true);
  };

  // Auto-populate when professional is selected from list
  const handleSelectStaff = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pId = e.target.value;
    const matched = clinicStaff.find(s => s.id === pId);
    if (matched) {
      setFormData(prev => ({
        ...prev,
        professionalId: pId,
        name: matched.name || prev.name,
        role: matched.role || prev.role,
        phone: matched.phone || prev.phone
      }));
    } else {
      setFormData(prev => ({ ...prev, professionalId: pId }));
    }
  };

  const handleTogglePermission = (perm: string) => {
    setFormData(prev => {
      const exists = prev.permissions.includes(perm);
      return {
        ...prev,
        permissions: exists 
          ? prev.permissions.filter(p => p !== perm) 
          : [...prev.permissions, perm]
      };
    });
  };

  const handleToggleCommand = (cmd: string) => {
    setFormData(prev => {
      const exists = prev.allowedCommands.includes(cmd);
      return {
        ...prev,
        allowedCommands: exists 
          ? prev.allowedCommands.filter(c => c !== cmd) 
          : [...prev.allowedCommands, cmd]
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    if (!formData.name || !formData.phone) {
      alert("Por favor, preencha o Nome e o Telefone WhatsApp.");
      return;
    }

    setSaveLoading(true);
    try {
      const cleanPhone = formData.phone.replace(/\D/g, "");
      const payload = {
        name: formData.name,
        phone: formData.phone,
        phoneNormalized: cleanPhone,
        professionalId: formData.professionalId || 'not-assigned',
        role: formData.role,
        permissions: formData.permissions,
        dailySummaryEnabled: formData.dailySummaryEnabled,
        dailySummaryTime: formData.dailySummaryTime,
        allowedCommands: formData.allowedCommands,
        active: formData.active,
        authorized: true,
        updatedAt: serverTimestamp(),
        createdAt: editingItem ? (editingItem.createdAt || serverTimestamp()) : serverTimestamp()
      };

      // Firestore doc ID is either existing or staff member ID or fallback
      const staffId = editingItem ? editingItem.id : (formData.professionalId || 'wa_' + cleanPhone);
      
      const docRef = doc(db, 'clinics', clinic.id, 'staff_whatsapp_access', staffId);
      await setDoc(docRef, payload, { merge: true });

      setIsOpen(false);
    } catch (err: any) {
      console.error("[ELIZA_INTERNA_SETTINGS] Error saving staff access:", err);
      alert("Erro ao salvar acesso do colaborador: " + err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDelete = async (staffId: string) => {
    if (!clinic?.id) return;
    if (!confirm("Deseja realmente remover a permissão de acesso deste colaborador?")) return;

    try {
      await deleteDoc(doc(db, 'clinics', clinic.id, 'staff_whatsapp_access', staffId));
    } catch (err: any) {
      console.error("[ELIZA_INTERNA_SETTINGS] Error deleting access:", err);
      alert("Erro ao deletar: " + err.message);
    }
  };

  const handleSendSummaryNow = async (item: any, sendToAll: boolean = false) => {
    if (!clinic?.id) return;
    const loadingKey = sendToAll ? 'all' : item.id;
    setTestSummaryLoading(loadingKey);
    setSummaryTestReport(null);
    try {
      const response = await fetch('/api/whatsapp/send-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: clinic.id,
          staffId: sendToAll ? null : item.id,
          sendToAll
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro desconhecido ao enviar resumo');
      }
      
      setSummaryTestReport({
        type: sendToAll ? "Coletivo (Todos Autorizados)" : `Individual - ${item?.name || 'Colaborador'}`,
        results: data.results || {},
        timestamp: new Date()
      });
    } catch (err: any) {
      console.error("[ELIZA_INTERNA_SETTINGS] Error sending test summary:", err);
      alert('Erro ao enviar o resumo diário: ' + err.message);
    } finally {
      setTestSummaryLoading(null);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Upper Banner */}
      <section className="bg-slate-900 border border-slate-800 text-white rounded-2xl sm:rounded-[2rem] p-4 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-5 blur-sm">
          <Smartphone className="w-96 h-96" />
        </div>
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-teal-500/20 to-teal-400/10 border border-teal-500/25 px-4 py-1.5 rounded-full text-xs font-semibold text-teal-400">
            <Sparkles className="w-3.5 h-3.5" /> ELIZA WhatsApp Assistente Interno
          </div>
          <h3 className="text-2xl mt-2 font-bold tracking-tight">Comandos Rápidos por WhatsApp para sua Equipe</h3>
          <p className="text-xs text-slate-300 leading-relaxed font-semibold">
            Permita que os profissionais autorizados consultem a agenda, faturamento, horários disponíveis e planejamento diretamente pelo WhatsApp de maneira rápida e segura.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <span className="bg-slate-800 font-mono text-[9px] px-2 py-1 text-slate-300 rounded font-bold uppercase">Somente-Leitura</span>
            <span className="bg-slate-800 font-mono text-[9px] px-2 py-1 text-slate-300 rounded font-bold uppercase">Zero Risco Operacional</span>
            <span className="bg-slate-800 font-mono text-[9px] px-2 py-1 text-slate-300 rounded font-bold uppercase">Acesso Personalizado</span>
          </div>
        </div>
      </section>

      {/* Authorized Staff Directory Wrapper */}
      <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h4 className="text-sm font-bold text-slate-900">Profissionais Autorizados</h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Gerenciamento de acessos e permissões para comandos internos</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleSendSummaryNow(null, true)}
              disabled={testSummaryLoading !== null}
              className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 px-4 py-2.5 rounded-xl text-xs font-bold font-sans transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 select-none cursor-pointer"
            >
              {testSummaryLoading === 'all' ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-700" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Testar para Todos Autorizados
            </button>
            <button 
              onClick={handleOpenAdd}
              className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" /> Cadastrar Colaborador
            </button>
          </div>
        </div>

        {/* Dynamic test outcome report (Task 6) */}
        {summaryTestReport && (
          <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-150 pb-3">
              <div>
                <h5 className="text-xs font-black text-slate-900 uppercase tracking-tight">Resultado do Teste de Resumo</h5>
                <p className="text-[9px] text-indigo-600 font-extrabold uppercase mt-0.5 tracking-wider">Modo: {summaryTestReport.type}</p>
              </div>
              <button
                onClick={() => setSummaryTestReport(null)}
                className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-600 hover:text-slate-800 font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all cursor-pointer"
              >
                Limpar Painel
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {Object.entries(summaryTestReport.results).map(([name, r]: [string, any]) => {
                const isSuccess = r.status === "sucesso";
                return (
                  <div key={name} className={`p-4 rounded-xl border flex flex-col justify-between ${
                    isSuccess 
                      ? "bg-emerald-50/50 border-emerald-100 text-emerald-950" 
                      : "bg-rose-50/50 border-rose-100 text-rose-950"
                  }`}>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-black block truncate mb-1 uppercase tracking-tight">{name}</span>
                        {!isSuccess && r.detail && (
                          <p className="text-[10px] text-rose-700 leading-relaxed font-semibold mt-1">
                            ⚠️ {r.detail}
                          </p>
                        )}
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        isSuccess 
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200/55" 
                          : "bg-rose-100 text-rose-800 border-rose-200/55"
                      }`}>
                        {r.status}
                      </span>
                    </div>
                  </div>
                );
              })}
              {Object.keys(summaryTestReport.results).length === 0 && (
                <div className="col-span-full py-4 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  Nenhum resultado recebido do servidor.
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Carregando permissões...</span>
          </div>
        ) : accessList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3 border-2 border-dashed border-slate-200 rounded-2rem">
            <Smartphone className="w-10 h-10 text-slate-300" />
            <div className="text-center">
              <p className="text-xs font-bold text-slate-800">Nenhum profissional cadastrado para o bot interno</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Adicione o primeiro colaborador para liberar as consultas por WhatsApp</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {accessList.map((item) => {
              const hasFinance = item.permissions?.includes('visualizar_financeiro');
              const hasAgenda = item.permissions?.includes('visualizar_agenda');
              
              return (
                <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-teal-600 font-bold text-xs shrink-0 select-none">
                      {item.name ? item.name.substring(0, 2).toUpperCase() : 'WA'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">{item.name}</span>
                        {item.active ? (
                          <span className="bg-teal-50 text-teal-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest">Ativo</span>
                        ) : (
                          <span className="bg-slate-100 text-slate-500 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest">Inativo</span>
                        )}

                        {/* Visual DDI 55 Check (Part 3) */}
                        {(() => {
                          const normalized = (item.phoneNormalized || item.phone || "").replace(/\D/g, "");
                          const isDdi55 = normalized.startsWith("55");
                          const isValidLength = normalized.length >= 12 && normalized.length <= 13;
                          if (isDdi55 && isValidLength) {
                            return (
                              <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 text-[7px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">
                                ✓ DDI 55 Válido
                              </span>
                            );
                          } else {
                            return (
                              <span 
                                className="bg-amber-50 text-amber-800 border border-amber-100 text-[7px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider cursor-help"
                                title="Atenção: O WhatsApp no Brasil exige começar com 55 seguido do DDD e do número (total 12 ou 13 dígitos). Sem DDI 55, a ELIZA API não poderá enviar mensagens."
                              >
                                ⚠️ Ajustar DDI 55
                              </span>
                            );
                          }
                        })()}

                        {/* Tested/Authorized Status (Part 3) */}
                        <span className="bg-teal-50 border border-teal-100 text-teal-800 text-[7px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">
                          Autorizado
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-slate-500 font-semibold">
                        <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" /> {item.phone}</span>
                        <span className="text-slate-300">•</span>
                        <span>Função: {item.role}</span>
                        {item.dailySummaryEnabled && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-indigo-600 flex items-center gap-1 text-[9px] font-extrabold uppercase">Resumo diário às {item.dailySummaryTime}</span>
                          </>
                        )}
                      </div>

                      {/* Scheduler Not Active Status Fallback (Part 4) */}
                      {item.dailySummaryEnabled && (
                        <div className="mt-1 text-[8px] font-extrabold text-amber-600 uppercase tracking-wider bg-amber-50 border border-amber-100/50 px-2.5 py-0.5 rounded-md inline-flex items-center gap-1">
                          ⚠️ agendamento preparado, mas scheduler ainda não ativo
                        </div>
                      )}

                      {/* Display current permissions and count of command list */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {hasAgenda && <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase">Agenda</span>}
                        {hasFinance && <span className="bg-rose-50 text-rose-800 border border-rose-100 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase">Financeiro</span>}
                        <span className="bg-indigo-50 border border-indigo-100/50 text-indigo-700 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase">
                          {item.allowedCommands?.length || 0} Comandos autorizados
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      onClick={() => handleSendSummaryNow(item)}
                      disabled={testSummaryLoading !== null || !item.active}
                      className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100/70 border border-indigo-100 text-indigo-700 disabled:opacity-50 select-none font-bold text-[9px] rounded-lg tracking-wider uppercase transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      {testSummaryLoading === item.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      Testar Resumo
                    </button>
                    <button
                      onClick={() => handleOpenEdit(item)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all"
                      title="Editar"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Deletar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Logs and Command Auditing */}
      <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Auditoria & Logs de Comandos</h4>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Histórico em tempo real de requisições de profissionais via WhatsApp</p>
        </div>

        {logs.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6 font-semibold">Nenhum comando processado recentemente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase text-[9px] font-extrabold tracking-wider">
                  <th className="pb-3 pt-1">Hora</th>
                  <th className="pb-3 pt-1">Remetente / Função</th>
                  <th className="pb-3 pt-1">Comando</th>
                  <th className="pb-3 pt-1">Intent / Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {logs.map((log) => {
                  let formattedTime = "";
                  if (log.createdAt) {
                    const date = log.createdAt.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
                    formattedTime = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                  }

                  const matchedStaff = accessList.find(a => a.phoneNormalized === log.fromPhone || a.phone?.replace(/\D/g, "") === log.fromPhone);

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 font-mono text-[10px] text-slate-500 font-semibold">{formattedTime}</td>
                      <td className="py-2.5">
                        <div className="font-bold text-slate-700">{matchedStaff?.name || "Desconhecido"}</div>
                        <div className="text-[9px] text-slate-400 font-extrabold pb-0.5 uppercase tracking-wide">+{log.fromPhone}</div>
                      </td>
                      <td className="py-2.5 font-medium italic text-slate-600">"{log.rawMessage}"</td>
                      <td className="py-2.5">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-[9px] font-bold text-slate-500 uppercase">{log.intent || "Desconhecido"}</span>
                          <span>
                            {log.status === 'success' && (
                              <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide">Sucesso</span>
                            )}
                            {log.status === 'unauthorized' && (
                              <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide">Não Autorizado</span>
                            )}
                            {log.status === 'error' && (
                              <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide">Erro</span>
                            )}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Adicionar/Editar Profissional */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsOpen(false)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden max-h-[90vh] flex flex-col z-10"
            >
              <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-teal-600" />
                {editingItem ? 'Editar Acesso Médico / WhatsApp' : 'Vincular Novo Colaborador ao bot'}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-6">Controle as consultas WhatsApp por telefone</p>
              
              <form onSubmit={handleSave} className="space-y-5 overflow-y-auto pr-2 custom-scrollbar flex-1 pb-4 text-left">
                
                {/* Select Clinic Team Member (Optional shortcut) */}
                <div className="space-y-1 bg-slate-50 p-4 border border-slate-200/60 rounded-xl">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selecionar da Equipe Cadastrada (Atalho)</label>
                  <select 
                    value={formData.professionalId} 
                    onChange={handleSelectStaff}
                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-600"
                  >
                    <option value="">Selecione para preencher automaticamente...</option>
                    {clinicStaff.map(s => (
                      <option key={s.id} value={s.id}>{s.name} - {s.role || "Membro"}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome Completo</label>
                    <input 
                      type="text" 
                      required
                      value={formData.name} 
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Ex: Dr. Jânio Neves"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 "
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WhatsApp (com DDI + DDD)</label>
                    <input 
                      type="text" 
                      required
                      value={formData.phone} 
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="Ex: 5511999999999"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    />
                    
                    {/* Visual warning validation block (Part 3) */}
                    {formData.phone && (
                      <div className="mt-1.5 p-2 bg-slate-50 border border-slate-150 rounded-lg text-[9px] font-extrabold flex flex-col gap-1">
                        {/^\d+$/.test(formData.phone.replace(/\D/g, '')) ? (
                          <>
                            {formData.phone.replace(/\D/g, '').startsWith('55') ? (
                              <span className="text-emerald-600 flex items-center gap-1">✓ Começa com DDI 55 (Brasil)</span>
                            ) : (
                              <span className="text-amber-600 flex items-center gap-1">⚠️ Atenção: Não começa com 55 (DDI Brasil). A API oficial da Meta exige começar com o DDI (Ex: 55 para Brasil).</span>
                            )}
                            {formData.phone.replace(/\D/g, '').length >= 12 && formData.phone.replace(/\D/g, '').length <= 13 ? (
                              <span className="text-emerald-600 flex items-center gap-1">✓ Tamanho correto ({formData.phone.replace(/\D/g, '').length} dígitos)</span>
                            ) : (
                              <span className="text-amber-600 flex items-center gap-1">⚠️ Tamanho incomum ({formData.phone.replace(/\D/g, '').length} dígitos). Um celular brasileiro costuma ter 12 ou 13 dígitos. (Ex: 55 11 99999-9999)</span>
                            )}
                          </>
                        ) : (
                          <span className="text-rose-500 flex items-center gap-1">⚠️ Por favor, insira apenas números (Ex: 5511999999999).</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Função / Cargo</label>
                    <input 
                      type="text" 
                      value={formData.role} 
                      onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                      placeholder="Dentista, Gerente, Recepcionista..."
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status de Acesso</label>
                    <div className="flex items-center gap-4 py-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input 
                          type="radio" 
                          checked={formData.active === true} 
                          onChange={() => setFormData(prev => ({ ...prev, active: true }))}
                          className="accent-teal-600"
                        />
                        Ativo (Pode consultar)
                      </label>
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input 
                          type="radio" 
                          checked={formData.active === false} 
                          onChange={() => setFormData(prev => ({ ...prev, active: false }))}
                          className="accent-teal-600"
                        />
                        Inativo
                      </label>
                    </div>
                  </div>
                </div>

                {/* Permissions matrix */}
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-teal-600" /> Permissões de Consulta
                  </label>
                  <p className="text-[9px] text-slate-400 font-semibold mb-2">Restrinja o acesso a informações confidenciais:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleTogglePermission('visualizar_agenda')}
                      className={`flex items-center gap-2 p-2.5 border rounded-xl text-left text-xs font-bold transition-all ${
                        formData.permissions.includes('visualizar_agenda') 
                          ? 'bg-teal-50 border-teal-500 text-teal-700' 
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      <Calendar className="w-4 h-4" />
                      <div>
                        <span>Visualizar Agenda</span>
                        <div className="text-[8px] font-medium text-slate-400 uppercase tracking-normal">Acesso a horários e pacientes</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTogglePermission('visualizar_financeiro')}
                      className={`flex items-center gap-2 p-2.5 border rounded-xl text-left text-xs font-bold transition-all ${
                        formData.permissions.includes('visualizar_financeiro') 
                          ? 'bg-teal-50 border-teal-500 text-teal-700' 
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      <DollarSign className="w-4 h-4" />
                      <div>
                        <span>Acesso Financeiro</span>
                        <div className="text-[8px] font-medium text-slate-400 uppercase tracking-normal">Acesso a faturamento diário/mensal</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Daily Summaries trigger */}
                <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Resumo Diário Automático</span>
                      <span className="text-[9px] text-slate-400 font-semibold">Enviar resumo matinal de atendimentos no celular</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={formData.dailySummaryEnabled}
                        onChange={(e) => setFormData(prev => ({ ...prev, dailySummaryEnabled: e.target.checked }))}
                        className="sr-only peer" 
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                    </label>
                  </div>

                  {formData.dailySummaryEnabled && (
                    <div className="flex items-center gap-2 pl-4 border-l-2 border-teal-500 pt-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Horário do Envio</label>
                      <input 
                        type="time" 
                        value={formData.dailySummaryTime} 
                        onChange={(e) => setFormData(prev => ({ ...prev, dailySummaryTime: e.target.value }))}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-teal-600"
                      />
                    </div>
                  )}
                </div>

                {/* Commands Allowed */}
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5 text-teal-600" /> Comandos Permitidos
                  </label>
                  <p className="text-[9px] text-slate-400 font-semibold mb-2">Desmarque e impeça o usuário de usar intents específicas:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DEFAULT_COMMANDS.map((cmd) => {
                      const isChecked = formData.allowedCommands.includes(cmd);
                      return (
                        <button
                          type="button"
                          key={cmd}
                          onClick={() => handleToggleCommand(cmd)}
                          className={`flex items-center gap-2 p-2 border rounded-xl text-left text-[10px] font-bold uppercase transition-all ${
                            isChecked 
                              ? 'bg-teal-50 border-teal-500 text-teal-700 font-extrabold' 
                              : 'bg-white border-slate-200 text-slate-500'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-white ${isChecked ? 'bg-teal-600 border-teal-600 font-black' : 'border-slate-300'}`}>
                            {isChecked ? '✓' : ''}
                          </span>
                          <span>{cmd}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 flex gap-3 border-t border-slate-100 bg-white">
                  <button 
                    type="button"
                    onClick={() => setIsOpen(false)} 
                    className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={saveLoading}
                    className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 flex items-center justify-center gap-2"
                  >
                    {saveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {editingItem ? 'Salvar Alterações' : 'Conceder Acesso'}
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
