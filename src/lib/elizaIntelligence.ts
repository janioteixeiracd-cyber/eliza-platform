/**
 * ELIZA Intelligence Layer - Main Orchestration Engine
 * Coordinates all AI operations: context, prompts, model calls, tools, auditing
 */

import {
  ElizaContext,
  ElizaIntelligenceRequest,
  ElizaIntelligenceResponse,
  ElizaIntelligenceErrorResponse,
  ElizaError,
  ElizaErrorCode,
  AuditMetadata,
  AIAuditLog,
} from "../types/eliza-intelligence";
import { buildContext } from "../services/elizaContextBuilder";
import { getAvailableTools, executeTool } from "../lib/elizaToolRegistry";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { getAdminDb } from "./adminFirebase";

// UUID generator (no need for uuid package)
function generateRequestId(): string {
  return randomUUID();
}

// ============================================================================
// TYPES
// ============================================================================

interface PromptBuildResult {
  systemInstruction: string;
  userMessage: string;
}

interface ModelCallResult {
  text: string;
  provider: "gemini" | "openai";
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export class ElizaIntelligenceLayer {
  /**
   * Main entry point - executes an intelligence request
   * SECURITY: All state is local to this method - no shared state between requests
   * This prevents concurrent requests from interfering with each other
   */
  async execute(
    req: any,
    elizaRequest: ElizaIntelligenceRequest
  ): Promise<{
    response: ElizaIntelligenceResponse;
    audit: AuditMetadata;
  }> {
    // LOCAL STATE - unique per request, never shared
    const requestId = generateRequestId();
    const startTime = Date.now();
    // Declared here (not `const` inside the try block) so the catch block
    // below can still log a real audit entry if the request built a context
    // before failing later — only truly unbuilt contexts fall back to the
    // "unknown" placeholder.
    let audit: AuditMetadata | null = null;

    try {
      // 1. Build context
      console.log(`[ELIZA:${requestId}] Building context...`);
      const context = await buildContext(req, elizaRequest);

      // LOCAL audit object - not stored in instance
      audit = {
        requestId,
        clinicId: context.clinicId,
        userId: context.userId,
        timestamp: new Date(),
        ipAddress: req.ip || req.connection.remoteAddress,
      };

      // 2. Build prompt
      console.log(`[ELIZA:${requestId}] Building prompt...`);
      const promptResult = await this.buildPrompt(context);

      // 3. Call AI model
      console.log(`[ELIZA:${requestId}] Calling AI model...`);
      const modelResult = await this.callModel(context, promptResult, requestId);

      // 4. Process response
      console.log(`[ELIZA:${requestId}] Processing response...`);
      const analysisResult = await this.processResponse(context, modelResult);

      // 5. Handle tools if needed
      let executedActions: any[] = [];
      if (context.request.requestedTools && context.request.requestedTools.length > 0) {
        console.log(`[ELIZA:${requestId}] Executing tools...`);
        executedActions = await this.executionRequestedTools(context, analysisResult);
      }

      // 6. Log audit trail
      await this.logAuditTrail(context, {
        status: "success",
        modelUsed: modelResult.model,
        tokensUsed: {
          input: modelResult.inputTokens,
          output: modelResult.outputTokens,
          total: modelResult.inputTokens + modelResult.outputTokens,
        },
      }, audit, requestId);

      const processingTime = Date.now() - startTime;

      const response: ElizaIntelligenceResponse = {
        success: true,
        data: {
          analysisResult: {
            type: "text",
            content: analysisResult.text,
            alerts: analysisResult.alerts || [],
          },
          metadata: {
            taskType: context.request.taskType,
            modelUsed: modelResult.model,
            provider: modelResult.provider,
            tokensUsed: {
              input: modelResult.inputTokens,
              output: modelResult.outputTokens,
              total: modelResult.inputTokens + modelResult.outputTokens,
            },
            executedTools: [],
            processingTime,
            conversationId: context.conversationHistory.id,
          },
          executedActions: executedActions.length > 0 ? executedActions : undefined,
        },
        audit: audit,
      };

      console.log(`[ELIZA:${requestId}] ✅ Request completed in ${processingTime}ms`);

      return { response, audit: audit };
    } catch (err: any) {
      const processingTime = Date.now() - startTime;
      const elizaError = err instanceof ElizaError ? err : this.wrapError(err);

      // Log error audit — only possible if context was built far enough to
      // know which clinic/user this was; an earlier failure (e.g. bad auth)
      // never reaches that point, so there's nothing scoped to log against.
      const fallbackAudit: AuditMetadata = audit || { requestId, clinicId: "unknown", userId: "unknown", timestamp: new Date() };
      if (audit) {
        await this.logAuditTrail(
          {} as ElizaContext,
          {
            status: "failed",
            error: {
              code: elizaError.code,
              message: elizaError.message,
            },
          },
          audit,
          requestId
        ).catch((e) => console.error(`[ELIZA] Failed to log error audit:`, e));
      }

      console.error(`[ELIZA:${requestId}] ❌ Error after ${processingTime}ms:`, elizaError.message);

      const errorResponse: ElizaIntelligenceErrorResponse = {
        success: false,
        error: {
          code: elizaError.code,
          message: elizaError.message,
          details: elizaError.details ? JSON.stringify(elizaError.details) : undefined,
          debug: process.env.NODE_ENV === "development" ? { stackTrace: elizaError.stack } : undefined,
        },
        audit: fallbackAudit,
      };

      throw errorResponse;
    }
  }

  /**
   * Builds prompt for the AI model
   */
  private async buildPrompt(context: ElizaContext): Promise<PromptBuildResult> {
    // Select base prompt template
    const basePrompt = this.getSystemPromptForTaskType(context.request.taskType);

    // Build context-aware prompt
    let contextInfo = "";

    if (context.patient) {
      contextInfo += `\n\n=== CONTEXTO DO PACIENTE ===\n`;
      contextInfo += `Nome: ${context.patient.name}\n`;
      contextInfo += `Idade: ${context.patient.age}\n`;
      if (context.patient.allergies.length > 0) {
        contextInfo += `Alergias: ${context.patient.allergies.join(", ")}\n`;
      }
      if (context.patient.activeProblems.length > 0) {
        contextInfo += `Problemas Ativos: ${context.patient.activeProblems.join(", ")}\n`;
      }
    }

    // Add conversation context
    if (context.conversationHistory.messages.length > 0) {
      contextInfo += `\n\n=== HISTÓRICO DE CONVERSA ===\n`;
      const recentMessages = context.conversationHistory.messages.slice(-5);
      for (const msg of recentMessages) {
        const role = msg.role === "user" ? "Usuário" : "ELIZA";
        contextInfo += `${role}: ${msg.content}\n`;
      }
    }

    const systemInstruction = basePrompt + contextInfo;
    const userMessage = context.request.userPrompt;

    return { systemInstruction, userMessage };
  }

  /**
   * Gets system prompt based on task type
   */
  private getSystemPromptForTaskType(taskType: string): string {
    const prompts: Record<string, string> = {
      patient_analysis: `Você é um assistente de IA especializado em análise de prontuários odontológicos.
Sua tarefa é analisar dados clínicos e fornecer insights claros, estruturados e baseados em evidências.
- NUNCA invente dados ou diagnósticos
- SEMPRE cite as evidências clínicas disponíveis
- Diferencie entre fatos confirmados, hipóteses e recomendações
- Mantenha tom profissional mas acessível`,

      treatment_plan: `Você é um especialista em planejamento de tratamento odontológico.
Sua tarefa é criar planos de tratamento detalhados, considerando:
- Condições clínicas do paciente
- Possíveis alternativas de tratamento
- Prognóstico esperado
- Custos e tempo estimado
- Cuidados pós-tratamento
- Sempre peça aprovação antes de executar ações`,

      financial_insight: `Você é um analista financeiro para clínicas odontológicas.
Sua tarefa é analisar dados financeiros e fornecer insights sobre:
- Fluxo de caixa
- Receita por procedimento
- Tendências de pagamento
- Recomendações de otimização
- Identifique padrões e anomalias`,

      recall_suggestion: `Você é um sistema de recall inteligente.
Sua tarefa é sugerir lembretes de retorno para pacientes baseado em:
- Histórico de procedimentos
- Intervalos recomendados entre visitas
- Quadro clínico
- Comportamento de comparecimento
- Risco de complicações`,

      clinical_alert: `Você é um sistema de alertas clínicos.
Sua tarefa é identificar situações que requerem atenção imediata:
- Sinais de risco clínico
- Necessidade de intervenção urgente
- Complicações potenciais
- Recomendações de encaminhamento`,

      whatsapp_response: `Você é a Elisa, uma secretária virtual de uma clínica odontológica premium.
Sua tarefa é responder mensagens de WhatsApp de forma:
- Profissional mas amigável
- Concisa (máximo 3 linhas)
- Útil e direcionada para agendamento ou informações
- Sempre ofereça próximo passo claro`,

      marketing_copy: `Você é um redator de marketing para odontologia estética.
Sua tarefa é criar textos persuasivos mas éticos para:
- Redes sociais
- Campanhas por WhatsApp
- Email marketing
- Sempre enfatize resultados reais e segurança`,

      contract_review: `Você é um especialista em revisão de contratos de tratamento.
Sua tarefa é revisar contratos e identificar:
- Cláusulas contraditórias
- Riscos legais
- Termos que protegem adequadamente clínica e paciente
- Pontos de melhoria`,
    };

    return prompts[taskType] || prompts.patient_analysis;
  }

  /**
   * Calls the AI model (Gemini or OpenAI)
   */
  private async callModel(
    context: ElizaContext,
    promptResult: PromptBuildResult,
    requestId: string
  ): Promise<ModelCallResult> {
    const provider = context.request.preferredProvider || context.clinicData.config.aiProviderPrincipal;
    const model = this.selectModel(context);

    console.log(`[ELIZA:${requestId}] Using provider=${provider}, model=${model}`);

    // Try primary provider
    try {
      if (provider === "openai") {
        return await this.callOpenAI(model, promptResult);
      } else {
        return await this.callGemini(model, promptResult);
      }
    } catch (primaryErr: any) {
      console.warn(`[ELIZA:${requestId}] Primary provider failed, trying fallback...`);

      // Try fallback provider
      const fallback = provider === "openai" ? "gemini" : "openai";
      const fallbackModel = fallback === "openai" ? "gpt-4o-mini" : "gemini-3.5-flash";

      try {
        if (fallback === "openai") {
          return await this.callOpenAI(fallbackModel, promptResult);
        } else {
          return await this.callGemini(fallbackModel, promptResult);
        }
      } catch (fallbackErr: any) {
        throw new ElizaError(
          ElizaErrorCode.MODEL_UNAVAILABLE,
          `Nenhum provedor de IA está disponível. Tente novamente mais tarde.`,
          503,
          { primaryError: primaryErr.message, fallbackError: fallbackErr.message }
        );
      }
    }
  }

  /**
   * Calls Gemini API
   */
  private async callGemini(
    model: string,
    promptResult: PromptBuildResult
  ): Promise<ModelCallResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ElizaError(
        ElizaErrorCode.MODEL_ERROR,
        "GEMINI_API_KEY não configurada",
        500
      );
    }

