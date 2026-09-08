import React, { useState } from 'react';
import { Search, Loader2, Plus, Save } from 'lucide-react';
import { doc as fsDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { useTreatmentCatalog, type TreatmentCatalogItem } from '../hooks/useTreatmentCatalog';
import { TREATMENT_CATEGORIES } from '../../data/treatmentCatalog';

interface NextQuotationItemPickerProps {
  clinicId: string | undefined;
  onSelect: (item: TreatmentCatalogItem) => void;
}

/** Categoria → busca → lista rolável, pra montar um item de orçamento a partir do catálogo de tratamentos da clínica (Admin → Catálogo). Não substitui a categoria central da taxonomia (procedureCategory) — é só filtro de navegação desta lista. */
export default function NextQuotationItemPicker({ clinicId, onSelect }: NextQuotationItemPickerProps) {
  const { user } = useAuth();
  const { items, loading, reload } = useTreatmentCatalog(clinicId);
  const [category, setCategory] = useState<string>('Todas');
  const [search, setSearch] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddCategory, setQuickAddCategory] = useState<string>(TREATMENT_CATEGORIES[0]);
  const [quickAddPrice, setQuickAddPrice] = useState('');
  const [savingQuickAdd, setSavingQuickAdd] = useState(false);

  const filtered = items.filter(item => {
    const matchesCategory = category === 'Todas' || item.category === category;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || item.name.toLowerCase().includes(term) || (item.subcategory || '').toLowerCase().includes(term);
    return matchesCategory && matchesSearch && item.active !== false;
  });

  const openQuickAdd = () => {
    setQuickAddName(search.trim());
    setQuickAddCategory(category !== 'Todas' ? category : TREATMENT_CATEGORIES[0]);
    setQuickAddPrice('');
    setQuickAddOpen(true);
  };

  const handleQuickAdd = async () => {
    if (!clinicId || !quickAddName.trim()) return;
    setSavingQuickAdd(true);
    try {
      const id = `treat-${Date.now()}`;
      const payload = {
        name: quickAddName.trim(),
        category: quickAddCategory,
        subcategory: '',
        defaultPrice: Number(quickAddPrice) || 0,
        description: '',
        estimatedDuration: 0,
        requiresFaces: false,
        requiresRegion: false,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: user?.uid,
      };
      await setDoc(fsDoc(db, 'clinics', clinicId, 'treatment_catalog', id), payload);
      reload();
      onSelect({ id, ...payload, baseValue: payload.defaultPrice, requiresFaces: false, requiresRegion: false } as unknown as TreatmentCatalogItem);
      setQuickAddOpen(false);
      setSearch('');
    } finally {
      setSavingQuickAdd(false);
    }
  };

  return (
    <div className="bg-slate-950 border border-next-border rounded-xl p-3 space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {['Todas', ...TREATMENT_CATEGORIES].map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-colors ${category === cat ? 'next-brand-gradient-bg text-white' : 'bg-slate-900 border border-next-border text-slate-400 hover:text-slate-200'}`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar tratamento por nome..."
          className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 pl-8 pr-3 py-2"
        />
      </div>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-next-purple-neon" /></div>
      ) : quickAddOpen ? (
        <div className="bg-slate-900/60 border border-next-border rounded-lg p-2.5 space-y-2">
          <p className="text-[10.5px] font-bold text-slate-300">Adicionar novo tratamento ao catálogo</p>
          <input value={quickAddName} onChange={(e) => setQuickAddName(e.target.value)} placeholder="Nome do tratamento" className="w-full bg-slate-950 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2" />
          <div className="flex gap-2">
            <select value={quickAddCategory} onChange={(e) => setQuickAddCategory(e.target.value)} className="flex-1 bg-slate-950 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2">
              {TREATMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" min={0} step="0.01" value={quickAddPrice} onChange={(e) => setQuickAddPrice(e.target.value)} placeholder="Preço" className="w-24 bg-slate-950 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleQuickAdd} disabled={savingQuickAdd || !quickAddName.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-60">
              {savingQuickAdd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Salvar e usar
            </button>
            <button type="button" onClick={() => setQuickAddOpen(false)} className="px-3 py-1.5 bg-slate-800 text-slate-300 font-bold text-[10.5px] rounded-lg">Cancelar</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-3 space-y-2">
          <p className="text-[11px] text-slate-500">Nenhum tratamento encontrado.</p>
          {clinicId && (
            <button type="button" onClick={openQuickAdd} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light hover:text-next-purple-neon">
              <Plus className="w-3.5 h-3.5" /> Adicionar {search.trim() ? `"${search.trim()}"` : 'novo tratamento'} ao catálogo
            </button>
          )}
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
          {filtered.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className="w-full flex items-center justify-between gap-2 text-left bg-slate-900/60 hover:bg-slate-900 border border-next-border rounded-lg px-3 py-2 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-200 truncate">{item.name}</p>
                <p className="text-[10px] text-slate-500 truncate">{item.category}{item.subcategory ? ` · ${item.subcategory}` : ''}</p>
              </div>
              <span className="text-[11px] font-bold text-next-purple-light flex-shrink-0">R$ {item.defaultPrice.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
