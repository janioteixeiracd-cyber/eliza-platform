/**
 * Prova, importando a MESMA função que NextAdmin.tsx, WhatsAppSettings.tsx
 * e ChatInterface.tsx usam de verdade (src/lib/clinicRole.ts,
 * isClinicOwnerOrAdmin) — não uma reimplementação paralela pro teste —
 * que o gate de "pode ver/configurar o WhatsApp completo" cobre owner E
 * admin, não só um deles, e nega corretamente um membro comum.
 *
 * Pedido explícito do usuário (revisão): "o trecho e o teste que
 * comprovam acesso de owner e admin ao Embedded Signup em NextAdmin.tsx,
 * sem depender apenas de isAdmin" — antes desta rodada, `isAdmin` era uma
 * expressão inline duplicada em 3 arquivos, nunca testada; agora é uma
 * função extraída, importada pelos 3, e testada aqui isoladamente (sem
 * DOM, sem emulador — puro Node, roda em milissegundos).
 *
 * Run with:
 *   node scripts/verifyClinicRoleGate.mjs
 */
import { isClinicOwnerOrAdmin } from "../src/lib/clinicRole.ts";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

console.log("--- Membro comum (role='member', não é owner) ---");
check(
  "member: NEGADO",
  isClinicOwnerOrAdmin({ profileRole: "member", clinicOwnerId: "uid-owner", userId: "uid-member" }) === false
);

console.log("\n--- Admin (role='admin', não é owner) ---");
check(
  "admin: PERMITIDO",
  isClinicOwnerOrAdmin({ profileRole: "admin", clinicOwnerId: "uid-owner", userId: "uid-admin" }) === true
);

console.log("\n--- Owner via profile.role==='owner' ---");
check(
  "role='owner': PERMITIDO",
  isClinicOwnerOrAdmin({ profileRole: "owner", clinicOwnerId: "uid-owner", userId: "uid-owner" }) === true
);

console.log("\n--- Owner via clinic.ownerId===userId (role legado/ausente) ---");
check(
  "ownerId bate, role indefinido: PERMITIDO",
  isClinicOwnerOrAdmin({ profileRole: undefined, clinicOwnerId: "uid-owner", userId: "uid-owner" }) === true
);
check(
  "ownerId bate, role='member' (dado legado inconsistente): AINDA PERMITIDO — ownerId é a fonte de verdade final",
  isClinicOwnerOrAdmin({ profileRole: "member", clinicOwnerId: "uid-owner", userId: "uid-owner" }) === true
);

console.log("\n--- Nem admin, nem owner ---");
check(
  "role ausente, ownerId não bate: NEGADO",
  isClinicOwnerOrAdmin({ profileRole: undefined, clinicOwnerId: "uid-owner", userId: "uid-other" }) === false
);
check(
  "role='member' explícito, ownerId não bate: NEGADO",
  isClinicOwnerOrAdmin({ profileRole: "member", clinicOwnerId: "uid-owner", userId: "uid-other" }) === false
);

console.log("\n--- Casos-limite (clínica/usuário ainda não carregados) ---");
check(
  "clinicOwnerId ausente (clínica ainda carregando), role ausente: NEGADO (nunca autoriza no vazio)",
  isClinicOwnerOrAdmin({ profileRole: undefined, clinicOwnerId: undefined, userId: "uid-x" }) === false
);
check(
  "userId ausente (sessão ainda carregando), ownerId presente: NEGADO (nunca compara undefined===undefined como match)",
  isClinicOwnerOrAdmin({ profileRole: undefined, clinicOwnerId: "uid-owner", userId: undefined }) === false
);
check(
  "os dois ausentes: NEGADO",
  isClinicOwnerOrAdmin({}) === false
);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
