/**
 * WhatsApp per-clinic secret PROVISIONING — deliberately a SEPARATE module,
 * separate interface, and (in the real world) a separate GCP identity from
 * secretManager.ts's SecretManagerClient (the exchange runtime's client).
 *
 * Architecture chosen and documented here (not implemented for real this
 * phase — no secrets/IAM are created; every call in this file that would
 * touch real infrastructure is unexercised, exactly like
 * GcpSecretManagerClient in secretManager.ts):
 *
 *   PROVISIONER SERVICE, own identity — not "an admin runs a command by
 *   hand" and not "the exchange runtime creates it inline". Rationale:
 *
 *   - Manual per-clinic provisioning (a human running `gcloud secrets
 *     create` before each clinic's first connection) does not scale as a
 *     SaaS onboarding step — ELIZA has many clinics, this would become a
 *     recurring manual chore and a deploy-blocking dependency on a human
 *     being available.
 *   - Inline provisioning inside the exchange runtime (i.e. giving
 *     server.ts's own service account secrets.create) would violate the
 *     minimal-privilege IAM design this whole plan is built on (plano
 *     vast-yawning-hamster.md v4 Seção 4) — the exchange runtime must
 *     never be ABLE to create/delete secrets, not just "chooses not to".
 *   - So: a dedicated, narrowly-scoped PROVISIONER — a separate Cloud Run
 *     Job / Cloud Function, triggered automatically at a well-defined
 *     point in clinic onboarding (e.g. when a clinic's plan grants
 *     WhatsApp capability, well before any Embedded Signup attempt is
 *     possible from the UI) — running under its OWN service account.
 *   - The provisioner creates ONLY the empty secret shell (no versions,
 *     no value). The exchange runtime's SecretManagerClient (separate
 *     file, separate identity) is the only thing that ever adds/reads/
 *     disables VERSIONS — and it can only do that on a secret that
 *     already exists, per its own addSecretVersion() failing hard
 *     otherwise (secretManager.ts).
 *
 * CORREÇÃO (rodada de fencing global, item 6) — a afirmação anterior deste
 * comentário ("IAM Condition escopada por prefixo de resource.name pra
 * `eliza-wa-token-*`") estava TECNICAMENTE ERRADA e foi removida. Validado
 * contra a documentação oficial do Google Cloud antes de reescrever esta
 * nota (não reafirmado de memória):
 *
 *   - IAM Conditions baseadas em `resource.name` NÃO se aplicam a chamadas
 *     de CREATE: no momento em que a autorização é avaliada, o recurso
 *     sendo criado ainda não existe — `resource.name` resolve pro recurso
 *     PAI (o projeto), não pro secret que está sendo criado. Confirmado
 *     pela doc oficial de "Resource attributes for IAM Conditions": "If a
 *     condition uses an attribute that isn't available for a resource,
 *     then that part of the condition is never interpreted as granting
 *     access" — e a doc recomenda usar `resource.type`/`resource.service`
 *     (não `resource.name`) pra escopar condições envolvendo criação,
 *     precisamente porque o nome do recurso-alvo não está disponível
 *     ainda nesse ponto.
 *   - Custom Organization Policy Constraints pra Secret Manager (o outro
 *     mecanismo preventivo existente no GCP) também NÃO ajudam aqui: os
 *     campos suportados pra constraints customizadas em
 *     `secretmanager.googleapis.com/Secret` são `resource.annotations`,
 *     `resource.expireTime`, `resource.rotation.*`, `resource.topics.name`,
 *     `resource.versionAliases`, `resource.versionDestroyTtl` — não existe
 *     campo pra nome/ID do secret. Não dá pra restringir POR NOME via
 *     org policy nem por IAM Condition.
 *
 *   Conclusão honesta: NÃO existe hoje um controle preventivo nativo do
 *   GCP que force "só cria secrets começando com eliza-wa-token-" no nível
 *   de IAM/org-policy. O controle real, verificável, proposto no lugar:
 *
 *   1. ESCOPO DE PERMISSÃO MÍNIMO (não de nome): papel customizado do
 *      provisionador = SOMENTE `secretmanager.secrets.create` — nenhuma
 *      outra permissão, nem `.get`, nem `.delete`, nem `.setIamPolicy`,
 *      nunca `versions.add`/`versions.access` em NENHUM secret, nem nos
 *      que ele mesmo criou. O provisionador pode criar um secret com
 *      QUALQUER nome dentro do projeto, mas não pode ler metadados, não
 *      pode conceder acesso a ninguém, não pode ler/gravar o VALOR de
 *      nenhum secret, não pode apagar nada — o dano possível de uma
 *      identidade comprometida fica limitado estritamente a "criar
 *      secrets vazios com nomes arbitrários".
 *   2. CONTROLE DETECTIVO (não preventivo): um sink de Cloud Audit Logs
 *      sobre `google.cloud.secretmanager.v1.SecretManagerService.
 *      CreateSecret` com um filtro/alerta pra qualquer `secretId` que NÃO
 *      bata com `^eliza-wa-token-[a-zA-Z0-9]+$` — nunca implementado nesta
 *      fase, mas é a peça real que valida a convenção de nome, já que
 *      prevenção nativa não está disponível pra isso.
 *   3. CORREÇÃO DESTA RODADA — quem concede ao RUNTIME acesso a um secret
 *      novo deixou de ser o próprio provisionador (removido: ele não tem
 *      mais `secretmanager.secrets.setIamPolicy`, propositalmente, item 1
 *      acima). É uma TERCEIRA identidade/procedimento, separada tanto do
 *      provisionador quanto do runtime — ex.: um `terraform apply` ou um
 *      `gcloud secrets add-iam-policy-binding` executado por um operador
 *      humano ou por um pipeline de infraestrutura com privilégio próprio
 *      de administração de IAM — nunca automático, nunca parte do
 *      caminho de onboarding online. Esse binding é POR SECRET (nunca
 *      project-wide).
 *
 *   CORREÇÃO DA RODADA FINAL DE FECHAMENTO — a versão anterior desta nota
 *   dizia que esse binding concedia `roles/secretmanager.secretAccessor` +
 *   `roles/secretmanager.secretVersionManager`. Isso estava errado por
 *   EXCESSO de permissão: `secretVersionManager` inclui `versions.add`,
 *   mas TAMBÉM `versions.disable`/`versions.destroy`/`versions.enable` —
 *   o runtime do exchange (`secretManager.ts`) NUNCA desabilita nem
 *   destrói uma versão (isso é ação exclusiva do procedimento
 *   administrativo de limpeza de versão órfã, seção seguinte, sob uma
 *   identidade totalmente diferente) — conceder esse papel predefinido
 *   dava ao runtime uma permissão que ele nunca usa e nunca deveria ter.
 *
 *   Correção: o binding usa um PAPEL CUSTOMIZADO
 *   (`roles/<projeto>.elizaWaSecretRuntime`, ou equivalente) com
 *   EXATAMENTE 2 permissões, nada além disso:
 *     - `secretmanager.versions.add`    (gravar uma versão nova)
 *     - `secretmanager.versions.access` (ler o VALOR de uma versão
 *        específica — nunca `/versions/latest`, sempre um número
 *        explícito, ver secretManager.ts)
 *   Nunca `secretmanager.secrets.get`, nunca `.disable`/`.destroy`/
 *   `.enable`, nunca `.create`/`.delete`/`.setIamPolicy`. "Runtime
 *   condicionado para versões": por CONSTRUÇÃO DE PAPEL (o papel
 *   customizado não contém NENHUMA permissão de nível secret, só as 2 de
 *   nível versão acima), combinado com o binding sendo sempre POR SECRET
 *   (nunca a nível de projeto) — o runtime nunca tem uma permissão de
 *   nível SECRET (criar/apagar/conceder acesso/desabilitar versão), só as
 *   2 permissões de nível VERSÃO acima, e só nos secrets específicos que
 *   essa terceira identidade escolheu bindar — nunca no projeto inteiro.
 *
 *   Resultado: três identidades, três escopos disjuntos, nenhuma
 *   sobreposição de privilégio — o provisionador só cria (não lê, não
 *   concede acesso), a identidade de binding só concede acesso a secrets
 *   já existentes (não cria, não lê o valor), o runtime só grava/lê o
 *   VALOR de versões dos secrets que lhe foram explicitamente concedidos
 *   (nunca desabilita/destrói uma versão, nunca cria/apaga secrets, nunca
 *   concede acesso a mais ninguém).
 *
 * WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS=1 selects the mock, exactly like
 * secretManager.ts and whatsappGraphClient.ts — no real deploy sets it.
 *
 * ---------------------------------------------------------------------
 * CICLO DE VIDA DE UMA VERSÃO ÓRFÃ (item 5) — documentado, NADA disto é
 * executado nesta fase.
 * ---------------------------------------------------------------------
 * Uma versão órfã (server.ts, whatsapp_orphaned_secret_versions) significa
 * só isto: "uma versão nova foi gravada no Secret Manager, mas nunca
 * chegou a virar a versão ATIVA da integração". Duas ações completamente
 * DIFERENTES, que este ciclo distingue de propósito:
 *
 *   (a) "Desativar/destruir a VERSÃO no Secret Manager" — uma operação
 *       inteiramente NOSSA, local ao GCP: `versions.disable` ou
 *       `versions.destroy` faz esse valor parar de ser servível pela
 *       nossa própria infraestrutura. NÃO tem nenhum efeito do lado da
 *       Meta.
 *   (b) "Revogar o TOKEN na Meta" — uma ação do lado DA META, sobre a
 *       validade do token em si (ex.: um endpoint de revogação de token
 *       do Graph API, se/quando existir um pra este tipo de token — não
 *       confirmado nesta fase, mesmo TODO-CONFIRM já sinalizado em
 *       whatsappGraphClient.ts pra outras chamadas). Desativar (a) NUNCA
 *       invalida automaticamente (b) — o token órfão continua
 *       tecnicamente válido e utilizável do ponto de vista da Meta até
 *       que uma ação (b) separada aconteça (ou ele expire sozinho, via
 *       `expires_in`).
 *
 * Procedimento administrativo pretendido pra limpeza de uma versão órfã
 * (identidade separada, nunca o runtime do exchange, nunca automático):
 *   1. Recuperar o valor do token de forma protegida — `accessSecretVersion`
 *      na versão órfã específica, só em memória, nunca logado, nunca
 *      persistido em nenhum outro lugar mesmo que temporariamente.
 *   2. Revogar o token na Meta, SE/QUANDO a Graph API expuser um jeito de
 *      fazer isso pra este tipo de token — pendente de confirmação contra
 *      a API real antes de implementar (mesmo padrão TODO-CONFIRM já
 *      usado em whatsappGraphClient.ts).
 *   3. SÓ DEPOIS de (2) ter sido tentado (ou confirmado que a Meta não
 *      oferece revogação programática pra esse caso, ficando só a
 *      expiração natural), desativar/destruir a versão órfã no Secret
 *      Manager (a). Fazer (a) antes de tentar (b) perderia a única cópia
 *      seguramente acessível do valor necessário pra revogar na Meta.
 * Nenhuma dessas três ações está implementada — este bloco é só o desenho
 * documentado, pra quando uma fase futura autorizar a limpeza real.
 */

