import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  Bot, 
  TrendingUp, 
  Award, 
  CheckCircle2, 
  Users, 
  Calendar, 
  HeartPulse, 
  Briefcase, 
  MessageSquare, 
  Flame, 
  DollarSign, 
  Play, 
  Sliders, 
  HelpCircle, 
  Star, 
  ShieldCheck, 
  Info, 
  BadgeCheck,
  Building,
  Target
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';

// Definition of slides for the guided presentation mode
interface PitchSlide {
  id: number;
  title: string;
  subtitle: string;
  badge: string;
  visualType: 'compare' | 'plans' | 'founders' | 'roi' | 'manifesto';
}

export default function NextCommercialDemo() {
  const { profile, clinic } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  // Mode state: 'presentation' (guided pitch deck) or 'explore' (interactive pricing & value explore)
  const [demoMode, setDemoMode] = useState<'presentation' | 'explore'>('presentation');
  
  // Presentation slide state
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  // Interactive ROI Estimator states
  const [monthlyPatients, setMonthlyPatients] = useState<number>(250);
  const [averageTicket, setAverageTicket] = useState<number>(1200);
  const [currentNoShowRate, setCurrentNoShowRate] = useState<number>(20); // in %

  // Simulated subscription intent
  const [selectedPlan, setSelectedPlan] = useState<'assistant' | 'secretary' | 'manager' | 'ceo'>('manager');
  const [interestedName, setInterestedName] = useState(profile?.name || '');
  const [interestedEmail, setInterestedEmail] = useState(profile?.email || '');
  const [comments, setComments] = useState('');
  const [isFormSubmitted, setIsFormSubmitted] = useState(false);

  // Slides configuration
  const slides: PitchSlide[] = [
    {
      id: 0,
      badge: "A Nova Era",
      title: "Chega de digitar. É hora de colaborar.",
      subtitle: "Por que CRMs tradicionais falham em clínicas de alto padrão, e como a Eliza cria uma nova categoria de produto.",
      visualType: 'compare'
    },
    {
      id: 1,
      badge: "Estatuto de Equipe",
      title: "Contrate a Eliza para o seu time",
      subtitle: "Selecione o papel exato que a inteligência artificial assumirá dentro do seu fluxo de trabalho clínico.",
      visualType: 'plans'
    },
    {
      id: 2,
      badge: "Oportunidade Exclusiva",
      title: "O Programa das 150 Clínicas Fundadoras",
      subtitle: "Um ecossistema fechado para acelerar consultórios de elite com isenção de custos iniciais e benefícios vitalícios.",
      visualType: 'founders'
    },
    {
      id: 3,
      badge: "Retorno Financeiro",
      title: "Calculadora de Valor Percebido & ROI",
      subtitle: "Simule a recuperação de orçamentos represados e redução de ausências com a inteligência ativa.",
      visualType: 'roi'
    },
    {
      id: 4,
      badge: "Manifesto",
      title: "A Proposta de Futuro ELIZA NEXT",
      subtitle: "O fim do software passivo e o início da autonomia clínica inteligente e orientada à conversão ética.",
      visualType: 'manifesto'
    }
  ];

  // Calculations for ROI simulator
  const currentLostRevenue = Math.round(monthlyPatients * (currentNoShowRate / 100) * averageTicket);
  // Eliza decreases no-shows by 60% on average (e.g. from 20% to 8%)
  const expectedNoShowWithEliza = Math.max(4, Math.round(currentNoShowRate * 0.4));
  const elizaLostRevenue = Math.round(monthlyPatients * (expectedNoShowWithEliza / 100) * averageTicket);
  const directRecoveredRevenue = currentLostRevenue - elizaLostRevenue;
  // Extra budget conversions (estimated 15% increase in conversion)
  const budgetConversionGain = Math.round(monthlyPatients * 0.15 * averageTicket * 0.5);
  const totalFinancialImpact = directRecoveredRevenue + budgetConversionGain;

  const handleNextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      const nextIdx = currentSlideIndex + 1;
      setCurrentSlideIndex(nextIdx);
      addAuditLog({
        collection: 'commercial_pitch',
        action: 'QUERY',
        status: 'SUCCESS',
        details: `Navegou para o Slide ${nextIdx + 1}: ${slides[nextIdx].badge}`
      });
    }
  };

  const handlePrevSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const handleApplyFounderProgram = (e: React.FormEvent) => {
    e.preventDefault();
    setIsFormSubmitted(true);
    addAuditLog({
      collection: 'founder_leads',
      action: 'WRITE_BLOCKED',
      status: 'SUCCESS',
      details: `Inscrição de clínica fundadora simulada para o plano ${selectedPlan.toUpperCase()} por ${interestedName} (${interestedEmail})`
    });
  };

  return (
    <div className="space-y-8 max-w-6xl font-sans text-slate-200">
      
      {/* Upper commercial banner & control */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold font-mono bg-next-purple-neon/15 text-next-purple-light px-2.5 py-0.5 rounded border border-next-purple-neon/20 uppercase tracking-wider">
              Sprint 12 • Demo Comercial
            </span>
            <span className="text-slate-600">•</span>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2 tracking-tight">
              <Sparkles className="w-5 h-5 text-next-purple-neon" />
              <span>ELIZA NEXT 2.0 — Pitch & Storytelling</span>
            </h2>
          </div>
          <p className="text-slate-400 text-xs">
            Apresentação comercial premium. Transforme a percepção do CRM tradicional em uma Verdadeira Colaboradora de IA.
          </p>
        </div>

        {/* Presentation controls */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800/80 self-start lg:self-center">
          <button
            onClick={() => {
              setDemoMode('presentation');
              addAuditLog({ collection: 'commercial_mode', action: 'QUERY', status: 'SUCCESS', details: 'Ativou Modo Apresentação de Pitch' });
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
              demoMode === 'presentation' 
                ? 'bg-next-purple-neon text-white shadow-next-glow-purple' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
            style={{ minHeight: '38px' }}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Modo Pitch Deck</span>
          </button>
          <button
            onClick={() => {
              setDemoMode('explore');
              addAuditLog({ collection: 'commercial_mode', action: 'QUERY', status: 'SUCCESS', details: 'Ativou Modo Explore de Planos' });
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
              demoMode === 'explore' 
                ? 'bg-next-purple-neon text-white shadow-next-glow-purple' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
            style={{ minHeight: '38px' }}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Explore os Planos & ROI</span>
          </button>
        </div>
      </div>

      {/* Main Container based on Mode */}
      <AnimatePresence mode="wait">
        {demoMode === 'presentation' ? (
          
          /* PRESENTATION MODE (GUIDED SLIDE SHOW) */
          <motion.div
            key="presentation-container"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
            {/* Slide Body - Left 8 columns */}
            <div className="lg:col-span-8 flex flex-col justify-between bg-slate-900/65 border border-slate-800/80 rounded-3xl p-6 md:p-8 min-h-[500px]">
              
              <div className="space-y-6">
                {/* Badge & Progress */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono text-next-purple-light uppercase tracking-widest bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full">
                    {slides[currentSlideIndex].badge}
                  </span>
                  <div className="flex gap-1.5">
                    {slides.map((_, idx) => (
                      <div 
                        key={idx}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          idx === currentSlideIndex 
                            ? 'w-6 bg-next-purple-neon' 
                            : 'w-1.5 bg-slate-800'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Typography Heading */}
                <div className="space-y-2.5">
                  <h3 className="text-2xl md:text-3xl font-extrabold text-slate-100 tracking-tight font-sans leading-tight">
                    {slides[currentSlideIndex].title}
                  </h3>
                  <p className="text-slate-400 text-sm md:text-base leading-relaxed">
                    {slides[currentSlideIndex].subtitle}
                  </p>
                </div>

                {/* Conditional Visual Asset for Slide content */}
                <div className="pt-4 border-t border-slate-800/60">
                  
                  {/* SLIDE 1: COMPARATIVE CRM VS ELIZA */}
                  {slides[currentSlideIndex].visualType === 'compare' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-950/70 border border-slate-850 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                          <span className="w-2 h-2 bg-rose-400 rounded-full" />
                          <span>CRM Tradicional de Saúde</span>
                        </div>
                        <ul className="space-y-2 text-[11px] text-slate-400 font-sans leading-normal">
                          <li className="flex items-start gap-1.5">
                            <span className="text-rose-400 flex-shrink-0 mt-0.5">✕</span>
                            <span><strong>Planilha passiva:</strong> Exige que médicos e recepcionistas digitem e salvem tudo manualmente de forma exaustiva.</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <span className="text-rose-400 flex-shrink-0 mt-0.5">✕</span>
                            <span><strong>Visual poluído e técnico:</strong> Tabelas, códigos, caixas de diálogo confusas que geram sobrecarga cognitiva diária.</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <span className="text-rose-400 flex-shrink-0 mt-0.5">✕</span>
                            <span><strong>Análise cega:</strong> Apenas guarda dados históricos, sem sugerir ações de venda de tratamentos ou conversão ativa.</span>
                          </li>
                        </ul>
                      </div>

                      <div className="bg-next-purple-neon/5 border border-next-purple-neon/30 p-4 rounded-2xl space-y-3 shadow-next-glow-purple/5">
                        <div className="flex items-center gap-2 text-next-purple-light font-bold text-xs uppercase tracking-wider">
                          <span className="w-2 h-2 bg-next-purple-neon rounded-full animate-pulse" />
                          <span>ELIZA — Colaboradora Digital</span>
                        </div>
                        <ul className="space-y-2 text-[11px] text-slate-300 font-sans leading-normal">
                          <li className="flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0 mt-0.5" />
                            <span><strong>Inteligência Autônoma:</strong> Lê a conversa, ouve o ditado do prontuário, analisa e formula lembretes sozinhas.</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0 mt-0.5" />
                            <span><strong>Layout Minimalista Premium:</strong> Cores escuras que não cansam a vista do médico e interface livre de poluição.</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0 mt-0.5" />
                            <span><strong>Crescimento Clínico Ativo:</strong> Busca na agenda por ausências recentes e elabora a copy ideal de reconexão ética.</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* SLIDE 2: NARRATIVE - CONTRACT THE ELIZA PLANS */}
                  {slides[currentSlideIndex].visualType === 'plans' && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="flex items-center gap-1 text-slate-100 font-bold mb-1">
                            <Bot className="w-3.5 h-3.5 text-next-purple-light" />
                            <span className="text-[11px]">Eliza Assistente</span>
                          </div>
                          <p className="text-[10px] text-slate-400">O suporte imediato do médico em consultório.</p>
                        </div>
                        <p className="font-mono text-next-purple-light text-[10px] font-bold">Transcrição & Prontuários</p>
                      </div>

                      <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="flex items-center gap-1 text-slate-100 font-bold mb-1">
                            <Calendar className="w-3.5 h-3.5 text-next-purple-light" />
                            <span className="text-[11px]">Eliza Secretária</span>
                          </div>
                          <p className="text-[10px] text-slate-400">A rainha do fluxo de WhatsApp e agendamento.</p>
                        </div>
                        <p className="font-mono text-next-purple-light text-[10px] font-bold">WhatsApp & Cancelamento</p>
                      </div>

                      <div className="bg-next-purple-neon/5 p-3 rounded-xl border border-next-purple-neon/40 flex flex-col justify-between space-y-2 shadow-next-glow-purple/5">
                        <div>
                          <div className="flex items-center gap-1 text-slate-100 font-bold mb-1">
                            <Briefcase className="w-3.5 h-3.5 text-next-purple-neon" />
                            <span className="text-[11px] text-next-purple-light">Eliza Gestora</span>
                          </div>
                          <p className="text-[10px] text-slate-350">Comanda orçamentos, caixa e tendências.</p>
                        </div>
                        <p className="font-mono text-next-purple-neon text-[10px] font-bold">Inteligência Operacional</p>
                      </div>

                      <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="flex items-center gap-1 text-slate-100 font-bold mb-1">
                            <Award className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-[11px]">Eliza CEO</span>
                          </div>
                          <p className="text-[10px] text-slate-400">Análise macro, simulação e otimização geral.</p>
                        </div>
                        <p className="font-mono text-amber-400 text-[10px] font-bold">Cérebro Estratégico Total</p>
                      </div>
                    </div>
                  )}

                  {/* SLIDE 3: FOUNDERS CAMPAIGN */}
                  {slides[currentSlideIndex].visualType === 'founders' && (
                    <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 flex flex-col md:flex-row items-center gap-6">
                      <div className="flex-shrink-0 w-24 h-24 rounded-full bg-emerald-500/10 border-2 border-dashed border-emerald-500/40 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] font-bold font-mono text-emerald-400 uppercase">Lote</span>
                        <span className="text-lg font-extrabold text-emerald-400 font-mono tracking-tighter leading-tight">Fundador</span>
                        <span className="text-[9px] text-slate-500">Limitado</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <p className="font-bold text-slate-150 flex items-center gap-1.5">
                          <Building className="w-4 h-4 text-emerald-400" />
                          <span>Lote Clínicas Fundadoras (Máximo 150)</span>
                        </p>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          Para moldar a inteligência da Eliza NEXT 2.0 às rotinas reais de grandes consultórios médicos e odontológicos, abrimos o programa de Clínicas Fundadoras. Apenas 150 parceiros estratégicos terão acessos exclusivos e suporte preferencial permanente.
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] font-mono text-emerald-400 font-bold">
                          <span>✓ Isenção de R$ 3.500 em Setup</span>
                          <span>✓ Desconto de 40% permanente na mensalidade</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SLIDE 4: VALUE GENERATED & ROI SLIDER */}
                  {slides[currentSlideIndex].visualType === 'roi' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Inputs */}
                      <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-850/60">
                        <p className="font-bold text-[10px] text-slate-400 uppercase tracking-wider">Ajuste os dados da sua clínica:</p>
                        
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-slate-350">
                            <span>Pacientes Consultados / Mês</span>
                            <span className="font-bold font-mono text-next-purple-light">{monthlyPatients}</span>
                          </div>
                          <input 
                            type="range" 
                            min="50" 
                            max="1000" 
                            step="25"
                            value={monthlyPatients} 
                            onChange={(e) => setMonthlyPatients(Number(e.target.value))}
                            className="w-full accent-next-purple-neon"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-slate-350">
                            <span>Ticket Médio de Tratamento</span>
                            <span className="font-bold font-mono text-next-purple-light">R$ {averageTicket}</span>
                          </div>
                          <input 
                            type="range" 
                            min="500" 
                            max="5000" 
                            step="100"
                            value={averageTicket} 
                            onChange={(e) => setAverageTicket(Number(e.target.value))}
                            className="w-full accent-next-purple-neon"
                          />
                        </div>
                      </div>

                      {/* Outputs */}
                      <div className="bg-next-purple-neon/5 border border-next-purple-neon/20 p-4 rounded-xl flex flex-col justify-between">
                        <div>
                          <p className="text-[9px] font-bold font-mono uppercase text-next-purple-light tracking-wider">Recuperação Projetada Eliza NEXT</p>
                          <p className="text-xl font-extrabold text-slate-100 tracking-tight mt-1 font-mono">
                            + R$ {totalFinancialImpact.toLocaleString('pt-BR')}
                            <span className="text-[10px] font-normal text-slate-400 block font-sans">Receita mensal estimada recuperada de faltas e orçamentos parados</span>
                          </p>
                        </div>
                        <div className="flex gap-4 border-t border-next-purple-neon/15 pt-2 mt-2 text-[10px] text-slate-400 font-sans">
                          <div>
                            <span className="block font-bold text-slate-300">-{currentNoShowRate - expectedNoShowWithEliza}%</span>
                            <span>Menos Faltas</span>
                          </div>
                          <div>
                            <span className="block font-bold text-slate-300">+15%</span>
                            <span>Conversão Geral</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SLIDE 5: INSTITUTIONAL MANIFESTO */}
                  {slides[currentSlideIndex].visualType === 'manifesto' && (
                    <div className="bg-slate-950/70 p-4 border border-slate-850/80 rounded-2xl space-y-2.5 text-xs text-slate-350 leading-relaxed font-sans">
                      <p className="font-bold text-slate-150 text-sm flex items-center gap-1.5 font-sans">
                        <Target className="w-4 h-4 text-next-purple-neon" />
                        <span>O Software Não Deve Ser Uma Agenda Estática.</span>
                      </p>
                      <p>
                        Acreditamos que softwares de gestão médica tradicionais sobrecarregam os times com digitação excessiva e dão pouco ou nenhum retorno em conversão. O futuro não reside em mais formulários, mas em uma **inteligência coadjuvante ativa** que trabalha em segundo plano.
                      </p>
                      <p>
                        ELIZA NEXT 2.0 foi desenhada sob três pilares estritos: **Isolamento de Produção** (não danifica seus prontuários anteriores), **Invisibilidade de Entrada** (aproveita dados de conversas naturais) e **Retorno Imediato** (foco em resgatar pacientes que sumiram).
                      </p>
                    </div>
                  )}

                </div>
              </div>

              {/* Navigation controls for Slide */}
              <div className="flex items-center justify-between border-t border-slate-800/80 pt-6 mt-6">
                <button
                  onClick={handlePrevSlide}
                  disabled={currentSlideIndex === 0}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all ${
                    currentSlideIndex === 0 
                      ? 'text-slate-600 cursor-not-allowed' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Anterior</span>
                </button>

                <div className="text-[11px] text-slate-500 font-mono">
                  Slide {currentSlideIndex + 1} de {slides.length}
                </div>

                {currentSlideIndex < slides.length - 1 ? (
                  <button
                    onClick={handleNextSlide}
                    className="px-5 py-2.5 bg-next-purple-neon hover:bg-opacity-95 active:scale-[0.98] rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-next-glow-purple transition-all"
                    style={{ minHeight: '44px' }}
                  >
                    <span>Próximo</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setDemoMode('explore');
                      addAuditLog({ collection: 'commercial_slides', action: 'QUERY', status: 'SUCCESS', details: 'Terminou o slide deck e abriu os planos' });
                    }}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-opacity-95 active:scale-[0.98] rounded-xl text-xs font-bold text-white flex items-center gap-1.5 transition-all"
                    style={{ minHeight: '44px' }}
                  >
                    <span>Simular Valores dos Planos</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

            </div>

            {/* Call to action & Founder Leads Form - Right 4 columns */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Program application card */}
              <div className="bg-slate-900/65 border border-slate-800/80 rounded-3xl p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Flame className="w-4 h-4 text-next-purple-neon animate-pulse" />
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-200">
                    Inscreva-se como Fundador
                  </h4>
                </div>

                {isFormSubmitted ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center p-4 bg-emerald-500/10 border border-emerald-500/35 rounded-2xl space-y-2.5"
                  >
                    <div className="w-9 h-9 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center text-emerald-400 mx-auto">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div className="space-y-1 text-xs">
                      <p className="font-bold text-slate-150">Simulação registrada (Modo Demonstração)</p>
                      <p className="text-[10.5px] text-slate-400 leading-relaxed">
                        Este é um ambiente de demonstração: nenhum dado foi enviado, salvo ou transmitido a qualquer sistema. Nenhuma equipe será contatada a partir deste formulário.
                      </p>
                    </div>
                    <button 
                      onClick={() => setIsFormSubmitted(false)}
                      className="px-3 py-1 bg-slate-850 hover:bg-slate-800 rounded-lg text-[10px] text-slate-350 border border-slate-700 transition-colors"
                    >
                      Preencher Nova
                    </button>
                  </motion.div>
                ) : (
                  <form onSubmit={handleApplyFounderProgram} className="space-y-4 text-xs font-sans">
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Garanta uma das 14 vagas restantes no programa de homologação comercial de clínicas fundadoras.
                    </p>

                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase">Seu Nome</label>
                      <input 
                        type="text" 
                        value={interestedName}
                        onChange={(e) => setInterestedName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-next-purple-neon transition-colors"
                        placeholder="Nome do Médico / Gestor"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase">E-mail Corporativo</label>
                      <input 
                        type="email" 
                        value={interestedEmail}
                        onChange={(e) => setInterestedEmail(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-next-purple-neon transition-colors"
                        placeholder="nome@clinica.com"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase">Papel Desejado para a Eliza</label>
                      <select 
                        value={selectedPlan}
                        onChange={(e) => setSelectedPlan(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-300 focus:outline-none focus:border-next-purple-neon transition-colors"
                      >
                        <option value="assistant">Eliza Assistente (Transcrição & Prontuários)</option>
                        <option value="secretary">Eliza Secretária (WhatsApp & Agendamento)</option>
                        <option value="manager">Eliza Gestora (Análise Financeira & Caixa)</option>
                        <option value="ceo">Eliza CEO (Cérebro Estratégico & Expansão)</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-next-purple-neon hover:bg-opacity-95 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-next-glow-purple transition-all"
                      style={{ minHeight: '44px' }}
                    >
                      <BadgeCheck className="w-4 h-4 text-white" />
                      <span>Garantir Vaga de Fundador</span>
                    </button>
                  </form>
                )}
              </div>

              {/* Perceveid value highlight widgets */}
              <div className="bg-slate-950/60 border border-slate-850/80 rounded-2xl p-4 space-y-3 text-xs">
                <p className="font-bold text-[10px] uppercase text-slate-500 tracking-wider">Métricas de Valor Percebido (QA)</p>
                <div className="grid grid-cols-2 gap-3 font-sans">
                  <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-850">
                    <span className="block font-mono text-emerald-400 font-extrabold text-sm">-40%</span>
                    <span className="text-[10px] text-slate-400">Tempo de digitação clínica</span>
                  </div>
                  <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-850">
                    <span className="block font-mono text-emerald-400 font-extrabold text-sm">+22%</span>
                    <span className="text-[10px] text-slate-400">Retorno de pacientes sumidos</span>
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        ) : (
          
          /* EXPLORE & PRICING PLANS VIEW */
          <motion.div
            key="explore-container"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-8"
          >
            {/* Interactive Calculator Section */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-2">
                <div>
                  <h3 className="font-extrabold text-base text-slate-100 flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-next-purple-neon" />
                    <span>Simulador Comercial de ROI Clínico</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Insira as variáveis da sua clínica para enxergar o valor de faturamento resgatado pela inteligência.
                  </p>
                </div>
                <span className="text-[10.5px] text-next-purple-light font-mono bg-next-purple-neon/10 border border-next-purple-neon/20 px-2 py-0.5 rounded font-bold uppercase">
                  Valores Baseados no Core de QA
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* Sliders Input Area - Left Col */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-350">
                      <span>Volume mensal de pacientes</span>
                      <span className="font-bold font-mono text-next-purple-light">{monthlyPatients} atendimentos</span>
                    </div>
                    <input 
                      type="range" 
                      min="50" 
                      max="1200" 
                      step="25"
                      value={monthlyPatients} 
                      onChange={(e) => setMonthlyPatients(Number(e.target.value))}
                      className="w-full accent-next-purple-neon"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>50</span>
                      <span>600</span>
                      <span>1200</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-350">
                      <span>Ticket médio de tratamentos</span>
                      <span className="font-bold font-mono text-next-purple-light">R$ {averageTicket}</span>
                    </div>
                    <input 
                      type="range" 
                      min="500" 
                      max="6000" 
                      step="100"
                      value={averageTicket} 
                      onChange={(e) => setAverageTicket(Number(e.target.value))}
                      className="w-full accent-next-purple-neon"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>R$ 500</span>
                      <span>R$ 3.200</span>
                      <span>R$ 6.000</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-350">
                      <span>Taxa de falta / cancelamento atual</span>
                      <span className="font-bold font-mono text-next-purple-light">{currentNoShowRate}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="5" 
                      max="40" 
                      step="1"
                      value={currentNoShowRate} 
                      onChange={(e) => setCurrentNoShowRate(Number(e.target.value))}
                      className="w-full accent-next-purple-neon"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>5% (Excelente)</span>
                      <span>20% (Média)</span>
                      <span>40% (Alerta crítico)</span>
                    </div>
                  </div>
                </div>

                {/* ROI Output Metrics Card - Right Col */}
                <div className="lg:col-span-7 bg-slate-950/70 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-800/80">
                    
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cenário Clínico Atual</p>
                      <p className="text-sm font-semibold text-slate-300">Faturamento sob Risco de Faltas</p>
                      <p className="text-xl font-bold text-rose-400 font-mono">R$ {currentLostRevenue.toLocaleString('pt-BR')}</p>
                      <span className="text-[10px] text-slate-500 block leading-tight">Valor que a clínica perde mensalmente por faltas e cancelamentos.</span>
                    </div>

                    <div className="space-y-1.5 border-t md:border-t-0 md:border-l border-slate-800/80 pt-4 md:pt-0 md:pl-6">
                      <p className="text-[10px] font-bold text-next-purple-light uppercase tracking-wider">Com a Eliza NEXT 2.0</p>
                      <p className="text-sm font-semibold text-emerald-400">Faturamento Recuperado</p>
                      <p className="text-xl font-bold text-emerald-400 font-mono">R$ {directRecoveredRevenue.toLocaleString('pt-BR')}</p>
                      <span className="text-[10px] text-slate-500 block leading-tight">Valor recuperado diretamente com as ações da Secretária Digital.</span>
                    </div>

                  </div>

                  <div className="pt-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold font-mono uppercase text-next-purple-light tracking-widest">Impacto Financeiro Mensal Total Estimado</p>
                      <p className="text-2xl font-extrabold text-slate-100 font-mono tracking-tight">R$ {totalFinancialImpact.toLocaleString('pt-BR')}</p>
                      <p className="text-[10px] text-slate-400 font-sans leading-tight">Soma de resgates de cancelamentos e conversão de 15% de orçamentos parados.</p>
                    </div>

                    <button 
                      onClick={() => {
                        const targetEl = document.getElementById('plans-deck');
                        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
                        addAuditLog({ collection: 'commercial_roi', action: 'QUERY', status: 'SUCCESS', details: `Fez simulação de ROI para R$ ${totalFinancialImpact.toLocaleString()}` });
                      }}
                      className="py-2.5 px-4 bg-next-purple-neon hover:bg-opacity-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-next-glow-purple transition-all"
                      style={{ minHeight: '44px' }}
                    >
                      <span>Contratar Plano Compatível</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Plans Grid Section */}
            <div id="plans-deck" className="space-y-4 pt-4">
              <div className="text-center space-y-1 max-w-xl mx-auto pb-4">
                <h3 className="font-extrabold text-lg text-slate-150 tracking-tight">
                  Tabela Comparativa de Cargos
                </h3>
                <p className="text-xs text-slate-400 leading-normal">
                  Não escolha ferramentas. Defina as atribuições e responsabilidades que a Eliza assumirá na sua clínica hoje.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                
                {/* PLAN 1: ASSISTANTE */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between min-h-[350px] transition-all hover:border-slate-700">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Bot className="w-4 h-4 text-slate-400" />
                        <h4 className="font-extrabold text-sm text-slate-200">Eliza Assistente</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">Transcrição por voz e auxílio de escrita de evolução.</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Atribuições:</p>
                      <ul className="text-[10.5px] space-y-1 text-slate-400 font-sans">
                        <li>• Ditado clínico e estruturação automática</li>
                        <li>• Anamnese estruturada estilo Notion</li>
                        <li>• Consulta offline de pacientes</li>
                        <li>• Alertas de dados inconsistentes</li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-800/80 space-y-3">
                    <div className="text-slate-200 font-mono font-bold text-sm">
                      R$ 349 <span className="text-[10px] font-sans font-normal text-slate-500">/mês</span>
                    </div>
                    <button 
                      onClick={() => { setSelectedPlan('assistant'); setComments('Gostaria de agendar uma demonstração da Eliza Assistente para apoiar meu corpo clínico nos prontuários.'); }}
                      className="w-full py-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-[11px] rounded-lg transition-all"
                    >
                      Selecionar Cargo
                    </button>
                  </div>
                </div>

                {/* PLAN 2: SECRETARIA */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between min-h-[350px] transition-all hover:border-slate-700">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <h4 className="font-extrabold text-sm text-slate-200">Eliza Secretária</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">A guardiã dos agendamentos e das confirmações.</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Atribuições:</p>
                      <ul className="text-[10.5px] space-y-1 text-slate-400 font-sans">
                        <li>• Envio de templates de lembretes (Simulados)</li>
                        <li>• Gestão de faltosos e lista de espera ativa</li>
                        <li>• Confirmação automática de consultas</li>
                        <li>• Integração assistida de wa.me</li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-800/80 space-y-3">
                    <div className="text-slate-200 font-mono font-bold text-sm">
                      R$ 499 <span className="text-[10px] font-sans font-normal text-slate-500">/mês</span>
                    </div>
                    <button 
                      onClick={() => { setSelectedPlan('secretary'); setComments('Quero entender como funciona a Eliza Secretária para reduzir as ausências mensais de pacientes.'); }}
                      className="w-full py-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-[11px] rounded-lg transition-all"
                    >
                      Selecionar Cargo
                    </button>
                  </div>
                </div>

                {/* PLAN 3: GESTORA (RECOMMENDED) */}
                <div className="bg-next-purple-neon/5 border border-next-purple-neon/40 rounded-2xl p-5 flex flex-col justify-between min-h-[350px] relative shadow-next-glow-purple/5 transition-all hover:border-next-purple-neon/60">
                  <span className="absolute -top-2.5 right-4 bg-next-purple-neon text-white font-bold text-[9px] px-2 py-0.5 rounded-full font-mono uppercase">
                    Mais Indicado
                  </span>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-4 h-4 text-next-purple-neon" />
                        <h4 className="font-extrabold text-sm text-slate-100">Eliza Gestora</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">Inteligência focada em otimização de orçamentos e receita.</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-next-purple-light uppercase font-bold tracking-wider">Atribuições:</p>
                      <ul className="text-[10.5px] space-y-1 text-slate-350 font-sans">
                        <li>• Projeção futura de faturamento com tendências</li>
                        <li>• Análise de conversão de orçamentos parados</li>
                        <li>• Stripe-style dashboard integrado de caixa</li>
                        <li>• Alertas inteligentes de evasão e cancelamento</li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-next-purple-neon/20 space-y-3">
                    <div className="text-next-purple-light font-mono font-bold text-sm">
                      R$ 699 <span className="text-[10px] font-sans font-normal text-slate-500">/mês</span>
                    </div>
                    <button 
                      onClick={() => { setSelectedPlan('manager'); setComments('Quero testar a Eliza Gestora para unificar faturamento de hoje com tendências e orçamentos em mesa.'); }}
                      className="w-full py-2 bg-next-purple-neon hover:bg-opacity-95 text-white font-bold text-[11px] rounded-lg transition-all"
                    >
                      Selecionar Cargo
                    </button>
                  </div>
                </div>

                {/* PLAN 4: CEO */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between min-h-[350px] transition-all hover:border-slate-700">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-amber-400" />
                        <h4 className="font-extrabold text-sm text-slate-200">Eliza CEO</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">Planejamento autônomo total, controle e expansão.</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Atribuições:</p>
                      <ul className="text-[10.5px] space-y-1 text-slate-400 font-sans">
                        <li>• Simulador de decisões para expansão física</li>
                        <li>• Auditoria geral e trail de dados operacionais</li>
                        <li>• Alocação de recursos clínicos autônoma</li>
                        <li>• Análise macro e comparativo de filiais</li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-800/80 space-y-3">
                    <div className="text-amber-400 font-mono font-bold text-sm">
                      R$ 999 <span className="text-[10px] font-sans font-normal text-slate-500">/mês</span>
                    </div>
                    <button 
                      onClick={() => { setSelectedPlan('ceo'); setComments('Tenho interesse na Eliza CEO para planejar a expansão do consultório e realizar simulações estratégicas.'); }}
                      className="w-full py-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-[11px] rounded-lg transition-all"
                    >
                      Selecionar Cargo
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Interest form for explore mode */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 md:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                
                {/* Form Copy - Left Col */}
                <div className="lg:col-span-7 space-y-3 font-sans">
                  <h4 className="font-extrabold text-base text-slate-150 flex items-center gap-2">
                    <Building className="w-5 h-5 text-next-purple-neon" />
                    <span>Clínicas Fundadoras — Isenção Total de R$ 3.500 no Setup</span>
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Preencha os dados de contato do profissional abaixo para garantir a isenção vitalícia de instalação da ELIZA NEXT 2.0. Os primeiros 150 consultórios participam ativamente da evolução estratégica clínica.
                  </p>
                  <div className="flex gap-4 text-[10.5px] text-slate-500 font-mono">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Mensalidade Vitalícia com Desconto</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Suporte Estratégico Direto</span>
                    </span>
                  </div>
                </div>

                {/* Form Submit - Right Col */}
                <div className="lg:col-span-5 bg-slate-950/70 border border-slate-800 p-6 rounded-2xl">
                  {isFormSubmitted ? (
                    <div className="text-center space-y-3">
                      <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-400 mx-auto">
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                      <div className="space-y-1 text-xs">
                        <p className="font-bold text-slate-200">Simulação registrada (Modo Demonstração)</p>
                        <p className="text-slate-400 leading-normal">
                          Este é um ambiente de demonstração: seus dados não foram transmitidos, integrados ou armazenados em nenhum sistema. Nenhuma equipe será contatada a partir deste formulário.
                        </p>
                      </div>
                      <button 
                        onClick={() => setIsFormSubmitted(false)}
                        className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-[10px] rounded-lg text-slate-200 border border-slate-700"
                      >
                        Mudar Plano Selecionado
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleApplyFounderProgram} className="space-y-3.5 text-xs font-sans">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Seu Nome / Contato</label>
                        <input 
                          type="text" 
                          value={interestedName}
                          onChange={(e) => setInterestedName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-next-purple-neon"
                          placeholder="Dr. Nome do Médico"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Seu Plano Selecionado</label>
                        <select 
                          value={selectedPlan}
                          onChange={(e) => setSelectedPlan(e.target.value as any)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-300 focus:outline-none focus:border-next-purple-neon"
                        >
                          <option value="assistant">Eliza Assistente — R$ 349/mês</option>
                          <option value="secretary">Eliza Secretária — R$ 499/mês</option>
                          <option value="manager">Eliza Gestora — R$ 699/mês</option>
                          <option value="ceo">Eliza CEO — R$ 999/mês</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Comentários do Pedido de Vaga</label>
                        <textarea 
                          value={comments}
                          onChange={(e) => setComments(e.target.value)}
                          rows={2}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-300 focus:outline-none focus:border-next-purple-neon"
                          placeholder="Tem algum pedido de customização?"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-next-purple-neon hover:bg-opacity-95 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-next-glow-purple transition-all"
                        style={{ minHeight: '44px' }}
                      >
                        <BadgeCheck className="w-4 h-4 text-white" />
                        <span>Confirmar Demonstração do Plano</span>
                      </button>
                    </form>
                  )}
                </div>

              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
