/**
 * Meta Graph API client for WhatsApp Embedded Signup (Coexistence) — code
 * exchange, WABA/phone discovery, Coexistence verification, envio de
 * mensagem, e a sequência de inscrição de webhook da WABA (plano
 * vast-yawning-hamster.md v4, Seções 7 e 9).
 *
 * "Chamadas reais à Graph API" (fora deste código, contra a Meta de
 * verdade) continuam proibidas nesta rodada -- só implementação e
 * documentação. exchangeCodeForToken/getWabaSubscriptionStatus/
 * subscribeWaba/confirmWabaSubscription/unsubscribeWaba já existiam;
 * discoverPhoneAndWaba/verifyCoexistence foram implementados numa rodada
 * anterior; sendMessage foi adicionado nesta rodada de hardening pra
 * substituir o fetch inline que server.ts's sendViaMeta fazia direto
 * (v21.0 hardcoded, token lido bruto do Firestore) — agora centralizado
 * aqui, na mesma constante de versão (v26.0) que todo o resto do arquivo
 * usa, com o token sempre resolvido pelo chamador via Secret Manager.
 * Nenhum método deste arquivo foi exercitado contra a Meta real ainda --
 * só testado com fetch mockado (scripts/verifyWhatsAppRealGraphClient.mjs)
 * e contra MockWhatsAppGraphClient (todo o resto da suíte).
 *
 * FONTES OFICIAIS consultadas nesta rodada pra discoverPhoneAndWaba/
 * verifyCoexistence (nunca adivinhadas):
 *   - developers.facebook.com/docs/graph-api/reference/debug_token/ —
 *     `GET /{version}/debug_token?input_token=...`, `access_token` de
 *     app (`{app_id}|{app_secret}`), campo `data.granular_scopes:
 *     [{scope, target_ids}]`.
 *   - developers.facebook.com/documentation/business-messaging/whatsapp/
 *     embedded-signup/onboarding-business-app-users/ — confirmação de
 *     Coexistence via `GET /{version}/{phone-number-id}?fields=
 *     is_on_biz_app,platform_type`. Citação oficial: "If `is_on_biz_app`
 *     is `true` and `platform_type` is `CLOUD_API`, the business phone
 *     number is able to use Cloud API and the WhatsApp Business app" —
 *     a ÚNICA combinação documentada como confirmação positiva; qualquer
 *     outra vira não-confirmada (fail-closed), nunca "provavelmente sim".
 *   - developers.facebook.com/documentation/business-messaging/whatsapp/
 *     business-phone-numbers/phone-numbers — `GET /{version}/{waba-id}/
 *     phone_numbers` lista os números sob uma WABA.
 *
 * OAuth `code` is single-use, mirroring Meta's real behavior: once
 * exchangeCodeForToken() succeeds for a given code, the SAME code can
 * never be exchanged again (both implementations enforce this — the real
 * one because Meta's own API will reject the reuse, the mock via an
 * explicit used-codes set). A failed attempt therefore can never "just
 * retry with the same code" — closing an attempt after a failure and
 * requiring a brand-new Embedded Signup (which mints a brand-new code) is
 * the only safe path; see server.ts's failAttempt()/orphaned-version
 * handling for what IS preserved across that boundary (the secret
 * version, marked orphaned — never the code, never the raw token).
 */

// v26.0 -- mesma versao que o teste real do usuario no painel Meta usou
// (webhook messages, 2026-09-02) e a versao usada nos exemplos oficiais
// atuais de debug_token/Coexistence consultados nesta rodada. v21.0
// (valor anterior) estava desatualizada -- corrigida.
const META_GRAPH_API_VERSION = "v26.0";

export interface TokenExchangeResult {
  accessToken: string;
  expiresIn: number; // seconds
}

export interface PhoneWabaDiscovery {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string;
  businessName: string;
}

export type CoexistenceVerificationResult =
  | "confirmed"
  | "inconclusive"
  | "rejected";

// Higiene de esquema (rodada de fencing global): evidence é uma lista de
// CÓDIGOS controlados, nunca a resposta bruta da Graph API — a real
// implementation (abaixo) precisa MAPEAR qualquer campo/enum que a API
// devolver pra um destes códigos antes de gravar em candidateConfig; nunca
// repassar o valor bruto verbatim (poderia conter texto arbitrário
// controlado pelo lado da Meta/negócio, não é algo que queremos persistir
// sem controle no Firestore).
export type CoexistenceEvidenceCode =
  | "PLATFORM_TYPE_COEXISTENCE"
  | "PLATFORM_TYPE_CLOUD_API_ONLY"
  | "PLATFORM_TYPE_ON_PREMISE"
  | "PLATFORM_TYPE_UNKNOWN";

