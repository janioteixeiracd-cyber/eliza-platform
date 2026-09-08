/**
 * Prova, contra o server.ts REAL rodando via tsx (não uma reimplementação),
 * capturando TODO o stdout/stderr do processo durante requisições reais de
 * webhook, que a correção desta rodada realmente tirou payload cru,
 * headers completos, assinatura e dado de contato dos logs — achado real
 * de uma verificação manual anterior (teste do painel Meta apareceu
 * inteiro em texto puro no Cloud Logging: rawBody, headers com
 * x-hub-signature-256, telefone, nome de contato, texto da mensagem).
 *
 * Cenários:
 *   1. POST Meta (assinatura válida, mensagem inbound) — telefone, texto,
 *      nome de contato, message id e a assinatura HMAC enviada NUNCA
 *      aparecem em nenhuma linha de log; os eventos estruturados
 *      esperados (post_received, body_parsed, inbound_message_matched,
 *      inbound_message_received, inbound_message_saved) aparecem.
 *   2. POST Meta (status update) — messageId/recipientId (telefone) do
 *      evento de status nunca aparecem.
 *   3. POST Twilio (mensagem inbound, assinatura válida) — telefone,
 *      texto, nome de contato e o header X-Twilio-Signature nunca
 *      aparecem; evento estruturado inbound_message_saved aparece.
 *   4. Confirmação negativa ampla: em TODO o log capturado do processo
 *      inteiro (não só das respostas dessas 3 chamadas), nenhuma das
 *      strings literais "rawBody", "WEBHOOK_RECEIVED", "headers:" (o
 *      dump antigo de headers completos) aparece nenhuma vez.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppWebhookLogSanitization.mjs
 */
import { spawn } from "child_process";
import crypto from "crypto";
import admin from "firebase-admin";
import twilioPkg from "twilio";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST not set.");
  process.exit(1);
}

const PROJECT_ID = "elisa-494703";
const BASE_URL = "http://127.0.0.1:3000";
const META_APP_SECRET = "test-meta-app-secret-logsan-999";
const TWILIO_AUTH_TOKEN = "test-twilio-auth-token-logsan-888";

const CLINIC_META = "wh-test-clinic-logsan-meta";
const CLINIC_TWILIO = "wh-test-clinic-logsan-twilio";
const META_PHONE_NUMBER_ID = "wh-test-logsan-phone-1";
const TWILIO_NUMBER = "+5511977776666";

// Marcadores DISTINTOS e improváveis de colidir com qualquer outra coisa
// no log (nome de biblioteca, timestamp, etc.) — se qualquer um destes
// aparecer no stdout/stderr capturado, é prova direta de vazamento.
const SECRET_PHONE_META = "5599981237766";
const SECRET_TEXT_META = "TEXTO_SIGILOSO_DO_PACIENTE_META_9f3a1c";
const SECRET_CONTACT_NAME = "NOME_SIGILOSO_DO_CONTATO_b71e02";
const SECRET_PHONE_TWILIO = "5599981239988";
const SECRET_TEXT_TWILIO = "TEXTO_SIGILOSO_DO_PACIENTE_TWILIO_7ce4d9";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = admin.firestore();

function metaSignature(rawBody) {
  return "sha256=" + crypto.createHmac("sha256", META_APP_SECRET).update(rawBody).digest("hex");
}

function metaMessagePayload(messageId, fromPhone, text) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-logsan-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511988880000", phone_number_id: META_PHONE_NUMBER_ID },
          contacts: [{ profile: { name: SECRET_CONTACT_NAME }, wa_id: fromPhone }],
          messages: [{ from: fromPhone, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text }, type: "text" }],
        },
      }],
    }],
  });
}

function metaStatusPayload(metaMessageId, recipientId, status) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-logsan-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511988880000", phone_number_id: META_PHONE_NUMBER_ID },
          statuses: [{ id: metaMessageId, status, recipient_id: recipientId }],
        },
      }],
    }],
  });
}

function twilioParams(messageSid, fromPhone, text) {
  return {
    MessageSid: messageSid,
    From: `whatsapp:+${fromPhone}`,
    To: `whatsapp:${TWILIO_NUMBER}`,
    Body: text,
    ProfileName: SECRET_CONTACT_NAME,
  };
}

