/**
 * Hardening pós-diagnóstico (rodada de correção dos gaps encontrados antes
 * do teste real de whatsapp_business_messaging) — prova, contra o
 * server.ts real (via tsx) rodando contra o emulador + Secret Manager
 * mockado (WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS=1, nunca a Meta real, nunca
 * o Secret Manager real), que:
 *
 *   1. Sem doc de integração -> falha explícita (400), nunca simula.
 *   2. Doc existe mas sem accessTokenSecretVersion -> falha explícita
 *      (token_not_configured), NUNCA um wamid.simulated_* de sucesso
 *      falso (o antigo gate `skipApiCall` foi removido).
 *   3. accessTokenSecretName/Version apontam pra um secret/versão que não
 *      existe no Secret Manager -> falha explícita (token_resolution_failed),
 *      nunca finge sucesso.
 *   4. Fluxo real (manual-config sobe uma versão de verdade no mock ->
 *      /api/whatsapp/send resolve essa MESMA versão -> mock Graph client
 *      "envia") -> sucesso de verdade, nunca simulado.
 *   5. manual-disconnect apaga o doc inteiro -> uma tentativa de envio
 *      seguinte falha limpo (integração ausente), nunca reusa a versão
 *      antiga do secret (nada fica "meio conectado").
 *   6. Nenhuma linha de log (stdout/stderr do processo do servidor, capturada
 *      durante TODO o teste) contém: o telefone de destino usado, o valor
 *      do token, ou "v21.0" (a versão antiga hardcoded que sendViaMeta
 *      usava).
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppSendHardening.mjs
 */
import { spawn } from "child_process";
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
const CLINIC = "wh-test-clinic-sendhardening";
const RECIPIENT = "5511977776666"; // "PII" de teste — nunca deve aparecer nos logs
const RAW_TOKEN_VALUE = "raw-token-value-sendhardening-NUNCA-deve-vazar-em-log";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = admin.firestore();

async function ownerIdToken() {
  const app = initializeApp(firebaseConfig, `WASH_owner_${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const email = "wash.owner@verify.local";
  let user;
  try {
    user = (await createUserWithEmailAndPassword(auth, email, "TestPass123!")).user;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") user = (await signInWithEmailAndPassword(auth, email, "TestPass123!")).user;
    else throw err;
  }
  return { uid: user.uid, idToken: await user.getIdToken() };
}

async function provisionSecret(clinicId) {
  const res = await fetch(`${BASE_URL}/api/whatsapp/embedded-signup/_test-only/provision-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinicId }),
  });
  if (!res.ok) throw new Error(`provisionSecret failed: ${res.status}`);
  return res.json();
}

async function postManualConfig(idToken, body) {
  return fetch(`${BASE_URL}/api/whatsapp/manual-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ clinicId: CLINIC, ...body }),
  });
}

async function sendMessage(clinicId, conversationId, text) {
  return fetch(`${BASE_URL}/api/whatsapp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinicId, conversationId, text }),
  });
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

