/**
 * Predicado ÚNICO de "é owner ou admin desta clínica" pro FRONTEND —
 * extraído nesta rodada porque a mesma expressão inline (`profile?.role
 * === 'admin' || profile?.role === 'owner' || clinic?.ownerId ===
 * user?.uid`) estava duplicada, sem nenhum teste próprio, em 3 lugares
 * (NextAdmin.tsx, WhatsAppSettings.tsx, ChatInterface.tsx) — cada um só
 * "provado" por leitura de código, nunca por um teste real. Zero
 * dependência de React/DOM de propósito: testável em Node puro (ver
 * scripts/verifyClinicRoleGate.mjs), a mesma função que os 3 componentes
 * importam de verdade, não uma reimplementação paralela pro teste.
 *
 * Nunca confundir com a autorização REAL do backend
 * (authenticateOwnerOrAdmin em server.ts) — este predicado só decide o
 * que a UI mostra/esconde; o servidor sempre reforça a mesma regra de
 * forma independente (ver firestore.rules item 7 — Admin SDK/rotas do
 * servidor nunca dependem do que o client calculou).
 */
export interface ClinicRoleInput {
  profileRole?: string | null;
  clinicOwnerId?: string | null;
  userId?: string | null;
}

export function isClinicOwnerOrAdmin({ profileRole, clinicOwnerId, userId }: ClinicRoleInput): boolean {
  if (profileRole === 'admin' || profileRole === 'owner') return true;
  return !!clinicOwnerId && !!userId && clinicOwnerId === userId;
}
