/**
 * WhatsApp Embedded Signup (Coexistence) — controlador do fluxo do
 * FRONTEND, deliberadamente sem NENHUMA dependência de DOM/React. Todo
 * acesso a `fetch`/`window.FB`/popup é injetado via EmbeddedSignupDeps —
 * isso permite testar a máquina de estados real (a mesma classe que a UI
 * usa) rodando em Node puro (scripts/verifyWhatsAppEmbeddedSignupFrontend.mjs),
 * sem jsdom/browser, mockando só os 3 pontos de I/O externo.
 *
 * Plano vast-yawning-hamster.md v4, Fase 7. Nunca chama a Graph API real,
 * nunca lê/grava token/secret name/versão/wabaId — só orquestra as 3
 * chamadas que já existem no backend (start-attempt, o SDK oficial da
 * Meta via openMetaLogin, exchange) e mantém um estado sanitizado pra UI.
 */

export type EmbeddedSignupState = "idle" | "preparing" | "awaiting_meta" | "connecting" | "completed" | "error";

export interface EmbeddedSignupSnapshot {
  status: EmbeddedSignupState;
  /** Único dado técnico exposto — já é semi-público (aparece pro paciente
   * no WhatsApp). Nunca phoneNumberId/wabaId/secret/token. */
  displayPhoneNumber: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface StartAttemptResult {
  ok: true; attemptId: string;
}
export interface StartAttemptError {
  ok: false; status: number; errorCode: string;
}

export interface ExchangeResult {
  ok: true; displayPhoneNumber: string | null;
}
export interface ExchangeError {
  ok: false; status: number; errorCode: string;
}

/** Espelha o vocabulário real de `FB.login()`'s `authResponse.status` —
 * 'connected' com um `code` é o único caminho de sucesso; 'not_authorized'
 * é o usuário negando/cancelando explicitamente no diálogo da Meta;
 * 'unknown' é o SDK não conseguindo determinar o resultado — o caso real
 * de "popup fechado antes de terminar" (o usuário fecha a janela sem
 * clicar em nada dentro dela). */
export interface MetaLoginOutcome {
  status: "connected" | "not_authorized" | "unknown";
  code: string | null;
}

export interface EmbeddedSignupDeps {
  startAttempt(): Promise<StartAttemptResult | StartAttemptError>;
  openMetaLogin(): Promise<MetaLoginOutcome>;
  exchange(attemptId: string, code: string): Promise<ExchangeResult | ExchangeError>;
}

// Mensagens sanitizadas — nunca ecoa err.message/stack, nunca menciona
// secret/token/phoneNumberId/wabaId. Mapeamento fechado (allowlist), igual
// ao padrão já usado em errorCode/errorClass/errorPhase no backend.
const SANITIZED_MESSAGES: Record<string, string> = {
  OWNER_OR_ADMIN_REQUIRED: "Só administradores da clínica podem conectar o WhatsApp.",
  AUTH_ERROR: "Sua sessão expirou. Atualize a página e tente novamente.",
  attempt_expired: "A tentativa de conexão expirou. Clique em Conectar para tentar de novo.",
  attempt_not_found: "A tentativa de conexão não foi encontrada. Tente novamente.",
  attempt_not_owned: "Esta tentativa pertence a outra sessão. Tente novamente.",
  missing_fields: "Não foi possível iniciar a conexão. Tente novamente.",
  cancelled_by_user: "Conexão cancelada.",
  popup_closed: "A janela da Meta foi fechada antes de concluir. Tente novamente.",
  code_missing: "A Meta não retornou uma autorização válida. Tente novamente.",
  network_error: "Falha de conexão. Verifique sua internet e tente novamente.",
  start_attempt_failed: "Não foi possível iniciar a conexão agora. Tente novamente em instantes.",
  embedded_signup_not_configured: "Conexão indisponível neste ambiente (configuração ausente). Contate o time técnico.",
};
function sanitizedMessageFor(code: string | null | undefined): string {
  if (code && SANITIZED_MESSAGES[code]) return SANITIZED_MESSAGES[code];
  return "Não foi possível concluir a conexão com o WhatsApp. Tente novamente em instantes.";
}

export class EmbeddedSignupController {
  private state: EmbeddedSignupState = "idle";
  private displayPhoneNumber: string | null = null;
  private errorCode: string | null = null;
  private errorMessage: string | null = null;
  private listeners = new Set<(snap: EmbeddedSignupSnapshot) => void>();
  // Única fonte de verdade pro guard de clique duplo/replay — independente
  // de `state`, que só muda DEPOIS de cada `await` (uma corrida entre dois
  // cliques no mesmo tick poderia ver `state==='idle'` duas vezes antes de
  // qualquer setState rodar). `inFlight` é setado de forma síncrona no
  // topo de start(), antes do primeiro `await`.
  private inFlight = false;

