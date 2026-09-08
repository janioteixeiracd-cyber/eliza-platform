/**
 * Prova, contra o server.ts real (via tsx) rodando contra o emulador, os
 * endpoints /api/whatsapp/embedded-signup/start-attempt e /exchange —
 * segunda rodada, de PARIDADE e FENCING em cima da primeira (que já
 * cobria autorização/expiração/replay de attemptId/concorrência/falha
 * parcial/concorrência otimista básica). Secret Manager e Graph API
 * SEMPRE mockados (WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS=1) — nenhuma
 * chamada real, nenhuma ação na Meta, nenhum secret real tocado.
 *
 * Cenários NOVOS desta rodada:
 *   1. Paridade do Secret Manager — clínica sem secret provisionado falha
 *      IGUAL ao cliente real (nunca auto-cria); nada é promovido.
 *   2. Versões órfãs — secret criado com sucesso, etapa seguinte falha:
 *      versão registrada como órfã, nunca promovida, uma tentativa
 *      seguinte bem-sucedida usa uma versão DIFERENTE.
 *   3. Reserva global do telefone — duas clínicas disputando o mesmo
 *      phoneNumberId (concorrência real via Promise.all): só uma reserva
 *      e promove; a mesma clínica reconectando seu próprio número já
 *      ativo é permitida.
 *   4. Rollback seguro da WABA — A cria a assinatura (numa phoneNumberId
 *      própria), B reusa a MESMA wabaId (phoneNumberId diferente) e
 *      conclui primeiro, A falha depois: A não pode desassinar a WABA que
 *      B está usando.
 *   5. Confirmação da assinatura — GET de confirmação depois do POST;
 *      falha ou resposta inconclusiva bloqueia a promoção.
 *   6. Code OAuth consumido — depois que um code já foi trocado por
 *      token, nem essa tentativa (falha depois) nem NENHUMA outra pode
 *      reusá-lo; o mock rejeita replay do code exatamente como a Meta
 *      rejeitaria.
 *
 * Mais os cenários da rodada anterior, mantidos e reconfirmados:
 * autorização, expiração, replay de attemptId, concorrência no mesmo
 * attemptId, falha parcial por fase, concorrência otimista básica
 * (stale_base_version), caminho feliz completo.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppEmbeddedSignupExchange.mjs
 */
import { spawn } from "child_process";
import crypto from "crypto";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

const PROJECT_ID = "elisa-494703";
const BASE_URL = "http://127.0.0.1:3000";
const CLINIC = "wh-test-clinic-embsignup";
const OTHER_CLINIC = "wh-test-clinic-embsignup-b";
const THIRD_CLINIC = "wh-test-clinic-embsignup-c"; // deliberately never provisioned until scenario 8

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = admin.firestore();

