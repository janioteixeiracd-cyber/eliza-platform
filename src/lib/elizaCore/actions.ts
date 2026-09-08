/**
 * ELIZA Intelligence v2 — Action Layer.
 *
 * Every action here is WRITE-capable and therefore split into two phases,
 * never one: `propose` (builds a human-readable preview, touches nothing
 * external yet) and `execute` (the real side effect — only ever called by
 * server.ts's approve route, after a human has confirmed the exact
 * proposal). Nothing in this file writes to Firestore or sends a message
 * on its own initiative; server.ts owns the proposal document lifecycle
 * (pending → executed/rejected) and the audit trail.
 *
 * `generateText`/`sendWhatsApp` are injected rather than imported because
 * their real implementations (generateElizaAIResponse, sendWhatsAppMessage)
 * live as closures inside server.ts's startServer() — this file stays a
 * plain, testable module with no hidden dependency on that closure.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { resolveCognitiveGap } from "./cognitiveEvents";

export interface ProposeContext {
  db: Firestore;
  clinicId: string;
  uid: string;
  generateText: (prompt: string, taskType: string) => Promise<string>;
}

export interface ExecuteContext {
  db: Firestore;
  clinicId: string;
  uid: string;
  sendWhatsApp: (toPhone: string, text: string) => Promise<{ success: boolean; errorMessage?: string }>;
}

export interface ActionProposalPreview {
  summary: string;
  details: Record<string, any>;
}

export type ActionType = "create_task" | "prepare_message" | "prepare_campaign" | "create_appointment_request" | "propose_clinical_evolution";

// Messaging actions reach real patients — require owner/admin to approve
// (not just any active member), same spirit as canAccessFinance in auth.ts
// gating a sensitive surface behind a stricter role check.
export const ACTIONS_REQUIRING_ADMIN: ActionType[] = ["prepare_message", "prepare_campaign"];

// ============================================================================
// create_task
// ============================================================================

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: "Alta" | "Média" | "Baixa";
  patientId?: string;
}

export async function proposeCreateTask(input: CreateTaskInput, ctx: ProposeContext): Promise<{ preview: ActionProposalPreview; executionInput: CreateTaskInput }> {
  if (!input.title || !input.title.trim()) {
    throw new Error("title é obrigatório para criar uma tarefa.");
  }
  let patientName: string | undefined;
  if (input.patientId) {
    const snap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${input.patientId}`).get();
    if (!snap.exists) throw new Error("Paciente não encontrado nesta clínica.");
    patientName = snap.data()?.name;
  }
  return {
    preview: {
      summary: `Criar tarefa: "${input.title}"${patientName ? ` (${patientName})` : ""}`,
      details: { title: input.title, description: input.description || "", priority: input.priority || "Média", patientName: patientName || null },
    },
    executionInput: input,
  };
}

export async function executeCreateTask(input: CreateTaskInput, ctx: ExecuteContext): Promise<{ pendingItemId: string }> {
  let patientName: string | null = null;
  if (input.patientId) {
    const snap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${input.patientId}`).get();
    patientName = snap.exists ? snap.data()?.name || null : null;
  }
  const ref = await ctx.db.collection(`clinics/${ctx.clinicId}/pending_items`).add({
    type: "eliza_task",
    title: input.title,
    description: input.description || "",
    priority: input.priority || "Média",
    patientId: input.patientId || null,
    patientName,
    status: "pending",
    category: "Eliza AI",
    source: "Eliza AI",
    createdBy: ctx.uid,
    createdAt: new Date(),
  });
  return { pendingItemId: ref.id };
}

// ============================================================================
// create_appointment_request
// ============================================================================

export interface CreateAppointmentRequestInput {
  patientId: string;
  notes: string;
  preferredWindow?: string;
}

export async function proposeCreateAppointmentRequest(input: CreateAppointmentRequestInput, ctx: ProposeContext): Promise<{ preview: ActionProposalPreview; executionInput: CreateAppointmentRequestInput }> {
  if (!input.patientId || !input.notes?.trim()) {
    throw new Error("patientId e notes são obrigatórios.");
  }
  const snap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${input.patientId}`).get();
  if (!snap.exists) throw new Error("Paciente não encontrado nesta clínica.");
  const patientName = snap.data()?.name || "Paciente";
  return {
    preview: {
      summary: `Solicitar agendamento para ${patientName}: ${input.notes}`,
      details: { patientName, notes: input.notes, preferredWindow: input.preferredWindow || null },
    },
    executionInput: input,
  };
}

export async function executeCreateAppointmentRequest(input: CreateAppointmentRequestInput, ctx: ExecuteContext): Promise<{ pendingItemId: string }> {
  const snap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${input.patientId}`).get();
  const patientName = snap.exists ? snap.data()?.name || "Paciente" : "Paciente";
  const ref = await ctx.db.collection(`clinics/${ctx.clinicId}/pending_items`).add({
    type: "eliza_schedule_request",
    title: `Solicitação de agendamento — ${patientName}`,
    description: input.notes + (input.preferredWindow ? ` (janela preferida: ${input.preferredWindow})` : ""),
    patientId: input.patientId,
    patientName,
    status: "pending",
    priority: "Média",
    category: "Eliza AI",
    source: "Eliza AI",
    createdBy: ctx.uid,
    createdAt: new Date(),
  });
  return { pendingItemId: ref.id };
}

// ============================================================================
// prepare_message
// ============================================================================

export interface PrepareMessageInput {
  patientId: string;
  purpose: string;
}

async function draftMessageText(patientName: string, purpose: string, generateText: ProposeContext["generateText"]): Promise<string> {
  // Structural rule, not a per-message patch: the patient schema has no
  // reliable gender field (see src/lib/elizaCore/tools.ts's
  // PatientContextResult), so nothing here may infer gender from a first
  // name. The prompt forces neutral Portuguese instead of guessing.
  const prompt = `Escreva uma mensagem de WhatsApp curta (máximo 3 linhas), profissional mas cordial, de uma clínica odontológica para o paciente ${patientName}. Objetivo da mensagem: ${purpose}. Não invente informações que não foram dadas (datas, valores).
LINGUAGEM NEUTRA (obrigatório): não há dado confiável sobre o gênero deste paciente no sistema. Dirija-se sempre na segunda pessoa ("você") e NUNCA use pronomes de terceira pessoa (ele/ela) nem qualquer palavra flexionada por gênero referente ao paciente (ex.: nunca "bem-vindo(a)", "querido(a)", "convidá-lo"/"convidá-la" — reescreva a frase para evitar a flexão, ex.: "gostaríamos de convidar você").
Responda APENAS com o texto da mensagem, sem aspas, sem markdown.`;
  const text = await generateText(prompt, "mensagens_whatsapp");
  return text.trim().replace(/^"|"$/g, "");
}

export async function proposePrepareMessage(input: PrepareMessageInput, ctx: ProposeContext): Promise<{ preview: ActionProposalPreview; executionInput: PrepareMessageInput & { phone: string; draftText: string } }> {
  if (!input.patientId || !input.purpose?.trim()) {
    throw new Error("patientId e purpose são obrigatórios.");
  }
  const snap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${input.patientId}`).get();
  if (!snap.exists) throw new Error("Paciente não encontrado nesta clínica.");
  const data = snap.data() || {};
  const phone = data.phone;
  if (!phone) throw new Error("Este paciente não tem telefone cadastrado — não é possível preparar uma mensagem.");
  const draftText = await draftMessageText(data.name || "paciente", input.purpose, ctx.generateText);
  return {
    preview: { summary: `Mensagem para ${data.name}: "${draftText}"`, details: { patientName: data.name, phone, draftText } },
    executionInput: { ...input, phone, draftText },
  };
}

export async function executePrepareMessage(input: PrepareMessageInput & { phone: string; draftText: string }, ctx: ExecuteContext): Promise<{ sent: boolean; errorMessage?: string }> {
  const result = await ctx.sendWhatsApp(input.phone, input.draftText);
  return { sent: result.success, errorMessage: result.errorMessage };
}

// ============================================================================
// prepare_campaign
// ============================================================================

export interface PrepareCampaignInput {
  patientIds: string[];
  purpose: string;
}

export async function proposePrepareCampaign(input: PrepareCampaignInput, ctx: ProposeContext): Promise<{ preview: ActionProposalPreview; executionInput: { purpose: string; recipients: { patientId: string; name: string; phone: string; draftText: string }[]; skipped: { patientId: string; reason: string }[] } }> {
  if (!Array.isArray(input.patientIds) || input.patientIds.length === 0 || !input.purpose?.trim()) {
    throw new Error("patientIds (não vazio) e purpose são obrigatórios.");
  }
  if (input.patientIds.length > 50) {
    throw new Error("Campanha limitada a 50 pacientes por proposta nesta primeira versão.");
  }

  // One shared draft, personalized only by name — keeps this fast (a
  // single AI call, not one per patient) and lets the approver read
  // exactly what every recipient will get before confirming anything.
  const templateText = await draftMessageText("{nome}", input.purpose, ctx.generateText);

  const recipients: { patientId: string; name: string; phone: string; draftText: string }[] = [];
  const skipped: { patientId: string; reason: string }[] = [];
  for (const patientId of input.patientIds) {
    const snap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${patientId}`).get();
    if (!snap.exists) { skipped.push({ patientId, reason: "paciente não encontrado" }); continue; }
    const data = snap.data() || {};
    if (!data.phone) { skipped.push({ patientId, reason: "sem telefone cadastrado" }); continue; }
    const firstName = String(data.name || "paciente").split(" ")[0];
    recipients.push({ patientId, name: data.name, phone: data.phone, draftText: templateText.replace(/\{nome\}/gi, firstName) });
  }

  return {
    preview: {
      summary: `Campanha para ${recipients.length} paciente(s) (${skipped.length} sem telefone/ignorado(s)). Modelo: "${templateText}"`,
      details: { template: templateText, recipients: recipients.map((r) => ({ patientId: r.patientId, name: r.name, draftText: r.draftText })), skipped },
    },
    executionInput: { purpose: input.purpose, recipients, skipped },
  };
}

export async function executePrepareCampaign(
  input: { purpose: string; recipients: { patientId: string; name: string; phone: string; draftText: string }[]; skipped: { patientId: string; reason: string }[] },
  ctx: ExecuteContext
): Promise<{ sentCount: number; failedCount: number; results: { patientId: string; sent: boolean; errorMessage?: string }[] }> {
  const results: { patientId: string; sent: boolean; errorMessage?: string }[] = [];
  for (const r of input.recipients) {
    try {
      const sendResult = await ctx.sendWhatsApp(r.phone, r.draftText);
      results.push({ patientId: r.patientId, sent: sendResult.success, errorMessage: sendResult.errorMessage });
    } catch (err: any) {
      results.push({ patientId: r.patientId, sent: false, errorMessage: err?.message || String(err) });
    }
  }
  return {
    sentCount: results.filter((r) => r.sent).length,
    failedCount: results.filter((r) => !r.sent).length,
    results,
  };
}

// ============================================================================
// propose_clinical_evolution
// ============================================================================
// First action of "ELIZA Consciência Ativa" — turns a professional's free-
// text answer to "o que foi realizado hoje?" into a structured evolution
// proposal. The model is ONLY allowed to interpret language and cross-check
// it against the one real planned procedure (if any); it never decides
// whether something clinically happened. `confidence`/`modelSuggestsPlanCompletion`
// are the model's own read of its interpretation — metadata about the
// interpretation, not clinical authorization. The ONLY thing that turns a
// planned procedure into "confirmed" is a human clicking Confirm on the
// itemized preview built below, which execute() (called only from the
// server's /approve route, only after that click) then acts on. See
// cognitiveEvents.ts for how the underlying gap is detected.
//
// patientId/appointmentId are never trusted from the client here — both are
// derived from the pending_items/{gapId} doc itself, which only ELIZA's own
// server-side detector (cognitiveEvents.ts) ever writes. This closes the
// path where a client could pass a mismatched/spoofed appointmentId or
// patientId alongside a real gapId.

export interface ProposeClinicalEvolutionInput {
  gapId: string; // pending_items doc id — the only client-supplied identifier
  professionalResponse: string;
}

// Three-way classification of the professional's free-text reply, decided
// BEFORE anything can turn into a proposal. Only "clinical_description" may
// ever produce a preview/executionInput. Fail-safe by construction: every
// branch of parseClinicalEvolutionModelOutput below that isn't unambiguously
// "clinical_description" with real content falls back to
// "insufficient_or_ambiguous" — a parse error, an unrecognized messageType,
// a self-reported low classification confidence, or a "clinical_description"
// with no actual procedure content are all treated identically, never as a
// path that could reach execute().
type MessageType = "question_or_command" | "insufficient_or_ambiguous" | "clinical_description";

// Static, never AI-generated — the one message shown whenever the model's
// classification is missing, malformed, or not confidently a clinical
// description. Zero invention risk on the fail-safe path itself.
const INSUFFICIENT_INFO_CLARIFICATION = "Não consegui determinar com segurança o que foi realizado nesse atendimento. Pode me informar o procedimento realizado?";

interface ClinicalEvolutionModelOutput {
  messageType: MessageType;
  /** Only meaningful for "question_or_command" — ELIZA's reply, built only from the real facts already in the prompt. */
  clarificationReply: string;
  evolutionText: string;
  /** Itemized, in the professional's own terms — shown to the human before any write. */
  proceduresUnderstoodAsDone: string[];
  /** The model's own read of whether the planned procedure was mentioned as done — metadata, not authorization. */
  modelSuggestsPlanCompletion: boolean;
  confidence: "alta" | "ambigua";
  caveats: string[];
}

