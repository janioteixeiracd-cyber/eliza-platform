/**
 * Prova, contra o server.ts real (via tsx) rodando contra o emulador, que o
 * roteamento inbound do webhook Meta usa EXCLUSIVAMENTE
 * `whatsapp_phone_index/{phoneNumberId}` com `status: 'active'` — nunca
 * varre todas as clínicas, nunca encaminha pra uma clínica "presumida" a
 * partir do próprio payload.
 *
 * Cenários pedidos explicitamente (rodada de fencing global, item 2):
 *   a. Índice ausente — nenhum doc `whatsapp_phone_index/{phoneNumberId}`.
 *   b. Índice em `status: 'pending'` — reserva em andamento, ainda não
 *      promovida pela transação terminal.
 *   c. Índice `active` + coerente — fluxo normal, mensagem roteada e
 *      gravada na clínica certa (prova de que a mudança não quebrou o
 *      caminho feliz).
 *   d. Índice `active` mas INCOERENTE com o doc de integração da própria
 *      clínica apontada (status != 'conectado' ou phoneNumberId não bate).
 *   e. Tentativa de associação cruzada — o índice aponta (coerente ou não)
 *      pra clínica A, mas uma clínica B DIFERENTE também tem, no seu
 *      próprio doc de integração, o mesmo phoneNumberId (inconsistência de
 *      dado plausível por bug/migração manual). Prova que o handler nunca
 *      "encontra" B nem por acidente — sem esse teste, uma implementação
 *      ingênua que ainda varresse todas as clínicas como fallback passaria
 *      despercebida.
 *
 * ATUALIZAÇÃO (rodada final de fechamento) — falha de roteamento deixou de
 * ser sempre 200. Agora se divide em:
 *   - RECUPERÁVEL (503, sem quarentena): 'pending' — uma ativação
 *     genuinamente em andamento, que deve virar 'active' em segundos; um
 *     503 faz a Meta reentregar, e a reentrega tem chance real de
 *     suceder. Cenário b.
 *   - PERSISTENTE (200 ack + quarentena sanitizada): índice ausente,
 *     incoerente, ou associação cruzada — nenhum desses se autocorrige
 *     com reenvio; fica registrado em `whatsapp_routing_quarantine/{hash}`
 *     (só phoneNumberId + motivo + contagem, nunca payload) pra
 *     investigação humana. Cenários a, d, e.
 * Em TODOS os casos: log sanitizado `WA_ROUTING_<reason>` emitido, e ZERO
 * mensagens gravadas em QUALQUER clínica (nem a apontada pelo índice, nem
 * nenhuma outra).
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppPhoneIndexRouting.mjs
 */
import { spawn } from "child_process";
import crypto from "crypto";
import admin from "firebase-admin";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST not set.");
  process.exit(1);
}

const PROJECT_ID = "elisa-494703";
const BASE_URL = "http://127.0.0.1:3000";
const META_APP_SECRET = "test-meta-app-secret-routing-777";

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

function metaPayload(phoneNumberId, messageId, fromPhone, text) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-routing-test",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511977770000", phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: "Paciente Routing" }, wa_id: fromPhone }],
          messages: [{ from: fromPhone, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text }, type: "text" }],
        },
      }],
    }],
  });
}

