/**
 * Secret Manager ACCESS (read/add-version/disable-version only — never
 * create/delete) — versioned, minimal-privilege by design. Never
 * reads/writes the token VALUE anywhere but here; every caller elsewhere
 * in the app only ever handles a secret NAME + an explicit VERSION number,
 * never "latest" (see plano vast-yawning-hamster.md v4 Seção 8).
 *
 * This client NEVER creates a secret — addSecretVersion() fails hard with
 * "secret_not_provisioned" if the secret doesn't already exist, in BOTH
 * the real and the mock implementation (paridade explícita — o mock não
 * pode esconder esse modo de falha). Provisioning (creating the empty
 * secret shell) is a deliberately SEPARATE concern with its own identity
 * — see src/lib/whatsappSecretProvisioner.ts for the chosen architecture
 * and why.
 *
 * Two implementations behind one interface:
 *   - GcpSecretManagerClient — the real one, wraps @google-cloud/secret-manager
 *     via a LAZY dynamic import so this module (and the whole app) compiles
 *     and runs without that package installed. Not exercised in this phase
 *     — no test or code path here actually invokes it; wiring it up for
 *     real (adding the dependency, granting IAM, provisioning secrets) is
 *     explicit future work, out of scope while Etapa A's ban on real
 *     Secret Manager calls/IAM stands.
 *   - MockSecretManagerClient — in-memory, deterministic, used by every
 *     test in this phase (scripts/verifyWhatsAppEmbeddedSignup*.mjs) via
 *     getSecretManagerClient() below, which returns the mock whenever
 *     WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS=1 is set — an env var no real
 *     deploy sets, so the real client is what actually ships, even though
 *     nothing calls it yet.
 */

export interface SecretVersionResult {
  versionId: string;
}

