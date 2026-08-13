import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  Send, 
  Smartphone, 
  ShieldCheck, 
  HelpCircle, 
  Award, 
  FileText, 
  RefreshCw, 
  Sliders,
  Sparkles,
  Bot,
  Calendar,
  Users,
  HeartPulse,
  Briefcase,
  MessageSquare,
  ClipboardList,
  Terminal,
  Activity,
  Check
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';

// Define structures for our QA checklists
interface QAItem {
  id: string;
  testName: string;
  description: string;
  status: 'passed' | 'pending' | 'warning';
  notes?: string;
}

interface QACategory {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: QAItem[];
}

export default function NextQADashboard() {
  const { clinic, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  // Selected category in the QA viewer
  const [selectedCategory, setSelectedCategory] = useState<string>('home');
  
  // Simulated logs console
  const [simLogs, setSimLogs] = useState<string[]>([
    "Sandbox Inicializada - Central de Homologação Clinica ELIZA NEXT 2.0 ativa.",
    "Sandbox parcial: Agenda, Prontuário (Anamnese/Evolução/IA Clínica/Orçamento/Contratos/Receituários/Imagens/Financeiro), Financeiro, Planejamento Facial e o rascunho de WhatsApp gravam dados reais nesta clínica. As demais telas seguem somente leitura.",
    "Audit Trail habilitada para monitorar leituras e gravações reais desta clínica."
  ]);
  const [isRunningSelfTest, setIsRunningSelfTest] = useState(false);
  const [selfTestProgress, setSelfTestProgress] = useState(0);

  // User comments form state (Simulation only, doesn't write to DB)
  const [verdict, setVerdict] = useState<'approved' | 'ajusts' | 'rejected'>('approved');
  const [comments, setComments] = useState('');
  const [reviewerName, setReviewerName] = useState(profile?.name || '');
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Complete list of QA categories and test items for ELIZA NEXT 2.0
  const [categories, setCategories] = useState<QACategory[]>([
    {
      id: 'home',
      title: 'Home & Consciência',
      icon: <Bot className="w-4 h-4" />,
      items: [
        { id: 'h1', testName: 'Telemetria em Tempo Real', description: 'Leitura real de pacientes, agendamentos e financeiro desta clínica no Firestore.', status: 'pending' },
        { id: 'h2', testName: 'Chat Inteligente de IA', description: 'Chat com IA real (OpenAI com fallback Gemini), citando os dados reais lidos, com memória de conversa.', status: 'pending' },
        { id: 'h3', testName: 'Opportunity Deck Calculado', description: 'Os 4 cards (recall, confirmações pendentes, cancelamentos, contas vencidas) são calculados a partir de agenda e financeiro reais, sem números fixos.', status: 'pending' },
        { id: 'h4', testName: 'Boas-Vindas Dinâmicas', description: 'Saudação adaptada ao período do dia e nome real do profissional logado.', status: 'pending' }
      ]
    },
    {
      id: 'agenda',
      title: 'Agenda Inteligente',
      icon: <Calendar className="w-4 h-4" />,
      items: [
        { id: 'a1', testName: 'Visualização Diária/Semanal', description: 'Navegação real por dia e semana, com criação e mudança de status de agendamentos gravando de verdade no Firestore.', status: 'pending' },
        { id: 'a2', testName: 'Oportunidades Identificadas', description: 'Cancelamentos e possíveis faltas do dia detectados a partir dos agendamentos reais, sem nomes inventados.', status: 'pending' },
        { id: 'a3', testName: 'Filtros Rápidos de Status', description: 'Filtros por profissional, tipo e status derivados dos valores reais presentes na agenda.', status: 'pending' }
      ]
    },
    {
      id: 'patients',
      title: 'Ficha de Pacientes',
      icon: <Users className="w-4 h-4" />,
      items: [
        { id: 'p1', testName: 'Busca e CRUD Real', description: 'Busca instantânea e criação/edição/exclusão real de pacientes, com atalho para WhatsApp e integração com Agenda/Prontuário.', status: 'pending' },
        { id: 'p2', testName: 'Filtros de Status', description: 'Filtro por status real do paciente (ativo, suspenso, falta, revisão).', status: 'pending' },
        { id: 'p3', testName: 'Detecção de Inconsistências de Dados', description: 'Ainda não implementado: avisos automáticos para telefones inválidos ou cadastros incompletos.', status: 'pending' }
      ]
    },
    {
      id: 'prontuario',
      title: 'Prontuário Vivo',
      icon: <HeartPulse className="w-4 h-4" />,
      items: [
        { id: 'pr1', testName: 'Anamnese Real', description: 'Formulário de anamnese gravando de verdade, no mesmo schema usado pelo app legado.', status: 'pending' },
        { id: 'pr2', testName: 'Ditado de Voz Real', description: 'Ditado por voz real (Web Speech API) no relato de caso da IA Clínica, sem transcrição simulada.', status: 'pending' },
        { id: 'pr3', testName: 'Evolução Clínica Cronológica', description: 'Linha do tempo real de evoluções do paciente, gravando de verdade.', status: 'pending' },
        { id: 'pr4', testName: 'IA Clínica (Treatment Studio)', description: 'Diagnóstico e plano de tratamento gerados por IA real e multimodal (lê imagens anexadas), 100% editável, com histórico salvo.', status: 'pending' },
        { id: 'pr5', testName: 'Orçamento, Imagens e Financeiro do Paciente', description: 'Três abas com CRUD real integradas ao prontuário do paciente.', status: 'pending' },
        { id: 'pr6', testName: 'Contratos e TCLE', description: 'Geração de contrato a partir dos modelos da clínica e do orçamento aprovado, com fluxo rascunho → enviado → assinado (upload do escaneado) e impressão.', status: 'pending' },
        { id: 'pr7', testName: 'Receituários com IA', description: 'Geração de receituário com checagem real de interações/contraindicações pela IA, cruzando com a anamnese real do paciente.', status: 'pending' }
      ]
    },
    {
      id: 'financeiro',
      title: 'Financeiro',
      icon: <Briefcase className="w-4 h-4" />,
      items: [
        { id: 'f1', testName: 'KPIs Reais', description: 'Recebido hoje/mês, a receber, a pagar e contas vencidas calculados a partir dos lançamentos reais.', status: 'pending' },
        { id: 'f2', testName: 'Lançamentos (CRUD Real)', description: 'Criar, editar, marcar como recebido/pago e excluir lançamentos, gravando de verdade em financial_entries.', status: 'pending' },
        { id: 'f3', testName: 'Fechamento de Caixa', description: 'Conferência automática por forma de pagamento contra os lançamentos reais do dia, com registro real e impressão.', status: 'pending' },
        { id: 'f4', testName: 'Comissões Unificadas', description: 'Modelo único de comissão (configuração, lançamento, aprovação) substituindo os 4 sistemas soltos do legado; histórico antigo preservado só para consulta.', status: 'pending' },
        { id: 'f5', testName: 'IA Financeira', description: 'Diagnóstico automático ao abrir a tela, perguntas com IA real e memória, e leitura de comprovantes/recibos para lançar despesas automaticamente.', status: 'pending' }
      ]
    },
    {
      id: 'whatsapp',
      title: 'Comunicação',
      icon: <MessageSquare className="w-4 h-4" />,
      items: [
        { id: 'w1', testName: 'Pendências Reais', description: 'Lista de confirmações pendentes, cobranças em aberto e candidatos a recall calculada a partir de agenda e financeiro reais (não é histórico de conversa simulado).', status: 'pending' },
        { id: 'w2', testName: 'Rascunho com IA Real', description: 'Mensagem sugerida gerada pela IA real para cada pendência, editável antes do envio.', status: 'pending' },
        { id: 'w3', testName: 'Link wa.me Real', description: 'Abre o WhatsApp de verdade com o texto pronto no telefone real do paciente; o envio automatizado depende de uma integração de mensageria própria (Twilio/Meta Cloud API), ainda não contratada.', status: 'pending' }
      ]
    },
    {
      id: 'core',
      title: 'Assistente Central',
      icon: <Sparkles className="w-4 h-4" />,
      items: [
        { id: 'c1', testName: 'Contexto Real da Clínica', description: 'Lê pacientes, agenda de hoje e KPIs financeiros reais antes de cada resposta.', status: 'pending' },
        { id: 'c2', testName: 'Chat com IA Real e Memória', description: 'Perguntas livres e sugestões rápidas respondidas pela IA real, com memória das últimas trocas da conversa.', status: 'pending' }
      ]
    },
    {
      id: 'mobile',
      title: 'Ajuste Mobile / UX',
      icon: <Smartphone className="w-4 h-4" />,
      items: [
        { id: 'm1', testName: 'Menu Lateral Retrátil', description: 'Menu retrátil que colapsa em celulares para evitar desperdício de espaço vertical.', status: 'pending' },
        { id: 'm2', testName: 'Espaçamentos Harmonizados', description: 'Paddings e margens adaptativas para tablets e smartphones.', status: 'pending' },
        { id: 'm3', testName: 'Legibilidade de Tipografia', description: 'Ainda não passou por uma revisão dedicada de responsividade/mobile nesta rodada.', status: 'pending' }
      ]
    },
    {
      id: 'seguranca',
      title: 'Segurança & Auditoria',
      icon: <ShieldCheck className="w-4 h-4" />,
      items: [
        { id: 's1', testName: 'Sandbox Parcial com Escrita Controlada', description: 'Agenda, Prontuário (todas as abas), Financeiro, Planejamento Facial e os rascunhos de WhatsApp gravam dados reais nesta clínica, por decisão explícita; as demais telas seguem bloqueadas para escrita.', status: 'pending' },
        { id: 's2', testName: 'Rastro de Auditoria (Audit Trail)', description: 'Registro em tempo real de cada leitura e gravação real para controle administrativo e transparência.', status: 'pending' },
        { id: 's3', testName: 'Preservação da Base Legada', description: 'Isolamento completo garantido; nenhuma rota do app original foi alterada, e nenhuma escrita atinge o projeto de produção elisa-494703 neste ambiente de desenvolvimento.', status: 'pending' }
      ]
    }
  ]);

  // Toggle status of a specific test item
  const handleToggleItem = (categoryId: string, itemId: string) => {
    setCategories(prev => prev.map(cat => {
      if (cat.id !== categoryId) return cat;
      return {
        ...cat,
        items: cat.items.map(item => {
          if (item.id !== itemId) return item;
          const nextStatusMap: Record<'passed' | 'pending' | 'warning', 'passed' | 'pending' | 'warning'> = {
            'passed': 'warning',
            'warning': 'pending',
            'pending': 'passed'
          };
          const nextStatus = nextStatusMap[item.status];
          
          // Log simulated test change
          setSimLogs(logs => [
            `[QA] Teste '${item.testName}' alterado para status ${nextStatus.toUpperCase()} por ${reviewerName}.`,
            ...logs.slice(0, 15)
          ]);

          return { ...item, status: nextStatus };
        })
      };
    }));
  };

  // Run full automated clinic integrity test
  const runAutomatedDiagnostics = () => {
    if (isRunningSelfTest) return;
    setIsRunningSelfTest(true);
    setSelfTestProgress(0);
    setSimLogs(logs => ["Iniciando autodiagnóstico automatizado de segurança e integridade...", ...logs]);

    const steps = [
      { progress: 15, log: "[SIMULADO] Ilustrando varredura de rotas ativas... (nenhuma verificação real executada)" },
      { progress: 35, log: "[SIMULADO] Ilustrando checagem de assinaturas de escrita no Firestore... (nenhuma verificação real executada)" },
      { progress: 55, log: "[SIMULADO] Ilustrando validação de estrutura de leitura de pacientes e orçamentos... (nenhuma verificação real executada)" },
      { progress: 75, log: "[SIMULADO] Ilustrando canal de simulação do Eliza AI Core... (nenhuma verificação real executada)" },
      { progress: 100, log: "[FIM DA SIMULAÇÃO] Esta é uma animação ilustrativa, não um diagnóstico real. Use o checklist manual para registrar o que foi de fato conferido." }
    ];

    steps.forEach((step, index) => {
      setTimeout(() => {
        setSelfTestProgress(step.progress);
        setSimLogs(logs => [step.log, ...logs]);
        if (step.progress === 100) {
          setIsRunningSelfTest(false);
          addAuditLog({
            collection: 'qa_diagnostics',
            action: 'QUERY',
            status: 'SUCCESS',
            details: 'Simulação ilustrativa de varredura executada (nenhuma verificação real de conformidade ou integridade foi realizada).'
          });
        }
      }, (index + 1) * 700);
    });
  };

  // Calculate overall readiness percentage
  const totalTests = categories.reduce((sum, cat) => sum + cat.items.length, 0);
  const passedTests = categories.reduce((sum, cat) => sum + cat.items.filter(i => i.status === 'passed').length, 0);
  const readinessPercentage = Math.round((passedTests / totalTests) * 100);

  // Submit QA report (simulated)
  const handleSubmitReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comments.trim()) return;

    setIsSubmitted(true);
    setSimLogs(logs => [
      `[HOMOLOGAÇÃO] Relatório de QA enviado com veredicto: ${verdict.toUpperCase()}. Relator: ${reviewerName}.`,
      `[COMENTÁRIO] "${comments}"`,
      ...logs
    ]);

    addAuditLog({
      collection: 'qa_homologation',
      action: 'WRITE_BLOCKED',
      status: 'SUCCESS',
      details: `Homologação finalizada com veredicto: ${verdict.toUpperCase()}. Comentários: ${comments.slice(0, 100)}...`
    });
  };

  return (
    <div className="space-y-8 max-w-6xl font-sans text-slate-200">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 uppercase tracking-wider">
              Sprint 11
            </span>
            <span className="text-slate-600">•</span>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2 tracking-tight">
              <ClipboardList className="w-5 h-5 text-next-purple-neon" />
              <span>Demo Interna & QA Clínico</span>
            </h2>
          </div>
          <p className="text-slate-400 text-xs">
            Central de Homologação, revisão de integridade e auditoria de prontidão da ELIZA NEXT 2.0.
          </p>
        </div>

        {/* Readiness Meter */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 min-w-[240px]">
          <div className="relative flex items-center justify-center">
            <svg className="w-14 h-14 transform -rotate-90">
              <circle cx="28" cy="28" r="24" className="stroke-slate-800 fill-none" strokeWidth="4" />
              <circle 
                cx="28" 
                cy="28" 
                r="24" 
                className="stroke-emerald-400 fill-none transition-all duration-500" 
                strokeWidth="4" 
                strokeDasharray={150.7}
                strokeDashoffset={150.7 - (150.7 * readinessPercentage) / 100}
              />
            </svg>
            <span className="absolute text-xs font-bold font-mono text-emerald-400">{readinessPercentage}%</span>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Grau de Prontidão</p>
            <p className="text-sm font-extrabold text-slate-100 tracking-tight mt-0.5">Homologação Clínica</p>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-mono">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>{passedTests} de {totalTests} Testes Aprovados</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of QA Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Category List - Left Col */}
        <div className="lg:col-span-4 space-y-3">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">Telas e Aspectos Avaliados</p>
          <div className="space-y-1">
            {categories.map((cat) => {
              const passedCount = cat.items.filter(i => i.status === 'passed').length;
              const isAllPassed = passedCount === cat.items.length;
              
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full flex items-center justify-between p-3.5 rounded-xl transition-all border text-left ${
                    selectedCategory === cat.id 
                      ? 'bg-slate-800/80 text-slate-100 border-next-purple-neon/50 shadow-next-glow-purple' 
                      : 'bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border-slate-800/60'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <div className="flex items-center gap-3">
                    <span className={selectedCategory === cat.id ? 'text-next-purple-neon' : 'text-slate-500'}>
                      {cat.icon}
                    </span>
                    <span className="text-xs font-semibold">{cat.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono bg-slate-855 text-slate-400 px-1.5 py-0.5 rounded border border-slate-800">
                      {passedCount}/{cat.items.length}
                    </span>
                    {isAllPassed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Diagnostics trigger */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-xs font-bold text-slate-200">Simulação de Varredura (ilustrativa)</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Esta animação apenas ilustra o que uma varredura automática faria — não executa nenhuma verificação real de segurança ou dados. Use o checklist ao lado para marcar itens manualmente conferidos.
              </p>
            </div>
            
            {isRunningSelfTest ? (
              <div className="space-y-2">
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-next-purple-neon transition-all duration-300"
                    style={{ width: `${selfTestProgress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                  <span>Executando varreduras...</span>
                  <span>{selfTestProgress}%</span>
                </div>
              </div>
            ) : (
              <button
                onClick={runAutomatedDiagnostics}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] border border-slate-700/60 rounded-xl text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition-all"
                style={{ minHeight: '44px' }}
              >
                <Play className="w-3.5 h-3.5 text-next-purple-neon" />
                <span>Ver Simulação Ilustrativa</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected Category Test cases - Right Col */}
        <div className="lg:col-span-8 space-y-6">
          
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-next-purple-neon">
                  {categories.find(c => c.id === selectedCategory)?.icon}
                </span>
                <h3 className="font-bold text-sm text-slate-100 uppercase tracking-wide">
                  Testes Clínicos: {categories.find(c => c.id === selectedCategory)?.title}
                </h3>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Clique para alternar o status</span>
            </div>

            <div className="space-y-3">
              {categories.find(c => c.id === selectedCategory)?.items.map((item) => (
                <div 
                  key={item.id}
                  onClick={() => handleToggleItem(selectedCategory, item.id)}
                  className="group bg-slate-950/80 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-800 rounded-xl p-4 transition-all cursor-pointer flex items-start gap-4"
                >
                  {/* Status badge and checkbox */}
                  <div className="mt-0.5 flex-shrink-0">
                    {item.status === 'passed' && (
                      <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {item.status === 'warning' && (
                      <div className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                        <AlertTriangle className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {item.status === 'pending' && (
                      <div className="w-5 h-5 rounded-md bg-slate-850 border border-slate-700 flex items-center justify-center text-slate-500 group-hover:scale-110 transition-transform">
                        <div className="w-1.5 h-1.5 bg-slate-600 rounded-full" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 justify-between">
                      <p className="text-xs font-semibold text-slate-200 group-hover:text-slate-100 transition-colors">
                        {item.testName}
                      </p>
                      <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border uppercase ${
                        item.status === 'passed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        item.status === 'warning' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                        'bg-slate-800 text-slate-500 border-slate-700'
                      }`}>
                        {item.status === 'passed' ? 'Aprovado' :
                         item.status === 'warning' ? 'Revisar' : 'Pendente'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Diagnostics Real-time Audit Console */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800 pb-2">
              <span className="flex items-center gap-1.5 text-next-purple-light">
                <Terminal className="w-3.5 h-3.5 text-next-purple-neon animate-pulse" />
                <span>AUDIT TRAIL / SIMULATION CONSOLE</span>
              </span>
              <button 
                onClick={() => setSimLogs([`Terminal resetado por ${profile?.name || 'Profissional'}.`])}
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-all"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Limpar</span>
              </button>
            </div>
            
            <div className="font-mono text-[10.5px] leading-relaxed space-y-1.5 max-h-40 overflow-y-auto bg-slate-900/40 p-3.5 rounded-xl border border-slate-850/60">
              {simLogs.map((log, i) => (
                <div key={i} className="text-slate-400">
                  <span className="text-slate-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                  <span className={log.includes("[SUCCESS]") || log.includes("[OK]") ? "text-emerald-400" : log.includes("[AUDIT]") ? "text-slate-300" : log.includes("[QA]") ? "text-next-purple-light" : "text-slate-400"}>
                    {log}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Identified Quirks & Solved Bugs Panel */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-500" />
            <span>Relatório de Inconsistências & Correções de QA</span>
          </h3>
          <p className="text-[11px] text-slate-400">
            Lista de inconsistências visuais e comportamentais mapeadas na Homologação Clínica e sanadas nesta sprint.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Bugs category */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <span className="w-2 h-2 bg-red-400 rounded-full" />
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[10px]">Bugs Mapeados & Corrigidos (QA)</span>
            </div>
            
            <div className="space-y-2.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300">1. Desalinhamento do Menu Lateral Mobile</span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1 rounded">Resolvido</span>
                </div>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  O menu lateral ocupava muito espaço em telas menores. Criamos uma gaveta colapsável de navegação no layout mobile.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300">2. Estouro Visual do Gráfico Financeiro</span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1 rounded">Resolvido</span>
                </div>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Gráficos SVG de projeção saíam dos limites em iPads horizontais. Corrigido com viewport dinâmico e flexbox responsivo.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300">3. Termos Técnicos Duplicados / Inglês</span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1 rounded">Resolvido</span>
                </div>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Padronização de termos como "Audit Trail (Logs)", "Modo Leitura", "Status de Agendamento" para manter fluidez linguística clínica em português.
                </p>
              </div>
            </div>
          </div>

          {/* Improvements category */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <span className="w-2 h-2 bg-next-purple-neon rounded-full" />
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[10px]">Melhorias Recomendadas & Implementadas</span>
            </div>

            <div className="space-y-2.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300">1. Alertas de Segurança Evidentes</span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1 rounded">Resolvido</span>
                </div>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Adicionados badges chamativos de "Modo Leitura" nos cabeçalhos de todas as telas para evitar confusões de gravação de dados.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300">2. Feedback de Ditado do Prontuário</span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1 rounded">Resolvido</span>
                </div>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Melhoria nas microanimações de pulso durante a simulação de voz, proporcionando uma sensação tátil premium e interativa.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300">3. Auditoria de Atividades</span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1 rounded">Resolvido</span>
                </div>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Todas as simulações e transições geram automaticamente logs detalhados na Audit Trail, elevando o nível de controle administrativo.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Homologation sign-off Form */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
          <Award className="w-5 h-5 text-next-purple-neon" />
          <div>
            <h3 className="font-bold text-sm text-slate-100">Assinatura de Homologação & Prontidão Clínica</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Registe o veredicto clínico final da avaliação interna da ELIZA NEXT 2.0.</p>
          </div>
        </div>

        {isSubmitted ? (
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center space-y-3"
          >
            <div className="w-10 h-10 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center text-emerald-400 mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-slate-100 text-sm">Avaliação Registrada (nesta sessão)</h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-normal">
                Muito obrigado por concluir o QA Clínico. O veredicto e os logs foram adicionados apenas ao painel de auditoria local desta sessão (memória do navegador) — eles não são salvos e serão perdidos ao recarregar a página.
              </p>
            </div>
            <button 
              onClick={() => setIsSubmitted(false)}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 rounded-lg border border-slate-700 transition-colors"
            >
              Avaliar Novamente
            </button>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmitReport} className="space-y-4 text-xs font-sans">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Avaliador Clínico</label>
                <input 
                  type="text" 
                  value={reviewerName} 
                  onChange={(e) => setReviewerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-250 focus:outline-none focus:border-next-purple-neon transition-colors" 
                  placeholder="Nome do Profissional"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Veredicto Final</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setVerdict('approved')}
                    className={`py-3 px-2 rounded-xl border font-semibold flex flex-col items-center justify-center gap-1 transition-all ${
                      verdict === 'approved' 
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold' 
                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-350'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-[9px]">Aprovada</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setVerdict('ajusts')}
                    className={`py-3 px-2 rounded-xl border font-semibold flex flex-col items-center justify-center gap-1 transition-all ${
                      verdict === 'ajusts' 
                        ? 'bg-amber-500/10 border-amber-500 text-amber-400 font-bold' 
                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-350'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-[9px]">Pequenos Ajustes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setVerdict('rejected')}
                    className={`py-3 px-2 rounded-xl border font-semibold flex flex-col items-center justify-center gap-1 transition-all ${
                      verdict === 'rejected' 
                        ? 'bg-red-500/10 border-red-500 text-red-400 font-bold' 
                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-350'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-[9px]">Pendente</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Comentários e Parecer da Homologação</label>
              <textarea 
                value={comments} 
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-250 focus:outline-none focus:border-next-purple-neon transition-colors" 
                placeholder="Descreva detalhes observados nos testes clínicos de usabilidade, consistência, mobile e segurança..."
                required
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-next-purple-neon hover:bg-opacity-90 active:scale-[0.98] rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-next-glow-purple transition-all"
                style={{ minHeight: '44px' }}
              >
                <Send className="w-4 h-4" />
                <span>Assinar Homologação</span>
              </button>
            </div>
          </form>
        )}
      </div>

    </div>
  );
}