export interface CoexistenceCheck {
  verification: CoexistenceVerificationResult;
  evidence: CoexistenceEvidenceCode[]; // objetivo, citável — nunca "confia em mim", ver plano Seção 7
}

export interface SendMessageResult {
  providerMessageId: string;
  /** contacts[0].wa_id da resposta da Meta — campo estruturado deliberado,
   * nunca o corpo bruto da resposta (que nunca é repassado/logado). */
  waId: string | null;
}

export interface WhatsAppGraphClient {
  exchangeCodeForToken(code: string): Promise<TokenExchangeResult>;
  /** POST /{phoneNumberId}/messages — envio real de mensagem de texto.
   * `accessToken` é sempre resolvido pelo CHAMADOR via Secret Manager
   * (nunca lido daqui) e nunca logado por esta função. */
  sendMessage(phoneNumberId: string, accessToken: string, toPhoneE164: string, text: string): Promise<SendMessageResult>;
  discoverPhoneAndWaba(accessToken: string): Promise<PhoneWabaDiscovery>;
  verifyCoexistence(accessToken: string, phoneNumberId: string): Promise<CoexistenceCheck>;
  /** Pre-check, before deciding whether to POST a new subscription. */
  getWabaSubscriptionStatus(wabaId: string, accessToken: string): Promise<boolean>;
  subscribeWaba(wabaId: string, accessToken: string): Promise<void>;
  /** A SEPARATE GET, called AFTER subscribeWaba() (or after determining the
   * WABA was already subscribed), immediately before the terminal
   * transaction — confirms the subscription is really in place rather than
   * trusting the POST's 2xx alone. Kept as its own method (distinct from
   * getWabaSubscriptionStatus, even though the real Graph API call is the
   * same endpoint) so the calling code's intent — "pre-check" vs.
   * "post-action confirmation" — and each one's failure handling stay
   * independently testable. Returns false (not confirmed — treated the
   * same as an inconclusive response) rather than throwing when the
   * subscription cannot be confirmed; the caller decides what that means. */
  confirmWabaSubscription(wabaId: string, accessToken: string): Promise<boolean>;
  /** DELETE /{wabaId}/subscribed_apps. Rodada final de fechamento: o
   * rollback automático em server.ts NÃO chama mais este método — uma
   * tentativa que falha só REGISTRA a WABA pra limpeza administrativa
   * (recordPendingWabaCleanup), nunca desassina sozinha. Mantido na
   * interface só pra uma futura ferramenta administrativa manual, que
   * deve reconfirmar isWabaSubscriptionStillNeeded no MOMENTO da limpeza
   * (não reusar um snapshot antigo) antes de chamar isto. */
  unsubscribeWaba(wabaId: string, accessToken: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real implementation — unexercised this phase.
// ---------------------------------------------------------------------------

export class RealWhatsAppGraphClient implements WhatsAppGraphClient {
  async exchangeCodeForToken(code: string): Promise<TokenExchangeResult> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error("meta_app_credentials_not_configured");
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`graph_token_exchange_failed_${res.status}`);
    const data = await res.json();
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 60 * 60 * 24 * 60 };
    // Meta itself enforces single-use on `code` — a replayed code fails
    // here with a real error response; no separate tracking needed on our
    // side for the real client.
  }

  // Nunca aceita phoneNumberId/wabaId vindos do frontend (o evento FINISH
  // do client-side é só UX) — os dois são re-derivados aqui, do lado do
  // servidor, perguntando à própria Meta quais ativos este TOKEN
  // realmente autoriza. Fonte oficial: debug_token + granular_scopes
  // (ver cabeçalho do arquivo).
  async discoverPhoneAndWaba(accessToken: string): Promise<PhoneWabaDiscovery> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error("meta_app_credentials_not_configured");

    // Passo 1 — debug_token: nunca confia num wabaId fornecido por
    // ninguém além da própria Meta. `access_token` aqui é o token de APP
    // (`{app_id}|{app_secret}`), usado só pra INSPECIONAR o token do
    // usuário — nunca logado, nunca devolvido.
    const inspectingToken = `${appId}|${appSecret}`;
    const debugUrl = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(inspectingToken)}`;
    const debugRes = await fetch(debugUrl);
    if (!debugRes.ok) throw new Error(`graph_debug_token_failed_${debugRes.status}`);
    const debugBody = await debugRes.json();
    const tokenData = debugBody?.data;
    // Confirma que o token é válido E foi emitido pro NOSSO app — nunca
    // aceita um token de outro app por engano.
    if (!tokenData || tokenData.is_valid !== true || String(tokenData.app_id) !== String(appId)) {
      throw new Error("graph_debug_token_invalid_or_wrong_app");
    }
    const granularScopes: Array<{ scope?: string; target_ids?: Array<string | number> | null }> = Array.isArray(tokenData.granular_scopes) ? tokenData.granular_scopes : [];
    const wabaScope = granularScopes.find((s) => s?.scope === "whatsapp_business_management");
    const wabaIds = (wabaScope?.target_ids || []).map((id) => String(id));
    // Zero WABAs autorizadas (permissão ausente/universal-sem-escopo) OU
    // mais de uma (ambíguo, não dá pra saber qual é "a" desta sessão) —
    // as duas situações são fail-closed, nunca uma suposição.
    if (wabaIds.length !== 1) {
      throw new Error(`graph_waba_discovery_ambiguous_${wabaIds.length}`);
    }
    const wabaId = wabaIds[0];

    // Passo 2 — lista os números de telefone REALMENTE sob essa WABA
    // confirmada (nunca um phoneNumberId fornecido por fora).
    const phonesUrl = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`;
    const phonesRes = await fetch(phonesUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!phonesRes.ok) throw new Error(`graph_phone_discovery_failed_${phonesRes.status}`);
    const phonesBody = await phonesRes.json();
    const phones: Array<{ id?: string; display_phone_number?: string; verified_name?: string }> = Array.isArray(phonesBody?.data) ? phonesBody.data : [];
    // Mesma disciplina fail-closed: zero ou múltiplos números sob a WABA
    // confirmada — nunca escolhe "o primeiro" ou adivinha qual é o
    // número que o admin acabou de conectar nesta sessão específica.
    if (phones.length !== 1 || !phones[0]?.id) {
      throw new Error(`graph_phone_discovery_ambiguous_${phones.length}`);
    }
    const phone = phones[0];

    return {
      phoneNumberId: phone.id!,
      wabaId,
      displayPhoneNumber: phone.display_phone_number || "",
      businessName: phone.verified_name || "",
    };
  }

  // Confirma por evidência objetiva da Meta (nunca "confia em mim") que o
  // número segue disponível pelo WhatsApp Business App ao mesmo tempo que
  // pela Cloud API — exatamente o que Coexistence promete preservar
  // (nunca migra/desregistra o app mobile). Fonte oficial citada no
  // cabeçalho do arquivo: only is_on_biz_app===true &&
  // platform_type==='CLOUD_API' é documentado como confirmação positiva.
  async verifyCoexistence(accessToken: string, phoneNumberId: string): Promise<CoexistenceCheck> {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=is_on_biz_app,platform_type`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`graph_coexistence_check_failed_${res.status}`);
    const body = await res.json();
    const isOnBizApp = body?.is_on_biz_app === true;
    const platformType = typeof body?.platform_type === "string" ? body.platform_type : null;

    if (isOnBizApp && platformType === "CLOUD_API") {
      return { verification: "confirmed", evidence: ["PLATFORM_TYPE_COEXISTENCE"] };
    }
    if (platformType === "CLOUD_API" && !isOnBizApp) {
      // Resultado NEGATIVO conhecido, não uma falta de informação: o
      // número já é Cloud API "puro" (migrado), o app mobile não
      // funciona mais nele — rejeitado explicitamente, nunca
      // "inconclusivo".
      return { verification: "rejected", evidence: ["PLATFORM_TYPE_CLOUD_API_ONLY"] };
    }
    // Qualquer outra combinação (campo ausente, platform_type
    // inesperado/não documentado) — nunca presumida como confirmação ou
    // rejeição; a doc oficial consultada só documenta o caso de sucesso
    // acima, então tudo mais é honestamente "não sei", nunca um "sim"
    // por suposição.
    return { verification: "inconclusive", evidence: ["PLATFORM_TYPE_UNKNOWN"] };
  }

  async getWabaSubscriptionStatus(wabaId: string, accessToken: string): Promise<boolean> {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${wabaId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`graph_subscription_status_failed_${res.status}`);
    const data = await res.json();
    return Array.isArray(data.data) && data.data.length > 0;
  }

  async subscribeWaba(wabaId: string, accessToken: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`graph_subscribe_failed_${res.status}`);
  }

  async confirmWabaSubscription(wabaId: string, accessToken: string): Promise<boolean> {
    try {
      return await this.getWabaSubscriptionStatus(wabaId, accessToken);
    } catch {
      return false; // any error here reads as "not confirmed", never as "confirmed"
    }
  }

  async unsubscribeWaba(wabaId: string, accessToken: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${wabaId}/subscribed_apps`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`graph_unsubscribe_failed_${res.status}`);
  }

  // Hardening pós-diagnóstico: substitui o fetch inline que server.ts's
  // sendViaMeta fazia direto contra v21.0 hardcoded — agora usa a mesma
  // constante de versão centralizada que todo o resto deste arquivo já usa.
  // Nunca loga o accessToken (chega só via header) nem o corpo da resposta
  // — devolve só o dado estruturado mínimo que o chamador precisa.
  async sendMessage(phoneNumberId: string, accessToken: string, toPhoneE164: string, text: string): Promise<SendMessageResult> {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhoneE164,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) throw new Error(`graph_send_message_failed_${res.status}`);
    const data = await res.json();
    const providerMessageId = data?.messages?.[0]?.id;
    if (!providerMessageId) throw new Error("graph_send_message_missing_id");
    const waId = typeof data?.contacts?.[0]?.wa_id === "string" ? data.contacts[0].wa_id : null;
    return { providerMessageId, waId };
  }
}