    const genai = new GoogleGenAI({ apiKey });

    try {
      const response = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: promptResult.userMessage }] }],
        config: { systemInstruction: promptResult.systemInstruction },
      });

      const text = response.text || "";
      
      // Estimate tokens
      const inputTokens = Math.ceil(
        (promptResult.systemInstruction.length + promptResult.userMessage.length) / 4
      );
      const outputTokens = Math.ceil(text.length / 4);

      return {
        text,
        provider: "gemini",
        model,
        inputTokens,
        outputTokens,
      };
    } catch (err: any) {
      throw new ElizaError(
        ElizaErrorCode.MODEL_ERROR,
        `Erro ao chamar Gemini: ${err.message}`,
        500
      );
    }
  }

  /**
   * Calls OpenAI API
   */
  private async callOpenAI(
    model: string,
    promptResult: PromptBuildResult
  ): Promise<ModelCallResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ElizaError(
        ElizaErrorCode.MODEL_ERROR,
        "OPENAI_API_KEY não configurada",
        500
      );
    }

    const openai = new OpenAI({ apiKey });

    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: promptResult.systemInstruction },
          { role: "user", content: promptResult.userMessage },
        ],
        temperature: 0.7,
      });

      const text = response.choices[0]?.message?.content || "";

      return {
        text,
        provider: "openai",
        model,
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    } catch (err: any) {
      throw new ElizaError(
        ElizaErrorCode.MODEL_ERROR,
        `Erro ao chamar OpenAI: ${err.message}`,
        500
      );
    }
  }

  /**
   * Selects the appropriate model based on task type and clinic config
   */
  private selectModel(context: ElizaContext): string {
    const criticalTasks = ["patient_analysis", "treatment_plan", "clinical_alert"];
    const administrativeTasks = [
      "financial_insight",
      "recall_suggestion",
      "marketing_copy",
    ];

    if (criticalTasks.includes(context.request.taskType)) {
      return context.clinicData.config.aiModelClinical;
    } else if (administrativeTasks.includes(context.request.taskType)) {
      return context.clinicData.config.aiModelAdministrative;
    } else {
      return context.clinicData.config.aiModelFast;
    }
  }

  /**
   * Processes AI response
   */
  private async processResponse(
    context: ElizaContext,
    modelResult: ModelCallResult
  ): Promise<{ text: string; alerts?: string[] }> {
    // Basic processing - in production would have more sophisticated parsing
    return {
      text: modelResult.text,
      alerts: [],
    };
  }

  /**
   * Executes requested tools
   */
  private async executionRequestedTools(
    context: ElizaContext,
    analysisResult: any
  ): Promise<any[]> {
    const executedActions: any[] = [];
    const availableTools = getAvailableTools(context);

    for (const toolId of context.request.requestedTools || []) {
      const tool = availableTools.find((t) => t.id === toolId);
      if (!tool) {
        console.warn(`[ELIZA] Tool ${toolId} not available for user role`);
        continue;
      }

      try {
        // In production, would extract tool inputs from analysisResult
        // For now, just mark as proposed

        executedActions.push({
          toolId,
          status: "pending_approval",
          requiresApproval: tool.requiresApproval,
        });
      } catch (err: any) {
        console.error(`[ELIZA] Error executing tool ${toolId}:`, err);
      }
    }

    return executedActions;
  }

  /**
   * Logs audit trail to Firestore
   */
  private async logAuditTrail(
    context: ElizaContext,
    result: any,
    audit: AuditMetadata,
    requestId: string
  ): Promise<void> {
    if (!audit.clinicId) return;

    try {
      const auditLog: AIAuditLog = {
        requestId: requestId,
        clinicId: audit.clinicId,
        userId: audit.userId,
        timestamp: new Date(),
        operation: "analyze",
        taskType: context.request?.taskType || "unknown",
        status: result.status || "unknown",
        request: {
          prompt: context.request?.userPrompt?.substring(0, 500) || "",
          patientId: context.patient?.id,
          tools: context.request?.requestedTools || [],
        },
        response: {
          modelUsed: result.modelUsed || "unknown",
          provider: result.provider || "unknown",
          tokensUsed: result.tokensUsed || { input: 0, output: 0, total: 0 },
        },
        error: result.error,
        actions: [],
      };

      await getAdminDb()
        .collection("clinics")
        .doc(audit.clinicId)
        .collection("ai_audit_logs")
        .doc(requestId)
        .set(auditLog);
    } catch (err: any) {
      console.error(`[ELIZA] Failed to log audit trail:`, err.message);
    }
  }

  /**
   * Wraps generic errors as ElizaErrors
   */
  private wrapError(err: any): ElizaError {
    if (err instanceof ElizaError) return err;

    return new ElizaError(
      ElizaErrorCode.INTERNAL_ERROR,
      err?.message || "Erro interno desconhecido",
      500
    );
  }
}

// Export singleton instance
export const elizaIntelligence = new ElizaIntelligenceLayer();
