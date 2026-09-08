import React from 'react';
import { Trash2, User, CalendarDays, Stethoscope } from 'lucide-react';
import type { ClinicalField, ProcedureTemplate } from '../../lib/planningTemplates';

// Clinical Learning Workspace (2026-08-29) — the visual ficha half of the
// workspace (header + preparo/diluição + tabela de pontos + total +
// observações). The anatomical map itself stays a plain `AcademyPlanningCanvas`
// rendered next to this panel by the parent screen — this component only
// owns the STRUCTURED data side, kept in sync with the canvas's point
// strokes via the `points` prop (mirrored live through the canvas's own
// `onPointsChange`) and the shared `selectedPointId`/`onSelectPoint` pair.
// Never renders/knows about strokes directly — that stays the canvas's job.

export interface WorkspacePoint { id: string; x: number; y: number; order: number; }
export interface PointRecord { muscle: string; unidades: string; observacao: string; }

// Fields the workspace's point table already supersedes — never shown as
// loose inputs here even though they still exist on `template.executionFields`
// for backward compatibility with the plain (non-workspace) ficha renderer.
const WORKSPACE_SUPERSEDED_FIELD_KEYS = new Set(['regiao', 'unidadesTotais', 'volumeTotal']);

function ClinicalFieldInput({
  field, value, onChange, readOnly,
}: { field: ClinicalField; value: string | boolean; onChange?: (v: string | boolean) => void; readOnly?: boolean }) {
  const disabled = readOnly || !onChange;
  if (field.type === 'boolean') {
    return (
      <button type="button" disabled={disabled} onClick={() => onChange?.(!value)}
        className={`mt-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border ${value ? 'bg-next-purple-neon/20 border-next-purple-neon text-next-purple-neon' : 'bg-slate-900 border-next-border text-slate-400'} disabled:opacity-70`}>
        {value ? 'Sim' : 'Não'}
      </button>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea value={String(value || '')} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}
        placeholder={field.placeholder} rows={2}
        className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 disabled:opacity-70" />
    );
  }
  if (field.type === 'select') {
    return (
      <select value={String(value || '')} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}
        className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 disabled:opacity-70">
        <option value="">— Selecione —</option>
        {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  return (
    <input type="text" value={String(value || '')} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}
      placeholder={field.placeholder}
      className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 disabled:opacity-70" />
  );
}

export interface ClinicalFichaPanelProps {
  template: ProcedureTemplate;
  caseLabel: string;
  dateLabel: string;
  professionalLabel: string;

  headerFieldValues: Record<string, string | boolean>;
  onHeaderFieldChange?: (key: string, value: string | boolean) => void;

  points: WorkspacePoint[];
  pointRecords: Record<string, PointRecord>;
  onPointRecordChange?: (pointId: string, patch: Partial<PointRecord>) => void;
  onDeletePoint?: (pointId: string) => void;

  selectedPointId: string | null;
  onSelectPoint: (id: string | null) => void;

  observations: string;
  onObservationsChange?: (v: string) => void;
  // Screens that already have their own dedicated free-text clinical notes
  // field (e.g. Planejamento IA's objetivo/avaliação clínica) can hide this
  // panel's own Observações block instead of showing a redundant third one.
  hideObservations?: boolean;

  // Second, always-read-only layer — professor reference or planned
  // snapshot — rendered in its own labeled block, never merged into
  // `pointRecords` above.
  compareLayer?: { label: string; points: WorkspacePoint[]; pointRecords: Record<string, PointRecord> } | null;

  readOnly?: boolean;
}

