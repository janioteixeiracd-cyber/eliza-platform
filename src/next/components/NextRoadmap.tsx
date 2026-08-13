import React from 'react';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  Circle, 
  Sparkles, 
  Layers, 
  ShieldCheck, 
  Database,
  Eye,
  GitBranch,
  Palette,
  Zap,
  ClipboardList
} from 'lucide-react';

export default function NextRoadmap() {
  return (
    <div className="space-y-8 max-w-5xl font-sans">
      
      {/* Roadmap Intro Banner */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-next-purple-neon animate-pulse" />
          <span>Sprints & Cronograma de Engenharia</span>
        </h2>
        <p className="text-slate-400 text-xs">
          Linha do tempo oficial e modular da evolução da ELIZA NEXT 2.0.
        </p>
      </div>

      <div className="relative border-l border-next-border ml-4 pl-8 space-y-12">
        
        {/* SPRINT 1: ARCHITECTURE & ISOLATION */}
        <div className="relative">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-green-success rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-950/50">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-next-green-success/10 text-next-green-success px-2 py-0.5 rounded border border-next-green-success/20">
                SPRINT 1
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-next-green-success">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Arquitetura & Segurança</span>
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight">Fundações & Isolamento Seguro</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Provisionamento da infraestrutura NEXT 2.0 de forma 100% isolada. Criação da rota `/next/*` 
              e do proxy de segurança `next-db` que restringe gravações e estabelece auditoria em tempo real, 
              mantendo a aplicação legada intacta.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-2">
              <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <GitBranch className="w-4 h-4 text-next-green-success" />
                  <span>Isolamento de Rota</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Roteamento autônomo. O aplicativo legado e o NEXT coexistem sem nenhuma colisão de caminhos.
                </p>
              </div>

              <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <Eye className="w-4 h-4 text-next-green-success" />
                  <span>Modo Leitura Confiável</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Restrição ativa contra gravações acidentais ou simulações que alterem dados clínicos reais.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* SPRINT 2: DESIGN SYSTEM ELIZA NEXT 2.0 */}
        <div className="relative">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-purple-neon rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-next-purple-neon/10 text-next-purple-light px-2 py-0.5 rounded border border-next-purple-neon/20">
                SPRINT 2 A 5
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-next-purple-light">Concluídas</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Identidade, Relacionamento & Cards de Pessoas</span>
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight text-next-purple-light">Design System & Relacionamento</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Desenvolvimento de toda a identidade visual Dark Premium, busca Spotlight/Raycast, cards de relacionamento humanizados, 
              feed timeline e rascunhos automatizados para pacientes inativos ou em tratamento ativo.
            </p>
          </div>
        </div>

        {/* SPRINT 6: CONVERSATIONAL MEDICAL RECORDS */}
        <div className="relative">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-purple-neon rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-next-purple-neon/10 text-next-purple-light px-2 py-0.5 rounded border border-next-purple-neon/20">
                SPRINT 6
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-next-purple-light">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Prontuário Conversacional & Anamnese Inteligente</span>
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight text-next-purple-light">Prontuário Conversacional & Anamnese</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Nova experiência de Prontuário Inteligente estilo Notion Premium. Reúne em um único documento vivo o resumo cognitivo da Eliza, 
              fatores de risco periodontais mapeados na anamnese, plano de tratamento evolutivo, linha do tempo detalhada e um simulador de 
              ditado de voz/texto livre com estruturação automática por IA.
            </p>
          </div>
        </div>

        {/* SPRINT 7: FINANCIAL INTELLIGENCE */}
        <div className="relative">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-purple-neon rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-next-purple-neon/10 text-next-purple-light px-2 py-0.5 rounded border border-next-purple-neon/20">
                SPRINT 7
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-next-purple-light">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Financeiro Inteligente / Clínica como Negócio</span>
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight text-next-purple-light">Financeiro Inteligente / Clínica como Negócio</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Desenvolvimento da nova interface financeira focada em tomadas de decisão estratégica. Inclui o faturamento de "Hoje no Caixa", 
              Stripe-style metrics para o faturamento do mês, previsão inteligente de crescimento (IA) baseada em orçamentos em mesa, 
              alertas preditivos de sazonalidade e quedas, pipeline de fechamento de tratamentos e um estado vazio sofisticado para filtros não explorados.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-2">
              <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <Palette className="w-4 h-4 text-next-purple-neon" />
                  <span>Métricas de Alta Costura</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Indicadores de crescimento integrados com mini-gráficos SVG responsivos e área sombreada com gradiente de luz neon.
                </p>
              </div>

              <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <Zap className="w-4 h-4 text-next-purple-neon" />
                  <span>Abordagem de Fechamento</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Elaboração dinâmica de rascunhos financeiros humanizados pela Eliza para simplificar a negociação de orçamentos em mesa.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* SPRINT 8: WHATSAPP & COMUNICAÇÃO INTELIGENTE */}
        <div className="relative font-sans">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-purple-neon rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                SPRINT 8
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-emerald-400">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: WhatsApp & Comunicação Inteligente</span>
            </div>

            <h3 className="text-lg font-bold text-slate-200 tracking-tight">WhatsApp & Comunicação Inteligente</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Mapeamento centralizado de conversas com pacientes, categorização de status de relacionamento (Aguardando Resposta, Confirmações Pendentes e Reações de Recall), templates gerados pela inteligência da Eliza baseados no estágio clínico e simulação segura com rastro de auditoria.
            </p>
          </div>
        </div>

        {/* SPRINT 9: ELIZA AI CORE / ASSISTENTE CENTRAL */}
        <div className="relative font-sans">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-purple-neon rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-next-purple-neon/10 text-next-purple-light px-2 py-0.5 rounded border border-next-purple-neon/20">
                SPRINT 9
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-emerald-400">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Eliza AI Core / Assistente Central</span>
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight text-next-purple-light">Eliza AI Core / Assistente Central</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Criação da experiência de inteligência central da ELIZA NEXT, correlacionando insights integrados de todos os canais: Home, Agenda, Pacientes, Prontuário, Financeiro e WhatsApp em blocos estruturados inteligentes de tomada de decisão.
            </p>
          </div>
        </div>

        {/* SPRINT 10: POLIMENTO FINAL / EXPERIENCE REVIEW */}
        <div className="relative font-sans">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                SPRINT 10
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-emerald-400">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Polimento Final & Experience Review</span>
            </div>

            <h3 className="text-lg font-bold text-slate-200 tracking-tight">Polimento Final & Experience Review</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Revisão completa da experiência de uso do ELIZA NEXT 2.0. Refinamento de espaçamentos, consistência visual, adequação linguística (português premium), novas melhorias mobile responsivas e segurança integrada com auditoria de integridade.
            </p>

            {/* Interactive Polishing Metrics & Auditing */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <Palette className="w-4 h-4 text-next-purple-neon" />
                  <span>Checklist de Refinamento Visual</span>
                </div>
                <ul className="text-[11px] text-slate-400 space-y-1.5 font-sans leading-normal">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Navegação Mobile: Menu colapsável para melhor legibilidade</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Espaçamentos Harmonizados: Densidade ideal para tablets/celulares</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Linguagem Premium: Correção de termos técnicos e fluidez clínica</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Microanimações Suaves: Transições e feedbacks táteis refinados</span>
                  </li>
                </ul>
              </div>

              <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Checklist de Segurança (Modo Leitura)</span>
                </div>
                <ul className="text-[11px] text-slate-400 space-y-1.5 font-sans leading-normal">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Banco de Dados Intacto: Sem risco de sobrescritas</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Bloqueio Real Ativo: Operações em modo simulado seguro</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Modo de Teste de Comunicação: WhatsApp simula com rastro</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Prontuário e Finanças: Simulados com auditoria em tempo real</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* SPRINT 11: DEMO INTERNA & QA CLÍNICO */}
        <div className="relative font-sans">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                SPRINT 11
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-emerald-400">Concluída</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Demo Interna & Homologação Clínica (QA)</span>
            </div>

            <h3 className="text-lg font-bold text-slate-200 tracking-tight">Demo Interna & QA Clínico (Homologação)</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Fase de simulação clínica em ambiente sandbox fechado. Teste exaustivo de usabilidade, responsividade, legibilidade e consistência linguística das 9 telas do ecossistema ELIZA NEXT 2.0 sem execução de ações reais ou impactos na base de produção.
            </p>

            <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                <ClipboardList className="w-4 h-4 text-next-purple-neon" />
                <span>Objetivos e Entregáveis da Homologação</span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-slate-400 font-sans leading-normal">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  <span>Checklist de QA por tela: Homologação concluída</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  <span>Autoteste de isolamento ativado e auditado</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* SPRINT 12: DEMO COMERCIAL / STORYTELLING (ACTIVE) */}
        <div className="relative font-sans">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-next-purple-neon rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-next-purple-neon/10 text-next-purple-light px-2 py-0.5 rounded border border-next-purple-neon/20">
                SPRINT 12
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-next-purple-light">Ativa (Etapa Atual)</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Demo Comercial & Storytelling</span>
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight text-next-purple-light">Apresentação Comercial & Storytelling de Valor</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Preparação de uma nova narrativa comercial posicionando a Eliza como uma colaboradora digital do consultório e não apenas um CRM estático. Apresentação interativa de planos, calculadora de Retorno de Investimento (ROI) e o programa exclusivo de 150 Clínicas Fundadoras.
            </p>

            <div className="bg-next-bg-card border border-next-border rounded-next-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                <Sparkles className="w-4 h-4 text-next-purple-neon" />
                <span>Entregáveis da Etapa Comercial</span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-slate-400 font-sans leading-normal">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  <span>Pitch Deck interativo de 5 slides estruturados</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  <span>Simulador interativo de faturamento e ROI recuperado</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  <span>Apresentação dos Planos (Assistente, Secretária, Gestora e CEO)</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" />
                  <span>Formulário de Candidatura para Clínicas Fundadoras</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* FUTURE ROADMAP - SPRINT 13 */}
        <div className="relative font-sans">
          {/* Timeline Node */}
          <div className="absolute -left-[41px] top-0.5 bg-slate-950 p-1">
            <div className="w-5 h-5 bg-slate-800 rounded-full flex items-center justify-center border-2 border-slate-750 text-slate-500">
              <div className="w-2 h-2 bg-slate-600 rounded-full" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700/30">
                FUTURO (SPRINT 13)
              </span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs font-semibold text-next-ia-blue">Planejamento</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400">Foco: Telemedicina & Suporte Clínico Estendido</span>
            </div>

            <h3 className="text-lg font-bold text-slate-300 tracking-tight">Telemedicina & Suporte Pós-Consulta</h3>
            <p className="text-slate-400 text-sm max-w-3xl leading-relaxed">
              Mecanismos para prover suporte clínico continuado, agendamento de teleconsultas automatizadas de acompanhamento pós-cirúrgico e monitoramento remoto de evolução de tratamentos pós-venda.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
}
