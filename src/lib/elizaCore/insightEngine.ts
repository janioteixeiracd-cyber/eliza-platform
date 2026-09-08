/**
 * ELIZA Intelligence v2 — deterministic Insight Engine.
 *
 * Rule-based only: every Insight it emits comes from a fixed threshold
 * applied to a tool's already-computed numbers. No AI call happens in this
 * file. The orchestrator later asks the model to *explain* these insights
 * (inferencia/sugestao) — the model is never the thing deciding whether an
 * insight exists in the first place, and it never sees raw Firestore docs,
 * only the small evidence lists built here.
 *
 * Priority score: also fully deterministic (scoreInsight below). The model
 * may explain WHY something is prioritized, but the number itself is fixed
 * by this formula, never invented per-answer.
 */
import type { AgendaAnalysisResult, FinancialSummaryResult, OpenBudgetsResult, RecallCandidatesResult, PendingItemsResult, PatientContextResult } from "./tools";
import type { Insight, InsightCategory, InsightSeverity, InsightSuggestedAction } from "./types";
import type { ElizaFunctionalRole } from "./functionalRole";

function currency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ============================================================================
// Deterministic priority score
// ============================================================================
// Combines the factors requested: urgência (severidade), impacto financeiro,
// prazo (idade/atraso), quantidade de pacientes/itens afetados, risco
// operacional (parte da severidade) e oportunidade de conversão. Every
// weight below is a fixed constant — nothing here is estimated by the LLM.

interface ScoreInput {
  severity: InsightSeverity;
  amountAtRisk?: number;
  affectedCount?: number;
  maxAgeDays?: number;
  isConversionOpportunity?: boolean;
}

const SEVERITY_BASE: Record<InsightSeverity, number> = { risco: 40, atencao: 25, oportunidade: 15, info: 5 };

function scoreInsight(input: ScoreInput): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = SEVERITY_BASE[input.severity];
  if (input.severity === "risco") factors.push("risco operacional alto");
  else if (input.severity === "atencao") factors.push("requer atenção");

  if (input.amountAtRisk && input.amountAtRisk > 0) {
    score += Math.min(input.amountAtRisk / 2000, 25);
    factors.push(`impacto financeiro de ${currency(input.amountAtRisk)}`);
  }

  if (input.affectedCount && input.affectedCount > 0) {
    score += Math.min(input.affectedCount * 1.5, 15);
    if (input.affectedCount >= 3) factors.push(`${input.affectedCount} paciente(s)/item(ns) afetado(s)`);
  }

  if (input.maxAgeDays && input.maxAgeDays > 0) {
    score += Math.min(input.maxAgeDays / 5, 20);
    if (input.maxAgeDays >= 14) factors.push(`parado(s) há até ${input.maxAgeDays} dia(s)`);
  }

  if (input.isConversionOpportunity) {
    score += 10;
    factors.push("oportunidade de conversão");
  }

  return { score: Math.round(score), factors };
}

