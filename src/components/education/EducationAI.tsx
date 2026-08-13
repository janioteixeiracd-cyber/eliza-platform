import React, { useState } from 'react';
import { 
  Sparkles, 
  Send, 
  HelpCircle, 
  BrainCircuit, 
  BookOpen, 
  Calendar, 
  AlertTriangle,
  Layers,
  Activity,
  ClipboardCheck,
  ChevronRight
} from 'lucide-react';
import { getGenAI } from '../../lib/gemini';

interface EducationAIProps {
  clinicId: string;
  courses: any[];
  onLogAction?: (log: any) => Promise<void>;
}

export default function EducationAI({
  clinicId,
  courses,
  onLogAction
}: EducationAIProps) {
  
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [usedTemplate, setUsedTemplate] = useState<string | null>(null);

  const aiTemplates = [
    {
      title: "Planejar Cronograma de Imersão",
      icon: Calendar,
      prompt: "Sugira um cronograma cronometrado detalhado passo-a-passo para um Curso de Imersão em Harmonização Orofacial de 2 dias (Sexta e Sábado, das 8h às 18h). Considere 6 alunos e 15 pacientes-modelo no total. Explique a divisão prática e teórica de cada hora.",
      desc: "Grade horária com distribuição de turmas e cirurgias/técnicas."
    },
    {
      title: "Lista de Insumos & Receitas",
      icon: Layers,
      prompt: "Elabore um checklist extensivo de insumos descartáveis, anestésicos, seringas, cânulas (especifique calibres), fios de tração e marcas recomendadas de ácidos hialurónicos necessários para abrir um módulo prático de Rinomodelação e Preenchimento Labial para 10 alunos.",
      desc: "Guia de compras e materiais por procedimento."
    },
    {
      title: "Gestão de Intercorrências Clínicas",
      icon: AlertTriangle,
      prompt: "Crie um protocolo clínico conciso e extremamente seguro para o professor ter em mãos na clínica-escola caso ocorra uma intercorrência vasoclusiva imediata após preenchimento com ácido hialurônico de ponta de nariz de paciente-modelo (Uso de hialuronidase, dosagens, compressas, acompanhamento).",
      desc: "Procedimento emergencial de segurança acadêmica."
    },
    {
      title: "Modelagem de Avaliação Prática",
      icon: ClipboardCheck,
      prompt: "CRIE UMA FICHA DE AVALIAÇÃO PRÁTICA (Rubrica de Notas) com critérios objetivos (Ex: Antissepsia, Ergonomia, Domínio Anatômico, Aspiração de Segurança, Simetria, Postura e Cuidados de Pós) para o professor avaliar um aluno aplicando toxina botulínica e preenchedores.",
      desc: "Critérios de notas para conselhos CRO/CRM."
    }
  ];

  const handleGenerateAI = async (textPrompt: string, templateTitle: string = "Custom Chat") => {
    if (!textPrompt.trim() || isLoading) return;
    setIsLoading(true);
    setResponse('');
    setUsedTemplate(templateTitle);
    
    try {
      console.log("[EDUCATION_AI] Querying Gemini model secure proxy with prompt:", textPrompt);
      const ai = getGenAI();
      const result = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [{ parts: [{ text: textPrompt }] }]
      });

      if (result && result.text) {
        setResponse(result.text);
        if (onLogAction) {
          await onLogAction({
            type: '[COURSE_AI_REQUEST]',
            details: `Consulta Inteligência Artificial: ${templateTitle}`
          });
        }
      } else {
        throw new Error("Resposta de IA vazia");
      }
    } catch (err: any) {
      console.error("[EDUCATION_AI_ERROR] Gemini call failed:", err);
      setResponse(`⚠️ Infelizmente o módulo de inteligência da ELIZA está instável no momento. Erro detalhado: ${err.message || String(err)}. Por favor, confirme se sua chave de API está configurada nas variáveis de ambiente na aba Configurações.`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Upper banner */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-8 rounded-[2rem] text-white text-left relative overflow-hidden shadow-md">
        <Sparkles className="absolute right-6 top-6 w-24 h-24 text-teal-500/10 animate-pulse pointer-events-none" />
        <div className="max-w-2xl space-y-2">
          <span className="px-3 py-1 bg-teal-500/15 border border-teal-500/20 text-teal-400 rounded-full text-[9px] font-black uppercase tracking-widest leading-none inline-block">
            ELIZA ACADEMIC INTELLIGENCE
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-1">Consultoria de IA para Cursos & Professores</h2>
          <p className="text-[11px] text-slate-400 leading-snug">
            Utilize os modelos de fronteira do Google Gemini integrados de forma segura para criar estruturas de cursos, cronogramas de imersões práticas de harmonização, checklists de estoque de clinicas-escola, termos legais e fichas de avaliação clínica rápidas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
        
        {/* Left pane: Templates choosing */}
        <div className="lg:col-span-5 space-y-4">
          <h3 className="text-xs font-black text-slate-850 uppercase tracking-widest">
            Prompt Sugestões & Templates
          </h3>
          
          <div className="space-y-3.5">
            {aiTemplates.map((tmpl, i) => (
              <div 
                key={i}
                onClick={() => {
                  setPrompt(tmpl.prompt);
                  handleGenerateAI(tmpl.prompt, tmpl.title);
                }}
                className="bg-white p-5 rounded-2xl border border-slate-200 cursor-pointer hover:border-teal-400 hover:shadow-sm transition-all text-left flex gap-4"
              >
                <div className="p-3 bg-teal-50 text-teal-700 rounded-xl shrink-0">
                  <tmpl.icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                    {tmpl.title}
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal font-semibold">{tmpl.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right pane: Custom Text Prompt and Output Result */}
        <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 flex flex-col justify-between space-y-6">
          
          {/* Custom Prompt Box */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
              <BrainCircuit className="w-4 h-4 text-teal-605" /> Faça Uma Pergunta Livre
            </h4>

            <div className="flex gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 pl-4">
              <input 
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleGenerateAI(prompt, "Custom Prompt");
                }}
                className="w-full bg-transparent text-xs font-bold outline-none text-slate-800 placeholder-slate-400 py-2.5"
                placeholder="Ex sugerido: Como balancear 4 alunos na clínica para atender 8 preenchimentos em 4 horas?"
              />
              <button 
                onClick={() => handleGenerateAI(prompt, "Custom Prompt")}
                disabled={!prompt.trim() || isLoading}
                className="p-3 bg-slate-900 border-none hover:bg-slate-800 text-white rounded-xl shrink-0 transition-all cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Response output body */}
          <div className="flex-1 min-h-[300px] bg-slate-50 border border-slate-150 rounded-2xl p-6 relative overflow-hidden text-slate-700">
            {isLoading ? (
              <div className="absolute inset-0 bg-white/70 flex flex-col justify-center items-center gap-3">
                <div className="w-8 h-8 border-4 border-slate-205 border-t-teal-605 rounded-full animate-spin" />
                <p className="text-xs font-bold text-teal-800 uppercase tracking-widest">ELIZA está formulando sua assessoria...</p>
              </div>
            ) : null}

            {response ? (
              <div className="space-y-4 text-left">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    RECOMENDAÇÃO: {usedTemplate}
                  </span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(response);
                      alert('Texto copiado para a Área de Trabalho!');
                    }}
                    className="p-1 px-2 border border-slate-200 rounded hover:bg-white text-[9px] font-bold uppercase tracking-wider"
                  >
                    Copiar Texto
                  </button>
                </div>

                <div className="text-xs font-semibold leading-relaxed overflow-y-auto max-h-[350px] custom-scrollbar pr-1 text-slate-655 space-y-2 whitespace-pre-wrap">
                  {response}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col justify-center items-center text-slate-400 text-center select-none py-12">
                <HelpCircle className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-xs italic font-semibold">Sem resposta carregada.</p>
                <p className="text-[10px] text-slate-400 max-w-xs mt-1">Selecione uma das fichas rápidas à esquerda ou digite sua queixa de estruturação pedagógica para gerar orientações automáticas com Inteligência Artificial.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
