/**
 * "Contrate a ELIZA" — the 4 commercial modalities and what each one turns on.
 *
 * Cumulative by design (secretary includes everything assistant has, manager
 * includes everything secretary has, ceo includes everything). `ceo` is not
 * sold yet (see `platform_plans/{id}.salesEnabled`) — its two differentiating
 * capabilities (`multiUnit`, `predictiveAnalytics`) don't exist in the app at
 * all yet, so nothing should ever gate on them being true.
 *
 * This is UI-level enforcement only (used by ElizaNextLayout.tsx's nav
 * gating), the same rigor level the existing per-member `accessFinancial`-
 * style flags already have — none of this is re-enforced in firestore.rules.
 */

export type PlanRole = 'assistant' | 'secretary' | 'manager' | 'ceo';

export interface PlanCapabilities {
  clinicalCore: boolean;
  scheduling: boolean;
  documents: boolean;
  whatsapp: boolean;
  conversationalAI: boolean;
  reminders: boolean;
  recall: boolean;
  crm: boolean;
  financial: boolean;
  commissions: boolean;
  goals: boolean;
  analytics: boolean;
  clinicalAI: boolean;
  managementAI: boolean;
  multiUnit: boolean;
  predictiveAnalytics: boolean;
}

// Audited against the real Next codebase (not assumed from the commercial
// brief) before these booleans were set — see the comments on `reminders`,
// `recall`, `crm`, `goals` below. Never flip one of these to `true` without
// a real feature backing it; the whole point of a capability matrix is that
// it's honest, not just a copy of the sales pitch.
export const PLAN_CAPABILITIES: Record<PlanRole, PlanCapabilities> = {
  assistant: {
    clinicalCore: true, scheduling: true, documents: true,
    whatsapp: false, conversationalAI: false, reminders: false, recall: false, crm: false,
    financial: false, commissions: false, goals: false, analytics: false, clinicalAI: false, managementAI: false,
    multiUnit: false, predictiveAnalytics: false,
  },
  secretary: {
    clinicalCore: true, scheduling: true, documents: true,
    whatsapp: true, conversationalAI: true,
    // `reminders` (automated patient reminders) does not exist anywhere in
    // Next today — NextWhatsApp.tsx's send action is a manual wa.me draft
    // link ("nada é disparado automaticamente" is literally in its own UI
    // copy). The scheduled server.ts jobs that DO send automatically are
    // staff-facing alerts, never patient reminders. Stays false until a real
    // automated-send feature exists.
    reminders: false,
    // `recall` is real but partial: NextWhatsApp.tsx flags patients with no
    // appointment in 90+ days ("Retorno Recomendado"), but there's no
    // pipeline/status tracking and outreach is manual. True here because the
    // signal is genuinely useful, but marketing copy must say "identifica
    // pacientes que precisam retornar", not "recall automatizado".
    recall: true,
    // `crm` maps to Orçamento status tracking (draft/approved/rejected) +
    // the Opportunity Deck's "orçamentos sem resposta" insight — real, but
    // NOT a lead funnel (no lead entity, no lead source, no conversion
    // tracking, no abandoned status). Copy must say "acompanhamento de
    // orçamentos e oportunidades", never "funil comercial completo".
    crm: true,
    financial: false, commissions: false, goals: false, analytics: false, clinicalAI: false, managementAI: false,
    multiUnit: false, predictiveAnalytics: false,
  },
  manager: {
    clinicalCore: true, scheduling: true, documents: true,
    whatsapp: true, conversationalAI: true, reminders: false, recall: true, crm: true,
    financial: true, commissions: true,
    // `goals` does not exist in Next at all — not even partially. The one
    // hit in the whole codebase is a quick-prompt BUTTON LABEL in
    // NextAICore.tsx ("Resumo do Caixa e Metas") whose query just asks the
    // AI about this month's revenue — no stored target, no progress bar, no
    // threshold. Stays false until a real goals feature is built.
    goals: false,
    analytics: true, clinicalAI: true, managementAI: true,
    multiUnit: false, predictiveAnalytics: false,
  },
  ceo: {
    clinicalCore: true, scheduling: true, documents: true,
    whatsapp: true, conversationalAI: true, reminders: false, recall: true, crm: true,
    financial: true, commissions: true, goals: false, analytics: true, clinicalAI: true, managementAI: true,
    // The two features that would actually differentiate CEO from Gestora
    // don't exist yet — this is *why* CEO isn't for sale yet
    // (`salesEnabled: false` on its platform_plans doc), not a coincidence.
    multiUnit: true, predictiveAnalytics: true,
  },
};

export const PLAN_ROLE_LABELS: Record<PlanRole, string> = {
  assistant: 'ELIZA Assistente',
  secretary: 'ELIZA Secretária',
  manager: 'ELIZA Gestora',
  ceo: 'ELIZA CEO',
};

// A clinic created before this system existed has no `planRole` set. Default
// to 'manager', not 'assistant' — nobody who already has access to
// Financeiro/Comissões/Relatórios/IA Clínica today should lose it just
// because this rollout happened; 'ceo'-only features don't exist yet anyway,
// so 'manager' is functionally the full current feature set.
export const DEFAULT_PLAN_ROLE: PlanRole = 'manager';

export function getPlanCapabilities(planRole: PlanRole | undefined | null): PlanCapabilities {
  return PLAN_CAPABILITIES[planRole || DEFAULT_PLAN_ROLE] || PLAN_CAPABILITIES[DEFAULT_PLAN_ROLE];
}
