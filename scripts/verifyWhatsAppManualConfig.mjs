/**
 * Prova, contra o server.ts real (via tsx) rodando contra o emulador, os
 * 3 endpoints novos da rodada final de fechamento que substituem os
 * setDoc/deleteDoc diretos que existiam em NextAdmin.tsx e
 * WhatsAppSettings.tsx: GET/POST /api/whatsapp/manual-config e
 * POST /api/whatsapp/manual-disconnect.
 *
 * Cenários:
 *   1. Gate explícito owner||admin — membro comum recebe 403 nos 3
 *      endpoints; owner e admin (role='admin') recebem 200.
 *   2. GET numa clínica sem integração: defaults sensatos, nunca lança.
 *   3. POST salva de verdade (Meta) — status vira 'conectado' só quando
 *      phoneNumberId+wabaId+accessToken presentes; whatsapp_status
 *      (sanitizado) é atualizado no mesmo POST; GET seguinte reflete
 *      hasAccessToken=true, nunca o valor cru do token.
 *   4. Token mascarado ("••••") no POST preserva o valor já salvo — não
 *      sobrescreve com a máscara literal.
 *   5. POST manual-disconnect apaga a integração e reseta whatsapp_status
 *      pra 'não conectado'.
 *   6. Escrita direta via Client SDK continua negada pela regra (mesma
 *      prova já feita em verifyWhatsAppEmbeddedSignupRules.mjs, reconfirmada
 *      aqui no contexto específico deste fluxo).
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyWhatsAppManualConfig.mjs
 */
import { spawn } from "child_process";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore as getClientFirestore, connectFirestoreEmulator, doc as clientDoc, setDoc as clientSetDoc } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

const PROJECT_ID = "elisa-494703";
const BASE_URL = "http://127.0.0.1:3000";
const CLINIC = "wh-test-clinic-manualcfg";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = admin.firestore();