export default function ClinicalFichaPanel({
  template, caseLabel, dateLabel, professionalLabel,
  headerFieldValues, onHeaderFieldChange,
  points, pointRecords, onPointRecordChange, onDeletePoint,
  selectedPointId, onSelectPoint,
  observations, onObservationsChange, hideObservations,
  compareLayer, readOnly,
}: ClinicalFichaPanelProps) {
  const muscleCatalog = template.clinicalWorkspace?.muscleCatalog;
  const headerFields = template.executionFields.filter((f) => !WORKSPACE_SUPERSEDED_FIELD_KEYS.has(f.key));

  const total = points.reduce((sum, p) => {
    const n = parseFloat(pointRecords[p.id]?.unidades || '');
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  const pointValueLabel = template.clinicalWorkspace?.pointValueLabel || 'Unidades';

  return (
    <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
      {/* Cabeçalho — display-only, nunca redigitado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-3 border-b border-next-border">
        <div className="flex items-start gap-2">
          <User className="w-3.5 h-3.5 text-next-purple-neon mt-0.5 flex-shrink-0" />
          <div><p className="text-[9px] font-mono text-slate-500 uppercase">Caso</p><p className="text-xs font-bold text-slate-200">{caseLabel}</p></div>
        </div>
        <div className="flex items-start gap-2">
          <CalendarDays className="w-3.5 h-3.5 text-next-purple-neon mt-0.5 flex-shrink-0" />
          <div><p className="text-[9px] font-mono text-slate-500 uppercase">Data</p><p className="text-xs font-bold text-slate-200">{dateLabel}</p></div>
        </div>
        <div className="flex items-start gap-2">
          <Stethoscope className="w-3.5 h-3.5 text-next-purple-neon mt-0.5 flex-shrink-0" />
          <div><p className="text-[9px] font-mono text-slate-500 uppercase">Profissional</p><p className="text-xs font-bold text-slate-200">{professionalLabel}</p></div>
        </div>
      </div>

      {/* Dados de preparo/diluição */}
      {headerFields.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {headerFields.map((f) => (
            <div key={f.key}>
              <label className="text-[9px] font-bold text-slate-500 uppercase">{f.label}</label>
              <ClinicalFieldInput field={f} value={headerFieldValues[f.key] ?? ''} readOnly={readOnly}
                onChange={onHeaderFieldChange ? (v) => onHeaderFieldChange(f.key, v) : undefined} />
            </div>
          ))}
        </div>
      )}

      {/* Tabela de pontos — uma linha por ponto (era 2 linhas empilhadas por
          ponto; pra 14 pontos isso sozinho já era ~1150px de rolagem). Layout
          e cabeçalho de coluna únicos aqui, nunca repetidos por ponto. */}
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Pontos marcados no mapa</p>
        {points.length === 0 ? (
          <p className="text-[11px] text-slate-600 italic">Nenhum ponto marcado ainda — use a ferramenta "Ponto" no mapa ao lado.</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[22px_minmax(0,1.4fr)_70px_minmax(0,1.4fr)_18px] gap-1.5 px-1 text-[9px] font-bold text-slate-500 uppercase">
              <span />
              <span>Músculo</span>
              <span>{pointValueLabel}</span>
              <span>Observação</span>
              <span />
            </div>
            {points.map((p) => {
              const rec = pointRecords[p.id] || { muscle: '', unidades: '', observacao: '' };
              const isSelected = p.id === selectedPointId;
              return (
                <div key={p.id} onClick={() => onSelectPoint(isSelected ? null : p.id)}
                  className={`grid grid-cols-[22px_minmax(0,1.4fr)_70px_minmax(0,1.4fr)_18px] gap-1.5 items-center rounded-lg border px-1.5 py-1 cursor-pointer transition-colors ${isSelected ? 'border-next-purple-neon bg-next-purple-neon/10' : 'border-next-border bg-slate-900/40 hover:border-next-border/80'}`}>
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-black flex items-center justify-center">{p.order}</span>
                  {muscleCatalog ? (
                    <select value={rec.muscle} disabled={readOnly || !onPointRecordChange} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onPointRecordChange?.(p.id, { muscle: e.target.value })}
                      className="w-full min-w-0 bg-slate-950 border border-next-border rounded text-[11px] text-slate-200 px-1.5 py-1 disabled:opacity-70">
                      <option value="">— Selecione —</option>
                      {muscleCatalog.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={rec.muscle} disabled={readOnly || !onPointRecordChange} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onPointRecordChange?.(p.id, { muscle: e.target.value })}
                      placeholder="Região" className="w-full min-w-0 bg-slate-950 border border-next-border rounded text-[11px] text-slate-200 px-1.5 py-1 disabled:opacity-70" />
                  )}
                  <input type="text" value={rec.unidades} disabled={readOnly || !onPointRecordChange} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPointRecordChange?.(p.id, { unidades: e.target.value })}
                    placeholder={template.clinicalWorkspace?.pointValuePlaceholder || pointValueLabel} className="w-full min-w-0 bg-slate-950 border border-next-border rounded text-[11px] text-slate-200 px-1.5 py-1 disabled:opacity-70" />
                  <input type="text" value={rec.observacao} disabled={readOnly || !onPointRecordChange} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPointRecordChange?.(p.id, { observacao: e.target.value })}
                    placeholder="Local/obs." className="w-full min-w-0 bg-slate-950 border border-next-border rounded text-[11px] text-slate-200 px-1.5 py-1 disabled:opacity-70" />
                  {onDeletePoint && !readOnly ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onDeletePoint(p.id); }} className="text-next-red-alert/70 hover:text-next-red-alert">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : <span />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Total — sempre calculado, nunca digitado */}
      <div className="flex items-center justify-between bg-slate-900/60 border border-next-border rounded-lg px-3 py-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase">Total de {pointValueLabel.toLowerCase()}</span>
        <span className="text-sm font-black text-next-purple-light">{total > 0 ? total : '—'}</span>
      </div>

      {/* Camada de comparação (referência do professor / planejado) — só leitura, nunca mesclada */}
      {compareLayer && (
        <div className="border border-dashed border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-1.5">
          <p className="text-[10px] font-bold text-amber-400 uppercase">{compareLayer.label}</p>
          {compareLayer.points.length === 0 ? (
            <p className="text-[11px] text-slate-500">Nenhum ponto de referência marcado.</p>
          ) : compareLayer.points.map((p) => {
            const rec = compareLayer.pointRecords[p.id] || { muscle: '', unidades: '', observacao: '' };
            return (
              <p key={p.id} className="text-[11px] text-slate-300"><span className="font-bold">Ponto {p.order}:</span> {rec.muscle || '—'} {rec.unidades ? `· ${rec.unidades} ${pointValueLabel.toLowerCase()}` : ''} {rec.observacao ? `· ${rec.observacao}` : ''}</p>
            );
          })}
        </div>
      )}

      {/* Observações */}
      {!hideObservations && (
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase">Observações</label>
          <textarea value={observations} disabled={readOnly || !onObservationsChange} onChange={(e) => onObservationsChange?.(e.target.value)}
            rows={2} className="w-full mt-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 disabled:opacity-70" />
        </div>
      )}
    </div>
  );
}