  constructor(private deps: EmbeddedSignupDeps) {}

  subscribe(fn: (snap: EmbeddedSignupSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => { this.listeners.delete(fn); };
  }

  snapshot(): EmbeddedSignupSnapshot {
    return { status: this.state, displayPhoneNumber: this.displayPhoneNumber, errorCode: this.errorCode, errorMessage: this.errorMessage };
  }

  private emit(state: EmbeddedSignupState, extra?: Partial<Pick<EmbeddedSignupSnapshot, "displayPhoneNumber" | "errorCode" | "errorMessage">>) {
    this.state = state;
    if (extra) {
      if ("displayPhoneNumber" in extra) this.displayPhoneNumber = extra.displayPhoneNumber ?? null;
      if ("errorCode" in extra) this.errorCode = extra.errorCode ?? null;
      if ("errorMessage" in extra) this.errorMessage = extra.errorMessage ?? null;
    }
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  /** Inicia o fluxo inteiro: start-attempt -> SDK da Meta -> exchange.
   * Clique duplo / replay: uma chamada enquanto `inFlight` é um NO-OP
   * silencioso (não enfileira, não lança) — só termina (sucesso ou erro)
   * libera pra uma nova chamada real. */
  async start(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      this.emit("preparing", { errorCode: null, errorMessage: null });
      const started = await this.deps.startAttempt();
      if (started.ok === false) {
        this.emit("error", { errorCode: started.errorCode, errorMessage: sanitizedMessageFor(started.errorCode) });
        return;
      }

      this.emit("awaiting_meta");
      const outcome = await this.deps.openMetaLogin();
      if (!(outcome.status === "connected" && outcome.code)) {
        const errorCode = outcome.status === "not_authorized" ? "cancelled_by_user"
          : outcome.status === "connected" ? "code_missing" // conectou mas sem code — anomalia, nunca prossegue
          : "popup_closed";
        this.emit("error", { errorCode, errorMessage: sanitizedMessageFor(errorCode) });
        return;
      }

      this.emit("connecting");
      const result = await this.deps.exchange(started.attemptId, outcome.code);
      if (result.ok === false) {
        this.emit("error", { errorCode: result.errorCode, errorMessage: sanitizedMessageFor(result.errorCode) });
        return;
      }

      this.emit("completed", { displayPhoneNumber: result.displayPhoneNumber, errorCode: null, errorMessage: null });
    } catch {
      // Nunca propaga err.message/stack pra UI — poderia vazar detalhe
      // técnico (URL, header, etc.) de uma falha de rede/SDK inesperada.
      this.emit("error", { errorCode: "network_error", errorMessage: sanitizedMessageFor("network_error") });
    } finally {
      this.inFlight = false;
    }
  }

  /** Volta pra 'idle' — só permitido fora de um `start()` em andamento
   * (não interrompe um fluxo real no meio). Usado pelo botão "Tentar de
   * novo" depois de um erro. */
  reset(): void {
    if (this.inFlight) return;
    this.emit("idle", { errorCode: null, errorMessage: null });
  }

  isInFlight(): boolean {
    return this.inFlight;
  }
}
