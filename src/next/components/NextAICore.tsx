import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Sparkles,
  Send,
  Clock,
  Lock,
  ShieldCheck,
  Brain,
  CornerDownRight,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { normalizeFinancialEntry } from '../../utils/financialHelpers';
import { useElizaAsk } from '../hooks/useElizaAsk';
import InsightCard from './eliza/InsightCard';
import type { AssistantAnswer } from '../types/eliza';

interface ChatMessage {
  id: string;
  sender: 'user' | 'eliza';
  text: string;
  time: string;
  answer?: AssistantAnswer;
}

interface ClinicContext {
  patientCount: number;
  todayAppointments: { time: string; patientName: string; treatment: string; status: string }[];
  upcomingCount: number;
  receivedToday: number;
  receivedMonth: number;
  receivable: number;
  overdueCount: number;
  overdueAmount: number;
}

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toDate(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v?.toDate === 'function') return v.toDate();
    if (v?.seconds !== undefined) return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

export default function NextAICore() {
  const { clinic } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const { ask } = useElizaAsk();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'eliza',
      text: 'Olá! Sou a Eliza. Já li os dados reais de agenda, pacientes e financeiro desta clínica. Em que posso te apoiar agora?',
      time: 'Agora',
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loadingResponse, setLoadingResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [context, setContext] = useState<ClinicContext | null>(null);
  const [conversation, setConversation] = useState<{ question: string; summary: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadContext() {
      if (!clinic?.id) return;
      setLoadingContext(true);
      try {
        const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
        const patientsSnap = await secureGetDocs(query(patientsRef, limit(8000)), 'patients', { addAuditLog });

        const apptsRef = collection(db, 'clinics', clinic.id, 'appointments');
        const apptsSnap = await secureGetDocs(query(apptsRef, limit(300)), 'appointments', { addAuditLog });
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const todayAppointments: ClinicContext['todayAppointments'] = [];
        let upcomingCount = 0;
        apptsSnap.forEach(d => {
          const data: any = d.data();
          if (data.date === todayStr) {
            todayAppointments.push({ time: data.time || '', patientName: data.patientName || '', treatment: data.treatment || '', status: data.status || '' });
          }
          const apptDate = toDate(data.date);
          if (apptDate && apptDate >= now && apptDate <= in7d) upcomingCount++;
        });
        todayAppointments.sort((a, b) => a.time.localeCompare(b.time));

        const finRef = collection(db, 'clinics', clinic.id, 'financial_entries');
        const finSnap = await secureGetDocs(query(finRef, limit(500)), 'financial_entries', { addAuditLog });
        let receivedToday = 0, receivedMonth = 0, receivable = 0, overdueCount = 0, overdueAmount = 0;
        finSnap.forEach(d => {
          const n = normalizeFinancialEntry({ id: d.id, ...d.data() });
          if (!n || n.type !== 'income' || n.status === 'cancelled') return;
          const dueD = toDate(n.dueDate);
          const paidD = toDate(n.paidAt) || dueD;
          if ((n.status === 'paid' || n.status === 'partial') && paidD) {
            const isToday = paidD.toDateString() === now.toDateString();
            const isThisMonth = paidD.getFullYear() === now.getFullYear() && paidD.getMonth() === now.getMonth();
            if (isToday) receivedToday += n.paidAmount;
            if (isThisMonth) receivedMonth += n.paidAmount;
          }
          if (n.status === 'pending' || n.status === 'partial') {
            receivable += n.pendingAmount;
            if (dueD && dueD < now && dueD.toDateString() !== now.toDateString()) {
              overdueCount++;
              overdueAmount += n.pendingAmount;
            }
          }
        });

        setContext({
          patientCount: patientsSnap.size,
          todayAppointments,
          upcomingCount,
          receivedToday,
          receivedMonth,
          receivable,
          overdueCount,
          overdueAmount,
        });
      } catch (err) {
        console.error('Failed to load AI Core context:', err);
      } finally {
        setLoadingContext(false);
      }
    }
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSendMessage(textToSend?: string) {
    const queryText = (textToSend ?? inputValue).trim();
    if (!queryText || loadingResponse) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: queryText,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputValue('');
    setLoadingResponse(true);
    setError(null);

    try {
      // Mesmo orquestrador real usado pelo assistente flutuante
      // (NextElizaAssistant) — tools reais de agenda/financeiro/orçamento,
      // motor de insights determinístico, personalidade e papel funcional já
      // trabalhados. Este componente nunca deveria ter tido seu próprio
      // caminho de IA em paralelo (ver types/eliza.ts, useElizaAsk.ts —
      // ambos já citavam "Assistente Central" como consumidor pretendido).
      const answer = await ask(queryText, {
        screenType: 'geral',
        conversationHistory: conversation.slice(-3),
      });

      const elizaMsg: ChatMessage = {
        id: `eliza-${Date.now()}`,
        sender: 'eliza',
        text: answer.summary,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        answer,
      };
      setMessages(prev => [...prev, elizaMsg]);
      setConversation(prev => [...prev.slice(-5), { question: queryText, summary: answer.summary }]);

      addAuditLog({
        collection: 'eliza_ai_core',
        action: 'WRITE',
        status: 'SUCCESS',
        details: `Assistente Central (IA real) respondeu à consulta: "${queryText}".`
      });
    } catch (err: any) {
      setError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setLoadingResponse(false);
    }
  }

  const quickPrompts = [
    { label: 'Resumo do Caixa e Metas', text: 'Como está o faturamento financeiro deste mês?' },
    { label: 'Agenda de Hoje', text: 'O que tenho na agenda hoje e para onde devo dar atenção?' },
    { label: 'Contas Vencidas', text: 'Quais lançamentos estão vencidos e o que priorizar na cobrança?' },
    { label: 'Visão Geral da Clínica', text: 'Me dê um panorama geral da clínica agora.' }
  ];

  return (
    <div className="space-y-8 max-w-5xl font-sans pb-24">

      {/* 1. HERO HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-next-ia-blue/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6 z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
              <Bot className="w-3.5 h-3.5 text-next-purple-neon animate-pulse" />
              <span>ELIZA AI CORE — INTELIGÊNCIA REAL</span>
            </div>

            <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight font-sans">
              Assistente de Pensamento Central
            </h1>

            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
              A Eliza lê a agenda, os pacientes e o financeiro reais desta clínica antes de responder, e mantém
              memória da conversa para dar continuidade às suas perguntas.
            </p>
          </div>

          <div className="bg-slate-900/80 border border-next-border rounded-next-xl p-4 flex-shrink-0 flex flex-col space-y-1.5 md:min-w-[195px]">
            <span className="text-[10px] font-mono text-slate-500 font-bold uppercase">Status</span>
            <div className="flex items-center gap-1.5 text-next-green-success font-semibold text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-next-green-success animate-pulse" />
              <span>Leitura real, IA real</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight font-mono">
              Este assistente só lê dados — não grava nada no banco desta clínica.
            </p>
          </div>
        </div>
      </div>

      {/* 2. CORE CONVERSATION BENTO GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* LEFT COMPONENT: INTEGRATED CHAT MODULE - 7 COLS */}
        <div className="lg:col-span-7 bg-next-bg-card border border-next-border rounded-next-2xl p-5 md:p-6 shadow-next-glass flex flex-col h-[560px] justify-between relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-next-purple-neon/5 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center justify-between border-b border-next-border pb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-4.5 h-4.5 text-next-purple-neon" />
              <div>
                <h3 className="text-xs font-bold text-slate-200">Eliza Central Core</h3>
                <span className="text-[9.5px] text-slate-500 font-mono">{loadingContext ? 'CARREGANDO DADOS REAIS...' : 'CONTEXTO REAL CARREGADO'}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto my-4 space-y-4 pr-1 scrollbar-thin">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  msg.sender === 'user' ? 'self-end items-end ml-auto' : 'self-start items-start'
                }`}
              >
                <div className={`p-3 rounded-xl text-xs leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-next-purple-neon/20 border border-next-purple-neon/30 text-slate-200 rounded-tr-none shadow-next-glow-purple'
                    : 'bg-slate-950 border border-next-border text-slate-300 rounded-tl-none'
                }`}>
                  {msg.text}
                  {msg.sender === 'eliza' && msg.answer?.dataSufficiency === 'insufficient' && (
                    <p className="mt-2 text-[10px] text-next-orange-insight flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" /> Dados parciais para esta pergunta.</p>
                  )}
                  {msg.sender === 'eliza' && msg.answer?.caveats && msg.answer.caveats.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-next-border/60 space-y-1">
                      {msg.answer.caveats.map((c, i) => <p key={i} className="text-[10px] text-slate-500">• {c}</p>)}
                    </div>
                  )}
                </div>
                {msg.sender === 'eliza' && msg.answer?.insights && msg.answer.insights.length > 0 && (
                  <div className="w-full space-y-2 mt-2">
                    {msg.answer.insights.map((ins) => <InsightCard key={ins.id} insight={ins} />)}
                  </div>
                )}
                <span className="text-[8px] text-slate-500 font-mono mt-1 px-1">{msg.time}</span>
              </div>
            ))}

            {loadingResponse && (
              <div className="flex items-center gap-2 text-slate-500 font-mono text-xs">
                <RefreshCw className="w-4 h-4 animate-spin text-next-purple-neon" />
                <span>Eliza está correlacionando os dados reais...</span>
              </div>
            )}
            {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-next-border pt-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Fale com a Eliza (Ex: 'Como está o financeiro?', 'O que tenho na agenda?')"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 bg-slate-950 border border-next-border hover:border-next-border-glow rounded-xl px-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon focus:shadow-next-glow-purple transition-all"
                style={{ minHeight: '38px' }}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || loadingResponse}
                className="px-4 py-2 bg-next-purple-neon hover:bg-next-purple-neon/90 text-white font-bold text-xs rounded-xl shadow-next-glow-purple transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
                style={{ minHeight: '38px' }}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-500" />
                Somente leitura — chama a IA real (OpenAI com fallback Gemini)
              </span>
              <span>Enter para enviar</span>
            </div>
          </div>
        </div>

        {/* RIGHT COMPONENT: CLINICAL MEMORY & CONTEXT STATS - 5 COLS */}
        <div className="lg:col-span-5 space-y-6">

          <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-5 shadow-next-glass space-y-4">
            <div className="flex items-center gap-1.5 border-b border-next-border pb-3">
              <Sparkles className="w-4 h-4 text-next-purple-neon" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                Consultas Rápidas Sugeridas
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {quickPrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(p.text)}
                  disabled={loadingResponse}
                  className="w-full text-left p-3 bg-slate-950/40 hover:bg-slate-900 border border-next-border hover:border-next-border-glow rounded-xl transition-all text-xs text-slate-300 font-sans leading-normal cursor-pointer flex items-center justify-between group disabled:opacity-50"
                  style={{ minHeight: '44px' }}
                >
                  <span className="group-hover:text-next-purple-light transition-colors font-medium">{p.label}</span>
                  <CornerDownRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-next-purple-light transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-5 shadow-next-glass space-y-4 relative overflow-hidden">
            <div className="flex justify-between items-center border-b border-next-border pb-3">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs font-bold text-slate-200">Memória de Contexto Clínico</span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono font-bold uppercase">{loadingContext ? 'Carregando' : 'Real'}</span>
            </div>

            {loadingContext || !context ? (
              <div className="text-center py-6"><RefreshCw className="w-4 h-4 animate-spin text-slate-500 mx-auto" /></div>
            ) : (
              <div className="space-y-3 text-[11px] leading-relaxed">
                <div className="bg-slate-950/60 p-3 rounded-lg border border-next-border/50">
                  <span className="text-[9px] font-mono text-slate-500 block uppercase font-bold">Base de Pacientes</span>
                  <p className="text-slate-300 mt-1">
                    <strong className="text-next-purple-light">{context.patientCount} paciente(s) cadastrado(s)</strong>. {context.todayAppointments.length} agendamento(s) hoje, {context.upcomingCount} nos próximos 7 dias.
                  </p>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-lg border border-next-border/50">
                  <span className="text-[9px] font-mono text-slate-500 block uppercase font-bold">Financeiro Real</span>
                  <p className="text-slate-300 mt-1">
                    Recebido no mês: <strong className="text-slate-200">{formatCurrency(context.receivedMonth)}</strong>. A receber: <strong className="text-slate-200">{formatCurrency(context.receivable)}</strong>.
                    {context.overdueCount > 0 && <> <strong className="text-next-red-alert">{context.overdueCount} conta(s) vencida(s)</strong> ({formatCurrency(context.overdueAmount)}).</>}
                  </p>
                </div>
              </div>
            )}

            <div className="bg-slate-900 border border-next-border/60 rounded-xl p-3.5 flex items-start gap-2 text-[10px] text-slate-500 leading-normal font-mono">
              <ShieldCheck className="w-4 h-4 text-next-green-success flex-shrink-0 mt-0.5" />
              <span>
                Este chat envia os dados reais acima (sem identificadores sensíveis) para a IA real (OpenAI/Gemini) processar sua pergunta. Nenhuma escrita é feita no banco desta clínica.
              </span>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
