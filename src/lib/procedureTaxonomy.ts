/**
 * Central procedure taxonomy for the ELIZA platform.
 *
 * Single source of truth for "what kind of procedure is this" across every
 * module that touches a procedure (Orçamento, Financeiro, Agenda,
 * Prontuário, Planejamento IA, Estoque, Intelligence/temporal metrics).
 * Nothing should declare its own ad-hoc category list — import this one.
 *
 * Deliberately NOT retroactive: existing quotation items / financial
 * entries created before this taxonomy existed are left as free text.
 * `procedureCategory` is optional everywhere and only gets set going
 * forward, by explicit user choice — never inferred from old text.
 */

export const PROCEDURE_CATEGORIES = [
  'avaliacao',
  'dentistica_restauradora',
  'endodontia',
  'periodontia',
  'cirurgia_oral',
  'protese',
  'implantodontia',
  'ortodontia',
  'odontopediatria',
  'estetica_facial',
  'harmonizacao_orofacial',
  'outro',
] as const;

export type ProcedureCategory = typeof PROCEDURE_CATEGORIES[number];

export const PROCEDURE_CATEGORY_LABELS: Record<ProcedureCategory, string> = {
  avaliacao: 'Avaliação / Consulta',
  dentistica_restauradora: 'Dentística / Restauradora',
  endodontia: 'Endodontia',
  periodontia: 'Periodontia',
  cirurgia_oral: 'Cirurgia Oral',
  protese: 'Prótese',
  implantodontia: 'Implantodontia',
  ortodontia: 'Ortodontia',
  odontopediatria: 'Odontopediatria',
  estetica_facial: 'Estética Facial (Botox/Preenchimento/Bioestimulador)',
  harmonizacao_orofacial: 'Harmonização Orofacial',
  outro: 'Outro',
};

export const PROCEDURE_CATEGORY_OPTIONS: { value: ProcedureCategory; label: string }[] =
  PROCEDURE_CATEGORIES.map((value) => ({ value, label: PROCEDURE_CATEGORY_LABELS[value] }));

// ============================================================================
// Catálogo Clínico Central ELIZA — conceptual shape, not yet a live collection.
// ============================================================================
// `procedureCategory` above (a fixed enum) is the first, already-shipped
// rung of this ladder — every quotation item can carry one today. The next
// rung, once actually needed, is a real catalog entry per procedure: a
// stable `procedureId` that Planejamento IA → Orçamento → Agenda →
// Prontuário → Financeiro → Estoque → Recall → Intelligence can all point
// at instead of each re-typing (and mis-typing) the same procedure name —
// this is the concrete gap the temporal audit found ("Reabilitacao " vs
// "Reabilitação", "BOTOX" vs "Botox" in this clinic's own real data).
//
// Intended home once built: `clinics/{clinicId}/procedure_catalog/{procedureId}`
// (clinic-scoped, not platform-wide — each clinic names its own procedures).
// Deliberately not created now: no module writes or reads a procedureId
// yet, and per the approved data-quality scope this round, nothing here
// should invent structure ahead of an actual consumer.
export interface ProcedureCatalogEntry {
  procedureId: string;
  category: ProcedureCategory;
  name: string;
  /** Alternate spellings/abbreviations staff might type — lets future search/matching tolerate "HOF" == "Harmonização Orofacial" without guessing. */
  aliases: string[];
  active: boolean;
  /**
   * Which PlanningCore template (`src/lib/planningTemplates.ts`) drives this
   * procedure's Planejamento IA experience — its document types, structured
   * fields, canvas tools and AI context. Falls back to `DEFAULT_TEMPLATE`
   * when absent, so an older catalog entry never breaks the screen.
   */
  templateId?: string;
}
