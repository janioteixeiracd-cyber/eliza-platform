import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  Brain,
  Users,
  Calendar,
  ShieldAlert,
  DollarSign,
  ArrowRight,
  Lock,
  Send,
  RefreshCw,
  Bot,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { normalizeFinancialEntry } from '../../utils/financialHelpers';

interface AppointmentLite { patientName: string; date?: string; status?: string; }

interface ChatMessage {
  sender: 'ai' | 'user';
  text: string;
  highlights?: string[];
  recommendedActions?: string[];
}

function toDate(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v?.toDate === 'function') return v.toDate();
    if (v?.seconds !== undefined) return new Date(v.seconds * 1000);
    const match = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function NextHome() {
  const { clinic, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [patientsCount, setPatientsCount] = useState(0);
  const [appointments, setAppointments] = useState<AppointmentLite[]>([]);
  const [financialOverdue, setFinancialOverdue] = useState({ count: 0, amount: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  const [greeting, setGreeting] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<{ question: string; summary: string }[]>([]);

  useEffect(() => {
    const hour = new Date().getHours();
    let timeGreeting = 'Bom dia';
    if (hour >= 12 && hour < 18) timeGreeting = 'Boa tarde';
    else if (hour >= 18 || hour < 5) timeGreeting = 'Boa noite';
    const firstName = profile?.name ? profile.name.split(' ')[0] : 'Doutor(a)';
    setGreeting(`${timeGreeting}, ${firstName}.`);
  }, [profile?.name]);

  useEffect(() => {
    async function loadTelemetry() {
      if (!clinic?.id) return;
      setLoadingStats(true);
      try {
        const [patientsSnap, appointmentsSnap, financialSnap] = await Promise.all([
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'patients'), limit(150)), 'patients', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'appointments'), limit(200)), 'appointments', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'financial_entries'), limit(300)), 'financial_entries', { addAuditLog }),
        ]);

        setPatientsCount(patientsSnap.size);
        setAppointments(appointmentsSnap.docs.map(d => {
          const data: any = d.data();
          return { patientName: data.patientName || '', date: data.date, status: data.status };
        }));

        const now = new Date();
        let overdueCount = 0, overdueAmount = 0;
        financialSnap.forEach(d => {
          const n = normalizeFinancialEntry({ id: d.id, ...d.data() });
          if (!n || n.type !== 'income' || (n.status !== 'pending' && n.status !== 'partial')) return;
          const dueD = toDate(n.dueDate);
          if (dueD && dueD < now && dueD.toDateString() !== now.toDateString()) {
            overdueCount++;
            overdueAmount += n.pendingAmount;
          }
        });
        setFinancialOverdue({ count: overdueCount, amount: overdueAmount });

        addAuditLog({
          collection: 'intelligence',
          action: 'QUERY',
          status: 'SUCCESS',
          details: 'Consciência da Eliza mapeou os dados reais do consultório.'
        });
      } catch (e) {
        console.warn('Failed to load home telemetry:', e);
      } finally {
        setLoadingStats(false);
      }
    }
    loadTelemetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  const insights = useMemo(() => {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const lastApptByPatient = new Map<string, Date>();
    const upcomingByPatient = new Set<string>();
    let cancellations = 0;
    let pendingConfirmations = 0;

    appointments.forEach(a => {
      const d = toDate(a.date);
      if (a.status === 'cancelado') cancellations++;
      if (!d) return;
      if (d <= now) {
        const prev = lastApptByPatient.get(a.patientName);
        if (!prev || d > prev) lastApptByPatient.set(a.patientName, d);
      } else {
        upcomingByPatient.add(a.patientName);
        if (a.status === 'pendente' && d <= in7d) pendingConfirmations++;
      }
    });

    let recallCount = 0;
    const recallNames: string[] = [];
    lastApptByPatient.forEach((d, name) => {
      if (upcomingByPatient.has(name)) return;
      const days = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 90) { recallCount++; recallNames.push(name); }
    });

    return { recallCount, recallNames, cancellations, pendingConfirmations };
  }, [appointments]);

  async function sendToEliza(text: string) {
    if (!text.trim() || isTyping) return;
    setChatMessages(prev => [...prev, { sender: 'user', text }]);
    setChatInput('');
    setIsTyping(true);
    setError(null);

    try {
      const contextBlock = `Dados reais desta clínica:
- Pacientes cadastrados: ${patientsCount}
- Pacientes sem retorno agendado há mais de 90 dias: ${insights.recallCount}${insights.recallNames.length > 0 ? ' (' + insights.recallNames.slice(0, 5).join(', ') + ')' : ''}
- Cancelamentos registrados: ${insights.cancellations}
- Confirmações pendentes nos próximos 7 dias: ${insights.pendingConfirmations}
- Contas a receber vencidas: ${financialOverdue.count} lançamento(s), totalizando ${formatCurrency(financialOverdue.amount)}`;

      const memoryBlock = conversation.length > 0
        ? `\nHistórico recente da conversa:\n${conversation.map((m, i) => `${i + 1}. Perguntou: "${m.question}" — Você respondeu: "${m.summary}"`).join('\n')}\n`
        : '';

      const prompt = `Você é a Eliza, consciência cognitiva de uma clínica odontológica, dando um resumo do dia ao profissional na tela inicial. Use SOMENTE os dados reais abaixo — nunca invente números.

${contextBlock}
${memoryBlock}
Pergunta atual: "${text}"

Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{"summary":"resposta direta em 2-4 frases citando os dados reais relevantes","highlights":["observação concreta 1"],"recommendedActions":["ação prática recomendada 1"]}`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'home_consciousness_chat',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente novamente.');
      const parsed = JSON.parse(jsonMatch[0]);

      const summary = String(parsed.summary || '');
      const highlights = Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [];
      const recommendedActions = Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.map(String) : [];

      setChatMessages(prev => [...prev, { sender: 'ai', text: summary, highlights, recommendedActions }]);
      setConversation(prev => [...prev.slice(-5), { question: text, summary }]);

      addAuditLog({
        collection: 'eliza_home_chat',
        action: 'QUERY',
        status: 'SUCCESS',
        details: `Eliza (IA real) respondeu à consulta na Home: "${text}" (conversa não é persistida no Firestore).`
      });
    } catch (err: any) {
      setError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setIsTyping(false);
    }
  }

  const cards = [
    {
      key: 'recall',
      icon: Users,
      color: 'purple',
      label: 'ENGAGEMENT',
      title: 'Ativação de Pacientes',
      description: `${insights.recallCount} paciente(s) sem retorno agendado há mais de 90 dias.`,
      footer: insights.recallCount > 0 ? `${insights.recallCount} PARA REATIVAR` : 'EM DIA',
      prompt: 'Quais pacientes precisam de reativação e o que eu faço primeiro?',
    },
    {
      key: 'agenda',
      icon: Calendar,
      color: 'blue',
      label: 'SCHEDULING',
      title: 'Confirmações Pendentes',
      description: `${insights.pendingConfirmations} agendamento(s) pendente(s) de confirmação nos próximos 7 dias.`,
      footer: `${insights.cancellations} CANCELAMENTO(S)`,
      prompt: 'O que tenho pendente de confirmação na agenda?',
    },
    {
      key: 'cancelamentos',
      icon: ShieldAlert,
      color: 'orange',
      label: 'AGENDA',
      title: 'Cancelamentos Registrados',
      description: `${insights.cancellations} cancelamento(s) entre os agendamentos lidos.`,
      footer: insights.cancellations > 0 ? 'REVISAR' : 'SEM CANCELAMENTOS',
      prompt: 'Tivemos muitos cancelamentos? O que pode estar acontecendo?',
    },
    {
      key: 'financeiro',
      icon: DollarSign,
      color: 'purple',
      label: 'CONVERSION',
      title: 'Contas Vencidas',
      description: `${financialOverdue.count} lançamento(s) vencido(s), totalizando ${formatCurrency(financialOverdue.amount)}.`,
      footer: financialOverdue.count > 0 ? `${formatCurrency(financialOverdue.amount)} EM ATRASO` : 'EM DIA',
      prompt: 'Quais contas estão vencidas e como devo priorizar a cobrança?',
    },
  ];

  return (
    <div className="space-y-10 max-w-5xl font-sans pb-16">

      {/* 1. WELCOME */}
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-next-ia-blue/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6 z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
              <Bot className="w-3.5 h-3.5 text-next-purple-neon animate-pulse" />
              <span>ELIZA CONSCIÊNCIA COGNITIVA</span>
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-100 tracking-tight font-sans">
              {greeting}
            </h1>

            <p className="text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
              Li os dados reais da sua clínica agora. Abaixo estão as oportunidades calculadas a partir de pacientes,
              agenda e financeiro — sem números inventados.
            </p>
          </div>

          <div className="bg-slate-900/80 border border-next-border rounded-next-xl p-4 flex-shrink-0 flex flex-col space-y-1.5 md:min-w-[180px]">
            <span className="text-[10px] font-mono text-slate-500">VARREDURA REAL</span>
            <div className="flex items-center gap-2 text-next-green-success font-semibold text-xs">
              <span className="w-2 h-2 rounded-full bg-next-green-success animate-pulse" />
              <span>Dados Clínicos Lidos</span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono whitespace-pre-line">
              {loadingStats ? 'Mapeando...' : `• ${patientsCount} pacientes\n• ${appointments.length} agendamentos lidos`}
            </p>
          </div>
        </div>
      </div>

      {/* 2. OPPORTUNITY DECK */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-md font-bold text-slate-200 flex items-center gap-2">
              <Brain className="w-4 h-4 text-next-purple-neon" />
              <span>Opportunity Deck (Mapeamento Real)</span>
            </h2>
            <p className="text-[11px] text-slate-500">Calculado a partir dos dados reais desta clínica.</p>
          </div>
          <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-next-border">4 INSIGHTS</span>
        </div>

        {loadingStats ? (
          <div className="text-center py-10 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Calculando insights reais...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map(card => {
              const Icon = card.icon;
              const colorClasses = card.color === 'purple'
                ? { bg: 'bg-next-purple-neon/10', text: 'text-next-purple-neon', footer: 'text-next-purple-light' }
                : card.color === 'blue'
                ? { bg: 'bg-next-ia-blue/10', text: 'text-next-ia-blue', footer: 'text-next-ia-blue' }
                : { bg: 'bg-next-orange-insight/10', text: 'text-next-orange-insight', footer: 'text-next-orange-insight' };
              return (
                <motion.button
                  key={card.key}
                  whileHover={{ y: -3 }}
                  onClick={() => sendToEliza(card.prompt)}
                  className="text-left cursor-pointer rounded-next-xl border p-5 flex flex-col justify-between h-[180px] transition-all duration-300 relative overflow-hidden bg-next-bg-card/90 border-next-border hover:border-next-border-glow"
                >
                  <div className="flex justify-between items-start">
                    <span className={`p-2 rounded-lg ${colorClasses.bg} ${colorClasses.text}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-[9px] font-mono text-slate-500">{card.label}</span>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xs font-bold text-slate-200">{card.title}</h3>
                    <p className="text-[11px] text-slate-400 leading-snug">{card.description}</p>
                  </div>
                  <div className={`flex justify-between items-center text-[10px] font-mono font-bold ${colorClasses.footer}`}>
                    <span>{card.footer}</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. CHAT */}
      <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 flex flex-col justify-between h-[460px] shadow-next-glass relative">
        <div className="flex items-center justify-between border-b border-next-border pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-next-purple-neon animate-pulse" />
            <span className="text-xs font-bold text-slate-200">Eliza Cognitive Interactor</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase flex items-center gap-1"><Lock className="w-3 h-3 text-amber-500" /> Somente leitura, IA real</span>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 scrollbar-thin">
          {chatMessages.length === 0 && !isTyping && (
            <p className="text-xs text-slate-500">Clique num card acima ou pergunte algo abaixo — a Eliza responde com base nos dados reais lidos agora.</p>
          )}
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 max-w-[85%] ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
              {msg.sender === 'ai' && (
                <div className="w-7 h-7 rounded-full bg-next-purple-neon/10 border border-next-purple-neon/20 flex items-center justify-center flex-shrink-0 text-next-purple-light text-xs font-bold">E</div>
              )}
              <div className={`p-3.5 rounded-next-xl text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-next-purple-neon text-white rounded-tr-none shadow-next-glow-purple'
                  : 'bg-slate-900/80 text-slate-300 rounded-tl-none border border-next-border'
              }`}>
                <p>{msg.text}</p>
                {((msg.highlights && msg.highlights.length > 0) || (msg.recommendedActions && msg.recommendedActions.length > 0)) && (
                  <div className="mt-2.5 pt-2.5 border-t border-next-border/60 space-y-1.5">
                    {msg.highlights?.map((h, i) => (
                      <p key={`h-${i}`} className="text-[10.5px] text-next-orange-insight flex items-start gap-1"><AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />{h}</p>
                    ))}
                    {msg.recommendedActions?.map((a, i) => (
                      <p key={`a-${i}`} className="text-[10.5px] text-next-green-success flex items-start gap-1"><CheckCircle2 className="w-3 h-3 flex-shrink-0 mt-0.5" />{a}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-7 h-7 rounded-full bg-next-purple-neon/10 border border-next-purple-neon/20 flex items-center justify-center text-next-purple-light text-xs font-bold animate-pulse">E</div>
              <div className="bg-slate-900/80 text-slate-500 rounded-next-xl rounded-tl-none border border-next-border p-3 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-next-purple-neon rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-next-purple-neon rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-next-purple-neon rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
        </div>

        <div className="space-y-3 border-t border-next-border pt-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => sendToEliza('Como está meu faturamento?')} className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-next-border hover:border-next-border-glow rounded-md text-[10px] text-slate-400 hover:text-slate-200 transition-all font-medium cursor-pointer">
              📊 Como está meu faturamento?
            </button>
            <button onClick={() => sendToEliza('Quais são os pacientes sumidos?')} className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-next-border hover:border-next-border-glow rounded-md text-[10px] text-slate-400 hover:text-slate-200 transition-all font-medium cursor-pointer">
              👥 Quais são os pacientes sumidos?
            </button>
            <button onClick={() => sendToEliza('O que priorizar hoje?')} className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-next-border hover:border-next-border-glow rounded-md text-[10px] text-slate-400 hover:text-slate-200 transition-all font-medium cursor-pointer">
              ⚡ O que priorizar hoje?
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); sendToEliza(chatInput); }} className="relative flex items-center">
            <input
              type="text"
              placeholder="Pergunte algo para a Eliza..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="w-full bg-slate-950/70 border border-next-border hover:border-next-border-glow rounded-next-xl pl-4 pr-12 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-next-purple-neon focus:shadow-next-glow-purple transition-all"
              style={{ minHeight: '44px' }}
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || isTyping}
              className="absolute right-2 p-1.5 bg-next-purple-neon hover:bg-next-purple-neon/90 rounded-lg text-white transition-all shadow-next-glow-purple active:scale-[0.98] cursor-pointer disabled:opacity-50"
              style={{ minWidth: '32px', minHeight: '32px' }}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}
