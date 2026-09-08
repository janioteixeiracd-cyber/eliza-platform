/**
 * Prova a máquina de estados REAL do frontend do Embedded Signup —
 * `EmbeddedSignupController` (src/lib/embeddedSignupController.ts), a
 * MESMA classe que `useWhatsAppEmbeddedSignup.ts` usa dentro do React —
 * importada diretamente (via tsx, sem jsdom/browser) e exercitada com
 * mocks só nos 3 pontos de I/O externo que a classe já recebe por
 * injeção de dependência (startAttempt/openMetaLogin/exchange). Nenhuma
 * reimplementação da lógica: é o módulo de produção de verdade.
 *
 * Cenários pedidos explicitamente (rodada final de fechamento):
 *   1. Autorização — startAttempt nega (403 OWNER_OR_ADMIN_REQUIRED),
 *      openMetaLogin/exchange nunca são chamados.
 *   2. Cancelamento — usuário nega no diálogo da Meta (not_authorized).
 *   3. Popup fechado — usuário fecha a janela sem completar (unknown).
 *   4. Code ausente — SDK volta 'connected' mas sem `code` (anomalia).
 *   5. Sucesso — fluxo completo, displayPhoneNumber sanitizado no final.
 *   6. Erro — exchange falha com um errorCode fora do allowlist mapeado
 *      (mensagem genérica, nunca eco de detalhe técnico).
 *   7. Tentativa expirada — exchange falha com 'attempt_expired' (410).
 *   8. Clique duplo — duas chamadas de start() sem esperar a primeira:
 *      só UMA execução real acontece.
 *   9. (bônus) Falha de rede — uma dependência lança exceção: nunca vaza
 *      err.message pra UI, sempre 'network_error' sanitizado.
 *
 * Run with:
 *   npx tsx scripts/verifyWhatsAppEmbeddedSignupFrontend.mjs
 */
import { EmbeddedSignupController } from "../src/lib/embeddedSignupController.ts";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeDeps(overrides = {}) {
  const calls = { startAttempt: 0, openMetaLogin: 0, exchange: 0 };
  const deps = {
    async startAttempt() {
      calls.startAttempt++;
      if (overrides.startAttempt) return overrides.startAttempt();
      return { ok: true, attemptId: "attempt-1" };
    },
    async openMetaLogin() {
      calls.openMetaLogin++;
      if (overrides.openMetaLogin) return overrides.openMetaLogin();
      return { status: "connected", code: "fb-code-1" };
    },
    async exchange(attemptId, code) {
      calls.exchange++;
      if (overrides.exchange) return overrides.exchange(attemptId, code);
      return { ok: true, displayPhoneNumber: "+55 11 98888-0000" };
    },
  };
  return { deps, calls };
}

function collectStates(controller) {
  const states = [];
  const unsubscribe = controller.subscribe((snap) => states.push(snap));
  return { states, unsubscribe };
}

