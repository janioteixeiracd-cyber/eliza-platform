import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Plus, Save, Printer, Upload, CheckCircle2, X, Loader2,
  RefreshCw, AlertTriangle, Trash2, ChevronRight, ShieldCheck, Ban
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, where, limit, addDoc, updateDoc, deleteDoc, doc as fsDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { DEFAULT_CONTRACT_TEMPLATES } from '../../data/defaultContractTemplates';

interface PatientRef { id: string; name: string; phone?: string; cpf?: string; birthDate?: string; }

interface QuotationLite {
  id: string;
  title: string;
  items: { description: string; value: number; quantity: number }[];
  totalValue: number;
  status: 'draft' | 'approved' | 'rejected';
}

interface ClinicTemplate { id: string; name: string; content: string; }

interface ContractDoc {
  id: string;
  type: 'contrato';
  title: string;
  content: string;
  status: 'draft' | 'generated' | 'sent' | 'signed' | 'cancelled';
  patientDetails: { name: string; cpf?: string; birthDate?: string; phone?: string };
  clinicDetails: { name: string; cnpj?: string; professionalName?: string; professionalCro?: string };
  quoteId?: string | null;
  quoteTitle?: string | null;
  paymentMethod?: string;
  totalValue?: number;
  signedFileDataUrl?: string | null;
  createdAt?: any;
}

