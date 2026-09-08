/**
 * Prova, contra o servidor REAL (server.ts) rodando de verdade — não uma
 * reimplementação — e o emulador REAL do Firestore, que a rota
 * /api/whatsapp/webhook (plano vast-yawning-hamster.md v4, Seção 11)
 * funciona como desenhado depois da correção do bug de registro de rota:
 *
 *   1. GET de verificação usa só META_WEBHOOK_VERIFY_TOKEN (token certo
 *      aceita, token errado rejeita).
 *   2. POST da Meta com Content-Type application/json chega como Buffer
 *      cru nesta rota (por causa do parser específico da rota, registrado
 *      ANTES dos parsers globais) — assinatura válida processa e grava no
 *      Firestore; assinatura inválida ou ausente é rejeitada com 403 e
 *      NADA é gravado.
 *   3. POST do Twilio (application/x-www-form-urlencoded) continua
 *      funcionando EXATAMENTE como antes desta mudança — prova de
 *      regressão real, não assumida: twilio.validateRequest() recebe o
 *      objeto já parseado, assinatura válida processa e grava,
 *      assinatura inválida é rejeitada com 403.
 *   4. Content-Type inesperado → 415, nada processado.
 *   5. Deduplicação: o mesmo evento da Meta enviado duas vezes produz um
 *      único efeito (uma única mensagem gravada, um único doc em
 *      whatsapp_processed_events) — a segunda entrega ainda responde 200
 *      (não reprocessa, não falha).
 *
 * Sobe o server.ts de verdade (tsx) contra o emulador local — nenhuma
 * chamada real à Meta/Twilio acontece: os payloads de teste usam
 * telefones que não batem com nenhum staff_whatsapp_access, então o
 * único caminho de envio de saída real (dispatchWhatsAppMessage, só
 * disparado por comandos de staff) nunca é alcançado.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppWebhookParser.mjs
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
const META_APP_SECRET = "test-meta-app-secret-abc-123";
const META_WEBHOOK_VERIFY_TOKEN = "test-verify-token-xyz-789";
const TWILIO_AUTH_TOKEN = "test-twilio-auth-token-456";

const CLINIC_META = "wh-test-clinic-meta";
const CLINIC_TWILIO = "wh-test-clinic-twilio";
const META_PHONE_NUMBER_ID = "wh-test-phone-1";
const TWILIO_NUMBER = "+5511999990000";

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

function metaPayload(messageId, fromPhone, text) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-test-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511988880000", phone_number_id: META_PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Paciente Teste Meta" }, wa_id: fromPhone }],
          messages: [{ from: fromPhone, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text }, type: "text" }],
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
    ProfileName: "Paciente Teste Twilio",
  };
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
  console.log("=== Seeding fixtures ===");
  await adminDb.doc(`clinics/${CLINIC_META}`).set({ name: "Clínica Teste Meta Webhook" });
  await adminDb.doc(`clinics/${CLINIC_META}/integrations/whatsapp`).set({
    provider: "meta", phoneNumberId: META_PHONE_NUMBER_ID, wabaId: "wh-test-waba-1",
    aiEnabled: false, status: "conectado",
  });
  // Roteamento agora é exclusivamente via whatsapp_phone_index (rodada de
  // fencing global) — sem isto, toda entrega Meta seria "não roteável".
  await adminDb.doc(`whatsapp_phone_index/${META_PHONE_NUMBER_ID}`).set({
    status: "active", clinicId: CLINIC_META, phoneNumberId: META_PHONE_NUMBER_ID,
    activatedAt: new Date(),
  });
  await adminDb.doc(`clinics/${CLINIC_TWILIO}`).set({ name: "Clínica Teste Twilio Webhook" });
  await adminDb.doc(`clinics/${CLINIC_TWILIO}/integrations/whatsapp`).set({
    provider: "twilio", twilioWhatsAppNumber: TWILIO_NUMBER, twilioAuthToken: TWILIO_AUTH_TOKEN,
    aiEnabled: false, status: "conectado",
  });
  console.log("=== Fixtures ready ===\n");

  console.log("=== Booting real server.ts against the emulator ===");
  // Invoke tsx's CLI entry directly via `node`, NOT the .cmd shim with
  // shell:true — on Windows, killing a shell:true child only kills the
  // cmd.exe wrapper, leaving the real node/tsx process orphaned and still
  // bound to :3000 for the next run. Plain `node <tsx-cli.mjs>` is a
  // single real process this script can actually kill.
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      META_APP_SECRET,
      META_WEBHOOK_VERIFY_TOKEN,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
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
    console.log("--- 1. GET verify token ---");
    {
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${META_WEBHOOK_VERIFY_TOKEN}&hub.challenge=challenge-123`);
      const text = await res.text();
      check("Token correto: 200 + challenge ecoado", res.status === 200 && text === "challenge-123", `status=${res.status} body=${text}`);
    }
    {
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123`);
      check("Token errado: 403", res.status === 403, `status=${res.status}`);
    }

    console.log("\n--- 2. POST Meta — assinatura válida processa e grava ---");
    const runSuffix = Date.now();
    const msgId1 = "wamid.TEST_VALID_" + runSuffix;
    // Unique per run (not a fixed number) — avoids the messages subcollection
    // accumulating docs across repeated runs of this script, which would
    // make a plain "size === 1" assertion in step 3 meaningless after the
    // first run.
    const fromPhoneMeta = "551190" + String(runSuffix).slice(-6);
    {
      const raw = metaPayload(msgId1, fromPhoneMeta, "Olá, teste de assinatura válida");
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(raw) },
        body: raw,
      });
      check("Meta assinatura válida: 200", res.status === 200, `status=${res.status}`);
      await new Promise((r) => setTimeout(r, 800));
      const msgSnap = await adminDb.doc(`clinics/${CLINIC_META}/whatsapp_conversations/${fromPhoneMeta}/messages/${msgId1}`).get();
      check("Mensagem gravada no Firestore", msgSnap.exists);
      const eventSnap = await adminDb.doc(`clinics/${CLINIC_META}/whatsapp_processed_events/${msgId1}`).get();
      check("Evento de dedup reservado", eventSnap.exists);
    }

    console.log("\n--- 3. POST Meta — mesmo evento de novo (duplicata) não reprocessa ---");
    {
      const raw = metaPayload(msgId1, fromPhoneMeta, "Olá, teste de assinatura válida");
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(raw) },
        body: raw,
      });
      check("Duplicata: ainda 200", res.status === 200, `status=${res.status}`);
      const messagesSnap = await adminDb.collection(`clinics/${CLINIC_META}/whatsapp_conversations/${fromPhoneMeta}/messages`).get();
      check("Ainda só 1 mensagem gravada (não duplicou)", messagesSnap.size === 1, `count=${messagesSnap.size}`);
    }

    console.log("\n--- 4. POST Meta — assinatura inválida rejeitada, nada gravado ---");
    const msgId2 = "wamid.TEST_INVALID_SIG_" + Date.now();
    {
      const raw = metaPayload(msgId2, fromPhoneMeta, "Não deveria ser salvo");
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + "0".repeat(64) },
        body: raw,
      });
      check("Assinatura inválida: 403", res.status === 403, `status=${res.status}`);
      await new Promise((r) => setTimeout(r, 500));
      const msgSnap = await adminDb.doc(`clinics/${CLINIC_META}/whatsapp_conversations/${fromPhoneMeta}/messages/${msgId2}`).get();
      check("Nada foi gravado (rejeitado antes de processar)", !msgSnap.exists);
    }

    console.log("\n--- 5. POST Meta — assinatura ausente rejeitada ---");
    {
      const raw = metaPayload("wamid.TEST_NOSIG_" + Date.now(), fromPhoneMeta, "Sem assinatura");
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      });
      check("Sem header de assinatura: 403", res.status === 403, `status=${res.status}`);
    }

    console.log("\n--- 6. POST Twilio — assinatura válida continua funcionando (regressão) ---");
    const sid1 = "SM_TEST_VALID_" + runSuffix;
    const fromPhoneTwilio = "551191" + String(runSuffix).slice(-6);
    {
      const params = twilioParams(sid1, fromPhoneTwilio, "Oi via Twilio, assinatura válida");
      const url = `${BASE_URL}/api/whatsapp/webhook`;
      const sig = twilioPkg.getExpectedTwilioSignature(TWILIO_AUTH_TOKEN, url, params);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
        body: new URLSearchParams(params).toString(),
      });
      check("Twilio assinatura válida: 200", res.status === 200, `status=${res.status}`);
      await new Promise((r) => setTimeout(r, 800));
      const msgSnap = await adminDb.doc(`clinics/${CLINIC_TWILIO}/whatsapp_conversations/${fromPhoneTwilio}/messages/${sid1}`).get();
      check("Mensagem Twilio gravada no Firestore", msgSnap.exists);
    }

    console.log("\n--- 7. POST Twilio — assinatura inválida rejeitada ---");
    {
      const sid2 = "SM_TEST_INVALID_" + Date.now();
      const params = twilioParams(sid2, fromPhoneTwilio, "Não deveria ser salvo");
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "bogus-signature==" },
        body: new URLSearchParams(params).toString(),
      });
      check("Twilio assinatura inválida: 403", res.status === 403, `status=${res.status}`);
      const msgSnap = await adminDb.doc(`clinics/${CLINIC_TWILIO}/whatsapp_conversations/${fromPhoneTwilio}/messages/${sid2}`).get();
      check("Nada foi gravado", !msgSnap.exists);
    }

    console.log("\n--- 8. Content-Type inesperado: 415 ---");
    {
      const res = await fetch(`${BASE_URL}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "isto não é nem Meta nem Twilio",
      });
      check("Content-Type desconhecido: 415", res.status === 415, `status=${res.status}`);
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
