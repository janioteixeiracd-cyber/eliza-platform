import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc as fsDoc, getDocs, query, setDoc, serverTimestamp } from 'firebase/firestore';
import { Brain, Loader2, RefreshCw, Plus, Pencil, Eye, EyeOff, X, Save, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { db } from '../../lib/firebase';
import { PROCEDURE_CATEGORY_OPTIONS, type ProcedureCategory } from '../../lib/procedureTaxonomy';
import { PLANNING_TEMPLATES, TEMPLATE_LABELS } from '../../lib/planningTemplates';

interface ProcedureCatalogItem {
  id: string;
  procedureId: string;
  category: ProcedureCategory | string;
  name: string;
  aliases: string[];
  active: boolean;
  templateId?: string;
  /** Preço padrão sugerido ao gerar orçamento a partir de um plano — sem isto, "Gerar orçamento" no Planejamento IA sempre nascia em R$0. */
  defaultPrice?: number;
}

const TEMPLATE_OPTIONS = [
  { value: '', label: 'Genérico (fluxo básico, sem canvas)' },
  ...Object.values(PLANNING_TEMPLATES).map(t => ({
    value: t.templateId,
    label: TEMPLATE_LABELS[t.templateId] || t.templateId,
  })),
];

interface ProcedureFormState {
  id: string | null;
  name: string;
  category: string;
  templateId: string;
  aliases: string;
  active: boolean;
  defaultPrice: string;
}

const EMPTY_FORM: ProcedureFormState = {
  id: null, name: '', category: PROCEDURE_CATEGORY_OPTIONS[0].value, templateId: '', aliases: '', active: true, defaultPrice: '',
};

export default function NextProcedureCatalogAdmin() {
  const { clinic, user } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const [items, setItems] = useState<ProcedureCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProcedureFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    if (!clinic?.id) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'clinics', clinic.id, 'procedure_catalog')));
      setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as ProcedureCatalogItem)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clinic?.id]);

  const openNew = () => { setForm(EMPTY_FORM); setError(null); setFormOpen(true); };
  const openEdit = (item: ProcedureCatalogItem) => {
    setForm({
      id: item.id, name: item.name, category: item.category || PROCEDURE_CATEGORY_OPTIONS[0].value,
      templateId: item.templateId || '', aliases: (item.aliases || []).join(', '), active: item.active !== false,
      defaultPrice: item.defaultPrice ? String(item.defaultPrice) : '',
    });
    setError(null);
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    if (!form.name.trim() || !form.category) { setError('Nome e categoria são obrigatórios.'); return; }
    setSaving(true);
    setError(null);
    try {
      const id = form.id || `proc-${Date.now()}`;
      const aliases = form.aliases.split(',').map(a => a.trim()).filter(Boolean);
      await setDoc(
        fsDoc(db, 'clinics', clinic.id, 'procedure_catalog', id),
        {
          procedureId: id,
          name: form.name.trim(),
          category: form.category,
          templateId: form.templateId || null,
          aliases,
          active: form.active !== false,
          defaultPrice: Number(form.defaultPrice) || 0,
          updatedAt: serverTimestamp(),
          ...(form.id ? {} : { createdAt: serverTimestamp(), createdBy: user?.uid }),
        },
        { merge: true }
      );
      addAuditLog({ collection: 'procedure_catalog', action: 'WRITE', status: 'SUCCESS', details: `Procedimento "${form.name.trim()}" gravado no catálogo do Planejamento IA (escrita real).` });
      setFormOpen(false);
      load();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar o procedimento.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: ProcedureCatalogItem) => {
    if (!clinic?.id) return;
    setTogglingId(item.id);
    try {
      await setDoc(
        fsDoc(db, 'clinics', clinic.id, 'procedure_catalog', item.id),
        { active: !item.active, updatedAt: serverTimestamp() },
        { merge: true }
      );
      addAuditLog({ collection: 'procedure_catalog', action: 'WRITE', status: 'SUCCESS', details: `Procedimento "${item.name}" ${item.active ? 'desativado' : 'ativado'} no catálogo do Planejamento IA.` });
      load();
    } finally {
      setTogglingId(null);
    }
  };

  const categoryLabel = (value: string) => PROCEDURE_CATEGORY_OPTIONS.find(o => o.value === value)?.label || value;
  const templateLabel = (value?: string) => TEMPLATE_OPTIONS.find(o => o.value === (value || ''))?.label || value || 'Genérico';

  const sorted = [...items].sort((a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category)) || a.name.localeCompare(b.name));

  return (
    <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Brain className="w-4 h-4 text-next-purple-neon" /> Catálogo de Procedimentos — Planejamento IA ({sorted.length})</h3>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="p-2 bg-slate-900/70 border border-next-border rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple">
            <Plus className="w-3.5 h-3.5" /> Novo procedimento
          </button>
        </div>
      </div>
      <p className="text-[10.5px] text-slate-500 flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
        Diferente do Catálogo de Tratamentos acima (usado no Orçamento): estes são os procedimentos que aparecem pro profissional escolher DENTRO do Planejamento IA, por área/categoria — cada um pode apontar pra um template de IA específico (Toxina, Preenchimento, Implante) ou usar o fluxo genérico.
      </p>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-next-purple-neon" /></div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-8">Nenhum procedimento cadastrado ainda — sem isso, o Planejamento IA fica sem nenhuma opção pro profissional escolher em qualquer categoria.</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-next-border rounded-lg p-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-200 truncate">{item.name} <span className="text-slate-500 font-normal">· {categoryLabel(item.category)}</span></p>
                <p className="text-[10px] text-slate-500 font-mono truncate">{templateLabel(item.templateId)}{item.defaultPrice ? ` · R$ ${item.defaultPrice.toFixed(2)}` : ' · sem preço padrão'}{item.aliases?.length ? ` · ${item.aliases.join(', ')}` : ''}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${item.active !== false ? 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' : 'bg-slate-800 border-next-border text-slate-500'}`}>{item.active !== false ? 'Ativo' : 'Inativo'}</span>
                <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200" title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleToggleActive(item)} disabled={togglingId === item.id} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200 disabled:opacity-50">
                  {togglingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (item.active !== false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />)}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !saving && setFormOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Brain className="w-4 h-4 text-next-purple-neon" /> {form.id ? 'Editar procedimento' : 'Novo procedimento'}</h3>
                <button onClick={() => !saving && setFormOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Nome *</label>
                  <input autoFocus value={form.name} onChange={(e) => setForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Categoria *</label>
                  <select value={form.category} onChange={(e) => setForm(v => ({ ...v, category: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                    {PROCEDURE_CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Template de IA</label>
                  <select value={form.templateId} onChange={(e) => setForm(v => ({ ...v, templateId: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                    {TEMPLATE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Preço padrão sugerido (R$, opcional)</label>
                  <input type="number" min={0} step="0.01" value={form.defaultPrice} onChange={(e) => setForm(v => ({ ...v, defaultPrice: e.target.value }))} placeholder="Ex: 1200.00" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  <p className="text-[9.5px] text-slate-600 mt-1">Usado como sugestão ao gerar orçamento a partir de um plano — sem isto, o item nasce em R$0 e precisa ser preenchido na mão.</p>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Apelidos/abreviações (opcional)</label>
                  <input value={form.aliases} onChange={(e) => setForm(v => ({ ...v, aliases: e.target.value }))} placeholder="Ex: HOF, botox" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                {form.id && (
                  <label className="flex items-center gap-2.5 bg-slate-900/50 border border-next-border rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={form.active} onChange={(e) => setForm(v => ({ ...v, active: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                    <p className="text-[10.5px] font-bold text-slate-300">Ativo (aparece no Planejamento IA)</p>
                  </label>
                )}
                {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
                <button type="submit" disabled={saving} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{saving ? 'Gravando...' : 'Salvar procedimento'}</span>
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
