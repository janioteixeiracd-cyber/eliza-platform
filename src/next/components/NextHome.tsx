import React, { useState, useEffect } from 'react';
import {
  Brain,
  Send,
  RefreshCw,
  Bot,
  Lock,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Target,
  Calendar,
  TrendingUp,
  Star,
} from 'lucide-react';

// Right-column "Oportunidades detectadas" cards — purely decorative
// icon/color variety (real insights don't carry a fixed category), cycled
// by position so each card in the list reads distinctly, per the Light
// Premium spec (§25-31).
const OPPORTUNITY_ICONS = [Target, Calendar, TrendingUp, Star];
const OPPORTUNITY_TONES = ['purple', 'blue', 'green', 'orange'] as const;
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useElizaAsk } from '../hooks/useElizaAsk';
import InsightCard from './eliza/InsightCard';
import TemporalOverviewPanel from './eliza/TemporalOverviewPanel';
import type { AssistantInsight } from '../types/eliza';

interface ChatMessage {
  sender: 'ai' | 'user';
  text: string;
  insights?: AssistantInsight[];
}

export default function NextHome() {
  const { clinic, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const { ask } = useElizaAsk();

  const [patientsCount, setPatientsCount] = useState(0);
  const [appointmentsCount, setAppointmentsCount] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);

  const [greetingPrefix, setGreetingPrefix] = useState('');
  const [firstName, setFirstName] = useState('Doutor(a)');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opportunity Deck — real insights from the Insight Engine (via the
  // shared orchestrator), not a fixed set of hardcoded cards. Loaded once
  // on mount; "Atualizar" re-runs the same real call.
  const [deckInsights, setDeckInsights] = useState<AssistantInsight[]>([]);
  const [deckSummary, setDeckSummary] = useState('');
  const [loadingDeck, setLoadingDeck] = useState(true);
  const [deckError, setDeckError] = useState<string | null>(null);
  // Carousel: one card visible at a time — "Perguntar à Eliza" resets the
  // spot; the auto-advance timer below cycles when the user isn't looking.
  const [deckIndex, setDeckIndex] = useState(0);
  useEffect(() => {
    if (deckInsights.length <= 1) return;
    const timer = setInterval(() => {
      setDeckIndex(i => (i + 1) % deckInsights.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [deckInsights.length]);
  const goDeckPrev = () => setDeckIndex(i => (i - 1 + deckInsights.length) % deckInsights.length);
  const goDeckNext = () => setDeckIndex(i => (i + 1) % deckInsights.length);

  useEffect(() => {
    const hour = new Date().getHours();
    let timeGreeting = 'Bom dia';
    if (hour >= 12 && hour < 18) timeGreeting = 'Boa tarde';
    else if (hour >= 18 || hour < 5) timeGreeting = 'Boa noite';
    setGreetingPrefix(timeGreeting);
    setFirstName(profile?.name ? profile.name.split(' ')[0] : 'Doutor(a)');
  }, [profile?.name]);

  // Lightweight instant counts for the "Varredura Real" header box — not
  // the Insight Engine's job, just a fast visible confirmation that real
  // data was read while the fuller orchestrator call runs below.
  useEffect(() => {
    async function loadTelemetry() {
      if (!clinic?.id) return;
      setLoadingStats(true);
      try {
        const [patientsSnap, appointmentsSnap] = await Promise.all([
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'patients'), limit(8000)), 'patients', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'appointments'), limit(2000)), 'appointments', { addAuditLog }),
        ]);
        setPatientsCount(patientsSnap.size);
        setAppointmentsCount(appointmentsSnap.size);
      } catch (e) {
        console.warn('Failed to load home telemetry:', e);
      } finally {
        setLoadingStats(false);
      }
    }
    loadTelemetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  async function loadDeck() {
    if (!clinic?.id) return;
    setLoadingDeck(true);
    setDeckError(null);
    try {
      const answer = await ask('Quais são os principais pontos de atenção agora?', { screenType: 'home' });
      setDeckInsights(answer.insights);
      setDeckIndex(0);
      setDeckSummary(answer.summary);
      addAuditLog({
        collection: 'ai_eliza_v2_audit',
        action: 'QUERY',
        status: 'SUCCESS',
        details: `Opportunity Deck carregado com ${answer.insights.length} insight(s) real(is) do Insight Engine.`,
      });
    } catch (err: any) {
      setDeckError(err?.message || 'Falha ao calcular os insights reais agora.');
    } finally {
      setLoadingDeck(false);
    }
  }

  useEffect(() => {
    loadDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  async function sendToEliza(text: string) {
    if (!text.trim() || isTyping) return;
    // Last few answered turns of this chat — lets a follow-up like "quem
    // você colocaria nesses horários?" resolve against what was just
    // discussed (server.ts systemPrompt rule 9), built from the messages
    // already on screen rather than a separate tracked history.
    const conversationHistory: { question: string; summary: string }[] = [];
    for (let i = 0; i < chatMessages.length - 1; i++) {
      if (chatMessages[i].sender === 'user' && chatMessages[i + 1].sender === 'ai') {
        conversationHistory.push({ question: chatMessages[i].text, summary: chatMessages[i + 1].text });
      }
    }
    setChatMessages(prev => [...prev, { sender: 'user', text }]);
    setChatInput('');
    setIsTyping(true);
    setError(null);
    try {
      const answer = await ask(text, { screenType: 'home', conversationHistory: conversationHistory.slice(-3) });
      setChatMessages(prev => [...prev, { sender: 'ai', text: answer.summary, insights: answer.insights }]);
      addAuditLog({
        collection: 'ai_eliza_v2_audit',
        action: 'QUERY',
        status: 'SUCCESS',
        details: `Eliza (orquestrador real) respondeu à consulta na Home: "${text}".`
      });
    } catch (err: any) {
      setError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setIsTyping(false);
    }
  }

  return (
    <div className="max-w-5xl xl:max-w-7xl font-sans pb-16">
    <div className="xl:grid xl:grid-cols-[1fr_280px] xl:gap-6 xl:items-start">
    <div className="space-y-10 min-w-0">

      {/* 1. WELCOME */}
      <div className="eliza-consciousness-hero relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-next-ia-blue/5 rounded-full blur-3xl pointer-events-none" />

        {/* ELIZA cognitive brain — assinatura visual da Consciência ELIZA.
            Camada de fundo absoluta (fora do fluxo, atrás do conteúdo via
            z-10 no wrapper abaixo), nunca uma 3ª coluna real — por isso não
            afeta a altura do hero. Centralizado verticalmente (top-1/2 +
            -translate-y-1/2) e dimensionado só pela largura (h-auto, mantém
            a proporção real do PNG) em vez de esticar a caixa entre
            top-0/bottom-0 — é isso que fazia a imagem ler como "cortada no
            canto" antes. Máscara em gradiente dissolve a borda esquerda no
            fundo do card; a própria imagem já traz sua iluminação, por isso
            nenhum glow novo é somado aqui. Oculta abaixo de lg. */}
        <img
          src="/brand/eliza-cognitive-brain.png"
          alt=""
          aria-hidden="true"
          className="hidden lg:block absolute top-1/2 -translate-y-1/2 lg:right-[-3%] xl:right-[-4%] lg:w-[30%] xl:w-[34%] h-auto lg:opacity-[0.65] xl:opacity-[0.88] object-contain pointer-events-none select-none"
          style={{
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.55) 14%, rgba(0,0,0,1) 34%)',
            maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.55) 14%, rgba(0,0,0,1) 34%)',
          }}
        />

        {/* At lg+, explicit grid columns (56% texto / 18% Varredura / 26%
            zona reservada pro cérebro) replace the old padding-right hack.
            That hack shrank the whole flex row first and only THEN split
            it between texto+Varredura, so texto was getting ~60% of an
            already-reduced 64% — compounding into a much narrower column
            than intended. A grid template defines each column against the
            FULL hero width directly, so texto keeps its real 56% no matter
            what Varredura or the (empty, unused — the brain is a separate
            absolute layer, not a grid item) 3rd column do. Below lg,
            unchanged flex behavior. */}
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6 z-10 lg:grid lg:grid-cols-[56%_18%_26%] lg:items-center">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
              <Bot className="w-3.5 h-3.5 text-next-purple-neon animate-pulse" />
              <span>ELIZA CONSCIÊNCIA COGNITIVA</span>
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-100 tracking-tight font-sans">
              {greetingPrefix}, <span className="eliza-name-gradient">{firstName}</span>.
              <Sparkles className="inline-block w-5 h-5 md:w-6 md:h-6 ml-1 -mt-2 text-next-purple-neon" />
            </h1>

            <p className="eliza-attention-summary text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
              {deckSummary || 'Li os dados reais da sua clínica agora. Abaixo estão as oportunidades calculadas a partir de pacientes, agenda e financeiro — sem números inventados.'}
            </p>
          </div>

          <div className="bg-slate-900/80 border border-next-border rounded-next-xl p-4 flex-shrink-0 flex flex-col space-y-1.5 md:min-w-[180px] lg:min-w-0 lg:w-full">
            <span className="text-[10px] font-mono text-slate-500">VARREDURA REAL</span>
            <div className="flex items-center gap-2 text-next-green-success font-semibold text-xs">
              <span className="w-2 h-2 rounded-full bg-next-green-success animate-pulse" />
              <span>Dados Clínicos Lidos</span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono whitespace-pre-line">
              {loadingStats ? 'Mapeando...' : `• ${patientsCount} pacientes\n• ${appointmentsCount} agendamentos lidos`}
            </p>
          </div>
        </div>
      </div>

      {/* 1.5 TEMPORAL — deterministic 30d vs previous-30d comparison + detected changes */}
      <TemporalOverviewPanel />

      {/* 2. OPPORTUNITY DECK — real insights from the Insight Engine */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-md font-bold text-slate-200 flex items-center gap-2">
              <Brain className="w-4 h-4 text-next-purple-neon" />
              <span>Insight em Foco</span>
            </h2>
            <p className="text-[11px] text-slate-500">Calculado a partir dos dados reais desta clínica pelo Insight Engine.</p>
          </div>
          <div className="flex items-center gap-2">
            {deckInsights.length > 0 && (
              <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-next-border">{deckIndex + 1}/{deckInsights.length}</span>
            )}
            <button onClick={loadDeck} disabled={loadingDeck} title="Atualizar" className="p-1.5 rounded-lg border border-next-border text-slate-400 hover:text-slate-200 hover:border-next-border-glow disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDeck ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loadingDeck ? (
          <div className="text-center py-10 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Calculando insights reais...</div>
        ) : deckError ? (
          <div className="text-center py-10 text-xs text-next-red-alert">{deckError}</div>
        ) : deckInsights.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-500">Nenhum ponto de atenção real encontrado agora — tudo em dia.</div>
        ) : (
          <div className="flex items-center gap-2 md:gap-3">
            {deckInsights.length > 1 && (
              <button onClick={goDeckPrev} title="Anterior" className="flex-shrink-0 p-2 rounded-full border border-next-border text-slate-400 hover:text-slate-100 hover:border-next-border-glow hover:bg-slate-800/60 transition-all">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <div key={deckInsights[deckIndex].id} className="flex-1 min-w-0 flex flex-col gap-2 animate-[eliza-deck-in_.3s_ease]">
              <InsightCard insight={deckInsights[deckIndex]} />
              <button
                onClick={() => sendToEliza(`Me explique mais sobre: ${deckInsights[deckIndex].title}`)}
                className="eliza-insight-cta eliza-insight-cta-standalone self-end text-[10px] font-bold uppercase tracking-wide text-next-purple-light hover:text-next-purple-mid px-2.5 py-1 rounded-md"
              >
                Perguntar à Eliza →
              </button>
            </div>

            {deckInsights.length > 1 && (
              <button onClick={goDeckNext} title="Próximo" className="flex-shrink-0 p-2 rounded-full border border-next-border text-slate-400 hover:text-slate-100 hover:border-next-border-glow hover:bg-slate-800/60 transition-all">
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {deckInsights.length > 1 && (
          <div className="flex items-center justify-center gap-1.5">
            {deckInsights.map((insight, i) => (
              <button
                key={insight.id}
                onClick={() => setDeckIndex(i)}
                title={insight.title}
                className={`h-1.5 rounded-full transition-all ${i === deckIndex ? 'w-5 bg-next-purple-neon' : 'w-1.5 bg-slate-700 hover:bg-slate-600'}`}
              />
            ))}
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
              <div className={`p-3.5 rounded-next-xl text-xs leading-relaxed max-w-full ${
                msg.sender === 'user'
                  ? 'bg-next-purple-neon text-white rounded-tr-none shadow-next-glow-purple'
                  : 'bg-slate-900/80 text-slate-300 rounded-tl-none border border-next-border'
              }`}>
                <p>{msg.text}</p>
                {msg.insights && msg.insights.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-next-border/60 space-y-1.5">
                    {msg.insights.map((ins) => <InsightCard key={ins.id} insight={ins} />)}
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

    {/* OPORTUNIDADES DETECTADAS — right column on large screens, stacked
        below the main content on smaller ones (same real insights as
        "Insight em Foco" above, just all shown at once in a compact list
        instead of one at a time). */}
    <aside className="mt-10 xl:mt-0 space-y-4">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-next-purple-neon flex-shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-bold text-slate-100">Oportunidades detectadas</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Insights gerados pela ELIZA para impulsionar sua clínica.</p>
        </div>
      </div>

      {!loadingDeck && !deckError && deckInsights.length > 0 && (
        <div className="space-y-3">
          {deckInsights.map((insight, i) => {
            const Icon = OPPORTUNITY_ICONS[i % OPPORTUNITY_ICONS.length];
            const tone = OPPORTUNITY_TONES[i % OPPORTUNITY_TONES.length];
            return (
              <div key={insight.id} data-tone={tone} className="eliza-opportunity-card next-glass-panel rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="eliza-opportunity-icon w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-next-purple-neon/10 text-next-purple-light">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="eliza-opportunity-title text-xs font-bold leading-snug text-slate-100">{insight.title}</p>
                    <p className="eliza-opportunity-desc text-[11px] leading-snug mt-1 text-slate-400">{insight.description}</p>
                    <button
                      onClick={() => { setDeckIndex(i); sendToEliza(`Me explique mais sobre: ${insight.title}`); }}
                      className="eliza-opportunity-cta text-[10.5px] font-bold mt-2 inline-flex items-center gap-1 text-next-purple-light hover:text-next-purple-mid"
                    >
                      Ver detalhes →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>

    </div>
    </div>
  );
}
