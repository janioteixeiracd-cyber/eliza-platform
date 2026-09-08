/**
 * Prova, importando a função real (src/lib/elizaCore/functionalRole.ts),
 * que normalizeFunctionalRole() mapeia corretamente todo o texto livre de
 * ROLE_OPTIONS (NextAdmin.tsx) pra uma categoria funcional fechada, com
 * fallback seguro pra "geral" e override de owner/admin sempre "gestao" —
 * puro Node/TS, sem Firestore, roda em milissegundos.
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs scripts/verifyElizaFunctionalRole.mjs
 */
import { normalizeFunctionalRole } from "../src/lib/elizaCore/functionalRole.ts";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

function user(memberRole, isOwnerOrAdmin = false) {
  return { uid: "uid-x", clinicId: "clinic-x", memberRole, isOwnerOrAdmin, memberData: {} };
}

console.log("--- Todas as strings de ROLE_OPTIONS (NextAdmin.tsx) ---");
const EXPECTED = {
  "Dentista": "clinico",
  "Médico": "clinico",
  "Secretária": "secretaria",
  "Financeiro": "financeiro",
  "Marketing": "marketing",
  "Comercial": "marketing",
  "Auxiliar": "secretaria",
  "Coordenador": "gestao",
  "Gestor": "gestao",
  "Recepção": "secretaria",
  "Estagiário": "secretaria",
  "Outro": "geral",
};
for (const [role, expected] of Object.entries(EXPECTED)) {
  check(`"${role}" -> ${expected}`, normalizeFunctionalRole(user(role)) === expected, `got ${normalizeFunctionalRole(user(role))}`);
}

console.log("\n--- Case-insensitive / espaço extra ---");
check("'  dentista  ' -> clinico", normalizeFunctionalRole(user("  dentista  ")) === "clinico");
check("'SECRETÁRIA' -> secretaria", normalizeFunctionalRole(user("SECRETÁRIA")) === "secretaria");

console.log("\n--- Fallback seguro ---");
check("string vazia -> geral", normalizeFunctionalRole(user("")) === "geral");
check("role desconhecido -> geral", normalizeFunctionalRole(user("Bicho Papão")) === "geral");
check("role undefined -> geral (nunca lança)", normalizeFunctionalRole(user(undefined)) === "geral");

console.log("\n--- Override owner/admin: sempre 'gestao', mesmo com memberRole de outra categoria ---");
check("isOwnerOrAdmin=true + role='Secretária' -> gestao", normalizeFunctionalRole(user("Secretária", true)) === "gestao");
check("isOwnerOrAdmin=true + role='' -> gestao", normalizeFunctionalRole(user("", true)) === "gestao");

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