const apps = [];
async function clientAs(email) {
  const app = initializeApp(firebaseConfig, `WAMC_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
  const clientDb = getClientFirestore(app);
  try { connectFirestoreEmulator(clientDb, "127.0.0.1", 8080); } catch { /* already connected in this process */ }
  return { uid: user.uid, idToken, clientDb };
}

async function getConfig(idToken) {
  return fetch(`${BASE_URL}/api/whatsapp/manual-config?clinicId=${CLINIC}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
}
async function postConfig(idToken, body) {
  return fetch(`${BASE_URL}/api/whatsapp/manual-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ clinicId: CLINIC, ...body }),
  });
}
async function postDisconnect(idToken) {
  return fetch(`${BASE_URL}/api/whatsapp/manual-disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ clinicId: CLINIC }),
  });
}
// Hardening (rodada de correção pré-teste-real): manual-config agora sobe
// o token como nova versão do secret `eliza-wa-token-{clinicId}` — o mock
// (WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS=1) espelha o cliente real e também
// falha com "secret_not_provisioned" se o secret nunca foi provisionado
// antes por um caminho administrativo separado. Este endpoint test-only
// (só existe com o mock ligado) simula esse provisionamento — mesmo
// mecanismo já usado pelos testes de /exchange.
async function provisionSecret(clinicId) {
  const res = await fetch(`${BASE_URL}/api/whatsapp/embedded-signup/_test-only/provision-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinicId }),
  });
  if (!res.ok) throw new Error(`provisionSecret failed: ${res.status}`);
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

async function main() {
  console.log("=== Seeding clinic/members fixtures ===");
  const owner = await clientAs("wamc.owner@verify.local");
  const adminMember = await clientAs("wamc.admin@verify.local");
  const regular = await clientAs("wamc.regular@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Teste Manual Config", ownerId: owner.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${owner.uid}`).set({ role: "owner", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/members/${adminMember.uid}`).set({ role: "admin", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/members/${regular.uid}`).set({ role: "member", status: "active", active: true });
  await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).delete().catch(() => {});
  await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).delete().catch(() => {});
  console.log("=== Fixtures ready ===\n");

  console.log("=== Booting real server.ts against the emulator ===");
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
    // ---- 1. Gate explícito owner||admin ----
    console.log("--- 1. Gate owner||admin ---");
    {
      const resGet = await getConfig(regular.idToken);
      check("Membro comum: GET manual-config 403", resGet.status === 403, `status=${resGet.status}`);
      const resPost = await postConfig(regular.idToken, { provider: "meta" });
      check("Membro comum: POST manual-config 403", resPost.status === 403, `status=${resPost.status}`);
      const resDisc = await postDisconnect(regular.idToken);
      check("Membro comum: POST manual-disconnect 403", resDisc.status === 403, `status=${resDisc.status}`);
      const resNoAuth = await getConfig(null);
      check("Sem token: GET manual-config 401", resNoAuth.status === 401, `status=${resNoAuth.status}`);

      const resOwnerGet = await getConfig(owner.idToken);
      check("Owner: GET manual-config 200", resOwnerGet.status === 200, `status=${resOwnerGet.status}`);
      const resAdminGet = await getConfig(adminMember.idToken);
      check("Admin (role='admin'): GET manual-config 200", resAdminGet.status === 200, `status=${resAdminGet.status}`);
    }

    // ---- 2. GET numa clínica sem integração ----
    console.log("\n--- 2. GET sem integração existente ---");
    {
      const res = await getConfig(owner.idToken);
      const body = await res.json();
      check("status default 'não conectado'", body.status === "não conectado", `status=${body.status}`);
      check("hasAccessToken=false", body.hasAccessToken === false);
      check("provider default 'meta'", body.provider === "meta");
      check("Nunca lança/quebra mesmo sem doc nenhum", res.status === 200);
    }

    // ---- 3. POST salva de verdade ----
    console.log("\n--- 3. POST salva de verdade (Meta) ---");
    const RAW_TOKEN_1 = "raw-token-value-abc123-NUNCA-deve-aparecer-no-Firestore";
    {
      // Secret precisa existir (provisionado administrativamente) ANTES —
      // mesma disciplina fail-closed do /exchange (Seção 8 do plano).
      await provisionSecret(CLINIC);

      const res = await postConfig(owner.idToken, {
        provider: "meta",
        phoneNumberId: "manual-phone-1",
        wabaId: "manual-waba-1",
        businessName: "Clínica Teste",
        displayPhoneNumber: "5511999990000",
        accessToken: RAW_TOKEN_1,
        aiEnabled: true,
        humanApprovalRequired: false,
      });
      check("POST 200", res.status === 200, `status=${res.status}`);
      const body = await res.json();
      check("status='conectado' no corpo (todos os campos requeridos presentes)", body.status === "conectado", `status=${body.status}`);

      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      const integration = integrationSnap.data();
      check("Doc completo gravado com status conectado", integration?.status === "conectado");
      check("phoneNumberId gravado", integration?.phoneNumberId === "manual-phone-1");
      check("connectionMethod='manual'", integration?.connectionMethod === "manual");

      // Hardening: só referência + versão do secret, nunca o valor.
      check("accessTokenSecretName é a REFERÊNCIA do secret (eliza-wa-token-{clinicId}), nunca o token", integration?.accessTokenSecretName === `eliza-wa-token-${CLINIC}`, `accessTokenSecretName=${integration?.accessTokenSecretName}`);
      check("accessTokenSecretVersion é um número de versão explícito (nunca 'latest', nunca vazio)", typeof integration?.accessTokenSecretVersion === "string" && integration.accessTokenSecretVersion !== "latest" && integration.accessTokenSecretVersion.length > 0, `accessTokenSecretVersion=${integration?.accessTokenSecretVersion}`);
      check("O token BRUTO nunca aparece em nenhum campo do doc salvo", JSON.stringify(integration).includes(RAW_TOKEN_1) === false, `doc=${JSON.stringify(integration)}`);

      const statusSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).get();
      const statusDoc = statusSnap.data();
      check("whatsapp_status também atualizado no mesmo POST", statusDoc?.status === "conectado" && statusDoc?.displayPhoneNumber === "5511999990000", `data=${JSON.stringify(statusDoc)}`);
      check("whatsapp_status (sanitizado) também nunca contém o token bruto", JSON.stringify(statusDoc).includes(RAW_TOKEN_1) === false);

      const getRes = await getConfig(owner.idToken);
      const getBody = await getRes.json();
      check("GET seguinte reflete hasAccessToken=true", getBody.hasAccessToken === true);
      check("GET NUNCA devolve o valor cru do token", JSON.stringify(getBody).includes(RAW_TOKEN_1) === false, `body=${JSON.stringify(getBody)}`);
    }

    // ---- 3b. POST com token real mas secret NÃO provisionado -> fail-closed ----
    console.log("\n--- 3b. Secret não provisionado -> fail-closed, nunca grava bruto ---");
    {
      const OTHER_CLINIC = "wh-test-clinic-manualcfg-unprovisioned";
      await adminDb.doc(`clinics/${OTHER_CLINIC}`).set({ name: "Clínica sem secret provisionado", ownerId: owner.uid });
      await adminDb.doc(`clinics/${OTHER_CLINIC}/members/${owner.uid}`).set({ role: "owner", status: "active", active: true });
      const res = await fetch(`${BASE_URL}/api/whatsapp/manual-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.idToken}` },
        body: JSON.stringify({ clinicId: OTHER_CLINIC, provider: "meta", phoneNumberId: "x", wabaId: "y", accessToken: "outro-token-bruto-nunca-deve-ficar-em-lugar-nenhum" }),
      });
      check("Secret nunca provisionado -> POST falha explicitamente (nunca 200 com estado inconsistente)", res.status === 500, `status=${res.status}`);
      const snap = await adminDb.doc(`clinics/${OTHER_CLINIC}/integrations/whatsapp`).get();
      check("Nenhum doc de integração criado quando a versão do secret falha", !snap.exists);
    }

    // ---- 4. Token mascarado preserva valor existente ----
    console.log("\n--- 4. Token mascarado (\"••••\") preserva valor salvo ---");
    {
      const beforeSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      const versionBefore = beforeSnap.data()?.accessTokenSecretVersion;

      const res = await postConfig(owner.idToken, {
        provider: "meta",
        phoneNumberId: "manual-phone-1",
        wabaId: "manual-waba-1",
        businessName: "Clínica Teste Renomeada",
        displayPhoneNumber: "5511999990000",
        accessToken: "••••••••••••••••••••••••••••••••",
      });
      check("POST 200 mesmo com token mascarado", res.status === 200, `status=${res.status}`);
      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      const integration = integrationSnap.data();
      check("Referência do secret preservada (não sobrescrita pela máscara)", integration?.accessTokenSecretName === `eliza-wa-token-${CLINIC}`, `accessTokenSecretName=${integration?.accessTokenSecretName}`);
      check("Versão do secret preservada — máscara nunca sobe uma versão nova no Secret Manager", integration?.accessTokenSecretVersion === versionBefore, `versionBefore=${versionBefore} versionAfter=${integration?.accessTokenSecretVersion}`);
      check("Outros campos (businessName) atualizaram normalmente", integration?.businessName === "Clínica Teste Renomeada");
    }

    // ---- 5. Disconnect ----
    console.log("\n--- 5. POST manual-disconnect ---");
    {
      const res = await postDisconnect(owner.idToken);
      check("Disconnect 200", res.status === 200, `status=${res.status}`);
      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Doc completo apagado", !integrationSnap.exists);
      const statusSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).get();
      check("whatsapp_status resetado pra 'não conectado'", statusSnap.data()?.status === "não conectado", `data=${JSON.stringify(statusSnap.data())}`);
    }

    // ---- 6. Escrita direta via Client SDK continua negada ----
    console.log("\n--- 6. Escrita direta via Client SDK (owner) continua negada ---");
    {
      let denied = false;
      try {
        await clientSetDoc(clientDoc(owner.clientDb, "clinics", CLINIC, "integrations", "whatsapp"), { status: "conectado" }, { merge: true });
      } catch (err) {
        denied = err?.code === "permission-denied";
      }
      check("setDoc direto negado mesmo pro owner (só Admin SDK grava)", denied);
    }

    // ---- 7. Admin (role='admin', NÃO owner) também consegue salvar e
    // desconectar de verdade — pedido explícito da revisão: as rodadas
    // anteriores só provavam GET pro admin (cenário 1); POST/disconnect só
    // tinham sido exercitados pelo owner. Reusa a mesma clínica, já
    // desconectada pelo cenário 5 acima.
    console.log("\n--- 7. Admin (role='admin') salva e desconecta de verdade ---");
    {
      const RAW_TOKEN_ADMIN = "raw-token-value-admin-xyz-NUNCA-deve-aparecer-no-Firestore";
      const res = await postConfig(adminMember.idToken, {
        provider: "meta",
        phoneNumberId: "manual-phone-admin",
        wabaId: "manual-waba-admin",
        businessName: "Clínica Teste (via admin)",
        displayPhoneNumber: "5511988880000",
        accessToken: RAW_TOKEN_ADMIN,
      });
      check("Admin: POST manual-config 200", res.status === 200, `status=${res.status}`);
      const integrationSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Admin: doc completo gravado de verdade (status conectado)", integrationSnap.data()?.status === "conectado", `data=${JSON.stringify(integrationSnap.data())}`);
      check("Admin: phoneNumberId gravado corretamente", integrationSnap.data()?.phoneNumberId === "manual-phone-admin");
      check("Admin: token bruto nunca gravado (só referência+versão do secret)", JSON.stringify(integrationSnap.data()).includes(RAW_TOKEN_ADMIN) === false);

      const statusSnap = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).get();
      check("Admin: whatsapp_status também atualizado", statusSnap.data()?.status === "conectado" && statusSnap.data()?.displayPhoneNumber === "5511988880000");

      const discRes = await postDisconnect(adminMember.idToken);
      check("Admin: POST manual-disconnect 200", discRes.status === 200, `status=${discRes.status}`);
      const afterDisc = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp`).get();
      check("Admin: doc completo apagado de verdade", !afterDisc.exists);
      const statusAfterDisc = await adminDb.doc(`clinics/${CLINIC}/integrations/whatsapp_status`).get();
      check("Admin: whatsapp_status resetado pra 'não conectado'", statusAfterDisc.data()?.status === "não conectado");
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
