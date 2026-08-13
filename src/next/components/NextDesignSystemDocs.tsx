import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Palette, 
  Type, 
  Grid, 
  Layers, 
  Sparkles, 
  Copy, 
  Check, 
  ExternalLink,
  Zap, 
  Info,
  Shield,
  Search,
  CheckCircle,
  AlertTriangle,
  Play,
  RotateCcw
} from 'lucide-react';

export default function NextDesignSystemDocs() {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [inputText1, setInputText1] = useState('');
  const [inputText2, setInputText2] = useState('');
  const [animationTrigger, setAnimationTrigger] = useState(0);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  return (
    <div className="space-y-12 max-w-6xl font-sans pb-16">
      
      {/* Toast Confirmation */}
      {copiedText && (
        <div className="fixed bottom-6 right-6 z-50 bg-next-bg-card border-2 border-next-purple-neon/40 text-slate-100 px-4 py-3 rounded-next-xl shadow-next-glow-purple flex items-center gap-2.5 max-w-md animate-bounce">
          <Check className="w-5 h-5 text-next-green-success" />
          <span className="text-xs font-mono font-medium">Copiado: <strong className="text-next-purple-light">{copiedText}</strong></span>
        </div>
      )}

      {/* Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-next-glass">
        <div className="space-y-2 z-10">
          <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/25 px-3 py-1 rounded-full text-next-purple-light text-xs font-mono">
            <Sparkles className="w-3.5 h-3.5 text-next-purple-neon" />
            <span>Sprint 2 — Design System Oficial</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-100 tracking-tight font-sans">
            Guia de Estilo & Componentes Base
          </h2>
          <p className="text-slate-400 text-sm md:text-base max-w-2xl leading-relaxed">
            Um ecossistema visual proprietário, calibrado para transmitir sofisticação, inteligência artificial, 
            e exclusividade. Inspirado nos padrões estéticos de referências mundiais como Apple, Stripe e Linear.
          </p>
        </div>
        
        {/* Abstract design widget */}
        <div className="relative w-24 h-24 bg-next-purple-neon/5 border border-next-border rounded-next-2xl flex items-center justify-center text-next-purple-light overflow-hidden shadow-inner flex-shrink-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.15)_0,transparent_100%)]" />
          <Palette className="w-10 h-10 text-next-purple-neon animate-pulse" />
        </div>
      </div>

      {/* Grid Layout of Design Tokens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COL 1: COLORS PALETTE */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2.5 border-b border-next-border pb-3">
            <Palette className="w-5 h-5 text-next-purple-neon" />
            <h3 className="text-lg font-bold text-slate-100">1. Tokens de Cores & Paleta Premium</h3>
          </div>
          
          <p className="text-slate-400 text-xs">
            Clique em qualquer cor para copiar o respectivo token de classe do Tailwind CSS.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Dark Bases */}
            <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-3">
              <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-wider block">Superfícies Escuras</span>
              
              <div className="space-y-2">
                {/* Bg Deep */}
                <button 
                  onClick={() => copyToClipboard('bg-next-bg-deep', 'Deep Carbon')}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-900/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-md bg-next-bg-deep border border-next-border flex-shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-200 block group-hover:text-next-purple-light">Deep Carbon</span>
                      <span className="text-[10px] text-slate-500 font-mono">#050507</span>
                    </div>
                  </div>
                  <Copy className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                {/* Bg Card */}
                <button 
                  onClick={() => copyToClipboard('bg-next-bg-card', 'Card Surface')}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-900/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-md bg-next-bg-card border border-next-border flex-shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-200 block group-hover:text-next-purple-light">Card Surface</span>
                      <span className="text-[10px] text-slate-500 font-mono">#0c0c10</span>
                    </div>
                  </div>
                  <Copy className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                {/* Border Subtle */}
                <button 
                  onClick={() => copyToClipboard('border-next-border', 'Border Subtle')}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-900/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-md bg-next-bg-card border border-next-border flex-shrink-0 flex items-center justify-center text-slate-600 font-mono text-[10px]">1px</span>
                    <div>
                      <span className="text-xs font-bold text-slate-200 block group-hover:text-next-purple-light">Border Subtle</span>
                      <span className="text-[10px] text-slate-500 font-mono">#1d1d26</span>
                    </div>
                  </div>
                  <Copy className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            </div>

            {/* Accent Colors */}
            <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-3">
              <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-wider block">Identidade Neon & IA</span>
              
              <div className="space-y-2">
                {/* Purple Neon */}
                <button 
                  onClick={() => copyToClipboard('bg-next-purple-neon', 'Purple Neon')}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-900/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-md bg-next-purple-neon flex-shrink-0 shadow-next-glow-purple" />
                    <div>
                      <span className="text-xs font-bold text-slate-200 block group-hover:text-next-purple-light">Purple Neon (IA)</span>
                      <span className="text-[10px] text-slate-500 font-mono">#a855f7</span>
                    </div>
                  </div>
                  <Copy className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                {/* IA Blue */}
                <button 
                  onClick={() => copyToClipboard('bg-next-ia-blue', 'IA Insight Blue')}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-900/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-md bg-next-ia-blue flex-shrink-0 shadow-next-glow-blue" />
                    <div>
                      <span className="text-xs font-bold text-slate-200 block group-hover:text-next-purple-light">Insight Blue</span>
                      <span className="text-[10px] text-slate-500 font-mono">#3b82f6</span>
                    </div>
                  </div>
                  <Copy className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                {/* Insight Orange */}
                <button 
                  onClick={() => copyToClipboard('bg-next-orange-insight', 'Insight Orange')}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-900/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-md bg-next-orange-insight flex-shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-200 block group-hover:text-next-purple-light">Insight Orange</span>
                      <span className="text-[10px] text-slate-500 font-mono">#f97316</span>
                    </div>
                  </div>
                  <Copy className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* COL 2: TYPOGRAPHY & RADIUS */}
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 border-b border-next-border pb-3">
            <Type className="w-5 h-5 text-next-purple-neon" />
            <h3 className="text-lg font-bold text-slate-100">2. Tipografia & Layout</h3>
          </div>

          <div className="bg-next-bg-card border border-next-border rounded-next-xl p-5 space-y-4">
            <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-wider block">Família de Fontes</span>
            
            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-mono text-slate-500 block mb-1">Display Headings</span>
                <p className="text-lg font-extrabold text-slate-100 tracking-tight font-sans">
                  Eliza Display Bold
                </p>
                <span className="text-[10px] text-slate-500 font-mono">font-sans font-extrabold tracking-tight</span>
              </div>

              <div className="pt-2 border-t border-slate-900">
                <span className="text-[10px] font-mono text-slate-500 block mb-1">Body Text</span>
                <p className="text-xs text-slate-400 leading-relaxed font-sans">
                  A nossa IA foi desenhada com algoritmos clínicos dedicados e modernos.
                </p>
                <span className="text-[10px] text-slate-500 font-mono">font-sans text-xs text-slate-400 leading-relaxed</span>
              </div>

              <div className="pt-2 border-t border-slate-900">
                <span className="text-[10px] font-mono text-slate-500 block mb-1">Monospaced Metadata</span>
                <p className="text-[11px] font-mono text-next-purple-light">
                  NEXT_ENV_SYSTEM_ACTIVE_TRUE
                </p>
                <span className="text-[10px] text-slate-500 font-mono">font-mono text-[11px] text-next-purple-light</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* SECTION 3: INTERACTIVE BASE COMPONENTS SHOWCASE */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-next-border pb-3">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-next-purple-neon" />
            <h3 className="text-lg font-bold text-slate-100">3. Componentes Base Interativos & Estados</h3>
          </div>
          <span className="text-xs font-mono text-slate-500">STABLE_COMPONENTS</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* BUTTONS VARIATIONS */}
          <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 space-y-6 shadow-next-glass">
            <div>
              <h4 className="text-sm font-bold text-slate-200">Botões Reutilizáveis</h4>
              <p className="text-xs text-slate-500 mt-1">Componentes estilizados de alta usabilidade com feedback tátil de clique e hover.</p>
            </div>

            <div className="space-y-4">
              
              {/* Primary AI Glow */}
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-slate-500 block">Destaque IA (Glow Purple)</span>
                <div className="flex flex-wrap items-center gap-3">
                  <button 
                    className="relative overflow-hidden inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-next-purple-neon hover:bg-next-purple-neon/90 text-white font-semibold text-xs rounded-next-xl transition-all shadow-next-glow-purple active:scale-[0.98] cursor-pointer"
                    style={{ minHeight: '44px' }}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Iniciar Eliza Next</span>
                  </button>
                  <button 
                    disabled
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-next-purple-neon/20 text-white/40 font-semibold text-xs rounded-next-xl cursor-not-allowed opacity-50"
                    style={{ minHeight: '44px' }}
                  >
                    <span>Bloqueado</span>
                  </button>
                </div>
              </div>

              {/* Secondary/Glass Theme */}
              <div className="space-y-2 pt-2 border-t border-slate-900">
                <span className="text-[10px] font-mono text-slate-500 block">Secundário Glass</span>
                <div className="flex flex-wrap items-center gap-3">
                  <button 
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 border border-next-border hover:border-next-border-glow hover:bg-next-bg-card-hover text-slate-200 hover:text-white text-xs font-semibold rounded-next-xl transition-all active:scale-[0.98]"
                    style={{ minHeight: '44px' }}
                  >
                    <span>Configurações</span>
                  </button>
                  
                  <button 
                    className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-900 border border-next-border hover:border-next-border-glow hover:bg-next-bg-card-hover text-slate-300 rounded-next-xl transition-all"
                    style={{ minHeight: '44px', minWidth: '44px' }}
                  >
                    <Zap className="w-4 h-4 text-next-ia-blue" />
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* BADGES & METRIC CAPSULES */}
          <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 space-y-6 shadow-next-glass">
            <div>
              <h4 className="text-sm font-bold text-slate-200">Badges & Sinalizações</h4>
              <p className="text-xs text-slate-500 mt-1">Uso expressivo de cores sutis e bordas refinadas para status, inteligência e telemetria.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              
              {/* IA Badge */}
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-slate-500 block">AI STATUS</span>
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-md text-next-purple-light text-[10px] font-bold font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-next-purple-neon animate-pulse" />
                    ELIZA IA ACTIVE
                  </span>
                </div>
              </div>

              {/* Success Badge */}
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-slate-500 block">SUCCESS / ATIVO</span>
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-next-green-success/10 border border-next-green-success/20 rounded-md text-next-green-success text-[10px] font-bold font-mono">
                    <CheckCircle className="w-3 h-3" />
                    CONECTADO
                  </span>
                </div>
              </div>

              {/* Alert / Warning Badge */}
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-slate-500 block">ALERTA CRÍTICO</span>
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-next-red-alert/10 border border-next-red-alert/20 rounded-md text-next-red-alert text-[10px] font-bold font-mono">
                    <Shield className="w-3 h-3 text-next-red-alert" />
                    GRAVAÇÃO BLOQUEADA
                  </span>
                </div>
              </div>

              {/* Insight Orange Badge */}
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-slate-500 block">INSIGHTS / TELEMETRIA</span>
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-next-orange-insight/10 border border-next-orange-insight/20 rounded-md text-next-orange-insight text-[10px] font-bold font-mono">
                    <AlertTriangle className="w-3 h-3" />
                    SANDBOX ACT
                  </span>
                </div>
              </div>

            </div>
          </div>

          {/* INPUT FIELDS WITH ACTIVE FOCUS GLOWS */}
          <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 space-y-6 shadow-next-glass md:col-span-2">
            <div>
              <h4 className="text-sm font-bold text-slate-200">Campos de Entrada (Inputs com Focus Glow)</h4>
              <p className="text-xs text-slate-500 mt-1">Interação fluida com feedback visual de foco, preservando contraste máximo.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Regular Input with Focus Glow */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-slate-500 block">Input Padrão com Foco Ativo (Digite para testar)</label>
                <input
                  type="text"
                  placeholder="Nome do Paciente..."
                  value={inputText1}
                  onChange={(e) => setInputText1(e.target.value)}
                  className="w-full bg-slate-900/60 border border-next-border hover:border-next-border-glow rounded-next-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-next-purple-neon focus:shadow-next-glow-purple transition-all"
                  style={{ minHeight: '44px' }}
                />
              </div>

              {/* Search with Left Icon & Focus Glow */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-slate-500 block">Input de Busca com Foco Ativo (Digite para testar)</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Search className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    placeholder="Buscar registros..."
                    value={inputText2}
                    onChange={(e) => setInputText2(e.target.value)}
                    className="w-full bg-slate-900/60 border border-next-border hover:border-next-border-glow rounded-next-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-next-ia-blue focus:shadow-next-glow-blue transition-all"
                    style={{ minHeight: '44px' }}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* GLASS CARDS WITH AMBIENT HIGHLIGHTS */}
          <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 space-y-6 shadow-next-glass md:col-span-2">
            <div>
              <h4 className="text-sm font-bold text-slate-200">Glow Hover Cards (Cards Reutilizáveis)</h4>
              <p className="text-xs text-slate-500 mt-1">Superfícies de dados que reagem ao mouse com variações sutis de gradiente e borda brilhante.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              {/* Card Purple Glow */}
              <div className="group relative bg-slate-900 border border-next-border hover:border-next-purple-neon/50 rounded-next-xl p-5 transition-all duration-300 hover:shadow-next-glow-purple">
                <span className="text-[9px] font-mono text-slate-500 block">CARD_AI_GLOW</span>
                <h5 className="font-bold text-slate-200 text-sm mt-2 group-hover:text-next-purple-light transition-colors">Cognição Inteligente</h5>
                <p className="text-slate-400 text-[11px] mt-1.5 leading-relaxed">Sinais vitais e agendamento otimizado com modelos rápidos.</p>
              </div>

              {/* Card Blue Glow */}
              <div className="group relative bg-slate-900 border border-next-border hover:border-next-ia-blue/50 rounded-next-xl p-5 transition-all duration-300 hover:shadow-next-glow-blue">
                <span className="text-[9px] font-mono text-slate-500 block">CARD_BLUE_GLOW</span>
                <h5 className="font-bold text-slate-200 text-sm mt-2 group-hover:text-next-ia-blue-light transition-colors">Insights Ativos</h5>
                <p className="text-slate-400 text-[11px] mt-1.5 leading-relaxed">Alertas de recall e anamnese inteligente gerados na nuvem.</p>
              </div>

              {/* Card Standard Clean */}
              <div className="group relative bg-slate-900 border border-next-border hover:bg-next-bg-card-hover rounded-next-xl p-5 transition-all duration-300">
                <span className="text-[9px] font-mono text-slate-500 block">CARD_STANDARD</span>
                <h5 className="font-bold text-slate-200 text-sm mt-2 transition-colors">Metadados e Logs</h5>
                <p className="text-slate-400 text-[11px] mt-1.5 leading-relaxed">Auditoria integral com zero modificação e total conformidade.</p>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* SECTION 4: MICRO-ANIMATIONS SIMULATOR */}
      <div className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 space-y-6 shadow-next-glass">
        <div>
          <h4 className="text-sm font-bold text-slate-200">Microanimações e Triggers Fluidos</h4>
          <p className="text-xs text-slate-500 mt-1">Simule transições com controle de físicas baseadas em molas (spring physics) que dão o aspecto "vivo" e ágil ao aplicativo.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-6 justify-between bg-slate-950 p-6 rounded-next-xl border border-next-border">
          <div className="space-y-1.5 text-center sm:text-left">
            <span className="text-xs font-mono text-next-purple-light">ESTADO: INÉRCIA ATIVA</span>
            <p className="text-slate-400 text-xs max-w-sm">Dê um play para disparar a física de mola do widget interativo do Design System.</p>
          </div>

          <div className="flex items-center gap-4">
            <motion.div
              key={animationTrigger}
              initial={{ scale: 0.8, rotate: -15, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12 }}
              className="w-16 h-16 bg-gradient-to-tr from-next-purple-neon to-next-ia-blue rounded-next-xl flex items-center justify-center text-white font-bold text-lg shadow-next-glow-purple"
            >
              🚀
            </motion.div>

            <button
              onClick={() => setAnimationTrigger(prev => prev + 1)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-next-border hover:bg-next-bg-card-hover text-slate-200 rounded-next-xl text-xs font-semibold transition-all"
              style={{ minHeight: '44px' }}
            >
              <Play className="w-4 h-4 text-next-purple-neon" />
              <span>Disparar Mola</span>
            </button>
          </div>
        </div>
      </div>

      {/* DOCUMENTAÇÃO RESUMIDA DO DESIGN SYSTEM */}
      <div className="bg-slate-900/40 border border-next-border rounded-next-2xl p-6 space-y-4">
        <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Info className="w-4 h-4 text-next-ia-blue" />
          <span>Guia Rápido de Desenvolvimento</span>
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Para garantir consistência absoluta na criação de novas interfaces na ELIZA NEXT 2.0, utilize as seguintes classes utilitárias padronizadas e mapeadas em nosso Tailwind v4:
        </p>

        <div className="bg-slate-950 p-4 rounded-next-xl border border-next-border overflow-x-auto">
          <pre className="text-[10.5px] font-mono text-slate-300 space-y-1">
            {`// Classes Recomendadas para a ELIZA NEXT 2.0
- Superfície Principal:  "bg-next-bg-deep text-slate-100"
- Cartões com Efeito Glass: "bg-next-bg-card border border-next-border rounded-next-xl shadow-next-glass"
- Destaque Roxo Neon:     "text-next-purple-neon shadow-next-glow-purple"
- Botão Primário Glow:     "bg-next-purple-neon hover:bg-next-purple-neon/90 shadow-next-glow-purple rounded-next-xl active:scale-[0.98]"
- Input Premium:          "bg-slate-900/60 border border-next-border focus:border-next-purple-neon focus:shadow-next-glow-purple rounded-next-xl px-4 py-2.5 transition-all"`}
          </pre>
        </div>
      </div>

    </div>
  );
}