export interface WhatsAppSecretProvisioner {
  /** Creates the EMPTY secret shell for a clinic (no versions). Idempotent
   * — calling it again for an already-provisioned clinic is a no-op, not
   * an error (mirrors `gcloud secrets create` semantics of failing softly
   * on ALREADY_EXISTS when re-run). This is the ONLY operation this
   * interface exposes, matching the provisioner's role of exactly one
   * permission (`secretmanager.secrets.create`, see header comment item
   * 1) — granting the runtime access to the new secret is deliberately
   * NOT a method here anymore (rodada final, item 3 do header): it
   * requires `secretmanager.secrets.setIamPolicy`, which the
   * provisioner's role does not include. That grant is a separate,
   * out-of-band administrative procedure — see header comment item 3. */
  provisionSecretForClinic(clinicId: string): Promise<{ secretName: string; alreadyExisted: boolean }>;
}

function secretNameForClinic(clinicId: string): string {
  return `eliza-wa-token-${clinicId}`;
}

// ---------------------------------------------------------------------------
// Real implementation — unexercised this phase. Would run as its own
// deployable (Cloud Run Job / Cloud Function), never inside server.ts's
// own process/identity in production — kept here as the same TypeScript
// shape only so the interface and the intended call are documented
// alongside the code that will eventually call it administratively.
// ---------------------------------------------------------------------------

function gcpSecretProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "elisa-494703";
}

export class GcpWhatsAppSecretProvisioner implements WhatsAppSecretProvisioner {
  private clientPromise: Promise<any> | null = null;

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      const moduleName = "@google-cloud/secret-manager";
      this.clientPromise = import(moduleName).then((mod: any) => new mod.SecretManagerServiceClient());
    }
    return this.clientPromise;
  }

  async provisionSecretForClinic(clinicId: string): Promise<{ secretName: string; alreadyExisted: boolean }> {
    const client = await this.getClient();
    const secretName = secretNameForClinic(clinicId);
    try {
      await client.createSecret({
        parent: `projects/${gcpSecretProjectId()}`,
        secretId: secretName,
        secret: { replication: { automatic: {} } },
      });
      return { secretName, alreadyExisted: false };
    } catch (err: any) {
      if (err?.code === 6) return { secretName, alreadyExisted: true }; // ALREADY_EXISTS
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Mock — the ONLY one exercised by tests. Provisions into the SAME
// in-process mock secret store used by MockSecretManagerClient
// (secretManager.ts), via that file's getMockSecretManagerClientForTests()
// — kept as a normal function call (not a network hop) since both mocks
// live in the same test/server process; this mirrors the real world's two
// SEPARATE identities acting on the SAME underlying Secret Manager
// resource, just without the network/IAM boundary that exists for real.
// ---------------------------------------------------------------------------

export class MockWhatsAppSecretProvisioner implements WhatsAppSecretProvisioner {
  async provisionSecretForClinic(clinicId: string): Promise<{ secretName: string; alreadyExisted: boolean }> {
    // Deferred import to avoid a hard module-load-order dependency between
    // the two files.
    const { getMockSecretManagerClientForTests } = await import("./secretManager");
    const secretName = secretNameForClinic(clinicId);
    const mockClient = getMockSecretManagerClientForTests();
    const alreadyExisted = await mockClient.secretExists(secretName);
    mockClient.seedSecret(secretName);
    return { secretName, alreadyExisted };
  }
}

let mockProvisionerSingleton: MockWhatsAppSecretProvisioner | null = null;

export function getWhatsAppSecretProvisioner(): WhatsAppSecretProvisioner {
  if (process.env.WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS === "1") {
    if (!mockProvisionerSingleton) mockProvisionerSingleton = new MockWhatsAppSecretProvisioner();
    return mockProvisionerSingleton;
  }
  return new GcpWhatsAppSecretProvisioner();
}
