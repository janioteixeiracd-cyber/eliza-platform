/**
 * Testa RealWhatsAppGraphClient (src/lib/whatsappGraphClient.ts) — a MESMA
 * classe que o servidor real usa em produção quando
 * WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS não está setado — importada
 * diretamente, com `global.fetch` substituído por um stub controlável.
 * Nunca faz uma chamada de rede de verdade, nunca contra a Meta real.
 *
 * Pedido explícito da rodada: testes para
 *   1. Ausência de META_APP_ID (exchangeCodeForToken nunca chega a fazer fetch).
 *   2. Troca de code bem-sucedida mockada.
 *   3. Descoberta de WABA (via debug_token.granular_scopes).
 *   4. Descoberta de Phone Number ID (via GET /{waba}/phone_numbers).
 *   5. Múltiplas WABAs/phones ambíguas → fail-closed (nunca escolhe uma).
 *   6. Confirmação de coexistência (is_on_biz_app=true + platform_type=CLOUD_API).
 *   7. Ausência de evidência de coexistência → fail-closed (inconclusive/rejected).
 *   8. Erros Graph sanitizados — o corpo bruto da resposta de erro NUNCA
 *      aparece na mensagem da exceção lançada.
 *   9. Nenhum segredo/PII nos logs — captura console.* durante todas as
 *      chamadas ao cliente real e confirma que nada sensível (app secret,
 *      token, code, telefone) aparece.
 *  10. sendMessage — hardening pós-diagnóstico (substitui o fetch inline
 *      v21.0 hardcoded que server.ts's sendViaMeta fazia direto): URL usa
 *      v26.0 e o endpoint /{phoneNumberId}/messages; payload/header
 *      corretos; sucesso extrai messages[0].id e contacts[0].wa_id;
 *      falha (status != 2xx, ou messages[0].id ausente) lança sem nunca
 *      vazar o corpo bruto da resposta na mensagem da exceção.
 *
 * Run with:
 *   node node_modules/tsx/dist/cli.mjs scripts/verifyWhatsAppRealGraphClient.mjs
 */
import { RealWhatsAppGraphClient } from "../src/lib/whatsappGraphClient.ts";

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

const FAKE_APP_ID = "test-app-id-999888777";
const FAKE_APP_SECRET = "test-app-secret-sigiloso-abc123xyz";
const FAKE_CODE = "test-oauth-code-sigiloso-def456";
const FAKE_TOKEN = "test-access-token-sigiloso-ghi789";
const FAKE_PHONE_DISPLAY = "+55 11 99999-0000"; // "PII" de teste — nunca deve vazar no log
const RAW_ERROR_MARKER_SEND = "SEGREDO_DO_CORPO_DE_ERRO_DE_ENVIO_NUNCA_DEVE_VAZAR_7e2b";

// Captura console.* SÓ durante a chamada ao cliente real (nunca durante os
// próprios `check()`/logs deste script, que continuam imprimindo
// normalmente) — junta tudo num buffer global pra checagem final.
const capturedLogs = [];
async function callCapturingConsole(fn) {
  const realLog = console.log, realWarn = console.warn, realError = console.error;
  const wrap = () => (...args) => { capturedLogs.push(args.map(String).join(" ")); };
  console.log = wrap(); console.warn = wrap(); console.error = wrap();
  try {
    return await fn();
  } finally {
    console.log = realLog; console.warn = realWarn; console.error = realError;
  }
}
async function callCapturingConsoleExpectThrow(fn) {
  try {
    await callCapturingConsole(fn);
    return null;
  } catch (e) {
    return e;
  }
}

// --- fetch stub ---------------------------------------------------------
let fetchScript = null; // função (url, opts) => Response-like
function installFetchStub(scriptFn) { fetchScript = scriptFn; }
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
global.fetch = async (url, opts) => {
  if (!fetchScript) throw new Error("no fetch stub installed for this test");
  return fetchScript(String(url), opts);
};

