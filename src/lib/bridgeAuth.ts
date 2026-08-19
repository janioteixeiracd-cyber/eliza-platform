/**
 * Authentication for the Simples Dental Bridge integration surface
 * (`/api/bridge/*`). Deliberately separate from every other auth path in
 * this app: not a Firebase user session (elizaAuthMiddleware,
 * patientPortalAuth), not the scheduler's shared secret
 * (verifySchedulerAuth) — a distinct credential (`BRIDGE_INTEGRATION_TOKEN`)
 * so revoking or rotating Bridge access never touches anything else.
 *
 * The Bridge runs as a local, unattended process — it never holds a
 * Firebase user token and is never given Firestore credentials directly.
 * This middleware is the entire trust boundary between it and this app.
 *
 * `BridgeAuthProvider` exists so the token-matching mechanism can change
 * later (e.g. a Firestore-backed multi-credential store, one row per
 * Bridge deployment with its own allowed-clinics list) without touching
 * the route contract or anything that calls `authenticateBridgeRequest`.
 */

export interface BridgeIdentity {
  /** Stable label for *which* credential authenticated — "default" until there's more than one. */
  credentialId: string;
  allowedClinicIds: ReadonlySet<string>;
}

export interface BridgeAuthProvider {
  /** Returns the identity for a valid token, or null if the token itself is invalid/unknown. */
  authenticate(bearerToken: string): BridgeIdentity | null;
}

/**
 * Fase 1: uma única credencial compartilhada (`BRIDGE_INTEGRATION_TOKEN`)
 * autorizada para uma lista explícita de clínicas (`BRIDGE_ALLOWED_CLINIC_IDS`,
 * separadas por vírgula). Não é "token válido = qualquer clínica" — uma
 * clínica fora da lista é tratada exatamente como não autorizada, mesmo
 * com token correto.
 */
export class EnvBridgeAuthProvider implements BridgeAuthProvider {
  authenticate(bearerToken: string): BridgeIdentity | null {
    const expected = process.env.BRIDGE_INTEGRATION_TOKEN;
    if (!expected || !bearerToken || bearerToken !== expected) {
      return null;
    }
    const allowedClinicIds = new Set(
      (process.env.BRIDGE_ALLOWED_CLINIC_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return { credentialId: "default", allowedClinicIds };
  }
}

/**
 * Flat shape on purpose (no discriminated union) — `status` is always
 * present, `identity`/`resolvedClinicId` only populated when `ok`. Keeps
 * every caller's logic simple (`if (!result.ok) return res.status(result.status)...`)
 * without depending on control-flow narrowing across a union.
 */
export interface BridgeAuthCheck {
  ok: boolean;
  status: 200 | 400 | 401 | 403;
  error: string | null;
  identity: BridgeIdentity | null;
  resolvedClinicId: string | null;
}

/**
 * Pure function, no Express coupling — easy to test without spinning up a
 * server. Never include the submitted token or clinicId-not-allowed
 * reasoning in a way that would help enumerate valid clinics: an
 * unauthorized clinicId gets the exact same error as a nonexistent one.
 */
export function authenticateBridgeRequest(
  provider: BridgeAuthProvider,
  authorizationHeader: string | undefined,
  clinicId: string | undefined
): BridgeAuthCheck {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false, status: 401, error: "Autenticação necessária.", identity: null, resolvedClinicId: null };
  }

  const identity = provider.authenticate(token);
  if (!identity) {
    return { ok: false, status: 401, error: "Token inválido.", identity: null, resolvedClinicId: null };
  }

  if (!clinicId || typeof clinicId !== "string") {
    return { ok: false, status: 400, error: "clinicId é obrigatório.", identity: null, resolvedClinicId: null };
  }

  if (!identity.allowedClinicIds.has(clinicId)) {
    return {
      ok: false,
      status: 403,
      error: "Clínica não autorizada para esta credencial.",
      identity: null,
      resolvedClinicId: null,
    };
  }

  return { ok: true, status: 200, error: null, identity, resolvedClinicId: clinicId };
}

/**
 * Express middleware wrapper. Attaches `bridgeClinicId` to the request on
 * success — never logs the token, on failure or success.
 */
export function createBridgeAuthMiddleware(provider: BridgeAuthProvider = new EnvBridgeAuthProvider()) {
  return (req: any, res: any, next: any) => {
    const clinicId = typeof req.query?.clinicId === "string" ? req.query.clinicId : undefined;
    const result = authenticateBridgeRequest(provider, req.headers?.authorization, clinicId);

    if (!result.ok) {
      if (result.status === 403) {
        console.warn(`[BRIDGE_AUTH_FORBIDDEN] clinicId=${clinicId ?? "?"}`);
      } else if (result.status === 401) {
        console.warn("[BRIDGE_AUTH_FAILED] invalid or missing token");
      }
      return res.status(result.status).json({ error: result.error });
    }

    req.bridgeClinicId = result.resolvedClinicId;
    req.bridgeCredentialId = result.identity?.credentialId;
    next();
  };
}
