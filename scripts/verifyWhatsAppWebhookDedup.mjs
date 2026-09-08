/**
 * Prova, contra o server.ts real (via tsx) rodando contra o emulador, a
 * máquina de estados de deduplicação + fencing de lease do webhook
 * (clinics/{clinicId}/whatsapp_processed_events/{eventKey}, status
 * processing|completed|failed|dead_letter). Segunda rodada — cobre as
 * correções pedidas em cima da primeira versão (que já garantia dedup
 * básico, mas ainda tinha 3 gaps reais): idempotência do EFEITO (não só do
 * bookkeeping) quando uma falha acontece depois do efeito já ter
 * acontecido; fencing por claimId pra impedir que um worker antigo,
 * meramente lento (não morto), complete ou falhe uma execução que já foi
 * reclamada por outro; e limite de tentativas com dead_letter.
 *
 * Cenários cobertos (pedidos explicitamente):
 *   1. Falha depois da reserva — igual à rodada anterior, agora checando
 *      os campos sanitizados novos (errorCode/errorClass/errorPhase, SEM
 *      nenhum campo de mensagem crua).
 *   2. Nova entrega após falha — retry seguro, attempts incrementa.
 *   3. Processing abandonado — reclaim depois do timeout.
 *   4. Duplicata após completed — não reprocessa.
 *   5/6. Duas entregas concorrentes do mesmo evento — só uma produz efeito.
 *   7. NOVO — crash depois de gravar a mensagem, antes de completed: a
 *      mensagem e o evento "processing" são semeados manualmente pra
 *      simular exatamente essa janela; a entrega real que reclama não pode
 *      re-incrementar unreadCount nem sobrescrever a mensagem.
 *   8. NOVO — reclaim seguido da CONCLUSÃO atrasada do claim antigo: um
 *      worker lento de verdade (sentinela __WA_TEST_SLOW_WORKER__, atraso
 *      real de 3s dentro do código de produção) é reclamado por timeout
 *      enquanto ainda está "vivo"; quando ele finalmente tenta concluir,
 *      o fencing por claimId rejeita a escrita dele sem corromper o
 *      resultado do worker novo.
 *   9. NOVO — reclaim seguido da FALHA atrasada do claim antigo: mesma
 *      ideia, mas o worker antigo (sentinela __WA_TEST_SLOW_THEN_FAIL__)
 *      falha de verdade depois de já ter sido superado — o evento
 *      "completed" do worker novo não pode virar "failed".
 *   10. NOVO — limite de tentativas: WA_WEBHOOK_MAX_ATTEMPTS falhas reais
 *       seguidas viram "dead_letter"; uma entrega adicional não é
 *       reclamada nem executa nenhum efeito.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppWebhookDedup.mjs
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
const META_APP_SECRET = "test-meta-app-secret-dedup-999";
const CLINIC = "wh-test-clinic-dedup";
const PHONE_NUMBER_ID = "wh-test-phone-dedup-1";
const MAX_ATTEMPTS = 5; // must match WA_WEBHOOK_MAX_ATTEMPTS in server.ts

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
      id: "waba-dedup-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511988880000", phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: "Paciente Dedup" }, wa_id: fromPhone }],
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

function eventDocId(id) { return id.replace(/\//g, "_"); }
function eventRef(id) { return adminDb.doc(`clinics/${CLINIC}/whatsapp_processed_events/${eventDocId(id)}`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log("=== Seeding clinic fixture ===");
  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Teste Dedup" });
  await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).set({
    provider: "meta", phoneNumberId: PHONE_NUMBER_ID, wabaId: "wh-test-waba-dedup-1",
    aiEnabled: false, status: "conectado",
  });
  // Roteamento agora é exclusivamente via whatsapp_phone_index (rodada de
  // fencing global) — sem isto, toda entrega seria "não roteável".
  await adminDb.doc(`whatsapp_phone_index/${PHONE_NUMBER_ID}`).set({
    status: "active", clinicId: CLINIC, phoneNumberId: PHONE_NUMBER_ID, activatedAt: new Date(),
  });
  console.log("=== Fixture ready ===\n");

  console.log("=== Booting real server.ts against the emulator (fault injection ARMED) ===");
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      META_APP_SECRET,
      META_WEBHOOK_VERIFY_TOKEN: "unused-in-this-script",
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      WA_WEBHOOK_ALLOW_TEST_FAULT: "1",
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

    // ---- 1. Falha depois da reserva ----
    console.log("--- 1. Falha depois da reserva ---");
    const msgIdFail = "wamid.DEDUP_FAIL_" + run;
    const phoneFail = "551192" + String(run).slice(-6);
    {
      const raw = metaPayload(msgIdFail, phoneFail, "__WA_TEST_FORCE_FAILURE__");
      const res = await postMeta(raw);
      check("Resposta 500 (falha genuína, não engolida como 200)", res.status === 500, `status=${res.status}`);
      await sleep(500);
      const ev = (await eventRef(msgIdFail).get()).data();
      check("Evento marcado 'failed'", ev?.status === "failed", `status=${ev?.status}`);
      check("attempts=1", ev?.attempts === 1, `attempts=${ev?.attempts}`);
      check("errorCode presente e controlado", ev?.errorCode === "WA_MESSAGE_PROCESSING_FAILED", `errorCode=${ev?.errorCode}`);
      check("errorClass é uma classe permitida (Error)", ev?.errorClass === "Error", `errorClass=${ev?.errorClass}`);
      check("errorPhase presente", ev?.errorPhase === "MESSAGE_PROCESSING", `errorPhase=${ev?.errorPhase}`);
      check("NENHUM campo de mensagem crua persistido (lastError/message ausentes)", ev?.lastError === undefined && ev?.message === undefined && ev?.errorMessage === undefined);
      const msgSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneFail}/messages/${msgIdFail}`).get();
      check("Nenhum doc de mensagem gravado (falhou antes de qualquer escrita)", !msgSnap.exists);
    }

    // ---- 2. Nova entrega após falha ----
    console.log("\n--- 2. Nova entrega após falha ---");
    {
      const raw = metaPayload(msgIdFail, phoneFail, "Retry depois da falha, deveria processar agora");
      const res = await postMeta(raw);
      check("Resposta 200 no retry bem-sucedido", res.status === 200, `status=${res.status}`);
      await sleep(500);
      const ev = (await eventRef(msgIdFail).get()).data();
      check("Evento agora 'completed'", ev?.status === "completed", `status=${ev?.status}`);
      check("attempts=2 (incrementado no retry)", ev?.attempts === 2, `attempts=${ev?.attempts}`);
      check("errorCode limpo após sucesso", ev?.errorCode === null, `errorCode=${ev?.errorCode}`);
      const msgSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneFail}/messages/${msgIdFail}`).get();
      check("Doc de mensagem agora existe (retry processou de verdade)", msgSnap.exists);
    }

    // ---- 3. Processing abandonado ----
    console.log("\n--- 3. Processing abandonado ---");
    const msgIdAbandoned = "wamid.DEDUP_ABANDONED_" + run;
    const phoneAbandoned = "551193" + String(run).slice(-6);
    {
      const staleClaimedAt = admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
      await eventRef(msgIdAbandoned).set({
        status: "processing", attempts: 1, claimId: "seed-stale-claim",
        claimedAt: staleClaimedAt, firstClaimedAt: staleClaimedAt, completedAt: null,
        errorCode: null, errorClass: null, errorPhase: null, lastFailedAt: null,
      });
      const raw = metaPayload(msgIdAbandoned, phoneAbandoned, "Reclaim de processing abandonado");
      const res = await postMeta(raw);
      check("Resposta 200 (reclaim + processamento real)", res.status === 200, `status=${res.status}`);
      await sleep(500);
      const ev = (await eventRef(msgIdAbandoned).get()).data();
      check("Evento agora 'completed'", ev?.status === "completed", `status=${ev?.status}`);
      check("attempts=2 (reclaim incrementou)", ev?.attempts === 2, `attempts=${ev?.attempts}`);
      check("claimId mudou (não é mais o seed)", ev?.claimId !== "seed-stale-claim", `claimId=${ev?.claimId}`);
      const msgSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneAbandoned}/messages/${msgIdAbandoned}`).get();
      check("Doc de mensagem foi gravado pelo reclaim", msgSnap.exists);
    }

    // ---- 4. Duplicata após completed ----
    console.log("\n--- 4. Duplicata após completed ---");
    const msgIdDup = "wamid.DEDUP_DUP_" + run;
    const phoneDup = "551194" + String(run).slice(-6);
    {
      const raw = metaPayload(msgIdDup, phoneDup, "Mensagem original");
      const res1 = await postMeta(raw);
      check("1ª entrega: 200", res1.status === 200, `status=${res1.status}`);
      await sleep(500);
      const res2 = await postMeta(raw);
      check("2ª entrega (duplicata exata): ainda 200", res2.status === 200, `status=${res2.status}`);
      await sleep(500);
      const ev = (await eventRef(msgIdDup).get()).data();
      check("attempts continua 1 (duplicata não reclama, não reprocessa)", ev?.attempts === 1, `attempts=${ev?.attempts}`);
      const messagesSnap = await adminDb.collection(`clinics/${CLINIC}/whatsapp_conversations/${phoneDup}/messages`).get();
      check("Só 1 doc de mensagem (sem duplicar)", messagesSnap.size === 1, `count=${messagesSnap.size}`);
      const convoSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneDup}`).get();
      check("unreadCount=1 (não duplicou o incremento)", convoSnap.data()?.unreadCount === 1, `unreadCount=${convoSnap.data()?.unreadCount}`);
    }

    // ---- 5/6. Duas entregas concorrentes do mesmo evento ----
    console.log("\n--- 5/6. Duas entregas concorrentes do mesmo evento ---");
    const msgIdConc = "wamid.DEDUP_CONCURRENT_" + run;
    const phoneConc = "551195" + String(run).slice(-6);
    {
      const raw = metaPayload(msgIdConc, phoneConc, "Entrega concorrente");
      const [resA, resB] = await Promise.all([postMeta(raw), postMeta(raw)]);
      check("Entrega A: 200", resA.status === 200, `status=${resA.status}`);
      check("Entrega B: 200", resB.status === 200, `status=${resB.status}`);
      await sleep(800);
      const ev = (await eventRef(msgIdConc).get()).data();
      check("Evento 'completed'", ev?.status === "completed", `status=${ev?.status}`);
      check("attempts=1 (só uma das duas venceu o claim)", ev?.attempts === 1, `attempts=${ev?.attempts}`);
      const messagesSnap = await adminDb.collection(`clinics/${CLINIC}/whatsapp_conversations/${phoneConc}/messages`).get();
      check("Só 1 doc de mensagem gravado (efeito único, garantido)", messagesSnap.size === 1, `count=${messagesSnap.size}`);
    }

    // ---- 7. Crash depois de gravar a mensagem, antes de completed ----
    console.log("\n--- 7. Crash depois do efeito, antes de completed (idempotência do efeito) ---");
    const msgIdCrash = "wamid.DEDUP_CRASH_" + run;
    const phoneCrash = "551196" + String(run).slice(-6);
    {
      // Simula exatamente a janela pedida: a mensagem já foi gravada (como
      // se um commit antigo tivesse acontecido) mas o evento ainda está
      // "processing" — nunca chegou a marcar completed.
      const staleClaimedAt = admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
      await eventRef(msgIdCrash).set({
        status: "processing", attempts: 1, claimId: "seed-crash-claim",
        claimedAt: staleClaimedAt, firstClaimedAt: staleClaimedAt, completedAt: null,
        errorCode: null, errorClass: null, errorPhase: null, lastFailedAt: null,
      });
      await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneCrash}`).set({
        patientId: "", patientName: "Paciente Dedup", patientPhone: phoneCrash,
        status: "aguardando", lastMessage: "Mensagem original (pré-crash)", unreadCount: 1,
        assignedTo: "ai", aiEnabled: false, source: "whatsapp",
      });
      await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneCrash}/messages/${msgIdCrash}`).set({
        direction: "inbound", text: "Mensagem original (pré-crash)", from: phoneCrash,
        whatsappMessageId: msgIdCrash, status: "received", source: "whatsapp_webhook_seed_precrash",
      });

      const raw = metaPayload(msgIdCrash, phoneCrash, "Reentrega depois do crash simulado");
      const res = await postMeta(raw);
      check("Resposta 200 (reclama e completa, sem duplicar o efeito)", res.status === 200, `status=${res.status}`);
      await sleep(500);

      const ev = (await eventRef(msgIdCrash).get()).data();
      check("Evento agora 'completed'", ev?.status === "completed", `status=${ev?.status}`);

      const convoSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneCrash}`).get();
      check("unreadCount continua 1 (NÃO incrementou de novo)", convoSnap.data()?.unreadCount === 1, `unreadCount=${convoSnap.data()?.unreadCount}`);

      const msgSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneCrash}/messages/${msgIdCrash}`).get();
      check("Mensagem NÃO foi recriada/sobrescrita (texto original preservado)", msgSnap.data()?.text === "Mensagem original (pré-crash)", `text=${msgSnap.data()?.text}`);
      check("source do doc original preservado (prova de que não houve novo set())", msgSnap.data()?.source === "whatsapp_webhook_seed_precrash", `source=${msgSnap.data()?.source}`);
    }

    // ---- 8. Reclaim seguido da conclusão atrasada do claim antigo ----
    console.log("\n--- 8. Reclaim + conclusão atrasada do claim antigo ---");
    const msgIdSlow = "wamid.DEDUP_SLOWWORKER_" + run;
    const phoneSlow = "551197" + String(run).slice(-6);
    {
      // Worker A: sentinela lento (dorme ~3s DENTRO do código de produção,
      // depois do claim, antes de qualquer escrita) — dispara mas não
      // espera aqui.
      const rawSlow = metaPayload(msgIdSlow, phoneSlow, "__WA_TEST_SLOW_WORKER__");
      const slowPromise = postMeta(rawSlow);

      // Dá tempo do claim de A pousar no Firestore antes de mexer nele.
      await sleep(400);
      const evAfterAClaim = (await eventRef(msgIdSlow).get()).data();
      check("Claim de A registrado antes da manipulação", evAfterAClaim?.status === "processing" && !!evAfterAClaim?.claimId, `status=${evAfterAClaim?.status}`);

      // Força o claim de A a parecer abandonado (sem tocar no claimId) —
      // simula o timeout real ter passado, SEM esperar 5 minutos de
      // verdade e SEM interromper a "execução" de A (que continua dormindo
      // no processo do servidor).
      await eventRef(msgIdSlow).update({ claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 60 * 1000) });

      // Worker B: entrega normal do MESMO evento — deve reclamar (A ainda
      // não voltou) e concluir primeiro, com conteúdo diferente do de A.
      const rawFast = metaPayload(msgIdSlow, phoneSlow, "Conteúdo do worker B (reclamou primeiro)");
      const resB = await postMeta(rawFast);
      check("Worker B: 200", resB.status === 200, `status=${resB.status}`);
      await sleep(300);
      const evAfterB = (await eventRef(msgIdSlow).get()).data();
      check("Evento 'completed' pelo worker B", evAfterB?.status === "completed", `status=${evAfterB?.status}`);
      const claimIdAfterB = evAfterB?.claimId;
      check("claimId mudou pra B", claimIdAfterB && claimIdAfterB !== evAfterAClaim?.claimId);

      // Agora deixa A acordar e tentar concluir com o claimId ANTIGO dele.
      const resA = await slowPromise;
      check("Worker A (atrasado): resposta ainda 200 (fencing rejeita sem virar erro HTTP)", resA.status === 200, `status=${resA.status}`);
      await sleep(300);

      const evFinal = (await eventRef(msgIdSlow).get()).data();
      check("Evento CONTINUA 'completed' (A não sobrescreveu)", evFinal?.status === "completed", `status=${evFinal?.status}`);
      check("claimId final ainda é o de B (A não regrediu o estado)", evFinal?.claimId === claimIdAfterB, `claimId=${evFinal?.claimId}`);

      const messagesSnap = await adminDb.collection(`clinics/${CLINIC}/whatsapp_conversations/${phoneSlow}/messages`).get();
      check("Só 1 mensagem gravada (a de B — A nunca escreveu)", messagesSnap.size === 1, `count=${messagesSnap.size}`);
      const onlyMsg = messagesSnap.docs[0]?.data();
      check("Conteúdo é o do worker B, não o de A", onlyMsg?.text === "Conteúdo do worker B (reclamou primeiro)", `text=${onlyMsg?.text}`);
    }

    // ---- 9. Reclaim seguido da falha atrasada do claim antigo ----
    console.log("\n--- 9. Reclaim + falha atrasada do claim antigo ---");
    const msgIdSlowFail = "wamid.DEDUP_SLOWFAIL_" + run;
    const phoneSlowFail = "551198" + String(run).slice(-6);
    {
      const rawSlowFail = metaPayload(msgIdSlowFail, phoneSlowFail, "__WA_TEST_SLOW_THEN_FAIL__");
      const slowFailPromise = postMeta(rawSlowFail);

      await sleep(400);
      const evAfterAClaim = (await eventRef(msgIdSlowFail).get()).data();
      await eventRef(msgIdSlowFail).update({ claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 60 * 1000) });

      const rawFast = metaPayload(msgIdSlowFail, phoneSlowFail, "Conteúdo do worker B (venceu antes da falha atrasada de A)");
      const resB = await postMeta(rawFast);
      check("Worker B: 200", resB.status === 200, `status=${resB.status}`);
      await sleep(300);
      const evAfterB = (await eventRef(msgIdSlowFail).get()).data();
      check("Evento 'completed' pelo worker B", evAfterB?.status === "completed", `status=${evAfterB?.status}`);
      const claimIdAfterB = evAfterB?.claimId;

      // A acorda e FALHA de verdade (não só demora) — mas já foi superado.
      const resA = await slowFailPromise;
      await sleep(300);
      const evFinal = (await eventRef(msgIdSlowFail).get()).data();
      check("Evento CONTINUA 'completed' (falha atrasada de A não virou 'failed')", evFinal?.status === "completed", `status=${evFinal?.status}`);
      check("claimId final ainda é o de B", evFinal?.claimId === claimIdAfterB, `claimId=${evFinal?.claimId}`);
      check("errorCode continua null (nenhum erro de A foi gravado por cima)", evFinal?.errorCode === null, `errorCode=${evFinal?.errorCode}`);
    }

    // ---- 10. Limite de tentativas → dead_letter ----
    console.log("\n--- 10. Limite de tentativas → dead_letter ---");
    const msgIdDead = "wamid.DEDUP_DEADLETTER_" + run;
    const phoneDead = "551199" + String(run).slice(-6);
    {
      const raw = metaPayload(msgIdDead, phoneDead, "__WA_TEST_FORCE_FAILURE__");
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const res = await postMeta(raw);
        check(`Tentativa ${attempt}/${MAX_ATTEMPTS}: 500`, res.status === 500, `status=${res.status}`);
        await sleep(300);
      }
      const evAfterMax = (await eventRef(msgIdDead).get()).data();
      check(`Depois de ${MAX_ATTEMPTS} falhas: status='dead_letter'`, evAfterMax?.status === "dead_letter", `status=${evAfterMax?.status}`);
      check("attempts no limite", evAfterMax?.attempts === MAX_ATTEMPTS, `attempts=${evAfterMax?.attempts}`);
      check("deadLetteredAt presente", !!evAfterMax?.deadLetteredAt);

      // Mais uma entrega — mesmo com um payload que teria sucesso — NÃO
      // deve ser reclamada nem produzir nenhum efeito.
      const rawWouldSucceed = metaPayload(msgIdDead, phoneDead, "Isto não deveria nunca ser processado");
      const resExtra = await postMeta(rawWouldSucceed);
      check("Entrega extra sobre dead_letter: 200 (só ack, sem reclamar)", resExtra.status === 200, `status=${resExtra.status}`);
      await sleep(300);
      const evUnchanged = (await eventRef(msgIdDead).get()).data();
      check("Continua 'dead_letter', attempts não mudou", evUnchanged?.status === "dead_letter" && evUnchanged?.attempts === MAX_ATTEMPTS, `status=${evUnchanged?.status} attempts=${evUnchanged?.attempts}`);
      const msgSnap = await adminDb.doc(`clinics/${CLINIC}/whatsapp_conversations/${phoneDead}/messages/${msgIdDead}`).get();
      check("Nenhum efeito foi executado (nenhuma mensagem gravada, em nenhuma tentativa)", !msgSnap.exists);
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