export function buildInsights(data: {
  agenda?: AgendaAnalysisResult;
  financial?: FinancialSummaryResult;
  budgets?: OpenBudgetsResult;
  recall?: RecallCandidatesResult;
  pending?: PendingItemsResult;
  patient?: PatientContextResult;
  screenType?: string;
  functionalRole?: ElizaFunctionalRole;
}): Insight[] {
  const insights: Insight[] = [];

  if (data.financial && data.financial.overdueCount > 0) {
    const s = scoreInsight({ severity: "risco", amountAtRisk: data.financial.overdueAmount, affectedCount: data.financial.overdueCount });
    const suggestedActions: InsightSuggestedAction[] = [{
      actionType: "create_task",
      label: "Criar tarefa de cobrança",
      prefillInput: {
        title: "Revisar contas vencidas e priorizar cobrança",
        description: `${data.financial.overdueCount} lançamento(s) vencido(s), somando ${currency(data.financial.overdueAmount)}.`,
        priority: "Alta",
      },
    }];
    insights.push({
      id: "financeiro-vencidas",
      category: "financeiro",
      severity: "risco",
      title: "Receita em risco: contas vencidas",
      description: `${data.financial.overdueCount} lançamento(s) vencido(s), somando ${currency(data.financial.overdueAmount)}.`,
      basis: "calculo",
      evidence: { label: "Lançamentos vencidos", basis: "calculo", items: data.financial.overdueEntries },
      priorityScore: s.score,
      priorityFactors: s.factors,
      suggestedActions,
    });
  }

  if (data.budgets && data.budgets.count > 0) {
    const stale = data.budgets.items.filter((i) => i.ageDays > 7).length;
    const maxAge = data.budgets.items.reduce((m, i) => Math.max(m, i.ageDays), 0);
    const severity: InsightSeverity = stale > 0 ? "atencao" : "oportunidade";
    const s = scoreInsight({ severity, amountAtRisk: data.budgets.totalValue, affectedCount: data.budgets.count, maxAgeDays: maxAge, isConversionOpportunity: true });
    const patientIds = Array.from(new Set(data.budgets.items.map((i) => i.patientId).filter(Boolean))).slice(0, 50);
    const suggestedActions: InsightSuggestedAction[] = patientIds.length > 0 ? [{
      actionType: "prepare_campaign",
      label: "Preparar contato em massa",
      prefillInput: { patientIds, purpose: "Retomar contato sobre orçamento em aberto" },
    }] : [];
    insights.push({
      id: "orcamentos-abertos",
      category: "orcamentos",
      severity,
      title: "Orçamentos sem resposta",
      description: `${data.budgets.count} orçamento(s) em rascunho (nunca aprovados ou rejeitados) somam ${currency(data.budgets.totalValue)}${stale > 0 ? `, ${stale} deles com mais de 7 dias parados` : ""}.`,
      basis: "calculo",
      evidence: {
        label: "Orçamentos em aberto",
        basis: "calculo",
        items: data.budgets.items.map((i) => ({ id: i.id, label: i.label, value: i.totalValue, detail: `${i.ageDays}d parado` })),
      },
      priorityScore: s.score,
      priorityFactors: s.factors,
      suggestedActions,
    });
  }

  if (data.recall && data.recall.count > 0) {
    const maxAge = data.recall.items.reduce((m, i) => Math.max(m, i.daysSinceLastVisit), 0);
    const s = scoreInsight({ severity: "oportunidade", affectedCount: data.recall.count, maxAgeDays: maxAge, isConversionOpportunity: true });
    const patientIds = Array.from(new Set(data.recall.items.map((i) => i.patientId).filter(Boolean))).slice(0, 50);
    const suggestedActions: InsightSuggestedAction[] = patientIds.length > 0 ? [{
      actionType: "prepare_campaign",
      label: "Preparar campanha de recall",
      prefillInput: { patientIds, purpose: "Convite para retorno à clínica" },
    }] : [];
    insights.push({
      id: "recall-candidatos",
      category: "recall",
      severity: "oportunidade",
      title: "Pacientes na janela de retorno",
      description: `${data.recall.count} paciente(s) sem retorno agendado há mais de 90 dias desde o último atendimento.`,
      basis: "calculo",
      evidence: {
        label: "Pacientes para reativar",
        basis: "calculo",
        items: data.recall.items.map((i) => ({ id: i.id, label: i.label, detail: `${i.daysSinceLastVisit}d sem retorno` })),
      },
      priorityScore: s.score,
      priorityFactors: s.factors,
      suggestedActions,
    });
  }

  if (data.agenda && data.agenda.pendingConfirmations > 0) {
    const s = scoreInsight({ severity: "atencao", affectedCount: data.agenda.pendingConfirmations });
    insights.push({
      id: "agenda-pendentes",
      category: "agenda",
      severity: "atencao",
      title: "Confirmações pendentes na agenda",
      description: `${data.agenda.pendingConfirmations} agendamento(s) pendente(s) de confirmação entre ${data.agenda.rangeFrom} e ${data.agenda.rangeTo}.`,
      basis: "calculo",
      evidence: { label: "Agendamentos pendentes", basis: "calculo", items: data.agenda.pendingAppointments },
      priorityScore: s.score,
      priorityFactors: s.factors,
      suggestedActions: [{
        actionType: "create_task",
        label: "Confirmar agendamentos pendentes",
        prefillInput: { title: "Confirmar agendamentos pendentes da semana", description: `${data.agenda.pendingConfirmations} agendamento(s) aguardando confirmação.`, priority: "Média" },
      }],
    });
  }

  if (data.agenda && data.agenda.cancellations >= 3) {
    const s = scoreInsight({ severity: "atencao", affectedCount: data.agenda.cancellations });
    insights.push({
      id: "agenda-cancelamentos",
      category: "agenda",
      severity: "atencao",
      title: "Cancelamentos registrados",
      description: `${data.agenda.cancellations} cancelamento(s) no histórico de agendamentos lidos.`,
      basis: "calculo",
      evidence: { label: "Cancelamentos", basis: "calculo", items: data.agenda.cancelledAppointments },
      priorityScore: s.score,
      priorityFactors: s.factors,
      suggestedActions: [{
        actionType: "create_task",
        label: "Investigar cancelamentos",
        prefillInput: { title: "Investigar causa dos cancelamentos recorrentes", description: `${data.agenda.cancellations} cancelamento(s) registrados.`, priority: "Média" },
      }],
    });
  }

  if (data.pending && data.pending.count > 0) {
    const s = scoreInsight({ severity: "atencao", affectedCount: data.pending.count });
    insights.push({
      id: "pendencias-operacionais",
      category: "pendencias",
      severity: "atencao",
      title: "Pendências operacionais",
      description: `${data.pending.count} item(ns) pendente(s) aguardando ação (Portal do Paciente, tarefas da agenda).`,
      basis: "fato",
      evidence: { label: "Pendências", basis: "fato", items: data.pending.items },
      priorityScore: s.score,
      priorityFactors: s.factors,
      suggestedActions: [{
        actionType: "create_task",
        label: "Revisar pendências",
        prefillInput: { title: "Revisar e resolver pendências operacionais em aberto", description: `${data.pending.count} pendência(s) aguardando ação.`, priority: "Média" },
      }],
    });
  }

  if (data.patient) {
    const p = data.patient;
    if (p.openQuotations.length > 0) {
      const total = p.openQuotations.reduce((s, q) => s + q.value, 0);
      const maxAge = p.openQuotations.reduce((m, q) => Math.max(m, q.ageDays), 0);
      const s = scoreInsight({ severity: "oportunidade", amountAtRisk: total, affectedCount: 1, maxAgeDays: maxAge, isConversionOpportunity: true });
      insights.push({
        id: "paciente-orcamentos-abertos",
        category: "paciente",
        severity: "oportunidade",
        title: `Orçamentos em aberto para ${p.name}`,
        description: `${p.openQuotations.length} orçamento(s) em rascunho para este paciente, somando ${currency(total)}.`,
        basis: "calculo",
        evidence: { label: "Orçamentos do paciente", basis: "calculo", items: p.openQuotations.map((q) => ({ id: q.id, label: q.label, value: q.value, detail: `${q.ageDays}d parado` })) },
        priorityScore: s.score,
        priorityFactors: s.factors,
        suggestedActions: [{
          actionType: "prepare_message",
          label: "Preparar contato com o paciente",
          prefillInput: { patientId: p.patientId, purpose: "Retomar contato sobre orçamento em aberto" },
        }],
      });
    }
    if (p.overdueFinancial.count > 0) {
      const s = scoreInsight({ severity: "risco", amountAtRisk: p.overdueFinancial.amount, affectedCount: 1 });
      insights.push({
        id: "paciente-financeiro-vencido",
        category: "paciente",
        severity: "risco",
        title: `Pendência financeira de ${p.name}`,
        description: `${p.overdueFinancial.count} lançamento(s) vencido(s) deste paciente, somando ${currency(p.overdueFinancial.amount)}.`,
        basis: "calculo",
        evidence: { label: "Lançamentos vencidos do paciente", basis: "calculo", items: p.overdueFinancial.items },
        priorityScore: s.score,
        priorityFactors: s.factors,
        suggestedActions: [{
          actionType: "prepare_message",
          label: "Preparar cobrança",
          prefillInput: { patientId: p.patientId, purpose: "Lembrete cordial sobre pendência financeira em aberto" },
        }],
      });
    }
    if (p.upcomingAppointments.length === 0) {
      const s = scoreInsight({ severity: "info", affectedCount: 1 });
      insights.push({
        id: "paciente-sem-retorno",
        category: "paciente",
        severity: "info",
        title: `${p.name} sem retorno agendado`,
        description: `Não há agendamento futuro registrado para este paciente.`,
        basis: "fato",
        evidence: { label: "Agenda do paciente", basis: "fato", items: [] },
        priorityScore: s.score,
        priorityFactors: s.factors,
        suggestedActions: [{
          actionType: "create_appointment_request",
          label: "Solicitar retorno",
          prefillInput: { patientId: p.patientId, notes: "Sugerir agendamento de retorno para este paciente." },
        }],
      });
    }
  }

  // Final ranking: priorityScore is the single sort key. Screen relevance
  // (the category matching where the user is asking from) is folded in as
  // a large, fixed bonus rather than a separate re-sort pass — same
  // guarantee as before (matching category always surfaces first) but
  // expressed as one deterministic number instead of two competing sorts.
  const priorityCategory: Record<string, string> = {
    financeiro: "financeiro",
    paciente: "paciente",
    planejamento: "paciente",
  };
  const priority = data.screenType ? priorityCategory[data.screenType] : undefined;

  // Bônus de papel funcional: reforço/desempate, sempre menor que o bônus
  // de screenType acima (a tela onde a pessoa está agora ainda é o sinal
  // primário) — nunca esconde um insight, só reordena. Ver
  // functionalRole.ts pra normalização do papel; nunca inventado pelo
  // modelo, decidido aqui, determinístico.
  const ROLE_CATEGORY_PRIORITY: Record<ElizaFunctionalRole, InsightCategory[]> = {
    secretaria: ["agenda", "recall", "pendencias"],
    clinico: ["paciente"],
    financeiro: ["financeiro", "orcamentos"],
    marketing: ["recall", "orcamentos"],
    gestao: [],
    geral: [],
  };
  const roleCategories = data.functionalRole ? ROLE_CATEGORY_PRIORITY[data.functionalRole] : [];

  const sortKey = (i: Insight) =>
    i.priorityScore
    + (priority && i.category === priority ? 1000 : 0)
    + (roleCategories.includes(i.category) ? 200 : 0);
  insights.sort((a, b) => sortKey(b) - sortKey(a));

  return insights;
}
