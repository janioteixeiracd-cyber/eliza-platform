import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain, Search, Sparkles, AlertTriangle, Loader2, RefreshCw, Calendar,
  DollarSign, Activity, Layers, Printer, CheckCircle2, X, Save
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDoc, secureGetDocs } from '../services/next-db';
import { collection, query, limit, addDoc, setDoc, doc as fsDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';

interface PatientLite { id: string; name: string; birthDate?: string; phone?: string; }
interface PatientImage { id: string; title: string; category: string; description?: string; }

interface AnamnesisData {
  medicalTreatment?: string;
  allergies?: string;
  medications?: string;
  conditions?: string;
  healingIssues?: string;
  hemorrhage?: string;
  habits?: string;
}

const ANAMNESIS_FIELDS: { label: string; name: keyof AnamnesisData }[] = [
  { label: 'Tratamento Médico?', name: 'medicalTreatment' },
  { label: 'Alergias?', name: 'allergies' },
  { label: 'Medicação Contínua?', name: 'medications' },
  { label: 'Condições (Diabetes/Cardíaco)?', name: 'conditions' },
  { label: 'Cicatrização?', name: 'healingIssues' },
  { label: 'Hemorragia?', name: 'hemorrhage' },
  { label: 'Hábitos (Fumo/Álcool)?', name: 'habits' },
];

interface AlertItem { tipo: 'verde' | 'amarelo' | 'laranja' | 'vermelho'; titulo: string; descricao: string; }
interface PillarAnalysis { diagnostico: string; recomendacao: string; }
interface Procedure { nome: string; justificativa: string; valorSugerido: number; }
interface Stage { titulo: string; procedimentos: Procedure[]; }
interface Session { titulo: string; procedimentos: string[]; intervalo: string; }

interface FacialPlan {
  queixaPrincipal: string;
  historicoEstetico: string;
  procedimentosRecentes: string;
  alertas: AlertItem[];
  analise: { pele: PillarAnalysis; peso_facial: PillarAnalysis; sustentacao: PillarAnalysis; estrutura: PillarAnalysis; refinamentos: PillarAnalysis; };
  planoTratamento: { etapa1: Stage; etapa2: Stage; etapa3: Stage; etapa4: Stage; etapa5: Stage; };
  cronograma: { sessao1: Session; sessao2: Session; sessao3: Session; manutencao: Session; };
  recorrencia: { potencial: string; frequenciaSugerida: string; };
  resumoApresentacao: string;
  clinicalNotesInput?: string;
  updatedAt?: any;
}

const ALERT_META: Record<string, string> = {
  verde: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success',
  amarelo: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight',
  laranja: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
  vermelho: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert',
};

const PILLAR_TABS: { key: keyof FacialPlan['analise']; label: string }[] = [
  { key: 'pele', label: 'Pele' },
  { key: 'peso_facial', label: 'Peso Facial' },
  { key: 'sustentacao', label: 'Sustentação' },
  { key: 'estrutura', label: 'Estruturação' },
  { key: 'refinamentos', label: 'Refinamentos' },
];

const STAGE_KEYS: (keyof FacialPlan['planoTratamento'])[] = ['etapa1', 'etapa2', 'etapa3', 'etapa4', 'etapa5'];
const SESSION_KEYS: { key: keyof FacialPlan['cronograma']; label: string }[] = [
  { key: 'sessao1', label: 'Sessão 1' }, { key: 'sessao2', label: 'Sessão 2' }, { key: 'sessao3', label: 'Sessão 3' }, { key: 'manutencao', label: 'Manutenção' },
];

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function recallMonthsFor(name: string): { months: number; type: string } {
  const s = name.toLowerCase();
  if (s.includes('botox') || s.includes('toxina')) return { months: 5, type: 'Toxina Botulínica' };
  if (s.includes('bioestimulador') || s.includes('sculptra') || s.includes('radiesse')) return { months: 3, type: 'Bioestimulador de Colágeno' };
  if (s.includes('skinbooster') || s.includes('restylane vital') || s.includes('hidratação')) return { months: 1.5, type: 'Skinbooster' };
  if (s.includes('fios') || s.includes('pdo') || s.includes('sustentação')) return { months: 6, type: 'Sustentação por Fios PDO' };
  if (s.includes('preenchimento') || s.includes('codes') || s.includes('ácido')) return { months: 12, type: 'Preenchimento Hialurônico' };
  return { months: 6, type: name };
}

export default function NextFacialPlanning() {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const [anamnesis, setAnamnesis] = useState<AnamnesisData | null>(null);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [clinicalNotes, setClinicalNotes] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [plan, setPlan] = useState<FacialPlan | null>(null);
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({});
  const [activePillar, setActivePillar] = useState<keyof FacialPlan['analise']>('pele');

  const [savingQuotation, setSavingQuotation] = useState(false);
  const [savingRecall, setSavingRecall] = useState(false);

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 5000);
  }

  useEffect(() => {
    async function loadPatients() {
      if (!clinic?.id) return;
      setLoadingPatients(true);
      try {
        const patRef = collection(db, 'clinics', clinic.id, 'patients');
        const patSnap = await secureGetDocs(query(patRef, limit(300)), 'patients', { addAuditLog });
        setPatients(patSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load patients:', err);
      } finally {
        setLoadingPatients(false);
      }
    }
    loadPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  const selectedPatient = patients.find(p => p.id === selectedPatientId) || null;

  useEffect(() => {
    async function loadRecord() {
      if (!clinic?.id || !selectedPatientId) return;
      setLoadingRecord(true);
      setPlan(null);
      setAnalysisError(null);
      try {
        const patientRoot = ['clinics', clinic.id, 'patients', selectedPatientId] as const;
        const anamnesisSnap = await secureGetDoc<AnamnesisData>(fsDoc(db, ...patientRoot, 'anamnesis', 'current'), { addAuditLog });
        setAnamnesis(anamnesisSnap.exists() ? (anamnesisSnap.data() as AnamnesisData) : null);

        const imagesSnap = await secureGetDocs<PatientImage>(query(collection(db, ...patientRoot, 'images'), limit(30)), 'images', { addAuditLog });
        setImages(imagesSnap.docs.map(d => ({ id: d.id, ...d.data() } as PatientImage)));

        const planSnap = await secureGetDoc<FacialPlan>(fsDoc(db, ...patientRoot, 'facial_planning', 'current'), { addAuditLog });
        if (planSnap.exists()) {
          const data = planSnap.data() as FacialPlan;
          setPlan(data);
          setClinicalNotes(data.clinicalNotesInput || '');
          const prices: Record<string, number> = {};
          STAGE_KEYS.forEach(k => data.planoTratamento?.[k]?.procedimentos?.forEach(p => { prices[p.nome] = p.valorSugerido; }));
          setCustomPrices(prices);
        } else {
          setClinicalNotes('');
        }
      } catch (err) {
        console.error('Failed to load facial planning record:', err);
      } finally {
        setLoadingRecord(false);
      }
    }
    loadRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id, selectedPatientId]);

  const filteredPatients = useMemo(() => {
    if (!searchTerm) return patients;
    const s = searchTerm.toLowerCase();
    return patients.filter(p => p.name?.toLowerCase().includes(s));
  }, [patients, searchTerm]);

  async function handleAnalyze() {
    if (!selectedPatient || !clinic?.id) return;
    if (!clinicalNotes.trim()) { showMessage('Descreva observações clínicas antes de analisar.'); return; }
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const anamnesisContext = anamnesis
        ? ANAMNESIS_FIELDS.map(f => `${f.label} ${anamnesis[f.name] || 'não informado'}`).join('; ')
        : 'Nenhuma anamnese registrada.';
      const imagesContext = images.length > 0
        ? images.map(img => `- [${img.category}] ${img.title}${img.description ? ` — ${img.description}` : ''}`).join('\n')
        : 'Nenhuma foto cadastrada na galeria do paciente.';

      const prompt = `Você é a Eliza, mentora clínica de inteligência artificial especializada em Harmonização Orofacial (HOF).
Realize um planejamento clínico estético facial integrado para o seguinte paciente, usando SOMENTE os dados reais fornecidos — nunca invente histórico não informado.

DADOS DO PACIENTE:
- Nome: ${selectedPatient.name}
- Nascimento: ${selectedPatient.birthDate || 'não informado'}
- Observações clínicas do profissional: "${clinicalNotes.trim()}"

ANAMNESE REAL:
${anamnesisContext}

FOTOS CADASTRADAS NA GALERIA (apenas metadados, não a imagem em si):
${imagesContext}

METODOLOGIA OBRIGATÓRIA (S.W.S.S.R): 1. PELE, 2. PESO FACIAL, 3. SUSTENTAÇÃO, 4. ESTRUTURAÇÃO, 5. REFINAMENTOS.

Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{"queixaPrincipal":"...","historicoEstetico":"...","procedimentosRecentes":"...","alertas":[{"tipo":"verde|amarelo|laranja|vermelho","titulo":"...","descricao":"..."}],"analise":{"pele":{"diagnostico":"...","recomendacao":"..."},"peso_facial":{"diagnostico":"...","recomendacao":"..."},"sustentacao":{"diagnostico":"...","recomendacao":"..."},"estrutura":{"diagnostico":"...","recomendacao":"..."},"refinamentos":{"diagnostico":"...","recomendacao":"..."}},"planoTratamento":{"etapa1":{"titulo":"Qualidade da pele","procedimentos":[{"nome":"...","justificativa":"...","valorSugerido":1200}]},"etapa2":{"titulo":"Redução de peso facial","procedimentos":[]},"etapa3":{"titulo":"Sustentação","procedimentos":[]},"etapa4":{"titulo":"Estruturação","procedimentos":[]},"etapa5":{"titulo":"Refinamentos","procedimentos":[]}},"cronograma":{"sessao1":{"titulo":"...","procedimentos":["..."],"intervalo":"Imediato"},"sessao2":{"titulo":"...","procedimentos":["..."],"intervalo":"+30 dias"},"sessao3":{"titulo":"...","procedimentos":["..."],"intervalo":"+60 dias"},"manutencao":{"titulo":"...","procedimentos":["..."],"intervalo":"+180 dias"}},"recorrencia":{"potencial":"...","frequenciaSugerida":"..."},"resumoApresentacao":"mensagem persuasiva e acolhedora de 4-5 linhas para apresentar o plano ao paciente"}
Use valores de mercado brasileiro coerentes (geralmente entre R$ 800 e R$ 4000 por procedimento).`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'facial_planning',
        clinicId: clinic.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente novamente.');
      const parsed: FacialPlan = JSON.parse(jsonMatch[0]);

      setPlan(parsed);
      const prices: Record<string, number> = {};
      STAGE_KEYS.forEach(k => parsed.planoTratamento?.[k]?.procedimentos?.forEach(p => { prices[p.nome] = p.valorSugerido; }));
      setCustomPrices(prices);
      setActivePillar('pele');

      await setDoc(fsDoc(db, 'clinics', clinic.id, 'patients', selectedPatient.id, 'facial_planning', 'current'), {
        ...parsed,
        clinicalNotesInput: clinicalNotes.trim(),
        updatedAt: serverTimestamp(),
      });
      addAuditLog({ collection: 'facial_planning', action: 'WRITE', status: 'SUCCESS', details: `Planejamento facial (IA real) gerado e salvo para "${selectedPatient.name}".` });
    } catch (err: any) {
      setAnalysisError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAnalyzing(false);
    }
  }

  function updateProcedurePrice(name: string, value: number) {
    setCustomPrices(prev => ({ ...prev, [name]: value }));
  }

  const totalValue = useMemo(() => {
    if (!plan) return 0;
    let total = 0;
    STAGE_KEYS.forEach(k => plan.planoTratamento?.[k]?.procedimentos?.forEach(p => { total += customPrices[p.nome] ?? p.valorSugerido ?? 0; }));
    return total;
  }, [plan, customPrices]);

  async function handleGenerateQuotation() {
    if (!clinic?.id || !selectedPatient || !plan) return;
    setSavingQuotation(true);
    try {
      const items: any[] = [];
      STAGE_KEYS.forEach(k => plan.planoTratamento?.[k]?.procedimentos?.forEach(p => {
        items.push({ description: p.nome, value: customPrices[p.nome] ?? p.valorSugerido ?? 0, quantity: 1, status: 'pending' });
      }));
      const payload = {
        title: 'Plano de Harmonização Facial - Eliza IA',
        responsible: profile?.name || (user as any)?.displayName || '',
        items,
        status: 'draft',
        totalValue,
        paymentMethod: 'Cartão/PIX',
        installments: 10,
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'clinics', clinic.id, 'patients', selectedPatient.id, 'quotations'), payload);
      addAuditLog({ collection: 'quotations', action: 'WRITE', status: 'SUCCESS', details: `Orçamento de harmonização facial (${formatCurrency(totalValue)}) gerado para "${selectedPatient.name}" (escrita real).` });
      showMessage('Orçamento gerado e salvo no prontuário do paciente (aba Orçamento).');
    } catch (err: any) {
      showMessage(`Falha ao gerar orçamento: ${err?.message || err}`);
    } finally {
      setSavingQuotation(false);
    }
  }

  async function handleCreateRecall() {
    if (!clinic?.id || !selectedPatient || !plan) return;
    setSavingRecall(true);
    try {
      const procedures: Procedure[] = [];
      STAGE_KEYS.forEach(k => plan.planoTratamento?.[k]?.procedimentos?.forEach(p => procedures.push(p)));
      let count = 0;
      for (const p of procedures) {
        const { months, type } = recallMonthsFor(p.nome);
        const returnDate = new Date();
        if (months % 1 === 0) returnDate.setMonth(returnDate.getMonth() + months);
        else returnDate.setDate(returnDate.getDate() + Math.round(months * 30.4));

        await addDoc(collection(db, 'clinics', clinic.id, 'aesthetic_procedures'), {
          patientId: selectedPatient.id,
          patientName: selectedPatient.name,
          patientPhone: selectedPatient.phone || '',
          procedureType: type,
          category: 'Harmonização Facial',
          area: 'Indicada via IA',
          appliedAt: new Date().toISOString().split('T')[0],
          professionalId: user?.uid || '',
          professionalName: profile?.name || (user as any)?.displayName || '',
          durationEstimateMonths: months,
          recommendedReturnDate: returnDate.toISOString().split('T')[0],
          recallStatus: 'active',
          notes: `Planejado via Planejamento Facial IA da Eliza. Justificativa: ${p.justificativa}`,
          createdAt: serverTimestamp(),
        });
        count++;
      }
      addAuditLog({ collection: 'aesthetic_procedures', action: 'WRITE', status: 'SUCCESS', details: `${count} recall(s) de harmonização facial criado(s) para "${selectedPatient.name}" (escrita real).` });
      showMessage(`${count} retorno(s) programado(s) no módulo de recall.`);
    } catch (err: any) {
      showMessage(`Falha ao criar recall: ${err?.message || err}`);
    } finally {
      setSavingRecall(false);
    }
  }

  function handlePrint() {
    if (!plan || !selectedPatient) return;
    const win = window.open('', '_blank', 'width=760,height=920');
    if (!win) return;
    const stagesHtml = STAGE_KEYS.map(k => {
      const stage = plan.planoTratamento?.[k];
      if (!stage || !stage.procedimentos?.length) return '';
      const rows = stage.procedimentos.map(p => `<tr><td>${p.nome}</td><td style="text-align:right">${formatCurrency(customPrices[p.nome] ?? p.valorSugerido)}</td></tr>`).join('');
      return `<h3>${stage.titulo}</h3><table>${rows}</table>`;
    }).join('');
    const html = `<!doctype html><html><head><title>Planejamento Facial — ${selectedPatient.name}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 40px; color: #111827; line-height: 1.6; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        h3 { font-size: 13px; margin-top: 18px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
        p.sub { color: #6b7280; font-size: 11px; margin-top: 0; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        td { padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
        .total { font-size: 15px; font-weight: 700; margin-top: 20px; text-align: right; }
        .summary { font-size: 12px; background: #f8fafc; border-radius: 8px; padding: 14px; margin-top: 16px; }
      </style></head><body>
      <h1>Planejamento de Harmonização Facial — Eliza IA</h1>
      <p class="sub">${selectedPatient.name} · ${new Date().toLocaleDateString('pt-BR')}</p>
      <div class="summary">${plan.resumoApresentacao}</div>
      ${stagesHtml}
      <p class="total">Investimento total sugerido: ${formatCurrency(totalValue)}</p>
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  return (
    <div className="space-y-6 max-w-6xl font-sans pb-24">
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative space-y-3 z-10">
          <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
            <Brain className="w-3.5 h-3.5 text-next-purple-neon" />
            <span>PLANEJAMENTO FACIAL IA</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight font-sans">Harmonização Facial</h1>
          <p className="text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
            A Eliza cruza a anamnese e a galeria reais do paciente com suas observações clínicas e monta um plano estruturado em 5 pilares (S.W.S.S.R), com orçamento e recall integrados.
          </p>
        </div>
      </div>

      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 flex items-center gap-2 text-xs text-slate-200">
            <CheckCircle2 className="w-4 h-4 text-next-green-success flex-shrink-0" />
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
        <div className="relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
            <Search className="w-3.5 h-3.5" />
          </span>
          <input
            type="text"
            placeholder="Buscar paciente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-next-border rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon"
          />
        </div>
        {loadingPatients ? (
          <div className="text-center py-6 font-mono text-xs text-slate-500"><RefreshCw className="w-4 h-4 animate-spin mx-auto" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
            {filteredPatients.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPatientId(p.id)}
                className={`text-left px-3 py-2 rounded-lg border text-xs font-semibold truncate transition-colors ${
                  selectedPatientId === p.id ? 'bg-next-purple-neon/15 border-next-purple-neon/40 text-next-purple-light' : 'bg-slate-900/50 border-next-border text-slate-300 hover:border-next-border-glow'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedPatient && (
        loadingRecord ? (
          <div className="text-center py-10 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Carregando...</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-1 space-y-4">
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200">{selectedPatient.name}</h3>
                <p className="text-[10.5px] text-slate-500">Observações clínicas para a análise (queixa, mímica, flacidez, sustentação percebida). A Eliza cruza com a anamnese e a galeria reais.</p>
                <textarea
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  disabled={analyzing}
                  placeholder="Ex: Paciente com queixa de rugas em glabela, flacidez leve em terço inferior..."
                  className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 h-40 resize-none"
                />
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing || !clinicalNotes.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{analyzing ? 'Analisando com a Eliza...' : 'Analisar com Eliza IA'}</span>
                </button>
                <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> IA real (OpenAI com fallback Gemini). Sem chave configurada, o erro aparece de verdade — não é simulado.</p>
                {analysisError && <p className="text-[11px] text-next-red-alert">{analysisError}</p>}
                <p className="text-[10px] text-slate-600">{images.length} foto(s) na galeria · {anamnesis ? 'anamnese preenchida' : 'sem anamnese registrada'}</p>
              </div>
            </div>

            <div className="xl:col-span-2 space-y-4">
              {!plan && !analyzing && (
                <div className="next-glass-panel rounded-next-2xl p-10 text-center">
                  <Brain className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Nenhum planejamento gerado ainda para este paciente.</p>
                </div>
              )}

              {plan && (
                <>
                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-next-purple-neon" /> Alertas clínicos</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {plan.alertas?.map((a, i) => (
                        <div key={i} className={`rounded-lg p-3 border ${ALERT_META[a.tipo] || ALERT_META.verde}`}>
                          <p className="text-[10.5px] font-bold uppercase">{a.titulo}</p>
                          <p className="text-[11px] mt-0.5 opacity-90">{a.descricao}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Layers className="w-4 h-4 text-next-purple-neon" /> Pilares S.W.S.S.R</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {PILLAR_TABS.map(t => (
                        <button key={t.key} onClick={() => setActivePillar(t.key)} className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold border ${activePillar === t.key ? 'next-brand-gradient-bg text-white border-transparent' : 'bg-slate-900/60 border-next-border text-slate-400'}`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {plan.analise?.[activePillar] && (
                      <div className="bg-slate-900/40 border border-next-border rounded-lg p-3 space-y-2">
                        <div>
                          <p className="text-[9.5px] font-mono text-next-purple-light uppercase mb-1">Diagnóstico</p>
                          <p className="text-[11.5px] text-slate-300">{plan.analise[activePillar].diagnostico}</p>
                        </div>
                        <div>
                          <p className="text-[9.5px] font-mono text-next-green-success uppercase mb-1">Recomendação</p>
                          <p className="text-[11.5px] text-slate-300">{plan.analise[activePillar].recomendacao}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Activity className="w-4 h-4 text-next-purple-neon" /> Plano de tratamento (editável)</h4>
                    {STAGE_KEYS.map(k => {
                      const stage = plan.planoTratamento?.[k];
                      if (!stage || !stage.procedimentos?.length) return null;
                      return (
                        <div key={k} className="bg-slate-900/40 border border-next-border rounded-lg p-3 space-y-2">
                          <p className="text-[11px] font-bold text-slate-200">{stage.titulo}</p>
                          {stage.procedimentos.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 bg-slate-950/60 rounded-lg p-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-semibold text-slate-200 truncate">{p.nome}</p>
                                <p className="text-[10px] text-slate-500 truncate">{p.justificativa}</p>
                              </div>
                              <input
                                type="number"
                                value={customPrices[p.nome] ?? p.valorSugerido}
                                onChange={(e) => updateProcedurePrice(p.nome, Number(e.target.value))}
                                className="w-24 bg-slate-900 border border-next-border rounded-lg text-[11px] text-slate-200 px-2 py-1.5 flex-shrink-0"
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    <p className="text-xs text-slate-300 text-right">Total: <strong className="text-next-purple-light">{formatCurrency(totalValue)}</strong></p>
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Calendar className="w-4 h-4 text-next-purple-neon" /> Cronograma</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {SESSION_KEYS.map(s => {
                        const sess = plan.cronograma?.[s.key];
                        if (!sess) return null;
                        return (
                          <div key={s.key} className="bg-slate-900/40 border border-next-border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold text-slate-200">{s.label}</span>
                              <span className="text-[9.5px] font-mono text-slate-500">{sess.intervalo}</span>
                            </div>
                            <p className="text-[10.5px] text-slate-400 mb-1">{sess.titulo}</p>
                            <ul className="space-y-0.5">
                              {sess.procedimentos?.map((p, i) => <li key={i} className="text-[10px] text-slate-500">• {p}</li>)}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200">Apresentação para o paciente</h4>
                    <p className="text-[11.5px] text-slate-300 italic bg-slate-900/40 border border-next-border rounded-lg p-3">{plan.resumoApresentacao}</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={handleGenerateQuotation} disabled={savingQuotation} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg disabled:opacity-60">
                        {savingQuotation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DollarSign className="w-3.5 h-3.5 text-next-green-success" />} Gerar orçamento (real)
                      </button>
                      <button onClick={handleCreateRecall} disabled={savingRecall} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg disabled:opacity-60">
                        {savingRecall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5 text-next-purple-light" />} Criar recall inteligente (real)
                      </button>
                      <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg">
                        <Printer className="w-3.5 h-3.5" /> Imprimir plano
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      )}

      <div className="bg-slate-900 border border-next-border/60 rounded-xl p-4 flex items-start gap-3 text-[11px] text-slate-500 leading-relaxed font-mono">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <span>
          O plano grava de verdade em clinics/{'{clinicId}'}/patients/{'{patientId}'}/facial_planning/current. "Gerar orçamento" e "Criar recall" gravam em quotations e aesthetic_procedures reais desta clínica.
        </span>
      </div>
    </div>
  );
}