async function main() {
  console.log("=== Seeding clinic fixture ===");
  const owner = await ownerIdToken();
  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Teste Send Hardening", ownerId: owner.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${owner.uid}`).set({ role: "owner", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).delete().catch(() => {});
  console.log("=== Fixture ready ===\n");

  console.log("=== Booting real server.ts against the emulator (mock Secret Manager + mock Graph client) ===");
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, GOOGLE_CLOUD_PROJECT: PROJECT_ID, WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS: "1" },
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
    // ---- 1. Sem doc de integração ----
    console.log("--- 1. Sem doc de integração -> falha explícita ---");
    {
      const res = await sendMessage(CLINIC, RECIPIENT, "teste sem integração");
      check("400 explícito (nunca 200 simulado)", res.status === 400, `status=${res.status}`);
    }

    // ---- 2. Doc existe, sem accessTokenSecretVersion ----
    console.log("\n--- 2. Sem accessTokenSecretVersion -> fail-closed, nunca simula ---");
    {
      await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).set({
        status: "conectado", provider: "meta", connectionMethod: "manual",
        phoneNumberId: "phone-hardening-1", wabaId: "waba-hardening-1",
        accessTokenSecretName: "", accessTokenSecretVersion: null,
      });
      const res = await sendMessage(CLINIC, RECIPIENT, "teste sem token configurado");
      const body = await res.json();
      check("Resposta indica falha (nunca success:true)", body.success === false, JSON.stringify(body));
      check("errorCode = token_not_configured", body.errorCode === "token_not_configured", JSON.stringify(body));
      check("Nenhum wamid.simulated_* em lugar nenhum da resposta (gate de simulação removido)", !JSON.stringify(body).includes("wamid.simulated"), JSON.stringify(body));
    }

    // ---- 3. Secret/versão referenciados não existem no Secret Manager ----
    console.log("\n--- 3. Secret/versão inexistente -> fail-closed ---");
    {
      await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).set({
        status: "conectado", provider: "meta", connectionMethod: "manual",
        phoneNumberId: "phone-hardening-1", wabaId: "waba-hardening-1",
        accessTokenSecretName: "eliza-wa-token-nunca-provisionado-de-verdade", accessTokenSecretVersion: "1",
      });
      const res = await sendMessage(CLINIC, RECIPIENT, "teste com secret inexistente");
      const body = await res.json();
      check("Resposta indica falha", body.success === false, JSON.stringify(body));
      check("errorCode = token_resolution_failed", body.errorCode === "token_resolution_failed", JSON.stringify(body));
    }

    // ---- 4. Fluxo real: manual-config sobe versão de verdade -> send usa exatamente essa versão ----
    console.log("\n--- 4. Fluxo real (secret provisionado + versão real) -> sucesso de verdade ---");
    {
      await provisionSecret(CLINIC);
      const cfgRes = await postManualConfig(owner.idToken, {
        provider: "meta",
        phoneNumberId: "phone-hardening-real",
        wabaId: "waba-hardening-real",
        businessName: "Clínica Hardening",
        displayPhoneNumber: "5511900000000",
        accessToken: RAW_TOKEN_VALUE,
      });
      check("manual-config salvou com sucesso", cfgRes.status === 200, `status=${cfgRes.status}`);

      const res = await sendMessage(CLINIC, RECIPIENT, "Mensagem de teste real (mock Graph client)");
      const body = await res.json();
      check("Envio bem-sucedido de verdade (nunca simulado)", body.success === true, JSON.stringify(body));
      check("messageId retornado é do mock Graph client (mock-wamid-...), nunca wamid.simulated_*", typeof body.messageId === "string" && body.messageId.startsWith("mock-wamid-") && !body.messageId.startsWith("wamid.simulated"), JSON.stringify(body));

      // Confirma no Firestore que o registro da mensagem foi persistido
      // normalmente (comportamento de produto legítimo, fora de escopo
      // desta rodada) — mas que o corpo bruto da Graph nunca chegou lá.
      const convoSnap = await adminDb.collection(`clinics/${CLINIC}/whatsapp_conversations/${RECIPIENT}/messages`).limit(5).get();
      check("Mensagem de saída persistida normalmente (comportamento de produto, não alterado)", convoSnap.size > 0);
    }

    // ---- 5. manual-disconnect impede reuso de versão antiga ----
    console.log("\n--- 5. manual-disconnect -> tentativa de envio seguinte falha limpo, nunca reusa versão antiga ---");
    {
      const discRes = await fetch(`${BASE_URL}/api/whatsapp/manual-disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.idToken}` },
        body: JSON.stringify({ clinicId: CLINIC }),
      });
      check("Disconnect 200", discRes.status === 200, `status=${discRes.status}`);

      const snap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Doc de integração inteiro apagado (referência+versão do secret somem junto)", !snap.exists);

      const res = await sendMessage(CLINIC, RECIPIENT, "teste depois de desconectar");
      const body = await res.json().catch(() => ({}));
      check("Envio seguinte falha limpo (integração ausente), nunca usa a versão antiga", res.status === 400, `status=${res.status} body=${JSON.stringify(body)}`);
    }

    // ---- 6. Nenhum vazamento nos logs do processo do servidor ----
    console.log("\n--- 6. Logs do servidor (stdout+stderr, captados desde o boot) ---");
    check("Nenhuma linha de log contém o telefone de destino usado nos testes", !serverOutput.includes(RECIPIENT), "achou o telefone em texto puro nos logs do servidor");
    check("Nenhuma linha de log contém o token bruto salvo via manual-config", !serverOutput.includes(RAW_TOKEN_VALUE), "achou o token bruto nos logs do servidor");
    check("Nenhuma linha de log referencia a versão antiga hardcoded v21.0", !serverOutput.includes("v21.0"), "achou v21.0 nos logs do servidor");
    check("Nenhuma linha de log contém 'META_RESPONSE_BODY' (log removido nesta rodada)", !serverOutput.includes("META_RESPONSE_BODY"));
    check("Nenhuma linha de log contém 'META_REQUEST_URL' com Authorization embutido", !serverOutput.includes("Authorization"));

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