async function postMeta(raw) {
  return fetch(`${BASE_URL}/api/whatsapp/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(raw) },
    body: raw,
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log("=== Seeding fixtures ===");
  await adminDb.doc(`clinics/${CLINIC_META}`).set({ name: "Clínica Teste Log Sanitization Meta" });
  await adminDb.doc(`clinics/${CLINIC_META}/integrations/whatsapp`).set({
    provider: "meta", phoneNumberId: META_PHONE_NUMBER_ID, wabaId: "wh-test-logsan-waba-1",
    aiEnabled: false, status: "conectado",
  });
  await adminDb.doc(`whatsapp_phone_index/${META_PHONE_NUMBER_ID}`).set({
    status: "active", clinicId: CLINIC_META, phoneNumberId: META_PHONE_NUMBER_ID, activatedAt: new Date(),
  });
  await adminDb.doc(`clinics/${CLINIC_TWILIO}`).set({ name: "Clínica Teste Log Sanitization Twilio" });
  await adminDb.doc(`clinics/${CLINIC_TWILIO}/integrations/whatsapp`).set({
    provider: "twilio", twilioWhatsAppNumber: TWILIO_NUMBER, twilioAuthToken: TWILIO_AUTH_TOKEN,
    aiEnabled: false, status: "conectado",
  });
  console.log("=== Fixtures ready ===\n");

  console.log("=== Booting real server.ts against the emulator ===");
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN: "unused-in-this-script", GOOGLE_CLOUD_PROJECT: PROJECT_ID },
  });
  let capturedOutput = "";
  child.stdout.on("data", (d) => { capturedOutput += d.toString(); });
  child.stderr.on("data", (d) => { capturedOutput += d.toString(); });

  const up = await waitForServer(45000);
  if (!up) {
    console.error("Server never came up.");
    child.kill();
    process.exit(1);
  }
  console.log("=== Server up ===\n");

  try {
    const run = Date.now();

    // ---- 1. POST Meta — mensagem inbound ----
    console.log("--- 1. POST Meta (mensagem inbound) ---");
    const msgId1 = "wamid.LOGSAN_" + run;
    let metaSigSent1;
    {
      const raw = metaMessagePayload(msgId1, SECRET_PHONE_META, SECRET_TEXT_META);
      metaSigSent1 = metaSignature(raw);
      const res = await postMeta(raw);
      check("Resposta 200", res.status === 200, `status=${res.status}`);
      await sleep(500);
    }

    // ---- 2. POST Meta — status update ----
    console.log("\n--- 2. POST Meta (status update) ---");
    {
      const raw = metaStatusPayload("wamid.LOGSAN_STATUS_" + run, SECRET_PHONE_META, "delivered");
      const res = await postMeta(raw);
      check("Resposta 200", res.status === 200, `status=${res.status}`);
      await sleep(500);
    }

    // ---- 3. POST Twilio — mensagem inbound ----
    console.log("\n--- 3. POST Twilio (mensagem inbound) ---");
    let twilioSigSent;
    {
      const sid = "SMlogsan" + run;
      const params = twilioParams(sid, SECRET_PHONE_TWILIO, SECRET_TEXT_TWILIO);
      const url = `${BASE_URL}/api/whatsapp/webhook`;
      twilioSigSent = twilioPkg.getExpectedTwilioSignature(TWILIO_AUTH_TOKEN, url, params);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSigSent },
        body: new URLSearchParams(params).toString(),
      });
      check("Resposta 200", res.status === 200, `status=${res.status}`);
      await sleep(500);
    }

    // ---- 4. Confirmação negativa — nada sensível no log capturado ----
    console.log("\n--- 4. Confirmação negativa (todo o stdout/stderr do processo) ---");
    check("Telefone Meta NUNCA aparece no log", !capturedOutput.includes(SECRET_PHONE_META));
    check("Texto da mensagem Meta NUNCA aparece no log", !capturedOutput.includes(SECRET_TEXT_META));
    check("Nome de contato NUNCA aparece no log", !capturedOutput.includes(SECRET_CONTACT_NAME));
    check("Message ID (Meta) NUNCA aparece no log", !capturedOutput.includes(msgId1));
    check("Assinatura HMAC enviada (Meta) NUNCA aparece no log", !capturedOutput.includes(metaSigSent1));
    check("Telefone Twilio NUNCA aparece no log", !capturedOutput.includes(SECRET_PHONE_TWILIO));
    check("Texto da mensagem Twilio NUNCA aparece no log", !capturedOutput.includes(SECRET_TEXT_TWILIO));
    check("Assinatura Twilio enviada NUNCA aparece no log", !capturedOutput.includes(twilioSigSent));
    check("String 'rawBody' NUNCA aparece no log (dump de payload cru removido)", !capturedOutput.includes("rawBody"));
    check("String 'WEBHOOK_RECEIVED' NUNCA aparece no log (dump de payload cru removido)", !capturedOutput.includes("WEBHOOK_RECEIVED"));
    check("String 'headers:' NUNCA aparece no log (dump de headers completos removido)", !capturedOutput.includes("headers:"));
    check("Header x-hub-signature-256 nunca é ecoado por chave", !capturedOutput.toLowerCase().includes("x-hub-signature-256"));
    check("Header x-twilio-signature nunca é ecoado por chave", !capturedOutput.toLowerCase().includes("x-twilio-signature"));

    // Confirmação positiva: os eventos estruturados sanitizados existem —
    // prova que a rota continua logando algo útil, não silenciada.
    console.log("\n--- Confirmação positiva: eventos estruturados sanitizados presentes ---");
    check("'post_received' presente", capturedOutput.includes('"event":"post_received"'));
    check("'body_parsed' presente", capturedOutput.includes('"event":"body_parsed"'));
    check("'inbound_message_matched' presente", capturedOutput.includes('"event":"inbound_message_matched"'));
    check("'inbound_message_saved' presente", capturedOutput.includes('"event":"inbound_message_saved"'));
    check("'status_update_received' presente", capturedOutput.includes('"event":"status_update_received"'));
    check("clinicId aparece nos eventos estruturados (é seguro logar)", capturedOutput.includes(CLINIC_META));

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