const STATUS_META: Record<string, { label: string; classes: string }> = {
  draft: { label: 'Rascunho', classes: 'bg-slate-800 border-next-border text-slate-400' },
  generated: { label: 'Gerado', classes: 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue' },
  sent: { label: 'Enviado', classes: 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight' },
  signed: { label: 'Assinado', classes: 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' },
  cancelled: { label: 'Cancelado', classes: 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert' },
};

function formatDate(d: any): string {
  try {
    if (!d) return '';
    if (typeof d === 'string') return new Date(d).toLocaleDateString('pt-BR');
    if (d.toDate) return d.toDate().toLocaleDateString('pt-BR');
    return new Date(d).toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function detectTemplateId(procedureDescriptions: string[]): string {
  const lower = procedureDescriptions.map(p => p.toLowerCase());
  if (lower.some(p => p.includes('botox') || p.includes('toxina') || p.includes('botul'))) return 'toxina_botulinica';
  if (lower.some(p => p.includes('preench') || p.includes('labial') || p.includes('ácido') || p.includes('hialur') || p.includes('gel'))) return 'acido_hialuronico';
  if (lower.some(p => p.includes('bioestimula') || p.includes('sculptra') || p.includes('radiesse') || p.includes('colágen') || p.includes('elleva'))) return 'bioestimulador';
  if (lower.some(p => p.includes('fio') || p.includes('pdo'))) return 'fios_pdo';
  if (lower.some(p => p.includes('rinomodel') || p.includes('nariz'))) return 'rinomodelacao';
  if (lower.some(p => p.includes('papada') || p.includes('lipo'))) return 'lipo_papada';
  if (procedureDescriptions.length > 1) return 'full_face';
  if (lower.some(p => p.includes('obtura') || p.includes('limpeza') || p.includes('restaura') || p.includes('canal') || p.includes('extra') || p.includes('odonto'))) return 'odonto_geral';
  return 'odonto_geral';
}

function buildConsentText(procedureDescriptions: string[]): string {
  const lower = procedureDescriptions.map(p => p.toLowerCase());
  const clauses: string[] = [];
  DEFAULT_CONTRACT_TEMPLATES.forEach(t => {
    let match = false;
    if (t.id === 'toxina_botulinica' && lower.some(p => p.includes('botox') || p.includes('toxina') || p.includes('botul'))) match = true;
    if (t.id === 'acido_hialuronico' && lower.some(p => p.includes('preench') || p.includes('labial') || p.includes('ácido') || p.includes('hialur') || p.includes('gel') || p.includes('sulco') || p.includes('mento'))) match = true;
    if (t.id === 'bioestimulador' && lower.some(p => p.includes('bioestimula') || p.includes('sculptra') || p.includes('radiesse') || p.includes('colágen') || p.includes('elleva'))) match = true;
    if (t.id === 'fios_pdo' && lower.some(p => p.includes('fio') || p.includes('pdo') || p.includes('sustenta'))) match = true;
    if (t.id === 'rinomodelacao' && lower.some(p => p.includes('rinomodel') || p.includes('nariz'))) match = true;
    if (t.id === 'lipo_papada' && lower.some(p => p.includes('papada') || p.includes('lipo'))) match = true;
    if (t.id === 'full_face' && procedureDescriptions.length > 1) match = true;
    if (t.id === 'odonto_geral' && lower.some(p => p.includes('obtura') || p.includes('limpeza') || p.includes('restaura') || p.includes('canal') || p.includes('extra') || p.includes('siso') || p.includes('odonto'))) match = true;
    if (match) clauses.push(t.consentClause);
  });
  if (clauses.length === 0) {
    const fallback = DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === 'odonto_geral')?.consentClause;
    if (fallback) clauses.push(fallback);
  }
  return clauses.join('\n\n');
}

interface CompileInput {
  templateId: string;
  clinicTemplates: ClinicTemplate[];
  patientName: string;
  patientCpf: string;
  patientBirthDate: string;
  patientPhone: string;
  clinicName: string;
  clinicCnpj: string;
  professionalName: string;
  professionalCro: string;
  paymentMethod: string;
  procedureLines: string;
  totalValueStr: string;
  consentText: string;
}

function compileContract(input: CompileInput): string {
  const custom = input.clinicTemplates.find(t => t.id === input.templateId);
  const defaultTpl = DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === input.templateId);
  let content = custom?.content || defaultTpl?.defaultContent || DEFAULT_CONTRACT_TEMPLATES[0].defaultContent;

  const replacements: Record<string, string> = {
    '{{nomePaciente}}': input.patientName,
    '{{cpfPaciente}}': input.patientCpf,
    '{{telefonePaciente}}': input.patientPhone,
    '{{dataNascimento}}': input.patientBirthDate,
    '{{procedimentosAprovados}}': input.procedureLines,
    '{{valorTotal}}': input.totalValueStr,
    '{{formaPagamento}}': input.paymentMethod,
    '{{profissionalResponsavel}}': input.professionalName,
    '{{croProfissional}}': input.professionalCro,
    '{{nomeClinica}}': input.clinicName,
    '{{cnpjClinica}}': input.clinicCnpj,
    '{{dataAtual}}': new Date().toLocaleDateString('pt-BR'),
    '{{consentimentoProcedimentos}}': input.consentText,
  };
  Object.entries(replacements).forEach(([tag, val]) => {
    content = content.split(tag).join(val || '');
  });
  return content;
}

const PAYMENT_METHODS = ['PIX', 'Dinheiro', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Parcelado'];

interface NextContractsPanelProps {
  patient: PatientRef;
  quotations: QuotationLite[];
}

export default function NextContractsPanel({ patient, quotations }: NextContractsPanelProps) {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;

  const [clinicTemplates, setClinicTemplates] = useState<ClinicTemplate[]>([]);
  const [contracts, setContracts] = useState<ContractDoc[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string>('');
  const [manualProcedure, setManualProcedure] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [templateId, setTemplateId] = useState('odonto_geral');
  const [patientCpf, setPatientCpf] = useState('');
  const [patientBirthDate, setPatientBirthDate] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [professionalName, setProfessionalName] = useState('');
  const [professionalCro, setProfessionalCro] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [compiledContent, setCompiledContent] = useState('');
  const [saving, setSaving] = useState(false);

  const [viewingContract, setViewingContract] = useState<ContractDoc | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const signedFileInputRef = useRef<HTMLInputElement>(null);

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 4000);
  }

  useEffect(() => {
    async function loadTemplates() {
      if (!clinic?.id) return;
      try {
        const tplRef = collection(db, 'clinics', clinic.id, 'templates');
        const tplSnap = await secureGetDocs(query(tplRef, where('type', '==', 'contract'), limit(50)), 'templates', { addAuditLog });
        setClinicTemplates(tplSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load contract templates:', err);
      }
    }
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  async function loadContracts() {
    if (!clinic?.id || !patient.id) return;
    setLoadingRecord(true);
    try {
      const docRef = collection(db, 'clinics', clinic.id, 'patients', patient.id, 'documents');
      const docSnap = await secureGetDocs(query(docRef, where('type', '==', 'contrato'), limit(50)), 'documents', { addAuditLog });
      const rows: ContractDoc[] = docSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setContracts(rows);
    } catch (err) {
      console.error('Failed to load patient contracts:', err);
    } finally {
      setLoadingRecord(false);
    }
  }

  useEffect(() => {
    setIsGeneratorOpen(false);
    loadContracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id, patient.id]);

  function openGenerator() {
    setPatientCpf(patient.cpf || '');
    setPatientBirthDate(patient.birthDate || '');
    setPatientPhone(patient.phone || '');
    setProfessionalName(profile?.name || (user as any)?.displayName || '');
    setProfessionalCro((clinic as any)?.technicalDirectorCouncilNumber || '');
    setPaymentMethod(PAYMENT_METHODS[0]);
    const approvedQuotations = quotations.filter(q => q.status === 'approved');
    const firstQuotation = approvedQuotations[0] || quotations[0] || null;
    setSelectedQuotationId(firstQuotation?.id || '');
    setManualProcedure('');
    setManualValue('');
    const descriptions = firstQuotation ? firstQuotation.items.map(i => i.description) : [];
    const detected = descriptions.length > 0 ? detectTemplateId(descriptions) : 'odonto_geral';
    setTemplateId(detected);
    setIsGeneratorOpen(true);
  }

  const activeQuotation = quotations.find(q => q.id === selectedQuotationId) || null;

  useEffect(() => {
    if (!isGeneratorOpen) return;
    const descriptions = activeQuotation ? activeQuotation.items.map(i => i.description) : (manualProcedure ? [manualProcedure] : []);
    const procedureLines = activeQuotation
      ? activeQuotation.items.map(i => `- ${i.description} (${formatCurrency(i.value)})`).join('\n')
      : (manualProcedure ? `- ${manualProcedure}` : '');
    const totalValue = activeQuotation ? activeQuotation.totalValue : (Number(manualValue) || 0);
    const compiled = compileContract({
      templateId,
      clinicTemplates,
      patientName: patient.name,
      patientCpf,
      patientBirthDate,
      patientPhone,
      clinicName: (clinic as any)?.name || 'Clínica',
      clinicCnpj: (clinic as any)?.cnpj || '',
      professionalName,
      professionalCro,
      paymentMethod,
      procedureLines: procedureLines || 'A definir',
      totalValueStr: totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      consentText: descriptions.length > 0 ? buildConsentText(descriptions) : (DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === 'odonto_geral')?.consentClause || ''),
    });
    setCompiledContent(compiled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGeneratorOpen, templateId, selectedQuotationId, manualProcedure, manualValue, patientCpf, patientBirthDate, patientPhone, professionalName, professionalCro, paymentMethod]);

  async function handleSaveContract() {
    if (!clinic?.id) return;
    setSaving(true);
    try {
      const templateName = clinicTemplates.find(t => t.id === templateId)?.name || DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === templateId)?.name || 'Contrato';
      const totalValue = activeQuotation ? activeQuotation.totalValue : (Number(manualValue) || 0);
      const payload = {
        type: 'contrato' as const,
        title: templateName,
        content: compiledContent,
        status: 'draft' as const,
        patientDetails: { name: patient.name, cpf: patientCpf, birthDate: patientBirthDate, phone: patientPhone },
        clinicDetails: { name: (clinic as any)?.name || 'Clínica', cnpj: (clinic as any)?.cnpj || '', professionalName, professionalCro },
        quoteId: activeQuotation?.id || null,
        quoteTitle: activeQuotation?.title || (manualProcedure || null),
        paymentMethod,
        totalValue,
        signedFileDataUrl: null,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || 'eliza_next',
      };
      await addDoc(collection(db, 'clinics', clinic.id, 'patients', patient.id, 'documents'), payload);
      addAuditLog({ collection: 'documents', action: 'WRITE', status: 'SUCCESS', details: `Contrato "${templateName}" criado para "${patient.name}" (escrita real).` });
      showMessage('Contrato salvo.');
      setIsGeneratorOpen(false);
      await loadContracts();
    } catch (err: any) {
      showMessage(`Falha ao salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStatus(contract: ContractDoc, status: ContractDoc['status']) {
    if (!clinic?.id) return;
    setUpdatingStatusId(contract.id);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', patient.id, 'documents', contract.id), { status, updatedAt: serverTimestamp() });
      addAuditLog({ collection: 'documents', action: 'WRITE', status: 'SUCCESS', details: `Contrato "${contract.title}" marcado como ${STATUS_META[status].label.toLowerCase()} (escrita real).` });
      setContracts(prev => prev.map(c => c.id === contract.id ? { ...c, status } : c));
      if (viewingContract?.id === contract.id) setViewingContract(prev => prev ? { ...prev, status } : prev);
      showMessage(`Status atualizado para ${STATUS_META[status].label}.`);
    } catch (err: any) {
      showMessage(`Falha: ${err?.message || err}`);
    } finally {
      setUpdatingStatusId(null);
    }
  }

  function handleSignedFileSelected(e: React.ChangeEvent<HTMLInputElement>, contract: ContractDoc) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      showMessage('Arquivo grande demais — use um arquivo menor que 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
      if (!clinic?.id) return;
      try {
        const dataUrl = reader.result as string;
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'patients', patient.id, 'documents', contract.id), {
          signedFileDataUrl: dataUrl,
          status: 'signed',
          updatedAt: serverTimestamp(),
        });
        addAuditLog({ collection: 'documents', action: 'WRITE', status: 'SUCCESS', details: `Arquivo assinado anexado ao contrato "${contract.title}" (escrita real).` });
        setContracts(prev => prev.map(c => c.id === contract.id ? { ...c, signedFileDataUrl: dataUrl, status: 'signed' } : c));
        if (viewingContract?.id === contract.id) setViewingContract(prev => prev ? { ...prev, signedFileDataUrl: dataUrl, status: 'signed' } : prev);
        showMessage('Contrato assinado anexado.');
      } catch (err: any) {
        showMessage(`Falha ao anexar: ${err?.message || err}`);
      }
    };
    reader.readAsDataURL(file);
    if (signedFileInputRef.current) signedFileInputRef.current.value = '';
  }

  async function handleDeleteContract(contract: ContractDoc) {
    if (!clinic?.id || !isAdmin) return;
    if (!window.confirm(`Excluir o contrato "${contract.title}" de verdade? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(contract.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'patients', patient.id, 'documents', contract.id));
      addAuditLog({ collection: 'documents', action: 'WRITE', status: 'SUCCESS', details: `Contrato "${contract.title}" excluído (escrita real).` });
      setContracts(prev => prev.filter(c => c.id !== contract.id));
      if (viewingContract?.id === contract.id) setViewingContract(null);
      showMessage('Contrato excluído.');
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setDeletingId(null);
    }
  }

  function handlePrintContract(contract: ContractDoc) {
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) return;
    const logoBase64 = (clinic as any)?.logoBase64 || '';
    const clinicAddress = (clinic as any)?.address || '';
    const letterhead = `
      <div class="letterhead">
        ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="logo" />` : ''}
        <div class="clinic-info">
          <strong>${contract.clinicDetails?.name || (clinic as any)?.name || 'Clínica'}</strong>
          ${contract.clinicDetails?.cnpj ? `<span>CNPJ: ${contract.clinicDetails.cnpj}</span>` : ''}
          ${clinicAddress ? `<span>${clinicAddress}</span>` : ''}
        </div>
      </div>`;
    const html = `<!doctype html><html><head><title>${contract.title}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 40px; color: #111827; line-height: 1.6; }
        h1 { font-size: 16px; text-align: center; margin-bottom: 24px; }
        pre { white-space: pre-wrap; font-family: inherit; font-size: 12.5px; }
        .meta { font-size: 11px; color: #6b7280; text-align: center; margin-bottom: 20px; }
        .letterhead { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 20px; }
        .letterhead .logo { width: 56px; height: 56px; object-fit: contain; flex-shrink: 0; }
        .letterhead .clinic-info { display: flex; flex-direction: column; font-size: 10.5px; color: #4b5563; }
        .letterhead .clinic-info strong { font-size: 13px; color: #111827; }
      </style></head><body>
      ${letterhead}
      <h1>${contract.title}</h1>
      <p class="meta">${contract.patientDetails?.name || ''} — Status: ${STATUS_META[contract.status]?.label || contract.status}</p>
      <pre>${contract.content.replace(/</g, '&lt;')}</pre>
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
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><FileText className="w-4 h-4 text-next-purple-neon" /> Contratos e TCLE</h3>
        <button onClick={openGenerator} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple">
          <Plus className="w-3.5 h-3.5" /> Gerar contrato
        </button>
      </div>

      {loadingRecord ? (
        <div className="text-center py-8 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Carregando...</div>
      ) : contracts.length === 0 ? (
        <div className="next-glass-panel rounded-next-2xl p-8 text-center">
          <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">Nenhum contrato gerado ainda para este paciente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map(c => {
            const meta = STATUS_META[c.status] || STATUS_META.draft;
            return (
              <div key={c.id} className="next-glass-panel rounded-xl p-4 flex items-center justify-between gap-3">
                <button onClick={() => setViewingContract(c)} className="flex items-center gap-3 min-w-0 text-left flex-1">
                  <FileText className="w-4 h-4 text-next-purple-neon flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-200 truncate">{c.title}</p>
                    <p className="text-[10.5px] text-slate-500 truncate">{c.quoteTitle || 'Sem orçamento vinculado'} · {formatCurrency(c.totalValue || 0)} · {formatDate(c.createdAt)}</p>
                  </div>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${meta.classes}`}>{meta.label}</span>
                  <button onClick={() => handlePrintContract(c)} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200"><Printer className="w-3.5 h-3.5" /></button>
                  {isAdmin && (
                    <button onClick={() => handleDeleteContract(c)} disabled={deletingId === c.id} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert">
                      {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
                <h3 className="text-sm font-bold text-slate-200">Gerar contrato — {patient.name}</h3>
                <button onClick={() => setIsGeneratorOpen(false)} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Orçamento aprovado</label>
                <select value={selectedQuotationId} onChange={(e) => setSelectedQuotationId(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                  <option value="">— Sem orçamento (procedimento avulso) —</option>
                  {quotations.map(q => <option key={q.id} value={q.id}>{q.title} · {formatCurrency(q.totalValue)} · {q.status}</option>)}
                </select>
              </div>

              {!selectedQuotationId && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Procedimento</label>
                    <input value={manualProcedure} onChange={(e) => setManualProcedure(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" placeholder="Ex: Aplicação de toxina botulínica" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Valor (R$)</label>
                    <input type="number" value={manualValue} onChange={(e) => setManualValue(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Modelo de contrato</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                  {clinicTemplates.length > 0 && <optgroup label="Modelos da clínica">{clinicTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
                  <optgroup label="Modelos padrão">{DEFAULT_CONTRACT_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">CPF do paciente</label>
                  <input value={patientCpf} onChange={(e) => setPatientCpf(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Data de nascimento</label>
                  <input value={patientBirthDate} onChange={(e) => setPatientBirthDate(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Profissional responsável</label>
                  <input value={professionalName} onChange={(e) => setProfessionalName(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">CRO/CRM</label>
                  <input value={professionalCro} onChange={(e) => setProfessionalCro(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Forma de pagamento</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Conteúdo do contrato (editável)</label>
                <textarea value={compiledContent} onChange={(e) => setCompiledContent(e.target.value)} className="w-full bg-slate-950 border border-next-border rounded-lg text-[11.5px] text-slate-200 px-3 py-2.5 h-72 mt-1 font-mono leading-relaxed" />
              </div>

              <button
                onClick={handleSaveContract}
                disabled={saving || !compiledContent.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{saving ? 'Gravando...' : 'Salvar contrato (real)'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* VIEW / STATUS MODAL */}
      <AnimatePresence>
        {viewingContract && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setViewingContract(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-next-bg-card border border-next-border rounded-next-2xl p-6 w-full max-w-2xl space-y-4 max-h-[92vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">{viewingContract.title}</h3>
                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${STATUS_META[viewingContract.status]?.classes}`}>{STATUS_META[viewingContract.status]?.label}</span>
                </div>
                <button onClick={() => setViewingContract(null)} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
              </div>

              <pre className="text-[11.5px] text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-950 border border-next-border rounded-lg p-4 font-sans">{viewingContract.content}</pre>

              {viewingContract.signedFileDataUrl && (
                <div>
                  <p className="text-[10px] font-mono text-slate-500 uppercase mb-1">Arquivo assinado anexado</p>
                  {viewingContract.signedFileDataUrl.startsWith('data:image') ? (
                    <img src={viewingContract.signedFileDataUrl} alt="Contrato assinado" className="rounded-lg border border-next-border max-h-64" />
                  ) : (
                    <a href={viewingContract.signedFileDataUrl} download className="text-xs text-next-purple-light underline">Baixar arquivo assinado</a>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-3 border-t border-next-border">
                <button onClick={() => handlePrintContract(viewingContract)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 border border-next-border text-slate-200 font-bold text-[11px] rounded-lg">
                  <Printer className="w-3.5 h-3.5" /> Imprimir
                </button>
                {viewingContract.status === 'draft' && (
                  <button onClick={() => handleUpdateStatus(viewingContract, 'sent')} disabled={updatingStatusId === viewingContract.id} className="inline-flex items-center gap-1.5 px-3 py-2 bg-next-orange-insight/10 border border-next-orange-insight/20 text-next-orange-insight font-bold text-[11px] rounded-lg">
                    <ChevronRight className="w-3.5 h-3.5" /> Marcar como enviado
                  </button>
                )}
                {(viewingContract.status === 'draft' || viewingContract.status === 'sent') && (
                  <>
                    <input ref={signedFileInputRef} type="file" accept="image/*,application/pdf" onChange={(e) => handleSignedFileSelected(e, viewingContract)} className="hidden" />
                    <button onClick={() => signedFileInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 bg-next-green-success/10 border border-next-green-success/20 text-next-green-success font-bold text-[11px] rounded-lg">
                      <Upload className="w-3.5 h-3.5" /> Anexar assinado
                    </button>
                    <button onClick={() => handleUpdateStatus(viewingContract, 'cancelled')} disabled={updatingStatusId === viewingContract.id} className="inline-flex items-center gap-1.5 px-3 py-2 bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert font-bold text-[11px] rounded-lg">
                      <Ban className="w-3.5 h-3.5" /> Cancelar
                    </button>
                  </>
                )}
                {viewingContract.status === 'signed' && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-next-green-success font-bold"><ShieldCheck className="w-3.5 h-3.5" /> Contrato assinado e arquivado</span>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[10px] text-slate-600 flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" /> Não há assinatura eletrônica: o fluxo é gerar, enviar, imprimir para assinatura física e anexar o documento assinado escaneado.</p>
    </div>
  );
}