function insufficientOutput(fallbackText: string, caveat?: string): ClinicalEvolutionModelOutput {
  return {
    messageType: "insufficient_or_ambiguous",
    clarificationReply: INSUFFICIENT_INFO_CLARIFICATION,
    evolutionText: fallbackText,
    proceduresUnderstoodAsDone: [],
    modelSuggestsPlanCompletion: false,
    confidence: "ambigua",
    caveats: caveat ? [caveat] : [],
  };
}

function parseClinicalEvolutionModelOutput(raw: string, fallbackText: string): ClinicalEvolutionModelOutput {
  let parsed: any;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    // Parse failure — never block, never guess. Same safe path as any other
    // unrecognized shape below.
    return insufficientOutput(fallbackText, "Não foi possível interpretar a resposta automaticamente de forma estruturada — revise o texto da evolução antes de confirmar.");
  }

  const messageType = parsed?.messageType;
  const validTypes: MessageType[] = ["question_or_command", "insufficient_or_ambiguous", "clinical_description"];
  if (typeof messageType !== "string" || !validTypes.includes(messageType as MessageType)) {
    return insufficientOutput(fallbackText, "Classificação da mensagem não reconhecida — tratado como informação insuficiente por segurança.");
  }

  // Self-reported confidence in the classification itself (distinct from
  // `confidence`, which is about matching the PLANNED procedure and only
  // applies once we're already in "clinical_description"). Anything other
  // than an explicit "alta" here fails safe, per the same "on doubt, don't
  // guess" rule as everywhere else in this file.
  const messageTypeConfidence = parsed?.messageTypeConfidence;
  if (messageType !== "insufficient_or_ambiguous" && messageTypeConfidence !== "alta") {
    return insufficientOutput(fallbackText, "Baixa confiança na classificação da mensagem — tratado como informação insuficiente por segurança.");
  }

  if (messageType === "question_or_command") {
    const reply = typeof parsed.clarificationReply === "string" && parsed.clarificationReply.trim()
      ? parsed.clarificationReply.trim()
      : INSUFFICIENT_INFO_CLARIFICATION; // fail-safe: classified as a question but no reply text — still never becomes a proposal
    return {
      messageType: "question_or_command",
      clarificationReply: reply,
      evolutionText: "",
      proceduresUnderstoodAsDone: [],
      modelSuggestsPlanCompletion: false,
      confidence: "ambigua",
      caveats: [],
    };
  }

  if (messageType === "insufficient_or_ambiguous") {
    return insufficientOutput(fallbackText);
  }

  // messageType === "clinical_description" — the only branch that can ever
  // reach a real proposal. Still demoted to the safe path if it turns out
  // to carry no actual description, despite the label.
  const proceduresUnderstoodAsDone = Array.isArray(parsed.proceduresUnderstoodAsDone)
    ? parsed.proceduresUnderstoodAsDone.filter((p: any) => typeof p === "string" && p.trim()).map((p: string) => p.trim())
    : [];
  const evolutionText = typeof parsed.evolutionText === "string" && parsed.evolutionText.trim() ? parsed.evolutionText.trim() : "";
  if (proceduresUnderstoodAsDone.length === 0 && !evolutionText) {
    return insufficientOutput(fallbackText, "Classificado como descrição clínica, mas sem conteúdo concreto — tratado como informação insuficiente por segurança.");
  }

  return {
    messageType: "clinical_description",
    clarificationReply: "",
    evolutionText: evolutionText || fallbackText,
    proceduresUnderstoodAsDone,
    modelSuggestsPlanCompletion: parsed.modelSuggestsPlanCompletion === true && parsed.confidence === "alta",
    confidence: parsed.confidence === "alta" ? "alta" : "ambigua",
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c: any) => typeof c === "string") : [],
  };
}