async function postMeta(body) {
  return fetch(`${BASE_URL}/api/whatsapp/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(body) },
    body,
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

async function anyMessageExistsAcrossClinics(clinicIds, fromPhone, messageId) {
  for (const clinicId of clinicIds) {
    const snap = await adminDb.doc(`clinics/${clinicId}/whatsapp_conversations/${fromPhone}/messages/${messageId}`).get();
    if (snap.exists) return clinicId;
  }
  return null;
}

function quarantineDocFor(phoneNumberId) {
  const hash = crypto.createHash("sha256").update(phoneNumberId).digest("hex").slice(0, 32);
  return adminDb.doc(`whatsapp_routing_quarantine/${hash}`);
}

async function main() {
  const run = Date.now();
  const CLINIC_A = `wh-test-routing-a-${run}`;
  const CLINIC_B = `wh-test-routing-b-${run}`;

  console.log("=== Seeding clinic fixtures ===");
  await adminDb.doc(`clinics/${CLINIC_A}`).set({ name: "Clínica A (roteamento)" });
  await adminDb.doc(`clinics/${CLINIC_B}`).set({ name: "Clínica B (roteamento)" });
  console.log("=== Fixtures ready ===\n");

  console.log("=== Booting real server.ts against the emulator ===");
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      META_APP_SECRET,
      META_WEBHOOK_VERIFY_TOKEN: "unused-in-this-script",
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
    // ---- a. Índice ausente ----
    console.log("--- a. Índice ausente inteiramente ---");
    {
      const phoneNumberId = `wh-routing-missing-${run}`;
      const messageId = "wamid.ROUTING_MISSING_" + run;
      const fromPhone = "551194" + String(run).slice(-6);
      // Clínica A tem integração 'conectado' apontando pra este phoneNumberId,
      // mas NENHUM doc whatsapp_phone_index existe — prova que a integração
      // por si só não é suficiente, o índice é a única fonte de roteamento.
      await adminDb.doc(`clinics/${CLINIC_A}/integrations/whatsapp`).set({
        provider: "meta", phoneNumberId, wabaId: "wh-routing-waba-a",
        aiEnabled: false, status: "conectado",
      });
      const raw = metaPayload(phoneNumberId, messageId, fromPhone, "Não deveria rotear");
      const res = await postMeta(raw);
      check("Resposta 200 (ack, persistente, sem retry)", res.status === 200, `status=${res.status}`);
      await sleep(400);
      const foundIn = await anyMessageExistsAcrossClinics([CLINIC_A, CLINIC_B], fromPhone, messageId);
      check("Nenhuma mensagem gravada em nenhuma clínica", foundIn === null, `encontrada em ${foundIn}`);
      const quarantineSnap = await quarantineDocFor(phoneNumberId).get();
      check("Quarentena registrada (persistente)", quarantineSnap.exists && quarantineSnap.data()?.reason === "phone_index_missing", `data=${JSON.stringify(quarantineSnap.data())}`);
      check("Quarentena sanitizada (sem campos além do esperado)", Object.keys(quarantineSnap.data() || {}).sort().join(",") === "expiresAt,firstSeenAt,lastSeenAt,occurrences,phoneNumberId,reason,resolvedAt");
      // Item 8 (rodada final) — política de retenção: quarentena expira
      // sozinha em ~30 dias (medido a partir do último occurrence), nunca
      // sem TTL nenhum (diferente dos registros de limpeza administrativa,
      // que são deliberadamente sem TTL).
      const expiresAtMs = quarantineSnap.data()?.expiresAt?.toMillis?.() ?? 0;
      const daysUntilExpiry = (expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000);
      check("expiresAt ~30 dias no futuro", daysUntilExpiry > 29 && daysUntilExpiry < 31, `dias=${daysUntilExpiry.toFixed(2)}`);
    }

    // ---- b. Índice status: 'pending' ----
    console.log("\n--- b. Índice em status 'pending' ---");
    {
      const phoneNumberId = `wh-routing-pending-${run}`;
      const messageId = "wamid.ROUTING_PENDING_" + run;
      const fromPhone = "551195" + String(run).slice(-6);
      await adminDb.doc(`clinics/${CLINIC_A}/integrations/whatsapp`).set({
        provider: "meta", phoneNumberId, wabaId: "wh-routing-waba-a-pending",
        aiEnabled: false, status: "conectado",
      });
      await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).set({
        status: "pending", clinicId: CLINIC_A, phoneNumberId,
        attemptId: "some-in-flight-attempt", createdAt: new Date(),
      });
      const raw = metaPayload(phoneNumberId, messageId, fromPhone, "Ainda reservando, não deveria rotear");
      const res = await postMeta(raw);
      check("Resposta 503 (recuperável — provoca reentrega real da Meta)", res.status === 503, `status=${res.status}`);
      await sleep(400);
      const foundIn = await anyMessageExistsAcrossClinics([CLINIC_A, CLINIC_B], fromPhone, messageId);
      check("Nenhuma mensagem gravada em nenhuma clínica", foundIn === null, `encontrada em ${foundIn}`);
      const quarantineSnap = await quarantineDocFor(phoneNumberId).get();
      check("NÃO registrado em quarentena (é recuperável, não persistente)", !quarantineSnap.exists, `exists=${quarantineSnap.exists}`);
    }

    // ---- c. Índice active + coerente (caminho feliz, regressão) ----
    console.log("\n--- c. Índice 'active' + coerente (caminho feliz) ---");
    {
      const phoneNumberId = `wh-routing-ok-${run}`;
      const messageId = "wamid.ROUTING_OK_" + run;
      const fromPhone = "551196" + String(run).slice(-6);
      await adminDb.doc(`clinics/${CLINIC_A}/integrations/whatsapp`).set({
        provider: "meta", phoneNumberId, wabaId: "wh-routing-waba-a-ok",
        aiEnabled: false, status: "conectado",
      });
      await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).set({
        status: "active", clinicId: CLINIC_A, phoneNumberId, activatedAt: new Date(),
      });
      const raw = metaPayload(phoneNumberId, messageId, fromPhone, "Deveria rotear normalmente pra A");
      const res = await postMeta(raw);
      check("Resposta 200", res.status === 200, `status=${res.status}`);
      await sleep(400);
      const msgSnap = await adminDb.doc(`clinics/${CLINIC_A}/whatsapp_conversations/${fromPhone}/messages/${messageId}`).get();
      check("Mensagem gravada na clínica A (a apontada pelo índice)", msgSnap.exists);
      const foundInB = await anyMessageExistsAcrossClinics([CLINIC_B], fromPhone, messageId);
      check("Nada gravado na clínica B", foundInB === null, `encontrada em ${foundInB}`);
    }

    // ---- d. Índice active mas incoerente com a integração da própria clínica apontada ----
    console.log("\n--- d. Índice 'active' mas INCOERENTE com a integração da clínica apontada ---");
    {
      const phoneNumberId = `wh-routing-incoherent-${run}`;
      const otherPhoneNumberId = `wh-routing-incoherent-other-${run}`;
      const messageId = "wamid.ROUTING_INCOHERENT_" + run;
      const fromPhone = "551197" + String(run).slice(-6);
      // Índice diz que este phoneNumberId pertence à clínica A e está ativo...
      await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).set({
        status: "active", clinicId: CLINIC_A, phoneNumberId, activatedAt: new Date(),
      });
      // ...mas a integração REAL da clínica A aponta pra outro phoneNumberId
      // (ex.: reconectou com um número novo e o índice antigo não foi
      // limpo corretamente — inconsistência de dado real e plausível).
      await adminDb.doc(`clinics/${CLINIC_A}/integrations/whatsapp`).set({
        provider: "meta", phoneNumberId: otherPhoneNumberId, wabaId: "wh-routing-waba-a-incoherent",
        aiEnabled: false, status: "conectado",
      });
      const raw = metaPayload(phoneNumberId, messageId, fromPhone, "Índice incoerente, não deveria rotear");
      const res = await postMeta(raw);
      check("Resposta 200 (ack, persistente, sem retry)", res.status === 200, `status=${res.status}`);
      await sleep(400);
      const foundIn = await anyMessageExistsAcrossClinics([CLINIC_A, CLINIC_B], fromPhone, messageId);
      check("Nenhuma mensagem gravada em nenhuma clínica", foundIn === null, `encontrada em ${foundIn}`);
      const quarantineSnap = await quarantineDocFor(phoneNumberId).get();
      check("Quarentena registrada (incoerência é persistente)", quarantineSnap.exists && quarantineSnap.data()?.reason === "phone_index_integration_mismatch", `data=${JSON.stringify(quarantineSnap.data())}`);
    }

    // ---- e. Tentativa de associação cruzada ----
    console.log("\n--- e. Associação cruzada: índice incoerente em A, mas B tem doc de integração com o MESMO phoneNumberId ---");
    {
      const phoneNumberId = `wh-routing-cross-${run}`;
      const otherPhoneNumberId = `wh-routing-cross-other-${run}`;
      const messageId = "wamid.ROUTING_CROSS_" + run;
      const fromPhone = "551198" + String(run).slice(-6);
      // Índice aponta pra A, mas a integração de A ficou incoerente (número
      // diferente) — exatamente como no cenário 'd'.
      await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).set({
        status: "active", clinicId: CLINIC_A, phoneNumberId, activatedAt: new Date(),
      });
      await adminDb.doc(`clinics/${CLINIC_A}/integrations/whatsapp`).set({
        provider: "meta", phoneNumberId: otherPhoneNumberId, wabaId: "wh-routing-waba-a-cross",
        aiEnabled: false, status: "conectado",
      });
      // Clínica B, de forma totalmente independente (dado inconsistente —
      // ex.: configuração manual equivocada, ou resquício de teste), tem no
      // SEU PRÓPRIO doc de integração o MESMO phoneNumberId que o índice
      // (incoerentemente) associa à clínica A. Uma implementação ingênua
      // que "procurasse em todas as clínicas por phoneNumberId" quando o
      // índice falhasse encontraria B e rotearia errado — a mensagem de um
      // paciente da clínica A vazaria pra dentro da clínica B.
      await adminDb.doc(`clinics/${CLINIC_B}/integrations/whatsapp`).set({
        provider: "meta", phoneNumberId, wabaId: "wh-routing-waba-b-cross",
        aiEnabled: false, status: "conectado",
      });
      const raw = metaPayload(phoneNumberId, messageId, fromPhone, "Não deveria vazar pra B nunca");
      const res = await postMeta(raw);
      check("Resposta 200 (ack, persistente, sem retry)", res.status === 200, `status=${res.status}`);
      await sleep(400);
      const foundInB = await anyMessageExistsAcrossClinics([CLINIC_B], fromPhone, messageId);
      check("NÃO vazou pra clínica B (nunca escaneia por fallback)", foundInB === null, `encontrada em ${foundInB}`);
      const foundInA = await anyMessageExistsAcrossClinics([CLINIC_A], fromPhone, messageId);
      check("Também não foi gravada em A (índice continua incoerente)", foundInA === null, `encontrada em ${foundInA}`);
      const quarantineSnap = await quarantineDocFor(phoneNumberId).get();
      check("Quarentena registrada (não vaza pra B nem lá)", quarantineSnap.exists && quarantineSnap.data()?.reason === "phone_index_integration_mismatch", `data=${JSON.stringify(quarantineSnap.data())}`);
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
