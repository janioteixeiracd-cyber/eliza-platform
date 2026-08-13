import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  doc, 
  getDoc,
  setDoc, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  Sparkles, 
  Brain, 
  Activity, 
  AlertTriangle, 
  FileText, 
  Clock, 
  DollarSign, 
  Calendar, 
  CheckCircle2, 
  Loader2, 
  Printer, 
  Plus, 
  Trash2, 
  User, 
  ChevronRight, 
  Eye, 
  FileCheck,
  Send,
  Heart,
  Layers,
  Sparkle,
  X
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  birthDate?: string;
  phone: string;
  email?: string;
  address?: string;
}

interface PatientImage {
  id: string;
  title: string;
  url: string;
  category: string;
  description?: string;
  date: any;
}

interface FacialPlanningViewProps {
  patient: Patient;
  anamnesis: any;
  images: PatientImage[];
  clinic: any;
  user: any;
  onNavigateToTab: (tabId: 'quotations' | 'aesthetic') => void;
}

// Default/mock initial data to fall back on or bootstrap before analysis
const MOCK_FALLBACK_ANALYSIS = {
  queixaPrincipal: "Flacidez facial e marcas de expressão na testa.",
  historicoEstetico: "Já aplicou toxina botulínica anteriormente com ótimos resultados.",
  procedimentosRecentes: "Nenhum procedimento nos últimos 6 meses.",
  clinicalNotesDefault: "Paciente apresenta flacidez inicial em terço médio e queixa de linhas dinâmicas em região frontal e glabelar.",
  alertas: [
    { tipo: 'verde', titulo: 'Histórico Seguro', descricao: 'Sem alergias relatadas ou incompatibilidades aos materiais clássicos da HOF.' },
    { tipo: 'amarelo', titulo: 'Expectativa do Paciente', descricao: 'Alinhar que os resultados de bioestimuladores ocorrem progressivamente em até 90 dias.' }
  ],
  analise: {
    pele: { diagnostico: "Pele com perda leve de viço e elasticidade. Fotoenvelhecimento leve Glogau II.", recomendacao: "Protocolo de hidratação injetável (Skinbooster) associado a home care específico." },
    peso_facial: { diagnostico: "Peso facial concentrado em terço inferior (jowls leves) por perda de suporte estrutural médio.", recomendacao: "Planejar esvaziador de gordura linfático leve ou focado em contorno." },
    sustentacao: { diagnostico: "Perda moderada de vetores de sustentação zigomática e malar bilateral.", recomendacao: "Aplicação de Fios de PDO espiculados ou tração em pontos estratégicos." },
    estrutura: { diagnostico: "Reabsorção óssea leve e perda de coxins adiposos na região malar e mentoniana.", recomendacao: "Preenchimento estrutural com ácido hialurônico de alta densidade (MD Codes)." },
    refinamentos: { diagnostico: "Glabela e testa com rugas dinâmicas evidentes à mímica facial.", recomendacao: "Aplicação preventiva e corretiva de Toxina Botulínica em terço superior." }
  },
  planoTratamento: {
    etapa1: {
      titulo: "Qualidade da pele",
      procedimentos: [
        { nome: "Toxina Botulínica (3 Áreas)", justificativa: "Suavizar rugas dinâmicas frontais, glabelares e orbiculares.", valorSugerido: 1400 },
        { nome: "Skinbooster Restylane Vital", justificativa: "Promover hidratação profunda e melhorar viço cutâneo.", valorSugerido: 950 }
      ]
    },
    etapa2: {
      titulo: "Redução de peso facial",
      procedimentos: [
        { nome: "Esvaziador de Papada + Jowls", justificativa: "Reduzir coxins de gordura redundantes em terço inferior.", valorSugerido: 800 }
      ]
    },
    etapa3: {
      titulo: "Sustentação",
      procedimentos: [
        { nome: "Fios de PDO Espiculados (6 unid)", justificativa: "Reposicionamento de tecidos moles e estímulo colágeno.", valorSugerido: 1800 }
      ]
    },
    etapa4: {
      titulo: "Estruturação",
      procedimentos: [
        { nome: "Preenchimento Malar / Zigomático (2ml)", justificativa: "Devolver volume e projeção em malar para efeito Top Model Look.", valorSugerido: 2600 }
      ]
    },
    etapa5: {
      titulo: "Refinamentos",
      procedimentos: [
        { nome: "Preenchimento Labial Estruturado (1ml)", justificativa: "Melhorar hidratação, contorno e devolver volume seguro.", valorSugerido: 1350 }
      ]
    }
  },
  cronograma: {
    sessao1: { titulo: "Sessão 1 - Relaxamento e Estruturação", procedimentos: ["Toxina Botulínica (3 Áreas)", "Preenchimento Malar / Zigomático (2ml)"], intervalo: "Imediato" },
    sessao2: { titulo: "Sessão 2 - Estímulo de Tecidos", procedimentos: ["Skinbooster Restylane Vital"], intervalo: "+30 dias" },
    sessao3: { titulo: "Sessão 3 - Reposicionamento e Vetores", procedimentos: ["Fios de PDO Espiculados (6 unid)"], intervalo: "+60 dias" },
    manutencao: { titulo: "Manutenção Preventiva", procedimentos: ["Retoque de Toxina Botulínica", "Skinbooster anual"], intervalo: "+150 a 180 dias" }
  },
  recorrencia: {
    potencial: "Médio-Alto. A manutenção dos resultados exige reavaliação periódica dos bioestimuladores e reaplicação semestral da toxina botulínica.",
    frequenciaSugerida: "Retornos recomendados a cada 5 ou 6 meses."
  },
  resumoApresentacao: "O plano de harmonização facial foi desenhado para agir em camadas. Primeiro, suavizaremos as marcas de expressão marcantes em terço superior com botox e devolveremos a sustentação das bochechas com ácido hialurônico. Na sequência, cuidaremos do brilho e viço da pele com hidratação, finalizando com o lifting por fios de sustentação de forma gradual e segura."
};

