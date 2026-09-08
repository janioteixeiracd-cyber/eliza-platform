// Rótulos legíveis pros 5 tipos de "cognitive gap" que a ELIZA Consciência
// gera em pending_items (type: 'eliza_cognitive_gap', campo cognitiveType).
// Compartilhado entre o assistente flutuante (NextElizaAssistant.tsx) e a
// Central de Tarefas (NextPortalActivity.tsx) — mesma pendência, mesmo texto,
// em vez de duas listas que podem divergir com o tempo.
export const COGNITIVE_GAP_LABELS: Record<string, string> = {
  finished_appointment_without_clinical_update: 'Pendência: atendimento sem evolução registrada',
  overdue_financial_risk: 'Risco financeiro identificado',
  stale_open_budgets: 'Orçamentos parados sem resposta',
  recall_backlog: 'Pacientes na janela de retorno',
  operational_pending_backlog: 'Pendências operacionais acumuladas',
};