export interface ClinicalEvolutionExecutionInput {
  clinicId: string;
  patientId: string;
  appointmentId: string;
  gapId: string;
  planningId: string | null;
  versionId: string | null;
  plannedProcedureName: string | null;
  evolutionText: string;
  /** Computed here from the model's read, but this value only ever takes
   *  effect if a human clicks Confirm on the preview that discloses it — see
   *  the module comment above. */
  willMarkPlanCompleted: boolean;
  professionalResponse: string;
  treatmentResolution: TreatmentResolution;
  /** Only meaningful (and only ever read) when treatmentResolution.mode is
   *  "ambiguous" — the human's explicit pick among treatmentResolution.candidates.
   *  Never set by propose(); only ever arrives via a server-side override
   *  applied at /approve time, after the human chose on the preview. */
  selectedTreatmentId?: string | null;
}

interface TreatmentCandidate { id: string; description: string; }

// mode:
//  - 'structural': an existing treatment already has an evolution whose
//    clinicalPlanRef.planningId matches this exact plan — a real ID match,
//    not text. Highest priority, safe to apply automatically.
//  - 'unique-text': no structural match, but exactly one existing treatment's
//    description matches the appointment's own label/planned procedure name.
//    Only auto-applied because it's unambiguous (single candidate).
//  - 'new': no structural or textual match at all — safe to create ELIZA's
//    own dedicated, exact-keyed container (no existing record touched).
//  - 'ambiguous': two or more equally-plausible existing treatments found by
//    text — none are chosen automatically. execute() refuses to write until
//    a human picks one (see resolvedTreatmentId below).
interface TreatmentResolution {
  mode: "structural" | "unique-text" | "new" | "ambiguous";
  resolvedTreatmentId: string | null;
  candidates: TreatmentCandidate[];
}

