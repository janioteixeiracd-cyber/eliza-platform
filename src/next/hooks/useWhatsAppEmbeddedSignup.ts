import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  EmbeddedSignupController,
  type EmbeddedSignupSnapshot,
  type EmbeddedSignupDeps,
  type MetaLoginOutcome,
  type StartAttemptResult,
  type StartAttemptError,
  type ExchangeResult,
  type ExchangeError,
} from '../../lib/embeddedSignupController';

// IDs PÚBLICOS do app Meta (App ID, Configuration ID) — não são segredo,
// a própria Meta exige que fiquem no bundle do frontend (é assim que
// FB.init/FB.login funcionam). Nunca confundir com META_APP_SECRET
// (server-only, só em server.ts via process.env).
//
// Rodada final de fechamento — SEM fallback hardcoded: se a env var não
// estiver setada neste ambiente, o valor fica vazio e `isEmbeddedSignupConfigured`
// (abaixo) vira false — o hook/botão devem se recusar a abrir o SDK da
// Meta nesse caso (ver WhatsAppEmbeddedSignupButton.tsx), nunca tentar
// com um App ID/Config ID adivinhado ou de outro ambiente.
const META_APP_ID = (import.meta as any).env?.VITE_META_APP_ID || '';
const META_CONFIG_ID = (import.meta as any).env?.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID || '';
export const isEmbeddedSignupConfigured = !!(META_APP_ID && META_CONFIG_ID);

// Duas versões DIFERENTES, nunca confundir uma com a outra (item 4 da
// rodada final — validado contra a documentação oficial vigente da Meta,
// developers.facebook.com/documentation/business-messaging/whatsapp/
// embedded-signup/implementation, setembro/2026):
//   1. META_GRAPH_SDK_VERSION — versão do Graph API/SDK usada em
//      FB.init({version}) e nas chamadas ao Graph API no backend
//      (whatsappGraphClient.ts). Doc oficial mostra "v25.0" como exemplo
//      corrente — v21.0 (valor anterior deste arquivo) estava
//      desatualizada. Sobe periodicamente; não tem NENHUMA relação com o
//      número abaixo.
//   2. sessionInfoVersion (dentro de `extras`, no FB.login) — um inteiro
//      separado que versiona o FORMATO do payload de evento/sessão do
//      próprio fluxo de Embedded Signup (ex.: campos presentes no evento
//      `message` de FINISH/CANCEL), independente da versão do Graph API.
//      A amostra de código oficial da Meta pra Embedded Signup GENÉRICO
//      só mostra `extras: { setup: {} }` — featureType/sessionInfoVersion
//      aparecem em documentação de parceiro/comunidade (não na página
//      genérica oficial) especificamente pro sub-fluxo de Coexistence
//      ("onboard business app users"). Mantidos aqui porque removê-los
//      quebraria a variante de Coexistence segundo essas fontes — mas
//      CONTINUAM TODO-CONFIRM, precisam ser revalidados contra a conta
//      real do app Meta (App em modo Live) antes do primeiro teste manual.
const META_GRAPH_SDK_VERSION = 'v25.0';

let fbSdkPromise: Promise<any> | null = null;

/** Carrega o SDK oficial da Meta (`connect.facebook.net`) uma única vez
 * por página — chamadas concorrentes reusam a MESMA promise, nunca
 * injetam o script duas vezes. TODO-CONFIRM (mesmo padrão já usado em
 * whatsappGraphClient.ts pra endpoints da Graph API): os nomes exatos dos
 * campos de `extras` abaixo (featureType/sessionInfoVersion) devem ser
 * reconfirmados contra a documentação oficial vigente de Embedded Signup
 * Coexistence antes do primeiro teste manual real — a Meta itera esse
 * contrato; os valores aqui refletem o desenho documentado no plano, não
 * uma chamada real já validada contra a API. */
function loadFacebookSdk(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('facebook_sdk_requires_browser'));
  }
  const w = window as any;
  if (w.FB) return Promise.resolve(w.FB);
  if (fbSdkPromise) return fbSdkPromise;

  fbSdkPromise = new Promise((resolve, reject) => {
    w.fbAsyncInit = function fbAsyncInit() {
      w.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: META_GRAPH_SDK_VERSION });
      resolve(w.FB);
    };
    const existing = document.getElementById('facebook-jssdk');
    if (existing) return; // fbAsyncInit acima já está registrado, o script vai chamá-lo quando terminar de carregar
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('facebook_sdk_load_failed'));
    document.body.appendChild(script);
  });
  return fbSdkPromise;
}

