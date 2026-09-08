/**
 * Papel funcional pra personalização da ELIZA — separado de auth.ts de
 * propósito: auth.ts é autorização binária (pode ou não acessar algo);
 * isto aqui nunca bloqueia nada, só decide ênfase/vocabulário. `role` em
 * clinics/{id}/members/{uid} é texto livre (ver NextAdmin.tsx
 * ROLE_OPTIONS) — nunca confiar nele como enum fechado, sempre mapear
 * com fallback seguro pra "geral".
 */
import type { ElizaAuthedUser } from "./auth";

export type ElizaFunctionalRole = "secretaria" | "clinico" | "financeiro" | "marketing" | "gestao" | "geral";

const ROLE_TEXT_MAP: Record<string, ElizaFunctionalRole> = {
  "secretária": "secretaria",
  "secretaria": "secretaria",
  "recepção": "secretaria",
  "recepcao": "secretaria",
  "auxiliar": "secretaria",
  "estagiário": "secretaria",
  "estagiario": "secretaria",
  "dentista": "clinico",
  "médico": "clinico",
  "medico": "clinico",
  "financeiro": "financeiro",
  "marketing": "marketing",
  "comercial": "marketing",
  "coordenador": "gestao",
  "gestor": "gestao",
};

export const FUNCTIONAL_ROLE_LABELS: Record<ElizaFunctionalRole, string> = {
  secretaria: "Secretaria/Recepção",
  clinico: "Profissional clínico",
  financeiro: "Financeiro",
  marketing: "Marketing/Comercial",
  gestao: "Gestão",
  geral: "Geral",
};

// Frases fixas, nunca inventadas pelo modelo — só decidem ênfase (regra 13
// do systemPrompt em server.ts), nunca omitem risco.
export const ROLE_FRAMING_HINTS: Record<ElizaFunctionalRole, string> = {
  secretaria: "Priorize agenda, confirmações e janelas de contato — o que precisa ser feito hoje para preencher horários e reduzir faltas.",
  clinico: "Priorize histórico clínico, risco e plano de tratamento — dê sua leitura profissional com confiança, mesmo que seja uma recomendação de cautela.",
  financeiro: "Priorize caixa, inadimplência e conciliação — separe faturado de efetivamente recebido sempre que os dados permitirem.",
  marketing: "Priorize origem, conversão e oportunidades de campanha cruzando o funil com a agenda real.",
  gestao: "Dê uma visão integrada cruzando agenda, financeiro e conversão — não se limite a uma única área.",
  geral: "Responda de forma geral, sem assumir uma função específica.",
};

/**
 * Dono/admin sempre vê a visão integrada (gestao), independentemente do
 * texto livre em `role` — mesmo espírito de isOwnerOrAdmin em
 * canAccessFinance (auth.ts). Papel não mapeado (ex: "Outro", string
 * vazia, valor desconhecido) cai em "geral" — nunca lança erro, nunca
 * bloqueia a pergunta.
 */
export function normalizeFunctionalRole(user: ElizaAuthedUser): ElizaFunctionalRole {
  if (user.isOwnerOrAdmin) return "gestao";
  const key = (user.memberRole || "").trim().toLowerCase();
  return ROLE_TEXT_MAP[key] || "geral";
}