// Read-only — safe to call from propose(), which must never write. Decides
// which existing treatment (if any) an evolution should attach to, per the
// review requirement: structural references first, text only when there is
// exactly one unambiguous candidate, and never a silent guess when there are
// several plausible ones.
async function resolveTreatmentCandidate(
  db: Firestore,
  clinicId: string,
  patientId: string,
  appointmentId: string,
  planningId: string | null,
  textLabel: string | null
): Promise<TreatmentResolution> {
  const treatmentsSnap = await db.collection(`clinics/${clinicId}/patients/${patientId}/treatments`).get();

  if (planningId) {
    const structuralMatches = treatmentsSnap.docs.filter((doc) =>
      ((doc.data()?.evolutions || []) as { clinicalPlanRef?: { planningId?: string } }[]).some((e) => e?.clinicalPlanRef?.planningId === planningId)
    );
    if (structuralMatches.length === 1) {
      return { mode: "structural", resolvedTreatmentId: structuralMatches[0].id, candidates: [] };
    }
    if (structuralMatches.length > 1) {
      return {
        mode: "ambiguous",
        resolvedTreatmentId: null,
        candidates: structuralMatches.map((d) => ({ id: d.id, description: d.data()?.description || "Tratamento" })),
      };
    }
  }

  if (textLabel) {
    const textMatches = treatmentsSnap.docs.filter((doc) => String(doc.data()?.description || "").trim().toLowerCase() === textLabel.trim().toLowerCase());
    if (textMatches.length === 1) {
      return { mode: "unique-text", resolvedTreatmentId: textMatches[0].id, candidates: [] };
    }
    if (textMatches.length > 1) {
      return {
        mode: "ambiguous",
        resolvedTreatmentId: null,
        candidates: textMatches.map((d) => ({ id: d.id, description: d.data()?.description || "Tratamento" })),
      };
    }
  }

  return { mode: "new", resolvedTreatmentId: `eliza_evolution_${appointmentId}`, candidates: [] };
}

