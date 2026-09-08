/**
 * Autenticação para a escrita real da Simples Dental Bridge (ADR 0003 do
 * repositório da Bridge). Deliberadamente uma credencial DIFERENTE de
 * `BRIDGE_INTEGRATION_TOKEN` (bridgeAuth.ts, só leitura) — revogável
 * separadamente, nunca reaproveitada. Mesmo padrão de `EnvBridgeAuthProvider`:
 * token único + lista explícita de clínicas autorizadas.
 *
 * Duas camadas de segurança antes de qualquer escrita:
 *  1. Token válido + clínica na allowlist (aqui).
 *  2. `BRIDGE_SYNC_WRITES_ENABLED=true` precisa estar setado explicitamente
 *     no ambiente (checado em cada endpoint, não aqui) — nada escreve de
 *     verdade enquanto isso não for ligado deliberadamente, mesmo com um
 *     token válido em mãos.
 */

export interface BridgeSyncIdentity {
  allowedClinicIds: ReadonlySet<string>;
}

export interface BridgeSyncAuthCheck {
  ok: boolean;
  status: 200 | 400 | 401 | 403;
  error: string | null;
  resolvedClinicId: string | null;
}

export function authenticateBridgeSyncRequest(
  authorizationHeader: string | undefined,
  clinicId: string | undefined
): BridgeSyncAuthCheck {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false, status: 401, error: "Autenticação necessária.", resolvedClinicId: null };
  }

  const expected = process.env.BRIDGE_SYNC_TOKEN;
  if (!expected || token !== expected) {
    return { ok: false, status: 401, error: "Token inválido.", resolvedClinicId: null };
  }

  if (!clinicId || typeof clinicId !== "string") {
    return { ok: false, status: 400, error: "clinicId é obrigatório.", resolvedClinicId: null };
  }

  const allowedClinicIds = new Set(
    (process.env.BRIDGE_SYNC_ALLOWED_CLINIC_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (!allowedClinicIds.has(clinicId)) {
    return { ok: false, status: 403, error: "Clínica não autorizada para esta credencial.", resolvedClinicId: null };
  }

  return { ok: true, status: 200, error: null, resolvedClinicId: clinicId };
}

export function createBridgeSyncAuthMiddleware() {
  return (req: any, res: any, next: any) => {
    const clinicId = typeof req.body?.clinicId === "string" ? req.body.clinicId : undefined;
    const result = authenticateBridgeSyncRequest(req.headers?.authorization, clinicId);

    if (!result.ok) {
      if (result.status === 403) {
        console.warn(`[BRIDGE_SYNC_AUTH_FORBIDDEN] clinicId=${clinicId ?? "?"}`);
      } else if (result.status === 401) {
        console.warn("[BRIDGE_SYNC_AUTH_FAILED] invalid or missing token");
      }
      return res.status(result.status).json({ error: result.error });
    }

    if (process.env.BRIDGE_SYNC_WRITES_ENABLED !== "true") {
      console.warn("[BRIDGE_SYNC_WRITES_DISABLED] escrita real não habilitada neste ambiente");
      return res.status(503).json({ error: "BRIDGE_SYNC_WRITES_DISABLED", message: "Escrita real da Bridge não está habilitada neste ambiente." });
    }

    req.bridgeSyncClinicId = result.resolvedClinicId;
    next();
  };
}