export interface SecretManagerClient {
  /** Adds a new version to an EXISTING secret. Never creates the secret
   * itself (secrets.create is deliberately never granted to the runtime —
   * see the plan's IAM matrix; a not-yet-provisioned secret is a hard,
   * explicit failure, not an auto-create). */
  addSecretVersion(secretName: string, value: string): Promise<SecretVersionResult>;
  /** Reads the value of one EXPLICIT version — never "latest". */
  accessSecretVersion(secretName: string, versionId: string): Promise<string>;
  /** Disables (never deletes) an orphaned version, e.g. after a failed/
   * rolled-back connection attempt. */
  disableSecretVersion(secretName: string, versionId: string): Promise<void>;
  /** Existence check for the secret itself (not a version) — used to give
   * a clean "secret não provisionado" error instead of attempting (and
   * failing) a create call the runtime has no permission for anyway. */
  secretExists(secretName: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Real implementation — unexercised this phase.
// ---------------------------------------------------------------------------

function gcpSecretProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "elisa-494703";
}

export class GcpSecretManagerClient implements SecretManagerClient {
  // Lazily imported so `@google-cloud/secret-manager` does not need to be
  // installed for this module to load — see file header. Typed `any`
  // deliberately: no type declarations are available without the package.
  private clientPromise: Promise<any> | null = null;

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      // Non-literal specifier deliberately: keeps TypeScript from trying
      // to resolve/typecheck the module at compile time, so this file
      // compiles fine without the package installed — see file header.
      const moduleName = "@google-cloud/secret-manager";
      this.clientPromise = import(moduleName).then(
        (mod: any) => new mod.SecretManagerServiceClient()
      );
    }
    return this.clientPromise;
  }

  private secretPath(secretName: string): string {
    return `projects/${gcpSecretProjectId()}/secrets/${secretName}`;
  }

  async addSecretVersion(secretName: string, value: string): Promise<SecretVersionResult> {
    const client = await this.getClient();
    const exists = await this.secretExists(secretName);
    if (!exists) {
      // Deliberately no auto-create — secrets.create is never granted to
      // the runtime service account (minimal-privilege IAM, plan Seção 4).
      // Pre-provisioning a secret is an explicit, separate administrative
      // step (Fase 0), never an implicit side effect of a connection
      // attempt.
      throw new Error(`secret_not_provisioned: ${secretName}`);
    }
    const [version] = await client.addSecretVersion({
      parent: this.secretPath(secretName),
      payload: { data: Buffer.from(value, "utf8") },
    });
    const versionId = String(version.name).split("/").pop();
    if (!versionId) throw new Error("secret_manager_version_id_missing");
    return { versionId };
  }

  async accessSecretVersion(secretName: string, versionId: string): Promise<string> {
    const client = await this.getClient();
    const [response] = await client.accessSecretVersion({
      name: `${this.secretPath(secretName)}/versions/${versionId}`,
    });
    const data = response.payload?.data;
    if (!data) throw new Error("secret_manager_empty_payload");
    return Buffer.from(data).toString("utf8");
  }

  async disableSecretVersion(secretName: string, versionId: string): Promise<void> {
    const client = await this.getClient();
    await client.disableSecretVersion({
      name: `${this.secretPath(secretName)}/versions/${versionId}`,
    });
  }

  async secretExists(secretName: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      await client.getSecret({ name: this.secretPath(secretName) });
      return true;
    } catch (err: any) {
      if (err?.code === 5) return false; // NOT_FOUND
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Mock implementation — the ONLY one exercised by tests in this phase.
// ---------------------------------------------------------------------------

interface MockSecretRecord {
  versions: Map<string, { value: string; disabled: boolean }>;
  nextVersionNumber: number;
}

export class MockSecretManagerClient implements SecretManagerClient {
  private secrets = new Map<string, MockSecretRecord>();

  /** Test-only helper: explicitly pre-provisions a secret, mirroring the
   * real Fase 0 administrative step — use this in a test that specifically
   * wants to exercise the "not provisioned" failure path by NOT calling it
   * first for a given name. */
  seedSecret(secretName: string): void {
    if (!this.secrets.has(secretName)) {
      this.secrets.set(secretName, { versions: new Map(), nextVersionNumber: 1 });
    }
  }

  async addSecretVersion(secretName: string, value: string): Promise<SecretVersionResult> {
    // CORRIGIDO (rodada de paridade): a versão anterior auto-provisionava
    // o secret aqui — divergia do cliente real e escondia exatamente o
    // modo de falha que o cliente real teria ("secret não provisionado").
    // Agora o mock se comporta IGUAL ao real: nunca cria, sempre falha se
    // o secret não foi provisionado antes por um caminho separado. Testes
    // que precisam de um secret existente chamam
    // getWhatsAppSecretProvisioner().provisionSecretForClinic(clinicId)
    // (src/lib/whatsappSecretProvisioner.ts) explicitamente ANTES do
    // exchange — nunca dentro do próprio fluxo de exchange —, simulando o
    // provisionamento administrativo real por uma identidade separada.
    const record = this.secrets.get(secretName);
    if (!record) throw new Error(`secret_not_provisioned: ${secretName}`);
    const versionId = String(record.nextVersionNumber++);
    record.versions.set(versionId, { value, disabled: false });
    return { versionId };
  }

  async accessSecretVersion(secretName: string, versionId: string): Promise<string> {
    const record = this.secrets.get(secretName);
    const version = record?.versions.get(versionId);
    if (!version || version.disabled) throw new Error(`secret_version_not_found: ${secretName}/${versionId}`);
    return version.value;
  }

  async disableSecretVersion(secretName: string, versionId: string): Promise<void> {
    const version = this.secrets.get(secretName)?.versions.get(versionId);
    if (version) version.disabled = true;
  }

  async secretExists(secretName: string): Promise<boolean> {
    return this.secrets.has(secretName);
  }
}

// ---------------------------------------------------------------------------
// Factory — the only thing server.ts calls.
// ---------------------------------------------------------------------------

let mockSingleton: MockSecretManagerClient | null = null;

/** Test-only: returns the SAME mock instance getSecretManagerClient() would
 * hand out, so a test can pre-seed secrets / inspect state directly. */
export function getMockSecretManagerClientForTests(): MockSecretManagerClient {
  if (!mockSingleton) mockSingleton = new MockSecretManagerClient();
  return mockSingleton;
}

export function getSecretManagerClient(): SecretManagerClient {
  if (process.env.WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS === "1") {
    return getMockSecretManagerClientForTests();
  }
  return new GcpSecretManagerClient();
}