export type ClinicalEvolutionProposeResult =
  | { type: "clarification"; message: string; messageType: "question_or_command" | "insufficient_or_ambiguous" }
  | { preview: ActionProposalPreview; executionInput: ClinicalEvolutionExecutionInput };

export async function proposeClinicalEvolution(
  input: ProposeClinicalEvolutionInput,
  ctx: ProposeContext
): Promise<ClinicalEvolutionProposeResult> {
  if (!input.gapId || !input.professionalResponse?.trim()) {
    throw new Error("gapId e professionalResponse são obrigatórios.");
  }

  // Trusted source of patientId/appointmentId — never the raw request body.
  const gapSnap = await ctx.db.doc(`clinics/${ctx.clinicId}/pending_items/${input.gapId}`).get();
  if (!gapSnap.exists) throw new Error("Pendência cognitiva não encontrada nesta clínica.");
  const gap = gapSnap.data()!;
  if (gap.type !== "eliza_cognitive_gap") throw new Error("Este item não é uma pendência cognitiva da ELIZA.");
  if (gap.status !== "pending") throw new Error("Esta pendência já foi resolvida — nada a propor.");
  const patientId: string = gap.patientId;
  const appointmentId: string = gap.appointmentId;
  if (!patientId || !appointmentId) throw new Error("Pendência cognitiva incompleta.");

  const patientSnap = await ctx.db.doc(`clinics/${ctx.clinicId}/patients/${patientId}`).get();
  if (!patientSnap.exists) throw new Error("Paciente não encontrado nesta clínica.");
  const patientName = patientSnap.data()?.name || "Paciente";

  const apptSnap = await ctx.db.doc(`clinics/${ctx.clinicId}/appointments/${appointmentId}`).get();
  if (!apptSnap.exists) throw new Error("Atendimento não encontrado nesta clínica.");
  const appt = apptSnap.data() || {};
  const apptDateLabel: string = appt.date || "data não registrada";

  const planRef = appt.clinicalPlanRef as { planningId: string; versionId: string } | null | undefined;
  let plannedProcedureName: string | null = null;
  if (planRef?.planningId && planRef?.versionId) {
    const versionSnap = await ctx.db
      .doc(`clinics/${ctx.clinicId}/patients/${patientId}/clinical_plans/${planRef.planningId}/versions/${planRef.versionId}`)
      .get();
    plannedProcedureName = versionSnap.exists ? versionSnap.data()?.procedureName || null : null;
  }

  const treatmentTextLabel: string | null = appt.treatment || plannedProcedureName || null;
  const treatmentResolution = await resolveTreatmentCandidate(ctx.db, ctx.clinicId, patientId, appointmentId, planRef?.planningId || null, treatmentTextLabel);

  const prompt = `Você é a ELIZA, ajudando a estruturar o registro de evolução clínica de um atendimento odontológico já finalizado.

FATOS REAIS (os únicos dados em que você pode confiar):
- Paciente: ${patientName}
- Data do atendimento: ${apptDateLabel}
${plannedProcedureName ? `- Procedimento planejado nesta clínica para este paciente, ainda sem execução confirmada: ${plannedProcedureName}` : "- Não há procedimento planejado vinculado a este atendimento."}

MENSAGEM DO PROFISSIONAL (única fonte sobre o que foi realizado — nunca invente nada além disso):
"${input.professionalResponse.trim()}"

TAREFA — classifique PRIMEIRO esta mensagem em exatamente uma categoria (messageType):
- "question_or_command": é uma pergunta, pedido de informação ou comando conversacional — NÃO descreve nenhum procedimento realizado. Exemplos: "qual procedimento está pendente?", "qual era o planejamento?", "me mostra o prontuário", "qual dente?".
- "insufficient_or_ambiguous": menciona o atendimento, mas não descreve com clareza qual procedimento foi realizado. Exemplos: "fiz o procedimento", "atendi normalmente", respostas vagas ou incompletas.
- "clinical_description": descreve de forma concreta o que foi realizado no atendimento.

Informe também messageTypeConfidence ("alta" somente se você tiver certeza da classificação; "baixa" em qualquer dúvida). Na dúvida entre categorias, ou se messageTypeConfidence for "baixa", classifique como "insufficient_or_ambiguous" — nunca escolha "clinical_description" sem certeza e sem uma descrição concreta e inequívoca do procedimento realizado.

Se messageType for "question_or_command": responda a pergunta em clarificationReply usando SOMENTE os fatos reais listados acima — nunca invente dado clínico; se não souber responder com os fatos disponíveis, diga isso claramente; termine sempre retomando a pergunta sobre o que foi realizado no atendimento. Deixe proceduresUnderstoodAsDone e evolutionText vazios.

Se messageType for "insufficient_or_ambiguous": deixe clarificationReply, proceduresUnderstoodAsDone e evolutionText vazios.

Se messageType for "clinical_description":
1. Liste em proceduresUnderstoodAsDone, em itens curtos, exatamente o que você entendeu que foi realizado, nas palavras do profissional (ex: "Restauração do 26", "Profilaxia"). Nunca invente dente, região, material ou procedimento que não foi mencionado.
2. Escreva em evolutionText um texto curto e objetivo de evolução clínica, baseado SOMENTE no que foi mencionado.
3. Diga em modelSuggestsPlanCompletion se o procedimento planejado (se houver) foi CLARAMENTE mencionado como realizado pela resposta — isso é só a sua leitura, não decide nada sozinho. Só marque true e confidence "alta" se não houver ambiguidade nenhuma; qualquer menção vaga, parcial, ou procedimento diferente do planejado deve ser confidence "ambigua".
4. Liste em caveats qualquer ressalva real (ex: procedimento planejado não mencionado, resposta incompleta, menção a outro procedimento não planejado).

Responda APENAS com um JSON neste formato exato, sem texto fora do JSON:
{"messageType": "question_or_command" ou "insufficient_or_ambiguous" ou "clinical_description", "messageTypeConfidence": "alta" ou "baixa", "clarificationReply": "...", "proceduresUnderstoodAsDone": ["..."], "evolutionText": "...", "modelSuggestsPlanCompletion": true ou false, "confidence": "alta" ou "ambigua", "caveats": ["..."]}`;

  const raw = await ctx.generateText(prompt, "clinical_evolution_proposal");
  const modelOutput = parseClinicalEvolutionModelOutput(raw, input.professionalResponse.trim());

  if (modelOutput.messageType !== "clinical_description") {
    // Fail-safe path: a question, a conversational command, or an answer
    // with no concrete description of what was done. Never creates a
    // proposal, never touches treatments/executions — just a reply, with
    // the cognitive gap left open for the caller to keep the conversation
    // going on the next turn.
    return { type: "clarification", message: modelOutput.clarificationReply, messageType: modelOutput.messageType };
  }

  // This is the ONLY place this boolean is computed. It is disclosed in full
  // in the preview below; execute() never re-derives or second-guesses it —
  // it just carries out exactly what the human saw and confirmed.
  const willMarkPlanCompleted = !!(planRef?.planningId && planRef?.versionId) && modelOutput.modelSuggestsPlanCompletion;

  const details: Record<string, any> = {
    patientName,
    proceduresUnderstoodAsDone: modelOutput.proceduresUnderstoodAsDone,
    evolutionText: modelOutput.evolutionText,
    plannedProcedureName,
    willMarkPlanCompleted,
    caveats: modelOutput.caveats,
    confidence: modelOutput.confidence,
    treatmentResolutionMode: treatmentResolution.mode,
    treatmentCandidates: treatmentResolution.candidates,
  };

  // Itemized, matches exactly the "Entendi que hoje foi realizado / Vou
  // registrar a seguinte evolução / Também encontrei este procedimento no
  // planejamento.../ Confirmar?" shape requested — a single human click on
  // this exact text is what authorizes execute() to write anything.
  const summaryLines: string[] = [];
  if (modelOutput.proceduresUnderstoodAsDone.length > 0) {
    summaryLines.push("Entendi que hoje foi realizado:");
    summaryLines.push(...modelOutput.proceduresUnderstoodAsDone.map((p) => `– ${p}`));
    summaryLines.push("");
  }
  summaryLines.push("Vou registrar a seguinte evolução:");
  summaryLines.push(modelOutput.evolutionText);
  if (plannedProcedureName) {
    summaryLines.push("");
    if (willMarkPlanCompleted) {
      summaryLines.push("Também encontrei este procedimento no planejamento e vou marcá-lo como realizado:");
      summaryLines.push(`– ${plannedProcedureName}`);
    } else {
      summaryLines.push(`O procedimento planejado "${plannedProcedureName}" não foi claramente confirmado — vou deixá-lo como pendente.`);
    }
  }
  if (treatmentResolution.mode === "ambiguous") {
    summaryLines.push("");
    summaryLines.push("Encontrei mais de uma ficha (tratamento) possível para registrar essa evolução — escolha uma antes de confirmar:");
    summaryLines.push(...treatmentResolution.candidates.map((c) => `– ${c.description}`));
  }
  summaryLines.push("");
  summaryLines.push("Confirmar?");

  return {
    preview: { summary: summaryLines.join("\n"), details },
    executionInput: {
      clinicId: ctx.clinicId,
      patientId,
      appointmentId,
      gapId: input.gapId,
      planningId: planRef?.planningId || null,
      versionId: planRef?.versionId || null,
      plannedProcedureName,
      evolutionText: modelOutput.evolutionText,
      willMarkPlanCompleted,
      professionalResponse: input.professionalResponse.trim(),
      treatmentResolution,
      selectedTreatmentId: null,
    },
  };
}

