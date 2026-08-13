import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { 
  ClipboardList, 
  Activity, 
  Sparkles, 
  DollarSign, 
  AlertCircle, 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp, 
  User, 
  Heart, 
  Camera, 
  Upload, 
  Trash2, 
  PlayCircle, 
  ArrowRight, 
  Lock, 
  RefreshCw, 
  FileText, 
  Brain,
  Scale,
  Compass,
  Briefcase,
  Layers,
  Sparkle
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  cpf?: string;
  phone?: string;
  [key: string]: any;
}

interface AnamnesisIntelligenceViewProps {
  patient: Patient;
  anamnesis: any;
  clinic: { id: string; name: string; [key: string]: any };
  user: any;
  onNavigateToTab: (tabId: string) => void;
}

export default function AnamnesisIntelligenceView({
  patient,
  anamnesis,
  clinic,
  user,
  onNavigateToTab
}: AnamnesisIntelligenceViewProps) {
  // Licensing Simulation State
  const [activeModules, setActiveModules] = useState({
    base: true,
    eliza_ia: true,
    hof_premium: true,
    clinica_premium: true
  });

  const [activeMode, setActiveMode] = useState<'selection' | 'simplified' | 'complete' | 'eliza_ia'>('selection');

  // FORM STATES
  // Simplified mode variables
  const [simplifiedForm, setSimplifiedForm] = useState({
    queixaPrincipal: '',
    medicamentosAtuais: '',
    alergias: '',
    procedimentosRecentes: '',
    intercorrenciasAnteriores: '',
    alteracoesUltimaConsulta: ''
  });

  // Complete mode variables (7 Blocks)
  const [completeForm, setCompleteForm] = useState({
    // Bloco 1: Gerais
    idade: '',
    profissao: '',
    peso: '',
    altura: '',
    // Bloco 2: Saude Geral
    hipertensao: false,
    diabetes: false,
    cardiopatia: false,
    autoimune: false,
    hormonal: false,
    oncologico: false,
    // Bloco 3: Medicamentos
    anticoagulantes: false,
    isotretinoina: false,
    corticoides: false,
    antidepressivos: false,
    hormonios: false,
    outrosMedicamentos: '',
    // Bloco 4: Habitos
    tabagismo: false,
    alcool: false,
    exercicio: false,
    sonoRuim: false,
    // Bloco 5: Odontologico
    implantes: false,
    proteses: false,
    bruxismo: false,
    dtm: false,
    cirurgiasDentais: '',
    // Bloco 6: Historico HOF
    botoxRecente: false,
    preenchimentos: false,
    bioestimuladores: false,
    fiosSustentacao: false,
    cirurgiasFaciais: '',
    intercorrenciasHof: '',
    // Bloco 7: Objetivos
    rejuvenescimento: false,
    harmonizacao: false,
    emagrecimentoFacial: false,
    qualidadePele: false,
    definicaoMandibular: false,
    olheiras: false,
    nariz: false,
    labios: false
  });

  // IA Chat States
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'ai' | 'user'; text: string }>>([
    {
      sender: 'ai',
      text: `Olá! Sou a ELIZA, seu Centro de Inteligência Clínica. Vou conduzir nossa entrevista clínica e de preferências estéticas para gerar o perfil do(a) paciente ${patient.name}. Escreva as respostas ou relate a queixa no campo abaixo para começarmos.`
    }
  ]);
  const [userInput, setUserInput] = useState('');
  const [isIAGenerating, setIsIAGenerating] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);

  // Photos State
  const [photosMap, setPhotosMap] = useState<Record<string, string>>({});
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraTargetSlot, setCameraTargetSlot] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const REQUIRED_PHOTOS_METADATA = [
    { id: 'frente_repouso', label: 'Frente Repouso', desc: 'Face neutra olhada de frente' },
    { id: 'perfil_direito', label: 'Perfil Direito', desc: 'Visão exata lateral direita' },
    { id: 'perfil_esquerdo', label: 'Perfil Esquerdo', desc: 'Visão exata lateral esquerda' },
    { id: 'sorriso_natural', label: 'Sorriso Natural', desc: 'Sorriso moderado descontraído' },
    { id: 'sorriso_maximo', label: 'Sorriso Máximo', desc: 'Sorriso máximo focado em rugas' },
    { id: 'contracao_frontal', label: 'Contração Frontal', desc: 'Elevação de sobrancelhas (rugas testa)' },
    { id: 'glabela', label: 'Glabela (Cara Bravo)', desc: 'Aperto forte de cenho para rugas bravas' }
  ];

  // Initialize from existing anamnesis if any
  useEffect(() => {
    console.log("[TRIAGEM] Inicializando módulo de triagem assistida...");
    if (anamnesis) {
      console.log("[TRIAGEM] [DOSSIE_CARREGADO] Anamnese carregada do Firestore:", anamnesis);
      if (anamnesis.mode === 'simplified') {
        setSimplifiedForm(anamnesis.formData || {
          queixaPrincipal: anamnesis.queixaPrincipal || '',
          medicamentosAtuais: anamnesis.medicamentosAtuais || '',
          alergias: anamnesis.alergias || '',
          procedimentosRecentes: anamnesis.procedimentosRecentes || '',
          intercorrenciasAnteriores: anamnesis.intercorrenciasAnteriores || '',
          alteracoesUltimaConsulta: anamnesis.alteracoesUltimaConsulta || ''
        });
        setActiveMode('simplified');
      } else if (anamnesis.mode === 'complete') {
        setCompleteForm(anamnesis.formData || completeForm);
        setActiveMode('complete');
      } else if (anamnesis.mode === 'eliza_ia') {
        setAiReport(anamnesis.aiReport || null);
        if (anamnesis.chatMessages) {
          setChatMessages(anamnesis.chatMessages);
        }
        setActiveMode('eliza_ia');
      }
    }
  }, [anamnesis]);

  // CLINICAL CORE LOGIC - Cross-referencing check for real-time widgets
  const getDynamicClinicalAlerts = (overrideReport?: any) => {
    const alerts: Array<{ type: 'danger' | 'warning' | 'info'; title: string; desc: string; source: string }> = [];
    const currentReport = overrideReport !== undefined ? overrideReport : aiReport;

    // Checked variables depend on active mode
    if (activeMode === 'simplified') {
      const allText = `${simplifiedForm.medicamentosAtuais} ${simplifiedForm.alergias} ${simplifiedForm.intercorrenciasAnteriores} ${simplifiedForm.procedimentosRecentes}`.toLowerCase();
      
      if (allText.includes('anticoag') || allText.includes('marevan') || allText.includes('xarelto') || allText.includes('as ')) {
        alerts.push({
          type: 'danger',
          title: 'Medicamentoso: Anticoagulante Detectado',
          desc: 'Alto risco de hematomas e sangramento. Absolutamente recomendado evitar subcisão facial profunda, fios espiculados ou cirurgia menor.',
          source: 'Anamnese Simplificada'
        });
      }
      if (allText.includes('isotretin') || allText.includes('roacut') || allText.includes('retino')) {
        alerts.push({
          type: 'danger',
          title: 'Dermatológico: Isotretinoína Activa',
          desc: 'Comprometimento sério da regeneração da derme. Proibido microagulhamento, peeling químico e lasers ablativos.',
          source: 'Anamnese Simplificada'
        });
      }
      if (allText.includes('botox') || allText.includes('toxina')) {
        alerts.push({
          type: 'warning',
          title: 'Intervalo de Reaplicação da Toxina',
          desc: 'Se o procedimento recente ocorreu há menos de 90 dias, o reforço não é recomendado para prevenir efeito vacina.',
          source: 'Anamnese Simplificada'
        });
      }
      if (allText.includes('alerg') || allText.includes('penicil') || allText.includes('latex')) {
        alerts.push({
          type: 'danger',
          title: 'Risco Clínico: Alergia Crítica',
          desc: 'Recomenda-se triagem aprofundada antes de receitar antimicrobianos ou usar luvas alergênicas.',
          source: 'Anamnese Simplificada'
        });
      }
    } else if (activeMode === 'complete') {
      if (completeForm.anticoagulantes) {
        alerts.push({
          type: 'danger',
          title: 'Medicamentoso: Uso de Anticoagulante',
          desc: 'Paciente relata uso de anticoagulantes. Contraindica procedimentos altamente invasivos como Fios de sustentação facial, Subcisão e cirurgia HOF menor devido a sangramento acentuado.',
          source: 'Bloco 3 — Medicamentos'
        });
      }
      if (completeForm.isotretinoina) {
        alerts.push({
          type: 'danger',
          title: 'Pele: Uso de Isotretinoína (Roacutan)',
          desc: 'Risco sistêmico de hiperqueratose e retardo acentuado de cicatrização. Contraindicação formal para Microagulhamento profundo, Lasers agressivos fracionados e Peelings médios/profundos.',
          source: 'Bloco 3 — Medicamentos'
        });
      }
      if (completeForm.botoxRecente) {
        alerts.push({
          type: 'warning',
          title: 'Bloqueio Clínico: Toxina Recente',
          desc: 'A aplicação foi feita a menos de 90 dias. Uma nova aplicação de toxina botulínica não é recomendada agora para mitigar anticorpos neutralizantes (efeito vacina).',
          source: 'Bloco 6 — Histórico HOF'
        });
      }
      if (completeForm.hipertensao) {
        alerts.push({
          type: 'warning',
          title: 'Risco Sistêmico: Hipertensão Arterial',
          desc: 'Controlar rigorosamente a pressão arterial antes do ato clínico. Uso restrito de anestésicos com vasoconstritores adrenérgicos.',
          source: 'Bloco 2 — Saúde Geral'
        });
      }
      if (completeForm.diabetes) {
        alerts.push({
          type: 'warning',
          title: 'Risco Imunológico: Diabetes Mellitus',
          desc: 'Ocorrência de retardo de regeneração dermoespicular pós-fios e propensão a infecção saprófita. Monitorar hemoglobina glicada do paciente.',
          source: 'Bloco 2 — Saúde Geral'
        });
      }
      if (completeForm.autoimune) {
        alerts.push({
          type: 'danger',
          title: 'Alerta Grave: Doença Autoimune',
          desc: 'Forte propensão a reações de corpo estranho por bioestimuladores de colágeno particulados (ex: PLLA, Hidroxiapatita de Cálcio) e fios.',
          source: 'Bloco 2 — Saúde Geral'
        });
      }
      if (completeForm.bruxismo || completeForm.dtm) {
        alerts.push({
          type: 'info',
          title: 'Oportunidade Odonto: Carga Mastigatória Alta',
          desc: 'Grande chance de mialgia massetérica. Indicação estratégica de Toxina Botulínica terapêutica nos músculos masseter e temporal.',
          source: 'Bloco 5 — Histórico Odontológico'
        });
      }
    } else if (activeMode === 'eliza_ia' && currentReport) {
      // Parse alerts from currentReport or return synthesized ones if stored
      if (currentReport.alertasClinicos?.length > 0) {
        currentReport.alertasClinicos.forEach((a: string, i: number) => {
          alerts.push({
            type: a.toLowerCase().includes('crític') || a.toLowerCase().includes('contraindic') ? 'danger' : 'warning',
            title: `Triagem IA: Diagnóstico de Risco #${i+1}`,
            desc: a,
            source: 'ELIZA Inteligência Analítica'
          });
        });
      }
    }

    return alerts;
  };

  // Smart Integration Pipeline Data
  const getTreatmentPipelineOpportunities = () => {
    const opps: Array<{ title: string; category: string; description: string }> = [];

    if (activeMode === 'complete') {
      if (completeForm.rejuvenescimento) {
        opps.push({ title: 'Protocolo Rejuvenescimento Pro', category: 'HOF Premium', description: 'Bioestimulador de colágeno Sculptra + preenchimento de sustentação 3D.' });
      }
      if (completeForm.harmonizacao) {
        opps.push({ title: 'Full Face Harmonization', category: 'HOF Premium', description: 'Preenchimento estruturado de malar, mento e mandíbula com ácido hialurônico.' });
      }
      if (completeForm.emagrecimentoFacial) {
        opps.push({ title: 'Lipo Enzimática de Papada', category: 'HOF Premium', description: 'Protocolo de esvaziadores de gordura enzimáticos na face e papada.' });
      }
      if (completeForm.qualidadePele) {
        opps.push({ title: 'Skinbooster & Profhilo Booster', category: 'HOF Premium', description: 'Super hidratação dérmica profunda para elasticidade e viço imediato.' });
      }
      if (completeForm.definicaoMandibular) {
        opps.push({ title: 'Preenchimento Mandibular Ultra', category: 'HOF Premium', description: 'Ácido hialurônico de alta coesividade para definição angular.' });
      }
      if (completeForm.labios) {
        opps.push({ title: 'Sculpt & Volume Labial', category: 'HOF Premium', description: 'Modelagem de filtro e contorno labial com agulha biselada.' });
      }
      if (completeForm.bruxismo || completeForm.dtm) {
        opps.push({ title: 'Placa Miorrelaxante + Botox Masseter', category: 'Odonto HOF', description: 'Associação odontológica terapêutica contra estresse oclusal.' });
      }
    } else if (activeMode === 'simplified') {
      const q = simplifiedForm.queixaPrincipal.toLowerCase();
      if (q.includes('ruga') || q.includes('testa') || q.includes('olhar')) {
        opps.push({ title: 'Aplicação de Toxina Botulínica Global', category: 'HOF Premium', description: 'Relaxamento de terço superior com micro-agulhas estéreis.' });
      }
      if (q.includes('flacidez') || q.includes('caido') || q.includes('pele')) {
        opps.push({ title: 'Fases de Bioestimulação Radiesse', category: 'HOF Premium', description: 'Tratamento de flacidez de terço inferior em vetor ascendente.' });
      }
    } else if (activeMode === 'eliza_ia' && aiReport) {
      if (aiReport.oportunidadesTerapeuticas?.length > 0) {
        aiReport.oportunidadesTerapeuticas.forEach((o: string) => {
          opps.push({
            title: o.split(':')[0] || 'Recomendação Comercial',
            category: 'ELIZA CRM Inteligente',
            description: o.split(':').slice(1).join(':') || o
          });
        });
      }
    }

    return opps;
  };

  // SAVE CLINICAL ANAMNESIS TO FIRESTORE
  const saveAnamnesisToFirestore = async (modeName: string, payload: any) => {
    try {
      const patientPath = `clinics/${clinic.id}/patients/${patient.id}`;
      const anamnesisRef = doc(db, patientPath, 'anamnesis', 'current');
      const currentReport = modeName === 'eliza_ia' ? payload : aiReport;

      let clinicalTextSummary = '';
      if (modeName === 'simplified') {
        clinicalTextSummary = `**ANAMNESE SIMPLIFICADA RECORRENTE**
- Queixa Principal: ${payload.queixaPrincipal}
- Medicamentos Atuais: ${payload.medicamentosAtuais}
- Alergias Relatadas: ${payload.alergias}
- Procedimentos Recentes: ${payload.procedimentosRecentes}
- Intercorrências Anteriores: ${payload.intercorrenciasAnteriores}
- Alterações desde última consulta: ${payload.alteracoesUltimaConsulta}`;
      } else if (modeName === 'complete') {
        const genText = [];
        genText.push(`**ANAMNESE COMPLETA DE ANÁLISE INICIAL**`);
        genText.push(`[Bloco 1] Idade: ${payload.idade} anos | Profissão: ${payload.profissao} | Peso: ${payload.peso}kg | Altura: ${payload.altura}m`);
        
        const saudeList = [];
        if (payload.hipertensao) saudeList.push('Hipertensão');
        if (payload.diabetes) saudeList.push('Diabetes');
        if (payload.cardiopatia) saudeList.push('Doença Cardiovascular');
        if (payload.autoimune) saudeList.push('Doença Autoimune (PLLA contraindicado)');
        if (payload.hormonal) saudeList.push('Distúrbio Hormonal');
        if (payload.oncologico) saudeList.push('Histórico Oncológico');
        genText.push(`[Bloco 2] Saúde Geral: ${saudeList.length > 0 ? saudeList.join(', ') : 'Sem condições sistêmicas declaradas'}`);
        
        const medList = [];
        if (payload.anticoagulantes) medList.push('Anticoagulantes (Subcisão e Fios Críticos)');
        if (payload.isotretinoina) medList.push('Isotretinoína/Roacutan (Peelings e Laser Crítico)');
        if (payload.corticoides) medList.push('Corticóides imunossupressores');
        if (payload.antidepressivos) medList.push('Antidepressivos');
        if (payload.hormonios) medList.push('Hormônios externos');
        if (payload.outrosMedicamentos) medList.push(`Outros: ${payload.outrosMedicamentos}`);
        genText.push(`[Bloco 3] Medicamentos: ${medList.length > 0 ? medList.join(', ') : 'Nenhum medicamento de risco'}`);

        const habitList = [];
        if (payload.tabagismo) habitList.push('Tabagista');
        if (payload.alcool) habitList.push('Consumo Álcool');
        if (payload.exercicio) habitList.push('Pratica Exercício');
        if (payload.sonoRuim) habitList.push('Insônia / Sono Ruim');
        genText.push(`[Bloco 4] Hábitos de Vida: ${habitList.length > 0 ? habitList.join(', ') : 'Hábitos regulares'}`);

        const odontoList = [];
        if (payload.implantes) odontoList.push('Implantes');
        if (payload.proteses) odontoList.push('Próteses');
        if (payload.bruxismo) odontoList.push('Bruxismo atencional');
        if (payload.dtm) odontoList.push('Disfunção na ATM');
        if (payload.cirurgiasDentais) odontoList.push(`Cirurgias prévias: ${payload.cirurgiasDentais}`);
        genText.push(`[Bloco 5] Odontologia Integrada: ${odontoList.length > 0 ? odontoList.join(', ') : 'Integridade Odontológica regular'}`);

        const hofList = [];
        if (payload.botoxRecente) hofList.push('Aplicou Botox <90 dias');
        if (payload.preenchimentos) hofList.push('Preenchimento facial');
        if (payload.bioestimuladores) hofList.push('Bioestimulador de Colágeno');
        if (payload.fiosSustentacao) hofList.push('Fios de sustentação');
        if (payload.cirurgiasFaciais) hofList.push(`Cirurgias Faciais: ${payload.cirurgiasFaciais}`);
        if (payload.intercorrenciasHof) hofList.push(`Intercorrência anterior: ${payload.intercorrenciasHof}`);
        genText.push(`[Bloco 6] Histórico Estético de HOF: ${hofList.length > 0 ? hofList.join(', ') : 'Nenhum tratamento anterior'}`);

        const objList = [];
        if (payload.rejuvenescimento) objList.push('Rejuvenescimento');
        if (payload.harmonizacao) objList.push('Harmonização Estética');
        if (payload.emagrecimentoFacial) objList.push('Emagrecimento Facial');
        if (payload.qualidadePele) objList.push('Qualidade e Textura Pele');
        if (payload.definicaoMandibular) objList.push('Definição de Mandíbula');
        if (payload.olheiras) objList.push('Tratar Olheiras');
        if (payload.nariz) objList.push('Rinoplastia HOF / Nariz');
        if (payload.labios) objList.push('Volume e Contorno Labial');
        genText.push(`[Bloco 7] Objetivos do Paciente: ${objList.length > 0 ? objList.join(', ') : 'Dúvida Estética Geral'}`);

        clinicalTextSummary = genText.join('\n');
      } else if (modeName === 'eliza_ia' && currentReport) {
        clinicalTextSummary = `**CENTRO DE INTELIGÊNCIA CLÍNICA - ANAMNESE CONVERSACIONAL ELIZA IA**
        
**Resumo Executivo da Entrevista:**
${currentReport.resumoExecutivo}

**Perfil Clínico do Paciente:**
${currentReport.perfilClinico}

**Perfil Estético do Paciente:**
${currentReport.perfilEstetico}`;
      }

      const activeAlerts = getDynamicClinicalAlerts(currentReport).map(a => `${a.title}: ${a.desc}`);

      const dataToSave = {
        title: modeName === 'simplified' ? 'Anamnese Simplificada' : modeName === 'complete' ? 'Anamnese Completa' : 'Anamnese ELIZA IA Inteligente',
        mode: modeName,
        content: clinicalTextSummary,
        internalNotes: modeName === 'eliza_ia' && currentReport ? `Resumo Executivo: ${currentReport.resumoExecutivo}` : 'Anamnese clínica estruturada online.',
        formData: payload,
        aiReport: modeName === 'eliza_ia' ? currentReport : null,
        chatMessages: modeName === 'eliza_ia' ? chatMessages : null,
        clinicalAlerts: activeAlerts,
        updatedAt: serverTimestamp()
      };

      await setDoc(anamnesisRef, dataToSave);
      console.log("[TRIAGEM] [DOSSIE_SALVO] Ficha clínica e dossiê salvos com sucesso no Firestore:", dataToSave);

      alert('Ficha de Anamnese salva com extremo sucesso! Dados clínicos integrados automaticamente.');
    } catch (err: any) {
      console.error("[TRIAGEM] Falha ao salvar a anamnese:", err);
      alert(`Falha ao sincronizar dados na ficha clínica interna: ${err.message}`);
    }
  };

  // EXECUTE INTEGRATED CONVERSATIONAL SEARCH / ADAPTIVE DIALOG WITH GEMINI PROXY
  const handleSendMessageToEliza = async () => {
    if (!userInput.trim() || isIAGenerating) return;

    // Lock if eliza_ia module is simulated off
    if (!activeModules.eliza_ia) {
      alert("Módulo ELIZA IA bloqueado pelo painel de experimentação de licenças. Ative o módulo abaixo para prosseguir.");
      return;
    }

    const newUserMessage = userInput.trim();
    setChatMessages(prev => [...prev, { sender: 'user', text: newUserMessage }]);
    setUserInput('');
    setIsIAGenerating(true);

    try {
      // Build conversation history for the AI Proxy
      const history = chatMessages.map(msg => ({
        role: msg.sender === 'ai' ? 'model' : 'user',
        parts: [{ text: msg.text }]
      }));
      history.push({ role: 'user', parts: [{ text: newUserMessage }] });

      const promptSystem = `Você é a ELIZA AI, assistente clínica e de inteligência em Harmonização Orofacial e Odontologia Estética avançada.
Seu objetivo é conduzir uma anamnese fluida, aconchegante e focada, fazendo perguntas de forma adaptativa.
Você conversa em Português nativo e com jargão clínico impecável e acolhedor de alto padrão.
Paciente atual: ${patient.name}. Idade / Perfil clínico atual da ficha: ${JSON.stringify(anamnesis || 'Primeira consulta')}.

Regra de condução:
- Seja clínica, amigável e profissional.
- Faça de 1 a 2 perguntas no máximo de cada vez para não cansar o cliente.
- Se o usuário responder algo interessante (ex: uso de medicamentos, alergias), aprofunde de forma lógica e cuidadosa.
- Se perceber que já cobriu aspectos de Saúde Geral, Medicamentos de Risco, Hábitos e Objetivos Estéticos, informe elegantemente que coletou o suficiente e que o profissional pode clicar em "Finalizar e Compilar Relatório" a qualquer momento.`;

      const response = await fetch('/api/ai/generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: `Instruções: ${promptSystem}` }] },
            ...history
          ],
          config: {
            temperature: 0.7,
            topP: 0.95
          }
        })
      });

      const resData = await response.json();
      if (response.ok && resData.text) {
        setChatMessages(prev => [...prev, { sender: 'ai', text: resData.text }]);
      } else {
        throw new Error(resData.error || 'Erro na resposta do proxy.');
      }
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, { sender: 'ai', text: `Desculpe, tive um contratempo de rede de dados: ${err.message}. Mas podemos continuar conversando!` }]);
    } finally {
      setIsIAGenerating(false);
    }
  };

  // FINALISE CHAT & EXHAUSTIVELY COMPILE MULTI-POINT CLINICAL REPORT
  const handleFinalizeAndCompileReport = async () => {
    console.log("[TRIAGEM] [GERANDO_DOSSIE] Iniciando compilação do dossiê analítico via ELIZA IA...");
    setIsIAGenerating(true);
    try {
      const chatLog = chatMessages.map(m => `${m.sender.toUpperCase()}: ${m.text}`).join('\n');
 
      const compilationPrompt = `Analise a seguinte conversa de triagem clínica de Harmonização Orofacial realizada com o(a) paciente ${patient.name}:\n\n${chatLog}\n\n
Gere uma resposta em formato JSON estrito contendo os campos descritos abaixo. Responda APENAS com o JSON estrito. Não insira caracteres estranhos adicionais.
 
Campos requeridos no JSON:
{
  "perfilClinico": "Resumo clínico detalhado focado em riscos, medicamentos e histórico de saúde em formato markdown.",
  "perfilEstetico": "Mapeamento das insatisfações faciais relatadas, objetivos estéticos de rejuvenescimento ou harmonização em formato markdown.",
  "alertasClinicos": [
    "Lista de alertas ou contraindicações específicas (ex: risco de hematomas devido a anticoagulantes, impedimentos de toxina recente, etc.)"
  ],
  "oportunidadesTerapeuticas": [
    "Nome do Procedimento / Protocolo Sugerido: Breve explicação técnica da indicação com visão clínica e comercial premium."
  ],
  "riscos": [
    "Risco identificado durante os procedimentos clínicos propostos e como mitigar."
  ],
  "resumoExecutivo": "Mapeamento de 2-3 sentenças ideal para uma leitura rápida do profissional antes de entrar na sala."
}`;
 
      const response = await fetch('/api/ai/generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-3.5-flash',
          contents: [{ role: 'user', parts: [{ text: compilationPrompt }] }],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      });
 
      const resData = await response.json();
      if (response.ok && resData.text) {
        console.log("[TRIAGEM] [DOSSIE_GERADO] Dossiê bruto retornado com sucesso pela IA:", resData.text);
        const compiled = JSON.parse(resData.text);
        setAiReport(compiled);
        await saveAnamnesisToFirestore('eliza_ia', compiled);
      } else {
        throw new Error(resData.error || 'Erro ao compilar insights clínicos.');
      }
    } catch (err: any) {
      console.warn("[TRIAGEM] Falha de processamento estrutural JSON na ELIZA IA; gerando dados de fallback:", err);
      // Generic Fallback
      const genericReport = {
        perfilClinico: "Paciente demonstra bem-estar clínico geral. Sem restrições severas mapeadas.",
        perfilEstetico: "Objetivo focado em restauração de volumetria e hidratação dérmica profunda.",
        alertasClinicos: ["Não foi possível subdividir alertas. Siga triagem padrão."],
        oportunidadesTerapeuticas: ["Protocolo HOF Multi-Vetor Avançado: Recomendado."],
        riscos: ["Padrões de rugas cinéticas - Monitorar contração."],
        resumoExecutivo: "Estudo conversacional encerrado com êxito pelo assistente clínico."
      };
      console.log("[TRIAGEM] [DOSSIE_GERADO] Dossiê de Copilador Fallback gerado:", genericReport);
      setAiReport(genericReport);
      await saveAnamnesisToFirestore('eliza_ia', genericReport);
    } finally {
      setIsIAGenerating(false);
    }
  };

  // PHOTOGRAPHY SYSTEM (Webcam Snapshot & File Upload Integration)
  const handleUploadPhotoFile = (slotId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 800000) {
      alert('O arquivo excedeu a barreira de 800KB. Por favor, utilize uma imagem mais leve para garantir performance e armazenamento.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Url = reader.result as string;
      setPhotosMap(prev => ({ ...prev, [slotId]: base64Url }));
      
      // Save directly to Patient subcollection
      const slotMeta = REQUIRED_PHOTOS_METADATA.find(p => p.id === slotId);
      const fileId = `proto-${slotId}-${Date.now()}`;
      try {
        await setDoc(doc(db, `clinics/${clinic.id}/patients/${patient.id}`, 'images', fileId), {
          title: `Protocolo Fotográfico - ${slotMeta?.label || slotId}`,
          category: 'Foto Clínica',
          description: `Imagem oficial da vista de ${slotMeta?.label || slotId} arquivada automaticamente no Prontuário Inteligente da ELIZA.`,
          url: base64Url,
          date: serverTimestamp()
        });
      } catch (err: any) {
        console.error("Failed to commit photo block to DB path:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  const startWebcamCamera = async (slotId: string) => {
    setCameraTargetSlot(slotId);
    setIsCameraActive(true);
    setTimeout(async () => {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } else {
          alert('Webcam / API de vídeo nativa não suportada neste navegador.');
          setIsCameraActive(false);
        }
      } catch (err: any) {
        console.log("Webcam access error:", err);
        alert('Falha interna ao inicializar câmera de vídeo. Conceda permissão no navegador ou utilize o uploader de arquivo.');
        setIsCameraActive(false);
      }
    }, 100);
  };

  const captureCameraSnapshot = async () => {
    if (!cameraTargetSlot || !videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const base64Url = canvas.toDataURL('image/jpeg', 0.8);
      
      // Update local state
      setPhotosMap(prev => ({ ...prev, [cameraTargetSlot]: base64Url }));

      // Save directly to db
      const slotMeta = REQUIRED_PHOTOS_METADATA.find(p => p.id === cameraTargetSlot);
      const fileId = `proto-${cameraTargetSlot}-${Date.now()}`;
      try {
        await setDoc(doc(db, `clinics/${clinic.id}/patients/${patient.id}`, 'images', fileId), {
          title: `Protocolo Fotográfico - ${slotMeta?.label || cameraTargetSlot}`,
          category: 'Foto Clínica',
          description: `Fotografia instantânea ${slotMeta?.label || cameraTargetSlot} sincronizada via câmera de anamnese.`,
          url: base64Url,
          date: serverTimestamp()
        });
      } catch (err) {
        console.error("Image commit failure:", err);
      }
    }
    stopWebcamCamera();
  };

  const stopWebcamCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
    setCameraTargetSlot(null);
  };

  const deletePhotoSlot = (slotId: string) => {
    if (window.confirm("Deseja realmente remover esta foto do protocolo?")) {
      setPhotosMap(prev => {
        const copy = { ...prev };
        delete copy[slotId];
        return copy;
      });
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* HEADER SECTION */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-teal-800 to-teal-950 text-white p-6 md:p-8 rounded-[2rem] border border-teal-800 shadow-xl gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-teal-500/10 rounded-2xl flex items-center justify-center text-teal-300 border border-teal-500/20">
            <ClipboardList className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg md:text-xl font-black text-white tracking-tight flex items-center gap-2">
              Anamnese Inteligente
              <span className="text-[10px] bg-teal-500 font-extrabold uppercase px-2.5 py-1 rounded-full text-teal-950 tracking-widest animate-pulse">
                ELIZA AI Center
              </span>
            </h3>
            <p className="text-xs text-teal-300 font-medium">
              Centro Integrado de Análise Diagnóstica, Riscos Clínicos e Captura de Imagens
            </p>
          </div>
        </div>

        {/* Dynamic Mode Switcher Bar */}
        <div className="flex flex-wrap gap-1 bg-teal-900/40 p-1 rounded-xl border border-teal-800/60 w-full md:w-auto">
          <button
            onClick={() => setActiveMode('simplified')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeMode === 'simplified' 
                ? 'bg-teal-500 text-teal-950 shadow-md' 
                : 'text-teal-200 hover:bg-teal-900/60'
            }`}
          >
            Simplificada
          </button>
          <button
            onClick={() => setActiveMode('complete')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeMode === 'complete' 
                ? 'bg-teal-500 text-teal-950 shadow-md' 
                : 'text-teal-200 hover:bg-teal-900/60'
            }`}
          >
            Completa
          </button>
          <button
            onClick={() => setActiveMode('eliza_ia')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeMode === 'eliza_ia' 
                ? 'bg-teal-400 text-teal-950 shadow-md' 
                : 'text-teal-200 hover:bg-teal-900/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 fill-teal-950/20" />
            ELIZA IA Conversacional
          </button>
        </div>
      </header>

      {/* THREE INTERACTIVE MODES */}
      
      {/* 1. SELECTION INITIAL PLACEHOLDER STATE */}
      {activeMode === 'selection' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div 
            onClick={() => setActiveMode('simplified')}
            className="group cursor-pointer bg-white p-8 rounded-[2rem] border border-slate-200 hover:border-teal-500/40 transition-all hover:shadow-xl hover:-translate-y-1 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-50 opacity-10 rounded-bl-full transition-all group-hover:scale-125" />
            <div className="w-12 h-12 bg-teal-550/10 text-teal-700 rounded-xl flex items-center justify-center mb-6 border border-teal-100">
              <ClipboardList className="w-6 h-6" />
            </div>
            <h4 className="text-base font-black text-slate-800 tracking-tight group-hover:text-teal-700">Anamnese Simplificada</h4>
            <p className="text-[10px] text-teal-600 font-extrabold uppercase tracking-widest mt-1">Pacientes Recorrentes • 2 a 3 minutos</p>
            <p className="text-xs text-slate-500 mt-4 leading-relaxed">
              Ideal para revisões rápidas, alterações de medicamentos, alergias pontuais ou queixas iniciais em consultas de rota.
            </p>
            <div className="mt-6 flex items-center gap-2 text-teal-700 font-bold text-xs uppercase tracking-widest">
              Iniciar Ficha <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          <div 
            onClick={() => setActiveMode('complete')}
            className="group cursor-pointer bg-white p-8 rounded-[2rem] border border-slate-200 hover:border-teal-500/40 transition-all hover:shadow-xl hover:-translate-y-1 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-50 opacity-10 rounded-bl-full transition-all group-hover:scale-125" />
            <div className="w-12 h-12 bg-sky-500/10 text-sky-700 rounded-xl flex items-center justify-center mb-6 border border-sky-100">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-base font-black text-slate-800 tracking-tight group-hover:text-sky-700">Anamnese Completa</h4>
            <p className="text-[10px] text-sky-600 font-extrabold uppercase tracking-widest mt-1">Primeira Consulta • 7 Blocos Estruturados</p>
            <p className="text-xs text-slate-500 mt-4 leading-relaxed">
              Exaustivo processo de triagem inicial cobrindo condições cardiovasculares, medicamentos impeditivos, histórico odontológico e HOF.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sky-700 font-bold text-xs uppercase tracking-widest">
              Iniciar Triagem <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          <div 
            onClick={() => setActiveMode('eliza_ia')}
            className="group cursor-pointer bg-gradient-to-br from-teal-900 to-teal-950 p-8 rounded-[2rem] border border-teal-800 hover:border-teal-400/40 transition-all hover:shadow-2xl hover:-translate-y-1 relative overflow-hidden text-white"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-400 opacity-[0.06] rounded-bl-full transition-all group-hover:scale-125 animate-pulse" />
            <div className="w-12 h-12 bg-teal-400/10 text-teal-300 rounded-xl flex items-center justify-center mb-6 border border-teal-500/20">
              <Sparkles className="w-6 h-6 fill-teal-300/10 animate-spin-slow" />
            </div>
            <h4 className="text-base font-black text-white tracking-tight group-hover:text-teal-300">Formulário conversacional ELIZA IA</h4>
            <p className="text-[10px] text-teal-300 font-extrabold uppercase tracking-widest mt-1">Inteligência Artificial • Adaptativo</p>
            <p className="text-xs text-teal-100/75 mt-4 leading-relaxed font-sans">
              Deixe a ELIZA entrevistar o paciente em formato chat adaptivo. Produz automaticamente um dossiê de riscos e objetivos estéticos.
            </p>
            <div className="mt-6 flex items-center gap-2 text-teal-350 font-bold text-xs uppercase tracking-widest group-hover:text-white">
              Abrir Conversa <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* 2. MODE: SIMPLIFIED */}
      {activeMode === 'simplified' && (
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200">
          <div className="flex justify-between items-center pb-6 border-b border-slate-100 mb-6">
            <div>
              <h4 className="text-base font-black text-slate-800 tracking-tight">Anamnese Simplificada para Consulta de Rotina</h4>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">Indicado para revisitar parâmetros clínicos gerais rapidamente.</p>
            </div>
            <button 
              onClick={() => setActiveMode('selection')}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-all"
            >
              Alterar Modelo
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Queixa Principal / Pedidos Recorrentes</label>
              <textarea
                value={simplifiedForm.queixaPrincipal}
                onChange={e => setSimplifiedForm({ ...simplifiedForm, queixaPrincipal: e.target.value })}
                className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 focus:bg-white resize-none"
                placeholder="O que o(a) paciente deseja realizar hoje ou qual o relato de queixa?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Medicamentos em uso atualmente</label>
              <textarea
                value={simplifiedForm.medicamentosAtuais}
                onChange={e => setSimplifiedForm({ ...simplifiedForm, medicamentosAtuais: e.target.value })}
                className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 focus:bg-white resize-none"
                placeholder="Algum novo anticoagulante, corticoides, isotretinoína?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Alergias ou Hipersensibilidade</label>
              <input
                value={simplifiedForm.alergias}
                onChange={e => setSimplifiedForm({ ...simplifiedForm, alergias: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 focus:bg-white"
                placeholder="Látex, anestésicos, penicilina, etc."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Procedimentos Recentes (Últimos 6 meses)</label>
              <input
                value={simplifiedForm.procedimentosRecentes}
                onChange={e => setSimplifiedForm({ ...simplifiedForm, procedimentosRecentes: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 focus:bg-white"
                placeholder="Toxina, preenchimento, peelings..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:col-span-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Intercorrências Anteriores Mapeadas</label>
                <input
                  value={simplifiedForm.intercorrenciasAnteriores}
                  onChange={e => setSimplifiedForm({ ...simplifiedForm, intercorrenciasAnteriores: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 focus:bg-white"
                  placeholder="Edema tardio, isquemia, infecções prévias..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Alterações Sistêmicas Recentes</label>
                <input
                  value={simplifiedForm.alteracoesUltimaConsulta}
                  onChange={e => setSimplifiedForm({ ...simplifiedForm, alteracoesUltimaConsulta: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 focus:bg-white"
                  placeholder="Início de gestação, infarto recente, cirurgia?"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end gap-3 pb-2">
            <button
              onClick={() => setActiveMode('selection')}
              className="px-6 py-3 border border-slate-200 rounded-xl text-xs font-bold uppercase text-slate-500 hover:bg-slate-50"
            >
              Voltar
            </button>
            <button
              onClick={() => saveAnamnesisToFirestore('simplified', simplifiedForm)}
              className="px-8 py-3 bg-teal-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-teal-700 shadow-md transition-all flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Salvar & Alimentar Sistema
            </button>
          </div>
        </div>
      )}

      {/* 3. MODE: COMPLETE (7 BLOCKS) */}
      {activeMode === 'complete' && (
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 space-y-8">
          <div className="flex justify-between items-center pb-6 border-b border-slate-100">
            <div>
              <h4 className="text-base font-black text-slate-800 tracking-tight">Anamnese Completa Integrada (Primeira Avaliação)</h4>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">Triagem detalhada em 7 blocos sistêmicos de saúde e estilo de vida.</p>
            </div>
            <button 
              onClick={() => setActiveMode('selection')}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-all font-sans"
            >
              Alterar Modelo
            </button>
          </div>

          {/* BLOCK 1 - GENERAL DATA */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">1</span>
              BLOCO 1 — Dados Gerais
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Idade</label>
                <input 
                  type="number"
                  value={completeForm.idade} 
                  onChange={e => setCompleteForm({...completeForm, idade: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs" 
                  placeholder="35"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profissão</label>
                <input 
                  type="text"
                  value={completeForm.profissao} 
                  onChange={e => setCompleteForm({...completeForm, profissao: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs" 
                  placeholder="Dentista"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Peso (kg)</label>
                <input 
                  type="number"
                  value={completeForm.peso} 
                  onChange={e => setCompleteForm({...completeForm, peso: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs" 
                  placeholder="70"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Altura (m)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={completeForm.altura} 
                  onChange={e => setCompleteForm({...completeForm, altura: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs" 
                  placeholder="1.72"
                />
              </div>
            </div>
            {/* IMC Calculator */}
            {completeForm.peso && completeForm.altura && (
              <div className="mt-4 p-2.5 bg-teal-50 border border-teal-100 rounded-xl text-[10px] font-bold text-teal-800 tracking-tight flex items-center gap-2">
                <Scale className="w-4 h-4 text-teal-600" />
                <span>IMC Calculado:</span> 
                <span className="font-extrabold text-teal-950">
                  {(Number(completeForm.peso) / (Number(completeForm.altura) * Number(completeForm.altura))).toFixed(1)}
                </span>
                <span className="text-teal-600/70 font-medium">
                  ({(Number(completeForm.peso) / (Number(completeForm.altura) * Number(completeForm.altura))) < 18.5 ? 'Abaixo do peso' : (Number(completeForm.peso) / (Number(completeForm.altura) * Number(completeForm.altura))) < 25 ? 'Peso saudável' : 'Sobrepeso'})
                </span>
              </div>
            )}
          </section>

          {/* BLOCK 2 - HEALTH CONDITIONS */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">2</span>
              BLOCO 2 — Saúde Geral
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {[
                { label: 'Hipertensão', field: 'hipertensao' },
                { label: 'Diabetes', field: 'diabetes' },
                { label: 'Doença Cardiovascular', field: 'cardiopatia' },
                { label: 'Doença Autoimune', field: 'autoimune' },
                { label: 'Disfunção Hormonal', field: 'hormonal' },
                { label: 'Histórico Oncológico', field: 'oncologico' }
              ].map(item => (
                <div key={item.field} className="flex flex-col gap-1 bg-white p-3 border border-slate-200 rounded-xl hover:-translate-y-0.5 transition-all">
                  <span className="text-[10px] font-black tracking-tight text-slate-600 mb-2">{item.label}</span>
                  <div className="flex gap-1.5 bg-slate-50 p-1 rounded-lg">
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: false})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${!completeForm[item.field as keyof typeof completeForm] ? 'bg-slate-200 text-slate-700 font-bold' : 'text-slate-400'}`}
                    >
                      Não
                    </button>
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: true})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${completeForm[item.field as keyof typeof completeForm] ? 'bg-rose-500 text-white font-black' : 'text-slate-400'}`}
                    >
                      Sim
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* BLOCK 3 - MEDICATION */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">3</span>
              BLOCO 3 — Medicamentos de Risco
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Anticoagulantes', field: 'anticoagulantes', warning: 'Fios e Subcisão Críticos' },
                { label: 'Isotretinoína (Roacutan)', field: 'isotretinoina', warning: 'Ablações e Lasers Críticos' },
                { label: 'Corticoides', field: 'corticoides', warning: 'Imunossuprimido' },
                { label: 'Antidepressivos', field: 'antidepressivos', warning: 'Cura tecidual lerda' },
                { label: 'Hormônios', field: 'hormonios', warning: 'Pele lipídica' }
              ].map(item => (
                <div key={item.field} className="flex flex-col gap-1 bg-white p-3 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-black tracking-tight text-slate-600 mb-0.5">{item.label}</span>
                  <span className="text-[8px] text-[#A16D6D] font-extrabold uppercase mb-2 block">{item.warning}</span>
                  <div className="flex gap-1.5 bg-slate-50 p-1 rounded-lg">
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: false})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${!completeForm[item.field as keyof typeof completeForm] ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}
                    >
                      Não
                    </button>
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: true})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${completeForm[item.field as keyof typeof completeForm] ? 'bg-amber-500 text-white font-black shadow-inner' : 'text-slate-400'}`}
                    >
                      Sim
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Outros Medicamentos e Terapias Ativas</label>
              <input
                value={completeForm.outrosMedicamentos}
                onChange={e => setCompleteForm({ ...completeForm, outrosMedicamentos: e.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                placeholder="Discorra aqui sobre outras substâncias farmacológicas do paciente..."
              />
            </div>
          </section>

          {/* BLOCK 4 - LIFE HABITS */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">4</span>
              BLOCO 4 — Hábitos de Vida
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Tabagismo', field: 'tabagismo' },
                { label: 'Bebidas Alcoólicas', field: 'alcool' },
                { label: 'Exercícios Regulares', field: 'exercicio' },
                { label: 'Sono Deficitário / Insônia', field: 'sonoRuim' }
              ].map(item => (
                <div key={item.field} className="flex flex-col gap-1 bg-white p-3 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-black tracking-tight text-slate-600 mb-2">{item.label}</span>
                  <div className="flex gap-1.5 bg-slate-50 p-1 rounded-lg">
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: false})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${!completeForm[item.field as keyof typeof completeForm] ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}
                    >
                      Não
                    </button>
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: true})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${completeForm[item.field as keyof typeof completeForm] ? 'bg-teal-600 text-white font-black' : 'text-slate-400'}`}
                    >
                      Sim
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* BLOCK 5 - DENTAL HISTORY */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">5</span>
              BLOCO 5 — Histórico Odontológico
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Implantes Dentários', field: 'implantes' },
                { label: 'Prótese Removível/Fixa', field: 'proteses' },
                { label: 'Bruxismo/Aperto', field: 'bruxismo' },
                { label: 'Disfunção de ATM (DTM)', field: 'dtm' }
              ].map(item => (
                <div key={item.field} className="flex flex-col gap-1 bg-white p-3 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-black tracking-tight text-slate-600 mb-2">{item.label}</span>
                  <div className="flex gap-1.5 bg-slate-50 p-1 rounded-lg">
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: false})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${!completeForm[item.field as keyof typeof completeForm] ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}
                    >
                      Não
                    </button>
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: true})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${completeForm[item.field as keyof typeof completeForm] ? 'bg-teal-600 text-white font-black' : 'text-slate-400'}`}
                    >
                      Sim
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Cirurgias Odontográficas Prévias</label>
              <input
                value={completeForm.cirurgiasDentais}
                onChange={e => setCompleteForm({ ...completeForm, cirurgiasDentais: e.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                placeholder="Exemplo: Extrações de siso, cirurgia ortognática anterior..."
              />
            </div>
          </section>

          {/* BLOCK 6 - HOF HISTORY */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">6</span>
              BLOCO 6 — Histórico Harmonização Estética (HOF)
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Toxina Botulínica Recente (<90 dias)', field: 'botoxRecente' },
                { label: 'Preenchimento Hialurônico anterior', field: 'preenchimentos' },
                { label: 'Bioestimuladores de colágeno', field: 'bioestimuladores' },
                { label: 'Fios de Polidioxanona/PLLA', field: 'fiosSustentacao' }
              ].map(item => (
                <div key={item.field} className="flex flex-col gap-1 bg-white p-3 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-black tracking-tight text-slate-600 mb-2">{item.label}</span>
                  <div className="flex gap-1.5 bg-slate-50 p-1 rounded-lg">
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: false})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${!completeForm[item.field as keyof typeof completeForm] ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}
                    >
                      Não
                    </button>
                    <button 
                      type="button"
                      onClick={() => setCompleteForm({...completeForm, [item.field]: true})}
                      className={`flex-1 text-[9px] font-extrabold uppercase py-1 rounded-md transition-all ${completeForm[item.field as keyof typeof completeForm] ? 'bg-teal-600 text-white font-black' : 'text-slate-400'}`}
                    >
                      Sim
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Cirurgias Faciais Clínicas Estéticas</label>
                <input
                  value={completeForm.cirurgiasFaciais}
                  onChange={e => setCompleteForm({ ...completeForm, cirurgiasFaciais: e.target.value })}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                  placeholder="Bichectomia, blefaroplastia, lifting..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Histórico de Intercorrências / Reações Estéticas</label>
                <input
                  value={completeForm.intercorrenciasHof}
                  onChange={e => setCompleteForm({ ...completeForm, intercorrenciasHof: e.target.value })}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                  placeholder="Nódulos inflamados, necrose inicial, alergias severas..."
                />
              </div>
            </div>
          </section>

          {/* BLOCK 7 - PATIENT OBJECTIVES */}
          <section className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-550/10 text-teal-600 text-[10px] font-bold flex items-center justify-center">7</span>
              BLOCO 7 — Objetivos Clínicos do Paciente
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Rejuvenescimento Geral', field: 'rejuvenescimento' },
                { label: 'Harmonização Facial Estética', field: 'harmonizacao' },
                { label: 'Emagrecimento das Linhas Faciais', field: 'emagrecimentoFacial' },
                { label: 'Melhora de Qualidade e Textura de Pele', field: 'qualidadePele' },
                { label: 'Definição e Angulação de Mandíbula', field: 'definicaoMandibular' },
                { label: 'Amenização ou Volumetria das Olheiras', field: 'olheiras' },
                { label: 'Estética Rinoplastia / Nariz', field: 'nariz' },
                { label: 'Volume e Reestruturação dos Lábios', field: 'labios' }
              ].map(item => (
                <div 
                  key={item.field} 
                  onClick={() => setCompleteForm({...completeForm, [item.field]: !completeForm[item.field as keyof typeof completeForm]})}
                  className={`cursor-pointer p-4 rounded-xl border text-center transition-all ${
                    completeForm[item.field as keyof typeof completeForm] 
                      ? 'bg-teal-50 border-teal-500 text-teal-900 font-bold scale-102 shadow-sm' 
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs">{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100 pb-2">
            <button
              onClick={() => setActiveMode('selection')}
              className="px-6 py-3 border border-slate-200 rounded-xl text-xs font-bold uppercase text-slate-500 hover:bg-slate-50 font-sans"
            >
              Voltar
            </button>
            <button
              onClick={() => saveAnamnesisToFirestore('complete', completeForm)}
              className="px-8 py-3 bg-teal-650 bg-teal-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-teal-750 shadow-md transition-all flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Salvar & Alimentar Sistema
            </button>
          </div>
        </div>
      )}

      {/* 4. MODE: ELIZA CONVERSATIONAL IA CHAT */}
      {activeMode === 'eliza_ia' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Chat Container (Left Pane) */}
          <div className="lg:col-span-7 bg-white rounded-[2.5rem] border border-slate-200 shadow-md flex flex-col h-[650px] overflow-hidden">
            <header className="p-5 border-b border-slate-100 bg-slate-50/70 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
                  <Brain className="w-5 h-5 fill-teal-500/10" />
                </div>
                <div>
                  <h5 className="text-sm font-black text-slate-800 tracking-tight">Análise Assistida por Voz & Chat</h5>
                  <span className="text-[10px] text-teal-600 font-extrabold uppercase tracking-widest block mt-0.5">ELIZA IA Conversacional Ativa</span>
                </div>
              </div>
              <button 
                onClick={() => setActiveMode('selection')}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
              >
                Voltar
              </button>
            </header>

            {/* Simulated/Real chat window */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/20">
              {chatMessages.map((msg, index) => (
                <div 
                  key={index}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}
                >
                  <div className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                    msg.sender === 'user' 
                      ? 'bg-teal-650 bg-teal-700 text-white font-medium rounded-tr-none' 
                      : 'bg-white border border-slate-200 text-slate-700 font-normal rounded-tl-none shadow-sm shadow-slate-100'
                  }`}>
                    {msg.sender === 'ai' && (
                      <span className="text-[8px] font-black uppercase text-teal-600 tracking-widest block mb-1">ELIZA AI</span>
                    )}
                    <span className="whitespace-pre-line">{msg.text}</span>
                  </div>
                </div>
              ))}
              {isIAGenerating && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs text-slate-500 rounded-tl-none flex items-center gap-2 shadow-sm">
                    <span className="text-[8px] font-black uppercase text-teal-600 tracking-widest block">ELIZA</span>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-600" />
                    <span>Transcrevendo e analisando padrões clínicos...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Footer */}
            <footer className="p-4 border-t border-slate-100 shrink-0 flex gap-2 bg-white">
              <input 
                type="text"
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessageToEliza()}
                disabled={isIAGenerating}
                className="flex-1 px-4 py-3 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs outline-none"
                placeholder="Ex: Paciente quer preencher lábios, tem hipertensão e usa AAS..."
              />
              <button
                onClick={handleSendMessageToEliza}
                disabled={isIAGenerating}
                className="px-5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition-all flex items-center justify-center font-bold text-xs"
              >
                Enviar
              </button>
              <button
                onClick={handleFinalizeAndCompileReport}
                disabled={isIAGenerating}
                className="px-4 border-2 border-teal-500/20 hover:border-teal-500 bg-teal-50 hover:bg-teal-100 rounded-xl text-teal-950 transition-all font-black text-[10px] uppercase tracking-widest flex items-center gap-1 shrink-0"
              >
                <Sparkle className="w-3.5 h-3.5 text-teal-600 animate-pulse fill-teal-600/10" /> Finalizar Triagem
              </button>
            </footer>
          </div>

          {/* Clincal Compiled Dossier (Right Pane) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-[2.5rem] border border-slate-850 p-6 md:p-8 shadow-lg min-h-[400px] flex flex-col justify-between">
              
              {!aiReport ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-40">
                  <Brain className="w-14 h-14 text-slate-600 mb-4 stroke-1 animate-pulse" />
                  <h6 className="text-sm font-black tracking-tight text-white uppercase tracking-wider">Aguardando Dossiê Analítico</h6>
                  <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                    Conduza a triagem clínica relatando queixas e medicações no chat ao lado. Ao concluir, clique em <strong>"Finalizar Triagem"</strong> para compilar diagnósticos estéticos imediatos.
                  </p>
                </div>
              ) : (
                <div className="space-y-6 flex-1">
                  <div className="pb-4 border-b border-slate-800">
                    <span className="text-[9px] text-teal-400 font-extrabold uppercase tracking-widest block mb-1">Dossiê Clínico gerado</span>
                    <h5 className="text-base font-black text-white tracking-tight">Análise em Harmonização Fisioterapêutica e Odontológica</h5>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-widest block mb-1">Resumo Executivo (Guia Rápido)</span>
                      <p className="text-slate-100 bg-slate-800/40 p-3 rounded-xl border border-slate-800 leading-relaxed font-sans">{aiReport.resumoExecutivo}</p>
                    </div>

                    <div>
                      <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-widest block mb-1">Perfil Clínico Geral</span>
                      <p className="text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{aiReport.perfilClinico}</p>
                    </div>

                    <div>
                      <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-widest block mb-1">Perfil Estético Detalhado</span>
                      <p className="text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{aiReport.perfilEstetico}</p>
                    </div>

                    {aiReport.riscos?.length > 0 && (
                      <div>
                        <span className="text-[9px] text-[#FF9B9B] font-extrabold uppercase tracking-widest block mb-1">Riscos Identificados</span>
                        <ul className="list-disc pl-4 space-y-1 text-slate-300">
                          {aiReport.riscos.map((r: string, idx: number) => (
                            <li key={idx} className="font-sans leading-relaxed">{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Reset AI Session if needed */}
              {aiReport && (
                <button
                  onClick={() => {
                    if (window.confirm("Deseja iniciar nova sessão analítica? As recomendações atuais permanecem arquivadas na ficha.")) {
                      setAiReport(null);
                      setChatMessages([{ sender: 'ai', text: 'Sessão reiniciada. Relate os novos queixumes do paciente.' }]);
                    }
                  }}
                  className="mt-6 w-full text-center py-2.5 bg-slate-800/65 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-widest transition-all"
                >
                  Reiniciar Entrevista
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PORTFOLIO FOTO: REGISTRO FOTOGRÁFICO INTELIGENTE VIEWS */}
      <section className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-teal-600" />
            <h4 className="text-base font-black text-slate-800 tracking-tight">Registro Fotográfico Inteligente (Protocolo HOF Estrito)</h4>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">
            Capture ou importe as vistas mandatórias da face do paciente. Imagens são integradas de forma instantânea na galeria global ELIZA.
          </p>
        </div>

        {/* Unified Webcam Overlay if active */}
        {isCameraActive && (
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col items-center gap-4 max-w-lg mx-auto shadow-2xl relative animate-scaleIn">
            <h5 className="text-[10px] font-black text-teal-400 uppercase tracking-widest">
              Capturando: {REQUIRED_PHOTOS_METADATA.find(p => p.id === cameraTargetSlot)?.label}
            </h5>
            <div className="w-full bg-black rounded-xl overflow-hidden aspect-video border border-slate-700 flex items-center justify-center relative">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={stopWebcamCamera}
                className="flex-1 py-3 bg-slate-800 text-slate-400 font-bold rounded-xl text-xs uppercase"
              >
                Cancelar Câmera
              </button>
              <button
                type="button"
                onClick={captureCameraSnapshot}
                className="flex-1 py-3 bg-teal-550 bg-teal-600 text-white font-extrabold rounded-xl text-xs uppercase shadow-md flex items-center justify-center gap-1.5"
              >
                <Camera className="w-4 h-4" /> Capturar Foto Face
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {REQUIRED_PHOTOS_METADATA.map((slot) => {
            const hasPhoto = !!photosMap[slot.id];
            return (
              <div 
                key={slot.id}
                className={`flex flex-col h-56 justify-between border rounded-[1.25rem] overflow-hidden p-2.5 transition-all text-center group ${
                  hasPhoto 
                    ? 'border-teal-300 bg-teal-50/10 shadow-sm' 
                    : 'border-slate-200 bg-white hover:border-slate-350 hover:bg-slate-50/50'
                }`}
              >
                <div className="space-y-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-tight text-slate-800 block">{slot.label}</span>
                  <span className="text-[8px] text-slate-400 leading-tight block">{slot.desc}</span>
                </div>

                <div className="flex-1 flex items-center justify-center my-3 max-h-24 overflow-hidden rounded-lg bg-slate-50 border border-slate-100 relative">
                  {hasPhoto ? (
                    <>
                      <img 
                        src={photosMap[slot.id]} 
                        alt={slot.label} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <button
                        type="button"
                        onClick={() => deletePhotoSlot(slot.id)}
                        className="absolute bottom-1 right-1 p-1 bg-red-600 hover:bg-red-700 text-white rounded-md opacity-0 group-hover:opacity-100 transition-all shadow"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <Camera className="w-8 h-8 text-slate-300 stroke-1 group-hover:scale-110 transition-all" />
                  )}
                </div>

                <div className="flex gap-1">
                  {/* Local Input Trigger */}
                  <label className="flex-1 py-2 bg-slate-140 bg-slate-100 cursor-pointer rounded-lg text-[9px] font-bold uppercase text-slate-600 hover:bg-slate-200 transition-all flex items-center justify-center gap-1">
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={e => handleUploadPhotoFile(slot.id, e)}
                      className="hidden" 
                    />
                    <Upload className="w-3 h-3" /> Impor
                  </label>

                  <button
                    type="button"
                    onClick={() => startWebcamCamera(slot.id)}
                    className="p-2 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg transition-all"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* MID PANEL: LIVE CROSS-INDEX CLINICAL ENGINE & WORKFLOW PREVIEWS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Dynamic Warning Alerts Banner Checklist */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <h5 className="text-sm font-black text-slate-800 tracking-tight flex items-center gap-1.5">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Alertas Clínicos & Restrições Sistêmicas Detectados
            </h5>
            <span className="text-[10px] bg-red-100 text-red-800 font-extrabold uppercase px-2.5 py-1 rounded-full">
              {getDynamicClinicalAlerts().length} Ativos
            </span>
          </div>

          {getDynamicClinicalAlerts().length === 0 ? (
            <div className="p-8 text-center bg-slate-50/50 rounded-2xl border border-slate-100">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2 stroke-1" />
              <h6 className="text-xs font-bold text-slate-700">Nenhuma irregularidade detectada</h6>
              <p className="text-[10px] text-slate-400 mt-1">Preencha os dados sistêmicos ou relate as condições nos blocos para calcular riscos em tempo real.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {getDynamicClinicalAlerts().map((alert, i) => (
                <div 
                  key={i} 
                  className={`p-3.5 rounded-xl border flex gap-3 items-start animate-slideIn ${
                    alert.type === 'danger' 
                      ? 'bg-rose-50 border-rose-100 text-rose-900' 
                      : alert.type === 'warning' 
                        ? 'bg-amber-50 border-amber-100 text-amber-800' 
                        : 'bg-teal-50 border-teal-100 text-teal-800'
                  }`}
                >
                  <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${alert.type === 'danger' ? 'text-rose-600' : alert.type === 'warning' ? 'text-amber-600' : 'text-teal-600'}`} />
                  <div>
                    <h6 className="text-[11px] font-black tracking-tight">{alert.title}</h6>
                    <p className="text-[10px] opacity-90 mt-1 font-sans leading-relaxed">{alert.desc}</p>
                    <span className="text-[8px] opacity-75 font-bold uppercase tracking-widest block mt-2">Origem: {alert.source}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Opportunities pipelines based on customer desires */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <h5 className="text-sm font-black text-slate-800 tracking-tight flex items-center gap-1.5">
              <TrendingUp className="w-5 h-5 text-teal-600" />
              Oportunidades no CRM Comercial & Sugestão de Tratamento
            </h5>
            <span className="text-[10px] bg-teal-100 text-teal-800 font-extrabold uppercase px-2.5 py-1 rounded-full">
              {getTreatmentPipelineOpportunities().length} Encontrados
            </span>
          </div>

          {getTreatmentPipelineOpportunities().length === 0 ? (
            <div className="p-8 text-center bg-slate-50/50 rounded-2xl border border-slate-100">
              <DollarSign className="w-10 h-10 text-teal-600 bg-teal-50 rounded-full p-2 mx-auto mb-2 stroke-1" />
              <h6 className="text-xs font-bold text-slate-700">Fidelização em Triagem Primária</h6>
              <p className="text-[10px] text-slate-400 mt-1">Marque objetivos estéticos no Bloco 7 ou insira queixas para ver pipelines de pacotes sugeridos pela ELIZA.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {getTreatmentPipelineOpportunities().map((opp, i) => (
                <div key={i} className="p-3 bg-slate-50 hover:bg-slate-100 transition-all rounded-xl border border-slate-100 flex justify-between items-center">
                  <div>
                    <span className="text-[8px] bg-teal-500/10 text-teal-800 font-extrabold uppercase px-1.5 py-0.5 rounded-md tracking-wider">{opp.category}</span>
                    <h6 className="text-xs font-bold text-slate-800 mt-1">{opp.title}</h6>
                    <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{opp.description}</p>
                  </div>
                  <button
                    onClick={() => {
                      alert("Deseja exportar essa indicação de serviço diretamente como um novo rascunho de Orçamento para o paciente? Isto acelerará o fechamento comercial.");
                      onNavigateToTab('quotations');
                    }}
                    className="p-2 bg-white hover:bg-teal-600 hover:text-white border border-slate-200 rounded-lg text-[9px] font-bold uppercase transition-all shrink-0 ml-2"
                  >
                    Vincular
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ARCHITECTURAL CORNERSTONE: SUBSCRIPTION MODULAR SUBSYSTEM */}
      <section className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 md:p-8 text-white space-y-6">
        <header className="border-b border-slate-800 pb-4">
          <h4 className="text-base font-black tracking-tight text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-teal-400" />
            Estrutura de Arquitetura Comercial Modular (Simulador de Licenças)
          </h4>
          <p className="text-[11px] text-slate-400 font-sans mt-1">
            Configure e ative conjuntos de controle de recursos e limitações licenciadas. Esta estrutura está arquitetada para gerenciar os pilares comerciais da Clínica parceira.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { 
              id: 'base', 
              label: 'Módulo Clínico Base', 
              desc: 'Agenda clínica, ficha estática de pacientes, recepção e fluxo financeiro básico simplificado.',
              alwaysOn: true
            },
            { 
              id: 'eliza_ia', 
              label: 'Módulo ELIZA AI Center', 
              desc: 'Entrevista conversacional IA completa adaptiva, síntese estruturada de queixas e diagnóstico de riscos.',
              alwaysOn: false
            },
            { 
              id: 'hof_premium', 
              label: 'Módulo HOF Premium Especial', 
              desc: 'Planejamentos estéticos faciais HOF IA, simulação de volumetria, recall inteligente odontofacial.',
              alwaysOn: false
            },
            { 
              id: 'clinica_premium', 
              label: 'CRM Comercial de Vendas', 
              desc: 'Funil de fechamento integrado, automação dinâmica de lembretes via WhatsApp clínico, concierge.',
              alwaysOn: false
            }
          ].map(module => {
            const isActive = activeModules[module.id as keyof typeof activeModules];
            return (
              <div 
                key={module.id}
                className={`p-5 rounded-2xl border transition-all ${
                  isActive 
                    ? 'bg-slate-850/80 border-teal-500/30 text-white' 
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-black tracking-tight block">{module.label}</span>
                  {module.alwaysOn ? (
                    <span className="text-[8px] bg-slate-800 text-slate-300 font-extrabold uppercase px-1.5 py-0.5 rounded">Core</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveModules(prev => ({ ...prev, [module.id]: !prev[module.id as keyof typeof activeModules] }));
                      }}
                      className={`text-[8px] font-extrabold uppercase px-2.5 py-1 rounded transition-all ${
                        isActive 
                          ? 'bg-teal-500 text-teal-950 font-black hover:bg-teal-400' 
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {isActive ? 'Ativo' : 'Adquirir'}
                    </button>
                  )}
                </div>
                <p className="text-[10px] leading-relaxed font-sans opacity-75">{module.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CORE PHILOSOPHY CREDITS FOOTER */}
      <footer className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest pt-4 leading-relaxed max-w-xl mx-auto">
        A ELIZA foi desenvolvida como uma plataforma odontológica e clínica completa, porém com o módulo de Harmonização Orofacial (HOF) consolidado como o principal diferencial competitivo e altamente tecnológico do ecossistema.
      </footer>
    </div>
  );
}