async function main() {
  const client = new RealWhatsAppGraphClient();

  // ---- 1. Ausência de META_APP_ID ----
  console.log("--- 1. Ausência de META_APP_ID ---");
  {
    delete process.env.META_APP_ID;
    process.env.META_APP_SECRET = FAKE_APP_SECRET;
    let fetchCalled = false;
    installFetchStub(() => { fetchCalled = true; throw new Error("fetch should never be called"); });
    const threw = await callCapturingConsoleExpectThrow(() => client.exchangeCodeForToken(FAKE_CODE));
    check("Lança sem chamar fetch (nunca tenta a rede sem credenciais)", threw?.message === "meta_app_credentials_not_configured" && !fetchCalled, `msg=${threw?.message} fetchCalled=${fetchCalled}`);
  }

  process.env.META_APP_ID = FAKE_APP_ID;
  process.env.META_APP_SECRET = FAKE_APP_SECRET;

  // ---- 2. Troca de code bem-sucedida mockada ----
  console.log("\n--- 2. Troca de code bem-sucedida (fetch mockado) ---");
  {
    const seenUrls = [];
    installFetchStub((url) => {
      seenUrls.push(url);
      return jsonResponse(200, { access_token: FAKE_TOKEN, expires_in: 5184000 });
    });
    const result = await callCapturingConsole(() => client.exchangeCodeForToken(FAKE_CODE));
    check("URL usa a versão corrigida (v26.0) e endpoint oauth/access_token", seenUrls[0]?.includes("/v26.0/oauth/access_token"), seenUrls[0]);
    check("URL contém client_id/client_secret/code", seenUrls[0]?.includes(encodeURIComponent(FAKE_APP_ID)) && seenUrls[0]?.includes(encodeURIComponent(FAKE_APP_SECRET)) && seenUrls[0]?.includes(encodeURIComponent(FAKE_CODE)));
    check("accessToken retornado corretamente", result.accessToken === FAKE_TOKEN);
    check("expiresIn retornado corretamente", result.expiresIn === 5184000);
  }

  // ---- 3+4. Descoberta de WABA e Phone Number ID ----
  console.log("\n--- 3+4. Descoberta de WABA e Phone Number ID ---");
  {
    const seenUrls = [];
    installFetchStub((url) => {
      seenUrls.push(url);
      if (url.includes("/debug_token")) {
        return jsonResponse(200, {
          data: {
            app_id: FAKE_APP_ID, is_valid: true, user_id: "999",
            granular_scopes: [
              { scope: "whatsapp_business_management", target_ids: ["waba-real-123"] },
              { scope: "whatsapp_business_messaging", target_ids: ["waba-real-123"] },
            ],
          },
        });
      }
      if (url.includes("/phone_numbers")) {
        return jsonResponse(200, { data: [{ id: "phone-real-456", display_phone_number: FAKE_PHONE_DISPLAY, verified_name: "Clínica Real Teste" }] });
      }
      throw new Error("unexpected URL: " + url);
    });
    const discovery = await callCapturingConsole(() => client.discoverPhoneAndWaba(FAKE_TOKEN));
    const debugUrl = seenUrls.find((u) => u.includes("/debug_token"));
    const phonesUrl = seenUrls.find((u) => u.includes("/phone_numbers"));
    check("debug_token usa input_token+access_token de app", debugUrl?.includes(`input_token=${encodeURIComponent(FAKE_TOKEN)}`) && debugUrl?.includes(encodeURIComponent(`${FAKE_APP_ID}|${FAKE_APP_SECRET}`)));
    check("phone_numbers consultado na WABA confirmada pelo debug_token", phonesUrl?.includes("/waba-real-123/phone_numbers"));
    check("wabaId descoberto via granular_scopes (nunca do frontend)", discovery.wabaId === "waba-real-123");
    check("phoneNumberId descoberto via /phone_numbers (nunca do frontend)", discovery.phoneNumberId === "phone-real-456");
    check("businessName/displayPhoneNumber vieram da resposta real", discovery.businessName === "Clínica Real Teste" && discovery.displayPhoneNumber === FAKE_PHONE_DISPLAY);
  }

  // ---- 5. Múltiplas WABAs/phones ambíguas -> fail-closed ----
  console.log("\n--- 5. Ambiguidade -> fail-closed ---");
  {
    installFetchStub((url) => {
      if (url.includes("/debug_token")) {
        return jsonResponse(200, {
          data: { app_id: FAKE_APP_ID, is_valid: true, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["waba-a", "waba-b"] }] },
        });
      }
      throw new Error("phone_numbers should never be reached when WABA is ambiguous");
    });
    const threw = await callCapturingConsoleExpectThrow(() => client.discoverPhoneAndWaba(FAKE_TOKEN));
    check("2 WABAs autorizadas -> lança, nunca escolhe uma", threw?.message?.startsWith("graph_waba_discovery_ambiguous_2"), threw?.message);
  }
  {
    installFetchStub((url) => {
      if (url.includes("/debug_token")) {
        return jsonResponse(200, {
          data: { app_id: FAKE_APP_ID, is_valid: true, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["waba-solo"] }] },
        });
      }
      if (url.includes("/phone_numbers")) {
        return jsonResponse(200, { data: [{ id: "phone-1", display_phone_number: "x" }, { id: "phone-2", display_phone_number: "y" }] });
      }
      throw new Error("unexpected URL: " + url);
    });
    const threw = await callCapturingConsoleExpectThrow(() => client.discoverPhoneAndWaba(FAKE_TOKEN));
    check("2 phone numbers sob a mesma WABA -> lança, nunca escolhe um", threw?.message?.startsWith("graph_phone_discovery_ambiguous_2"), threw?.message);
  }
  {
    installFetchStub((url) => {
      if (url.includes("/debug_token")) {
        return jsonResponse(200, { data: { app_id: FAKE_APP_ID, is_valid: true, granular_scopes: [] } });
      }
      throw new Error("phone_numbers should never be reached when no WABA is authorized");
    });
    const threw = await callCapturingConsoleExpectThrow(() => client.discoverPhoneAndWaba(FAKE_TOKEN));
    check("Zero WABAs autorizadas -> lança", threw?.message?.startsWith("graph_waba_discovery_ambiguous_0"), threw?.message);
  }
  {
    // Token válido mas emitido pra OUTRO app -- nunca aceito.
    installFetchStub((url) => {
      if (url.includes("/debug_token")) {
        return jsonResponse(200, { data: { app_id: "outro-app-diferente", is_valid: true, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["waba-x"] }] } });
      }
      throw new Error("should never reach phone_numbers");
    });
    const threw = await callCapturingConsoleExpectThrow(() => client.discoverPhoneAndWaba(FAKE_TOKEN));
    check("Token de outro app -> rejeitado, nunca aceito", threw?.message === "graph_debug_token_invalid_or_wrong_app", threw?.message);
  }

  // ---- 6. Confirmação de coexistência ----
  console.log("\n--- 6. Confirmação de coexistência ---");
  {
    const seenUrls = [];
    installFetchStub((url) => {
      seenUrls.push(url);
      return jsonResponse(200, { is_on_biz_app: true, platform_type: "CLOUD_API", id: "phone-real-456" });
    });
    const result = await callCapturingConsole(() => client.verifyCoexistence(FAKE_TOKEN, "phone-real-456"));
    check("Endpoint correto (fields=is_on_biz_app,platform_type)", seenUrls[0]?.includes("/phone-real-456?fields=is_on_biz_app%2Cplatform_type") || seenUrls[0]?.includes("fields=is_on_biz_app,platform_type"), seenUrls[0]);
    check("verification='confirmed'", result.verification === "confirmed");
    check("evidence é só o código controlado, nunca a resposta bruta", JSON.stringify(result.evidence) === JSON.stringify(["PLATFORM_TYPE_COEXISTENCE"]));
  }

  // ---- 7. Ausência de evidência -> fail-closed ----
  console.log("\n--- 7. Ausência de evidência de coexistência -> fail-closed ---");
  {
    installFetchStub(() => jsonResponse(200, { is_on_biz_app: false, platform_type: "CLOUD_API", id: "phone-real-456" }));
    const result = await callCapturingConsole(() => client.verifyCoexistence(FAKE_TOKEN, "phone-real-456"));
    check("Migrado (cloud-only) -> 'rejected', nunca 'confirmed'", result.verification === "rejected");
  }
  {
    installFetchStub(() => jsonResponse(200, { id: "phone-real-456" })); // campos ausentes
    const result = await callCapturingConsole(() => client.verifyCoexistence(FAKE_TOKEN, "phone-real-456"));
    check("Campos ausentes -> 'inconclusive', nunca 'confirmed' por suposição", result.verification === "inconclusive");
  }
  {
    installFetchStub(() => jsonResponse(200, { is_on_biz_app: true, platform_type: "SOME_UNDOCUMENTED_VALUE" }));
    const result = await callCapturingConsole(() => client.verifyCoexistence(FAKE_TOKEN, "phone-real-456"));
    check("platform_type não documentado -> 'inconclusive', nunca presumido", result.verification === "inconclusive");
  }

  // ---- 8. Erros Graph sanitizados ----
  console.log("\n--- 8. Erros Graph sanitizados (corpo bruto nunca na mensagem) ---");
  const RAW_ERROR_MARKER = "SEGREDO_DO_CORPO_DE_ERRO_NUNCA_DEVE_VAZAR_9f3a";
  {
    installFetchStub(() => jsonResponse(400, { error: { message: RAW_ERROR_MARKER, type: "OAuthException", code: 190 } }));
    const threw = await callCapturingConsoleExpectThrow(() => client.exchangeCodeForToken(FAKE_CODE));
    check("Exchange 400: lança, mensagem NUNCA contém o corpo bruto do erro", threw && !threw.message.includes(RAW_ERROR_MARKER), threw?.message);
    check("Mensagem só carrega o status HTTP", threw?.message === "graph_token_exchange_failed_400", threw?.message);
  }
  {
    installFetchStub((url) => url.includes("/debug_token") ? jsonResponse(401, { error: { message: RAW_ERROR_MARKER } }) : jsonResponse(200, {}));
    const threw = await callCapturingConsoleExpectThrow(() => client.discoverPhoneAndWaba(FAKE_TOKEN));
    check("debug_token 401: mensagem NUNCA contém o corpo bruto", threw && !threw.message.includes(RAW_ERROR_MARKER), threw?.message);
  }
  {
    installFetchStub(() => jsonResponse(500, { error: { message: RAW_ERROR_MARKER } }));
    const threw = await callCapturingConsoleExpectThrow(() => client.verifyCoexistence(FAKE_TOKEN, "phone-real-456"));
    check("verifyCoexistence 500: mensagem NUNCA contém o corpo bruto", threw && !threw.message.includes(RAW_ERROR_MARKER), threw?.message);
  }

  // ---- 10. sendMessage ----
  console.log("\n--- 10. sendMessage (hardening: v26.0, nunca v21.0) ---");
  const FAKE_PHONE_NUMBER_ID = "phone-num-id-real-789";
  const FAKE_RECIPIENT = "5511988887777";
  {
    const seenUrls = [];
    const seenOpts = [];
    installFetchStub((url, opts) => {
      seenUrls.push(url);
      seenOpts.push(opts);
      return jsonResponse(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: FAKE_RECIPIENT, wa_id: FAKE_RECIPIENT }],
        messages: [{ id: "wamid.TEST_REAL_123" }],
      });
    });
    const result = await callCapturingConsole(() => client.sendMessage(FAKE_PHONE_NUMBER_ID, FAKE_TOKEN, FAKE_RECIPIENT, "Mensagem de teste"));
    check("URL usa v26.0 (nunca v21.0 hardcoded)", seenUrls[0]?.includes("/v26.0/") && !seenUrls[0]?.includes("/v21.0/"), seenUrls[0]);
    check("URL usa /{phoneNumberId}/messages", seenUrls[0]?.includes(`/${FAKE_PHONE_NUMBER_ID}/messages`), seenUrls[0]);
    check("Método POST", seenOpts[0]?.method === "POST");
    check("Authorization: Bearer <token>", seenOpts[0]?.headers?.Authorization === `Bearer ${FAKE_TOKEN}`);
    const body = JSON.parse(seenOpts[0]?.body || "{}");
    check("Payload messaging_product/type/text corretos", body.messaging_product === "whatsapp" && body.type === "text" && body.text?.body === "Mensagem de teste" && body.to === FAKE_RECIPIENT);
    check("providerMessageId extraído de messages[0].id", result.providerMessageId === "wamid.TEST_REAL_123");
    check("waId extraído de contacts[0].wa_id (campo estruturado, nunca o corpo bruto)", result.waId === FAKE_RECIPIENT);
  }
  {
    installFetchStub(() => jsonResponse(403, { error: { message: RAW_ERROR_MARKER_SEND, code: 10 } }));
    const threw = await callCapturingConsoleExpectThrow(() => client.sendMessage(FAKE_PHONE_NUMBER_ID, FAKE_TOKEN, FAKE_RECIPIENT, "x"));
    check("Falha HTTP: lança, mensagem nunca contém o corpo bruto do erro", threw && !threw.message.includes(RAW_ERROR_MARKER_SEND), threw?.message);
    check("Mensagem só carrega o status HTTP", threw?.message === "graph_send_message_failed_403", threw?.message);
  }
  {
    installFetchStub(() => jsonResponse(200, { messaging_product: "whatsapp", contacts: [] })); // sem messages[0].id
    const threw = await callCapturingConsoleExpectThrow(() => client.sendMessage(FAKE_PHONE_NUMBER_ID, FAKE_TOKEN, FAKE_RECIPIENT, "x"));
    check("200 sem messages[0].id -> lança, nunca finge sucesso", threw?.message === "graph_send_message_missing_id", threw?.message);
  }

  // ---- 9. Nenhum segredo/PII nos logs ----
  console.log("\n--- 9. Nenhum segredo/PII apareceu em console.* durante os testes acima ---");
  check("RealWhatsAppGraphClient nunca chama console.* (nenhuma linha capturada)", capturedLogs.length === 0, `capturedLogs=${JSON.stringify(capturedLogs)}`);
  // Defesa em profundidade: mesmo que uma linha aparecesse, nunca poderia
  // conter os segredos/PII de teste.
  const joined = capturedLogs.join(" ");
  check("Nenhum log contém o app secret de teste", !joined.includes(FAKE_APP_SECRET));
  check("Nenhum log contém o token de teste", !joined.includes(FAKE_TOKEN));
  check("Nenhum log contém o code de teste", !joined.includes(FAKE_CODE));
  check("Nenhum log contém o telefone de teste", !joined.includes(FAKE_PHONE_DISPLAY));
  check("Nenhum log contém o destinatário de teste do sendMessage", !joined.includes(FAKE_RECIPIENT));
  check("Nenhum log contém o corpo bruto de erro do sendMessage", !joined.includes(RAW_ERROR_MARKER_SEND));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