// ---------------------------------------------------------------------------
// Mock implementation — the ONLY one exercised by tests in this phase.
// Behavior is driven by sentinel substrings in the `code` handed to
// exchangeCodeForToken, mirroring the fault-injection convention already
// used for the webhook tests (scripts/verifyWhatsAppWebhookDedup.mjs) —
// deterministic, no timers/mocking framework needed, and the SAME `code`
// value flows naturally through the real endpoint's control flow into
// every subsequent mock call via the derived accessToken.
//
// wabaId derivation strips a trailing "__U<digits>" uniqueness suffix
// before deriving the id — lets a test simulate "same underlying WABA,
// fresh single-use code each time" (a clinic re-running Embedded Signup
// gets a NEW code from Meta per session, but the same real WABA behind
// it), while exchangeCodeForToken() itself still enforces single-use on
// the FULL code string, matching Meta's real behavior (see file header).
// ---------------------------------------------------------------------------

const MOCK_WABA_SUBSCRIPTION_STATE = new Map<string, boolean>();
const MOCK_USED_CODES = new Set<string>();

function mockPhoneGroup(code: string): string {
  // Symmetric to mockWabaGroup's __WABA_<id>__ marker: an explicit
  // "__PHONE_<id>__" lets a test pin the SAME phoneNumberId across two
  // otherwise-unrelated code strings (e.g. one carrying a test-only
  // sentinel like TEST_SLOW_BEFORE_TERMINAL elsewhere in the string, one
  // not) without the sentinel text itself leaking into the group.
  const forced = code.match(/__PHONE_([A-Za-z0-9]+)__/);
  if (forced) return forced[1];
  return code.replace(/__U\d+$/, "");
}