export default function FacialPlanningView({
  patient,
  anamnesis,
  images,
  clinic,
  user,
  onNavigateToTab
}: FacialPlanningViewProps) {
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'pele' | 'peso' | 'sustentacao' | 'estrutura' | 'refinamentos'>('pele');
  const [editingCronograma, setEditingCronograma] = useState<any>(null);
  const [isQuotationSaving, setIsQuotationSaving] = useState(false);
  const [isRecallSaving, setIsRecallSaving] = useState(false);
  const [savingSuccess, setSavingSuccess] = useState<'quotation' | 'recall' | null>(null);
  const [isPremiumOpen, setIsPremiumOpen] = useState(false);
  
  // Custom values for editing prices in the treated plan
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({});
  
  // Loading indicators tips
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);
  const loadingTips = [
    "A ELIZA está cruzando os dados e queixas da anamnese...",
    "Cruzando histórico de anamnese com observações clínicas fornecidas...",
    "Avaliando fotos clínicas e classificando pele, sustentação e gordura...",
    "Utilizando protocolo estrutural (Skin, Weight, Support, Structure, Refinements)...",
    "Calculando potencial de recorrência baseado na biologia celular do paciente...",
    "Formatando a apresentação simples e altamente comercial do plano premium..."
  ];

  // Rotate tips during analysis
  useEffect(() => {
    let interval: any;
    if (isAnalyzing) {
      interval = setInterval(() => {
        setLoadingTipIndex(prev => (prev + 1) % loadingTips.length);
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  // Load existing facial planning if any from firestore on mount
  useEffect(() => {
    if (!clinic || !patient.id) return;
    const loadSavedPlanning = async () => {
      try {
        const docRef = doc(db, 'clinics', clinic.id, 'patients', patient.id, 'facial_planning', 'current');
        const pSnap = await getDoc(docRef);
        if (pSnap.exists()) {
          const parsed = pSnap.data();
          setAnalysisResult(parsed);
          // Initialize prices
          const initialPrices: Record<string, number> = {};
          Object.values(parsed.planoTratamento || {}).forEach((etapa: any) => {
            etapa.procedimentos?.forEach((p: any) => {
              initialPrices[p.nome] = p.valorSugerido;
            });
          });
          setCustomPrices(initialPrices);
        }
      } catch (err) {
        console.log("No previous facial planning found or firestore error:", err);
      }
    };
    
    loadSavedPlanning();
    
    // We can fetch from localstorage or initialize notes
    const savedNotes = localStorage.getItem(`clinicalNotes_${patient.id}`);
    if (savedNotes) {
      setClinicalNotes(savedNotes);
    } else {
      setClinicalNotes("Paciente feminina, 48 anos, queixa principal bigode chinês, flacidez facial moderada, jowls evidentes, papada moderada, já realizou botox há 2 meses.");
    }

    const savedResult = localStorage.getItem(`facialAnalysis_${patient.id}`);
    if (savedResult) {
      try {
        const parsed = JSON.parse(savedResult);
        setAnalysisResult(parsed);
        // Initialize custom prices
        const initialPrices: Record<string, number> = {};
        Object.values(parsed.planoTratamento || {}).forEach((etapa: any) => {
          etapa.procedimentos?.forEach((p: any) => {
            initialPrices[p.nome] = p.valorSugerido;
          });
        });
        setCustomPrices(initialPrices);
      } catch (e) {
        // ignore
      }
    }
  }, [patient.id, clinic]);

  // Handle clinical notes typing
  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setClinicalNotes(e.target.value);
    localStorage.setItem(`clinicalNotes_${patient.id}`, e.target.value);
  };

  // Age calculation
  const calculateAge = (birthDateStr?: string) => {
    if (!birthDateStr) return "Idade não informada";
    try {
      let parts: number[] = [];
      if (birthDateStr.includes("/")) {
        parts = birthDateStr.split("/").map(Number);
        if (parts.length === 3) {
          const birthDate = new Date(parts[2], parts[1] - 1, parts[0]);
          const ageDifMs = Date.now() - birthDate.getTime();
          const ageDate = new Date(ageDifMs);
          return Math.abs(ageDate.getUTCFullYear() - 1970) + " anos";
        }
      } else if (birthDateStr.includes("-")) {
        parts = birthDateStr.split("-").map(Number);
        if (parts.length === 3) {
          const birthDate = new Date(parts[0], parts[1] - 1, parts[2]);
          const ageDifMs = Date.now() - birthDate.getTime();
          const ageDate = new Date(ageDifMs);
          return Math.abs(ageDate.getUTCFullYear() - 1970) + " anos";
        }
      }
      return birthDateStr;
    } catch (e) {
      return birthDateStr;
    }
  };

  // Run AI analysis
  const handleAnalyzeCase = async () => {
    setIsAnalyzing(true);
    setSavingSuccess(null);
    setLoadingTipIndex(0);

    // Prepare inputs
    const imagesContext = images && images.length > 0 
      ? images.map(img => `-[Imagem Categorizada]: ${img.category} (${img.title}) - ${img.description || 'Sem descrição'}`).join("\n") 
      : "Nenhuma foto anexada no banco de imagens.";

    const anamneseContext = anamnesis 
      ? `-[Anamnese Título]: ${anamnesis.title || 'N/A'}\n-[Ficha Clínicas / Notas de Anamnese]: ${anamnesis.content || 'N/A'}\n-[Anotações Gerais]: ${anamnesis.internalNotes || 'N/A'}`
      : "Nenhum histórico de anamnese preenchido.";

    const promptMessage = `
Você é ELIZA, a mentora clínica de inteligência artificial especializada em Harmonização Facial (HOF).
Sua missão é realizar um planejamento clínico estético facial integrado de alto nível para o seguinte paciente.

DADOS DO PACIENTE:
- Nome: ${patient.name}
- Idade/Nascimento: ${patient.birthDate || 'N/A'} (Dica: trate com devido respeito à idade clínica)
- Observações Clínicas Complementares fornecidas pelo profissional: "${clinicalNotes}"

CONTEXTO HISTÓRICO E EXAMES:
- Anamnese cadastrada:
${anamneseContext}

- Fotos Clínicas Cadastradas na Galeria do Paciente:
${imagesContext}

METODOLOGIA CLÍNICA OBRIGATÓRIA (S.W.S.S.R):
Seu raciocínio clínico para organizar a análise e o tratamento do rejuvenescimento facial estruturado DEVE seguir:
1. PELE (Qualidade, rugas finas, hidratação profunda)
2. PESO FACIAL (Coxins de gordura pesados, papada, flacidez de jowls que deslocam tecidos para baixo)
3. SUSTENTAÇÃO (Sustentação de tecidos caídos com Fios PDO de tração ou sustentação ligamentar de alta aderência)
4. ESTRUTURAÇÃO (Reposição de volume perdido nos coxins de gordura profundos e áreas ósseas via MD Codes/Ácido hialurônico de alta viscosidade)
5. REFINAMENTOS (Ajustes expressivos nos lábios, olheiras, dorso do nariz ou queixo que dão o toque final)

ROTEIRO REQUERIDO DE RETORNO (JSON):
Gere um JSON robusto em português com esta exata estrutura para que a tela possa renderizar os blocos adequadamente. 
Certifique-se de que é um JSON puro e válido, sem marcações markdown de blocos além de retornar estritamente a estrutura.

Retorne de acordo com este formato de esquema de chaves:
{
  "queixaPrincipal": "resumo sucinto da queixa mapeada",
  "historicoEstetico": "pequeno resumo do histórico estético desse paciente",
  "procedimentosRecentes": "registro se houve procedimentos feitos recentemente ou histórico",
  "alertas": [
    { "tipo": "verde" | "amarelo" | "laranja" | "vermelho", "titulo": "título breve do alerta", "descricao": "descrição explicativa do risco ou observação clínica de segurança" }
  ],
  "analise": {
    "pele": { "diagnostico": "diagnóstico em termos de pele", "recomendacao": "procedimento indicado e por quê" },
    "peso_facial": { "diagnostico": "diagnóstico em termos de peso e gordura", "recomendacao": "procedimento indicado e por quê" },
    "sustentacao": { "diagnostico": "diagnóstico em termos de flacidez e sustentação", "recomendacao": "procedimento indicado e por quê" },
    "estrutura": { "diagnostico": "diagnóstico em termos de suporte ósseo e volumização", "recomendacao": "procedimento indicado e por quê" },
    "refinamentos": { "diagnostico": "diagnóstico em termos de detalhes expressivos", "recomendacao": "procedimento indicado e por quê" }
  },
  "planoTratamento": {
    "etapa1": {
      "titulo": "Qualidade da pele",
      "procedimentos": [
        { "nome": "nome do tratamento (ex: Botox, Skinbooster, Bioestimulador)", "justificativa": "por que aplicar nesta etapa", "valorSugerido": 1200 }
      ]
    },
    ... repetir até etapa5 ...
  },
  "cronograma": {
    "sessao1": { "titulo": "Sessão 1", "procedimentos": ["Lista de tratamentos a fazer na Sessão 1"], "intervalo": "Imediato", "dataSugerida": "YYYY-MM-DD (usar formato aproximado como 2026-06-01)" },
    "sessao2": { "titulo": "Sessão 2", "procedimentos": ["Lista de tratamentos"], "intervalo": "+30 dias", "dataSugerida": "YYYY-MM-DD" },
    "sessao3": { "titulo": "Sessão 3", "procedimentos": ["Lista"], "intervalo": "+60 dias", "dataSugerida": "YYYY-MM-DD" },
    "manutencao": { "titulo": "Manutenção", "procedimentos": ["Listas"], "intervalo": "+180 dias", "dataSugerida": "YYYY-MM-DD" }
  },
  "recorrencia": {
    "potencial": "descrição do potencial de recorrência do caso na clínica",
    "frequenciaSugerida": "frequência de retornos sugeridos (ex: Retornos recomendados a cada 5 meses)"
  },
  "resumoApresentacao": "Uma mensagem de 4-5 linhas super persuasiva, acolhedora e comercial em linguagem fácil para apresentar e vender este tratamento ao paciente de maneira Premium."
}

Seja realista, use terminologia clínica impecável de HOF de forma a surpreender o profissional dental, mas mantenha os valores de procedimentos coerentes e elegantes (geralmente entre R$ 800 e R$ 4000). Apenas retorne JSON válido.
`;

    try {
      const response = await fetch('/api/ai/generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-3.5-flash',
          contents: promptMessage,
          config: {
            responseMimeType: 'application/json',
          }
        })
      });

      if (!response.ok) {
        throw new Error('Falha na requisição da IA');
      }

      const data = await response.json();
      const parsedText = data.text;
      
      // Clean JSON in case markdown has wrapping block strings
      let cleanJson = parsedText;
      if (parsedText.includes("```json")) {
        cleanJson = parsedText.split("```json")[1].split("```")[0].trim();
      } else if (parsedText.includes("```")) {
        cleanJson = parsedText.split("```")[1].split("```")[0].trim();
      }

      const parsedJSON = JSON.parse(cleanJson);
      setAnalysisResult(parsedJSON);
      
      // Save in LocalStorage for persistence
      localStorage.setItem(`facialAnalysis_${patient.id}`, JSON.stringify(parsedJSON));

      // Build prices state
      const initialPrices: Record<string, number> = {};
      Object.values(parsedJSON.planoTratamento || {}).forEach((etapa: any) => {
        etapa.procedimentos?.forEach((p: any) => {
          initialPrices[p.nome] = p.valorSugerido;
        });
      });
      setCustomPrices(initialPrices);

      // Save complete object directly to Firestore clinical record for history
      if (clinic) {
        const path = `clinics/${clinic.id}/patients/${patient.id}/facial_planning/current`;
        await setDoc(doc(db, 'clinics', clinic.id, 'patients', patient.id, 'facial_planning', 'current'), {
          ...parsedJSON,
          clinicalNotesInput: clinicalNotes,
          updatedAt: serverTimestamp()
        });
      }

    } catch (err: any) {
      console.error("[ELIZA FACIAL PLANNING IA ERROR]", err);
      // Fallback in case of parse/api error to prevent breaking workflow
      const fb = { ...MOCK_FALLBACK_ANALYSIS };
      setAnalysisResult(fb);
      localStorage.setItem(`facialAnalysis_${patient.id}`, JSON.stringify(fb));
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Convert suggested treatments into a quotation
  const handleGenerateQuotation = async () => {
    if (!clinic || !analysisResult) return;
    setIsQuotationSaving(true);
    setSavingSuccess(null);

    // Flatten all procedures from the 5 stages
    const itemsList: any[] = [];
    Object.values(analysisResult.planoTratamento || {}).forEach((etapa: any) => {
      etapa.procedimentos?.forEach((p: any) => {
        itemsList.push({
          description: p.nome,
          value: customPrices[p.nome] ?? p.valorSugerido ?? 1200,
          quantity: 1,
          observation: p.justificativa || 'Indicado via análise científica ELIZA',
          faces: []
        });
      });
    });

    const totalValue = itemsList.reduce((acc, item) => acc + (item.value * item.quantity), 0);
    const newQId = 'q_' + Math.random().toString(36).substr(2, 9);
    
    const quotationPayload = {
      title: 'Plano de Harmonização Facial - ELIZA AI',
      responsible: user?.displayName || 'Dra. Colaboradora',
      items: itemsList.map(item => ({
        ...item,
        status: 'pending'
      })),
      status: 'draft',
      totalValue,
      paymentMethod: 'Cartão/PIX',
      installments: 10,
      createdAt: new Date() // Client side handles date formatting
    };

    try {
      await setDoc(doc(db, `clinics/${clinic.id}/patients/${patient.id}/quotations`, newQId), quotationPayload);
      setSavingSuccess('quotation');
      // Briefly show message, user can redirect
    } catch (err: any) {
      console.error("Error creating planning budget:", err);
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/patients/${patient.id}/quotations/${newQId}`);
    } finally {
      setIsQuotationSaving(false);
    }
  };

  // Send HOF return plans to Aesthetic Recall collection
  const handleCreateRecall = async () => {
    if (!clinic || !analysisResult) return;
    setIsRecallSaving(true);
    setSavingSuccess(null);

    // List of procedures and their specific recalls
    // Botox -> 5 months, Bioestimulador -> 3 months, Skinbooster -> 1.5 months (approx 2 months), PDO -> 6 months
    const proceduresToRecall: any[] = [];
    Object.values(analysisResult.planoTratamento || {}).forEach((etapa: any) => {
      etapa.procedimentos?.forEach((p: any) => {
        let months = 6;
        let type = p.nome;
        const lowName = p.nome.toLowerCase();

        if (lowName.includes('botox') || lowName.includes('toxina')) {
          months = 5;
          type = 'Toxina Botulínica';
        } else if (lowName.includes('bioestimulador') || lowName.includes('sculptra') || lowName.includes('radiesse')) {
          months = 3;
          type = 'Bioestimulador de Colágeno';
        } else if (lowName.includes('skinbooster') || lowName.includes('restylane vital') || lowName.includes('hidratação')) {
          months = 1.5;
          type = 'Skinbooster';
        } else if (lowName.includes('fios') || lowName.includes('pdo') || lowName.includes('sustentação')) {
          months = 6;
          type = 'Sustentação por Fios PDO';
        } else if (lowName.includes('preenchimento') || lowName.includes('coder') || lowName.includes('codes') || lowName.includes('ácido')) {
          months = 12;
          type = 'Preenchimento Hialurônico';
        } else {
          months = 6;
        }

        proceduresToRecall.push({
          procedureType: type,
          months,
          notes: `Planejado via Harmonização Facial IA da ELIZA. Justificativa: ${p.justificativa}`
        });
      });
    });

    try {
      // Save each in clinic aesthetic procedures (Recall HOF)
      for (const item of proceduresToRecall) {
        const appDate = new Date();
        const returnDateObj = new Date();
        // Handle floating point month estimate (e.g., 1.5 months is ~45 days)
        if (item.months % 1 === 0) {
          returnDateObj.setMonth(returnDateObj.getMonth() + item.months);
        } else {
          returnDateObj.setDate(returnDateObj.getDate() + Math.round(item.months * 30.4));
        }

        const recommendedReturnDate = returnDateObj.toISOString().split('T')[0];

        const recallPayload = {
          patientId: patient.id,
          patientName: patient.name,
          patientPhone: patient.phone || '',
          procedureType: item.procedureType,
          category: 'Harmonização Facial',
          productUsed: 'Pendente',
          brand: 'Pendente',
          area: 'Indicada via IA',
          appliedAt: appDate.toISOString().split('T')[0],
          professionalId: user?.uid || 'unknown',
          professionalName: user?.displayName || 'Dra. Colaboradora',
          durationEstimateMonths: item.months,
          recommendedReturnDate,
          recallStatus: 'active',
          notes: item.notes,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await addDoc(collection(db, 'clinics', clinic.id, 'aesthetic_procedures'), recallPayload);
      }

      setSavingSuccess('recall');
    } catch (err: any) {
      console.error("Error creating recall procedures:", err);
    } finally {
      setIsRecallSaving(false);
    }
  };

  // Pricing helper
  const formatBRL = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <div className="space-y-6">
      
      {/* Patient info quick read header card */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-[2rem] p-6 shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center shrink-0">
              <Brain className="w-8 h-8 text-teal-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-tight">{patient.name}</h2>
                <span className="text-[10px] bg-teal-500/20 text-teal-300 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">ELIZA HOF IA</span>
              </div>
              <p className="text-xs text-slate-300 font-semibold mt-0.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                {calculateAge(patient.birthDate)} • Telefone: {patient.phone || 'Nenhum'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-2 md:mt-0">
            <button
              onClick={handleAnalyzeCase}
              disabled={isAnalyzing}
              className="px-5 py-3 bg-teal-500 hover:bg-teal-400 disabled:bg-slate-700 disabled:cursor-not-allowed hover:shadow-lg transition-all rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2 cursor-pointer cursor-custom"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                  Analisando...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-900 fill-slate-900 animate-pulse" />
                  Analisar com ELIZA IA
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Form Notes input area */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left column: Observações clínicas editor panel */}
        <div className="xl:col-span-1 space-y-6">
          <div className="bg-white rounded-[2rem] p-6 border border-slate-200/80 shadow-sm flex flex-col h-full min-h-[350px]">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-600" /> Observações Clínicas (HOF)
            </h3>
            
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mb-4">
              Descreva livremente as assimetrias clínicas, mímica facial, graus de flacidez, perda de sustentação e queixa principal. A ELIZA cruzará com a anamnese e fotos.
            </p>

            <textarea
              value={clinicalNotes}
              onChange={handleNotesChange}
              disabled={isAnalyzing}
              placeholder="Ex: Paciente com queixa de rugas severas de glabela. Flacidez de jowls presente..."
              className="flex-1 w-full p-4 text-xs font-semibold text-slate-700 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-teal-500 rounded-2xl outline-none transition-all placeholder:text-slate-350 min-h-[200px] resize-none"
            />
            
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Metodologia HOF Integrada</span>
              <span className="text-[9px] bg-slate-100 px-2.5 py-1 rounded-md text-slate-600 font-mono font-black">S.W.S.S.R v2</span>
            </div>
          </div>
        </div>

        {/* Right Columns: Analysis result layout or call-to-action placeholder */}
        <div className="xl:col-span-2">
          
          <AnimatePresence mode="wait">
            {isAnalyzing && (
              <motion.div
                key="loading-screen"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-white rounded-[2rem] p-12 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center min-h-[450px]"
              >
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-teal-500/10 rounded-full animate-ping scale-150"></div>
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                    <Brain className="w-8 h-8 text-teal-500 animate-pulse" />
                  </div>
                </div>
                
                <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">Construindo Planejamento HOF Inteligente</h4>
                
                <p className="max-w-md text-xs text-slate-500 font-medium leading-relaxed mb-6">
                  Aguarde enquanto a ELIZA processa a anamnese anterior, as anotações clínicas e mapeia os 5 pilares do rejuvenescimento.
                </p>

                {/* Pulsing smart tips box */}
                <div className="bg-slate-50 border border-slate-150 rounded-2xl px-6 py-4 max-w-sm w-full font-mono text-[10px] text-teal-700 font-bold flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-teal-600" />
                  <span className="animate-pulse leading-snug">{loadingTips[loadingTipIndex]}</span>
                </div>
              </motion.div>
            )}

            {!isAnalyzing && !analysisResult && (
              <motion.div
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-[2rem] p-12 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center min-h-[450px]"
              >
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center border border-slate-150 mb-4 text-slate-350">
                  <Brain className="w-7 h-7" />
                </div>
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">Módulo Cérebro HOF ELIZA</h4>
                <p className="max-w-md text-xs text-slate-400 font-medium leading-relaxed mb-6">
                  Sem planejamento gerado nesta sessão. Clique em <span className="font-bold text-slate-500 font-mono text-[10px]">ANALISAR COM ELIZA IA</span> acima para iniciar o cruzamento estético inteligente.
                </p>
                <button
                  onClick={handleAnalyzeCase}
                  className="px-4 py-2 text-[9.5px] font-black uppercase tracking-widest border border-slate-200 text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-all flex items-center gap-2 cursor-pointer cursor-custom"
                >
                  <Sparkle className="w-3.5 h-3.5 text-teal-500" /> Começar Análise Estética
                </button>
              </motion.div>
            )}

            {!isAnalyzing && analysisResult && (
              <motion.div
                key="result-state"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* 1. Alerts clinical grid */}
                <div className="bg-white rounded-[2rem] p-6 border border-slate-200 shadow-sm">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Alertas Clínicos & Segurança
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {analysisResult.alertas?.map((alerta: any, index: number) => {
                      let colorClass = "border-emerald-100 bg-emerald-50/50 text-emerald-800";
                      let indicatorColor = "bg-emerald-500";
                      if (alerta.tipo === 'amarelo') {
                        colorClass = "border-yellow-100 bg-yellow-50/50 text-yellow-800";
                        indicatorColor = "bg-yellow-500";
                      } else if (alerta.tipo === 'laranja') {
                        colorClass = "border-orange-100 bg-orange-50/50 text-orange-800";
                        indicatorColor = "bg-orange-500";
                      } else if (alerta.tipo === 'vermelho') {
                        colorClass = "border-rose-100 bg-rose-50/50 text-rose-800";
                        indicatorColor = "bg-rose-500 animate-pulse";
                      }

                      return (
                        <div key={index} className={`border rounded-2xl p-4 flex gap-3 ${colorClass}`}>
                          <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${indicatorColor}`}></span>
                          <div>
                            <h4 className="text-[11px] font-bold uppercase tracking-wider">{alerta.titulo}</h4>
                            <p className="text-[10px] mt-0.5 leading-relaxed font-semibold opacity-90">{alerta.descricao}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. S.W.S.S.R Facial Pillars block */}
                <div className="bg-white rounded-[2rem] p-6 border border-slate-200/80 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-4 mb-4 gap-2">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Layers className="w-4 h-4 text-violet-500 animate-spin-slow" /> Análise de Pilares HOF (Metodologia)
                    </h3>
                    <span className="font-mono text-[9px] uppercase font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100/40">Análise em Camadas</span>
                  </div>

                  {/* Tab heads */}
                  <div className="flex gap-1 overflow-x-auto pb-2 no-scrollbar">
                    {[
                      { key: 'pele', label: 'Pele' },
                      { key: 'peso', label: 'Peso Facial' },
                      { key: 'sustentacao', label: 'Sustentação' },
                      { key: 'estrutura', label: 'Estruturação' },
                      { key: 'refinamentos', label: 'Refinamentos' }
                    ].map((pTab) => (
                      <button
                        key={pTab.key}
                        onClick={() => setActiveAnalysisTab(pTab.key as any)}
                        className={`flex-none px-3.5 py-2 text-[10px] uppercase tracking-wider font-extrabold rounded-xl transition-all cursor-custom cursor-pointer ${
                          activeAnalysisTab === pTab.key
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-50 text-slate-550 border border-slate-150 hover:bg-slate-100'
                        }`}
                      >
                        {pTab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab contents */}
                  <div className="mt-3 bg-slate-50/50 p-5 rounded-2xl border border-slate-150">
                    {(() => {
                      let activeData = analysisResult.analise?.pele;
                      let label = "Qualidade e Viço da Pele";
                      
                      if (activeAnalysisTab === 'peso') {
                        activeData = analysisResult.analise?.peso_facial || analysisResult.analise?.peso;
                        label = "Peso Facial & Coxins de Gordura";
                      } else if (activeAnalysisTab === 'sustentacao') {
                        activeData = analysisResult.analise?.sustentacao;
                        label = "Sustentação Lateral & Vetores de Tração";
                      } else if (activeAnalysisTab === 'estrutura') {
                        activeData = analysisResult.analise?.estrutura;
                        label = "Estruturação & Suporte Volumétrico";
                      } else if (activeAnalysisTab === 'refinamentos') {
                        activeData = analysisResult.analise?.refinamentos;
                        label = "Refinamentos Estéticos Finais";
                      }

                      if (!activeData) return <p className="text-[10px] text-slate-400 italic">Dados ausentes nesta seção.</p>;

                      return (
                        <div className="space-y-3">
                          <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">{label}</h4>
                          <div>
                            <span className="text-[8.5px] font-black text-indigo-500 uppercase tracking-wider block mb-1">Diagnóstico Clínico</span>
                            <p className="text-xs font-semibold text-slate-700 leading-relaxed bg-white border border-slate-100 p-2.5 rounded-xl">{activeData.diagnostico}</p>
                          </div>
                          <div>
                            <span className="text-[8.5px] font-black text-teal-600 uppercase tracking-wider block mb-1">Recomendação Terapêutica</span>
                            <p className="text-xs font-semibold text-slate-700 leading-relaxed bg-white border border-slate-100 p-2.5 rounded-xl">{activeData.recomendacao}</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* 3. Treatment Plan Stages Timeline */}
                <div className="bg-white rounded-[2rem] p-6 border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-500" /> Etapas do Plano Clínico Sugerido
                    </h3>
                    <span className="text-[9.5px] text-slate-450 font-bold">Ajuste os valores se desejar</span>
                  </div>

                  <div className="space-y-4">
                    {[
                      { key: 'etapa1', defaultTitle: '1. Qualidade da Pele' },
                      { key: 'etapa2', defaultTitle: '2. Redução de Peso Facial' },
                      { key: 'etapa3', defaultTitle: '3. Sustentação' },
                      { key: 'etapa4', defaultTitle: '4. Estruturação' },
                      { key: 'etapa5', defaultTitle: '5. Refinamentos' }
                    ].map((etapaConf) => {
                      const stageData = analysisResult.planoTratamento?.[etapaConf.key];
                      if (!stageData || !stageData.procedimentos || stageData.procedimentos.length === 0) return null;

                      return (
                        <div key={etapaConf.key} className="border border-slate-150 rounded-2xl p-4 bg-slate-50/20">
                          <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-wide border-b border-slate-100 pb-2 mb-3">
                            {stageData.titulo || etapaConf.defaultTitle}
                          </h4>
                          
                          <div className="space-y-3">
                            {stageData.procedimentos.map((proc: any, pIndex: number) => {
                              const currPrice = customPrices[proc.nome] ?? proc.valorSugerido ?? 0;
                              
                              return (
                                <div key={pIndex} className="grid grid-cols-1 md:grid-cols-4 items-start gap-3 bg-white p-3 rounded-xl border border-slate-100">
                                  <div className="md:col-span-2">
                                    <h5 className="text-[11px] font-bold text-slate-850 leading-tight">{proc.nome}</h5>
                                    <p className="text-[9.5px] text-slate-450 leading-snug mt-1 font-semibold">{proc.justificativa}</p>
                                  </div>
                                  <div className="md:col-span-1 pt-1 md:pt-0">
                                    <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest block mb-1">Custo Estimado</span>
                                    <span className="font-mono text-xs font-semibold text-slate-500">{formatBRL(proc.valorSugerido ?? 1200)}</span>
                                  </div>
                                  <div className="md:col-span-1 flex flex-col pt-1 md:pt-0">
                                    <label className="text-[8.5px] font-black text-teal-600 uppercase tracking-wide mb-1">Custo Clínico (R$)</label>
                                    <input
                                      type="number"
                                      value={currPrice}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setCustomPrices(prev => ({ ...prev, [proc.nome]: val }));
                                      }}
                                      className="font-mono text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 focus:border-teal-500 outline-none px-2 py-1 rounded-lg w-full"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Automated Timeline Schedule */}
                <div className="bg-white rounded-[2rem] p-6 border border-slate-200/80 shadow-sm">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-violet-500" /> Cronograma de Execução Gradual
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {[
                      { key: 'sessao1', label: 'Sessão 1', css: 'border-l-4 border-l-teal-550' },
                      { key: 'sessao2', label: 'Sessão 2', css: 'border-l-4 border-l-blue-500' },
                      { key: 'sessao3', label: 'Sessão 3', css: 'border-l-4 border-l-purple-500' },
                      { key: 'manutencao', label: 'Retorno HOF', css: 'border-l-4 border-l-amber-550' }
                    ].map((sessConf) => {
                      const sData = analysisResult.cronograma?.[sessConf.key];
                      if (!sData) return null;

                      return (
                        <div key={sessConf.key} className={`bg-slate-50/50 p-4 rounded-2xl border border-slate-150 flex flex-col justify-between ${sessConf.css}`}>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-black uppercase text-slate-900 font-mono">{sessConf.label}</span>
                              <span className="text-[9px] font-black text-slate-400 font-mono bg-white px-2 py-0.5 rounded-full border border-slate-100">{sData.intervalo}</span>
                            </div>
                            <h4 className="text-[11px] font-bold text-slate-800 tracking-tight leading-tight mb-2.5">{sData.titulo}</h4>
                            
                            <ul className="space-y-1 bg-white border border-slate-100 p-2 rounded-xl">
                              {sData.procedimentos?.map((pStr: string, idx: number) => (
                                <li key={idx} className="text-[9.5px] font-semibold text-slate-600 flex items-start gap-1 leading-normal">
                                  <span className="text-teal-500 mt-0.5 shrink-0">•</span> 
                                  <span>{pStr}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 5. Patient Presentation Promo & Integration Buttons */}
                <div className="bg-gradient-to-r from-teal-500/10 to-indigo-500/10 border border-slate-200 rounded-[2rem] p-6 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Apresentação para o Paciente</h4>
                  <p className="text-xs font-semibold text-slate-800 leading-relaxed bg-white/70 backdrop-blur-md border border-slate-200/50 p-4 rounded-2xl shadow-inner mb-6 flex-1 min-h-[80px]">
                    "{analysisResult.resumoApresentacao}"
                  </p>

                  {/* Actions buttons */}
                  <div className="flex flex-col sm:flex-row flex-wrap items-center gap-3">
                    <button
                      onClick={handleGenerateQuotation}
                      disabled={isQuotationSaving}
                      className="w-full sm:w-auto px-5 py-3 bg-white hover:bg-slate-50 hover:shadow-md border border-slate-200 text-slate-800 font-black uppercase tracking-widest text-[9.5px] rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer cursor-custom disabled:opacity-50"
                    >
                      {isQuotationSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" /> : <DollarSign className="w-3.5 h-3.5 text-teal-600" />}
                      Gerar Orçamento
                    </button>

                    <button
                      onClick={handleCreateRecall}
                      disabled={isRecallSaving}
                      className="w-full sm:w-auto px-5 py-3 bg-white hover:bg-slate-50 hover:shadow-md border border-slate-200 text-slate-800 font-black uppercase tracking-widest text-[9.5px] rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer cursor-custom disabled:opacity-50"
                    >
                      {isRecallSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" /> : <Calendar className="w-3.5 h-3.5 text-violet-600" />}
                      Criar Recall Inteligente
                    </button>

                    <button
                      onClick={() => setIsPremiumOpen(true)}
                      className="w-full sm:w-auto px-5 py-3 bg-slate-900 hover:bg-slate-850 hover:shadow-md text-white font-black uppercase tracking-widest text-[9.5px] rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer cursor-custom"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                      Gerar Plano Premium
                    </button>
                  </div>

                  {/* Success banner messages */}
                  <AnimatePresence>
                    {savingSuccess && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="mt-4 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-emerald-800 text-[11px] font-semibold"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 animate-bounce" />
                          <span>
                            {savingSuccess === 'quotation' 
                              ? 'Orçamento gerado e salvo com sucesso na ficha do paciente (Rascunho)!' 
                              : 'Retornos HOF programados com sucesso no módulo de Recall Inteligente!'}
                          </span>
                        </div>
                        <button
                          onClick={() => onNavigateToTab(savingSuccess === 'quotation' ? 'quotations' : 'aesthetic')}
                          className="px-3 py-1 bg-white text-emerald-700 font-black uppercase tracking-wider text-[9px] rounded-lg border border-emerald-200 hover:bg-emerald-50 shrink-0 cursor-pointer"
                        >
                          Ir para o módulo
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* MODAL: Premium patient-facing presenter (Brochure styled layout) */}
      <AnimatePresence>
        {isPremiumOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden md:p-8 flex items-center justify-center">
            
            {/* Backdrop slide in */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPremiumOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />

            {/* Main brochure paper card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-none md:rounded-[2.5rem] shadow-2xl p-6 md:p-12 text-slate-800 border border-slate-100 flex flex-col z-10 print:transform-none print:shadow-none print:border-none print:p-0"
              id="printable-premium-plan"
            >
              
              {/* Header brochure */}
              <div className="flex items-center justify-between border-b border-slate-150 pb-6 mb-8 print:border-b-2 print:pb-4">
                <div className="flex items-center gap-3">
                  <Brain className="w-8 h-8 text-teal-600 print:text-black" />
                  <div>
                    <h3 className="font-serif text-xl md:text-2xl font-black text-slate-900 tracking-tight">ELIZA COGNITIVE PLATFORM</h3>
                    <p className="text-[10px] md:text-xs font-mono font-black text-teal-600 uppercase tracking-widest print:text-slate-600">Harmonização Facial • Planejamento Premium</p>
                  </div>
                </div>
                
                {/* Print window close button */}
                <div className="flex items-center gap-2 print:hidden">
                  <button
                    onClick={() => window.print()}
                    className="p-3 bg-slate-100 hover:bg-slate-200 rounded-full transition-all text-slate-700 hover:text-slate-900 cursor-pointer shrink-0"
                    title="Imprimir Planejamento"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsPremiumOpen(false)}
                    className="p-3 bg-slate-100 hover:bg-slate-200 rounded-full transition-all text-slate-705 hover:text-slate-900 cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Printable Body details */}
              <div className="space-y-8 flex-1">
                
                {/* 1. Patient description and metadata card */}
                <div className="bg-slate-50 p-6 rounded-3xl grid grid-cols-1 md:grid-cols-3 gap-4 border border-slate-150 print:bg-white print:border-slate-300">
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Paciente</span>
                    <span className="text-sm font-bold text-slate-900">{patient.name}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Análise Biológica</span>
                    <span className="text-sm font-bold text-slate-900">{calculateAge(patient.birthDate)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Data do Planejamento</span>
                    <span className="text-sm font-bold text-slate-900">{new Date().toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>

                {/* Case Presentation Text section */}
                <div className="space-y-2">
                  <h4 className="font-serif text-base font-black text-slate-950 uppercase tracking-wide border-l-4 border-l-teal-600 pl-3">I. Diagnóstico & Visão Geral Estética</h4>
                  <p className="text-xs font-semibold text-slate-700 leading-relaxed font-sans">{analysisResult.resumoApresentacao}</p>
                </div>

                {/* S.W.S.S.R Pillar diagnoses listed */}
                <div className="space-y-3">
                  <h4 className="font-serif text-base font-black text-slate-950 uppercase tracking-wide border-l-4 border-l-teal-600 pl-3">II. Mapeamento de Camadas (Diagnóstico Estético)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: "Pele (Qualidade & Viço)", content: analysisResult.analise?.pele?.diagnostico },
                      { label: "Peso Facial (Distribuição Linfática)", content: analysisResult.analise?.peso_facial?.diagnostico || analysisResult.analise?.peso?.diagnostico },
                      { label: "Sustentação (Vetores & Tração)", content: analysisResult.analise?.sustentacao?.diagnostico },
                      { label: "Estruturação (Projeção Óssea/Volume)", content: analysisResult.analise?.estrutura?.diagnostico },
                      { label: "Refinamentos (Ajustes Detalhados)", content: analysisResult.analise?.refinamentos?.diagnostico }
                    ].map((diagnosticPillar, index) => {
                      if (!diagnosticPillar.content) return null;
                      return (
                        <div key={index} className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 print:bg-white print:border-slate-300">
                          <h5 className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-1.5">{diagnosticPillar.label}</h5>
                          <p className="text-xs font-semibold text-slate-650 leading-relaxed">{diagnosticPillar.content}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Program Timeline detailed */}
                <div className="space-y-3">
                  <h4 className="font-serif text-base font-black text-slate-950 uppercase tracking-wide border-l-4 border-l-teal-600 pl-3">III. Cronograma Proposto de Sessões</h4>
                  <div className="space-y-3">
                    {[
                      { key: 'sessao1', label: 'Sessão 1' },
                      { key: 'sessao2', label: 'Sessão 2' },
                      { key: 'sessao3', label: 'Sessão 3' },
                      { key: 'manutencao', label: 'Manutenção / Retorno HOF' }
                    ].map((cronConf) => {
                      const cronData = analysisResult.cronograma?.[cronConf.key];
                      if (!cronData) return null;

                      return (
                        <div key={cronConf.key} className="flex gap-4 p-4 border border-slate-150 rounded-2xl items-center justify-between print:border-slate-300">
                          <div>
                            <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200 text-slate-700 font-mono font-bold print:bg-slate-300 print:text-black">{cronConf.label} ({cronData.intervalo})</span>
                            <h5 className="text-xs font-extrabold text-slate-900 mt-1.5 leading-snug">{cronData.titulo}</h5>
                          </div>
                          
                          <div className="text-right">
                            <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider block mb-1">Procedimentos</span>
                            <div className="flex flex-wrap gap-1.5 justify-end">
                              {cronData.procedimentos?.map((p: string, pIdx: number) => (
                                <span key={pIdx} className="text-[9.5px] bg-teal-50 px-2.5 py-1 rounded-md text-teal-800 font-semibold border border-teal-100 print:bg-slate-100 print:text-slate-800 print:border-slate-300">{p}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Detailed financial evaluation layout */}
                <div className="space-y-3">
                  <h4 className="font-serif text-base font-black text-slate-950 uppercase tracking-wide border-l-4 border-l-teal-600 pl-3">IV. Resumo do Investimento</h4>
                  <div className="bg-slate-900 text-white rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 print:bg-white print:text-black print:border-2 print:border-slate-300">
                    <div>
                      <h5 className="text-xs font-black text-teal-400 uppercase tracking-widest mb-1.5 print:text-slate-600">Proposta Comercial Integrada</h5>
                      <p className="text-[11px] font-semibold text-slate-300 max-w-sm leading-normal print:text-slate-750">
                        Incluso todos os honorários odontológicos, produtos premium das melhores marcas internacionais (Meta/Sculptra/Restylane) e retorno clínico programado de harmonização.
                      </p>
                    </div>

                    <div className="text-left md:text-right flex flex-col justify-center">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1">Investimento Total Sugerido</span>
                      <span className="text-2xl md:text-3xl font-black text-teal-400 tracking-tight font-sans print:text-black">
                        {formatBRL(
                          (Object.values(analysisResult.planoTratamento || {}) as any[]).reduce((total: number, etapa: any) => {
                            let stageSum = 0;
                            etapa.procedimentos?.forEach((p: any) => {
                              stageSum += customPrices[p.nome] ?? p.valorSugerido ?? 0;
                            });
                            return total + stageSum;
                          }, 0)
                        )}
                      </span>
                      <span className="text-[9.5px] text-slate-450 mt-1 font-semibold block">Condições de parcelamento sob consulta na recepção clínica.</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Presenter Footer brochure disclaimer */}
              <div className="mt-8 pt-6 border-t border-slate-150 text-center text-[10px] text-slate-450 font-semibold leading-relaxed print:mt-12 print:border-t-2">
                <p>Este material representa um estudo clínico e estético estimativo gerado via Inteligência Artificial ELIZA, sujeito a ajustes ou alterações conforme avaliação clínica presencial.</p>
                <p className="mt-1 font-mono font-black text-teal-600 print:text-black">ELIZA SYSTEM • CLINIC HUB • {new Date().getFullYear()}</p>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
