import React, { useState } from 'react';
import { Pencil, Plus, Trash2, Check } from 'lucide-react';
import type { DoseColorRule } from '../../lib/doseColorPrefs';

// Legenda de cor-por-dose do Clinical Learning Workspace (2026-08-30) —
// mostra a paleta configurada (dose → cor) e, fora de `readOnly`, permite
// editar cada regra (cor + dose) ou adicionar uma personalizada. É uma
// preferência da CLÍNICA inteira (doc único, ver doseColorPrefs.ts), então
// qualquer profissional com a tela aberta pode ajustar — não é por usuário.
// Puramente controlado: quem chama decide onde persistir `onChange`.

export interface DoseColorLegendProps {
  rules: DoseColorRule[];
  onChange?: (rules: DoseColorRule[]) => void;
  readOnly?: boolean;
  pointValueLabel?: string;
}

export default function DoseColorLegend({ rules, onChange, readOnly, pointValueLabel = 'Unidades' }: DoseColorLegendProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editable = !readOnly && !!onChange;

  const sorted = rules.map((r, i) => ({ rule: r, i })).sort((a, b) => a.rule.dose - b.rule.dose);

  const updateRule = (index: number, patch: Partial<DoseColorRule>) => {
    if (!onChange) return;
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRule = (index: number) => {
    if (!onChange) return;
    onChange(rules.filter((_, i) => i !== index));
    setEditingIndex(null);
  };

  const addRule = () => {
    if (!onChange) return;
    const usedDoses = new Set(rules.map((r) => r.dose));
    let nextDose = 1;
    while (usedDoses.has(nextDose)) nextDose += 1;
    onChange([...rules, { dose: nextDose, color: '#a855f7' }]);
    setEditingIndex(rules.length);
  };

  return (
    <div className="next-glass-panel rounded-next-2xl p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cor por dose ({pointValueLabel.toLowerCase()})</p>
        {editable && (
          <button type="button" onClick={addRule} className="flex items-center gap-1 text-[10px] font-bold text-next-purple-light hover:text-next-purple-neon">
            <Plus className="w-3.5 h-3.5" /> Personalizar
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map(({ rule, i }) =>
          editingIndex === i ? (
            <div key={i} className="flex items-center gap-1.5 bg-slate-900 border border-next-purple-neon rounded-lg px-2 py-1.5">
              <input type="color" value={rule.color} onChange={(e) => updateRule(i, { color: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border-none p-0" />
              <input type="number" step="0.5" min="0" value={rule.dose} onChange={(e) => updateRule(i, { dose: parseFloat(e.target.value) || 0 })}
                className="w-14 bg-slate-950 border border-next-border rounded text-[11px] text-slate-200 px-1.5 py-1" />
              <button type="button" onClick={() => setEditingIndex(null)} className="text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => removeRule(i)} className="text-next-red-alert/70 hover:text-next-red-alert"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button key={i} type="button" disabled={!editable} onClick={() => setEditingIndex(i)}
              className="flex items-center gap-1.5 bg-slate-900/60 border border-next-border rounded-lg px-2.5 py-1.5 disabled:cursor-default">
              <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: rule.color }} />
              <span className="text-[11px] font-bold text-slate-200">{rule.dose}</span>
              {editable && <Pencil className="w-3 h-3 text-slate-600" />}
            </button>
          )
        )}
        {sorted.length === 0 && <p className="text-[11px] text-slate-600 italic">Nenhuma regra de cor configurada.</p>}
      </div>
    </div>
  );
}