function mockWabaGroup(code: string): string {
  // A real WABA can have multiple phone numbers under it — an explicit
  // "__WABA_<id>__" marker lets a test force two DIFFERENT phone groups
  // (so their phone_index reservations never collide) to still resolve to
  // the SAME wabaId, modeling that real shape. Without the marker, wabaId
  // falls back to the phone group itself (one phone, one WABA — the
  // common/simple case, and what earlier tests already assumed).
  const forced = code.match(/__WABA_([A-Za-z0-9]+)__/);
  if (forced) return forced[1];
  return mockPhoneGroup(code);
}

/** Test-only: lets a test pre-seed a WABA as already subscribed (or reset
 * one to unsubscribed) before calling the real endpoint, so the endpoint's
 * "don't resubscribe / don't unsubscribe something we didn't create"
 * behavior (plan amendment 4) can be exercised against a KNOWN starting
 * state instead of the mock's own default. */
export function setMockWabaSubscribed(wabaId: string, subscribed: boolean): void {
  MOCK_WABA_SUBSCRIPTION_STATE.set(wabaId, subscribed);
}
export function resetMockWabaSubscriptions(): void {
  MOCK_WABA_SUBSCRIPTION_STATE.clear();
}
export function resetMockUsedCodes(): void {
  MOCK_USED_CODES.clear();
}

export class MockWhatsAppGraphClient implements WhatsAppGraphClient {
  async exchangeCodeForToken(code: string): Promise<TokenExchangeResult> {
    if (MOCK_USED_CODES.has(code)) throw new Error("mock_graph_code_already_used");
    if (code.includes("FAIL_EXCHANGE")) throw new Error("mock_graph_exchange_failed");
    // Marked used only on SUCCESS — matches typical OAuth semantics (a
    // code that fails to exchange, e.g. on a transient error, is not
    // necessarily burned; one that successfully yields a token always is).
    MOCK_USED_CODES.add(code);
    // The mock "access token" simply echoes the code — every later mock
    // call receives it as `accessToken` and can recover which test
    // scenario is in play from it, without a shared mutable session.
    return { accessToken: `mock-token-for:${code}`, expiresIn: 60 * 60 * 24 * 60 };
  }