async function main() {
  // ---- 1. Autorização ----
  console.log("--- 1. Autorização (não é owner/admin) ---");
  {
    const { deps, calls } = makeDeps({
      startAttempt: async () => ({ ok: false, status: 403, errorCode: "OWNER_OR_ADMIN_REQUIRED" }),
    });
    const controller = new EmbeddedSignupController(deps);
    const { states } = collectStates(controller);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode = OWNER_OR_ADMIN_REQUIRED", snap.errorCode === "OWNER_OR_ADMIN_REQUIRED", `errorCode=${snap.errorCode}`);
    check("Mensagem sanitizada específica de autorização", snap.errorMessage === "Só administradores da clínica podem conectar o WhatsApp.", `msg=${snap.errorMessage}`);
    check("openMetaLogin NUNCA chamado", calls.openMetaLogin === 0, `calls=${calls.openMetaLogin}`);
    check("exchange NUNCA chamado", calls.exchange === 0, `calls=${calls.exchange}`);
    check("Sequência de estados: idle -> preparing -> error", states.map((s) => s.status).join(",") === "idle,preparing,error", states.map((s) => s.status).join(","));
  }

  // ---- 2. Cancelamento ----
  console.log("\n--- 2. Cancelamento (usuário nega no diálogo da Meta) ---");
  {
    const { deps, calls } = makeDeps({
      openMetaLogin: async () => ({ status: "not_authorized", code: null }),
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode = cancelled_by_user", snap.errorCode === "cancelled_by_user", `errorCode=${snap.errorCode}`);
    check("exchange NUNCA chamado (nunca prossegue sem code)", calls.exchange === 0, `calls=${calls.exchange}`);
  }

  // ---- 3. Popup fechado ----
  console.log("\n--- 3. Popup fechado antes de completar ---");
  {
    const { deps, calls } = makeDeps({
      openMetaLogin: async () => ({ status: "unknown", code: null }),
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode = popup_closed", snap.errorCode === "popup_closed", `errorCode=${snap.errorCode}`);
    check("exchange NUNCA chamado", calls.exchange === 0, `calls=${calls.exchange}`);
  }

  // ---- 4. Code ausente ----
  console.log("\n--- 4. Code ausente (SDK 'connected' sem code) ---");
  {
    const { deps, calls } = makeDeps({
      openMetaLogin: async () => ({ status: "connected", code: null }),
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode = code_missing", snap.errorCode === "code_missing", `errorCode=${snap.errorCode}`);
    check("exchange NUNCA chamado (nunca troca code vazio)", calls.exchange === 0, `calls=${calls.exchange}`);
  }

  // ---- 5. Sucesso ----
  console.log("\n--- 5. Sucesso (fluxo completo) ---");
  {
    const { deps, calls } = makeDeps();
    const controller = new EmbeddedSignupController(deps);
    const { states } = collectStates(controller);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'completed'", snap.status === "completed", `status=${snap.status}`);
    check("displayPhoneNumber sanitizado presente", snap.displayPhoneNumber === "+55 11 98888-0000", `displayPhoneNumber=${snap.displayPhoneNumber}`);
    check("errorCode/errorMessage limpos no sucesso", snap.errorCode === null && snap.errorMessage === null);
    check("Sequência completa: idle,preparing,awaiting_meta,connecting,completed", states.map((s) => s.status).join(",") === "idle,preparing,awaiting_meta,connecting,completed", states.map((s) => s.status).join(","));
    check("Cada dependência chamada exatamente 1 vez", calls.startAttempt === 1 && calls.openMetaLogin === 1 && calls.exchange === 1, JSON.stringify(calls));
  }

  // ---- 6. Erro (exchange falha, código fora do allowlist) ----
  console.log("\n--- 6. Erro genérico do exchange ---");
  {
    const { deps } = makeDeps({
      exchange: async () => ({ ok: false, status: 422, errorCode: "waba_subscription_not_confirmed" }),
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode preservado (mesmo fora do allowlist de mensagens)", snap.errorCode === "waba_subscription_not_confirmed", `errorCode=${snap.errorCode}`);
    check("Mensagem cai no fallback genérico (nunca eco de detalhe técnico)", snap.errorMessage === "Não foi possível concluir a conexão com o WhatsApp. Tente novamente em instantes.", `msg=${snap.errorMessage}`);
    check("Nunca vaza o errorCode cru na mensagem exibida", !snap.errorMessage.includes("waba_subscription_not_confirmed"));
  }

  // ---- 7. Tentativa expirada ----
  console.log("\n--- 7. Tentativa expirada ---");
  {
    const { deps } = makeDeps({
      exchange: async () => ({ ok: false, status: 410, errorCode: "attempt_expired" }),
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode = attempt_expired", snap.errorCode === "attempt_expired", `errorCode=${snap.errorCode}`);
    check("Mensagem específica de expiração (orienta tentar de novo)", snap.errorMessage.toLowerCase().includes("expir"), `msg=${snap.errorMessage}`);
  }

  // ---- 8. Clique duplo ----
  console.log("\n--- 8. Clique duplo / replay ---");
  {
    let resolveStart;
    const startGate = new Promise((r) => { resolveStart = r; });
    const { deps, calls } = makeDeps({
      startAttempt: async () => { await startGate; return { ok: true, attemptId: "attempt-double" }; },
    });
    const controller = new EmbeddedSignupController(deps);

    const p1 = controller.start(); // fica preso em startAttempt (aguardando startGate)
    await sleep(50);
    check("Depois do 1º clique: inFlight=true", controller.isInFlight() === true);
    const p2 = controller.start(); // clique duplo — deve ser NO-OP silencioso
    await sleep(50);
    check("startAttempt ainda chamado só 1 vez (2º clique não disparou outra chamada)", calls.startAttempt === 1, `calls=${calls.startAttempt}`);

    resolveStart();
    await Promise.all([p1, p2]);
    const snap = controller.snapshot();
    check("Fluxo completou normalmente depois do gate liberar", snap.status === "completed", `status=${snap.status}`);
    check("Só 1 execução real end-to-end (openMetaLogin/exchange 1x cada, não 2x)", calls.openMetaLogin === 1 && calls.exchange === 1, JSON.stringify(calls));

    // Depois de completar, inFlight libera — uma nova chamada real (não é
    // replay, é o usuário clicando de novo depois de terminar) DEVE
    // funcionar normalmente.
    check("inFlight libera depois de terminar", controller.isInFlight() === false);
    await controller.start();
    check("Nova chamada pós-conclusão dispara startAttempt de novo (não é bloqueio permanente)", calls.startAttempt === 2, `calls=${calls.startAttempt}`);
  }

  // ---- 9. (bônus) Falha de rede — dependência lança exceção ----
  console.log("\n--- 9. Falha de rede (exceção lançada por uma dependência) ---");
  {
    const { deps } = makeDeps({
      openMetaLogin: async () => { throw new Error("SDK da Meta indisponível: detalhe técnico sensível de rede"); },
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    const snap = controller.snapshot();
    check("Estado final 'error'", snap.status === "error", `status=${snap.status}`);
    check("errorCode = network_error", snap.errorCode === "network_error", `errorCode=${snap.errorCode}`);
    check("Mensagem NUNCA contém o texto da exceção real", !snap.errorMessage.includes("detalhe técnico sensível"), `msg=${snap.errorMessage}`);
    check("inFlight libera mesmo após exceção (não trava o botão pra sempre)", controller.isInFlight() === false);
  }

  // ---- reset() ----
  console.log("\n--- reset() volta pra idle só fora de um fluxo em andamento ---");
  {
    const { deps } = makeDeps({
      exchange: async () => ({ ok: false, status: 500, errorCode: "some_error" }),
    });
    const controller = new EmbeddedSignupController(deps);
    await controller.start();
    check("Pré-condição: estado 'error' antes do reset", controller.snapshot().status === "error");
    controller.reset();
    check("reset() volta pra 'idle'", controller.snapshot().status === "idle", `status=${controller.snapshot().status}`);
    check("reset() limpa errorCode/errorMessage", controller.snapshot().errorCode === null && controller.snapshot().errorMessage === null);
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
