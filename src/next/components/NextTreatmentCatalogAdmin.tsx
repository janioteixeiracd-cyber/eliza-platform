import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { doc as fsDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Stethoscope, Loader2, RefreshCw, Plus, Pencil, Eye, EyeOff, X, Save, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { db } from '../../lib/firebase';
import { useTreatmentCatalog, type TreatmentCatalogItem } from '../hooks/useTreatmentCatalog';
import { TREATMENT_CATEGORIES } from '../../data/treatmentCatalog';

interface TreatmentFormState {
  id: string | null;
  name: string;
  category: string;
  subcategory: string;
  defaultPrice: string;
  description: string;
  estimatedDuration: string;
  active: boolean;
}

const EMPTY_FORM: TreatmentFormState = {
  id: null, name: '', category: TREATMENT_CATEGORIES[0], subcategory: '',
  defaultPrice: '', description: '', estimatedDuration: '', active: true,
};

const NEW_CATEGORY_SENTINEL = '__nova_categoria__';

export default function NextTreatmentCatalogAdmin() {
  const { clinic, user } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const { items, loading, reload } = useTreatmentCatalog(clinic?.id);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TreatmentFormState>(EMPTY_FORM);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('Todas');

  const openNew = () => {
    setForm({ ...EMPTY_FORM, category: categoryFilter !== 'Todas' ? categoryFilter : EMPTY_FORM.category });
    setNewCategoryInput('');
    setError(null);
    setFormOpen(true);
  };
  const openEdit = (item: TreatmentCatalogItem) => {
    setForm({
      id: item.id, name: item.name, category: item.category || TREATMENT_CATEGORIES[0],
      subcategory: item.subcategory || '', defaultPrice: String(item.defaultPrice || ''),
      description: item.description || '', estimatedDuration: String(item.estimatedDuration || ''),
      active: item.active !== false,
    });
    setNewCategoryInput('');
    setError(null);
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    const resolvedCategory = form.category === NEW_CATEGORY_SENTINEL ? newCategoryInput.trim() : form.category;
    if (!form.name.trim() || !resolvedCategory) { setError('Nome e categoria são obrigatórios.'); return; }
    setSaving(true);
    setError(null);
    try {
      const id = form.id || `treat-${Date.now()}`;
      await setDoc(
        fsDoc(db, 'clinics', clinic.id, 'treatment_catalog', id),
        {
          name: form.name.trim(),
          category: resolvedCategory,
          subcategory: form.subcategory.trim(),
          defaultPrice: Number(form.defaultPrice) || 0,
          description: form.description.trim(),
          estimatedDuration: Number(form.estimatedDuration) || 0,
          requiresFaces: false,
          requiresRegion: false,
          active: form.active !== false,
          updatedAt: serverTimestamp(),
          ...(form.id ? {} : { createdAt: serverTimestamp(), createdBy: user?.uid }),
        },
        { merge: true }
      );
      addAuditLog({ collection: 'treatment_catalog', action: 'WRITE', status: 'SUCCESS', details: `Item de catálogo "${form.name.trim()}" gravado (escrita real).` });
      setFormOpen(false);
      reload();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar o item do catálogo.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: TreatmentCatalogItem) => {
    if (!clinic?.id) return;
    setTogglingId(item.id);
    try {
      await setDoc(
        fsDoc(db, 'clinics', clinic.id, 'treatment_catalog', item.id),
        {
          name: item.name, category: item.category, subcategory: item.subcategory || '',
          defaultPrice: item.defaultPrice, description: item.description || '',
          estimatedDuration: item.estimatedDuration || 0,
          requiresFaces: !!item.requiresFaces, requiresRegion: !!item.requiresRegion,
          active: !item.active, updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      addAuditLog({ collection: 'treatment_catalog', action: 'WRITE', status: 'SUCCESS', details: `Item "${item.name}" ${item.active ? 'desativado' : 'ativado'}.` });
      reload();
    } finally {
      setTogglingId(null);
    }
  };

  const sorted = [...items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  // Categoria é texto livre no Firestore — clínicas que já criaram categorias
  // próprias precisam continuar aparecendo no filtro, não só as 6 fixas.
  const allCategories = Array.from(new Set([...TREATMENT_CATEGORIES, ...items.map(i => i.category).filter(Boolean)])).sort();
  const filteredSorted = categoryFilter === 'Todas' ? sorted : sorted.filter(i => i.category === categoryFilter);
  const groupedByCategory: { category: string; items: TreatmentCatalogItem[] }[] = categoryFilter !== 'Todas'
    ? [{ category: categoryFilter, items: filteredSorted }]
    : Array.from(new Set(filteredSorted.map(i => i.category))).map(cat => ({ category: cat, items: filteredSorted.filter(i => i.category === cat) }));

  return (
    <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Stethoscope className="w-4 h-4 text-next-purple-neon" /> Catálogo de Tratamentos ({sorted.length})</h3>
        <div className="flex items-center gap-2">
          <button onClick={reload} disabled={loading} className="p-2 bg-slate-900/70 border border-next-border rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple">
            <Plus className="w-3.5 h-3.5" /> Novo tratamento
          </button>
        </div>
      </div>
      <p className="text-[10.5px] text-slate-500 flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
        Esses itens aparecem por categoria com busca ao montar um Orçamento. Itens ainda não cadastrados pela clínica aparecem com os valores padrão abaixo — editar ou desativar um deles grava uma versão própria da clínica, sem afetar outras clínicas.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {['Todas', ...allCategories].map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-colors ${categoryFilter === cat ? 'next-brand-gradient-bg text-white' : 'bg-slate-900 border border-next-border text-slate-400 hover:text-slate-200'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-next-purple-neon" /></div>
      ) : filteredSorted.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-8">Nenhum tratamento nesta categoria ainda.</p>
      ) : (
        <div className="space-y-4">
          {groupedByCategory.map(group => (
            <div key={group.category} className="space-y-1.5">
              {categoryFilter === 'Todas' && (
                <p className="text-[9.5px] font-black uppercase tracking-wide text-next-purple-light">{group.category} ({group.items.length})</p>
              )}
              {group.items.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-next-border rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-200 truncate">{item.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono truncate">R$ {item.defaultPrice.toFixed(2)}{item.subcategory ? ` · ${item.subcategory}` : ''}</p>
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
          ))}
        </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !saving && setFormOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Stethoscope className="w-4 h-4 text-next-purple-neon" /> {form.id ? 'Editar tratamento' : 'Novo tratamento'}</h3>
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
                    {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value={NEW_CATEGORY_SENTINEL}>+ Nova categoria...</option>
                  </select>
                  {form.category === NEW_CATEGORY_SENTINEL && (
                    <input
                      autoFocus
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      placeholder="Nome da nova categoria"
                      className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-2"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Subcategoria</label>
                    <input value={form.subcategory} onChange={(e) => setForm(v => ({ ...v, subcategory: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Preço padrão (R$)</label>
                    <input type="number" min={0} step="0.01" value={form.defaultPrice} onChange={(e) => setForm(v => ({ ...v, defaultPrice: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Duração estimada (minutos)</label>
                  <input type="number" min={0} value={form.estimatedDuration} onChange={(e) => setForm(v => ({ ...v, estimatedDuration: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Descrição</label>
                  <textarea value={form.description} onChange={(e) => setForm(v => ({ ...v, description: e.target.value }))} rows={3} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                {form.id && (
                  <label className="flex items-center gap-2.5 bg-slate-900/50 border border-next-border rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={form.active} onChange={(e) => setForm(v => ({ ...v, active: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                    <p className="text-[10.5px] font-bold text-slate-300">Ativo (aparece no Orçamento)</p>
                  </label>
                )}
                {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
                <button type="submit" disabled={saving} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{saving ? 'Gravando...' : 'Salvar tratamento'}</span>
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