export async function executeClinicalEvolution(
  input: ClinicalEvolutionExecutionInput,
  ctx: ExecuteContext
): Promise<{ treatmentId: string; evolutionId: string; executionUpdated: boolean }> {
  const memberSnap = await ctx.db.doc(`clinics/${ctx.clinicId}/members/${ctx.uid}`).get();
  const professionalName: string = memberSnap.exists ? memberSnap.data()?.name || "Profissional" : "Profissional";
  const nowIso = new Date().toISOString();

  // Resolve which treatment gets the evolution — computed once by propose()
  // (structural reference > unique text match > dedicated new container),
  // never re-decided here. The one exception execute() enforces itself,
  // as a hard backstop even if a caller somehow skipped the UI: an
  // "ambiguous" resolution with no human-selected treatment is refused
  // outright — never guessed.
  const resolution = input.treatmentResolution;
  let treatmentId: string;
  if (resolution.mode === "ambiguous") {
    if (!input.selectedTreatmentId) {
      throw new Error("Múltiplas fichas (tratamentos) possíveis foram encontradas para este paciente — é necessário escolher uma antes de gravar a evolução.");
    }
    treatmentId = input.selectedTreatmentId;
  } else {
    treatmentId = resolution.resolvedTreatmentId!;
  }
  const treatmentRef = ctx.db.doc(`clinics/${ctx.clinicId}/patients/${input.patientId}/treatments/${treatmentId}`);

  if (resolution.mode === "new") {
    // No existing treatment referenced at all — safe to create ELIZA's own
    // dedicated, exact-keyed container. .create() is atomic: a second
    // concurrent execute() call for the same appointment gets ALREADY_EXISTS
    // and reuses the same doc instead of creating a duplicate.
    try {
      await treatmentRef.create({
        description: input.plannedProcedureName || "Atendimento Clínico",
        professional: professionalName,
        status: "active",
        source: "eliza_cognitive_gap",
        appointmentId: input.appointmentId,
        evolutions: [],
      });
    } catch (err: any) {
      if (!(err?.code === 6 || /already exists/i.test(String(err?.message || "")))) throw err;
    }
  } else {
    // Attaching to an existing, human-created treatment (structural match,
    // unique text match, or an explicit human pick among ambiguous
    // candidates) — never create, only verify it still exists.
    const existing = await treatmentRef.get();
    if (!existing.exists) throw new Error("O tratamento selecionado não existe mais nesta clínica.");
  }

  // Deterministic evolution id (one gap = one evolution write). Idempotent:
  // if this exact entry is already present (a retry, or a race that lost
  // the treatment-create above but still reaches here), skip the write
  // instead of appending a duplicate.
  const evolutionId = input.gapId;
  const treatmentSnap = await treatmentRef.get();
  const alreadyWritten = ((treatmentSnap.data()?.evolutions || []) as { id?: string }[]).some((e) => e.id === evolutionId);
  if (!alreadyWritten) {
    await treatmentRef.update({
      evolutions: FieldValue.arrayUnion({
        id: evolutionId,
        text: input.evolutionText,
        date: nowIso,
        professional: professionalName,
        ...(input.planningId && input.versionId ? { clinicalPlanRef: { planningId: input.planningId, versionId: input.versionId, procedureName: input.plannedProcedureName || undefined } } : {}),
      }),
    });
  }

  let executionUpdated = false;
  if (input.willMarkPlanCompleted && input.planningId && input.versionId) {
    const executionsRef = ctx.db.collection(
      `clinics/${ctx.clinicId}/patients/${input.patientId}/clinical_plans/${input.planningId}/executions`
    );
    // Deterministic id (the gap id) — same atomic-create idempotency
    // guarantee as the treatment above, so a repeated/concurrent execute()
    // can never create two execution docs for the same event.
    const execRef = executionsRef.doc(input.gapId);
    const versionSnap = await ctx.db
      .doc(`clinics/${ctx.clinicId}/patients/${input.patientId}/clinical_plans/${input.planningId}/versions/${input.versionId}`)
      .get();
    const versionData = versionSnap.exists ? versionSnap.data() || {} : {};

    try {
      await execRef.create({
        planningId: input.planningId,
        versionId: input.versionId,
        procedureId: versionData.procedureId || input.planningId,
        procedureName: input.plannedProcedureName || versionData.procedureName || "Procedimento planejado",
        patientId: input.patientId,
        appointmentId: input.appointmentId,
        status: "confirmed",
        startedBy: ctx.uid,
        startedByName: professionalName,
        startedAt: nowIso,
        confirmedBy: ctx.uid,
        confirmedByName: professionalName,
        confirmedAt: nowIso,
        usedPlanAsBase: false,
        plannedSnapshot: {
          versionNumber: versionData.versionNumber || 1,
          procedureName: versionData.procedureName || input.plannedProcedureName || "",
          structuredFields: {},
          strokesJson: null,
        },
        executionFields: {},
        strokesJson: null,
        observations: input.evolutionText,
        complications: "",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } catch (err: any) {
      if (!(err?.code === 6 || /already exists/i.test(String(err?.message || "")))) throw err;
      // Already created by a previous/concurrent run — nothing left to do,
      // still report it as updated since the confirmed state exists.
    }
    executionUpdated = true;
  }

  await resolveCognitiveGap(ctx.db, ctx.clinicId, input.gapId, ctx.uid);

  return { treatmentId, evolutionId, executionUpdated };
}

// ============================================================================
// REGISTRY
// ============================================================================

export const ACTION_REGISTRY: Record<ActionType, {
  propose: (input: any, ctx: ProposeContext) => Promise<
    { preview: ActionProposalPreview; executionInput: any } | { type: "clarification"; message: string; messageType: string }
  >;
  execute: (input: any, ctx: ExecuteContext) => Promise<any>;
}> = {
  create_task: { propose: proposeCreateTask, execute: executeCreateTask },
  create_appointment_request: { propose: proposeCreateAppointmentRequest, execute: executeCreateAppointmentRequest },
  prepare_message: { propose: proposePrepareMessage, execute: executePrepareMessage },
  prepare_campaign: { propose: proposePrepareCampaign, execute: executePrepareCampaign },
  propose_clinical_evolution: { propose: proposeClinicalEvolution, execute: executeClinicalEvolution },
};