async function openMetaLoginReal(): Promise<MetaLoginOutcome> {
  const FB = await loadFacebookSdk();
  return new Promise<MetaLoginOutcome>((resolve) => {
    FB.login(
      (response: any) => {
        const status = response?.status;
        const code = response?.authResponse?.code || null;
        if (status === 'connected' && code) {
          resolve({ status: 'connected', code });
        } else if (status === 'not_authorized') {
          resolve({ status: 'not_authorized', code: null });
        } else {
          // Popup fechado sem completar, ou qualquer status que o SDK não
          // classificou como 'connected'/'not_authorized' — tratado de
          // forma unificada como "não deu pra determinar o resultado",
          // nunca assumido como sucesso.
          resolve({ status: 'unknown', code: null });
        }
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          // TODO-CONFIRM: nome exato do campo/valor que seleciona
          // Coexistence (vs. o fluxo padrão "Adicionar número de
          // telefone") contra a doc oficial vigente antes do primeiro
          // teste manual real — nunca migra/desregistra o número do app
          // mobile, é exatamente isso que este parâmetro deve garantir.
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    );
  });
}

function useAuthedFetch() {
  const { user, clinic } = useAuth();
  return async function authedFetch(path: string, body: Record<string, any>): Promise<{ status: number; body: any }> {
    if (!user || !clinic?.id) throw new Error('session_not_loaded');
    const idToken = await user.getIdToken();
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ clinicId: clinic.id, ...body }),
    });
    let json: any = null;
    try { json = await response.json(); } catch { /* corpo vazio/não-JSON — trata como {} abaixo */ }
    return { status: response.status, body: json || {} };
  };
}

/** Hook React fino sobre EmbeddedSignupController — a máquina de estados
 * real vive na classe (testável em Node puro, ver
 * scripts/verifyWhatsAppEmbeddedSignupFrontend.mjs); este hook só liga os
 * 3 pontos de I/O reais (fetch autenticado + SDK da Meta) e expõe o
 * snapshot como state do React. */
export function useWhatsAppEmbeddedSignup() {
  const authedFetch = useAuthedFetch();
  const [snapshot, setSnapshot] = useState<EmbeddedSignupSnapshot>({ status: 'idle', displayPhoneNumber: null, errorCode: null, errorMessage: null });
  const controllerRef = useRef<EmbeddedSignupController | null>(null);

  const deps = useMemo<EmbeddedSignupDeps>(() => ({
    async startAttempt(): Promise<StartAttemptResult | StartAttemptError> {
      // Defesa em profundidade (item 5, rodada final) — o botão já fica
      // desabilitado quando App ID/Config ID não estão configurados
      // (ver WhatsAppEmbeddedSignupButton.tsx), mas isto garante que
      // NENHUM caminho consegue reservar uma tentativa no backend nem
      // abrir o SDK da Meta sem os IDs públicos configurados neste
      // ambiente — nunca tenta com um valor adivinhado/hardcoded.
      if (!isEmbeddedSignupConfigured) {
        return { ok: false, status: 0, errorCode: 'embedded_signup_not_configured' };
      }
      const { status, body } = await authedFetch('/api/whatsapp/embedded-signup/start-attempt', {});
      if (status === 200 && body.attemptId) return { ok: true, attemptId: body.attemptId };
      return { ok: false, status, errorCode: body.error || `http_${status}` };
    },
    openMetaLogin: openMetaLoginReal,
    async exchange(attemptId: string, code: string): Promise<ExchangeResult | ExchangeError> {
      const { status, body } = await authedFetch('/api/whatsapp/embedded-signup/exchange', { attemptId, code });
      if (status === 200) return { ok: true, displayPhoneNumber: body.displayPhoneNumber ?? null };
      return { ok: false, status, errorCode: body.error || `http_${status}` };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    const controller = new EmbeddedSignupController(deps);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => { unsubscribe(); controllerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    snapshot,
    start: () => controllerRef.current?.start(),
    reset: () => controllerRef.current?.reset(),
    isConfigured: isEmbeddedSignupConfigured,
  };
}