const apps = [];
async function clientAs(email) {
  const app = initializeApp(firebaseConfig, `WAES_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  let user;
  try {
    user = (await createUserWithEmailAndPassword(auth, email, "TestPass123!")).user;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") user = (await signInWithEmailAndPassword(auth, email, "TestPass123!")).user;
    else throw err;
  }
  const idToken = await user.getIdToken();
  return { uid: user.uid, idToken };
}

async function startAttempt(idToken, clinicId) {
  return fetch(`${BASE_URL}/api/whatsapp/embedded-signup/start-attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ clinicId }),
  });
}
async function exchange(idToken, clinicId, attemptId, code) {
  return fetch(`${BASE_URL}/api/whatsapp/embedded-signup/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ clinicId, attemptId, code }),
  });
}
async function provisionSecret(clinicId) {
  const res = await fetch(`${BASE_URL}/api/whatsapp/embedded-signup/_test-only/provision-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinicId }),
  });
  if (res.status !== 200) throw new Error(`provisionSecret(${clinicId}) failed: ${res.status}`);
  return res.json();
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log("=== Seeding clinics/members fixtures ===");
  const owner = await clientAs("waes.owner@verify.local");
  const member = await clientAs("waes.member@verify.local");
  const otherOwner = await clientAs("waes.otherowner@verify.local");
  const thirdOwner = await clientAs("waes.thirdowner@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Teste Embedded Signup", ownerId: owner.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${owner.uid}`).set({ role: "owner", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/members/${member.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${OTHER_CLINIC}`).set({ name: "Outra Clínica", ownerId: otherOwner.uid });
  await adminDb.doc(`clinics/${OTHER_CLINIC}/members/${otherOwner.uid}`).set({ role: "owner", status: "active", active: true });
  await adminDb.doc(`clinics/${THIRD_CLINIC}`).set({ name: "Clínica Sem Secret", ownerId: thirdOwner.uid });
  await adminDb.doc(`clinics/${THIRD_CLINIC}/members/${thirdOwner.uid}`).set({ role: "owner", status: "active", active: true });
  // THIRD_CLINIC usa um id fixo (não sufixado por `run`) pra ficar legível
  // no cenário 8 — reruns deste script no mesmo emulador podem deixar uma
  // integração residual de uma execução anterior bem-sucedida; limpa
  // antes de começar pra garantir a asserção "nenhuma integração criada".
  await adminDb.doc(`clinics/${THIRD_CLINIC}/integrations/whatsapp`).delete().catch(() => {});
  console.log("=== Fixtures ready ===\n");

  console.log("=== Booting real server.ts against the emulator (mock Secret Manager + Graph API clients) ===");
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS: "1",
    },
  });
  let serverOutput = "";
  child.stdout.on("data", (d) => { serverOutput += d.toString(); });
  child.stderr.on("data", (d) => { serverOutput += d.toString(); });

  const up = await waitForServer(45000);
  if (!up) {
    console.error("Server never came up. Last output:\n", serverOutput.slice(-4000));
    child.kill();
    process.exit(1);
  }
  console.log("=== Server up ===\n");

  try {
    const run = Date.now();

    // Provisionamento administrativo (identidade separada, simulado pelo
    // endpoint só-teste) — ANTES de qualquer exchange, exatamente como no
    // mundo real. THIRD_CLINIC fica deliberadamente SEM provisionar até o
    // cenário 8.
    await provisionSecret(CLINIC);
    await provisionSecret(OTHER_CLINIC);

    // ---- 1. Autorização ----
    console.log("--- 1. Autorização ---");
    {
      const res = await startAttempt(null, CLINIC);
      check("Sem token: 401", res.status === 401, `status=${res.status}`);
    }
    {
      const res = await startAttempt(member.idToken, CLINIC);
      check("Membro comum (não-admin): 403", res.status === 403, `status=${res.status}`);
    }
    let ownerAttemptId;
    {
      const res = await startAttempt(owner.idToken, CLINIC);
      check("Owner real: 200", res.status === 200, `status=${res.status}`);
      const data = await res.json();
      ownerAttemptId = data.attemptId;
      check("attemptId retornado", typeof ownerAttemptId === "string" && ownerAttemptId.length > 0);
    }
    {
      const res = await exchange(otherOwner.idToken, OTHER_CLINIC, ownerAttemptId, "TEST_CODE_SHOULD_NOT_RUN_" + run);
      check("Attempt de outra clínica: 404 (isolamento multi-clínica)", res.status === 404, `status=${res.status}`);
    }

    // ---- 2. Expiração ----
    console.log("\n--- 2. Expiração ---");
    {
      const resStart = await startAttempt(owner.idToken, CLINIC);
      const { attemptId } = await resStart.json();
      await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).update({
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 1000),
      });
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_EXPIRED_" + run);
      check("Attempt expirado: 410", res.status === 410, `status=${res.status}`);
      const attemptSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get();
      check("status vira 'expired'", attemptSnap.data()?.status === "expired", `status=${attemptSnap.data()?.status}`);
    }

    async function freshAttempt(clinicId, idToken) {
      const res = await startAttempt(idToken, clinicId);
      return (await res.json()).attemptId;
    }

    // ---- 3. Replay do attemptId ----
    console.log("\n--- 3. Replay do attemptId ---");
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const code = "TEST_CODE_REPLAY_VALID_" + run;
      const res1 = await exchange(owner.idToken, CLINIC, attemptId, code);
      check("1ª troca: 200 (sucesso)", res1.status === 200, `status=${res1.status}`);
      const res2 = await exchange(owner.idToken, CLINIC, attemptId, code);
      check("2ª troca (replay do attemptId): 409", res2.status === 409, `status=${res2.status}`);
      const body2 = await res2.json();
      check("erro é attempt_already_used", body2.error === "attempt_already_used", `error=${body2.error}`);
    }

    // ---- 4. Concorrência (duas trocas simultâneas do mesmo attempt) ----
    console.log("\n--- 4. Concorrência (mesmo attemptId, duas exchanges em paralelo) ---");
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const code = "TEST_CODE_CONCURRENT_" + run;
      const [resA, resB] = await Promise.all([
        exchange(owner.idToken, CLINIC, attemptId, code),
        exchange(owner.idToken, CLINIC, attemptId, code),
      ]);
      const statuses = [resA.status, resB.status].sort();
      check("Uma 200 e uma 409 (só uma reclama o claim)", statuses[0] === 200 && statuses[1] === 409, `statuses=${statuses}`);
    }

    // ---- 5. Falha parcial por fase ----
    console.log("\n--- 5. Falha parcial por fase ---");
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_FAIL_EXCHANGE_" + run);
      check("Falha na troca do code: 500", res.status === 500, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("status 'failed', candidateConfig continua null", ev?.status === "failed" && ev?.candidateConfig === null, `status=${ev?.status} candidateConfig=${JSON.stringify(ev?.candidateConfig)}`);
    }
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_FAIL_DISCOVERY_" + run);
      check("Falha no discovery: 500", res.status === 500, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("status 'failed', candidateConfig continua null (nunca chegou lá)", ev?.status === "failed" && ev?.candidateConfig === null);
    }
    {
      const beforeSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      const beforeUpdateTime = beforeSnap.updateTime?.toMillis() ?? null;
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_INCONCLUSIVE_COEXISTENCE_" + run);
      check("Coexistence inconclusive: 422", res.status === 422, `status=${res.status}`);
      const body = await res.json();
      check("verification=inconclusive no corpo", body.verification === "inconclusive", `verification=${body.verification}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("attempt 'failed', errorCode reflete coexistence", ev?.status === "failed" && ev?.errorCode === "WA_COEXISTENCE_INCONCLUSIVE", `status=${ev?.status} errorCode=${ev?.errorCode}`);
      const afterSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Integração ativa NÃO foi tocada (updateTime inalterado)", (afterSnap.updateTime?.toMillis() ?? null) === beforeUpdateTime);
    }
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_REJECTED_" + run);
      check("Coexistence rejected: 422", res.status === 422, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("errorCode reflete rejected", ev?.errorCode === "WA_COEXISTENCE_REJECTED", `errorCode=${ev?.errorCode}`);
    }
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const code = "TEST_CODE_FAIL_SUBSCRIBE_" + run;
      const phoneNumberId = "mock-phone-" + code;
      const res = await exchange(owner.idToken, CLINIC, attemptId, code);
      check("Falha ao assinar WABA: 500", res.status === 500, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("candidateConfig tem secret version mas subscription nunca confirmada", ev?.candidateConfig?.accessTokenSecretVersionCandidate && !ev?.candidateConfig?.wabaSubscriptionConfirmedAt, `candidateConfig=${JSON.stringify(ev?.candidateConfig)}`);
      const phoneIndexSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
      check("Reserva do telefone foi liberada no rollback (item 3)", !phoneIndexSnap.exists, `exists=${phoneIndexSnap.exists}`);
    }
    {
      // NOVO (item 5): POST de assinatura funciona, mas a CONFIRMAÇÃO (GET
      // separado) falha — deve bloquear a promoção do mesmo jeito que
      // Coexistence não-confirmada bloqueia.
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_FAIL_SUBSCRIBE_CONFIRM_" + run);
      check("Falha na confirmação da assinatura: 500", res.status === 500, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("errorPhase reflete a etapa de confirmação", ev?.errorPhase === "WABA_SUBSCRIPTION_CONFIRM", `errorPhase=${ev?.errorPhase}`);
    }
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, "TEST_CODE_INCONCLUSIVE_SUBSCRIBE_CONFIRM_" + run);
      check("Confirmação inconclusiva da assinatura: 422", res.status === 422, `status=${res.status}`);
      const body = await res.json();
      check("erro é waba_subscription_not_confirmed", body.error === "waba_subscription_not_confirmed", `error=${body.error}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("attempt 'failed', nunca promovido", ev?.status === "failed", `status=${ev?.status}`);
    }

    // ---- 6. Concorrência otimista básica (stale_base_version) ----
    console.log("\n--- 6. Concorrência otimista básica ---");
    const rollbackCode = "TEST_CODE_ROLLBACK_" + run + "_TEST_SLOW_BEFORE_TERMINAL";
    const rollbackWabaId = "mock-waba-" + rollbackCode;
    let rollbackAttemptIdA;
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      rollbackAttemptIdA = attemptId;
      const exchangePromise = exchange(owner.idToken, CLINIC, attemptId, rollbackCode);
      await sleep(500);
      await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).set({ status: "conectado", provider: "meta", wabaId: "waba-de-outra-conexao-concorrente" }, { merge: true });

      const res = await exchangePromise;
      check("Attempt A (superado): 409", res.status === 409, `status=${res.status}`);
      const body = await res.json();
      check("motivo é stale_base_version", body.error === "stale_base_version", `error=${body.error}`);

      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("attempt A 'failed'", ev?.status === "failed", `status=${ev?.status}`);
      check("candidateConfig do attempt A registra que ELE criou a assinatura (pré-condição do rollback)", ev?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === true, `createdByThisAttempt=${ev?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);

      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Integração ativa reflete a conexão concorrente, não o attempt A", integrationSnap.data()?.wabaId !== rollbackWabaId, `wabaId=${integrationSnap.data()?.wabaId}`);

      const phoneNumberId = "mock-phone-" + rollbackCode.replace(/__U\d+$/, "");
      const phoneIndexSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
      check("Reserva do telefone do attempt A também foi liberada", !phoneIndexSnap.exists, `exists=${phoneIndexSnap.exists}`);

      // Rodada final, item 2 — ninguém mais depende de rollbackWabaId neste
      // ponto, então isWabaSubscriptionStillNeeded=false e o rollback
      // segue pro flag administrativo (nunca um DELETE de verdade).
      await sleep(200);
      const cleanupSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_pending_waba_cleanup/${rollbackAttemptIdA}`).get();
      check("WABA solitária do attempt A flagada pra limpeza administrativa", cleanupSnap.exists && cleanupSnap.data()?.wabaId === rollbackWabaId, `data=${JSON.stringify(cleanupSnap.data())}`);
    }
    {
      // Mesmo GRUPO (mesma wabaId/phoneNumberId derivada), mas code
      // INTEIRO diferente (__U2) — o code em si é de uso único (item 6);
      // reusar o code EXATO da 6a de novo seria replay de verdade, não é
      // isso que este passo quer provar.
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, rollbackCode + "__U2");
      check("Nova tentativa, mesmo grupo, code novo: 200 (não é replay, attemptId E code são novos)", res.status === 200, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      // Atualizado (rodada final, item 2): rollback nunca mais desassina de
      // verdade — só flag pra limpeza administrativa. Então a wabaId
      // CONTINUA assinada do lado do mock, e esta tentativa nova não
      // precisa recriar.
      check("Rollback NUNCA desassinou de verdade (nova tentativa não precisou recriar)", ev?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === false, `createdByThisAttempt=${ev?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);
    }
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const res = await exchange(owner.idToken, CLINIC, attemptId, rollbackCode + "__U3");
      check("Terceira tentativa, mesma wabaId/phoneNumberId já ativos NESTA clínica: 200 (reconexão permitida)", res.status === 200, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("createdByThisAttempt=false (detectou que já estava assinada, não recriou)", ev?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === false, `createdByThisAttempt=${ev?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);
    }

    // ---- 7. Caminho feliz completo ----
    console.log("\n--- 7. Caminho feliz completo ---");
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const code = "TEST_CODE_HAPPY_" + run;
      const res = await exchange(owner.idToken, CLINIC, attemptId, code);
      check("Resposta 200", res.status === 200, `status=${res.status}`);
      const body = await res.json();
      check("status=connected no corpo", body.status === "connected");

      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      const integration = integrationSnap.data();
      check("Integração ativa status='conectado'", integration?.status === "conectado", `status=${integration?.status}`);
      check("accessTokenSecretVersion é um número de versão, não 'latest'", integration?.accessTokenSecretVersion && integration.accessTokenSecretVersion !== "latest", `version=${integration?.accessTokenSecretVersion}`);
      const wholeDocStr = JSON.stringify(integration);
      check("Token cru NUNCA aparece em nenhum campo da integração", !wholeDocStr.includes("mock-token-for"), `procurando 'mock-token-for' em: ${wholeDocStr.slice(0, 200)}...`);

      const statusSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).get();
      check("whatsapp_status sanitizado escrito", statusSnap.data()?.status === "conectado");
      check("whatsapp_status não tem accessTokenSecretName/Version", statusSnap.data()?.accessTokenSecretName === undefined && statusSnap.data()?.accessTokenSecretVersion === undefined);

      const attemptSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get();
      check("attempt 'completed'", attemptSnap.data()?.status === "completed", `status=${attemptSnap.data()?.status}`);

      const phoneNumberId = "mock-phone-" + code;
      const phoneIndexSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
      check("whatsapp_phone_index promovido a 'active'", phoneIndexSnap.data()?.status === "active", `status=${phoneIndexSnap.data()?.status}`);
      check("whatsapp_phone_index aponta pra clínica certa", phoneIndexSnap.data()?.clinicId === CLINIC, `clinicId=${phoneIndexSnap.data()?.clinicId}`);
      // Item 5 (rodada final) — confirma que a reserva e a integração final
      // sempre concordam sobre wabaId (mesmo valor, nunca reconciliado a
      // posteriori) — é essa igualdade que garante que
      // isWabaSubscriptionStillNeeded(wabaId) encontra esta reserva.
      check("whatsapp_phone_index.wabaId === integration.wabaId (mesma wabaId, nunca diverge)", phoneIndexSnap.data()?.wabaId === integration?.wabaId && !!integration?.wabaId, `index.wabaId=${phoneIndexSnap.data()?.wabaId} integration.wabaId=${integration?.wabaId}`);
    }

    // ============================================================
    // Cenários NOVOS desta rodada
    // ============================================================

    // ---- 8. Item 1 — Paridade do Secret Manager (secret inexistente) ----
    console.log("\n--- 8. Paridade do Secret Manager (secret inexistente) ---");
    {
      // THIRD_CLINIC nunca foi provisionada.
      const attemptId = await freshAttempt(THIRD_CLINIC, thirdOwner.idToken);
      const code = "TEST_CODE_NOPROV_" + run;
      const phoneNumberId = "mock-phone-" + code;
      const res = await exchange(thirdOwner.idToken, THIRD_CLINIC, attemptId, code);
      check("Exchange sem secret provisionado: 500 (igual ao cliente real, nunca auto-cria)", res.status === 500, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${THIRD_CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      check("errorCode reflete falha de secret", ev?.errorCode === "WA_SECRET_VERSION_FAILED", `errorCode=${ev?.errorCode}`);
      const integrationSnap = await adminDb.doc(`clinics/${THIRD_CLINIC}/integrations/whatsapp`).get();
      check("Nenhuma integração foi criada", !integrationSnap.exists);
      const phoneIndexSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
      check("Nenhum índice de telefone ficou promovido/pendurado (reserva liberada)", !phoneIndexSnap.exists, `exists=${phoneIndexSnap.exists}`);

      // Provisiona (simulando o provisionador administrativo separado
      // agindo depois) e confirma que passa a funcionar — precisa de um
      // CODE NOVO (item 6: o code anterior já foi consumido com sucesso
      // na troca por token, mesmo a etapa de secret tendo falhado depois).
      await provisionSecret(THIRD_CLINIC);
      const attemptId2 = await freshAttempt(THIRD_CLINIC, thirdOwner.idToken);
      const res2 = await exchange(thirdOwner.idToken, THIRD_CLINIC, attemptId2, "TEST_CODE_NOPROV_RETRY_" + run);
      check("Depois de provisionar (código novo): 200", res2.status === 200, `status=${res2.status}`);
    }

    // ---- 9. Item 2 — Versões órfãs ----
    console.log("\n--- 9. Versões órfãs de secret ---");
    {
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const code = "TEST_CODE_ORPHAN_" + run + "_FAIL_SUBSCRIBE";
      const res = await exchange(owner.idToken, CLINIC, attemptId, code);
      check("Falha depois da versão do secret já criada: 500", res.status === 500, `status=${res.status}`);
      const ev = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId}`).get()).data();
      const orphanVersionId = ev?.candidateConfig?.accessTokenSecretVersionCandidate;
      check("candidateConfig registrou a versão antes de falhar", !!orphanVersionId, `versionId=${orphanVersionId}`);

      const secretName = `eliza-wa-token-${CLINIC}`;
      // Mesmo hash determinístico usado em server.ts (orphanedVersionRefFor)
      // — SHA-256 de `secretName:versionId`, hex, 32 chars.
      const orphanDocId = crypto.createHash("sha256").update(`${secretName}:${orphanVersionId}`).digest("hex").slice(0, 32);
      const orphanSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_orphaned_secret_versions/${orphanDocId}`).get();
      check("Registro de versão órfã existe", orphanSnap.exists);
      check("Registro aponta pro attempt certo", orphanSnap.data()?.attemptId === attemptId, `attemptId=${orphanSnap.data()?.attemptId}`);
      check("disabledAt começa null (revogação é ação administrativa separada, não deste runtime)", orphanSnap.data()?.disabledAt === null);

      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("A versão órfã NUNCA virou a versão ativa", integrationSnap.data()?.accessTokenSecretVersion !== orphanVersionId, `active=${integrationSnap.data()?.accessTokenSecretVersion} orphan=${orphanVersionId}`);

      // Uma tentativa seguinte, bem-sucedida, pega uma versão DIFERENTE —
      // a órfã nunca é reaproveitada por acidente.
      const attemptId2 = await freshAttempt(CLINIC, owner.idToken);
      const code2 = "TEST_CODE_ORPHAN_FOLLOWUP_" + run;
      const res2 = await exchange(owner.idToken, CLINIC, attemptId2, code2);
      check("Tentativa seguinte bem-sucedida: 200", res2.status === 200, `status=${res2.status}`);
      const ev2 = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId2}`).get()).data();
      check("Versão nova é DIFERENTE da órfã", ev2?.candidateConfig?.accessTokenSecretVersionCandidate !== orphanVersionId, `new=${ev2?.candidateConfig?.accessTokenSecretVersionCandidate} orphan=${orphanVersionId}`);
    }

    // ---- 10. Item 3 — Reserva global do telefone ----
    console.log("\n--- 10. Reserva global do telefone ---");
    {
      // 10a: duas clínicas DIFERENTES disputando o MESMO phoneNumberId de
      // verdade, em paralelo.
      const sharedCode = "TEST_CODE_PHONECONTEST_" + run; // mesmo code group para as duas — deriva o MESMO phoneNumberId
      const phoneNumberId = "mock-phone-" + sharedCode;
      const attemptClinic = await freshAttempt(CLINIC, owner.idToken);
      const attemptOther = await freshAttempt(OTHER_CLINIC, otherOwner.idToken);

      const [resClinic, resOther] = await Promise.all([
        exchange(owner.idToken, CLINIC, attemptClinic, sharedCode),
        exchange(otherOwner.idToken, OTHER_CLINIC, attemptOther, sharedCode),
      ]);
      // Um dos dois deve ganhar a troca do CODE em si (só um pode, code é
      // de uso único) — então só um chega a tentar reservar o telefone de
      // verdade; o outro falha antes, na troca do code. De qualquer forma,
      // o resultado observável exigido é: no máximo uma clínica conectada
      // a esse número.
      const statuses = [resClinic.status, resOther.status].sort();
      check("Uma das duas recebe sucesso (200) ou ambas falham de forma limpa (nunca as duas 200)", !(resClinic.status === 200 && resOther.status === 200), `statuses=${statuses}`);

      const phoneIndexSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
      if (phoneIndexSnap.exists && phoneIndexSnap.data()?.status === "active") {
        check("Roteamento inequívoco: exatamente 1 clínica dona do número (não ambas)", [CLINIC, OTHER_CLINIC].includes(phoneIndexSnap.data()?.clinicId), `clinicId=${phoneIndexSnap.data()?.clinicId}`);
        const winner = phoneIndexSnap.data()?.clinicId;
        const loserClinic = winner === CLINIC ? OTHER_CLINIC : CLINIC;
        const loserIntegration = await adminDb.doc(`clinics/${loserClinic}/integrations/whatsapp`).get();
        check("A clínica perdedora NÃO tem essa integração ativa", loserIntegration.data()?.phoneNumberId !== phoneNumberId, `phoneNumberId=${loserIntegration.data()?.phoneNumberId}`);
      }

      // 10b: a MESMA clínica reconectando seu PRÓPRIO número já ativo —
      // deve ser permitido (não é o caso que o item 3 pede pra bloquear).
      const winnerSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
      const winnerClinicId = winnerSnap.data()?.clinicId;
      const winnerOwner = winnerClinicId === CLINIC ? owner : otherOwner;
      const reconnectAttempt = await freshAttempt(winnerClinicId, winnerOwner.idToken);
      const reconnectRes = await exchange(winnerOwner.idToken, winnerClinicId, reconnectAttempt, sharedCode + "__U2");
      check("Reconexão pela MESMA clínica dona do número: 200 (permitido)", reconnectRes.status === 200, `status=${reconnectRes.status}`);
    }
    {
      // 10c (item 3) — lease expirada: A reserva um número, entra na pausa
      // de teste; ENQUANTO A dorme, a lease dela é forçada a expirar e
      // OUTRA clínica (B) reclama e CONCLUI de verdade sobre o mesmo
      // número. Quando A acorda e tenta renovar/promover, tem que falhar
      // — nunca pode promover, remover ou sobrescrever a reserva que
      // agora pertence a B.
      const leaseGroup = "LEASETEST" + run;
      const codeA = `TEST_CODE_LEASE_A_${run}__PHONE_${leaseGroup}__TEST_SLOW_BEFORE_TERMINAL`;
      const codeB = `TEST_CODE_LEASE_B_${run}__PHONE_${leaseGroup}__`;
      const phoneNumberIdLease = `mock-phone-${leaseGroup}`;

      const attemptA = await freshAttempt(CLINIC, owner.idToken);
      const exchangeAPromise = exchange(owner.idToken, CLINIC, attemptA, codeA);
      await sleep(500); // A já reservou o número e entrou na pausa de teste

      const preSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberIdLease}`).get();
      check("Setup: reserva de A existe, 'pending'", preSnap.exists && preSnap.data()?.status === "pending", `data=${JSON.stringify(preSnap.data())}`);
      const aClaimId = preSnap.data()?.reservationClaimId;
      check("Setup: reservationClaimId de A presente", typeof aClaimId === "string" && aClaimId.length > 0);

      // Força a lease de A a já ter expirado, SEM tocar o reservationClaimId.
      await adminDb.doc(`whatsapp_phone_index/${phoneNumberIdLease}`).update({
        leaseExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 1000),
      });

      // B (outra clínica) reclama a reserva expirada e CONCLUI de verdade.
      const attemptB = await freshAttempt(OTHER_CLINIC, otherOwner.idToken);
      const resB = await exchange(otherOwner.idToken, OTHER_CLINIC, attemptB, codeB);
      check("B reclama a reserva expirada e conclui: 200", resB.status === 200, `status=${resB.status}`);
      const postBSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberIdLease}`).get();
      check("Índice agora 'active', dono é B (outra clínica)", postBSnap.data()?.status === "active" && postBSnap.data()?.clinicId === OTHER_CLINIC, `data=${JSON.stringify(postBSnap.data())}`);
      const bClaimId = postBSnap.data()?.reservationClaimId;
      check("reservationClaimId mudou pra um novo valor (não é mais o de A)", bClaimId && bClaimId !== aClaimId, `aClaimId=${aClaimId} bClaimId=${bClaimId}`);

      // A acorda: tenta renovar a lease com o claimId ANTIGO -> tem que
      // falhar, sem tocar em NADA do que já pertence a B.
      const resA = await exchangeAPromise;
      check("A (lease expirada, superado por B): resposta não-2xx", resA.status >= 400, `status=${resA.status}`);
      const evA = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptA}`).get()).data();
      check("A terminou 'failed'", evA?.status === "failed", `status=${evA?.status}`);

      const finalSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberIdLease}`).get();
      check("Índice CONTINUA pertencendo a B — A não promoveu/removeu/sobrescreveu", finalSnap.data()?.status === "active" && finalSnap.data()?.clinicId === OTHER_CLINIC && finalSnap.data()?.reservationClaimId === bClaimId, `data=${JSON.stringify(finalSnap.data())}`);

      const integrationA = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Integração de A (CLINIC) NÃO foi criada/tocada por essa tentativa perdida", integrationA.data()?.phoneNumberId !== phoneNumberIdLease, `phoneNumberId=${integrationA.data()?.phoneNumberId}`);
    }

    // ---- 11. Item 1 — Rollback GLOBAL seguro da assinatura da WABA ----
    console.log("\n--- 11. Rollback GLOBAL seguro da WABA ---");
    {
      // 11a: A (CLINIC) cria a assinatura; B — CLÍNICA DIFERENTE
      // (OTHER_CLINIC) — reusa a mesma wabaId e conclui primeiro; A falha
      // depois. Clínicas DIFERENTES de propósito — é exatamente o que a
      // checagem antiga (escopada só na clínica da tentativa) não
      // conseguia enxergar; a nova precisa ser GLOBAL pra pegar isto.
      const sharedWaba = "SHAREDWABA" + run;
      const codeA = `TEST_CODE_WABAROLL_A_${run}__WABA_${sharedWaba}__TEST_SLOW_BEFORE_TERMINAL`;
      const codeB = `TEST_CODE_WABAROLL_B_${run}__WABA_${sharedWaba}__`;
      const wabaId = `mock-waba-${sharedWaba}`;
      const phoneNumberIdA = `mock-phone-${codeA}`; // A e B usam phoneNumberIds diferentes (só a wabaId é forçada igual)

      const attemptA = await freshAttempt(CLINIC, owner.idToken);
      const exchangeAPromise = exchange(owner.idToken, CLINIC, attemptA, codeA);
      await sleep(500); // A já reservou seu telefone, assinou a WABA e entrou na pausa de teste

      // Como A e B usam phoneNumberIds diferentes (só a wabaId é
      // compartilhada), B concluir NÃO deixa a base_version de A velha —
      // isso por si só não faria A falhar. Pra forçar a falha de A (e daí
      // sim exercitar o rollback), corrompe a PRÓPRIA reserva de telefone
      // de A enquanto ela dorme — simula "essa reserva específica foi
      // perdida por algum motivo", que é uma causa de falha real e
      // independente da concorrência otimista da integração.
      await adminDb.doc(`whatsapp_phone_index/${phoneNumberIdA}`).update({ reservationClaimId: "corrupted-by-test" });

      const attemptB = await freshAttempt(OTHER_CLINIC, otherOwner.idToken);
      const resB = await exchange(otherOwner.idToken, OTHER_CLINIC, attemptB, codeB);
      check("B (OUTRA clínica, reusa a assinatura de A): 200", resB.status === 200, `status=${resB.status}`);
      const evB = (await adminDb.doc(`clinics/${OTHER_CLINIC}/whatsapp_connection_attempts/${attemptB}`).get()).data();
      check("B NÃO criou a assinatura (já existia, criada por A)", evB?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === false, `createdByThisAttempt=${evB?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);
      const integrationAfterB = await adminDb.doc(`clinics/${OTHER_CLINIC}/integrations/whatsapp`).get();
      check("Integração ativa de OUTRA clínica agora usa a wabaId compartilhada (via B)", integrationAfterB.data()?.wabaId === wabaId, `wabaId=${integrationAfterB.data()?.wabaId}`);

      // A acorda: sua base_version está velha -> stale_base_version ->
      // tenta rollback -> DEVE achar (globalmente, fora da própria
      // clínica) que B (outra clínica) ainda depende da wabaId e NÃO
      // desassinar.
      const resA = await exchangeAPromise;
      check("A (atrasado, superado por B de outra clínica): resposta não-2xx", resA.status >= 400, `status=${resA.status}`);
      await sleep(300);

      const evA = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptA}`).get()).data();
      check("A terminou 'failed'", evA?.status === "failed", `status=${evA?.status}`);

      // Prova real de que a WABA NÃO foi desassinada: uma tentativa nova
      // (pode ser de QUALQUER clínica — usa CLINIC de novo), MESMA wabaId,
      // vê getWabaSubscriptionStatus ainda TRUE (createdByThisAttempt=false)
      // — se A tivesse desassinado por engano (e quebrado a conexão ativa
      // de B em OTHER_CLINIC), esta tentativa precisaria recriar.
      const codeC = `TEST_CODE_WABAROLL_C_${run}__WABA_${sharedWaba}__`;
      const attemptC = await freshAttempt(CLINIC, owner.idToken);
      const resC = await exchange(owner.idToken, CLINIC, attemptC, codeC);
      check("C (prova, clínica ainda diferente): 200", resC.status === 200, `status=${resC.status}`);
      const evC = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptC}`).get()).data();
      check("ROLLBACK CORRETAMENTE EVITADO GLOBALMENTE: WABA continua assinada (C não precisou recriar)", evC?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === false, `createdByThisAttempt=${evC?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);

      // Ainda a integração de B (OTHER_CLINIC) continua intacta — prova
      // final de que nada foi quebrado por baixo dela.
      const integrationBFinal = await adminDb.doc(`clinics/${OTHER_CLINIC}/integrations/whatsapp`).get();
      check("Integração de B (outra clínica) continua 'conectado' com a mesma wabaId", integrationBFinal.data()?.status === "conectado" && integrationBFinal.data()?.wabaId === wabaId);
    }
    {
      // 11b: tentativa nova ainda em PROCESSING, SEM nenhuma integração
      // ativa em lugar nenhum — a checagem global também precisa
      // considerar isto, não só integrações já promovidas. Semeia
      // diretamente um connectionAttempt "fake" em status processing
      // referenciando a wabaId, depois roda uma tentativa real que cria a
      // assinatura e falha na CONFIRMAÇÃO (que já marca
      // wabaSubscriptionCreatedByThisAttempt=true em memória antes de
      // falhar — ver server.ts) — o rollback dela precisa ver o attempt
      // fake "processing" e recusar desassinar, mesmo sem integração
      // ativa nenhuma.
      const sharedWaba2 = "SHAREDWABA2" + run;
      const wabaId2 = `mock-waba-${sharedWaba2}`;
      const fakeProcessingRef = adminDb.doc(`clinics/${OTHER_CLINIC}/whatsapp_connection_attempts/fake-processing-${run}`);
      await fakeProcessingRef.set({
        attemptId: `fake-processing-${run}`, clinicId: OTHER_CLINIC, userId: otherOwner.uid,
        status: "processing", createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000), usedAt: admin.firestore.FieldValue.serverTimestamp(),
        candidateConfig: { wabaId: wabaId2 },
      });

      const codeE = `TEST_CODE_WABAROLL_E_${run}__WABA_${sharedWaba2}__FAIL_SUBSCRIBE_CONFIRM`;
      const attemptE = await freshAttempt(CLINIC, owner.idToken);
      const resE = await exchange(owner.idToken, CLINIC, attemptE, codeE);
      check("E (cria a assinatura, falha na confirmação): 500", resE.status === 500, `status=${resE.status}`);
      // Nota: candidateConfig.wabaSubscriptionCreatedByThisAttempt no
      // Firestore fica null aqui de propósito — a falha na CONFIRMAÇÃO
      // acontece antes do attemptRef.update() que persistiria esse campo
      // (só roda depois da confirmação ter sucesso). O rollback em si lê
      // o valor em MEMÓRIA (já true nesse ponto), não o do Firestore — a
      // prova real de que ele funcionou é o comportamento de F abaixo.

      // Nenhuma integração ativa em lugar nenhum usa wabaId2 — a ÚNICA
      // razão pra não desassinar é o attempt fake "processing".
      const codeF = `TEST_CODE_WABAROLL_F_${run}__WABA_${sharedWaba2}__`;
      const attemptF = await freshAttempt(CLINIC, owner.idToken);
      const resF = await exchange(owner.idToken, CLINIC, attemptF, codeF);
      check("F (prova): 200", resF.status === 200, `status=${resF.status}`);
      const evF = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptF}`).get()).data();
      check("ROLLBACK EVITADO por causa do attempt 'processing' (sem integração ativa nenhuma): F não precisou recriar", evF?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === false, `createdByThisAttempt=${evF?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);

      await fakeProcessingRef.delete().catch(() => {});
    }
    {
      // 11c (rodada final, item 2 — "nenhum rollback automático chama
      // DELETE") — o único cenário, entre 11a/11b, onde
      // isWabaSubscriptionStillNeeded de fato retorna FALSE (ninguém mais
      // depende da wabaId). Antes desta rodada, isto disparava um DELETE
      // real via graphClient.unsubscribeWaba; agora só registra em
      // whatsapp_pending_waba_cleanup — NUNCA desassina sozinho.
      const soloWaba = "SOLOWABA" + run;
      const wabaIdSolo = `mock-waba-${soloWaba}`;
      const codeG = `TEST_CODE_WABAROLL_G_${run}__WABA_${soloWaba}__FAIL_SUBSCRIBE_CONFIRM`;
      const attemptG = await freshAttempt(CLINIC, owner.idToken);
      const resG = await exchange(owner.idToken, CLINIC, attemptG, codeG);
      check("G (cria assinatura solo, falha na confirmação): 500", resG.status === 500, `status=${resG.status}`);
      await sleep(200);

      const cleanupSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_pending_waba_cleanup/${attemptG}`).get();
      check("WABA flagada pra limpeza administrativa (rollback aplicável, ninguém mais depende)", cleanupSnap.exists && cleanupSnap.data()?.wabaId === wabaIdSolo, `data=${JSON.stringify(cleanupSnap.data())}`);
      check("Registro de limpeza sanitizado (sem token/segredo)", !JSON.stringify(cleanupSnap.data() || {}).toLowerCase().includes("token"));

      // PROVA de que NENHUM DELETE real aconteceu: uma tentativa nova na
      // MESMA wabaId ainda vê a assinatura como presente — se tivesse
      // desassinado automaticamente, precisaria recriar.
      const codeH = `TEST_CODE_WABAROLL_H_${run}__WABA_${soloWaba}__`;
      const attemptH = await freshAttempt(CLINIC, owner.idToken);
      const resH = await exchange(owner.idToken, CLINIC, attemptH, codeH);
      check("H (prova): 200", resH.status === 200, `status=${resH.status}`);
      const evH = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptH}`).get()).data();
      check("NUNCA houve DELETE automático: H não precisou recriar a assinatura", evH?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt === false, `createdByThisAttempt=${evH?.candidateConfig?.wabaSubscriptionCreatedByThisAttempt}`);
    }

    // ---- 12. Item 6 — Code OAuth consumido, nunca reusado ----
    console.log("\n--- 12. Code OAuth consumido, nunca reusado ---");
    {
      // Code que troca com sucesso, mas falha numa etapa posterior
      // (assinatura da WABA) — o code JÁ foi trocado por token com
      // sucesso nesse ponto.
      const attemptId = await freshAttempt(CLINIC, owner.idToken);
      const code = "TEST_CODE_CONSUMED_" + run + "_FAIL_SUBSCRIBE";
      const res1 = await exchange(owner.idToken, CLINIC, attemptId, code);
      check("Falha depois do code já trocado por token: 500", res1.status === 500, `status=${res1.status}`);

      // Uma tentativa NOVA tentando reusar CEGAMENTE o MESMO code —
      // precisa falhar (nunca reaproveita), simulando a Meta rejeitando
      // um code repetido.
      const attemptId2 = await freshAttempt(CLINIC, owner.idToken);
      const res2 = await exchange(owner.idToken, CLINIC, attemptId2, code);
      check("Repetição do mesmo code numa tentativa nova: 500 (rejeitado, nunca reusado)", res2.status === 500, `status=${res2.status}`);
      const ev2 = (await adminDb.doc(`clinics/${CLINIC}/whatsapp_connection_attempts/${attemptId2}`).get()).data();
      check("errorPhase é TOKEN_EXCHANGE (rejeitado na troca, não avançou)", ev2?.errorPhase === "TOKEN_EXCHANGE", `errorPhase=${ev2?.errorPhase}`);
      check("candidateConfig continua null (nunca chegou a reusar nada do progresso anterior)", ev2?.candidateConfig === null);

      // O fluxo correto exige uma tentativa nova com um CODE NOVO —
      // confirma que isso ainda funciona normalmente.
      const attemptId3 = await freshAttempt(CLINIC, owner.idToken);
      const res3 = await exchange(owner.idToken, CLINIC, attemptId3, "TEST_CODE_CONSUMED_RETRY_" + run);
      check("Tentativa nova com code novo: 200", res3.status === 200, `status=${res3.status}`);
    }

    console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  } finally {
    child.kill();
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