  async discoverPhoneAndWaba(accessToken: string): Promise<PhoneWabaDiscovery> {
    const code = accessToken.replace(/^mock-token-for:/, "");
    if (code.includes("FAIL_DISCOVERY")) throw new Error("mock_graph_discovery_failed");
    // Deterministic per-code-group IDs — same group -> same phone/WABA
    // (simulating a clinic reconnecting the same real-world asset).
    return {
      phoneNumberId: `mock-phone-${mockPhoneGroup(code)}`,
      wabaId: `mock-waba-${mockWabaGroup(code)}`,
      displayPhoneNumber: "+55 11 90000-0000",
      businessName: "Clínica Teste Mock",
    };
  }

  async verifyCoexistence(accessToken: string, phoneNumberId: string): Promise<CoexistenceCheck> {
    const code = accessToken.replace(/^mock-token-for:/, "");
    if (code.includes("FAIL_COEXISTENCE")) throw new Error("mock_graph_coexistence_failed");
    if (code.includes("INCONCLUSIVE_COEXISTENCE") || (code.includes("INCONCLUSIVE") && !code.includes("INCONCLUSIVE_SUBSCRIBE_CONFIRM"))) {
      return { verification: "inconclusive", evidence: [] };
    }
    if (code.includes("REJECTED")) {
      return { verification: "rejected", evidence: ["PLATFORM_TYPE_CLOUD_API_ONLY"] };
    }
    return { verification: "confirmed", evidence: ["PLATFORM_TYPE_COEXISTENCE"] };
  }

  async getWabaSubscriptionStatus(wabaId: string): Promise<boolean> {
    return MOCK_WABA_SUBSCRIPTION_STATE.get(wabaId) ?? false;
  }

  async subscribeWaba(wabaId: string, accessToken: string): Promise<void> {
    const code = accessToken.replace(/^mock-token-for:/, "");
    if (code.includes("FAIL_SUBSCRIBE") && !code.includes("FAIL_SUBSCRIBE_CONFIRM")) throw new Error("mock_graph_subscribe_failed");
    MOCK_WABA_SUBSCRIPTION_STATE.set(wabaId, true);
  }

  async confirmWabaSubscription(wabaId: string, accessToken: string): Promise<boolean> {
    const code = accessToken.replace(/^mock-token-for:/, "");
    if (code.includes("FAIL_SUBSCRIBE_CONFIRM")) throw new Error("mock_graph_subscribe_confirm_failed");
    if (code.includes("INCONCLUSIVE_SUBSCRIBE_CONFIRM")) return false;
    return MOCK_WABA_SUBSCRIPTION_STATE.get(wabaId) ?? false;
  }

  async unsubscribeWaba(wabaId: string, accessToken: string): Promise<void> {
    const code = accessToken.replace(/^mock-token-for:/, "");
    if (code.includes("FAIL_UNSUBSCRIBE")) throw new Error("mock_graph_unsubscribe_failed");
    MOCK_WABA_SUBSCRIPTION_STATE.set(wabaId, false);
  }

  // Sentinel direto no VALOR do token (não no `code` do Embedded Signup —
  // sendViaMeta nunca passou por exchangeCodeForToken, o token vem do
  // Secret Manager) — "FAIL_SEND" em qualquer lugar do valor força falha,
  // deterministico e sem rede real, mesma convenção de fault-injection já
  // usada nos outros métodos deste mock.
  async sendMessage(phoneNumberId: string, accessToken: string, toPhoneE164: string, _text: string): Promise<SendMessageResult> {
    if (accessToken.includes("FAIL_SEND")) throw new Error("mock_graph_send_failed");
    if (!accessToken) throw new Error("mock_graph_send_missing_token");
    return { providerMessageId: `mock-wamid-${phoneNumberId}-${Date.now()}`, waId: toPhoneE164.replace(/\D/g, "") || null };
  }
}

// ---------------------------------------------------------------------------
// Factory — the only thing server.ts calls.
// ---------------------------------------------------------------------------

let mockClientSingleton: MockWhatsAppGraphClient | null = null;

export function getWhatsAppGraphClient(): WhatsAppGraphClient {
  if (process.env.WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS === "1") {
    if (!mockClientSingleton) mockClientSingleton = new MockWhatsAppGraphClient();
    return mockClientSingleton;
  }
  return new RealWhatsAppGraphClient();
}
