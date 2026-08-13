import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Pill, Plus, Save, Printer, CheckCircle2, X, Loader2,
  RefreshCw, AlertTriangle, Trash2, ShieldCheck, ShieldAlert, Wand2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, addDoc, deleteDoc, doc as fsDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { DEFAULT_PRESCRIPTION_TEMPLATES } from '../../data/defaultPrescriptionTemplates';

interface PatientRef { id: string; name: string; cpf?: string; birthDate?: string; }

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

interface ClinicTemplate { id: string; name: string; content: string; }

interface SafetyAlert { severity: 'alta' | 'media' | 'baixa'; text: string; }
interface SafetyAnalysis { safe: boolean; alerts: SafetyAlert[]; notes: string; }

interface PrescriptionDoc {
  id: string;
  type: 'receita';
  title: string;
  content: string;
  patientDetails: { name: string; cpf?: string; birthDate?: string };
  professionalName: string;
  clinicalSafetyAlerts: SafetyAnalysis | null;
  createdAt?: any;
}

const SEVERITY_META: Record<string, { label: string; classes: string }> = {
  alta: { label: 'Alto risco', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
  media: { label: 'Atenção', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  baixa: { label: 'Observação', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
};

function formatDate(d: any): string {
  try {
    if (!d) return '';
    if (typeof d === 'string') return new Date(d).toLocaleDateString('pt-BR');
    if (d.toDate) return d.toDate().toLocaleDateString('pt-BR');
    return new Date(d).toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function compilePrescription(templateContent: string, vars: Record<string, string>): string {
  let content = templateContent;
  Object.entries(vars).forEach(([tag, val]) => {
    content = content.split(tag).join(val || '');
  });
  return content;
}

interface NextPrescriptionsPanelProps {
  patient: PatientRef;
  anamnesis: AnamnesisData | null;
}

export default function NextPrescriptionsPanel({ patient, anamnesis }: NextPrescriptionsPanelProps) {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;

  const [clinicTemplates, setClinicTemplates] = useState<ClinicTemplate[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionDoc[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [templateId, setTemplateId] = useState(DEFAULT_PRESCRIPTION_TEMPLATES[0].id);
  const [compiledContent, setCompiledContent] = useState('');
  const [saving, setSaving] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [safetyAnalysis, setSafetyAnalysis] = useState<SafetyAnalysis | null>(null);

  const [viewingPrescription, setViewingPrescription] = useState<PrescriptionDoc | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 4000);
  }

  useEffect(() => {
    async function loadTemplates() {
      if (!clinic?.id) return;
      try {
        const tplRef = collection(db, 'clinics', clinic.id, 'templates');
        const tplSnap = await secureGetDocs(query(tplRef, where('type', '==', 'prescription'), limit(50)), 'templates', { addAuditLog });
        setClinicTemplates(tplSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load prescription templates:', err);
      }
    }
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  async function loadPrescriptions() {
    if (!clinic?.id || !patient.id) return;
    setLoadingRecord(true);
    try {
      const docRef = collection(db, 'clinics', clinic.id, 'patients', patient.id, 'documents');
      const docSnap = await secureGetDocs(query(docRef, where('type', '==', 'receita'), limit(50)), 'documents', { addAuditLog });
      const rows: PrescriptionDoc[] = docSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPrescriptions(rows);
    } catch (err) {
      console.error('Failed to load patient prescriptions:', err);
    } finally {
      setLoadingRecord(false);
    }
  }

  useEffect(() => {
    setIsGeneratorOpen(false);
    loadPrescriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id, patient.id]);

  function openGenerator() {
    setTemplateId(DEFAULT_PRESCRIPTION_TEMPLATES[0].id);
    setSafetyAnalysis(null);
    setAnalysisError(null);
    setIsGeneratorOpen(true);
  }

  useEffect(() => {
    if (!isGeneratorOpen) return;
    const custom = clinicTemplates.find(t => t.id === templateId);
    const defaultTpl = DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === templateId);
    const base = custom?.content || defaultTpl?.defaultContent || DEFAULT_PRESCRIPTION_TEMPLATES[0].defaultContent;
    const compiled = compilePrescription(base, {
      '{{nomePaciente}}': patient.name,
      '{{cpfPaciente}}': patient.cpf || '',
      '{{dataNascimento}}': patient.birthDate || '',
      '{{profissionalResponsavel}}': profile?.name || (user as any)?.displayName || '',
      '{{nomeClinica}}': (clinic as any)?.name || 'Clínica',
      '{{dataAtual}}': new Date().toLocaleDateString('pt-BR'),
    });
    setCompiledContent(compiled);
    setSafetyAnalysis(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGeneratorOpen, templateId]);

  async function handleAnalyzeSafety() {
    if (!compiledContent.trim()) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setSafetyAnalysis(null);
    try {
      const anamnesisContext = anamnesis
        ? ANAMNESIS_FIELDS.map(f => `${f.label} ${anamnesis[f.name] || 'não informado'}`).join('; ')
        : 'Nenhuma anamnese registrada para este paciente.';

      const prompt = `Você é a Eliza, farmacêutica clínica sênior de apoio a uma clínica odontológica/estética. Analise a prescrição abaixo cruzando com a anamnese real do paciente.

PRESCRIÇÃO:
"""
${compiledContent}
"""

ANAMNESE REAL DO PACIENTE (alergias e histórico médico):
"""
${anamnesisContext}
"""

Verifique: (1) interações medicamentosas entre os fármacos prescritos, (2) contraindicações com alergias/condições da anamnese (hipertensão, diabetes, gravidez, amamentação, imunossupressores, herpes recorrente, etc). Use SOMENTE a anamnese fornecida — não invente histórico que não está lá.

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, exatamente neste formato:
{"safe":true|false,"alerts":[{"severity":"alta|media|baixa","text":"descrição do risco"}],"notes":"parecer curto do farmacêutico"}
Se não houver nenhum risco identificado, retorne "safe":true e "alerts":[].`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'prescription_safety_check',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente novamente.');
      const parsed = JSON.parse(jsonMatch[0]);

      const analysis: SafetyAnalysis = {
        safe: !!parsed.safe,
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map((a: any) => ({ severity: ['alta', 'media', 'baixa'].includes(a?.severity) ? a.severity : 'baixa', text: String(a?.text || '') })) : [],
        notes: String(parsed.notes || ''),
      };
      setSafetyAnalysis(analysis);
      addAuditLog({ collection: 'documents', action: 'READ', status: 'SUCCESS', details: `Eliza analisou riscos de interação/contraindicação para receita de "${patient.name}".` });
    } catch (err: any) {
      setAnalysisError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSavePrescription() {
    if (!clinic?.id) return;
    setSaving(true);
    try {
      const templateName = clinicTemplates.find(t => t.id === templateId)?.name || DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === templateId)?.name || 'Receituário';
      const payload = {
        type: 'receita' as const,
        title: templateName,
        content: compiledContent,
        patientDetails: { name: patient.name, cpf: patient.cpf || '', birthDate: patient.birthDate || '' },
        professionalName: profile?.name || (user as any)?.displayName || '',
        clinicalSafetyAlerts: safetyAnalysis,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || 'eliza_next',
      };
      await addDoc(collection(db, 'clinics', clinic.id, 'patients', patient.id, 'documents'), payload);
      addAuditLog({ collection: 'documents', action: 'WRITE', status: 'SUCCESS', details: `Receituário "${templateName}" criado para "${patient.name}" (escrita real).` });
      showMessage('Receituário salvo.');
      setIsGeneratorOpen(false);
      await loadPrescriptions();
    } catch (err: any) {
      showMessage(`Falha ao salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePrescription(p: PrescriptionDoc) {
    if (!clinic?.id || !isAdmin) return;
    if (!window.confirm(`Excluir o receituário "${p.title}" de verdade?`)) return;
    setDeletingId(p.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'patients', patient.id, 'documents', p.id));
      addAuditLog({ collection: 'documents', action: 'WRITE', status: 'SUCCESS', details: `Receituário "${p.title}" excluído (escrita real).` });
      setPrescriptions(prev => prev.filter(x => x.id !== p.id));
      if (viewingPrescription?.id === p.id) setViewingPrescription(null);
      showMessage('Receituário excluído.');
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setDeletingId(null);
    }
  }

  function handlePrint(p: PrescriptionDoc) {
    const win = window.open('', '_blank', 'width=680,height=860');
    if (!win) return;
    const logoBase64 = (clinic as any)?.logoBase64 || '';
    const clinicAddress = (clinic as any)?.address || '';
    const clinicCnpj = (clinic as any)?.cnpj || '';
    const letterhead = `
      <div class="letterhead">
        ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="logo" />` : ''}
        <div class="clinic-info">
          <strong>${(clinic as any)?.name || 'Clínica'}</strong>
          ${clinicCnpj ? `<span>CNPJ: ${clinicCnpj}</span>` : ''}
          ${clinicAddress ? `<span>${clinicAddress}</span>` : ''}
        </div>
      </div>`;
    const html = `<!doctype html><html><head><title>${p.title}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 40px; color: #111827; line-height: 1.6; }
        h1 { font-size: 15px; text-align: center; margin-bottom: 24px; }
        pre { white-space: pre-wrap; font-family: inherit; font-size: 12.5px; }
        .meta { font-size: 11px; color: #6b7280; text-align: center; margin-bottom: 20px; }
        .letterhead { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 20px; }
        .letterhead .logo { width: 56px; height: 56px; object-fit: contain; flex-shrink: 0; }
        .letterhead .clinic-info { display: flex; flex-direction: column; font-size: 10.5px; color: #4b5563; }
        .letterhead .clinic-info strong { font-size: 13px; color: #111827; }
      </style></head><body>
      ${letterhead}
      <h1>${p.title}</h1>
      <p class="meta">${p.patientDetails?.name || ''}</p>
      <pre>${p.content.replace(/</g, '&lt;')}</pre>
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 flex items-center gap-2 text-xs text-slate-200">
            <CheckCircle2 className="w-4 h-4 text-next-green-success flex-shrink-0" />
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Pill className="w-4 h-4 text-next-purple-neon" /> Receituários com IA</h3>
        <button onClick={openGenerator} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple">
          <Plus className="w-3.5 h-3.5" /> Gerar receituário
        </button>
      </div>

      {loadingRecord ? (
        <div className="text-center py-8 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Carregando...</div>
      ) : prescriptions.length === 0 ? (
        <div className="next-glass-panel rounded-next-2xl p-8 text-center">
          <Pill className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">Nenhum receituário gerado ainda para este paciente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prescriptions.map(p => (
            <div key={p.id} className="next-glass-panel rounded-xl p-4 flex items-center justify-between gap-3">
              <button onClick={() => setViewingPrescription(p)} className="flex items-center gap-3 min-w-0 text-left flex-1">
                <Pill className="w-4 h-4 text-next-purple-neon flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-200 truncate">{p.title}</p>
                  <p className="text-[10.5px] text-slate-500 truncate">{p.professionalName || 'Sem profissional'} · {formatDate(p.createdAt)}</p>
                </div>
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                {p.clinicalSafetyAlerts && (
                  p.clinicalSafetyAlerts.safe
                    ? <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-next-green-success/10 border-next-green-success/20 text-next-green-success">Segura</span>
                    : <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert">Com alertas</span>
                )}
                <button onClick={() => handlePrint(p)} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200"><Printer className="w-3.5 h-3.5" /></button>
                {isAdmin && (
                  <button onClick={() => handleDeletePrescription(p)} disabled={deletingId === p.id} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert">
                    {deletingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GENERATOR MODAL */}
      <AnimatePresence>
        {isGeneratorOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setIsGeneratorOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 w-full max-w-3xl space-y-4 max-h-[92vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200">Gerar receituário — {patient.name}</h3>
                <button onClick={() => setIsGeneratorOpen(false)} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Modelo de receituário</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                  {clinicTemplates.length > 0 && <optgroup label="Modelos da clínica">{clinicTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
                  <optgroup label="Modelos padrão">{DEFAULT_PRESCRIPTION_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Conteúdo do receituário (editável)</label>
                <textarea value={compiledContent} onChange={(e) => { setCompiledContent(e.target.value); setSafetyAnalysis(null); }} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11.5px] text-slate-200 px-3 py-2.5 h-64 mt-1 font-mono leading-relaxed" />
              </div>

              <button
                onClick={handleAnalyzeSafety}
                disabled={analyzing || !compiledContent.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 border border-next-purple-neon/40 text-next-purple-light font-bold text-xs rounded-xl disabled:opacity-50"
              >
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{analyzing ? 'Cruzando com a anamnese real...' : 'Analisar interações com a Eliza (IA real)'}</span>
              </button>
              <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> Chama a IA real (OpenAI com fallback Gemini). Sem chave de API configurada neste ambiente, aparece um erro real — não é simulado.</p>

              {analysisError && <p className="text-[11px] text-next-red-alert">{analysisError}</p>}

              {safetyAnalysis && (
                <div className={`rounded-lg p-4 border space-y-2 ${safetyAnalysis.safe ? 'bg-next-green-success/5 border-next-green-success/20' : 'bg-next-red-alert/5 border-next-red-alert/20'}`}>
                  <div className="flex items-center gap-2">
                    {safetyAnalysis.safe ? <ShieldCheck className="w-4 h-4 text-next-green-success" /> : <ShieldAlert className="w-4 h-4 text-next-red-alert" />}
                    <span className={`text-xs font-bold ${safetyAnalysis.safe ? 'text-next-green-success' : 'text-next-red-alert'}`}>{safetyAnalysis.safe ? 'Prescrição segura para esta anamnese' : 'Alertas encontrados — revise antes de assinar'}</span>
                  </div>
                  {safetyAnalysis.notes && <p className="text-[11.5px] text-slate-300">{safetyAnalysis.notes}</p>}
                  {safetyAnalysis.alerts.map((a, i) => (
                    <div key={i} className={`text-[11px] px-2.5 py-1.5 rounded border ${SEVERITY_META[a.severity].classes}`}>
                      <strong className="uppercase text-[9px] mr-1.5">{SEVERITY_META[a.severity].label}</strong>{a.text}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleSavePrescription}
                disabled={saving || !compiledContent.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{saving ? 'Gravando...' : 'Salvar receituário (real)'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* VIEW MODAL */}
      <AnimatePresence>
        {viewingPrescription && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setViewingPrescription(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 w-full max-w-2xl space-y-4 max-h-[92vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200">{viewingPrescription.title}</h3>
                <button onClick={() => setViewingPrescription(null)} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
              </div>

              <pre className="text-[11.5px] text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-950 border border-next-border rounded-lg p-4 font-sans">{viewingPrescription.content}</pre>

              {viewingPrescription.clinicalSafetyAlerts && (
                <div className={`rounded-lg p-3 border text-[11px] ${viewingPrescription.clinicalSafetyAlerts.safe ? 'bg-next-green-success/5 border-next-green-success/20 text-next-green-success' : 'bg-next-red-alert/5 border-next-red-alert/20 text-next-red-alert'}`}>
                  {viewingPrescription.clinicalSafetyAlerts.safe ? 'A Eliza analisou esta prescrição contra a anamnese e não encontrou riscos.' : `${viewingPrescription.clinicalSafetyAlerts.alerts.length} alerta(s) identificado(s) pela Eliza no momento da geração.`}
                </div>
              )}

              <button onClick={() => handlePrint(viewingPrescription)} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-800 border border-next-border text-slate-200 font-bold text-xs rounded-xl">
                <Printer className="w-3.5 h-3.5" /> Imprimir
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[10px] text-slate-600 flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" /> A checagem de segurança usa a IA real com base na anamnese cadastrada — sempre revise clinicamente antes de assinar e dispensar.</p>
    </div>
  );
}
