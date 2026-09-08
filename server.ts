import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { rateLimit } from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import twilio from "twilio";
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from "firebase/app";
import { getFirestore as getClientFirestore, doc, getDoc, setDoc, getDocs, collection, serverTimestamp, increment, addDoc } from "firebase/firestore";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";

// ELIZA Intelligence Layer (v1 — kept running as-is; see plan notes before
// removing: unused by any real screen today, JWT-based auth, not the layer
// new code calls into)
import { elizaIntelligence } from "./src/lib/elizaIntelligence";
import { elizaAuthMiddleware } from "./src/lib/elizaAuthService";
import { ElizaIntelligenceRequest, ElizaError, ElizaErrorCode } from "./src/types/eliza-intelligence";
import * as authController from "./src/controllers/authController";

// ELIZA Intelligence v2 — real Firebase-auth orchestrator, deterministic
// tools, rule-based Insight Engine. See src/lib/elizaCore/.
import { authenticateElizaRequest, authenticateAcademyRequest, canAccessFinance, validatePatientBelongsToClinic } from "./src/lib/elizaCore/auth";
import { normalizeFunctionalRole, FUNCTIONAL_ROLE_LABELS, ROLE_FRAMING_HINTS } from "./src/lib/elizaCore/functionalRole";
import { checkStandingGaps } from "./src/lib/elizaCore/insightGapBridge";
import { getAgendaAnalysis, getFinancialSummary, comparePeriods, getOpenBudgets, getRecallCandidates, getPendingItems, getPatientContext, resolvePatientsByName } from "./src/lib/elizaCore/tools";
import { buildInsights } from "./src/lib/elizaCore/insightEngine";
import type { Insight } from "./src/lib/elizaCore/types";
import { ACTION_REGISTRY, ACTIONS_REQUIRING_ADMIN, type ActionType } from "./src/lib/elizaCore/actions";
import { detectFinishedAppointmentWithoutClinicalUpdate } from "./src/lib/elizaCore/cognitiveEvents";
import { getTemporalOverview, detectTemporalChanges } from "./src/lib/elizaCore/temporal";
import { getTemplateForId, DOCUMENT_TYPE_LABELS, type DocumentType } from "./src/lib/planningTemplates";

// Cadastro → Checkout (Asaas) + e-mails via Hostinger SMTP
import { findOrCreateAsaasCustomer, createAsaasSubscription } from "./src/server/asaasClient";
import { sendVerificationEmail, sendPaymentConfirmationEmail, sendClinicCreatedEmail, sendPlanChangedEmail, sendAdminPasswordChangedEmail } from "./src/server/mailer";
import { PLAN_ROLE_LABELS, type PlanRole } from "./src/lib/planCapabilities";

// WhatsApp Embedded Signup (Coexistence) — plano vast-yawning-hamster.md v4.
// Etapa A, fase local seguinte: só start-attempt/exchange, clientes de
// Secret Manager e Graph API mockados nos testes, nenhuma chamada real.
import { getSecretManagerClient } from "./src/lib/secretManager";
import { getWhatsAppGraphClient } from "./src/lib/whatsappGraphClient";
import { getWhatsAppSecretProvisioner } from "./src/lib/whatsappSecretProvisioner";

// Simples Dental Bridge integration surface — read-only, Fase 1 (ver
// SHADOW_MODE_READINESS.md no repositório da Bridge). Autenticação própria,
// nunca sessão de usuário Firebase; a Bridge nunca recebe credencial do
// Firestore.
import { createBridgeAuthMiddleware } from "./src/lib/bridgeAuth";
import { fetchBridgePatientState } from "./src/lib/bridgeState";
import { createBridgeSyncAuthMiddleware } from "./src/lib/bridgeSyncAuth";
import { upsertAppointmentFromBridge, upsertFinancialEntryFromBridge, BridgePatientNotFoundError } from "./src/lib/bridgeSync";

const AdminFieldValue = FieldValue;

async function startServer() {
  const logFile = path.join(process.cwd(), "startup.log");
  fs.writeFileSync(logFile, "=== START SERVER DIAGNOSTICS ===\n", "utf8");
  const logDiag = (msg: string) => {
    fs.appendFileSync(logFile, msg + "\n", "utf8");
    console.log(msg);
  };
  const logDiagErr = (msg: string, err?: any) => {
    const isPermissionError = err && (String(err.message || err).includes("PERMISSION_DENIED") || String(err.message || err).includes("insufficient permissions"));
    const label = isPermissionError ? "[DIAG_WARN]" : "[ERROR]";
    fs.appendFileSync(logFile, `${label} ${msg} ${err ? (err.stack || err.message || String(err)) : ""}\n`, "utf8");
    if (isPermissionError) {
      console.warn(`${label} ${msg}: Database admin privileges are diagnostic only in developers sandbox preview, falling back to credentials.`);
    } else {
      console.error(msg, err || "");
    }
  };

  logDiag(`[DIAG] Env keys containing GOOGLE/GCLOUD/FIREBASE/PROJECT: ${JSON.stringify(Object.keys(process.env).filter(k => /google|gcloud|firebase|project/i.test(k)))}`);
  logDiag(`[DIAG] GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  logDiag(`[DIAG] GCLOUD_PROJECT: ${process.env.GCLOUD_PROJECT}`);
  logDiag(`[DIAG] GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);

  const app = express();
  const PORT = 3000;

  // WhatsApp webhook route — registered BEFORE the global body parsers
  // below so THIS route's own Content-Type-branching middleware controls
  // how the body is parsed, instead of the global one. Meta needs the raw
  // Buffer intact to verify X-Hub-Signature-256 over the exact bytes;
  // Twilio needs the fully-parsed params object for twilio.validateRequest()
  // (its signature is computed over the parsed fields, not raw bytes) — a
  // naive express.raw() alone on this route would silently break Twilio,
  // since a Content-Type it doesn't match just skips straight to the
  // handler with req.body unset, never falling through to a parser that
  // understands it. The two handler functions are declared further down
  // in this file as hoisted function declarations, so referencing them
  // here (before their textual definition) resolves correctly — and by
  // the time either is actually invoked (an incoming request, always
  // after startServer() has finished running), every const it closes over
  // (adminDb, etc.) is already initialized.
  app.get("/api/whatsapp/webhook", (req, res) => whatsappWebhookGetHandler(req, res));
  app.post(
    "/api/whatsapp/webhook",
    (req, res, next) => {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        express.raw({ type: "application/json", limit: "1mb" })(req, res, next);
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        express.urlencoded({ extended: true, limit: "1mb" })(req, res, next);
      } else {
        res.status(415).send("Unsupported Content-Type");
      }
    },
    (req, res) => whatsappWebhookPostHandler(req, res)
  );

  // Middleware for parsing json with sufficient limit for base64 invoices/images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Initialize backend Firebase db connection
  const firebaseConfigFile = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigFile, "utf8"));

  const firebaseApp = getClientApps().length === 0 ? initClientApp(firebaseConfig) : getClientApp();
  // Overridden to "(default)" as requested by the user to connect to historical clinics, patients, and appointments
  const dbId = "(default)";
  const db = dbId === "(default)" || dbId === "" ? getClientFirestore(firebaseApp) : getClientFirestore(firebaseApp, dbId);
  logDiag(`[ELIZA_SERVER] Connected to Client Firestore database: ${dbId}`);

  // Initialize admin SDK for full privilege bypass of Firestore rules
  const activeProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "elisa-494703";
  logDiag(`[DIAG] Active project detected for admin: ${activeProjectId}`);

  const useFirebaseEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (useFirebaseEmulator) {
    logDiag(`[ELIZA_SERVER] FIRESTORE_EMULATOR_HOST detected (${process.env.FIRESTORE_EMULATOR_HOST}) — skipping applicationDefault() credential, using local emulator only.`);
  }
  const adminApp = getApps().length
    ? getApps()[0]
    : useFirebaseEmulator
      ? initializeApp({ projectId: activeProjectId })
      : initializeApp({
          credential: applicationDefault(),
          projectId: activeProjectId,
        });

  const dbDefault = getFirestore(adminApp);
  const dbCustom = getFirestore(adminApp, "ai-studio-14f59fa8-d107-42c9-8945-852d4fa75954");
  
  let adminDb = dbDefault;
  logDiag("[ELIZA_SERVER] Initialized adminDb with default database (default)");

  // Run startup self-healing connectivity check
  try {
    logDiag("[ELIZA_SERVER] Testing default database (default) read access...");
    const snap = await dbDefault.collection("clinics").limit(1).get();
    logDiag(`[ELIZA_SERVER] [SUCCESS] Default database (default) read succeeded. Sump size: ${snap.size}`);
    adminDb = dbDefault;
  } catch (err: any) {
    logDiagErr(`[ELIZA_SERVER] [FAILED] Default database (default) read failed.`, err);
    try {
      logDiag("[ELIZA_SERVER] Testing custom database (ai-studio-14f59fa8-d107-42c9-8945-852d4fa75954) read access...");
      const snap = await dbCustom.collection("clinics").limit(1).get();
      logDiag(`[ELIZA_SERVER] [SUCCESS] Custom database (ai-studio-14f59fa8-d107-42c9-8945-852d4fa75954) read succeeded. Sump size: ${snap.size}`);
      adminDb = dbCustom;
    } catch (err2: any) {
      logDiagErr(`[ELIZA_SERVER] [CRITICAL] Custom database read failed as well. Fallback to default.`, err2);
      adminDb = dbDefault;
    }
  }

  // Boot testing for Admin Firestore
  adminDb.doc("clinics/l9GzEcXT7uhcYHgRVVhe/integrations/whatsapp").get()
    .then((docSnap) => logDiag(`[ADMIN_FIRESTORE_OK] Can read whatsapp integration: exists=${docSnap.exists}`))
    .catch((err) => logDiagErr("[ADMIN_FIRESTORE_FAIL]", err));

  // --- AI Gateway Centralized Helpers ---
  const convertGeminiToOpenAI = (contents: any, config?: any): any[] => {
    const messages: any[] = [];

    if (config?.systemInstruction) {
      let systemText = "";
      if (typeof config.systemInstruction === "string") {
        systemText = config.systemInstruction;
      } else if (config.systemInstruction.parts && Array.isArray(config.systemInstruction.parts)) {
        systemText = config.systemInstruction.parts.map((p: any) => p.text || "").join("\n");
      } else if (config.systemInstruction.text) {
        systemText = config.systemInstruction.text;
      }
      if (systemText) {
        messages.push({ role: "system", content: systemText });
      }
    }

    if (typeof contents === "string") {
      messages.push({ role: "user", content: contents });
    } else if (Array.isArray(contents)) {
      for (const item of contents) {
        const gRole = item.role || "user";
        const role = gRole === "model" ? "assistant" : gRole;
        
        let content = "";
        if (typeof item.parts === "string") {
          content = item.parts;
        } else if (Array.isArray(item.parts)) {
          content = item.parts.map((p: any) => {
            if (typeof p === "string") return p;
            return p.text || "";
          }).join("\n");
        } else if (item.text) {
          content = item.text;
        }
        
        messages.push({ role, content });
      }
    } else if (contents && typeof contents === "object") {
      let content = "";
      if (Array.isArray(contents.parts)) {
         content = contents.parts.map((p: any) => p.text || p || "").join("\n");
      } else if (contents.text) {
         content = contents.text;
      }
      const role = contents.role === "model" ? "assistant" : (contents.role || "user");
      messages.push({ role, content });
    }

    return messages;
  };

  const logAIUsage = async (
    clinicId: string,
    params: {
      provider: string;
      model: string;
      taskType: string;
      approximateInputLength: number;
      approximateOutputLength: number;
      success: boolean;
      errorCode: string | null;
    }
  ) => {
    try {
      if (!clinicId) return;
      await adminDb.collection(`clinics/${clinicId}/ai_usage_logs`).add({
        ...params,
        createdAt: AdminFieldValue.serverTimestamp(),
      });
      console.log(`[AI_COST_LOG] Saved usage log for clinic ${clinicId}`);
    } catch (err: any) {
      console.error(`[AI_USAGE_LOG_SAVE_FAILED] Failed to save usage log:`, err.message || err);
    }
  };

  const generateElizaAIResponse = async ({
    taskType,
    contents,
    config,
    preferredProvider,
    clinicId,
    model
  }: {
    taskType?: string;
    contents: any;
    config?: any;
    preferredProvider?: "openai" | "gemini";
    clinicId?: string;
    model?: string;
  }) => {
    console.log("[AI_GATEWAY_REQUEST]", { taskType, preferredProvider, clinicId, model });

    // 1. Identify Clinic and Load config
    let activeClinicId = clinicId;
    console.log("[AI_SETTINGS_READ_START]");
    if (!activeClinicId) {
      try {
        const clinicsSnap = await adminDb.collection("clinics").limit(1).get();
        if (!clinicsSnap.empty) {
          activeClinicId = clinicsSnap.docs[0].id;
        }
      } catch (err: any) {
        const isPermissionError = String(err.message || err).includes("PERMISSION_DENIED") || String(err.message || err).includes("insufficient permissions");
        if (isPermissionError) {
          console.log("[AI_SETTINGS_READ_INFO] Defauting clinic to production reference clinic (l9GzEcXT7uhcYHgRVVhe) for sandbox compatibility.");
        } else {
          console.warn("[AI_SETTINGS_READ_INFO] Failed to fallback list clinics:", err.message || err);
        }
        activeClinicId = "l9GzEcXT7uhcYHgRVVhe";
      }
    }

    let clinicConfig: any = {};
    if (activeClinicId) {
      try {
        const clinicDoc = await adminDb.doc(`clinics/${activeClinicId}`).get();
        if (clinicDoc.exists) {
          clinicConfig = clinicDoc.data() || {};
          console.log("[AI_SETTINGS_READ_SUCCESS] Successfully read clinic config.");
        } else {
          console.log("[AI_SETTINGS_READ_INFO] Clinic config not found, using defaults.");
        }
      } catch (e: any) {
        const isPermissionError = String(e.message || e).includes("PERMISSION_DENIED") || String(e.message || e).includes("insufficient permissions");
        if (isPermissionError) {
          console.log("[AI_SETTINGS_READ_INFO] Clinic config permission bypass active in sandbox. Using default config.");
        } else {
          console.warn("[AI_SETTINGS_READ_INFO] Failed to read clinic config, using defaults:", e.message || e);
        }
      }
    } else {
      console.log("[AI_SETTINGS_READ_INFO] No clinic ID resolved, using defaults.");
    }

    // 2. Map taskType from contents systemInstruction or contents itself if not passed
    let resolvedTaskType = taskType;
    if (!resolvedTaskType) {
      const combinedStr = JSON.stringify(contents) + " " + JSON.stringify(config || "");
      const lower = combinedStr.toLowerCase();
      if (lower.includes("anamnese") || lower.includes("dossiê") || lower.includes("dossie")) {
        resolvedTaskType = "anamnese_dossie";
      } else if (lower.includes("planejamento facial") || lower.includes("harmonização") || lower.includes("harmonizacao")) {
        resolvedTaskType = "planejamento_facial";
      } else if (lower.includes("receita") || lower.includes("interações") || lower.includes("receituario")) {
        resolvedTaskType = "receituario_interacoes";
      } else if (lower.includes("risco clínico") || lower.includes("risco clinico") || (lower.includes("mitigar") && lower.includes("risco"))) {
        resolvedTaskType = "risco_clinico";
      } else if (lower.includes("financeiro") || lower.includes("faturamento") || lower.includes("receita")) {
        resolvedTaskType = "resumo_financeiro";
      } else if (lower.includes("crm")) {
        resolvedTaskType = "crm";
      } else if (lower.includes("marketing") || lower.includes("estético")) {
        resolvedTaskType = "marketing";
      } else if (lower.includes("contrato")) {
        resolvedTaskType = "contratos";
      } else if (lower.includes("whatsapp") || lower.includes("mensagem")) {
        resolvedTaskType = "mensagens_whatsapp";
      } else {
        resolvedTaskType = "unknown";
      }
    }

    // 3. Determine Provider
    // Product decision: OpenAI is always the first choice for every task
    // type and every clinic; Gemini is only used as a fallback if OpenAI
    // fails (missing key, rate limit, error, etc). A caller can still force
    // a specific provider via `preferredProvider`. A clinic can still opt
    // out of fallback entirely via aiProviderFallback: "none"/"nenhum".
    const fallbackProviderFromConfig = (clinicConfig.aiProviderFallback || "gemini").toLowerCase();

    let firstProvider: "openai" | "gemini" = preferredProvider || "openai";
    let secondProvider: "openai" | "gemini" | "none" = (firstProvider === "openai") ? "gemini" : "openai";

    if (fallbackProviderFromConfig === "none" || fallbackProviderFromConfig === "nenhum") {
      secondProvider = "none";
    }

    const criticalTasks = ["anamnese_dossie", "planejamento_facial", "clinical_planning_analysis", "receituario_interacoes", "risco_clinico"];
    const isCritical = criticalTasks.includes(resolvedTaskType);

    // 4. Determine Models
    let openAIModel = "gpt-4o";
    let geminiModel = model || "gemini-3.5-flash";

    const isAdministrative = ["resumo_financeiro", "crm", "marketing", "contratos", "mensagens_whatsapp"].includes(resolvedTaskType);

    if (isAdministrative) {
      openAIModel = clinicConfig.aiModelAdministrative || "gpt-4o-mini";
      geminiModel = clinicConfig.aiModelAdministrative || "gemini-3.5-flash";
    } else if (isCritical) {
      openAIModel = clinicConfig.aiModelClinical || "gpt-4o";
      geminiModel = clinicConfig.aiModelClinical || "gemini-3.1-pro-preview";
    } else {
      openAIModel = clinicConfig.aiModelFast || "gpt-4o-mini";
      geminiModel = clinicConfig.aiModelFast || "gemini-3.5-flash";
    }

    if (model) {
      if (model.startsWith("gpt-") || model.startsWith("o1-") || model.startsWith("o3-")) {
        openAIModel = model;
      } else {
        geminiModel = model;
      }
    }

    let text = "";
    let success = false;
    let errorMsg = null;
    let actualProviderUsed = firstProvider;
    let finalModelUsed = firstProvider === "openai" ? openAIModel : geminiModel;

    console.log("[AI_PROVIDER_SELECTED]", { provider: firstProvider, model: finalModelUsed });

    const approximateInputLength = JSON.stringify(contents).length + (config?.systemInstruction ? JSON.stringify(config.systemInstruction).length : 0);

    const callOpenAI = async () => {
      console.log(`[OPENAI_REQUEST] Attempting call to OpenAI model: ${openAIModel}`);
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey || apiKey.startsWith("••••") || apiKey === "test_token") {
        throw new Error("OPENAI_API_KEY is missing or invalid in environment secrets.");
      }
      const openai = new OpenAI({ apiKey });
      const openAIMessages = convertGeminiToOpenAI(contents, config);

      let responseFormat: any = undefined;
      if (config?.responseMimeType === "application/json" || config?.responseSchema) {
        responseFormat = { type: "json_object" };
        const hasJsonKeyword = openAIMessages.some(m => typeof m.content === "string" && m.content.toLowerCase().includes("json"));
        if (!hasJsonKeyword) {
          openAIMessages.push({ role: "system", content: "You must return a valid JSON object." });
        }
      }

      const completion = await openai.chat.completions.create({
        model: openAIModel,
        messages: openAIMessages,
        temperature: typeof config?.temperature === "number" ? config.temperature : undefined,
        top_p: typeof config?.topP === "number" ? config.topP : undefined,
        response_format: responseFormat,
      });

      const resText = completion.choices[0]?.message?.content || "";
      console.log(`[OPENAI_SUCCESS] Completed successfully.`);
      return resText;
    };

    const callGemini = async () => {
      console.log(`[GEMINI_REQUEST] Attempting call to Gemini model: ${geminiModel}`);
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey.startsWith("••••") || apiKey === "test_token" || apiKey.length < 15) {
        throw new Error("GEMINI_API_KEY is missing or invalid in environment secrets.");
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents,
        config
      });
      console.log(`[GEMINI_SUCCESS] Completed successfully.`);
      return response.text || "";
    };

    if (firstProvider === "openai") {
      try {
        text = await callOpenAI();
        success = true;
      } catch (err: any) {
        console.error(`[OPENAI_ERROR] OpenAI call failed:`, err);
        errorMsg = err.message || String(err);
        success = false;
      }
    } else {
      try {
        text = await callGemini();
        success = true;
      } catch (err: any) {
        console.error(`[GEMINI_ERROR] Gemini call failed:`, err);
        errorMsg = err.message || String(err);
        success = false;
      }
    }

    // Fallback if priority failed
    if (!success && secondProvider !== "none") {
      actualProviderUsed = secondProvider;
      if (secondProvider === "gemini") {
        console.log(`[GEMINI_FALLBACK_REQUEST] Attempting fallback to Gemini with model: ${geminiModel}`);
        finalModelUsed = geminiModel;
        try {
          text = await callGemini();
          console.log(`[GEMINI_FALLBACK_SUCCESS] Gemini fallback completed successfully.`);
          success = true;
          errorMsg = null;
        } catch (gemErr: any) {
          console.error(`[GEMINI_FALLBACK_FAIL] Fallback failed:`, gemErr);
          errorMsg += ` | Fallback Gemini failed: ${gemErr.message || String(gemErr)}`;
          console.log(`[AI_GATEWAY_FINAL_ERROR] All AI attempts failed.`);
        }
      } else if (secondProvider === "openai") {
        console.log(`[OPENAI_FALLBACK_REQUEST] Attempting fallback to OpenAI with model: ${openAIModel}`);
        finalModelUsed = openAIModel;
        try {
          text = await callOpenAI();
          console.log(`[OPENAI_FALLBACK_SUCCESS] OpenAI fallback completed successfully.`);
          success = true;
          errorMsg = null;
        } catch (openErr: any) {
          console.error(`[OPENAI_FALLBACK_FAIL] Fallback failed:`, openErr);
          errorMsg += ` | Fallback OpenAI failed: ${openErr.message || String(openErr)}`;
          console.log(`[AI_GATEWAY_FINAL_ERROR] All AI attempts failed.`);
        }
      }
    } else if (!success) {
      console.log(`[AI_GATEWAY_FINAL_ERROR] Primary attempt failed and fallback was not pursued (fallback disabled or set to none).`);
    }

    // Limit logging by "Ativar logs de custo" setting from clinicConfig
    const enableLogs = clinicConfig.aiEnableCostLogs !== false;
    if (activeClinicId && enableLogs) {
      await logAIUsage(activeClinicId, {
        provider: actualProviderUsed,
        model: finalModelUsed,
        taskType: resolvedTaskType,
        approximateInputLength,
        approximateOutputLength: text.length,
        success,
        errorCode: errorMsg ? errorMsg.substring(0, 500) : null
      });
    }

    if (!success) {
      throw new Error(errorMsg || "A ELIZA AI falhou ao processar a requisição.");
    }

    return {
      text,
      candidates: [
        {
          content: {
            parts: [{ text }]
          }
        }
      ],
      usageMetadata: {
        promptTokenCount: Math.round(approximateInputLength / 4),
        candidatesTokenCount: Math.round(text.length / 4),
        totalTokenCount: Math.round((approximateInputLength + text.length) / 4)
      }
    };
  };
  // --- End of AI Gateway Helpers ---

  // Helpers for ELIZA Interna
  const getSampaDate = () => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    // GMT-3 for São Paulo, Brazil
    return new Date(utc + (3600000 * -3));
  };

  const getWeekdayName = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const names = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    return names[date.getDay()];
  };

  const interpretCommandFallback = (message: string): string => {
    const norm = message.toLowerCase().trim();
    if (norm.includes("agenda hoje") || norm.includes("atendimentos hoje") || norm.includes("compromissos hoje")) {
      return "GET_TODAY_AGENDA";
    }
    if (norm.includes("agenda amanhã") || norm.includes("agenda amanha") || norm.includes("agenda de amanhã") || norm.includes("atendimentos amanhã") || norm.includes("compromissos amanhã") || norm.includes("minha agenda amanhã")) {
      return "GET_TOMORROW_AGENDA";
    }
    if (norm.includes("faturamento hoje") || norm.includes("faturado hoje") || norm.includes("receitas hoje") || norm.includes("faturamento de hoje")) {
      return "GET_DAILY_REVENUE";
    }
    if (norm.includes("faturamento do mês") || norm.includes("faturado do mes") || norm.includes("faturamento mês") || norm.includes("faturamento mes")) {
      return "GET_MONTHLY_REVENUE";
    }
    if (norm.includes("horários livres essa semana") || norm.includes("horarios livres essa semana") || norm.includes("horarios livres semana") || norm.includes("livres semana")) {
      return "GET_WEEK_AVAILABLE_SLOTS";
    }
    if (norm.includes("horários livres") || norm.includes("horarios livres") || norm.includes("livres hoje") || norm.includes("vagas hoje") || norm.includes("horários livres hoje")) {
      return "GET_AVAILABLE_SLOTS";
    }
    if (norm.includes("pacientes de hoje") || norm.includes("pacientes hoje")) {
      return "GET_TODAY_PATIENTS";
    }
    if (norm.includes("planejamento da semana") || norm.includes("planejamento") || norm.includes("cronograma") || norm.includes("planejamento semanal")) {
      return "GET_WEEK_PLAN";
    }
    if (norm.includes("pendências") || norm.includes("pendencias") || norm.includes("tarefas") || norm.includes("prioridades")) {
      return "GET_PENDING_TASKS";
    }
    if (norm.includes("quem não confirmou") || norm.includes("nao confirmados") || norm.includes("sem confirmacao") || norm.includes("não confirmou") || norm.includes("não confirmados")) {
      return "GET_UNCONFIRMED_APPOINTMENTS";
    }
    if (norm.includes("contas de hoje") || norm.includes("contas hoje") || norm.includes("despesas hoje") || norm.includes("contas a pagar hoje")) {
      return "GET_TODAY_EXPENSES";
    }
    if (norm.includes("pacientes para recall") || norm.includes("recall") || norm.includes("recall hof") || norm.includes("pacientes recall")) {
      return "GET_OVERDUE_RECALLS";
    }
    if (norm.includes("cirurgias de amanhã") || norm.includes("cirurgias amanhã") || norm.includes("cirurgia amanhã")) {
      return "GET_TOMORROW_SURGERIES";
    }
    if (norm.includes("resumo do dia") || norm.includes("resumo hoje") || norm.includes("resumo geral")) {
      return "GET_DAILY_SUMMARY";
    }
    return "UNKNOWN";
  };

  const interpretCommand = async (message: string): Promise<string> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.startsWith("••••") || apiKey === "test_token" || apiKey.length < 15) {
      return interpretCommandFallback(message);
    }
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Analise a mensagem de texto de um profissional de uma clínica médica e mapeie-a para uma das intenções suportadas.
        
Suas intenções suportadas são:
1. GET_TODAY_AGENDA (para consultas de hoje, "agenda hoje")
2. GET_TOMORROW_AGENDA (para consultas de amanhã, "minha agenda amanhã", "agenda de amanhã")
3. GET_DAILY_REVENUE (para faturamento/financeiro de hoje, "meu faturamento hoje")
4. GET_MONTHLY_REVENUE (para faturamento/financeiro do mês, "meu faturamento do mês")
5. GET_AVAILABLE_SLOTS (para horários livres hoje ou de modo geral, "horários livres hoje")
6. GET_WEEK_AVAILABLE_SLOTS (para horários livres da semana inteira, "horários livres essa semana")
7. GET_TODAY_PATIENTS (para lista de pacientes de hoje, "pacientes de hoje")
8. GET_WEEK_PLAN (para planejamento semanal de procedimentos ou tratamentos, "planejamento da semana")
9. GET_PENDING_TASKS (para tarefas pendentes ou pendências de hoje, "pendências de hoje")
10. GET_UNCONFIRMED_APPOINTMENTS (para agendamentos que ainda não estão confirmados, "quem não confirmou")
11. GET_TODAY_EXPENSES (para saída/despesas/contas registradas para hoje, "contas de hoje")
12. GET_OVERDUE_RECALLS (para pacientes com retorno ou recall de HOF vencidos ou anteriores a hoje, "pacientes para recall")
13. GET_TOMORROW_SURGERIES (para cirurgias e procedimentos cirúrgicos agendados para amanhã, "cirurgias de amanhã")
14. GET_DAILY_SUMMARY (para um resumo executivo abrangente do fechamento e andamento da clínica hoje, "resumo do dia")

Se você não tiver certeza ou se não couber em nenhuma dessas, responda apenas com "UNKNOWN".

Mensagem do profissional: "${message}"

Responda APENAS com o nome da intenção em letras maiúsculas (ex: GET_TODAY_AGENDA). Sem explicações, sem markdown.`,
      });
      const intent = response.text ? response.text.trim().toUpperCase() : "UNKNOWN";
      if ([
        "GET_TODAY_AGENDA",
        "GET_TOMORROW_AGENDA",
        "GET_DAILY_REVENUE",
        "GET_MONTHLY_REVENUE",
        "GET_AVAILABLE_SLOTS",
        "GET_WEEK_AVAILABLE_SLOTS",
        "GET_TODAY_PATIENTS",
        "GET_WEEK_PLAN",
        "GET_PENDING_TASKS",
        "GET_UNCONFIRMED_APPOINTMENTS",
        "GET_TODAY_EXPENSES",
        "GET_OVERDUE_RECALLS",
        "GET_TOMORROW_SURGERIES",
        "GET_DAILY_SUMMARY"
      ].includes(intent)) {
        return intent;
      }
      return interpretCommandFallback(message);
    } catch (err) {
      console.warn("[ELIZA_INTERNA] Error calling Gemini for interpretation, utilizing fallback:", err);
      return interpretCommandFallback(message);
    }
  };

  const generatePersonalizedSummary = async (clinicId: string, staffData: any, sampa: Date): Promise<string> => {
    const todayStr = sampa.toISOString().split("T")[0];
    const appointmentsSnap = await adminDb.collection(`clinics/${clinicId}/appointments`)
      .where("date", "==", todayStr)
      .get();
    let appointments = appointmentsSnap.docs.map(doc => doc.data());
    
    const filterByProfessional = (staffData.role !== 'Dono' && staffData.role !== 'Gerente' && staffData.professionalId && staffData.professionalId !== 'not-assigned');
    if (filterByProfessional) {
      appointments = appointments.filter((apt: any) => apt.staffId === staffData.professionalId);
    }
    
    const totalAppointments = appointments.length;
    const confirmedAppointments = appointments.filter((apt: any) => apt.status === "confirmado" || apt.status === "finalizado").length;
    const pendingAppointments = totalAppointments - confirmedAppointments;
    
    const tasksSnap = await adminDb.collection(`clinics/${clinicId}/pending_items`)
      .where("status", "==", "pending")
      .get();
    const pendingTasks = tasksSnap.size;

    const patientsSnap = await adminDb.collection(`clinics/${clinicId}/patients`).get();
    let recallCount = 0;
    patientsSnap.docs.forEach(doc => {
      const pData = doc.data();
      const recall = pData.recallDate || pData.hofRecallDate;
      if (recall) {
        const recDate = new Date(recall);
        if (recDate.getTime() <= sampa.getTime()) {
          recallCount++;
        }
      }
    });

    const hasFinancePerm = staffData.permissions && (staffData.permissions.includes("visualizar_financeiro") || staffData.permissions.includes("financeiro") || staffData.permissions.includes("financial"));
    const canAccessFinance = staffData.role === "Dono" || staffData.role === "Gerente" || String(staffData.role || "").toLowerCase() === "financeiro" || String(staffData.role || "").toLowerCase() === "financial" || hasFinancePerm;

    let financialStats = "";
    if (canAccessFinance) {
      const transactionsSnap = await adminDb.collection(`clinics/${clinicId}/transactions`).get();
      const dailyTransactions = transactionsSnap.docs.map(doc => doc.data()).filter((t: any) => {
        return t.type === 'income' && String(t.date || "").startsWith(todayStr);
      });
      const totalDailyIncome = dailyTransactions.reduce((acc: number, t: any) => acc + (t.amount || t.value || 0), 0);

      const dailyExpenses = transactionsSnap.docs.map(doc => doc.data()).filter((t: any) => {
        return t.type === 'expense' && String(t.date || "").startsWith(todayStr);
      });
      const totalDailyExpenses = dailyExpenses.reduce((acc: number, t: any) => acc + (t.amount || t.value || 0), 0);

      financialStats = `\n💰 *Financeiro do Dia:*\n` +
        `   • Receitas: *R$ ${totalDailyIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}* (${dailyTransactions.length} lançamentos)\n` +
        `   • Despesas: *R$ ${totalDailyExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}* (${dailyExpenses.length} saídas)\n` +
        `   • Saldo Líquido: *R$ ${(totalDailyIncome - totalDailyExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}*`;
    }

    const report = `📊 *Resumo Operacional Eliza - Clínica*\n` +
      `📅 Data: *${todayStr}* (${getWeekdayName(todayStr)})\n` +
      `👤 Solicitante: *${staffData.name}* (Cargo: ${staffData.role})\n\n` +
      `📋 *Atendimentos e Agenda:*\n` +
      `   • Pacientes agendados hoje: *${totalAppointments}*\n` +
      `   • Confirmados/Finalizados: *${confirmedAppointments}*\n` +
      `   • Aguardando confirmação: *${pendingAppointments}*\n\n` +
      `⚠️ *Alertas e Pendências:*\n` +
      `   • Itens pendentes no sistema: *${pendingTasks}*\n` +
      `   • Pacientes no prazo de Recall HOF: *${recallCount}*` +
      financialStats + `\n\n_Para relatórios completos de agenda ou faturamento detalhado, utilize os comandos específicos (ex: 'faturamento do mês' ou 'quem não confirmou')._`;

    return report;
  };

  const normalizeWhatsAppPhone = (rawPhone: string): string => {
    let clean = (rawPhone || "").replace(/\D/g, "");
    if (!clean) return "";
    
    // If it starts with 55, keep it. Otherwise, prepend 55.
    if (clean.startsWith("55") && clean.length >= 12 && clean.length <= 13) {
      return clean;
    }
    
    // Fallback for Brazilian standard numbers that don't start with 55 yet
    if (clean.length >= 10 && clean.length <= 11) {
      return "55" + clean;
    }
    
    // General fallback
    return clean.startsWith("55") ? clean : "55" + clean;
  };

  const logWhatsAppSend = async (
    clinicId: string,
    toPhone: string,
    text: string,
    success: boolean,
    whatsappMessageId: string | null,
    errorCode: string | number | null,
    errorMessage: string | null
  ) => {
    try {
      let patientId: string | null = null;
      let patientName: string | null = null;
      let originalPhone: string = toPhone;
      let normalizedPhone: string = toPhone;

      // 1. Try matching staff members:
      try {
        const staffPath = `clinics/${clinicId}/staff_whatsapp_access`;
        logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "staff_match_read", clinicId, ref: toPhone });
        const staffSnap = await adminDb.collection(staffPath).get();
        const matchedStaff = staffSnap.docs.find(d => {
          const sData = d.data();
          const p1 = (sData.phone || "").replace(/\D/g, "");
          const p2 = (sData.phoneNormalized || "").replace(/\D/g, "");
          const p0 = toPhone.replace(/\D/g, "");
          return p1 === p0 || p2 === p0 || p1.endsWith(p0) || p0.endsWith(p1) || p2.endsWith(p0) || p0.endsWith(p2);
        });
        if (matchedStaff) {
          patientName = `Staff: ${matchedStaff.data().name || matchedStaff.id}`;
          originalPhone = matchedStaff.data().phone || toPhone;
          normalizedPhone = toPhone;
        }
      } catch (err) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_STAFF_MATCH_FAILED", phase: "STAFF_MATCH", ref: toPhone, err });
      }

      if (!patientName) {
        // 2. Try matching patients
        try {
          const patientsPath = `clinics/${clinicId}/patients`;
          logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "patient_match_read", clinicId, ref: toPhone });
          const patientsSnap = await adminDb.collection(patientsPath).get();
          const matchedPatient = patientsSnap.docs.find(d => {
            const pData = d.data() || {};
            const p1 = (pData.phone || "").replace(/\D/g, "");
            const p2 = (pData.phoneNormalized || "").replace(/\D/g, "");
            const p0 = toPhone.replace(/\D/g, "");
            return p1 === p0 || p2 === p0 || p1.endsWith(p0) || p0.endsWith(p1) || p2.endsWith(p0) || p0.endsWith(p2);
          });
          if (matchedPatient) {
            patientId = matchedPatient.id;
            patientName = matchedPatient.data().name || "Paciente";
            originalPhone = matchedPatient.data().phone || toPhone;
            normalizedPhone = matchedPatient.data().phoneNormalized || toPhone;
          } else {
            // Check conversations
            const convoPath = `clinics/${clinicId}/whatsapp_conversations/${toPhone}`;
            logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "conversation_match_read", clinicId, ref: toPhone });
            const convoSnap = await adminDb.doc(convoPath).get();
            if (convoSnap.exists) {
              const convoData = convoSnap.data() || {};
              patientId = convoData.patientId || null;
              patientName = convoData.patientName || "Paciente WhatsApp";
              originalPhone = convoData.patientPhone || toPhone;
            } else {
              patientName = "Paciente Manual";
            }
          }
        } catch (err) {
          logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_PATIENT_MATCH_FAILED", phase: "PATIENT_MATCH", ref: toPhone, err });
        }
      }

      try {
        const logsPath = `clinics/${clinicId}/integration_logs`;
        logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "audit_log_write", clinicId, ref: toPhone });
        await adminDb.collection(logsPath).add({
          type: "whatsapp_send",
          patientId,
          patientName,
          originalPhone,
          normalizedPhone,
          message: text,
          status: success ? "success" : "error",
          metaMessageId: whatsappMessageId || null,
          errorCode: errorCode !== null ? String(errorCode) : null,
          errorMessage: errorMessage || null,
          createdAt: AdminFieldValue.serverTimestamp()
        });
        logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "audit_log_recorded", clinicId, ref: toPhone, extra: { success } });
      } catch (err) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_AUDIT_LOG_FAILED", phase: "AUDIT_LOG", ref: toPhone, err });
      }
    } catch (err) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_AUDIT_OUTER_FAILED", phase: "AUDIT_LOG_OUTER", ref: toPhone, err });
    }
  };

  // --- WhatsApp provider dispatch (Meta Cloud API / Twilio) --------------
  // Both providers return the same normalized shape so every caller below
  // only has to deal with one contract:
  //   { success, providerMessageId?, errorCode?, errorMessage?, raw?, simulated? }

  // Hardening pós-diagnóstico (rodada de correção dos gaps encontrados
  // antes do teste real de whatsapp_business_messaging): esta função lia
  // o token bruto direto de um campo do Firestore e chamava a Graph API
  // v21.0 hardcoded, com um gate de simulação silenciosa (`skipApiCall`)
  // que podia devolver sucesso falso sem nunca chamar a Meta. Reescrita
  // pra: (1) resolver o access token EXCLUSIVAMENTE via Secret Manager,
  // por nome+versão explícitos (nunca "latest", mesmo padrão já usado
  // pelo /exchange — plano Seção 8); (2) falhar explicitamente, nunca
  // simular, quando não há referência/versão de secret configurada ou a
  // versão não existe; (3) usar RealWhatsAppGraphClient.sendMessage
  // (v26.0, centralizado); (4) nunca logar telefone, token ou corpo da
  // resposta da Meta — só eventos estruturados via logSanitizedWaInfo/
  // logSanitizedWaError, com o phoneNumberId (identificador do NOSSO
  // ativo, não do destinatário) como `ref` hasheada.
  const sendViaMeta = async (integrationData: any, toPhone: string, text: string) => {
    const phoneNumberId = integrationData.phoneNumberId || integrationData.phone_number_id || integrationData.metaPhoneId || "";
    const secretName = integrationData.accessTokenSecretName || "";
    const secretVersion = integrationData.accessTokenSecretVersion || "";

    if (!phoneNumberId) {
      return { success: false, errorCode: "phone_id_missing", errorMessage: "Id do telefone (phoneNumberId) não preenchido na integração." };
    }

    // Fail-closed: sem referência+versão de secret, não há envio possível
    // — nunca simula sucesso. `ref` correlaciona nos logs sem nunca expor
    // o phoneNumberId em texto puro fora deste hash.
    if (!secretName || !secretVersion) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_TOKEN_NOT_CONFIGURED", phase: "TOKEN_RESOLUTION", ref: phoneNumberId });
      return { success: false, errorCode: "token_not_configured", errorMessage: "Nenhuma versão de secret configurada para esta integração — configure o token antes de enviar." };
    }

    let accessToken: string;
    try {
      accessToken = await getSecretManagerClient().accessSecretVersion(secretName, secretVersion);
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_TOKEN_RESOLUTION_FAILED", phase: "TOKEN_RESOLUTION", ref: phoneNumberId, err });
      return { success: false, errorCode: "token_resolution_failed", errorMessage: "Falha ao resolver o token de acesso no Secret Manager." };
    }
    if (!accessToken) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_TOKEN_EMPTY", phase: "TOKEN_RESOLUTION", ref: phoneNumberId });
      return { success: false, errorCode: "token_resolution_failed", errorMessage: "Token de acesso resolvido veio vazio." };
    }

    logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "send_attempt", ref: phoneNumberId });
    try {
      const result = await getWhatsAppGraphClient().sendMessage(phoneNumberId, accessToken, toPhone, text);
      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "send_succeeded", ref: phoneNumberId });
      return { success: true, providerMessageId: result.providerMessageId, waId: result.waId };
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_GRAPH_CALL_FAILED", phase: "SEND", ref: phoneNumberId, err });
      return { success: false, errorCode: "graph_send_failed", errorMessage: "Falha ao enviar mensagem via Meta Graph API." };
    }
  };

  const toWhatsAppE164 = (raw: string) => {
    const digits = String(raw || "").replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
    return `whatsapp:+${digits}`;
  };

  // Same loose BR-phone matching used by the Meta inbound handler further
  // down (kept as its own local const there) — duplicated here rather than
  // hoisted, so the large existing Meta block stays untouched.
  const phonesRoughlyMatch = (phoneA: string, phoneB: string): boolean => {
    const cleanA = phoneA.replace(/\D/g, "");
    const cleanB = phoneB.replace(/\D/g, "");
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true;

    const normA = cleanA.startsWith("55") ? cleanA.substring(2) : cleanA;
    const normB = cleanB.startsWith("55") ? cleanB.substring(2) : cleanB;
    if (normA === normB) return true;

    if (normA.length >= 10 && normB.length >= 10) {
      const dddA = normA.substring(0, 2);
      const dddB = normB.substring(0, 2);
      const last8A = normA.substring(normA.length - 8);
      const last8B = normB.substring(normB.length - 8);
      if (dddA === dddB && last8A === last8B) return true;
    }

    if (cleanA.length >= 8 && cleanB.length >= 8) {
      const minLen = Math.min(cleanA.length, cleanB.length, 9);
      const endA = cleanA.substring(cleanA.length - minLen);
      const endB = cleanB.substring(cleanB.length - minLen);
      if (endA === endB) return true;
    }

    return false;
  };

  const sendViaTwilio = async (integrationData: any, toPhone: string, text: string) => {
    const accountSid = integrationData.twilioAccountSid || "";
    const authToken = integrationData.twilioAuthToken || "";
    const fromNumber = integrationData.twilioWhatsAppNumber || "";

    console.log("WHATSAPP_CONFIG_LOADED", { provider: "twilio", accountSidPrefix: accountSid.slice(0, 6), fromNumber });

    if (!accountSid || !authToken) {
      return { success: false, errorCode: "twilio_credentials_missing", errorMessage: "Account SID / Auth Token do Twilio não preenchidos na integração." };
    }
    if (!fromNumber) {
      return { success: false, errorCode: "twilio_number_missing", errorMessage: "Número do WhatsApp do Twilio não preenchido na integração." };
    }

    try {
      const client = twilio(accountSid, authToken);
      const message = await client.messages.create({
        from: toWhatsAppE164(fromNumber),
        to: toWhatsAppE164(toPhone),
        body: text
      });
      return { success: true, providerMessageId: message.sid, raw: message };
    } catch (err: any) {
      console.error("[WA_DISPATCH] Twilio call failed:", err);
      return { success: false, errorCode: String(err.code || err.status || "twilio_error"), errorMessage: err.message || String(err), raw: null };
    }
  };

  const sendWhatsAppMessage = async (integrationData: any, toPhone: string, text: string) => {
    const provider = integrationData.provider === "twilio" ? "twilio" : "meta";
    return provider === "twilio" ? sendViaTwilio(integrationData, toPhone, text) : sendViaMeta(integrationData, toPhone, text);
  };

  const dispatchWhatsAppMessage = async (clinicId: string, toPhone: string, text: string) => {
    try {
      const integrationPath = `clinics/${clinicId}/integrations/whatsapp`;
      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "integration_read", clinicId, ref: toPhone });
      const integrationRef = adminDb.doc(integrationPath);
      let integrationSnap;
      let integrationData: any = {};
      let integrationSnapExists = false;

      try {
        integrationSnap = await integrationRef.get();
        integrationData = integrationSnap.data() || {};
        integrationSnapExists = integrationSnap.exists;
      } catch (snapErr: any) {
        console.error(`[ELIZA_INTERNA_DISPATCH] Firestore read error for clinic ${clinicId}:`, snapErr);
        await logWhatsAppSend(clinicId, toPhone, text, false, null, "firestore_error", snapErr.message || String(snapErr));
        return { success: false, errorMessage: snapErr.message || String(snapErr) };
      }

      if (!integrationSnapExists) {
        console.error(`[ELIZA_INTERNA_DISPATCH] Integration missing for clinic ${clinicId}`);
        await logWhatsAppSend(clinicId, toPhone, text, false, null, "integration_missing", "Configuração de integração do WhatsApp ausente no Firestore.");
        return { success: false, errorMessage: "Configuração de integração do WhatsApp ausente no Firestore." };
      }

      const result = await sendWhatsAppMessage(integrationData, toPhone, text);
      if (!result.success) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_INTERNAL_DISPATCH_FAILED", phase: "SEND", ref: toPhone });
        await logWhatsAppSend(clinicId, toPhone, text, false, null, result.errorCode, result.errorMessage);
        return { success: false, errorCode: result.errorCode, errorMessage: result.errorMessage };
      }

      await logWhatsAppSend(clinicId, toPhone, text, true, result.providerMessageId, null, null);
      return { success: true, whatsappMessageId: result.providerMessageId, waId: (result as any).waId ?? null };
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_INTERNAL_DISPATCH_THREW", phase: "SEND", ref: toPhone, err });
      await logWhatsAppSend(clinicId, toPhone, text, false, null, "catch_error", err.message || String(err));
      return {
        success: false,
        errorMessage: err.message || String(err)
      };
    }
  };

  // API Route for Student Auth Operations
  app.post("/api/education/student/get-or-create", async (req, res) => {
    const { email, tempPassword, name, phone, clinicId, existingUid } = req.body;
    
    console.log("[EDUCATION_STUDENT_CREATE_START] Initiated student creation/sync on backend for email:", email, "existingUid:", existingUid);
    
    if (!email || !tempPassword) {
      return res.status(400).json({ error: "Email and tempPassword are required" });
    }
    
    const emailNormalized = email.trim().toLowerCase();
    console.log("[EDUCATION_LOGIN_EMAIL_NORMALIZED] Normalized email to:", emailNormalized);
    
    const apiKey = firebaseConfig.apiKey;
    let authUid = existingUid || "";
    let existed = false;

    try {
      console.log("[EDUCATION_AUTH_CREATE_START] Looking up or creating in Firebase Auth (REST) for email:", emailNormalized);
      
      // Attempt registration (signUp REST API)
      const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailNormalized,
          password: tempPassword,
          returnSecureToken: true
        })
      });
      const signUpData = await signUpRes.json();

      if (signUpRes.ok) {
        authUid = signUpData.localId;
        existed = false;
        console.log("[EDUCATION_AUTH_USER_CREATED] Successfully created user in Firebase Auth with UID:", authUid);
      } else {
        if (signUpData.error && signUpData.error.message === "EMAIL_EXISTS") {
          console.log("[EDUCATION_PASSWORD_UPDATE_UID_MISSING] Email already exists in Firebase Auth. Resolving UID.");
          existed = true;

          if (!authUid) {
            // Try to signIn to get their existing UID if the tempPassword matches what we want
            const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: emailNormalized,
                password: tempPassword,
                returnSecureToken: true
              })
            });
            const signInData = await signInRes.json();
            if (signInRes.ok) {
              authUid = signInData.localId;
              console.log("[EDUCATION_PASSWORD_UPDATE_UID_FOUND] Logged in existing user to fetch UID:", authUid);
            } else {
              // Generate a safe fallback uid derived from the email to allow student document creation
              authUid = "student_" + emailNormalized.replace(/[^a-zA-Z0-9]/g, "_");
              console.log("[EDUCATION_PASSWORD_UPDATE_UID_FOUND] Generated secure fallback UID:", authUid);
            }
          }
        } else {
          throw new Error(signUpData.error?.message || "Sign up failure via Identity Toolkit REST");
        }
      }

      console.log("[EDUCATION_STUDENT_REST_SYNC_SUCCESS] Successfully aligned Firebase Auth via REST. UID:", authUid);
      return res.json({ success: true, authUid, existed });
    } catch (err: any) {
      console.error("[EDUCATION_PASSWORD_ERROR] Failed during backend get-or-create:", err);
      return res.status(500).json({ error: err.message || "Internal auth execution error" });
    }
  });

  // Dedicated administrative password update endpoint as requested
  app.post("/api/education/student/update-password", async (req, res) => {
    const { clinicId, studentId, novaSenha, email, currentStoredPassword, existingUid } = req.body;
    
    console.log("[EDUCATION_PASSWORD_UPDATE_START] Admin password update started for studentId:", studentId, "in clinicId:", clinicId, "existingUid:", existingUid);
    
    if (!clinicId || !studentId || !novaSenha) {
      console.error("[EDUCATION_PASSWORD_ERROR] Missing clinicId, studentId or novaSenha parameters");
      return res.status(400).json({ error: "clinicId, studentId, and novaSenha are required" });
    }

    try {
      const apiKey = firebaseConfig.apiKey;
      let emailNormalized = (email || studentId).trim().toLowerCase();
      let authUid = existingUid || studentId || "";

      // 1. Try to register user first if they don't exist at all on Firebase Auth
      let registeredSuccess = false;
      try {
        const createRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailNormalized,
            password: novaSenha,
            returnSecureToken: true
          })
        });
        const createData = await createRes.json();
        if (createRes.ok) {
          authUid = createData.localId;
          registeredSuccess = true;
          console.log("[EDUCATION_PASSWORD_USER_CREATED] Successfully created user in Firebase Auth with UID:", authUid);
        }
      } catch (cErr) {
        console.warn("Optional registration during update failed:", cErr);
      }

      // 2. If already registered, update their password
      if (!registeredSuccess) {
        console.log("[EDUCATION_PASSWORD_UPDATE_START] User already exists in Auth. Updating password using stored credentials if possible.");
        let updateOk = false;

        if (currentStoredPassword) {
          try {
            // Sign in with the old stored password to get idToken
            const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: emailNormalized,
                password: currentStoredPassword,
                returnSecureToken: true
              })
            });
            const signInData = await signInRes.json();
            if (signInRes.ok && signInData.idToken) {
              authUid = signInData.localId;
              const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  idToken: signInData.idToken,
                  password: novaSenha,
                  returnSecureToken: true
                })
              });
              if (updateRes.ok) {
                updateOk = true;
                console.log("[EDUCATION_PASSWORD_UPDATED] Successfully updated password to new temporary password for UID:", authUid);
              }
            } else {
              console.warn("[EDUCATION_PASSWORD_ERROR] Failed to sign in with stored password.");
            }
          } catch (uErr) {
            console.error("[EDUCATION_PASSWORD_ERROR] Failed to run step-wise password update:", uErr);
          }
        }

        // If update failed because direct update failed, send reset email
        if (!updateOk) {
          try {
            await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestType: "PASSWORD_RESET",
                email: emailNormalized
              })
            });
            console.log("[EDUCATION_PASSWORD_UPDATED] Sent password reset email because direct password change failed.");
          } catch (oobErr) {
            console.error("[EDUCATION_PASSWORD_ERROR] Failed sending password reset fallback:", oobErr);
          }
        }
      }

      console.log("[EDUCATION_PASSWORD_UPDATE_REST_SUCCESS] Successfully updated user password on Firebase Auth. UID:", authUid);
      return res.json({ success: true, authUid, message: "Senha atualizada com sucesso no Firebase Auth" });
    } catch (err: any) {
      console.error("[EDUCATION_PASSWORD_ERROR] Failed admin password update execution:", err);
      return res.status(500).json({ error: err.message || "Falha ao processar atualização da senha" });
    }
  });

  // API Route for Gemini Proxy
  app.post("/api/ai/generateContent", async (req, res) => {
    const { model, contents, config, taskType, preferredProvider, clinicId } = req.body;
    try {
      console.log("[AI_GATEWAY_REQUEST] Handling external generateContent request...");
      const result = await generateElizaAIResponse({
        taskType,
        contents,
        config,
        preferredProvider,
        clinicId,
        model
      });
      return res.json(result);
    } catch (error: any) {
      console.error("[ELIZA_SERVER_ERROR] Model generation failed via AI Gateway:", error);
      const detail = error && error.message ? error.message : String(error);
      return res.status(500).json({
        error: `A ELIZA AI falhou: ${detail}. Verifique a configuração das chaves de API em Configurações > IA ELIZA ou em Segredos.`
      });
    }
  });

  // ============================================================================
  // ELIZA INTELLIGENCE v2 — single orchestrator endpoint (vertical slice)
  // ============================================================================
  // Pergunta → tools determinísticas (Firestore real) → Insight Engine
  // (regras, sem IA) → generateElizaAIResponse (o mesmo gateway de sempre,
  // OpenAI-first/Gemini-fallback) só para explicar/priorizar os insights já
  // computados — nunca para inventar números. Autenticação 100% Firebase
  // real (ver src/lib/elizaCore/auth.ts); nenhum sistema de login paralelo.
  app.post("/api/eliza/ask", async (req, res) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let authedUser: Awaited<ReturnType<typeof authenticateElizaRequest>> | null = null;

    try {
      authedUser = await authenticateElizaRequest(req);
      const { clinicId, uid } = authedUser;
      const question = String(req.body?.question || "").trim();
      if (!question) {
        return res.status(400).json({ success: false, error: "question é obrigatório." });
      }
      const pageContext = req.body?.pageContext && typeof req.body.pageContext === "object" ? req.body.pageContext : null;
      const screenType = typeof req.body?.screenType === "string" ? req.body.screenType : "geral";
      const requestedPatientId = typeof req.body?.patientId === "string" && req.body.patientId ? req.body.patientId : null;

      // Conversational continuity (last few turns only, client-supplied and
      // never trusted as fact — see systemPrompt rule 8 below): lets "esses
      // horários"/"esse paciente" resolve to what was just discussed without
      // re-deriving the whole conversation. Capped hard so a long chat can't
      // balloon the payload sent to the model.
      const conversationHistory = Array.isArray(req.body?.conversationHistory)
        ? req.body.conversationHistory
            .slice(-3)
            .map((t: any) => ({ question: String(t?.question || "").slice(0, 200), summary: String(t?.summary || "").slice(0, 400) }))
            .filter((t: any) => t.question || t.summary)
        : [];

      // patientId is never trusted just because the frontend sent it —
      // same principle as clinicId in auth.ts: confirm the patient doc
      // actually lives under this clinic before any tool touches it.
      let patientId: string | null = null;
      if (requestedPatientId) {
        const belongs = await validatePatientBelongsToClinic(clinicId, requestedPatientId);
        if (!belongs) {
          return res.status(403).json({ success: false, error: "Paciente não pertence a esta clínica." });
        }
        patientId = requestedPatientId;
      }

      // General patient lookup: when the caller isn't already on a specific
      // patient's screen but the question names one by a capitalized word
      // (ex: "prontuário do paciente Jânio", "quando foi a última consulta
      // do João"), try to resolve it — this is what lets "olhe o histórico
      // de X" work from Home/anywhere, not only from inside that patient's
      // own record screen.
      let resolvedPatientName: string | null = null;
      let ambiguousPatientMatches: { id: string; name: string }[] = [];
      if (!patientId) {
        // Sentence-initial capitalization isn't a name signal, so the first
        // word is skipped; short/common capitalized words are filtered by
        // requiring 3+ letters after the first.
        const candidateWords = question.split(/\s+/).slice(1).filter((w: string) => /^[A-ZÀ-Ý][a-zà-ÿ]{2,}$/.test(w));
        for (const candidate of candidateWords) {
          const matches = await resolvePatientsByName(adminDb, clinicId, candidate);
          if (matches.length === 1) {
            patientId = matches[0].id;
            resolvedPatientName = matches[0].name;
            break;
          } else if (matches.length > 1) {
            ambiguousPatientMatches = matches;
          }
        }
      }

      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      // Same elapsed-days comparison, not full-previous-month-vs-partial-
      // current-month — comparing Aug 1-15 against the entirety of July
      // would make any month look like a crash before it's even over.
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 23, 59, 59);

      // Every question in this MVP crosses the same modules — no intent
      // router yet (plan explicitly asked not to over-build this in v1).
      // Financial data is only pulled/shown if this member's role is
      // actually allowed to see it (see auth.ts's canAccessFinance).
      const includeFinance = canAccessFinance(authedUser);
      // Papel funcional decide só ênfase/vocabulário no prompt e um bônus
      // leve de ranking em buildInsights — nunca gate de acesso (isso
      // continua sendo canAccessFinance acima). Ver functionalRole.ts.
      const functionalRole = normalizeFunctionalRole(authedUser);

      // Performance: when the question is scoped to one patient, the two
      // clinic-wide "which patients need X" tools (open budgets across the
      // whole clinic, recall candidates across the whole clinic) don't add
      // anything the patient-scoped tool doesn't already cover for THIS
      // patient, and they're the two heaviest reads (up to ~4000/~3000 docs
      // scanned). Skipping them here is a targeted, justified cut — not a
      // general "guess what's relevant" heuristic, which would risk the
      // reliability requirement this system is built around.
      const skipClinicWideBudgetsAndRecall = !!patientId;

      const toolsCalled: string[] = ["getAgendaAnalysis", "getPendingItems"];
      if (includeFinance) toolsCalled.push("getFinancialSummary", "comparePeriods");
      if (includeFinance && !skipClinicWideBudgetsAndRecall) toolsCalled.push("getOpenBudgets");
      if (!skipClinicWideBudgetsAndRecall) toolsCalled.push("getRecallCandidates");
      if (patientId) toolsCalled.push("getPatientContext");

      const [agenda, financial, comparison, budgets, recall, pending, patient] = await Promise.all([
        getAgendaAnalysis(adminDb, clinicId, { days: 7 }),
        includeFinance ? getFinancialSummary(adminDb, clinicId, { from: currentMonthStart, to: now }) : Promise.resolve(undefined),
        includeFinance ? comparePeriods(adminDb, clinicId, { from: currentMonthStart, to: now }, { from: previousMonthStart, to: previousMonthEnd }) : Promise.resolve(undefined),
        includeFinance && !skipClinicWideBudgetsAndRecall ? getOpenBudgets(adminDb, clinicId) : Promise.resolve(undefined),
        skipClinicWideBudgetsAndRecall ? Promise.resolve(undefined) : getRecallCandidates(adminDb, clinicId),
        getPendingItems(adminDb, clinicId),
        patientId ? getPatientContext(adminDb, clinicId, patientId) : Promise.resolve(undefined),
      ]);

      const insights: Insight[] = buildInsights({ agenda, financial, budgets, recall, pending, patient, screenType, functionalRole });

      // The model only ever sees this compact JSON — never raw Firestore
      // documents, never the full appointment/financial collections.
      const modelInput = {
        question,
        screenType,
        pageContext,
        conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
        insights: insights.map((i) => ({ id: i.id, category: i.category, severity: i.severity, title: i.title, description: i.description, priorityScore: i.priorityScore, priorityFactors: i.priorityFactors })),
        periodComparison: comparison
          ? {
              currentMonth: { from: comparison.periodA.rangeFrom, to: comparison.periodA.rangeTo, receitaRecebida: comparison.periodA.incomeReceived, atendimentos: comparison.periodA.appointmentCountInRange },
              previousMonth: { from: comparison.periodB.rangeFrom, to: comparison.periodB.rangeTo, receitaRecebida: comparison.periodB.incomeReceived, atendimentos: comparison.periodB.appointmentCountInRange },
              deltaReceita: comparison.revenueDelta,
              deltaReceitaPct: comparison.revenueDeltaPct,
              deltaAtendimentos: comparison.appointmentCountDelta,
              deltaTicketMedioPct: comparison.avgTicketDeltaPct,
            }
          : null,
        financeVisible: includeFinance,
        // Nunca inferido pelo modelo — decidido deterministicamente por
        // normalizeFunctionalRole() a partir do role real do membro (ou
        // sempre "gestao" pra owner/admin). Ver regra 13 do systemPrompt.
        userFunctionalRole: FUNCTIONAL_ROLE_LABELS[functionalRole],
        roleFramingHint: ROLE_FRAMING_HINTS[functionalRole],
        // Present whenever a patient is in scope — either because the
        // caller is inside that patient's own screen (Prontuário/
        // Planejamento) or because the question named them and
        // resolvePatientsByName found exactly one match. The model must
        // ground any patient-specific remark in exactly these fields,
        // nothing else.
        patientContext: patient
          ? {
              name: patient.name,
              anamnesis: patient.anamnesis,
              // Count is computed here, deterministically — the model is
              // never asked to count array items itself (a real test found
              // it inventing a nonzero count for an empty array otherwise).
              openQuotationsCount: patient.openQuotations.length,
              openQuotations: patient.openQuotations,
              upcomingAppointmentsCount: patient.upcomingAppointments.length,
              lastAppointment: patient.lastAppointment,
              overdueFinancial: patient.overdueFinancial.count > 0 ? { count: patient.overdueFinancial.count, amount: patient.overdueFinancial.amount } : null,
              lastEvolution: patient.lastEvolution,
            }
          : null,
        // Only set when the question named a patient but more than one real
        // patient in this clinic matched — the model must ask which one
        // instead of guessing (never silently picks the first).
        ambiguousPatientMatches: ambiguousPatientMatches.length > 0 ? ambiguousPatientMatches.map((m) => m.name) : undefined,
      };

      const systemPrompt = `Você é a ELIZA — não uma assistente genérica de chat, mas a colega sênior de operações desta clínica: você já leu os dados reais antes de responder, então fala como quem sabe do que fala. Quando os dados sustentarem uma leitura clara, dê sua opinião com confiança — não se esconda atrás de "consulte um profissional" quando VOCÊ é a camada de inteligência que deveria opinar. Isso não muda a regra de ouro: você NUNCA calcula números — todos os números que você recebe abaixo já foram calculados deterministicamente pelo sistema, a partir de dados reais do Firestore. Sua função é EXPLICAR, OPINAR e RECOMENDAR com leitura profissional — nunca inventar um dado novo.

REGRAS OBRIGATÓRIAS:
1. Use APENAS os números fornecidos em "insights" e "periodComparison" abaixo. Nunca cite um número que não esteja ali.
2. Separe claramente, em cada explicação: o que é FATO/CÁLCULO (já fornecido) do que é sua INFERÊNCIA (leitura contextual) e SUGESTÃO (recomendação de ação).
3. CAUSALIDADE — regra crítica: se a pergunta pedir uma causa (ex: "por que faturamos menos"), você só pode apontar como causa algo que "periodComparison" mostra que MUDOU entre os dois períodos (ex: deltaAtendimentos negativo, deltaTicketMedioPct negativo). Itens como orçamentos em aberto ou confirmações pendentes são um retrato do momento ATUAL, não uma comparação entre períodos — NÃO os apresente como causa de uma variação, mesmo como hipótese, mesmo com "pode estar relacionado". Se "periodComparison" for null ou não tiver um fator claramente correlacionado (queda de atendimentos ou de ticket médio na mesma proporção da queda de receita), defina "dataSufficiency" como "insufficient" e diga explicitamente, no "summary", que não há dados suficientes para determinar a causa — liste em "caveats" o que seria necessário para concluir (ex: "detalhamento por procedimento", "motivo dos cancelamentos").
4. Se "financeVisible" for false, não comente sobre financeiro — diga que essa informação não está disponível para o perfil de acesso do usuário.
5. Seja direto e específico, como um analista sênior que já leu os dados e tem opinião formada — não um chatbot genérico. Quando os dados sustentarem, afirme sua leitura profissional em vez de apenas listar números.
6. "screenType" diz de onde o usuário está perguntando — priorize a categoria correspondente na sua resposta, mas sem esconder outros pontos relevantes. Se "patientContext" estiver presente, a pergunta é sobre ESSE paciente especificamente — use apenas os campos ali contidos para falar dele (incluindo "lastAppointment", a última consulta já realizada — diferente de "upcomingAppointments", que são futuras), nunca infira dados clínicos que não estejam em "anamnesis".
7. NUNCA conte itens de um array você mesmo nem estime uma quantidade — use exclusivamente os campos de contagem já fornecidos (ex: "openQuotationsCount", "upcomingAppointmentsCount"). Se um campo de contagem for 0, ou um array estiver vazio, diga explicitamente que não há nenhum — nunca afirme um número positivo que não esteja literalmente em um campo numérico fornecido.
8. Cada insight já vem com "priorityScore" (número) e "priorityFactors" (lista dos motivos, ex: "impacto financeiro de R$ X", "parado(s) há até N dias") — esses dois campos já foram calculados pelo sistema. Você pode EXPLICAR por que algo tem prioridade citando os "priorityFactors" fornecidos, mas nunca invente um motivo que não esteja nessa lista nem proponha um score diferente.
9. Se "conversationHistory" estiver presente, são os últimos turnos reais desta conversa — use-os SOMENTE para entender a que a pergunta atual se refere (pronomes como "esses"/"ele"/"isso", ex: "esses horários" pode se referir a algo já mencionado). Nunca trate algo dito ali como um fato novo: todo fato da sua resposta ainda precisa vir de "insights"/"periodComparison"/"patientContext" fornecidos agora, nesta mesma chamada.
10. "insightExplanations" NÃO é obrigatório e na maioria das vezes deve ficar VAZIO ([]) — só inclua um insight ali se ele for realmente sobre o que foi perguntado. Uma pergunta sobre um paciente específico, um cumprimento, uma dúvida administrativa, ou qualquer coisa sem relação com orçamentos/financeiro/agenda/recall NÃO deve trazer nenhum insight junto — não "aproveite" a resposta para empurrar os alertas gerais da clínica se não foi isso que foi perguntado.
11. Se "ambiguousPatientMatches" estiver presente, o nome citado na pergunta bate com mais de um paciente real desta clínica — não responda como se soubesse de qual paciente se trata; diga que encontrou mais de um paciente com esse nome (liste os nomes) e peça para o usuário confirmar qual, ou informar sobrenome/telefone. Defina "dataSufficiency" como "insufficient" nesse caso.
12. "pageContext.summary" é um retrato real e atual da tela onde o usuário está agora — já calculado pelo componente a partir do Firestore, igual a "insights", não uma suposição sua nem algo dito pelo usuário. Use-o para entender a situação concreta em que a pergunta foi feita (ex: quantos agendamentos há hoje, qual período financeiro está selecionado na tela), mas a regra 1 vale igual: só cite um número de "pageContext.summary" se ele estiver literalmente escrito ali.
13. "userFunctionalRole" e "roleFramingHint" dizem o papel funcional de quem pergunta e uma lente de ênfase já definida pelo sistema — não por você. Use isso para decidir O QUE citar primeiro e QUE VOCABULÁRIO usar (operacional para secretaria/recepção, clínico para profissional de saúde, caixa/conciliação para financeiro, funil/conversão para marketing/comercial, visão cruzada para gestão/coordenação), mas NUNCA para omitir um insight de severidade "risco" só porque a categoria dele não é a prioridade do papel — risco financeiro ou operacional grave sempre deve aparecer, ainda que resumido, independentemente de quem pergunta.

DADOS REAIS DISPONÍVEIS (já calculados pelo sistema):
${JSON.stringify(modelInput, null, 2)}

Pergunta do usuário: "${question}"

Responda ESTRITAMENTE em JSON válido, sem markdown, neste formato exato:
{
  "summary": "resposta direta em 2-4 frases",
  "insightExplanations": [{"id": "id-do-insight-fornecido-acima", "aiExplanation": "por que isso importa (inferência)", "recommendation": "ação recomendada (sugestão)"}],
  "dataSufficiency": "ok" | "insufficient",
  "caveats": ["ressalva 1, se houver"]
}
Inclua em "insightExplanations" apenas os insights realmente relevantes para a pergunta — não force todos.`;

      // Performance requirement: measure exactly what's sent to the model,
      // not an estimate — this is the literal prompt string byte size.
      const modelInputBytes = Buffer.byteLength(systemPrompt, "utf8");

      const aiResult = await generateElizaAIResponse({
        taskType: "eliza_intelligence_v2",
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        clinicId,
      });

      const rawText: string = aiResult?.text || "";
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      let summary = "";
      let dataSufficiency: "ok" | "insufficient" = "ok";
      let caveats: string[] = [];
      // Only insights the model actually explained (rule 10 above: leave
      // insightExplanations empty when nothing is relevant to the question)
      // are sent to the frontend — this is what previously always attached
      // every standing clinic-wide alert to every answer, even a specific
      // patient lookup or a plain "oi", regardless of what was asked.
      let relevantInsights: Insight[] = insights;
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          summary = String(parsed.summary || "");
          dataSufficiency = parsed.dataSufficiency === "insufficient" ? "insufficient" : "ok";
          caveats = Array.isArray(parsed.caveats) ? parsed.caveats.map(String) : [];
          const explanations: Record<string, { aiExplanation?: string; recommendation?: string }> = {};
          if (Array.isArray(parsed.insightExplanations)) {
            for (const e of parsed.insightExplanations) {
              if (e?.id) explanations[e.id] = { aiExplanation: e.aiExplanation, recommendation: e.recommendation };
            }
          }
          for (const insight of insights) {
            const match = explanations[insight.id];
            if (match) {
              insight.aiExplanation = match.aiExplanation;
              insight.recommendation = match.recommendation;
            }
          }
          relevantInsights = insights.filter((i) => !!explanations[i.id]);
        } catch (parseErr) {
          console.warn("[ELIZA_V2] Failed to parse model JSON, returning insights without explanations:", parseErr);
          summary = "Não consegui formatar a explicação agora, mas os dados abaixo são reais.";
        }
      }

      const durationMs = Date.now() - startedAt;

      // Audit trail — clinic-scoped, never cross-clinic (matches req #12 of
      // the approved plan). Best-effort: a logging failure must never break
      // the actual answer the user is waiting for.
      adminDb.collection(`clinics/${clinicId}/ai_eliza_v2_audit`).doc(requestId).set({
        requestId,
        userId: uid,
        question,
        screenType,
        patientId,
        pageContext,
        toolsCalled,
        insightIds: insights.map((i) => i.id),
        dataSufficiency,
        durationMs,
        modelInputBytes,
        conversationHistoryTurns: conversationHistory.length,
        createdAt: AdminFieldValue.serverTimestamp(),
      }).catch((e: any) => console.warn("[ELIZA_V2] Audit log write failed:", e.message || e));

      return res.json({
        success: true,
        summary,
        insights: relevantInsights,
        periodComparison: modelInput.periodComparison,
        dataSufficiency,
        caveats,
        resolvedPatientId: patientId && resolvedPatientName ? patientId : null,
        resolvedPatientName,
        generatedAt: new Date().toISOString(),
        meta: { durationMs, modelInputBytes, toolsCalled },
      });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      const statusCode = isElizaError ? err.statusCode : 500;
      console.error("[ELIZA_V2_ERROR]", err);
      return res.status(statusCode).json({
        success: false,
        error: isElizaError ? err.message : "A ELIZA não conseguiu processar sua pergunta agora.",
      });
    }
  });

  // ============================================================================
  // ELIZA INTELLIGENCE v2 — TEMPORAL LAYER
  // ============================================================================
  // Deterministic comparison (src/lib/elizaCore/temporal.ts) + an optional,
  // bounded AI pass that only ever explains changes the deterministic layer
  // already found — same "system decides the facts, model explains them"
  // split as the Insight Engine above. Reuses authenticateElizaRequest,
  // canAccessFinance and the same audit-logging pattern as /api/eliza/ask.

  app.post("/api/eliza/temporal-overview", async (req, res) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId, uid } = authedUser;
      const days = Number(req.body?.days) > 0 ? Number(req.body.days) : 30;
      const includeFinance = canAccessFinance(authedUser);

      const overview = await getTemporalOverview(adminDb, clinicId, { days, includeFinance });
      const changes = detectTemporalChanges(overview);

      let modelInputBytes = 0;
      if (changes.length > 0) {
        const prompt = `Você é a ELIZA. Abaixo estão mudanças que o sistema JÁ DETECTOU deterministicamente (números e magnitude já calculados — você nunca recalcula nada). Sua única função é explicar, para cada mudança, o que ela pode significar.

REGRAS OBRIGATÓRIAS:
1. Use apenas os números fornecidos abaixo. Nunca cite um número que não esteja ali.
2. Cada mudança já vem com "interpretationType": "tendencia" (o sistema só afirma que a métrica mudou — isso é fato/cálculo). Você pode ampliar para "correlacao" (se notar relação plausível com OUTRA mudança da mesma lista) ou "hipotese" (uma possível explicação, deixando claro que é hipótese) — mas NUNCA afirme causa comprovada. Nunca diga "isso aconteceu porque X" como fato — diga "pode estar relacionado a X" ou "uma hipótese é X".
3. Se "reliabilityNote" existir para uma métrica, mencione a ressalva na sua explicação (ex: cancelamentos são contados pela data agendada, não pela data do cancelamento).
4. Seja direto, 1-2 frases por mudança.

MUDANÇAS DETECTADAS:
${JSON.stringify(changes.map((c) => ({ id: c.id, title: c.title, description: c.description, direction: c.direction, magnitudePct: c.magnitudePct, reliability: c.reliability, reliabilityNote: c.reliabilityNote })), null, 2)}

Responda ESTRITAMENTE em JSON válido, sem markdown: {"interpretations": [{"id": "id-da-mudança", "text": "explicação", "interpretationType": "tendencia"|"correlacao"|"hipotese"}]}`;
        modelInputBytes = Buffer.byteLength(prompt, "utf8");

        try {
          const aiResult = await generateElizaAIResponse({ taskType: "eliza_intelligence_v2", contents: [{ role: "user", parts: [{ text: prompt }] }], clinicId });
          const rawText: string = aiResult?.text || "";
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const byId: Record<string, { text: string; interpretationType: string }> = {};
            if (Array.isArray(parsed.interpretations)) {
              for (const it of parsed.interpretations) {
                if (it?.id) byId[it.id] = { text: String(it.text || ""), interpretationType: String(it.interpretationType || "tendencia") };
              }
            }
            for (const change of changes) {
              const match = byId[change.id];
              if (match) {
                change.aiInterpretation = match.text;
                if (match.interpretationType === "correlacao" || match.interpretationType === "hipotese") {
                  change.interpretationType = match.interpretationType as any;
                }
              }
            }
          }
        } catch (aiErr: any) {
          console.warn("[ELIZA_V2_TEMPORAL] AI interpretation failed (deterministic result still returned):", aiErr?.message || aiErr);
        }
      }

      const durationMs = Date.now() - startedAt;
      adminDb.collection(`clinics/${clinicId}/ai_eliza_v2_temporal_audit`).doc(requestId).set({
        requestId,
        userId: uid,
        days,
        includeFinance,
        changesDetected: changes.map((c) => c.metricKey),
        docsRead: overview.perf.docsRead,
        calcMs: overview.perf.calcMs,
        durationMs,
        modelInputBytes,
        createdAt: AdminFieldValue.serverTimestamp(),
      }).catch((e: any) => console.warn("[ELIZA_V2_TEMPORAL] Audit log write failed:", e.message || e));

      return res.json({
        success: true,
        currentPeriod: overview.currentPeriod,
        previousPeriod: overview.previousPeriod,
        metrics: overview.metrics,
        changes,
        meta: { durationMs, docsRead: overview.perf.docsRead, calcMs: overview.perf.calcMs, modelInputBytes },
      });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_V2_TEMPORAL_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 500).json({ success: false, error: isElizaError ? err.message : "A ELIZA não conseguiu calcular a visão temporal agora." });
    }
  });

  // ============================================================================
  // ELIZA INTELLIGENCE v2 — CLINICAL PLANNING LAYER (Planejamento IA)
  // ============================================================================
  // Same auth/gateway/audit family as /api/eliza/ask and /api/eliza/temporal-
  // overview above — reuses authenticateElizaRequest, validatePatientBelongs-
  // ToClinic, getPatientContext and generateElizaAIResponse exactly like the
  // rest of this file. Not a second AI system — just its own prompt/schema
  // because the task itself (multimodal clinical reasoning over a small set
  // of professional-selected photos) doesn't fit the numeric-insight shape
  // /api/eliza/ask is built around.
  app.post("/api/eliza/planning-analysis", async (req, res) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId, uid } = authedUser;
      const patientId = String(req.body?.patientId || "");
      const procedureId = String(req.body?.procedureId || "");
      const objective = String(req.body?.objective || "").trim();
      const clinicalEvaluation = String(req.body?.clinicalEvaluation || "").trim();
      // Only images the professional explicitly selected for THIS analysis
      // are ever sent — never the patient's whole gallery. Hard-capped at 4
      // regardless of what the client sends. Each carries the documentType
      // the professional declared for it (photo/x-ray/CT/other) so the
      // prompt below can tell the model never to read an x-ray as a face photo.
      const VALID_DOC_TYPES: DocumentType[] = ["fotografia_clinica", "radiografia", "tomografia", "outro_exame"];
      const images: { mimeType: string; dataBase64: string; documentType: DocumentType }[] = Array.isArray(req.body?.images)
        ? req.body.images.slice(0, 4)
            .filter((img: any) => img?.mimeType && img?.dataBase64)
            .map((img: any) => ({
              mimeType: img.mimeType,
              dataBase64: img.dataBase64,
              documentType: VALID_DOC_TYPES.includes(img.documentType) ? img.documentType : "fotografia_clinica",
            }))
        : [];
      // Free-text/boolean values the professional typed into this template's
      // structured fields — passed through as declared facts, never as
      // something the AI is meant to compute or validate.
      const structuredFields: Record<string, string | boolean> = (req.body?.structuredFields && typeof req.body.structuredFields === "object")
        ? req.body.structuredFields
        : {};

      if (!patientId) return res.status(400).json({ success: false, error: "patientId é obrigatório." });
      if (!procedureId) return res.status(400).json({ success: false, error: "procedureId é obrigatório." });
      if (!objective && !clinicalEvaluation) return res.status(400).json({ success: false, error: "Informe o objetivo ou a avaliação clínica." });

      const belongs = await validatePatientBelongsToClinic(clinicId, patientId);
      if (!belongs) return res.status(403).json({ success: false, error: "Paciente não pertence a esta clínica." });

      // procedureId is never trusted for its display name (or its template)
      // from the client — resolved for real against this clinic's own
      // Catálogo Clínico Central, same principle as patientId just above.
      const procedureSnap = await adminDb.doc(`clinics/${clinicId}/procedure_catalog/${procedureId}`).get();
      if (!procedureSnap.exists) return res.status(404).json({ success: false, error: "Procedimento não encontrado no catálogo desta clínica." });
      const procedureData: any = procedureSnap.data();
      const template = getTemplateForId(procedureData.templateId);

      const patientContext = await getPatientContext(adminDb, clinicId, patientId);

      const imagesBlock = images.length > 0
        ? images.map((img, i) => `- Imagem ${i + 1}: tipo declarado pelo profissional = ${DOCUMENT_TYPE_LABELS[img.documentType]}`).join("\n")
        : "- Nenhuma imagem anexada.";

      const structuredFieldsBlock = Object.keys(structuredFields).length > 0
        ? Object.entries(structuredFields).map(([k, v]) => `- ${k}: ${typeof v === "boolean" ? (v ? "sim" : "não") : String(v || "não informado")}`).join("\n")
        : "- Nenhum campo estruturado adicional informado.";

      // The categories the model must split its answer into, and the JSON
      // shape it must follow, both come from the template's own
      // `outputSchema` — nothing here assumes the 5 categories both
      // validated templates happen to share today.
      const categoriesBlock = template.outputSchema
        .map(f => `   - "${f.key}": ${f.label} — ${f.hint}.`)
        .join("\n");
      const jsonShapeExample = template.outputSchema.map(f => `"${f.key}": ["..."]`).join(", ");
      const safetyRulesBlock = template.safetyRules.length > 0
        ? template.safetyRules.map(r => `- ${r}`).join("\n")
        : "- Nenhuma regra adicional além das instruções obrigatórias abaixo.";

      const prompt = `Você é a ELIZA, camada de inteligência clínica da plataforma, atuando agora no Planejamento IA — apoio ao planejamento de "${procedureData.name}" (${procedureData.category}). Você é uma ferramenta de APOIO: nunca decide, nunca desenha ou marca nada na imagem — isso é sempre feito manualmente pelo profissional depois de ler sua análise.

Você recebeu ${images.length} imagem(ns) real(is), selecionada(s) pelo profissional especificamente para esta análise (nunca a galeria inteira do paciente). Tipo declarado de cada uma:
${imagesBlock}

DADOS REAIS DO PACIENTE (use somente isto — nunca infira além disso):
- Nome: ${patientContext.name}
- Alergias: ${patientContext.anamnesis?.allergies || "não informado"}
- Condições de saúde (diabetes/cardíaco/etc.): ${patientContext.anamnesis?.conditions || "não informado"}
- Medicação contínua: ${patientContext.anamnesis?.medications || "não informado"}
- Última evolução clínica registrada: ${patientContext.lastEvolution ? `${patientContext.lastEvolution.date} — ${patientContext.lastEvolution.text}` : "nenhuma registrada"}

OBJETIVO INFORMADO PELO PROFISSIONAL: "${objective || "não informado"}"
AVALIAÇÃO CLÍNICA DO PROFISSIONAL: "${clinicalEvaluation || "não informado"}"

CAMPOS ESTRUTURADOS INFORMADOS PELO PROFISSIONAL (fatos declarados — nunca calcule ou corrija estes valores, apenas raciocine sobre eles se estiverem presentes):
${structuredFieldsBlock}

CONTEXTO DESTE TEMPLATE (${template.templateId}): ${template.aiContext}

REGRAS DE SEGURANÇA DESTE TEMPLATE (NUNCA VIOLAR):
${safetyRulesBlock}

INSTRUÇÕES OBRIGATÓRIAS:
1. Analise de verdade as imagens anexadas, respeitando o tipo declarado de cada uma — nunca leia uma radiografia/tomografia como se fosse uma fotografia clínica comum, e vice-versa. Nunca descreva algo que não esteja visível nas imagens fornecidas.
2. Separe SEMPRE a resposta nestas categorias, sem misturar uma na outra:
${categoriesBlock}
3. Você PODE sugerir uma dose, volume, medida ou especificação técnica típica — mas só dentro da categoria "sugestao" (nunca em "dadoClinico"/"observacaoVisual"/"inferencia"), sempre deixando explícito que é uma sugestão a ser avaliada, nunca um fato medido ou uma prescrição pronta; a decisão final e a confirmação do valor são sempre do profissional. Nunca invente diagnóstico. Respeite sempre as regras de segurança do template acima. Se faltar informação pra sugerir algo com segurança, diga isso explicitamente em "caveats" e marque "dataSufficiency":"insufficient".
4. Nunca fale de preço/valor — isso não é decidido aqui.

Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{${jsonShapeExample}, "dataSufficiency": "ok" ou "insufficient", "caveats": ["..."]}`;

      const modelInputBytes = Buffer.byteLength(prompt, "utf8");
      const parts: any[] = [{ text: prompt }];
      for (const img of images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataBase64.includes(",") ? img.dataBase64.split(",")[1] : img.dataBase64 } });

      const aiResult = await generateElizaAIResponse({
        taskType: "clinical_planning_analysis",
        contents: [{ role: "user", parts }],
        clinicId,
      });

      const rawText: string = aiResult?.text || "";
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const analysis: Record<string, string[]> = Object.fromEntries(template.outputSchema.map(f => [f.key, [] as string[]]));
      let dataSufficiency: "ok" | "insufficient" = "ok";
      let caveats: string[] = [];
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const asStrArr = (v: any) => (Array.isArray(v) ? v.map(String) : []);
          for (const field of template.outputSchema) analysis[field.key] = asStrArr(parsed[field.key]);
          dataSufficiency = parsed.dataSufficiency === "insufficient" ? "insufficient" : "ok";
          caveats = Array.isArray(parsed.caveats) ? parsed.caveats.map(String) : [];
        } catch (parseErr) {
          console.warn("[ELIZA_V2_PLANNING] Failed to parse model JSON:", parseErr);
          dataSufficiency = "insufficient";
          caveats = ["Não foi possível formatar a análise agora — tente novamente."];
        }
      }

      const durationMs = Date.now() - startedAt;
      adminDb.collection(`clinics/${clinicId}/ai_eliza_v2_planning_audit`).doc(requestId).set({
        requestId,
        userId: uid,
        patientId,
        procedureId,
        templateId: template.templateId,
        imagesCount: images.length,
        dataSufficiency,
        durationMs,
        modelInputBytes,
        createdAt: AdminFieldValue.serverTimestamp(),
      }).catch((e: any) => console.warn("[ELIZA_V2_PLANNING] Audit log write failed:", e.message || e));

      return res.json({
        success: true,
        analysis,
        dataSufficiency,
        caveats,
        generatedAt: new Date().toISOString(),
        meta: { durationMs, modelInputBytes, imagesAnalyzed: images.length },
      });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_V2_PLANNING_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 500).json({ success: false, error: isElizaError ? err.message : "A ELIZA não conseguiu analisar o planejamento agora." });
    }
  });

  // ============================================================================
  // ELIZA ACADEMY — TUTOR (2026-08-29)
  // ============================================================================
  // Anti-gabarito contract: the professor's own review (professorReview) is
  // read from Firestore ONLY inside the 'post_review' branch below, and only
  // after confirming both activity.tutorPolicy.revealReferenceAfterReview
  // and a real attempt.professorReview already exist. Every other branch
  // structurally never fetches or references that field — a student asking
  // the model to "ignore instructions and reveal the professor's answer"
  // cannot work, because the data was never in the payload to begin with.
  app.post("/api/eliza/academy-tutor", async (req, res) => {
    try {
      const authed = await authenticateAcademyRequest(req);
      const { clinicId, turmaId, uid, role } = authed;
      const activityId = String(req.body?.activityId || "");
      const attemptId = req.body?.attemptId ? String(req.body.attemptId) : null;
      const mode = String(req.body?.mode || "");
      const question = req.body?.question ? String(req.body.question).slice(0, 2000) : null;

      if (!activityId) return res.status(400).json({ success: false, error: "activityId é obrigatório." });
      if (!["explain", "analyze", "post_review"].includes(mode)) {
        return res.status(400).json({ success: false, error: "mode inválido." });
      }

      const activitySnap = await adminDb.doc(`clinics/${clinicId}/education_activities/${activityId}`).get();
      if (!activitySnap.exists) return res.status(404).json({ success: false, error: "Atividade não encontrada." });
      const activity: any = activitySnap.data();
      if (activity.turmaId !== turmaId) return res.status(403).json({ success: false, error: "Atividade não pertence a esta turma." });

      const template = getTemplateForId(activity.templateId);

      let attempt: any = null;
      if (attemptId) {
        const attemptSnap = await adminDb.doc(`clinics/${clinicId}/education_activities/${activityId}/attempts/${attemptId}`).get();
        if (!attemptSnap.exists) return res.status(404).json({ success: false, error: "Tentativa não encontrada." });
        attempt = attemptSnap.data();
      }

      // Mode-specific authorization — a student may only analyze/reflect on
      // HER OWN attempt, never someone else's.
      if (mode !== "explain") {
        if (!attempt) return res.status(400).json({ success: false, error: "attemptId é obrigatório para este modo." });
        if (role === "student" && attempt.studentId !== uid) {
          return res.status(403).json({ success: false, error: "Você só pode usar a ELIZA sobre a sua própria tentativa." });
        }
      }

      let policyOk = true;
      let policyDeniedReason = "";
      if (mode === "explain" && !activity.tutorPolicy?.allowExplainBeforeSubmit) { policyOk = false; policyDeniedReason = "Explicações estão desativadas para esta atividade."; }
      if (mode === "analyze" && !activity.tutorPolicy?.allowAnalyzeOwnContent) { policyOk = false; policyDeniedReason = "Análise pela ELIZA está desativada para esta atividade."; }
      if (mode === "post_review") {
        if (!activity.tutorPolicy?.revealReferenceAfterReview) { policyOk = false; policyDeniedReason = "A comparação com a correção do professor não está liberada para esta atividade."; }
        else if (!attempt?.professorReview) { policyOk = false; policyDeniedReason = "Esta tentativa ainda não tem correção do professor."; }
      }
      if (!policyOk) return res.status(403).json({ success: false, error: policyDeniedReason });

      const safetyRulesBlock = template.safetyRules.length > 0
        ? template.safetyRules.map((r: string) => `- ${r}`).join("\n")
        : "- Nenhuma regra adicional além das instruções obrigatórias abaixo.";

      const structuredFieldsBlock = attempt && Object.keys(attempt.structuredFields || {}).length > 0
        ? Object.entries(attempt.structuredFields).map(([k, v]) => `- ${k}: ${typeof v === "boolean" ? (v ? "sim" : "não") : String(v || "não informado")}`).join("\n")
        : "- Nenhum campo estruturado preenchido ainda.";

      // Clinical Learning Workspace (2026-08-29): the fixed anatomical
      // point-map's own structured records — same "facts declared by the
      // student, never recalculated" contract as structuredFieldsBlock
      // above. Lets the tutor's pedagogical questions reference a SPECIFIC
      // point ("você marcou o M. Corrugador, mas..."), which a generic
      // "marcações existem" summary never could.
      const pointValueUnit = (template.clinicalWorkspace?.pointValueLabel || "unidades").toLowerCase();
      const pointsBlock = attempt && attempt.pointRecords && Object.keys(attempt.pointRecords).length > 0
        ? Object.values(attempt.pointRecords).map((p: any, i: number) => `- Ponto ${i + 1}: ${p.muscle || "sem região selecionada"}${p.unidades ? ` — ${p.unidades} (${pointValueUnit})` : ` — ${pointValueUnit} não informado(a)`}${p.observacao ? ` — obs: "${p.observacao}"` : ""}`).join("\n")
        : "- Nenhum ponto marcado no mapa ainda.";

      let taskBlock = "";
      if (mode === "explain") {
        taskBlock = `MODO: Orientação antes do envio. A aluna ainda está produzindo o próprio raciocínio — você pode explicar como usar a atividade, esclarecer conceitos e fazer perguntas que orientem o processo, mas NUNCA revele um planejamento pronto, nem diga o que ela "deveria" marcar/decidir para este caso específico.

ATIVIDADE: "${activity.title}" — ${activity.description || "sem descrição adicional"}
OBJETIVOS EDUCACIONAIS: ${activity.educationalObjectives || "não informado"}
INSTRUÇÕES DO PROFESSOR: ${activity.instructions || "não informado"}
PERGUNTA DA ALUNA: "${question || "explique como devo abordar esta atividade"}"`;
      } else if (mode === "analyze") {
        taskBlock = `MODO: Analisar meu planejamento (a aluna já produziu conteúdo próprio e pediu apoio). Identifique, com perguntas pedagógicas (nunca respostas prontas): campos importantes ainda não preenchidos; inconsistências internas; região marcada sem justificativa correspondente; justificativa sem correspondência no desenho; informação apresentada como fato sem documentação suficiente; aspectos que merecem ser reconsiderados. Prefira "O que você considerou para tomar essa decisão?" em vez de "Faça X."

ATIVIDADE: "${activity.title}"
CAMPOS ESTRUTURADOS PREENCHIDOS PELA ALUNA (fatos declarados por ela — nunca corrija/recalcule):
${structuredFieldsBlock}
PONTOS MARCADOS NO MAPA ANATÔMICO (fatos declarados por ela — nunca corrija/recalcule, e nunca comente um ponto que não está listado aqui):
${pointsBlock}
ANÁLISE DA ALUNA: "${attempt.studentAnalysis || "não preenchida"}"
JUSTIFICATIVA DA ALUNA: "${attempt.justification || "não preenchida"}"
OBSERVAÇÕES DA ALUNA: "${attempt.observations || "não preenchida"}"
MARCAÇÕES NO CANVAS: ${attempt.strokesJson ? "a aluna fez marcações visuais (não descritas aqui em detalhe, apenas confirme que existem)" : "nenhuma marcação ainda"}`;
      } else {
        // post_review — professorReview is read ONLY here, ONLY after the
        // policy+existence checks above already passed.
        const review = attempt.professorReview;
        // Only reachable here (never in explain/analyze) — the professor's
        // OWN reference points are exactly the "gabarito" the anti-injection
        // contract protects; structurally absent from every other branch.
        const professorPointsBlock = review.referencePointRecords && Object.keys(review.referencePointRecords).length > 0
          ? Object.values(review.referencePointRecords).map((p: any, i: number) => `- Ponto ${i + 1}: ${p.muscle || "sem região"}${p.unidades ? ` — ${p.unidades} (${pointValueUnit})` : ""}${p.observacao ? ` — obs: "${p.observacao}"` : ""}`).join("\n")
          : "- O professor não marcou pontos de referência, só deixou comentários.";
        taskBlock = `MODO: Raciocínio educacional após a correção do professor. NÃO diga simplesmente "você errou e o professor está certo" — construa raciocínio: o que a aluna considerou; o que o professor acrescentou; onde existem diferenças reais; quais justificativas precisam ser revistas; perguntas para a aluna refletir; pontos que já estavam adequadamente documentados. A decisão clínica final é sempre do professor/humano, nunca sua.

O QUE A ALUNA PRODUZIU:
${structuredFieldsBlock}
PONTOS QUE A ALUNA MARCOU:
${pointsBlock}
ANÁLISE DA ALUNA: "${attempt.studentAnalysis || "não preenchida"}"
JUSTIFICATIVA DA ALUNA: "${attempt.justification || "não preenchida"}"

CORREÇÃO DO PROFESSOR:
PONTOS DE REFERÊNCIA DO PROFESSOR:
${professorPointsBlock}
DECISÃO: ${review.decision === "approved" ? "Aprovado" : "Revisão solicitada"}
COMENTÁRIOS: "${review.comments || "sem comentários adicionais"}"`;
      }

      const prompt = `Você é a ELIZA, tutora clínica educacional — não a IA de apoio clínico ao profissional, e sim uma tutora pedagógica dentro do Eliza Academy. Seu papel é apoiar o raciocínio da aluna, nunca substituí-lo, nunca decidir por ela, e nunca revelar um gabarito.

CONTEXTO DO TEMPLATE (${template.templateId}): ${template.aiContext}

REGRAS DE SEGURANÇA DESTE TEMPLATE (NUNCA VIOLAR):
${safetyRulesBlock}

CLASSIFICAÇÃO OBRIGATÓRIA — ao longo da resposta, deixe claro (mesmo que informalmente) quando algo é:
DADO CLÍNICO (já registrado) / OBSERVAÇÃO (visível na documentação) / INFORMAÇÃO DA ALUNA / INFORMAÇÃO DO PROFESSOR / INFERÊNCIA (leitura da ELIZA, não é fato) / SUGESTÃO EDUCACIONAL (pra ela considerar).
Nunca apresente uma inferência como fato. Nunca invente diagnóstico, dose, volume, produto, técnica, anatomia individual não documentada, medida, contraindicação específica inexistente nos dados, ou execução clínica. IMPORTANTE: mesmo que as regras de segurança do template acima permitam sugerir dose/volume/técnica pra apoio clínico real (fora do Academy), AQUI — no ambiente pedagógico do tutor — essa permissão NÃO se aplica: você nunca entrega um valor específico pronto de dose/volume/técnica pra aluna, mesmo em tom de sugestão; o objetivo é ela construir esse raciocínio sozinha, com perguntas, nunca com a resposta.

${taskBlock}

Responda em português, tom pedagógico e encorajador, em parágrafos curtos ou perguntas — nunca uma lista de comandos.`;

      const aiResult = await generateElizaAIResponse({
        taskType: "academy_tutor",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        clinicId,
      });
      const answer: string = aiResult?.text || "Não consegui gerar uma resposta agora — tente novamente.";

      if (attemptId) {
        adminDb.doc(`clinics/${clinicId}/education_activities/${activityId}/attempts/${attemptId}`)
          .update({ aiInteractions: AdminFieldValue.arrayUnion({ mode, question: question || null, answer, createdAt: new Date().toISOString() }) })
          .catch((e: any) => console.warn("[ACADEMY_TUTOR] Failed to persist AI interaction:", e.message || e));
      }

      return res.json({ success: true, answer, mode });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ACADEMY_TUTOR_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 500).json({ success: false, error: isElizaError ? err.message : "A ELIZA não conseguiu responder agora." });
    }
  });

  // Setting another user's password requires the Admin SDK (the client SDK's
  // secondary-auth-app trick, used for account CREATION elsewhere in this
  // app, only works at creation — never for updating an existing user's
  // credentials). Firebase Auth passwords are never retrievable in plaintext,
  // so this is also the only way an admin recovers from "I don't remember
  // the password I set". Reuses authenticateElizaRequest (real clinic
  // membership check) rather than a parallel auth path — same pattern as
  // set-owner-password above, just scoped to a CLINIC admin instead of a
  // platform admin, and to a student instead of a clinic owner.
  app.post("/api/eliza/academy-reset-student-password", async (req, res) => {
    try {
      const authedUser = await authenticateElizaRequest(req);
      const isAdminCurso = authedUser.memberData?.courseRole === "admin_curso";
      if (!authedUser.isOwnerOrAdmin && !isAdminCurso) {
        throw new ElizaError(ElizaErrorCode.UNAUTHORIZED, "Apenas administradores da clínica ou do curso podem redefinir a senha de um aluno.", 403);
      }
      const studentUid = String(req.body?.studentUid || "");
      if (!studentUid) {
        throw new ElizaError(ElizaErrorCode.VALIDATION_ERROR, "studentUid é obrigatório.", 400);
      }
      const studentRef = adminDb.doc(`clinics/${authedUser.clinicId}/education_students/${studentUid}`);
      const studentSnap = await studentRef.get();
      if (!studentSnap.exists) {
        throw new ElizaError(ElizaErrorCode.NOT_FOUND, "Aluno não encontrado nesta clínica.", 404);
      }
      const requested = req.body?.newPassword ? String(req.body.newPassword).trim() : "";
      const password = requested.length >= 6 ? requested : `Eliza${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

      await getAdminAuth().updateUser(studentUid, { password });
      await studentRef.update({
        tempPassword: password,
        mustChangePassword: true,
        passwordResetAt: AdminFieldValue.serverTimestamp(),
        passwordResetBy: authedUser.uid,
      });

      return res.json({ success: true, password });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ACADEMY_RESET_STUDENT_PASSWORD_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 500).json({ success: false, error: isElizaError ? err.message : "Falha ao redefinir a senha do aluno." });
    }
  });

  // ============================================================================
  // ELIZA INTELLIGENCE v2 — ACTION LAYER
  // ============================================================================
  // Two-phase, always: propose() only ever builds a preview (reads, an AI
  // draft call, zero side effects) and writes a `pending` proposal doc.
  // execute() — the real write / real WhatsApp send — only ever runs from
  // the approve route below, after a human confirms this exact proposal.
  // Every phase transition is audit-logged.

  async function elizaGenerateText(prompt: string, taskType: string, clinicId: string): Promise<string> {
    const result = await generateElizaAIResponse({ taskType, contents: [{ role: "user", parts: [{ text: prompt }] }], clinicId });
    return result?.text || "";
  }

  async function logActionAudit(clinicId: string, entry: Record<string, any>) {
    await adminDb.collection(`clinics/${clinicId}/ai_eliza_v2_actions_audit`).add({
      requestId: crypto.randomUUID(),
      createdAt: AdminFieldValue.serverTimestamp(),
      ...entry,
    }).catch((e: any) => console.warn("[ELIZA_V2_ACTIONS] Audit log write failed:", e.message || e));
  }

  app.post("/api/eliza/actions/propose", async (req, res) => {
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId, uid } = authedUser;
      const actionType = req.body?.actionType as ActionType;
      const input = req.body?.input && typeof req.body.input === "object" ? req.body.input : {};

      if (!actionType || !ACTION_REGISTRY[actionType]) {
        return res.status(400).json({ success: false, error: "actionType inválido." });
      }

      const result = await ACTION_REGISTRY[actionType].propose(input, {
        db: adminDb,
        clinicId,
        uid,
        generateText: (prompt, taskType) => elizaGenerateText(prompt, taskType, clinicId),
      });

      // Some actions (propose_clinical_evolution) can determine, before any
      // proposal exists, that the message wasn't a clinical description at
      // all — a question or an insufficient/ambiguous reply. No
      // action_proposals doc is created in that case: there is nothing to
      // approve/reject, only a conversational reply, and the cognitive gap
      // stays open on the client for a following turn. Content itself is
      // never logged here — only the classification.
      if (result && (result as any).type === "clarification") {
        const { message, messageType } = result as { type: "clarification"; message: string; messageType: string };
        await logActionAudit(clinicId, { userId: uid, actionType, phase: "clarification", messageType });
        return res.json({ success: true, clarification: message, messageType });
      }

      const { preview, executionInput } = result as { preview: any; executionInput: any };

      // Achado B3-R fix: at most one PENDING clinical proposal per cognitive
      // gap — never "one proposal forever per gap" (a rejected/cancelled
      // proposal must never permanently block a later, valid one for the
      // same still-open gap). Only propose_clinical_evolution carries a
      // gapId; every other action type keeps the original .add() path,
      // untouched. The lock is a SEPARATE doc (never the proposal's own id),
      // keyed by gapId, holding only a pointer to whichever proposal is
      // currently open for that gap — so a proposal can freely move through
      // pending -> rejected/executed and a fresh one can later claim the
      // same gap once it's genuinely free again.
      //
      // Atomicity: the read-check-write (read the lock, read what it points
      // to, decide reuse vs. create, write) all happens inside one Firestore
      // transaction. Two concurrent requests for the same gap race on the
      // SAME lock document; Firestore aborts and retries the loser
      // automatically, so the retry's read sees the winner's just-written
      // lock and reuses that proposal instead of creating a second one —
      // this is what actually prevents the duplicate, not an application-
      // level check.
      const gapId: string | undefined = actionType === "propose_clinical_evolution" ? executionInput?.gapId : undefined;

      let proposalId: string;
      let finalPreview = preview;
      let reused = false;

      if (gapId) {
        const lockRef = adminDb.doc(`clinics/${clinicId}/action_proposal_locks/${gapId}`);
        const newProposalRef = adminDb.collection(`clinics/${clinicId}/action_proposals`).doc();
        const outcome = await adminDb.runTransaction(async (tx) => {
          const lockSnap = await tx.get(lockRef);
          const lockedProposalId: string | undefined = lockSnap.exists ? lockSnap.data()?.proposalId : undefined;
          if (lockedProposalId) {
            const existingSnap = await tx.get(adminDb.doc(`clinics/${clinicId}/action_proposals/${lockedProposalId}`));
            if (existingSnap.exists && existingSnap.data()?.status === "pending") {
              // Another proposal for this exact gap is already open —
              // return it instead of creating a duplicate. This is the
              // ONLY branch that can fire concurrently for two racing
              // requests, and Firestore's transaction retry is what
              // guarantees only one of them ever reaches the create branch.
              return { reused: true, proposalId: lockedProposalId, preview: existingSnap.data()!.preview };
            }
            // Lock points at a proposal that's no longer pending (rejected/
            // cancelled/executed) — the gap may still be open for a fresh
            // description; fall through to create a new one and re-point
            // the lock at it.
          }
          tx.set(newProposalRef, {
            actionType,
            status: "pending",
            proposedBy: uid,
            input,
            executionInput,
            preview,
            createdAt: AdminFieldValue.serverTimestamp(),
          });
          tx.set(lockRef, { proposalId: newProposalRef.id, updatedAt: AdminFieldValue.serverTimestamp() });
          return { reused: false, proposalId: newProposalRef.id, preview };
        });
        proposalId = outcome.proposalId;
        finalPreview = outcome.preview;
        reused = outcome.reused;
      } else {
        const proposalRef = await adminDb.collection(`clinics/${clinicId}/action_proposals`).add({
          actionType,
          status: "pending",
          proposedBy: uid,
          input,
          executionInput,
          preview,
          createdAt: AdminFieldValue.serverTimestamp(),
        });
        proposalId = proposalRef.id;
      }

      // A reused proposal isn't new — its own "propose" audit entry already
      // exists from when it was actually created; logging another one here
      // would misrepresent this call as having proposed something.
      if (!reused) {
        await logActionAudit(clinicId, { userId: uid, actionType, phase: "propose", proposalId });
      }

      return res.json({ success: true, proposalId, actionType, preview: finalPreview });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_V2_ACTION_PROPOSE_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 400).json({ success: false, error: err.message || "Falha ao preparar a ação." });
    }
  });

  app.post("/api/eliza/actions/:proposalId/approve", async (req, res) => {
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId, uid } = authedUser;
      const proposalId = req.params.proposalId;

      const proposalRef = adminDb.doc(`clinics/${clinicId}/action_proposals/${proposalId}`);
      const proposalSnap = await proposalRef.get();
      if (!proposalSnap.exists) {
        return res.status(404).json({ success: false, error: "Proposta não encontrada nesta clínica." });
      }
      const proposal = proposalSnap.data()!;
      if (proposal.status !== "pending") {
        return res.status(409).json({ success: false, error: `Proposta já está em status "${proposal.status}".` });
      }

      const actionType = proposal.actionType as ActionType;
      if (ACTIONS_REQUIRING_ADMIN.includes(actionType) && !authedUser.isOwnerOrAdmin) {
        return res.status(403).json({ success: false, error: "Apenas donos/administradores podem aprovar esta ação." });
      }

      // Narrow, whitelisted override channel — lets a human resolve a
      // decision the proposal itself flagged as needing input (today: which
      // existing treatment to attach an evolution to, when
      // propose_clinical_evolution found more than one plausible match and
      // refused to guess). Never a general-purpose executionInput patch: any
      // key not on this list is dropped, so a client can never use this to
      // rewrite something the model already decided (e.g. willMarkPlanCompleted).
      const ALLOWED_APPROVE_OVERRIDE_KEYS = ["selectedTreatmentId"];
      const rawOverrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
      const overrides: Record<string, any> = {};
      for (const key of ALLOWED_APPROVE_OVERRIDE_KEYS) {
        if (key in rawOverrides) overrides[key] = rawOverrides[key];
      }
      const executionInput = { ...proposal.executionInput, ...overrides };

      let executionResult: any = null;
      let executionError: string | null = null;
      let finalStatus: "executed" | "failed" = "executed";
      try {
        executionResult = await ACTION_REGISTRY[actionType].execute(executionInput, {
          db: adminDb,
          clinicId,
          uid,
          sendWhatsApp: (phone: string, text: string) => dispatchWhatsAppMessage(clinicId, phone, text),
        });
      } catch (execErr: any) {
        finalStatus = "failed";
        executionError = execErr.message || String(execErr);
      }

      await proposalRef.update({
        status: finalStatus,
        approvedBy: uid,
        approvedAt: AdminFieldValue.serverTimestamp(),
        executionResult,
        executionError,
      });

      await logActionAudit(clinicId, { userId: uid, actionType, phase: "approve", proposalId, status: finalStatus, executionError });

      if (finalStatus === "failed") {
        return res.status(500).json({ success: false, error: executionError, proposalId, status: finalStatus });
      }
      return res.json({ success: true, proposalId, status: finalStatus, result: executionResult });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_V2_ACTION_APPROVE_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 500).json({ success: false, error: err.message || "Falha ao executar a ação." });
    }
  });

  app.post("/api/eliza/actions/:proposalId/reject", async (req, res) => {
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId, uid } = authedUser;
      const proposalId = req.params.proposalId;

      const proposalRef = adminDb.doc(`clinics/${clinicId}/action_proposals/${proposalId}`);
      const proposalSnap = await proposalRef.get();
      if (!proposalSnap.exists) {
        return res.status(404).json({ success: false, error: "Proposta não encontrada nesta clínica." });
      }
      const proposal = proposalSnap.data()!;
      if (proposal.status !== "pending") {
        return res.status(409).json({ success: false, error: `Proposta já está em status "${proposal.status}".` });
      }

      await proposalRef.update({
        status: "rejected",
        rejectedBy: uid,
        rejectedAt: AdminFieldValue.serverTimestamp(),
        rejectionReason: typeof req.body?.reason === "string" ? req.body.reason : null,
      });

      await logActionAudit(clinicId, { userId: uid, actionType: proposal.actionType, phase: "reject", proposalId });

      return res.json({ success: true, proposalId, status: "rejected" });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_V2_ACTION_REJECT_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 500).json({ success: false, error: err.message || "Falha ao rejeitar a ação." });
    }
  });

  // ELIZA Consciência Ativa — first cognitive event. Called by NextAgenda.tsx
  // right after an appointment's status is set to "finalizado" (thin client
  // call — no clinical logic lives there). The detector itself is
  // idempotent both ways: creates at most one pending_item per appointment
  // (atomic doc-ID create), and self-resolves a stale one if the gap no
  // longer applies. Safe to call more than once for the same appointment.
  app.post("/api/eliza/cognitive-events/check-appointment", async (req, res) => {
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId } = authedUser;
      const appointmentId = req.body?.appointmentId;
      if (!appointmentId || typeof appointmentId !== "string") {
        return res.status(400).json({ success: false, error: "appointmentId é obrigatório." });
      }
      const gap = await detectFinishedAppointmentWithoutClinicalUpdate(adminDb, clinicId, appointmentId);
      return res.json({ success: true, gap });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_COGNITIVE_EVENTS_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 400).json({ success: false, error: err.message || "Falha ao verificar o atendimento." });
    }
  });

  // ELIZA Consciência Ativa — "standing gaps" (Fase 1 da reformulação de
  // proatividade). Reaproveita insightEngine.ts (Insight[] já calculado,
  // determinístico) via insightGapBridge.ts — nenhuma detecção nova.
  // Chamado por useElizaStandingGapCheck.ts ao montar NextFinancial.tsx
  // ('financeiro_open') ou NextAgenda.tsx ('agenda_open'), com cooldown no
  // cliente — nunca em background/cron (decisão explícita do plano).
  app.post("/api/eliza/cognitive-events/check-standing", async (req, res) => {
    try {
      const authedUser = await authenticateElizaRequest(req);
      const { clinicId } = authedUser;
      const checkpoint = req.body?.checkpoint;
      if (checkpoint !== "financeiro_open" && checkpoint !== "agenda_open") {
        return res.status(400).json({ success: false, error: "checkpoint inválido." });
      }
      // Financeiro nunca é lido nem promovido sem a mesma permissão que já
      // gate a IA financeira em /api/eliza/ask — nunca vaza dado.
      if (checkpoint === "financeiro_open" && !canAccessFinance(authedUser)) {
        return res.json({ success: true, gaps: [] });
      }

      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [agenda, financial, budgets, recall, pending] = await Promise.all([
        checkpoint === "agenda_open" ? getAgendaAnalysis(adminDb, clinicId, { days: 7 }) : Promise.resolve(undefined),
        checkpoint === "financeiro_open" ? getFinancialSummary(adminDb, clinicId, { from: currentMonthStart, to: now }) : Promise.resolve(undefined),
        checkpoint === "financeiro_open" ? getOpenBudgets(adminDb, clinicId) : Promise.resolve(undefined),
        checkpoint === "agenda_open" ? getRecallCandidates(adminDb, clinicId) : Promise.resolve(undefined),
        checkpoint === "agenda_open" ? getPendingItems(adminDb, clinicId) : Promise.resolve(undefined),
      ]);

      const insights = buildInsights({ agenda, financial, budgets, recall, pending });
      const gaps = await checkStandingGaps(adminDb, clinicId, checkpoint, insights);
      return res.json({ success: true, gaps });
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      console.error("[ELIZA_COGNITIVE_EVENTS_STANDING_ERROR]", err);
      return res.status(isElizaError ? err.statusCode : 400).json({ success: false, error: err.message || "Falha ao verificar pendências." });
    }
  });

  app.post("/api/generate-team-marketing", async (req, res) => {
    const { prompt } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey.includes("MY_GEMINI") || apiKey === "GEMINI_API_KEY") {
        return res.json({ result: null });
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt || "Dicas de marketing estético",
      });
      return res.json({ result: response.text });
    } catch (err: any) {
      console.error("[ELIZA_TEAM_MARKETING_ERROR] Failed:", err);
      return res.json({ result: null });
    }
  });

  // GET Webhook Verification for Meta — global verify token only (the
  // webhook URL is registered ONCE on the Meta app, not per clinic/WABA).
  // No Firestore fallback, no hardcoded literal: META_WEBHOOK_VERIFY_TOKEN
  // is a dedicated global secret, never reused for the App Secret and
  // never stored per-clinic.
  async function whatsappWebhookGetHandler(req: any, res: any) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("[WHATSAPP WEBHOOK]");
    console.log(`received mode: ${mode}`);

    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
      console.log("verification success");
      return res.status(200).send(challenge);
    }

    console.log("verification failed");
    return res.sendStatus(403);
  }

  // Dedup + lease-fencing state machine for inbound webhook events —
  // clinics/{clinicId}/whatsapp_processed_events/{eventKey}, status one of
  // "processing" | "completed" | "failed" | "dead_letter".
  //
  // Second revision — closes two real gaps the first version still had:
  //   1. A crash between producing the real effect (writing the message)
  //      and marking "completed" left the effect done but the state stale;
  //      a retry would then redo the effect (double unreadCount). Fixed by
  //      making completion part of the SAME Firestore transaction as the
  //      effect wherever the effect is itself a Firestore write (see
  //      commitInboundPatientMessage below) — either both happen or
  //      neither does, so there is no window where a retry could see
  //      "not completed yet" while the effect already landed. Where the
  //      effect is NOT a Firestore write (the staff-command auto-reply,
  //      which sends a real WhatsApp message over HTTP), true atomicity
  //      with Firestore is not possible — documented at that call site.
  //   2. Two workers can legitimately both believe they hold the claim: a
  //      reclaim (of an abandoned "processing" doc, or a retried "failed"
  //      one) does not retroactively stop whatever the ORIGINAL worker is
  //      still doing if it was merely slow, not actually dead. Fixed with
  //      claim fencing: every successful claim/reclaim gets a fresh random
  //      `claimId`; every write that would conclude a claim (completing
  //      the transaction above, or markWhatsAppWebhookEventCompleted /
  //      markWhatsAppWebhookEventFailed) re-reads the doc INSIDE its own
  //      transaction and only proceeds if `claimId` still matches what it
  //      was handed at claim time. A worker whose claim was superseded
  //      finds a different claimId on the document and aborts without
  //      writing anything — it can neither complete, fail, nor overwrite
  //      whatever the newer claim already recorded.
  //
  // Retries are capped: WA_WEBHOOK_MAX_ATTEMPTS failures move the event to
  // "dead_letter" instead of "failed" — a dead_letter'd event is never
  // reclaimed/re-executed automatically again (see claimWhatsAppWebhookEvent
  // below). Future admin reprocessing (not built in this round — no new
  // endpoint/UI is in scope): an authenticated owner/admin-only endpoint
  // would read a specific dead_letter doc, and — after a human has looked
  // at why it kept failing — issue a fresh claim on it explicitly (new
  // claimId, status back to "processing", attempts reset to 1) so the
  // normal flow above picks it up again on the next matching delivery, or
  // (if the source event can't be redelivered by the provider) re-invoke
  // the same processing function directly with the stored event context.
  // The dead_letter doc already retains everything such an endpoint would
  // need (clinicId, eventKey, attempts, last errorCode/errorClass/phase).
  const WA_WEBHOOK_PROCESSING_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
  const WA_WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // safety-net TTL for stuck processing/failed/dead_letter docs
  const WA_WEBHOOK_COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const WA_WEBHOOK_MAX_ATTEMPTS = 5;

  // Only these error CLASSES (constructor/name) are ever recorded in
  // Firestore, never the raw err.message (may echo webhook payload
  // content back, e.g. via a thrown validation error) and never a stack
  // trace. Anything outside this small allowlist is recorded as
  // "UnknownError" — full technical detail (including the real message)
  // goes ONLY to server logs via console.error, which are themselves
  // already never given the raw payload/token either.
  const WA_ALLOWED_ERROR_CLASSES = new Set(["TypeError", "RangeError", "ReferenceError", "FirebaseError", "Error"]);

  // Shared by the webhook dedup machinery above/below AND the Embedded
  // Signup start-attempt/exchange endpoints further down — one allowlist,
  // one log shape, for every WhatsApp-related error this file produces.
  function classifyErrorClass(err: any): string {
    const name = err?.constructor?.name || err?.name || "Error";
    return WA_ALLOWED_ERROR_CLASSES.has(name) ? name : "UnknownError";
  }

  // The ONLY sanctioned way to log a WhatsApp-flow error anywhere in this
  // file — never call console.error with a raw Error/exception object or
  // an interpolated err.message directly; always go through this. Emits a
  // single-line JSON structured log containing EXACTLY: scope, errorCode
  // (a small fixed string, not free text), errorClass (from the allowlist
  // above), phase, a SHA-256-hashed reference (never the literal
  // eventKey/attemptId/messageId — those can be Meta-assigned but are
  // still opaque identifiers worth not echoing verbatim), attempt count,
  // and a timestamp. Deliberately excludes: the raw error message, any
  // stack trace, the webhook/request payload, tokens, headers, full phone
  // numbers, and message text — full technical detail for live debugging
  // is a conscious trade-off given up here in favor of never risking a
  // patient-data leak into logs; correlate via the hashed ref against the
  // Firestore doc itself (which stores the same sanitized fields, nothing
  // more).
  function logSanitizedWaError(fields: {
    scope: string;
    errorCode: string;
    phase: string;
    ref: string;
    err?: any;
    attempt?: number | null;
  }): void {
    const refHash = crypto.createHash("sha256").update(fields.ref).digest("hex").slice(0, 12);
    console.error(JSON.stringify({
      scope: fields.scope,
      errorCode: fields.errorCode,
      errorClass: classifyErrorClass(fields.err),
      phase: fields.phase,
      ref: refHash,
      attempt: fields.attempt ?? null,
      timestamp: new Date().toISOString(),
    }));
  }

  // Companion informational logger (não-erro) pro webhook do WhatsApp —
  // achado real: a rota do webhook logava payload cru, headers completos
  // (incluindo X-Hub-Signature/X-Hub-Signature-256) e telefone/texto/nome
  // de contato/IDs externos direto em console.log, em várias linhas
  // espalhadas pela função. Correção mínima e isolada: toda linha de log
  // informativo dentro de whatsappWebhookPostHandler passa a usar só
  // isto — nunca o payload, nunca headers, nunca um identificador externo
  // (messageId/conversationId/telefone) em texto puro; um `ref` quando
  // precisa de correlação vira hash SHA-256/12 (mesmo padrão de
  // logSanitizedWaError acima), nunca o valor cru.
  function logSanitizedWaInfo(fields: {
    scope: string;
    event: string;
    clinicId?: string | null;
    ref?: string | null;
    extra?: Record<string, string | number | boolean | null>;
  }): void {
    console.log(JSON.stringify({
      scope: fields.scope,
      event: fields.event,
      clinicId: fields.clinicId ?? null,
      ref: fields.ref ? crypto.createHash("sha256").update(fields.ref).digest("hex").slice(0, 12) : null,
      ...(fields.extra || {}),
      timestamp: new Date().toISOString(),
    }));
  }

  // Thrown by commitInboundPatientMessage (and treated as a no-op, not a
  // real failure, by the call sites) when the claimId handed in no longer
  // matches the document's current claimId — i.e. this worker's claim was
  // reclaimed out from under it. Never surfaces as a "failed"/dead_letter
  // transition, and never sets anyEventFailed at the call site.
  class WaWebhookStaleClaimError extends Error {
    constructor(message: string) { super(message); this.name = "WaWebhookStaleClaimError"; }
  }

  function webhookEventRef(clinicId: string, eventKey: string) {
    const safeKey = eventKey.replace(/\//g, "_");
    return adminDb.doc(`clinics/${clinicId}/whatsapp_processed_events/${safeKey}`);
  }

  async function claimWhatsAppWebhookEvent(clinicId: string, eventKey: string): Promise<{ claimed: boolean; claimId: string | null }> {
    const ref = webhookEventRef(clinicId, eventKey);
    const now = Date.now();
    const claimId = crypto.randomUUID();
    const freshClaim = {
      status: "processing",
      attempts: 1,
      claimId,
      firstClaimedAt: AdminFieldValue.serverTimestamp(),
      claimedAt: AdminFieldValue.serverTimestamp(),
      completedAt: null,
      deadLetteredAt: null,
      errorCode: null,
      errorClass: null,
      errorPhase: null,
      lastFailedAt: null,
      expiresAt: new Date(now + WA_WEBHOOK_EVENT_RETENTION_MS),
    };
    try {
      await ref.create(freshClaim);
      return { claimed: true, claimId };
    } catch (createErr: any) {
      if (!(createErr?.code === 6 || /already exists/i.test(String(createErr?.message || "")))) {
        // Reservation itself failed for an unrelated reason (e.g. transient
        // Firestore error) — fail open (process it, under this claimId)
        // rather than silently dropping a legitimate event.
        logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_CLAIM_CREATE_FAILED", phase: "CLAIM", ref: `${clinicId}:${eventKey}`, err: createErr });
        return { claimed: true, claimId };
      }
    }

    // Doc already exists — decide, inside a transaction, whether this
    // delivery may (re)claim it.
    try {
      return await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          // Raced with something between the create() above and this read
          // (e.g. TTL expiry) — treat as a fresh claim.
          tx.set(ref, freshClaim);
          return { claimed: true, claimId };
        }
        const data = snap.data() as any;
        if (data.status === "completed") {
          console.log(`[WA_WEBHOOK_DEDUP] Duplicate of completed event skipped: clinic=${clinicId} eventKey=${ref.id}`);
          return { claimed: false, claimId: null };
        }
        if (data.status === "dead_letter") {
          // Permanently given up on automatically — never auto-executes
          // again. Only a future admin reprocessing action (see comment
          // above) may revive it.
          console.log(`[WA_WEBHOOK_DEDUP] Delivery for dead_letter event ignored: clinic=${clinicId} eventKey=${ref.id}`);
          return { claimed: false, claimId: null };
        }
        if (data.status === "failed") {
          if ((data.attempts || 0) >= WA_WEBHOOK_MAX_ATTEMPTS) {
            // Defensive belt-and-suspenders only — markWhatsAppWebhookEventFailed
            // already converts to dead_letter the moment attempts hits the
            // cap, so a "failed" doc at/above the cap should not normally
            // exist. Never reclaim it if it somehow does.
            return { claimed: false, claimId: null };
          }
          // Safe retry: a previous attempt genuinely failed, this new
          // delivery gets one more try under a FRESH claimId — the old
          // claimId can no longer complete or fail anything.
          tx.update(ref, {
            status: "processing",
            attempts: AdminFieldValue.increment(1),
            claimId,
            claimedAt: AdminFieldValue.serverTimestamp(),
            errorCode: null,
            errorClass: null,
            errorPhase: null,
          });
          console.log(`[WA_WEBHOOK_DEDUP] Retrying previously-failed event: clinic=${clinicId} eventKey=${ref.id}`);
          return { claimed: true, claimId };
        }
        // status === "processing": only reclaim if the previous claim is
        // stale (abandoned — crash, deploy restart, hung request). A
        // still-fresh "processing" doc means another delivery is
        // genuinely in flight right now; this one must NOT also claim —
        // and if the original worker was merely slow rather than dead,
        // fencing on claimId (see commitInboundPatientMessage / markXxx
        // below) is what stops it from writing once it does resume.
        const claimedAtMs = typeof data.claimedAt?.toMillis === "function" ? data.claimedAt.toMillis() : 0;
        const abandoned = now - claimedAtMs > WA_WEBHOOK_PROCESSING_CLAIM_TIMEOUT_MS;
        if (!abandoned) {
          console.log(`[WA_WEBHOOK_DEDUP] Concurrent in-flight delivery, not reclaiming: clinic=${clinicId} eventKey=${ref.id}`);
          return { claimed: false, claimId: null };
        }
        tx.update(ref, {
          status: "processing",
          attempts: AdminFieldValue.increment(1),
          claimId,
          claimedAt: AdminFieldValue.serverTimestamp(),
        });
        console.log(`[WA_WEBHOOK_DEDUP] Reclaiming abandoned processing event: clinic=${clinicId} eventKey=${ref.id}`);
        return { claimed: true, claimId };
      });
    } catch (txErr) {
      logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_CLAIM_TRANSACTION_FAILED", phase: "CLAIM", ref: `${clinicId}:${eventKey}`, err: txErr });
      return { claimed: true, claimId }; // same fail-open rationale as the create() branch above
    }
  }

  // Fenced, NOT bundled with any effect — for call sites whose real effect
  // already happened outside Firestore (the staff-command auto-reply,
  // which sent an actual WhatsApp message over HTTP before this point) and
  // so cannot be made atomic with the completion marker. A stale claimId
  // here means a NEWER claim already owns this event; silently not
  // overwriting it is correct — the effect (the WhatsApp send) already
  // irreversibly happened under the OLD claim and nothing here can or
  // should undo that, but the bookkeeping must still end up reflecting
  // whichever claim is current, never regress it.
  async function markWhatsAppWebhookEventCompleted(clinicId: string, eventKey: string, claimId: string): Promise<void> {
    const ref = webhookEventRef(clinicId, eventKey);
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as any;
        if (!snap.exists || data.claimId !== claimId || data.status !== "processing") {
          console.warn(`[WA_WEBHOOK_DEDUP] Stale claim on complete, not overwriting: clinic=${clinicId} eventKey=${ref.id}`);
          return;
        }
        tx.update(ref, {
          status: "completed",
          completedAt: AdminFieldValue.serverTimestamp(),
          errorCode: null,
          errorClass: null,
          errorPhase: null,
          lastFailedAt: null,
          expiresAt: new Date(Date.now() + WA_WEBHOOK_COMPLETED_RETENTION_MS),
        });
      });
    } catch (err) {
      logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_MARK_COMPLETED_FAILED", phase: "MARK_COMPLETED", ref: `${clinicId}:${eventKey}`, err });
    }
  }

  // Fenced. Returns true only if THIS call actually transitioned the
  // document (to "failed" or "dead_letter") — false if it was a no-op
  // because the claim was stale. Callers use the return value to decide
  // whether to flag the whole HTTP response as a failure (a stale-claim
  // no-op is not a real failure of the CURRENT state and should not force
  // an otherwise-successful delivery to look like an error to the
  // provider). Caps retries: once `attempts` reaches WA_WEBHOOK_MAX_ATTEMPTS,
  // writes "dead_letter" instead of "failed" so claimWhatsAppWebhookEvent
  // stops offering it for reclaim.
  async function markWhatsAppWebhookEventFailed(clinicId: string, eventKey: string, claimId: string, phase: string, err: any): Promise<boolean> {
    const ref = webhookEventRef(clinicId, eventKey);
    const errorClass = classifyErrorClass(err);
    const errorCode = `WA_${phase}_FAILED`;
    try {
      return await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as any;
        if (!snap.exists || data.claimId !== claimId || data.status !== "processing") {
          logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_STALE_CLAIM_ON_FAIL", phase, ref: `${clinicId}:${eventKey}`, attempt: data?.attempts ?? null });
          return false;
        }
        const attemptsSoFar = data.attempts || 1;
        if (attemptsSoFar >= WA_WEBHOOK_MAX_ATTEMPTS) {
          tx.update(ref, {
            status: "dead_letter",
            deadLetteredAt: AdminFieldValue.serverTimestamp(),
            lastFailedAt: AdminFieldValue.serverTimestamp(),
            errorCode, errorClass, errorPhase: phase,
          });
          logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_MAX_ATTEMPTS_REACHED", phase, ref: `${clinicId}:${eventKey}`, err, attempt: attemptsSoFar });
        } else {
          tx.update(ref, {
            status: "failed",
            lastFailedAt: AdminFieldValue.serverTimestamp(),
            errorCode, errorClass, errorPhase: phase,
          });
          logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode, phase, ref: `${clinicId}:${eventKey}`, err, attempt: attemptsSoFar });
        }
        return true;
      });
    } catch (markErr) {
      logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_MARK_FAILED_TRANSACTION_FAILED", phase, ref: `${clinicId}:${eventKey}`, err: markErr });
      return false;
    }
  }

  // Bundles the real inbound-message effect (conversation upsert + message
  // doc create) and the completion marker into ONE Firestore transaction —
  // see the "gap 1" note in the block comment above. Also defensively
  // checks whether msgRef already exists before writing: if it does (e.g.
  // an earlier, already-superseded attempt somehow got far enough to write
  // it under a since-reclaimed old codepath), the effect is NOT repeated
  // (no second unreadCount increment, no overwritten message) — only the
  // completion marker is (re)confirmed. Throws WaWebhookStaleClaimError,
  // producing NO writes at all, if `claimId` no longer matches the
  // document's current claim.
  async function commitInboundPatientMessage(
    clinicId: string,
    eventKey: string,
    claimId: string,
    convoRef: FirebaseFirestore.DocumentReference,
    convoData: Record<string, any>,
    msgRef: FirebaseFirestore.DocumentReference,
    msgData: Record<string, any>,
  ): Promise<void> {
    const eventRef = webhookEventRef(clinicId, eventKey);
    await adminDb.runTransaction(async (tx) => {
      // All reads before any write, per Firestore transaction rules.
      const eventSnap = await tx.get(eventRef);
      const msgSnap = await tx.get(msgRef);
      const eventData = eventSnap.data() as any;
      if (!eventSnap.exists || eventData.claimId !== claimId || eventData.status !== "processing") {
        throw new WaWebhookStaleClaimError(`Claim superseded for clinic=${clinicId} eventKey=${eventRef.id}`);
      }
      if (!msgSnap.exists) {
        tx.set(convoRef, convoData, { merge: true });
        tx.set(msgRef, msgData);
      }
      tx.update(eventRef, {
        status: "completed",
        completedAt: AdminFieldValue.serverTimestamp(),
        errorCode: null,
        errorClass: null,
        errorPhase: null,
        lastFailedAt: null,
        expiresAt: new Date(Date.now() + WA_WEBHOOK_COMPLETED_RETENTION_MS),
      });
    });
  }

  // ---- Webhook inbound routing exclusively via whatsapp_phone_index (item 2) ----
  // Substitui a varredura de todas as clínicas que existia antes (O(n)
  // clínicas por evento, e em teoria ambígua se duas clínicas tivessem
  // phoneNumberId coincidente por erro de dado). Agora o índice é a ÚNICA
  // fonte de verdade pro roteamento — e, além de existir e estar 'active',
  // a integração ativa da clínica apontada precisa CONCORDAR com o índice
  // (mesma phoneNumberId, status 'conectado'). Qualquer inconsistência
  // aborta como "não roteável" — nunca cai de volta pra varrer todas as
  // clínicas, nunca encaminha pra uma clínica "provável"/"presumida".
  type ClinicResolution = { ok: true; clinicId: string; integration: any } | { ok: false; reason: string };
  async function resolveClinicForPhoneNumberId(phoneNumberId: string): Promise<ClinicResolution> {
    const indexSnap = await adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`).get();
    if (!indexSnap.exists) return { ok: false as const, reason: "phone_index_missing" };
    const indexData = indexSnap.data() as any;
    if (indexData.status !== "active") return { ok: false as const, reason: `phone_index_status_${indexData.status}` };
    const clinicId = indexData.clinicId;
    if (!clinicId || typeof clinicId !== "string") return { ok: false as const, reason: "phone_index_missing_clinic_id" };

    const integrationSnap = await adminDb.doc(`clinics/${clinicId}/integrations/whatsapp`).get();
    const integration = integrationSnap.exists ? integrationSnap.data() : null;
    const coherent = !!integration && integration.status === "conectado" && integration.phoneNumberId === phoneNumberId;
    if (!coherent) return { ok: false as const, reason: "phone_index_integration_mismatch" };

    return { ok: true as const, clinicId, integration };
  }

  // ---- Roteamento: falha recuperável (503) vs inconsistência persistente
  // em quarentena (rodada final de fechamento) ----
  // Antes desta rodada, TODA falha de roteamento virava 200 (ack) — certo
  // pra inconsistência de DADO (retry não resolveria), errado pra falha de
  // INFRAESTRUTURA (leitura do Firestore lançou, ou índice está 'pending'
  // — uma ativação em andamento que deve virar 'active' em segundos): um
  // ack nesses casos faz a Meta desistir de reentregar algo que uma
  // segunda tentativa, segundos depois, teria roteado com sucesso.
  //   - RECUPERÁVEL (503, sem quarentena): leitura do índice lançou
  //     exceção; índice em 'pending' (ativação genuinamente em andamento).
  //   - PERSISTENTE (200 ack + quarentena sanitizada): índice ausente, sem
  //     clinicId, ou incoerente com a integração da clínica apontada —
  //     nenhum desses se autocorrige com um reenvio; fica registrado (só
  //     phoneNumberId + motivo + contagem, nunca payload/mensagem) pra
  //     investigação humana em vez de silenciosamente desaparecer no log.
  const WA_ROUTING_RECOVERABLE_REASONS = new Set(["phone_index_status_pending", "phone_index_lookup_failed"]);

  // ---- Política de TTL/retenção (item 8, rodada final de fechamento) ----
  // Definida localmente aqui; a configuração REAL do TTL nativo do
  // Firestore (console/gcloud, por campo `expiresAt`) é um passo de infra
  // separado, ainda não executado (ver checklist final). Duas famílias,
  // políticas OPOSTAS de propósito:
  //
  //   TRANSIENTE (tem TTL, apaga sozinho) — `whatsapp_processed_events`
  //   (dedup, 7 dias, já implementado — WA_WEBHOOK_COMPLETED_RETENTION_MS
  //   acima) e `whatsapp_routing_quarantine` (inconsistência de roteamento,
  //   30 dias, implementado logo abaixo). Racional: inação aqui é de baixo
  //   risco — um evento de dedup expirado só significa "a Meta não vai
  //   reentregar isso de novo"; uma quarentena que não reaparece há 30 dias
  //   corrigiu-se sozinha ou nunca mais vai acontecer (o TTL da quarentena
  //   é medido a partir de `lastSeenAt`, não `firstSeenAt` — um problema
  //   genuinamente recorrente NUNCA expira, só um que parou de acontecer).
  //
  //   PERSISTENTE (SEM TTL, nunca apaga sozinho) — `whatsapp_orphaned_secret_versions`
  //   e `whatsapp_pending_waba_cleanup`. Deliberado, não esquecido: cada
  //   registro aqui representa um FATO DE SEGURANÇA ainda verdadeiro (uma
  //   versão de secret ainda válida no Secret Manager; uma assinatura de
  //   WABA ainda ativa do lado da Meta) até que o procedimento
  //   administrativo separado (nunca este runtime) confirme e grave
  //   `disabledAt`/`cleanedUpAt`. Apagar o REGISTRO não desfaz o fato real
  //   que ele descreve — só faria a equipe perder a visibilidade de uma
  //   credencial/assinatura órfã ainda viva, trocando um lembrete
  //   incômodo por um risco silencioso. TTL aqui seria uma regressão de
  //   segurança, não uma limpeza.
  function quarantineRefFor(phoneNumberId: string) {
    const hash = crypto.createHash("sha256").update(phoneNumberId).digest("hex").slice(0, 32);
    return adminDb.doc(`whatsapp_routing_quarantine/${hash}`);
  }
  const WA_ROUTING_QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  async function quarantineRoutingInconsistency(phoneNumberId: string, reason: string): Promise<void> {
    const ref = quarantineRefFor(phoneNumberId);
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const expiresAt = new Date(Date.now() + WA_ROUTING_QUARANTINE_RETENTION_MS);
        if (!snap.exists) {
          tx.set(ref, {
            phoneNumberId, reason,
            firstSeenAt: AdminFieldValue.serverTimestamp(),
            lastSeenAt: AdminFieldValue.serverTimestamp(),
            occurrences: 1,
            resolvedAt: null,
            expiresAt,
          });
        } else {
          tx.update(ref, { reason, lastSeenAt: AdminFieldValue.serverTimestamp(), occurrences: AdminFieldValue.increment(1), expiresAt });
        }
      });
    } catch (err) {
      logSanitizedWaError({ scope: "WA_WEBHOOK_META", errorCode: "WA_QUARANTINE_RECORD_FAILED", phase: "INBOUND_ROUTING", ref: phoneNumberId, err });
    }
  }
  type RoutingOutcome = { ok: true; clinicId: string; integration: any } | { ok: false; recoverable: boolean; reason: string };
  async function resolveClinicForInboundRouting(phoneNumberId: string): Promise<RoutingOutcome> {
    let resolution: ClinicResolution;
    try {
      resolution = await resolveClinicForPhoneNumberId(phoneNumberId);
    } catch (err) {
      logSanitizedWaError({ scope: "WA_WEBHOOK_META", errorCode: "WA_ROUTING_LOOKUP_THREW", phase: "INBOUND_ROUTING", ref: phoneNumberId, err });
      return { ok: false as const, recoverable: true, reason: "phone_index_lookup_failed" };
    }
    if (resolution.ok === false) {
      logSanitizedWaError({ scope: "WA_WEBHOOK_META", errorCode: `WA_ROUTING_${resolution.reason.toUpperCase()}`, phase: "INBOUND_ROUTING", ref: phoneNumberId });
      const recoverable = WA_ROUTING_RECOVERABLE_REASONS.has(resolution.reason);
      if (!recoverable) {
        await quarantineRoutingInconsistency(phoneNumberId, resolution.reason);
      }
      return { ok: false as const, recoverable, reason: resolution.reason };
    }
    return resolution;
  }

  // AI auto-reply for inbound WhatsApp messages — only ever called when the
  // clinic's integration has aiEnabled!==false AND humanApprovalRequired===
  // false (see WhatsAppSettings.tsx's "Modo Seguro" toggle, which already
  // wrote these two fields; this is the first place that actually reads
  // them). Deliberately narrower than the staff-facing /api/eliza/ask
  // system prompt: this one talks directly to a real patient over WhatsApp,
  // so it never sees anamnesis/clinical evolution notes (privacy — no
  // reason a text-message bot needs to be able to recite someone's medical
  // history), never proposes/executes an action, and refuses medical advice
  // outright rather than trying to sound helpful about it.
  async function generateWhatsAppAutoReply(params: {
    clinicId: string; clinicName: string; patientId: string | null; patientName: string;
    incomingText: string; recentHistory: { direction: string; text: string }[];
  }): Promise<string | null> {
    const { clinicId, clinicName, patientId, patientName, incomingText, recentHistory } = params;
    try {
      let matchedPatient: any = null;
      if (patientId) {
        const patient = await getPatientContext(adminDb, clinicId, patientId);
        matchedPatient = {
          name: patient.name,
          upcomingAppointmentsCount: patient.upcomingAppointments.length,
          upcomingAppointments: patient.upcomingAppointments.map((a) => ({ date: a.label, status: a.detail })),
          lastAppointment: patient.lastAppointment ? { date: patient.lastAppointment.label, detail: patient.lastAppointment.detail } : null,
          overdueFinancial: patient.overdueFinancial.count > 0 ? { count: patient.overdueFinancial.count, amount: patient.overdueFinancial.amount } : null,
        };
      }

      const modelInput = {
        clinicName,
        patientMessage: incomingText,
        matchedPatient,
        recentHistory: recentHistory.length > 0 ? recentHistory : undefined,
      };

      const systemPrompt = `Você é a Eliza, assistente virtual oficial da clínica "${clinicName}", respondendo automaticamente pelo WhatsApp oficial diretamente a pacientes reais.

REGRAS OBRIGATÓRIAS:
1. Tom acolhedor e direto, 1-3 frases curtas (é WhatsApp, não e-mail) — sem emojis em excesso, no máximo 1.
2. NUNCA dê conselho clínico, diagnóstico, orientação de dosagem/medicação ou qualquer conteúdo médico. Se a pergunta for clínica, diga que vai encaminhar para a equipe/profissional responder, e nada mais.
3. Use APENAS os dados fornecidos em "matchedPatient" para falar de agendamento ou financeiro específico deste paciente — nunca invente data, valor, horário ou status que não estejam ali.
4. Se "matchedPatient" for null, o número não foi identificado como paciente cadastrado — não finja saber quem é; peça nome completo pra localizar o cadastro, ou oriente a falar com a secretaria caso não consiga.
5. Nunca prometa marcar, remarcar ou cancelar uma consulta sozinha — apenas informe o que já está agendado (se houver) e diga que a equipe vai confirmar qualquer alteração.
6. Se não conseguir ajudar com segurança e clareza usando só os dados fornecidos, diga que vai encaminhar para a equipe humana responder — nunca invente uma resposta pra parecer útil.
7. "recentHistory", se presente, são as últimas mensagens reais desta conversa (mistura de mensagens do paciente e respostas já enviadas) — use só para manter continuidade, nunca como fonte de um fato novo.

DADOS REAIS DISPONÍVEIS:
${JSON.stringify(modelInput, null, 2)}

Responda ESTRITAMENTE em JSON válido, sem markdown, neste formato exato:
{"reply": "texto da resposta pronta para enviar ao paciente"}`;

      const aiResult = await generateElizaAIResponse({
        taskType: "whatsapp_auto_reply",
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        clinicId,
      });

      const rawText: string = aiResult?.text || "";
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      const reply = String(parsed.reply || "").trim();
      return reply || null;
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_AUTO_REPLY", errorCode: "WA_AUTO_REPLY_GENERATION_FAILED", phase: "AI_GENERATION", ref: patientName, err });
      return null;
    }
  }

  // POST Webhook Receiver
  async function whatsappWebhookPostHandler(req: any, res: any) {
    // Nunca loga headers completos aqui — X-Hub-Signature/
    // X-Hub-Signature-256 são valores derivados do App Secret, não
    // deveriam sair pro Cloud Logging mesmo sendo "só" uma assinatura.
    logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "post_received" });

    let body: any;
    if (Buffer.isBuffer(req.body)) {
      // Meta: this route's Content-Type branch captured the raw Buffer —
      // verify X-Hub-Signature-256 over the EXACT bytes before trusting
      // anything inside them, and only THEN parse JSON.
      const signatureHeader = req.headers["x-hub-signature-256"];
      const appSecret = process.env.META_APP_SECRET;
      if (!appSecret) {
        console.error("[WA_WEBHOOK_META] META_APP_SECRET not configured — rejecting.");
        return res.sendStatus(403);
      }
      if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
        console.error("[WA_WEBHOOK_META] Missing or malformed X-Hub-Signature-256 — rejecting.");
        return res.sendStatus(403);
      }
      const expectedHex = crypto.createHmac("sha256", appSecret).update(req.body).digest("hex");
      const providedHex = signatureHeader.slice("sha256=".length);
      let validSig = false;
      try {
        const expectedBuf = Buffer.from(expectedHex, "hex");
        const providedBuf = Buffer.from(providedHex, "hex");
        validSig = expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
      } catch {
        validSig = false;
      }
      if (!validSig) {
        console.error("[WA_WEBHOOK_META] Invalid signature — rejecting.");
        return res.sendStatus(403);
      }
      try {
        body = JSON.parse(req.body.toString("utf8"));
      } catch (parseErr) {
        logSanitizedWaError({ scope: "WA_WEBHOOK_META", errorCode: "WA_BODY_PARSE_FAILED", phase: "PARSE_BODY", ref: "meta_webhook_body", err: parseErr });
        return res.sendStatus(400);
      }
    } else {
      // Twilio: express.urlencoded() (applied by this route's own
      // Content-Type branch) already parsed this into an object — the
      // exact same shape twilio.validateRequest() below has always
      // expected, unchanged from before this route was registered earlier
      // in the file.
      body = req.body;
    }

    // Nunca loga o payload cru — pode conter telefone, texto de mensagem e
    // nome de contato. `object` aqui é só a string fixa que a Meta manda
    // ("whatsapp_business_account"), nunca dado do usuário.
    logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "body_parsed", extra: { object: typeof body?.object === "string" ? body.object : null } });

    // Twilio posts form-encoded (no `object` field, always has MessageSid —
    // both for inbound messages and for delivery-status callbacks). Meta
    // always sends `{object: "whatsapp_business_account", ...}` JSON, so
    // this check cleanly tells the two providers apart on the same route.
    if (!body.object && (body.MessageSid || body.SmsMessageSid)) {
      try {
        const twilioToDigits = String(body.To || "").replace(/\D/g, "");

        const clinicsSnap = await adminDb.collection("clinics").get();
        let matchedClinicId: string | null = null;
        let matchedIntegration: any = null;
        for (const clinicDoc of clinicsSnap.docs) {
          const integrationSnap = await adminDb.doc(`clinics/${clinicDoc.id}/integrations/whatsapp`).get();
          if (!integrationSnap.exists) continue;
          const data = integrationSnap.data() || {};
          if (data.provider !== "twilio") continue;
          const configuredDigits = String(data.twilioWhatsAppNumber || "").replace(/\D/g, "");
          if (configuredDigits && configuredDigits === twilioToDigits) {
            matchedClinicId = clinicDoc.id;
            matchedIntegration = data;
            break;
          }
        }

        if (!matchedClinicId || !matchedIntegration) {
          logSanitizedWaInfo({ scope: "WA_WEBHOOK_TWILIO", event: "no_clinic_matched" });
          return res.sendStatus(200);
        }

        // Real signature verification (Meta's webhook below has none — see
        // the plan notes; Twilio's is built fresh here using the official
        // SDK's validator, now that we know which clinic's auth token to
        // check the signature against).
        const twilioSignature = req.headers["x-twilio-signature"] as string | undefined;
        const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
        const fullUrl = `${protocol}://${req.get("host")}${req.originalUrl}`;
        const validSignature = !!twilioSignature && twilio.validateRequest(matchedIntegration.twilioAuthToken || "", twilioSignature, fullUrl, body);
        if (!validSignature) {
          console.error("[WA_WEBHOOK_TWILIO] Invalid or missing signature, rejecting.", { fullUrl });
          return res.sendStatus(403);
        }

        const messageSid = body.MessageSid || body.SmsMessageSid;

        if (body.MessageStatus) {
          // Delivery-status callback — map Twilio's vocabulary onto the
          // same status values the Meta status handler already writes.
          const statusMap: Record<string, string> = {
            queued: "sent", sent: "sent", delivered: "delivered", read: "read", failed: "failed", undelivered: "failed"
          };
          const mappedStatus = statusMap[String(body.MessageStatus).toLowerCase()] || String(body.MessageStatus);
          try {
            const msgsQuery = await adminDb.collectionGroup("messages").where("whatsappMessageId", "==", messageSid).limit(5).get();
            for (const msgDoc of msgsQuery.docs) {
              if (msgDoc.ref.path.startsWith(`clinics/${matchedClinicId}/`)) {
                await msgDoc.ref.update({ status: mappedStatus, statusUpdatedAt: AdminFieldValue.serverTimestamp() });
              }
            }
          } catch (statusErr) {
            logSanitizedWaError({ scope: "WA_WEBHOOK_TWILIO", errorCode: "WA_TWILIO_STATUS_UPDATE_FAILED", phase: "STATUS_PROCESSING", ref: `${matchedClinicId}:${messageSid}`, err: statusErr });
          }
          return res.sendStatus(200);
        }

        // Inbound message — same conversation/message shape the Meta
        // handler already writes, so ChatInterface.tsx needs no changes.
        const fromPhone = String(body.From || "").replace(/^whatsapp:/i, "").replace(/\D/g, "");
        const textMsg = body.Body || "";
        const profileName = body.ProfileName || fromPhone;

        const patientsSnap = await adminDb.collection(`clinics/${matchedClinicId}/patients`).get();
        const matchedPatientDoc = patientsSnap.docs.find(d => {
          const pData = d.data() || {};
          const potentialPhones: string[] = [];
          ["phone", "telefone", "cellphone", "celular", "whatsapp", "mobile", "phoneNormalized"].forEach(field => {
            const val = pData[field];
            if (typeof val === "string" && val) potentialPhones.push(val.replace(/\D/g, ""));
          });
          if (Array.isArray(pData.phones)) {
            pData.phones.forEach((val: any) => { if (typeof val === "string" && val) potentialPhones.push(val.replace(/\D/g, "")); });
          }
          return potentialPhones.some(pPhone => phonesRoughlyMatch(fromPhone, pPhone));
        });

        let patientId = "";
        let patientName = profileName;
        let phoneNormalized = "";
        if (matchedPatientDoc) {
          patientId = matchedPatientDoc.id;
          patientName = matchedPatientDoc.data().name || patientName;
          phoneNormalized = (matchedPatientDoc.data().phoneNormalized || matchedPatientDoc.data().phone || "").replace(/\D/g, "");
        }

        const conversationId = fromPhone;
        await adminDb.doc(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}`).set({
          patientId: patientId || "",
          patientName,
          patientPhone: fromPhone,
          status: "aguardando",
          lastMessage: textMsg,
          lastMessageAt: AdminFieldValue.serverTimestamp(),
          unreadCount: AdminFieldValue.increment(1),
          assignedTo: "ai",
          aiEnabled: matchedIntegration.aiEnabled !== false,
          source: "whatsapp",
          updatedAt: AdminFieldValue.serverTimestamp()
        }, { merge: true });

        const msgRef = adminDb.doc(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}/messages/${messageSid}`);
        await msgRef.set({
          direction: "inbound",
          text: textMsg,
          timestamp: AdminFieldValue.serverTimestamp(),
          createdAt: AdminFieldValue.serverTimestamp(),
          from: fromPhone,
          to: twilioToDigits,
          phoneNormalized: phoneNormalized || fromPhone,
          whatsappMessageId: messageSid,
          profileName,
          status: "received",
          aiGenerated: false,
          sentBy: "whatsapp",
          source: "whatsapp_webhook_twilio"
        });

        await adminDb.collection(`clinics/${matchedClinicId}/integration_logs`).add({
          type: "whatsapp",
          action: "webhook_received",
          status: "success",
          message: `Mensagem recebida via Twilio de ${patientName} (${fromPhone}): "${textMsg.substring(0, 40)}${textMsg.length > 40 ? "..." : ""}"`,
          createdAt: AdminFieldValue.serverTimestamp()
        });

        logSanitizedWaInfo({ scope: "WA_WEBHOOK_TWILIO", event: "inbound_message_saved", clinicId: matchedClinicId, ref: messageSid });

        // AI auto-reply — gated by the clinic's own toggles (WhatsAppSettings.tsx):
        // aiEnabled must be on AND humanApprovalRequired must be explicitly off.
        // Any other combination (including the field never having been set,
        // which defaults humanApprovalRequired to "safe mode" client-side)
        // leaves today's behavior unchanged — inbound saved, no auto-send.
        if (matchedIntegration.aiEnabled !== false && matchedIntegration.humanApprovalRequired === false) {
          try {
            const clinicSnap = await adminDb.doc(`clinics/${matchedClinicId}`).get();
            const clinicName = clinicSnap.data()?.name || "a clínica";

            const historySnap = await adminDb
              .collection(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}/messages`)
              .orderBy("timestamp", "desc")
              .limit(6)
              .get();
            const recentHistory = historySnap.docs
              .map((d) => ({ direction: d.data().direction, text: String(d.data().text || "").slice(0, 300) }))
              .reverse();

            const replyText = await generateWhatsAppAutoReply({
              clinicId: matchedClinicId, clinicName, patientId: patientId || null, patientName,
              incomingText: textMsg, recentHistory,
            });

            if (replyText) {
              await dispatchAndRecordOutboundWhatsAppMessage({
                clinicId: matchedClinicId, conversationId, text: replyText,
                sentBy: "ai", aiGenerated: true, source: "ai_auto_reply",
              });
            }
          } catch (autoReplyErr: any) {
            logSanitizedWaError({ scope: "WA_AUTO_REPLY", errorCode: "WA_AUTO_REPLY_DISPATCH_FAILED", phase: "AUTO_REPLY", ref: messageSid, err: autoReplyErr });
          }
        }

        return res.sendStatus(200);
      } catch (twilioWebhookErr: any) {
        // matchedClinicId is block-scoped to the try above, not visible
        // here — "twilio_webhook" is a fixed, non-identifying ref label.
        logSanitizedWaError({ scope: "WA_WEBHOOK_TWILIO", errorCode: "WA_TWILIO_WEBHOOK_FAILED", phase: "TWILIO_PROCESSING", ref: "twilio_webhook", err: twilioWebhookErr });
        // Twilio retries aggressively on non-2xx; ack anyway, the error is logged above.
        return res.sendStatus(200);
      }
    }

    if (body.object) {
      // 3. Confirm webhook signature messages
      const entry0 = body.entry?.[0];
      const change0 = entry0?.changes?.[0];
      const triggeredField = change0?.field;
      if (triggeredField !== "messages") {
        console.log("Webhook não está recebendo porque o campo messages não está assinado na Meta.");
      }

      // Set when any individual event's processing genuinely fails below —
      // drives the final response status (see the end of this try block):
      // a partial failure must never come back as a plain 200, or the
      // provider has no reason to redeliver the events that failed.
      let anyEventFailed = false;

      try {
        if (
          body.entry &&
          body.entry[0].changes &&
          body.entry[0].changes[0] &&
          body.entry[0].changes[0].value.messages
        ) {
          const changeValue = body.entry[0].changes[0].value;
          const metadata = changeValue.metadata;
          const phoneNumberId = metadata.phone_number_id;

          // Item 2 — roteamento exclusivamente pelo índice global, nunca
          // mais varrendo todas as clínicas. Nunca cai pra uma busca
          // ampla, nunca encaminha pra uma clínica presumida — falha
          // recuperável (leitura falhou, índice 'pending') vira 503 pra
          // provocar reentrega real do provedor; inconsistência
          // persistente vai pra quarentena sanitizada + 200 ack (ver
          // resolveClinicForInboundRouting acima).
          const routing = await resolveClinicForInboundRouting(phoneNumberId);
          if (routing.ok === false) {
            return routing.recoverable ? res.status(503).json({ error: routing.reason }) : res.sendStatus(200);
          }
          const matchedClinicId = routing.clinicId;
          const matchedIntegration = routing.integration;

          const messages = changeValue.messages;
          const contacts = changeValue.contacts || [];
          const contactProfile = contacts[0] || {};
          const profileName = contactProfile.profile?.name || "Paciente WhatsApp";

          for (const msg of messages) {
            const fromPhone = msg.from;
            const messageId = msg.id;
            const { claimed: msgClaimed, claimId: msgClaimId } = await claimWhatsAppWebhookEvent(matchedClinicId, messageId);
            if (!msgClaimed || !msgClaimId) continue;
            try {
            // Test-only fault injection for the dedup state machine
            // (scripts/verifyWhatsAppWebhookDedup.mjs) — provides a real,
            // deterministic way to exercise the genuine failure→retry path,
            // and the "old claim resumes after being reclaimed" fencing
            // path, through actual production code, not a synthetic
            // Firestore write. All three sentinels are inert unless BOTH
            // the exact text AND an env var never set by any real deploy
            // are present — cannot fire from a real Meta payload by
            // accident.
            if (process.env.WA_WEBHOOK_ALLOW_TEST_FAULT === "1" && msg.type === "text") {
              if (msg.text?.body === "__WA_TEST_FORCE_FAILURE__") {
                throw new Error("Injected test failure (WA_WEBHOOK_ALLOW_TEST_FAULT)");
              }
              if (msg.text?.body === "__WA_TEST_SLOW_WORKER__") {
                await new Promise((r) => setTimeout(r, 3000));
              }
              if (msg.text?.body === "__WA_TEST_SLOW_THEN_FAIL__") {
                await new Promise((r) => setTimeout(r, 3000));
                throw new Error("Injected slow-then-fail test failure (WA_WEBHOOK_ALLOW_TEST_FAULT)");
              }
            }
            let textMsg = "";

            if (msg.type === "text" && msg.text) {
              textMsg = msg.text.body;
            } else {
              textMsg = `[Mensagem tipo: ${msg.type}]`;
            }

            // Nunca loga from/profile.name/text.body/message.id — telefone,
            // nome de contato, texto da mensagem e ID externo, exatamente
            // o que não pode aparecer em log de infraestrutura.
            logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "inbound_message_matched", clinicId: matchedClinicId, extra: { messageType: msg.type } });

            // Check ELIZA Interna Professional Access
            const cleanSenderPhone = fromPhone.replace(/\D/g, "");
            const staffAccessSnap = await adminDb.collection(`clinics/${matchedClinicId}/staff_whatsapp_access`).get();
            
            let matchedStaffDoc: any = null;
            let staffData: any = null;
            
            for (const doc of staffAccessSnap.docs) {
              const data = doc.data();
              const dbPhoneNorm = (data.phoneNormalized || data.phone || "").replace(/\D/g, "");
              if (dbPhoneNorm && (cleanSenderPhone === dbPhoneNorm || cleanSenderPhone.endsWith(dbPhoneNorm) || dbPhoneNorm.endsWith(cleanSenderPhone))) {
                if (data.active === true) {
                  matchedStaffDoc = doc;
                  staffData = data;
                  break;
                }
              }
            }

            if (matchedStaffDoc && staffData) {
              // Nunca loga telefone nem nome do funcionário — staffId
              // (doc id interno) é a única referência, sem hash nem
              // valor cru de contato.
              logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "eliza_interna_sender_identified", clinicId: matchedClinicId, extra: { staffId: matchedStaffDoc.id } });

              const intent = await interpretCommand(textMsg);
              logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "eliza_interna_intent_interpreted", clinicId: matchedClinicId, extra: { intent } });
              
              let responseText = "";
              let isAuthorized = true;
              
              // Validate permissions (Part 6)
              const clinicalIntents = ["GET_TODAY_AGENDA", "GET_TOMORROW_AGENDA", "GET_TOMORROW_SURGERIES", "GET_WEEK_PLAN", "GET_AVAILABLE_SLOTS", "GET_WEEK_AVAILABLE_SLOTS"];
              const isPureFinance = String(staffData.role || "").toLowerCase() === "financial" || String(staffData.role || "").toLowerCase() === "financeiro";
              const isPureMarketing = String(staffData.role || "").toLowerCase() === "marketing";
              const canAccessClinical = staffData.role === "Dono" || staffData.role === "Gerente" || staffData.permissions?.includes("visualizar_agenda") || staffData.permissions?.includes("agenda") || (!isPureFinance && !isPureMarketing);

              const needsFinancePriv = ["GET_DAILY_REVENUE", "GET_MONTHLY_REVENUE", "GET_TODAY_EXPENSES"].includes(intent);
              const hasFinancePerm = staffData.permissions && (staffData.permissions.includes("visualizar_financeiro") || staffData.permissions.includes("financeiro") || staffData.permissions.includes("financial"));
              const canAccessFinance = staffData.role === "Dono" || staffData.role === "Gerente" || String(staffData.role || "").toLowerCase() === "financeiro" || String(staffData.role || "").toLowerCase() === "financial" || hasFinancePerm;

              if (clinicalIntents.includes(intent) && !canAccessClinical) {
                isAuthorized = false;
                responseText = `Dr(a). ${staffData.name}.\nComo sua função é focada em ${staffData.role || 'Financeiro'}, você não possui permissões clínicas para extrair detalhes de agendas ou tratamentos sensíveis dos pacientes via WhatsApp.`;
              } else if (needsFinancePriv && !canAccessFinance) {
                isAuthorized = false;
                responseText = `Olá, ${staffData.name}.\nDesculpe, você não possui as permissões do setor financeiro necessárias para acessar faturamentos ou despesas de hoje. Caso ache que isto é um erro, solicite autorização no painel administrativo.`;
              } else {
                // Determine limits by professionalId
                const filterByProfessional = (staffData.role !== 'Dono' && staffData.role !== 'Gerente' && staffData.professionalId && staffData.professionalId !== 'not-assigned');
                const sampa = getSampaDate();
                const todayStr = sampa.toISOString().split("T")[0];
                const sampaTomorrow = new Date(sampa.getTime() + 24 * 60000 * 60);
                const tomorrowStr = sampaTomorrow.toISOString().split("T")[0];
                const currentMonthPrefix = todayStr.substring(0, 7);
                const standardHours = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

                if (intent === "GET_TODAY_AGENDA" || intent === "GET_TOMORROW_AGENDA") {
                  const targetDate = intent === "GET_TOMORROW_AGENDA" ? tomorrowStr : todayStr;
                  const appointmentsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                    .where("date", "==", targetDate)
                    .get();
                  let appointments = appointmentsSnap.docs.map(doc => doc.data());
                  if (filterByProfessional) {
                    appointments = appointments.filter((apt: any) => apt.staffId === staffData.professionalId);
                  }
                  appointments.sort((a: any, b: any) => (a.time || "").localeCompare(b.time || ""));

                  if (appointments.length === 0) {
                     responseText = `Olá, ${staffData.name}. Você não possui compromissos agendados para ${intent === "GET_TOMORROW_AGENDA" ? "amanhã" : "hoje"} (${targetDate}).`;
                  } else {
                     responseText = `Olá, ${staffData.name}. Aqui está sua agenda para ${intent === "GET_TOMORROW_AGENDA" ? "amanhã" : "hoje"} (${targetDate}):\n\n`;
                     appointments.forEach((apt: any, idx: number) => {
                       const statusSymbol = apt.status === 'confirmado' ? '✅' : apt.status === 'finalizado' ? '⭐' : '⏳';
                       responseText += `${idx + 1}. *${apt.time}* - ${apt.patientName} (${apt.procedure || 'Consulta'})\n`;
                       responseText += `   Status: ${statusSymbol} ${apt.status}\n`;
                       if (apt.chair) responseText += `   Cadeira: ${apt.chair}\n`;
                       if (apt.observations) responseText += `   Obs: ${apt.observations}\n`;
                       responseText += `\n`;
                     });
                     responseText += `Total de ${appointments.length} atendimentos. Tenha um excelente dia!`;
                  }
                } 
                else if (intent === "GET_DAILY_REVENUE") {
                  const transactionsSnap = await adminDb.collection(`clinics/${matchedClinicId}/transactions`).get();
                  const dailyTransactions = transactionsSnap.docs.map(doc => doc.data()).filter((t: any) => {
                    return t.type === 'income' && String(t.date || "").startsWith(todayStr);
                  });
                  const totalDaily = dailyTransactions.reduce((acc: number, t: any) => acc + (t.amount || t.value || 0), 0);
                  responseText = `Olá, ${staffData.name}.\nFaturamento total de hoje (${todayStr}) lançado no sistema é de *R$ ${totalDaily.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* (total de ${dailyTransactions.length} recebimentos).`;
                } 
                else if (intent === "GET_MONTHLY_REVENUE") {
                  const transactionsSnap = await adminDb.collection(`clinics/${matchedClinicId}/transactions`).get();
                  const monthlyTransactions = transactionsSnap.docs.map(doc => doc.data()).filter((t: any) => {
                    return t.type === 'income' && String(t.date || "").startsWith(currentMonthPrefix);
                  });
                  const totalMonthly = monthlyTransactions.reduce((acc: number, t: any) => acc + (t.amount || t.value || 0), 0);
                  responseText = `Olá, ${staffData.name}.\nO faturamento acumulado deste mês (${currentMonthPrefix}) faturado no sistema é de *R$ ${totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* (total de ${monthlyTransactions.length} lançamentos).`;
                }
                else if (intent === "GET_TODAY_EXPENSES") {
                  const transactionsSnap = await adminDb.collection(`clinics/${matchedClinicId}/transactions`).get();
                  const dailyExpenses = transactionsSnap.docs.map(doc => doc.data()).filter((t: any) => {
                    return t.type === 'expense' && String(t.date || "").startsWith(todayStr);
                  });
                  const totalExpenses = dailyExpenses.reduce((acc: number, t: any) => acc + (t.amount || t.value || 0), 0);
                  if (dailyExpenses.length === 0) {
                    responseText = `Olá, ${staffData.name}. Não há despesas/saídas lançadas em seu financeiro para hoje (${todayStr}).`;
                  } else {
                    responseText = `Olá, ${staffData.name}. Aqui estão as despesas hoje (${todayStr}):\n\n`;
                    dailyExpenses.forEach((exp: any, idx: number) => {
                      responseText += `${idx + 1}. *R$ ${(exp.amount || exp.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}* - ${exp.description || 'Gasto sem descrição'} (${exp.category || 'Geral'})\n`;
                    });
                    responseText += `\nTotal de saídas hoje: *R$ ${totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}* (${dailyExpenses.length} despesas).`;
                  }
                }
                else if (intent === "GET_AVAILABLE_SLOTS" || intent === "GET_WEEK_AVAILABLE_SLOTS") {
                  if (intent === "GET_AVAILABLE_SLOTS") {
                    const appointmentsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                      .where("date", "==", todayStr)
                      .get();
                    let appointments = appointmentsSnap.docs.map(doc => doc.data());
                    if (filterByProfessional) {
                      appointments = appointments.filter((apt: any) => apt.staffId === staffData.professionalId);
                    }
                    const occupied = appointments.map((apt: any) => (apt.time || "").substring(0, 5));
                    const freeSlots = standardHours.filter(h => !occupied.includes(h));

                    if (freeSlots.length === 0) {
                      responseText = `Olá, ${staffData.name}, sua agenda está 100% cheia para hoje (${todayStr})! Nenhum horário vago.`;
                    } else {
                      responseText = `Olá, ${staffData.name}, aqui estão seus horários vagos hoje (${todayStr}):\n\n` +
                        freeSlots.map(slot => `  • *${slot}*`).join("\n") +
                        `\n\nDisponibilidade de ${freeSlots.length} horários.`;
                    }
                  } else {
                    const daysToCheck: string[] = [];
                    let temp = new Date(sampa);
                    while (daysToCheck.length < 3) {
                      const dayOfWeek = temp.getDay();
                      if (dayOfWeek !== 0) {
                        daysToCheck.push(temp.toISOString().split("T")[0]);
                      }
                      temp = new Date(temp.getTime() + 24 * 60000 * 60);
                    }

                    responseText = `Olá, ${staffData.name}, aqui estão seus horários vagos para os próximos dias:\n\n`;
                    for (const day of daysToCheck) {
                      const apptsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                        .where("date", "==", day)
                        .get();
                      let dayApts = apptsSnap.docs.map(doc => doc.data());
                      if (filterByProfessional) {
                        dayApts = dayApts.filter((apt: any) => apt.staffId === staffData.professionalId);
                      }
                      const dayOccupied = dayApts.map((apt: any) => (apt.time || "").substring(0, 5));
                      const dayFree = standardHours.filter(h => !dayOccupied.includes(h));

                      responseText += `📅 *${day}* (${getWeekdayName(day)}):\n`;
                      if (dayFree.length === 0) {
                        responseText += `   _Nenhuma vaga_\n`;
                      } else {
                        responseText += `   Vagas: ${dayFree.slice(0, 4).join(", ")}${dayFree.length > 4 ? "..." : ""} (${dayFree.length} livres)\n`;
                      }
                      responseText += `\n`;
                    }
                  }
                } 
                else if (intent === "GET_TODAY_PATIENTS") {
                  const appointmentsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                    .where("date", "==", todayStr)
                    .get();
                  let appointments = appointmentsSnap.docs.map(doc => doc.data());
                  if (filterByProfessional) {
                    appointments = appointments.filter((apt: any) => apt.staffId === staffData.professionalId);
                  }
                  const patientsList = appointments.map((apt: any) => apt.patientName).filter((val, index, self) => self.indexOf(val) === index);
                  
                  if (patientsList.length === 0) {
                     responseText = `Olá, ${staffData.name}. Nenhum paciente agendado para hoje (${todayStr}).`;
                  } else {
                    responseText = `Olá, ${staffData.name}. Aqui estão seus pacientes agendados para hoje (${todayStr}):\n\n` +
                      patientsList.map((p, idx) => `${idx + 1}. *${p}*`).join("\n") +
                      `\n\nTotal de ${patientsList.length} pacientes hoje.`;
                  }
                } 
                else if (intent === "GET_WEEK_PLAN") {
                  const currentDay = sampa.getDay();
                  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
                  const monday = new Date(sampa.getTime() + mondayOffset * 24 * 60 * 60000);

                  const weekDays = [];
                  for (let i = 0; i < 5; i++) {
                    const d = new Date(monday.getTime() + i * 24 * 60 * 60000);
                    weekDays.push(d.toISOString().split("T")[0]);
                  }

                  responseText = `📋 *Planejamento Semanal* de Atendimentos (${weekDays[0]} a ${weekDays[4]}):\n\n`;
                  let totalWeekApts = 0;

                  for (const day of weekDays) {
                    const apptsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                      .where("date", "==", day)
                      .get();
                    let dayApts = apptsSnap.docs.map(doc => doc.data());
                    if (filterByProfessional) {
                      dayApts = dayApts.filter((apt: any) => apt.staffId === staffData.professionalId);
                    }

                    responseText += `📅 *${day}* (${getWeekdayName(day)}):\n`;
                    if (dayApts.length === 0) {
                      responseText += `   _Nenhum atendimento_\n`;
                    } else {
                      dayApts.sort((a: any, b: any) => (a.time || "").localeCompare(b.time || ""));
                      dayApts.forEach((apt: any) => {
                        responseText += `   - *${apt.time}* - ${apt.patientName} (${apt.procedure || 'Consulta'})\n`;
                      });
                      totalWeekApts += dayApts.length;
                    }
                    responseText += `\n`;
                  }
                  responseText += `Total acumulado de ${totalWeekApts} atendimentos planejados.`;
                } 
                else if (intent === "GET_PENDING_TASKS") {
                  const tasksSnap = await adminDb.collection(`clinics/${matchedClinicId}/pending_items`)
                    .where("status", "==", "pending")
                    .get();
                  let tasks = tasksSnap.docs.map(doc => doc.data());
                  tasks.sort((a: any, b: any) => {
                    const pA = a.priority === "Alta" ? 3 : a.priority === "Média" ? 2 : 1;
                    const pB = b.priority === "Alta" ? 3 : b.priority === "Média" ? 2 : 1;
                    return pB - pA;
                  });

                  const topTasks = tasks.slice(0, 6);
                  if (topTasks.length === 0) {
                    responseText = `Olá, ${staffData.name}. Não há tarefas pendentes listadas hoje!`;
                  } else {
                    responseText = `Olá, ${staffData.name}. Aqui estão as pendências atuais do sistema:\n\n`;
                    topTasks.forEach((t: any, idx: number) => {
                      const priorityIcon = t.priority === "Alta" ? "🚨" : "⚠️";
                      responseText += `${idx + 1}. [${priorityIcon} ${t.priority}] *${t.title}*\n`;
                      if (t.description) responseText += `   _${t.description}_\n`;
                    });
                    responseText += `\nTotalizando ${tasks.length} itens pendentes.`;
                  }
                }
                else if (intent === "GET_UNCONFIRMED_APPOINTMENTS") {
                  const appointmentsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                    .where("date", "==", todayStr)
                    .get();
                  let appointments = appointmentsSnap.docs.map(doc => doc.data());
                  if (filterByProfessional) {
                    appointments = appointments.filter((apt: any) => apt.staffId === staffData.professionalId);
                  }
                  const unconfirmed = appointments.filter((apt: any) => apt.status !== "confirmado" && apt.status !== "finalizado");
                  if (unconfirmed.length === 0) {
                    responseText = `Olá, ${staffData.name}. Todos os pacientes agendados para hoje (${todayStr}) já estão confirmados no sistema! 🎉`;
                  } else {
                    responseText = `Olá, ${staffData.name}. Aqui estão as consultas não confirmadas hoje (${todayStr}):\n\n`;
                    unconfirmed.forEach((apt: any, idx: number) => {
                      responseText += `⏳ ${idx + 1}. *${apt.time}* - ${apt.patientName} (${apt.procedure || 'Consulta'})\n`;
                    });
                    responseText += `\nIdentificamos ${unconfirmed.length} agendamentos aguardando confirmação.`;
                  }
                }
                else if (intent === "GET_OVERDUE_RECALLS") {
                  const patientsSnap = await adminDb.collection(`clinics/${matchedClinicId}/patients`).get();
                  const nowMs = sampa.getTime();
                  let recallCount = 0;
                  const list: string[] = [];

                  patientsSnap.docs.forEach(doc => {
                    const data = doc.data();
                    const recall = data.recallDate || data.hofRecallDate;
                    if (recall) {
                      const recDate = new Date(recall);
                      if (recDate.getTime() <= nowMs) {
                        recallCount++;
                        list.push(`${data.name || 'Paciente'} (Venceu em: ${recall})`);
                      }
                    }
                  });

                  if (recallCount === 0) {
                    responseText = `Olá, ${staffData.name}. Não há alertas de retornos/recalls HOF vencidos ou atrasados no radar hoje.`;
                  } else {
                    responseText = `Olá, ${staffData.name}. Temos ${recallCount} pacientes pendentes de recall HOF hoje:\n\n`;
                    list.slice(0, 5).forEach((p, idx) => {
                      responseText += `📍 ${idx + 1}. *${p}*\n`;
                    });
                    if (recallCount > 5) responseText += `\n...e mais ${recallCount - 5} pacientes para acompanhamento.`;
                  }
                }
                else if (intent === "GET_TOMORROW_SURGERIES") {
                  const apptsSnap = await adminDb.collection(`clinics/${matchedClinicId}/appointments`)
                    .where("date", "==", tomorrowStr)
                    .get();
                  const surgeryTerms = ["cirurgia", "implante", "siso", "extração", "cirúrgico", "surgery"];
                  let tomorrowSurgeries = apptsSnap.docs.map(doc => doc.data()).filter((apt: any) => {
                    const proc = String(apt.procedure || "").toLowerCase();
                    return surgeryTerms.some(term => proc.includes(term));
                  });
                  if (filterByProfessional) {
                    tomorrowSurgeries = tomorrowSurgeries.filter((apt: any) => apt.staffId === staffData.professionalId);
                  }

                  if (tomorrowSurgeries.length === 0) {
                    responseText = `Olá, ${staffData.name}. Não há cirurgias planejadas na agenda de amanhã (${tomorrowStr}).`;
                  } else {
                    responseText = `Olá, ${staffData.name}. 🚨 Temos ${tomorrowSurgeries.length} cirurgias agendadas para amanhã (${tomorrowStr}):\n\n`;
                    tomorrowSurgeries.forEach((apt: any, idx: number) => {
                      responseText += `🦷 ${idx + 1}. *${apt.time}* - ${apt.patientName}\n   Procedimento: _${apt.procedure || 'Cirurgia'}_ (Prof. Resp: ${apt.staffName || 'Doutor'})\n\n`;
                    });
                    responseText += `Verifique se o preparo cirúrgico, checklist pré-operatório e materiais estão organizados!`;
                  }
                }
                else if (intent === "GET_DAILY_SUMMARY") {
                  const summaryText = await generatePersonalizedSummary(matchedClinicId, staffData, sampa);
                  responseText = summaryText;
                }
                else {
                  responseText = `Olá, Dr/a. ${staffData.name}.\nComo sua assistente virtual ELIZA interna, posso pesquisar diversas estatísticas em seu WhatsApp. Experimente enviar um dos seguintes termos:\n\n` +
                    `📅 *agenda hoje* - Lista de consultas hoje\n` +
                    `📆 *agenda amanhã* - Lista de consultas amanhã\n` +
                    `🆓 *horários livres* - Seus horários livres hoje\n` +
                    `👥 *quem não confirmou* - Faltando confirmação hoje\n` +
                    `🦷 *cirurgias de amanhã* - Procedimentos cirúrgicos de amanhã\n` +
                    `📋 *pendências* - Checklist de tarefas pendentes\n` +
                    `📍 *pacientes para recall* - Pacientes atrasados em recall HOF\n` +
                    `📈 *faturamento hoje* - Receita lançada hoje (requer permissão)\n` +
                    `📊 *faturamento do mês* - Faturamento mensal acumulado (requer permissão)\n` +
                    `💸 *contas de hoje* - Despesas/Saídas lançadas hoje (requer permissão)\n` +
                    `🌟 *resumo do dia* - Resumo operacional multifuncional`;
                }
              }

              // Apply Gemini Polish
              let polishedText = responseText;
              if (intent !== "UNKNOWN" && isAuthorized) {
                const apiKey = process.env.GEMINI_API_KEY;
                if (apiKey && !apiKey.startsWith("••••") && apiKey !== "test_token" && apiKey.length >= 15) {
                  try {
                    const ai = new GoogleGenAI({
                      apiKey: apiKey,
                      httpOptions: {
                        headers: {
                          'User-Agent': 'aistudio-build',
                        }
                      }
                    });
                    const response = await ai.models.generateContent({
                      model: "gemini-3.5-flash",
                      contents: `Você é ELIZA, a assistente oficial de WhatsApp interna para os profissionais da clínica. Reescreva a seguinte mensagem estruturada para que soe muito cordial, profissional, calorosa, estilosa e polida, perfeitamente adequada para WhatsApp. Use markdown (como *negrito*, _itálico_) e emojis apropriadamente.
                      IMPORTANTE: Não mude nem exclua nenhum dos nomes, horários, quantidades, valores ou prazos presentes na mensagem.
                      
Mensagem original:
${responseText}

Versão polida por ELIZA:`,
                    });
                    if (response.text) {
                      polishedText = response.text.trim();
                    }
                  } catch (err) {
                    console.warn("[ELIZA_INTERNA] FAILED polishing response with Gemini, sending fallback:", err);
                  }
                }
              }

              // Send Response
              const dispatchResult = await dispatchWhatsAppMessage(matchedClinicId, fromPhone, polishedText);
              const success = dispatchResult.success;
              
              // Write command log
              const logCmdId = "cmd_" + Date.now().toString() + Math.random().toString(36).substring(2, 5);
              await adminDb.collection(`clinics/${matchedClinicId}/staff_commands`).doc(logCmdId).set({
                fromPhone,
                staffId: matchedStaffDoc.id,
                professionalId: staffData.professionalId || "not-assigned",
                rawMessage: textMsg,
                intent: intent,
                status: !isAuthorized ? "unauthorized" : success ? "success" : "error",
                response: polishedText,
                errorCode: dispatchResult.errorCode || null,
                errorMessage: dispatchResult.errorMessage || null,
                metaResponse: null, // corpo cru da Graph nunca é repassado — ver sendViaMeta/whatsappGraphClient.ts.
                whatsappMessageId: dispatchResult.whatsappMessageId || null,
                createdAt: AdminFieldValue.serverTimestamp()
              });

              // Intercept and skip to next incoming webhook message.
              // Not transactional with the dispatch above (that was a real
              // outbound WhatsApp send over HTTP, already irreversible by
              // this point) — see markWhatsAppWebhookEventCompleted's own
              // doc comment for why fencing here can only protect the
              // bookkeeping, not undo/prevent that external effect.
              await markWhatsAppWebhookEventCompleted(matchedClinicId, messageId, msgClaimId);
              continue;
            }

            // Are phones matching helper
            const arePhonesMatching = (phoneA: string, phoneB: string): boolean => {
              const cleanA = phoneA.replace(/\D/g, "");
              const cleanB = phoneB.replace(/\D/g, "");
              if (!cleanA || !cleanB) return false;
              if (cleanA === cleanB) return true;
              
              const normA = cleanA.startsWith("55") ? cleanA.substring(2) : cleanA;
              const normB = cleanB.startsWith("55") ? cleanB.substring(2) : cleanB;
              
              if (normA === normB) return true;
              
              if (normA.length >= 10 && normB.length >= 10) {
                const dddA = normA.substring(0, 2);
                const dddB = normB.substring(0, 2);
                const last8A = normA.substring(normA.length - 8);
                const last8B = normB.substring(normB.length - 8);
                if (dddA === dddB && last8A === last8B) {
                  return true;
                }
              }
              
              if (cleanA.length >= 8 && cleanB.length >= 8) {
                const minLen = Math.min(cleanA.length, cleanB.length, 9);
                const endA = cleanA.substring(cleanA.length - minLen);
                const endB = cleanB.substring(cleanB.length - minLen);
                if (endA === endB) return true;
              }
              
              return false;
            };

            // Match registered patient in clinic
            let patientId = "";
            let patientName = profileName;
            let resolvedConversationId = fromPhone; 

            const patientsSnap = await adminDb.collection(`clinics/${matchedClinicId}/patients`).get();
            const matchedPatientDoc = patientsSnap.docs.find(d => {
              const pData = d.data() || {};
              const potentialPhones: string[] = [];
              const fieldsToCheck = ["phone", "telefone", "cellphone", "celular", "whatsapp", "mobile", "phoneNormalized"];
              fieldsToCheck.forEach(field => {
                const val = pData[field];
                if (typeof val === "string" && val) {
                  potentialPhones.push(val.replace(/\D/g, ""));
                }
              });
              if (Array.isArray(pData.phones)) {
                pData.phones.forEach((val: any) => {
                  if (typeof val === "string" && val) {
                    potentialPhones.push(val.replace(/\D/g, ""));
                  }
                });
              }
              return potentialPhones.some(pPhone => arePhonesMatching(fromPhone, pPhone));
            });

            let phoneNormalized = "";
            if (matchedPatientDoc) {
              patientId = matchedPatientDoc.id;
              patientName = matchedPatientDoc.data().name || patientName;
              phoneNormalized = (matchedPatientDoc.data().phoneNormalized || matchedPatientDoc.data().phone || "").replace(/\D/g, "");
              const rawPatientPhone = (matchedPatientDoc.data().phone || "").replace(/\D/g, "");
              if (rawPatientPhone) {
                resolvedConversationId = rawPatientPhone;
              }
            }

            // Nunca loga patientId/patientName/telefone — só o booleano de
            // se um paciente cadastrado foi encontrado.
            logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "conversation_patient_match", clinicId: matchedClinicId, extra: { matchedPatient: !!matchedPatientDoc } });

            // Query existing conversations inside Firestore to see if one matches this incoming phone
            const convosSnap = await adminDb.collection(`clinics/${matchedClinicId}/whatsapp_conversations`).get();
            const matchedConvoDoc = convosSnap.docs.find(doc => {
              const cId = doc.id;
              const cData = doc.data() || {};
              const cPhone = (cData.patientPhone || "").replace(/\D/g, "");
              return arePhonesMatching(fromPhone, cId) || arePhonesMatching(fromPhone, cPhone);
            });

            if (matchedConvoDoc) {
              resolvedConversationId = matchedConvoDoc.id;
              if (!patientId && matchedConvoDoc.data().patientId) {
                patientId = matchedConvoDoc.data().patientId;
                patientName = matchedConvoDoc.data().patientName || patientName;
              }
            }

            const conversationId = fromPhone;

            // Nunca loga telefone/messageId/texto — evento estruturado só
            // confirma que a mensagem inbound foi recebida e vai ser
            // processada, sem nenhum dado do paciente.
            logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "inbound_message_received", clinicId: matchedClinicId });

            // Create/update conversation + save message + mark the event
            // "completed", all in ONE Firestore transaction, fenced on
            // msgClaimId — see commitInboundPatientMessage's doc comment.
            // Either everything above lands together with "completed", or
            // NONE of it does (claim superseded → StaleClaimError, nothing
            // written at all). No window exists anymore where the message
            // is saved but the event isn't marked done, which is exactly
            // the crash window that used to make a retry double-increment
            // unreadCount.
            const convoRef = adminDb.doc(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}`);
            const msgRef = adminDb.doc(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}/messages/${messageId}`);
            await commitInboundPatientMessage(
              matchedClinicId, messageId, msgClaimId,
              convoRef, {
                patientId: patientId || "",
                patientName,
                patientPhone: fromPhone,
                status: "aguardando",
                lastMessage: textMsg,
                lastMessageAt: AdminFieldValue.serverTimestamp(),
                unreadCount: AdminFieldValue.increment(1),
                assignedTo: "ai",
                aiEnabled: matchedIntegration.aiEnabled !== false,
                source: "whatsapp",
                updatedAt: AdminFieldValue.serverTimestamp()
              },
              msgRef, {
                direction: "inbound",
                text: textMsg,
                timestamp: AdminFieldValue.serverTimestamp(),
                createdAt: AdminFieldValue.serverTimestamp(),
                from: fromPhone,
                to: metadata.display_phone_number || "",
                phoneNormalized: phoneNormalized || fromPhone.replace(/\D/g, ""),
                whatsappMessageId: messageId,
                profileName: profileName,
                status: "received",
                aiGenerated: false,
                sentBy: "whatsapp",
                source: "whatsapp_webhook"
              },
            );

            // Nunca loga msgRef.path — o caminho do documento embute o
            // telefone (conversationId) e o messageId.
            logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "inbound_message_saved", clinicId: matchedClinicId });

            // Best-effort telemetry ONLY, deliberately outside the
            // transaction above and in its own try/catch: the event is
            // already "completed" by this point (the real effect already
            // landed), so a failure here must never flip the whole
            // delivery to look like a processing failure — that would
            // just cost the provider a pointless retry that dedup would
            // immediately no-op anyway (claimWhatsAppWebhookEvent sees
            // "completed" and skips).
            try {
              await adminDb.collection(`clinics/${matchedClinicId}/integration_logs`).add({
                type: "whatsapp",
                action: "webhook_received",
                status: "success",
                message: `Mensagem recebida de ${patientName} (${fromPhone}): "${textMsg.substring(0, 40)}${textMsg.length > 40 ? '...' : ''}"`,
                createdAt: AdminFieldValue.serverTimestamp()
              });
              const messagesSnap = await adminDb.collection(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}/messages`).get();
              // Nunca loga conversationId (é o telefone) — só a métrica de contagem.
              logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "conversation_message_count", clinicId: matchedClinicId, extra: { messageCount: messagesSnap.size } });
            } catch (telemetryErr) {
              logSanitizedWaError({ scope: "WA_WEBHOOK", errorCode: "WA_TELEMETRY_FAILED", phase: "POST_COMPLETION_TELEMETRY", ref: `${matchedClinicId}:${messageId}`, err: telemetryErr });
            }
            } catch (perMessageError: any) {
              if (perMessageError instanceof WaWebhookStaleClaimError) {
                // Not a real failure — a newer claim already owns (or
                // finished) this event; this worker was just slow. Nothing
                // was written, nothing to mark, no reason to fail the
                // response for it.
                logSanitizedWaError({ scope: "WA_WEBHOOK_DEDUP", errorCode: "WA_STALE_CLAIM_DISCARDED", phase: "MESSAGE_PROCESSING", ref: `${matchedClinicId}:${messageId}` });
              } else {
                const reallyFailed = await markWhatsAppWebhookEventFailed(matchedClinicId, messageId, msgClaimId, "MESSAGE_PROCESSING", perMessageError);
                if (reallyFailed) anyEventFailed = true;
              }
            }
          }
        }

        // Webhook Status Update Handler (Part 2)
        if (
          body.entry &&
          body.entry[0].changes &&
          body.entry[0].changes[0] &&
          body.entry[0].changes[0].value.statuses
        ) {
          const changeValue = body.entry[0].changes[0].value;
          const metadata = changeValue.metadata || {};
          const phoneNumberId = metadata.phone_number_id;
          const statuses = changeValue.statuses;

          console.log(`[WHATSAPP STATUS UPDATE] Webhook status event received. Total: ${statuses.length}`);

          // Item 2 — mesma resolução exclusivamente via índice usada no
          // loop de mensagens acima; nunca varre todas as clínicas, nunca
          // encaminha pra uma clínica presumida. Nada mais depende do
          // resultado deste bloco (é o último antes da resposta final),
          // então o mesmo 503/200 recuperável-vs-persistente se aplica com
          // um early return direto, igual ao loop de mensagens.
          const statusRouting = await resolveClinicForInboundRouting(phoneNumberId);
          if (statusRouting.ok === false) {
            return statusRouting.recoverable ? res.status(503).json({ error: statusRouting.reason }) : res.sendStatus(200);
          }
          const matchedClinicId = statusRouting.clinicId;
          for (const s of statuses) {
            const metaMessageId = s.id;
            const newStatus = s.status; // "delivered", "read", "failed", "sent"
            const recipientId = s.recipient_id; // Normalized phone
            const eventKey = `${metaMessageId}:${newStatus}`;
            const { claimed: statusClaimed, claimId: statusClaimId } = await claimWhatsAppWebhookEvent(matchedClinicId, eventKey);
            if (!statusClaimed || !statusClaimId) continue;

              try {
              // Nunca loga metaMessageId/recipientId (telefone) — só o
              // status em si, que não é dado do paciente.
              logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "status_update_received", clinicId: matchedClinicId, extra: { status: newStatus } });

              // Find the message under clinics/{clinicId}/whatsapp_conversations/{recipientId}/messages
              // where whatsappMessageId == metaMessageId
              const folderRef = adminDb.collection(`clinics/${matchedClinicId}/whatsapp_conversations/${recipientId}/messages`);
              const querySnap = await folderRef.where("whatsappMessageId", "==", metaMessageId).get();

              if (!querySnap.empty) {
                for (const doc of querySnap.docs) {
                  await doc.ref.update({
                    status: newStatus,
                    statusUpdatedAt: AdminFieldValue.serverTimestamp()
                  });
                  // Nunca loga doc.id (deriva do messageId) nem recipientId (telefone).
                  logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "status_update_applied", clinicId: matchedClinicId, extra: { status: newStatus } });
                }
              } else {
                // If it wasn't found in recipientId, search in all conversations (fallback)
                const folderRefFallback = adminDb.collectionGroup("messages");
                const fallbackSnap = await folderRefFallback.where("whatsappMessageId", "==", metaMessageId).get();
                if (!fallbackSnap.empty) {
                  for (const fbDoc of fallbackSnap.docs) {
                    await fbDoc.ref.update({
                      status: newStatus,
                      statusUpdatedAt: AdminFieldValue.serverTimestamp()
                    });
                    // Nunca loga fbDoc.id (deriva do messageId).
                    logSanitizedWaInfo({ scope: "WA_WEBHOOK", event: "status_update_applied_fallback", clinicId: matchedClinicId, extra: { status: newStatus } });
                  }
                }
              }
              await markWhatsAppWebhookEventCompleted(matchedClinicId, eventKey, statusClaimId);
              } catch (perStatusError: any) {
                const reallyFailed = await markWhatsAppWebhookEventFailed(matchedClinicId, eventKey, statusClaimId, "STATUS_PROCESSING", perStatusError);
                if (reallyFailed) anyEventFailed = true;
              }
            }
        }

        // A partial failure (some events "completed", others "failed")
        // must come back as non-2xx — that is what makes the provider's
        // own redelivery drive the retry for exactly the events that
        // failed (successful ones already show "completed" and will just
        // no-op on redelivery via claimWhatsAppWebhookEvent above).
        return res.sendStatus(anyEventFailed ? 500 : 200);
      } catch (error: any) {
        // Deliberately NEVER logs the payload/body here anymore (it used
        // to — a real violation: the raw webhook body contains message
        // text, contact names, phone numbers). A crash this far out (
        // before/outside any single event's own try/catch) has no
        // eventKey to attach to; "meta_webhook_outer" is a fixed,
        // non-identifying ref label.
        logSanitizedWaError({ scope: "WA_WEBHOOK_META", errorCode: "WA_WEBHOOK_OUTER_FAILED", phase: "OUTER_HANDLER", ref: "meta_webhook_outer", err: error });
        return res.status(500).json({ error: "webhook_handling_failed" });
      }
    }

    return res.sendStatus(404);
  }

  // ---------------------------------------------------------------------
  // WhatsApp Embedded Signup (Coexistence) — start-attempt / exchange.
  // Plano vast-yawning-hamster.md v4. Etapa A, fase local, rodada de
  // paridade/fencing:
  //   - Secret Manager e Graph API SEMPRE mockados nesta fase
  //     (getSecretManagerClient()/getWhatsAppGraphClient() só devolvem o
  //     cliente real quando WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS!=='1' — os
  //     scripts de teste desta fase sempre setam essa env var). O mock do
  //     Secret Manager tem PARIDADE explícita com o real: nenhum dos dois
  //     cria o secret sozinho — ver src/lib/secretManager.ts e
  //     src/lib/whatsappSecretProvisioner.ts pra arquitetura de
  //     provisionamento (identidade separada, nunca este runtime).
  //   - candidateConfig só existe dentro do connectionAttempt; a
  //     integração ATIVA (clinics/{clinicId}/integrations/whatsapp) nunca
  //     é tocada antes da transação terminal.
  //   - Token de acesso NUNCA em texto no Firestore — só accessTokenSecretName
  //     + accessTokenSecretVersionCandidate (um número de versão, nunca
  //     "latest"). Uma versão criada com sucesso mas nunca promovida (por
  //     falha numa etapa posterior) é registrada como órfã — ver
  //     recordOrphanedSecretVersion.
  //   - Concorrência otimista na transação terminal via
  //     DocumentSnapshot.updateTime da integração ativa (monotônico,
  //     atribuído pelo servidor, não pode ser falsificado por quem
  //     escreve) capturado como baseIntegrationVersion no início da
  //     tentativa — se mudou entre então e a transação terminal, alguém
  //     mais já terminou uma conexão mais nova; esta tentativa aborta.
  //   - whatsapp_phone_index/{phoneNumberId} (top-level, fora de
  //     clinics/{clinicId}) é reservado atomicamente ('pending', com
  //     lease) antes de qualquer chamada que dependa do número, e só vira
  //     'active' dentro da MESMA transação terminal que promove a
  //     integração — impede duas clínicas DIFERENTES de reivindicarem o
  //     mesmo número ao mesmo tempo (reconexão pela MESMA clínica é
  //     permitida). Rollback de uma reserva só remove se ainda pertencer
  //     ao mesmo attemptId (fencing).
  //   - Rollback da assinatura da WABA verifica, antes de desassinar, se a
  //     integração ativa da clínica não passou a depender dela nesse
  //     meio-tempo (ver isWabaSubscriptionStillNeeded) — createdByThisAttempt
  //     sozinho não basta, um worker mais lento pode ter sido superado por
  //     um mais novo que já reaproveitou a mesma assinatura.
  //   - Depois do POST de assinatura da WABA, um GET de confirmação
  //     separado precisa confirmar antes da transação terminal — uma
  //     confirmação inconclusiva (ou ausente) bloqueia a promoção, do
  //     mesmo jeito que Coexistence não-confirmada bloqueia.
  //   - O `code` do OAuth é de uso único (ver whatsappGraphClient.ts) —
  //     uma tentativa que falha depois de já ter trocado o code nunca
  //     tenta reexecutar a troca; ela se encerra e exige uma tentativa
  //     nova (com um code novo de um login novo), preservando só a
  //     referência da versão de secret órfã, nunca o code nem o token cru.
  // ---------------------------------------------------------------------
  const WA_ATTEMPT_TTL_MS = 10 * 60 * 1000;
  const WA_PHONE_INDEX_LEASE_MS = 5 * 60 * 1000;

  // Higiene de esquema: baseIntegrationVersion é o valor CANÔNICO do
  // DocumentSnapshot.updateTime da integração ativa, capturado como
  // {seconds, nanoseconds} — não um número de milissegundos. Um
  // Timestamp do Firestore tem precisão de NANOSSEGUNDOS; reduzir pra
  // milissegundos (.toMillis()) pode colapsar dois updates genuinamente
  // diferentes na mesma comparação em tese, o que enfraqueceria a
  // concorrência otimista exatamente no ponto que ela existe pra proteger.
  // {seconds, nanoseconds} preserva o valor exato, sem perda, e ainda é
  // serializável como campo simples no Firestore (nunca comparado como
  // Timestamp reidratado, que teria o mesmo problema se comparado por
  // igualdade de objeto).
  type CanonicalTimestamp = { seconds: number; nanoseconds: number } | null;
  function canonicalizeTimestamp(ts: FirebaseFirestore.Timestamp | undefined | null): CanonicalTimestamp {
    if (!ts) return null;
    return { seconds: ts.seconds, nanoseconds: ts.nanoseconds };
  }
  function timestampsEqual(a: CanonicalTimestamp, b: CanonicalTimestamp): boolean {
    if (a === null || b === null) return a === b;
    return a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
  }

  function attemptRefFor(clinicId: string, attemptId: string) {
    return adminDb.doc(`clinics/${clinicId}/whatsapp_connection_attempts/${attemptId}`);
  }

  async function authenticateOwnerOrAdmin(req: any): Promise<{ uid: string; clinicId: string } | { error: true; status: number; code: string }> {
    let auth;
    try {
      auth = await authenticateElizaRequest(req);
    } catch (err: any) {
      const isElizaError = err instanceof ElizaError;
      if (!isElizaError) {
        // Não deveria acontecer (authenticateElizaRequest só deveria
        // lançar ElizaError) — se acontecer, log sanitizado em vez de
        // engolir silenciosamente, senão um 401 genérico não dá nenhuma
        // pista de diagnóstico.
        logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_AUTH_UNEXPECTED_ERROR", phase: "AUTHENTICATION", ref: String(req.body?.clinicId || "unknown"), err });
      }
      return { error: true, status: isElizaError ? err.statusCode : 401, code: isElizaError ? err.code : "AUTH_ERROR" };
    }
    if (!auth.isOwnerOrAdmin) {
      return { error: true, status: 403, code: "OWNER_OR_ADMIN_REQUIRED" };
    }
    return { uid: auth.uid, clinicId: auth.clinicId };
  }

  // ---- Orphaned secret versions (item 2) ----
  // clinics/{clinicId}/whatsapp_orphaned_secret_versions/{hash}. Higiene de
  // esquema: o ID do doc é um hash SHA-256 determinístico de
  // `secretName + ':' + versionId`, nunca uma concatenação sanitizada por
  // regex — um regex de "caracteres seguros" pode deixar passar algo
  // inesperado; um hash é estruturalmente incapaz de conter '/' ou
  // qualquer outro caractere inválido pra um ID de documento Firestore,
  // independente do que secretName/versionId contenham.
  function orphanedVersionRefFor(clinicId: string, secretName: string, versionId: string) {
    const hash = crypto.createHash("sha256").update(`${secretName}:${versionId}`).digest("hex").slice(0, 32);
    return adminDb.doc(`clinics/${clinicId}/whatsapp_orphaned_secret_versions/${hash}`);
  }
  async function recordOrphanedSecretVersion(clinicId: string, attemptId: string, secretName: string, versionId: string, reason: string): Promise<void> {
    try {
      await orphanedVersionRefFor(clinicId, secretName, versionId).set({
        secretName, versionId, attemptId, clinicId, reason,
        orphanedAt: AdminFieldValue.serverTimestamp(),
        // Nunca escrito por este runtime — só pelo procedimento
        // administrativo de limpeza (identidade separada, ver
        // whatsappSecretProvisioner.ts). SEM `expiresAt` de propósito —
        // política de retenção definida acima (item 8, rodada final):
        // este registro descreve uma versão de secret ainda VÁLIDA no
        // Secret Manager, TTL aqui apagaria o rastro de uma credencial
        // órfã ainda viva, não o problema em si.
        disabledAt: null,
      });
    } catch (err) {
      logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_ORPHAN_RECORD_FAILED", phase: "ORPHAN_TRACKING", ref: `${clinicId}:${attemptId}`, err });
    }
  }

  // ---- WABA cleanup vira procedimento administrativo (rodada final) ----
  // Antes desta rodada, o rollback chamava DELETE /{wabaId}/subscribed_apps
  // automaticamente quando isWabaSubscriptionStillNeeded(wabaId) dizia
  // "não". Removido de propósito: mesmo com o fencing GLOBAL (Seção
  // isWabaSubscriptionStillNeeded acima), uma chamada DELETE automática
  // continua sendo uma ação IRREVERSÍVEL disparada por uma tentativa que
  // FALHOU, sobre um recurso (a assinatura da WABA) que pode ser
  // compartilhado por reconexões futuras da mesma clínica ou por uma
  // condição de corrida que a checagem, por mais rigorosa que seja, não
  // elimina 100% (a janela entre a leitura e o DELETE nunca é atômica com
  // uma chamada de rede externa). Mesma disciplina já aplicada à versão
  // órfã do secret (nunca desabilitada automaticamente): registra pra
  // revisão administrativa, nunca executa a ação destrutiva sozinho. O
  // procedimento de limpeza real (fora desta rodada, nunca executado por
  // este runtime) deve RECONFIRMAR isWabaSubscriptionStillNeeded no
  // MOMENTO da limpeza (não confiar no snapshot de quando foi flagged,
  // que pode estar desatualizado) antes de decidir desassinar.
  async function recordPendingWabaCleanup(clinicId: string, attemptId: string, wabaId: string, reason: string): Promise<void> {
    try {
      await adminDb.doc(`clinics/${clinicId}/whatsapp_pending_waba_cleanup/${attemptId}`).set({
        wabaId, attemptId, clinicId, reason,
        flaggedAt: AdminFieldValue.serverTimestamp(),
        // SEM `expiresAt` de propósito, mesma política do item 8 (rodada
        // final): a assinatura da WABA pode continuar ativa do lado da
        // Meta até alguém confirmar e limpar de verdade.
        cleanedUpAt: null,
      });
    } catch (err) {
      logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_WABA_CLEANUP_RECORD_FAILED", phase: "ROLLBACK", ref: `${clinicId}:${attemptId}`, err });
    }
  }

  // ---- Global phone number reservation (item 3) ----
  // whatsapp_phone_index/{phoneNumberId} — TOP-LEVEL, fora de clinics/{id}.
  // Fencing por reservationClaimId (imprevisível, gerado a cada reserva/
  // reclaim bem-sucedido) — não só attemptId: um attemptId sozinho
  // identifica QUEM fez a última reserva, mas não distingue "esta reserva
  // específica, ainda viva" de "uma reserva antiga do mesmo attemptId que
  // já foi reclamada e substituída" (não deveria acontecer com o desenho
  // atual, já que cada attempt reserva no máximo uma vez, mas o claimId
  // deixa isso estruturalmente impossível de confundir, mesmo sob mudança
  // futura, e espelha o mesmo padrão já usado no dedup do webhook).
  // Confirmação (rodada final, item 5): a reserva grava `wabaId` no MESMO
  // doc que o roteamento inbound lê (whatsapp_phone_index/{phoneNumberId})
  // e é o MESMO valor promovido pra `integrations/whatsapp.wabaId` na
  // transação terminal — os três (reserva, isWabaSubscriptionStillNeeded,
  // integração final) sempre leem o mesmo `discovery.wabaId` desta mesma
  // tentativa, nunca reconciliados a posteriori. Isso garante, por
  // construção (não por checagem em runtime), que
  // isWabaSubscriptionStillNeeded(wabaId) — que consulta
  // whatsapp_phone_index.where("wabaId","==",wabaId) — sempre encontra
  // exatamente as reservas que de fato usam essa WABA, nunca uma reserva
  // com wabaId desatualizado ou ausente. A promoção pra 'active' (ver
  // transação terminal) só atualiza status/activatedAt no doc, nunca
  // reescreve wabaId — não há segundo ponto de escrita que pudesse
  // divergir.
  type PhoneReserveResult = { ok: true; reservationClaimId: string } | { ok: false; reason: string };
  async function reservePhoneIndex(clinicId: string, attemptId: string, phoneNumberId: string, wabaId: string): Promise<PhoneReserveResult> {
    const ref = adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`);
    const reservationClaimId = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + WA_PHONE_INDEX_LEASE_MS);
    const freshReservation = { status: "pending", clinicId, attemptId, reservationClaimId, phoneNumberId, wabaId, reservedAt: AdminFieldValue.serverTimestamp(), leaseExpiresAt, activatedAt: null };
    return adminDb.runTransaction(async (tx): Promise<PhoneReserveResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, freshReservation);
        return { ok: true as const, reservationClaimId };
      }
      const data = snap.data() as any;
      if (data.status === "active") {
        if (data.clinicId !== clinicId) {
          // O requisito é impedir CLÍNICAS DIFERENTES de disputarem o
          // mesmo número — reconexão pela mesma clínica que já o possui é
          // legítima e permitida.
          return { ok: false as const, reason: "phone_connected_to_other_clinic" };
        }
        tx.set(ref, freshReservation);
        return { ok: true as const, reservationClaimId };
      }
      // status === "pending": só reclama se a lease expirou.
      const leaseExpiresAtMs = typeof data.leaseExpiresAt?.toMillis === "function" ? data.leaseExpiresAt.toMillis() : 0;
      const expired = Date.now() > leaseExpiresAtMs;
      if (!expired) {
        return { ok: false as const, reason: data.clinicId === clinicId ? "phone_reservation_in_progress_same_clinic" : "phone_reservation_in_progress_other_clinic" };
      }
      tx.set(ref, freshReservation);
      return { ok: true as const, reservationClaimId };
    });
  }
  async function releasePhoneIndexIfOwnedByClaim(phoneNumberId: string | null | undefined, reservationClaimId: string | null | undefined, clinicId: string, attemptId: string): Promise<void> {
    if (!phoneNumberId || !reservationClaimId) return;
    const ref = adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`);
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const data = snap.data() as any;
        // Fencing: só remove uma reserva que ainda "pending" E ainda tem o
        // MESMO reservationClaimId — nunca uma já promovida a 'active',
        // nunca uma reclamada por outra tentativa/clínica desde então
        // (mesmo que o attemptId por algum motivo colidisse, o claimId
        // nunca colide).
        if (data.status === "pending" && data.reservationClaimId === reservationClaimId) {
          tx.delete(ref);
        }
      });
    } catch (err) {
      logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_PHONE_INDEX_RELEASE_FAILED", phase: "ROLLBACK", ref: `${clinicId}:${attemptId}`, err });
    }
  }
  // Item 3 — renova (ou valida) a lease imediatamente antes da transação
  // terminal: o fluxo inteiro (troca de code, discovery, coexistence,
  // secret, assinatura+confirmação da WABA) pode levar tempo suficiente
  // pra uma lease de 5min ficar apertada; renovar aqui, fenced pelo mesmo
  // reservationClaimId, garante que a checagem final da transação terminal
  // não rejeite por expiração relativa a quando a reserva foi FEITA, só
  // por ela ter sido genuinamente perdida/reclamada por outro claim.
  type LeaseRenewResult = { ok: true } | { ok: false; reason: string };
  async function renewPhoneIndexLease(phoneNumberId: string, reservationClaimId: string): Promise<LeaseRenewResult> {
    const ref = adminDb.doc(`whatsapp_phone_index/${phoneNumberId}`);
    return adminDb.runTransaction(async (tx): Promise<LeaseRenewResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const, reason: "phone_reservation_lost" };
      const data = snap.data() as any;
      if (data.status !== "pending" || data.reservationClaimId !== reservationClaimId) {
        return { ok: false as const, reason: "phone_reservation_lost" };
      }
      tx.update(ref, { leaseExpiresAt: new Date(Date.now() + WA_PHONE_INDEX_LEASE_MS) });
      return { ok: true as const };
    });
  }

  // ---- WABA subscription rollback fencing (item 4) — GLOBAL ----
  // createdByThisAttempt=true não basta: se, entre esta tentativa criar a
  // assinatura e ela falhar depois, uma tentativa MAIS NOVA (em QUALQUER
  // clínica) já reaproveitou essa mesma assinatura, desassinar agora
  // quebraria essa conexão — mesmo classe de problema do "worker antigo
  // retorna atrasado" já resolvido pro dedup do webhook, aplicado aqui à
  // assinatura da WABA. Checa GLOBALMENTE (não só a clínica da tentativa
  // que está fazendo rollback), considerando:
  //   1. Qualquer integração ATIVA (qualquer clínica) usando esta wabaId;
  //   2. Qualquer reserva PENDING válida (lease não expirada) do índice de
  //      telefone referenciando esta wabaId — uma conexão ainda em
  //      andamento, mesmo que não tenha chegado a promover a integração
  //      ainda, já "reserva" o direito de precisar da assinatura;
  //   3. Qualquer connectionAttempt PROCESSING (qualquer clínica) cujo
  //      candidateConfig referencia esta wabaId — mesmo sem reserva de
  //      telefone ainda (pode estar num passo anterior do fluxo).
  // Consultas por igualdade de campo único (sem segundo filtro no server)
  // — filtra o segundo critério (status) no cliente, de propósito: evita
  // exigir um índice composto de collectionGroup que não existe no
  // ambiente local/emulador desta fase.
  async function isWabaSubscriptionStillNeeded(wabaId: string): Promise<boolean> {
    const [integrationsSnap, phoneIndexSnap, attemptsSnap] = await Promise.all([
      adminDb.collectionGroup("integrations").where("wabaId", "==", wabaId).get(),
      adminDb.collection("whatsapp_phone_index").where("wabaId", "==", wabaId).get(),
      adminDb.collectionGroup("whatsapp_connection_attempts").where("candidateConfig.wabaId", "==", wabaId).get(),
    ]);

    const anyActiveIntegration = integrationsSnap.docs.some((d) => d.data()?.status === "conectado");
    if (anyActiveIntegration) return true;

    const now = Date.now();
    const anyValidPendingReservation = phoneIndexSnap.docs.some((d) => {
      const data = d.data();
      if (data.status !== "pending") return false;
      const leaseExpiresAtMs = typeof data.leaseExpiresAt?.toMillis === "function" ? data.leaseExpiresAt.toMillis() : 0;
      return now <= leaseExpiresAtMs;
    });
    if (anyValidPendingReservation) return true;

    const anyProcessingAttempt = attemptsSnap.docs.some((d) => d.data()?.status === "processing");
    if (anyProcessingAttempt) return true;

    return false;
  }

  // Endpoint SÓ-TESTE, registrado condicionalmente — se
  // WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS não estiver setado no boot do
  // processo, esta rota nunca é registrada no Express, então uma
  // requisição real cai no 404 padrão. Simula, pro script de teste (que
  // roda num processo separado do servidor), a ação do provisionador
  // administrativo separado (whatsappSecretProvisioner.ts) acontecendo
  // ANTES de qualquer exchange — nunca dentro do fluxo de exchange em si.
  if (process.env.WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS === "1") {
    app.post("/api/whatsapp/embedded-signup/_test-only/provision-secret", async (req, res) => {
      const { clinicId } = req.body || {};
      if (!clinicId || typeof clinicId !== "string") return res.status(400).json({ error: "missing_clinicId" });
      try {
        const result = await getWhatsAppSecretProvisioner().provisionSecretForClinic(clinicId);
        return res.json(result);
      } catch (err: any) {
        logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_TEST_PROVISION_FAILED", phase: "TEST_PROVISION", ref: clinicId, err });
        return res.status(500).json({ error: "provision_failed" });
      }
    });
  }

  app.post("/api/whatsapp/embedded-signup/start-attempt", async (req, res) => {
    const auth = await authenticateOwnerOrAdmin(req);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.code });

    try {
      const attemptId = crypto.randomUUID();
      const now = Date.now();
      const expiresAt = new Date(now + WA_ATTEMPT_TTL_MS);

      const integrationRef = adminDb.doc(`clinics/${auth.clinicId}/integrations/whatsapp`);
      const integrationSnap = await integrationRef.get();
      const baseIntegrationVersion = canonicalizeTimestamp(integrationSnap.exists ? integrationSnap.updateTime : null);

      await attemptRefFor(auth.clinicId, attemptId).set({
        attemptId,
        clinicId: auth.clinicId,
        userId: auth.uid,
        createdAt: AdminFieldValue.serverTimestamp(),
        expiresAt,
        usedAt: null,
        status: "pending",
        errorCode: null,
        errorClass: null,
        errorPhase: null,
        lastFailedAt: null,
        baseIntegrationVersion,
        candidateConfig: null,
      });

      return res.json({ attemptId, expiresAt: expiresAt.toISOString() });
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_START_ATTEMPT_FAILED", phase: "START_ATTEMPT", ref: auth.clinicId, err });
      return res.status(500).json({ error: "start_attempt_failed" });
    }
  });

  app.post("/api/whatsapp/embedded-signup/exchange", async (req, res) => {
    const auth = await authenticateOwnerOrAdmin(req);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.code });
    // Capturados em consts locais (não `auth.clinicId`/`auth.uid` direto)
    // de propósito: o narrowing do TS da união `auth` acima não atravessa
    // pra dentro de `failAttempt` (function declaration hoisted, definida
    // mais abaixo) de forma confiável — usar uma const simples evita o
    // falso-positivo de tipo sem depender de narrowing através de closure.
    const clinicId = auth.clinicId;
    const uid = auth.uid;

    const { attemptId, code } = req.body || {};
    if (!attemptId || typeof attemptId !== "string" || !code || typeof code !== "string") {
      return res.status(400).json({ error: "missing_fields" });
    }

    const attemptRef = attemptRefFor(clinicId, attemptId);
    const attemptRefLabel = `${clinicId}:${attemptId}`;

    // Step 1 — claim the attempt: single-use, bound to whoever started it,
    // pending->processing in ONE transaction (closes the replay/race
    // window — see plano Seção 6). Any check failing here means NOTHING
    // below ever runs; the active integration is never at risk.
    type ClaimResult = { ok: true } | { ok: false; status: number; code: string };
    let claim: ClaimResult;
    try {
      claim = await adminDb.runTransaction(async (tx): Promise<ClaimResult> => {
        const snap = await tx.get(attemptRef);
        if (!snap.exists) return { ok: false as const, status: 404, code: "attempt_not_found" };
        const data = snap.data() as any;
        if (data.userId !== uid) return { ok: false as const, status: 403, code: "attempt_not_owned" };
        if (data.status === "expired" || (data.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
          if (data.status === "pending") tx.update(attemptRef, { status: "expired" });
          return { ok: false as const, status: 410, code: "attempt_expired" };
        }
        if (data.status !== "pending" || data.usedAt !== null) {
          return { ok: false as const, status: 409, code: "attempt_already_used" };
        }
        tx.update(attemptRef, { status: "processing", usedAt: AdminFieldValue.serverTimestamp() });
        return { ok: true as const };
      });
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_EXCHANGE_CLAIM_FAILED", phase: "CLAIM_ATTEMPT", ref: attemptRefLabel, err });
      return res.status(500).json({ error: "claim_failed" });
    }
    if (claim.ok === false) return res.status(claim.status).json({ error: claim.code });

    // From here on the attempt is "processing" and single-use — a second
    // call (replay, or a genuinely concurrent request) already failed at
    // the claim above with 409/410, never reaching any of this.
    const graphClient = getWhatsAppGraphClient();
    const secretClient = getSecretManagerClient();
    let candidateConfig: any = null;

    async function failAttempt(errorCode: string, phase: string, err?: any) {
      logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode, phase, ref: attemptRefLabel, err });
      try {
        await attemptRef.update({
          status: "failed",
          errorCode, errorClass: classifyErrorClass(err), errorPhase: phase,
          lastFailedAt: AdminFieldValue.serverTimestamp(),
        });
      } catch (markErr) {
        logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_MARK_ATTEMPT_FAILED_FAILED", phase, ref: attemptRefLabel, err: markErr });
      }

      // Item 2 — uma versão de secret já criada com sucesso, mas que nunca
      // chega a ser promovida (porque estamos indo pro "failed" aqui),
      // fica órfã — registrada pra limpeza administrativa, nunca reusada
      // nem promovida por acidente (a transação terminal só promove o que
      // está no candidateConfig de uma tentativa que ainda está
      // "processing" — uma tentativa "failed" nunca chega lá).
      if (candidateConfig?.accessTokenSecretName && candidateConfig?.accessTokenSecretVersionCandidate) {
        await recordOrphanedSecretVersion(clinicId, attemptId, candidateConfig.accessTokenSecretName, candidateConfig.accessTokenSecretVersionCandidate, errorCode);
      }

      // Item 3 — libera a reserva do número, SE ainda tiver o MESMO
      // reservationClaimId (fencing dentro da própria função — não só
      // attemptId).
      if (candidateConfig?.phoneNumberId) {
        await releasePhoneIndexIfOwnedByClaim(candidateConfig.phoneNumberId, candidateConfig.reservationClaimId, clinicId, attemptId);
      }

      // Item 1/4 — checagem de fencing GLOBAL da WABA (rodada final:
      // nunca mais chama DELETE automaticamente — ver
      // recordPendingWabaCleanup acima). createdByThisAttempt=true é
      // necessário mas não suficiente — só flag pra limpeza se, ALÉM
      // disso, NENHUMA clínica (não só a desta tentativa) depende dela
      // agora.
      if (candidateConfig?.wabaSubscriptionCreatedByThisAttempt === true && candidateConfig?.wabaId) {
        try {
          const stillNeeded = await isWabaSubscriptionStillNeeded(candidateConfig.wabaId);
          if (stillNeeded) {
            logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_ROLLBACK_SKIPPED_STILL_IN_USE", phase: "ROLLBACK", ref: attemptRefLabel });
          } else {
            await recordPendingWabaCleanup(clinicId, attemptId, candidateConfig.wabaId, errorCode);
            logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_ROLLBACK_FLAGGED_FOR_ADMIN_CLEANUP", phase: "ROLLBACK", ref: attemptRefLabel });
          }
        } catch (rollbackErr) {
          logSanitizedWaError({ scope: "WA_EMBEDDED_SIGNUP", errorCode: "WA_ROLLBACK_CHECK_FAILED", phase: "ROLLBACK", ref: attemptRefLabel, err: rollbackErr });
        }
      }
    }

    try {
      // Step 2 — exchange the code (mocked this phase). Own try/catch per
      // external step from here on, each with its OWN errorPhase — a
      // single catch-all would collapse "which step failed" into one
      // generic phase, losing exactly the triage value the sanitized log
      // schema (errorCode/errorClass/phase) is meant to preserve.
      let tokenResult;
      try {
        tokenResult = await graphClient.exchangeCodeForToken(code);
      } catch (err: any) {
        await failAttempt("WA_TOKEN_EXCHANGE_FAILED", "TOKEN_EXCHANGE", err);
        return res.status(500).json({ error: "exchange_failed" });
      }
      // Step 3 — discover phone/WABA (mocked). Never trust the frontend's
      // FINISH-event phoneNumberId/wabaId — always re-derive server-side.
      let discovery;
      try {
        discovery = await graphClient.discoverPhoneAndWaba(tokenResult.accessToken);
      } catch (err: any) {
        await failAttempt("WA_DISCOVERY_FAILED", "DISCOVERY", err);
        return res.status(500).json({ error: "exchange_failed" });
      }

      // Step 4 — verify Coexistence (mocked). Anything short of
      // "confirmed" stops here — never proceeds to touch a secret or the
      // WABA subscription, never promotes anything.
      let coexistence;
      try {
        coexistence = await graphClient.verifyCoexistence(tokenResult.accessToken, discovery.phoneNumberId);
      } catch (err: any) {
        await failAttempt("WA_COEXISTENCE_CHECK_FAILED", "COEXISTENCE_VERIFICATION", err);
        return res.status(500).json({ error: "exchange_failed" });
      }
      if (coexistence.verification !== "confirmed") {
        await failAttempt(`WA_COEXISTENCE_${coexistence.verification.toUpperCase()}`, "COEXISTENCE_VERIFICATION");
        return res.status(422).json({ error: "coexistence_not_confirmed", verification: coexistence.verification });
      }

      // Step 4.5 (item 3) — reserve the global phone number index BEFORE
      // touching the secret or the WABA subscription. Only after Coexistence
      // is confirmed — never reserve a real number for a rejected/
      // inconclusive attempt. Blocks a DIFFERENT clinic from reserving the
      // same phoneNumberId; the same clinic reconnecting its own already-
      // active number is allowed.
      const phoneReserve = await reservePhoneIndex(clinicId, attemptId, discovery.phoneNumberId, discovery.wabaId);
      if (phoneReserve.ok === false) {
        await failAttempt(`WA_PHONE_RESERVE_${phoneReserve.reason.toUpperCase()}`, "PHONE_RESERVATION");
        return res.status(409).json({ error: phoneReserve.reason });
      }
      const reservationClaimId = phoneReserve.reservationClaimId;

      // Step 5 — new secret VERSION only (never creates the secret itself
      // — see secretManager.ts, agora com paridade real: falha exatamente
      // como o cliente real se o secret não foi provisionado antes por um
      // caminho administrativo separado). Progressively recorded into
      // candidateConfig, inside the attempt — accessTokenSecretVersion of
      // the ACTIVE integration is untouched until the terminal transaction.
      const secretName = `eliza-wa-token-${clinicId}`;
      let versionResult;
      try {
        versionResult = await secretClient.addSecretVersion(secretName, tokenResult.accessToken);
      } catch (err: any) {
        // candidateConfig ainda é null aqui — mas a reserva do telefone já
        // aconteceu (phoneReserve.ok), então failAttempt precisa saber
        // disso pra liberar. Constrói um candidateConfig mínimo só com o
        // phoneNumberId/reservationClaimId pra esse propósito.
        candidateConfig = { phoneNumberId: discovery.phoneNumberId, reservationClaimId };
        await failAttempt("WA_SECRET_VERSION_FAILED", "SECRET_VERSION", err);
        return res.status(500).json({ error: "exchange_failed" });
      }

      candidateConfig = {
        provider: "meta",
        connectionMethod: "embedded_signup_coexistence",
        phoneNumberId: discovery.phoneNumberId,
        wabaId: discovery.wabaId,
        reservationClaimId,
        businessName: discovery.businessName,
        displayPhoneNumber: discovery.displayPhoneNumber,
        accessTokenSecretName: secretName,
        accessTokenSecretVersionCandidate: versionResult.versionId,
        tokenExpiresAt: new Date(Date.now() + tokenResult.expiresIn * 1000),
        coexistenceVerification: coexistence.verification,
        coexistenceEvidence: coexistence.evidence,
        wabaSubscriptionConfirmedAt: null,
        wabaSubscriptionCreatedByThisAttempt: null,
      };
      await attemptRef.update({ candidateConfig });

      // Step 6 — WABA subscription sequence (mocked): CHECK first, only
      // subscribe if not already subscribed, and record whether THIS
      // attempt is the one that created it — the only thing that governs
      // whether a later rollback may unsubscribe (plano amendment 4).
      let createdByThisAttempt = false;
      try {
        const alreadySubscribed = await graphClient.getWabaSubscriptionStatus(discovery.wabaId, tokenResult.accessToken);
        if (!alreadySubscribed) {
          await graphClient.subscribeWaba(discovery.wabaId, tokenResult.accessToken);
          createdByThisAttempt = true;
        }
      } catch (err: any) {
        await failAttempt("WA_WABA_SUBSCRIPTION_FAILED", "WABA_SUBSCRIPTION", err);
        return res.status(500).json({ error: "exchange_failed" });
      }
      candidateConfig.wabaSubscriptionCreatedByThisAttempt = createdByThisAttempt;

      // Step 6.5 (item 5) — CONFIRM via a separate GET after the POST (or
      // after determining it was already subscribed) — never trust the
      // POST's 2xx alone. An inconclusive/failed confirmation blocks
      // promotion exactly like a non-confirmed Coexistence check does.
      let confirmed = false;
      try {
        confirmed = await graphClient.confirmWabaSubscription(discovery.wabaId, tokenResult.accessToken);
      } catch (err: any) {
        await failAttempt("WA_WABA_SUBSCRIPTION_CONFIRM_FAILED", "WABA_SUBSCRIPTION_CONFIRM", err);
        return res.status(500).json({ error: "exchange_failed" });
      }
      if (!confirmed) {
        await failAttempt("WA_WABA_SUBSCRIPTION_INCONCLUSIVE", "WABA_SUBSCRIPTION_CONFIRM");
        return res.status(422).json({ error: "waba_subscription_not_confirmed" });
      }
      candidateConfig.wabaSubscriptionConfirmedAt = new Date();
      await attemptRef.update({
        "candidateConfig.wabaSubscriptionConfirmedAt": AdminFieldValue.serverTimestamp(),
        "candidateConfig.wabaSubscriptionCreatedByThisAttempt": createdByThisAttempt,
      });

      // Test-only hook (mock-clients mode only): lets a test pause HERE,
      // after the subscription decision is recorded but before the
      // terminal transaction, to deterministically simulate a competing
      // attempt finishing first — exercises optimistic concurrency AND
      // the rollback path together. Inert whenever real clients are wired
      // (WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS!=='1').
      if (process.env.WA_EMBEDDED_SIGNUP_USE_MOCK_CLIENTS === "1" && code.includes("TEST_SLOW_BEFORE_TERMINAL")) {
        await new Promise((r) => setTimeout(r, 2500));
      }

      // Step 6.7 (item 3) — renova a lease da reserva do telefone
      // imediatamente antes da transação terminal, fenced pelo mesmo
      // reservationClaimId. Se a reserva já não pertence mais a este
      // claim (perdida/reclamada por outra tentativa/clínica), aborta
      // AQUI — não deixa a transação terminal nem tentar.
      const leaseRenew = await renewPhoneIndexLease(discovery.phoneNumberId, reservationClaimId);
      if (leaseRenew.ok === false) {
        await failAttempt(`WA_PHONE_LEASE_${leaseRenew.reason.toUpperCase()}`, "PHONE_RESERVATION");
        return res.status(409).json({ error: leaseRenew.reason });
      }

      // Step 7 — terminal transaction: optimistic concurrency + promote
      // candidateConfig into the ACTIVE integration, all at once. This is
      // the ONLY place in this whole flow that writes
      // clinics/{clinicId}/integrations/whatsapp.
      const integrationRef = adminDb.doc(`clinics/${clinicId}/integrations/whatsapp`);
      const statusRef = adminDb.doc(`clinics/${clinicId}/integrations/whatsapp_status`);
      const phoneIndexRef = adminDb.doc(`whatsapp_phone_index/${discovery.phoneNumberId}`);
      type TerminalResult = { ok: true } | { ok: false; reason: string };
      const terminal = await adminDb.runTransaction(async (tx): Promise<TerminalResult> => {
        // Todas as leituras antes de qualquer escrita (regra do Firestore).
        const attemptSnap = await tx.get(attemptRef);
        const attemptData = attemptSnap.data() as any;
        if (!attemptSnap.exists || attemptData.status !== "processing") {
          return { ok: false as const, reason: "attempt_not_processing" };
        }
        const integrationSnap = await tx.get(integrationRef);
        const currentVersion = canonicalizeTimestamp(integrationSnap.exists ? integrationSnap.updateTime : null);
        if (!timestampsEqual(currentVersion, attemptData.baseIntegrationVersion ?? null)) {
          return { ok: false as const, reason: "stale_base_version" };
        }
        // Item 3 — fencing da reserva do número: promove pra 'active'
        // SOMENTE se a reserva ainda tiver o MESMO reservationClaimId E a
        // lease ainda não tiver expirado (renovada um passo atrás, mas
        // revalidada aqui de novo — defesa em profundidade, mesma
        // disciplina do resto deste fluxo).
        const phoneIndexSnap = await tx.get(phoneIndexRef);
        const phoneIndexData = phoneIndexSnap.data() as any;
        const phoneLeaseExpiresAtMs = typeof phoneIndexData?.leaseExpiresAt?.toMillis === "function" ? phoneIndexData.leaseExpiresAt.toMillis() : 0;
        if (
          !phoneIndexSnap.exists ||
          phoneIndexData.status !== "pending" ||
          phoneIndexData.reservationClaimId !== reservationClaimId ||
          Date.now() > phoneLeaseExpiresAtMs
        ) {
          return { ok: false as const, reason: "phone_reservation_lost" };
        }
        const cc = attemptData.candidateConfig;
        tx.set(integrationRef, {
          status: "conectado",
          provider: cc.provider,
          connectionMethod: cc.connectionMethod,
          phoneNumberId: cc.phoneNumberId,
          wabaId: cc.wabaId,
          businessName: cc.businessName,
          displayPhoneNumber: cc.displayPhoneNumber,
          accessTokenSecretName: cc.accessTokenSecretName,
          accessTokenSecretVersion: cc.accessTokenSecretVersionCandidate,
          tokenExpiresAt: cc.tokenExpiresAt,
          coexistenceVerification: cc.coexistenceVerification,
          coexistenceEvidence: cc.coexistenceEvidence,
          wabaSubscriptionConfirmedAt: cc.wabaSubscriptionConfirmedAt,
          updatedAt: AdminFieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(statusRef, {
          status: "conectado",
          provider: cc.provider,
          displayPhoneNumber: cc.displayPhoneNumber,
          updatedAt: AdminFieldValue.serverTimestamp(),
        }, { merge: true });
        tx.update(phoneIndexRef, {
          status: "active",
          activatedAt: AdminFieldValue.serverTimestamp(),
        });
        tx.update(attemptRef, { status: "completed" });
        return { ok: true as const };
      });

      if (terminal.ok === false) {
        await failAttempt(`WA_TERMINAL_${terminal.reason.toUpperCase()}`, "TERMINAL_TRANSACTION");
        return res.status(409).json({ error: terminal.reason });
      }

      // Rodada final — nunca devolve phoneNumberId/wabaId ao client, mesmo
      // autenticado como owner/admin: são detalhes internos da Meta, não
      // dado sanitizado (mesmo padrão de exclusão do doc
      // integrations/whatsapp_status, ver Seção 5 do plano).
      // displayPhoneNumber já é semi-público (aparece pro paciente).
      return res.json({ status: "connected", displayPhoneNumber: candidateConfig.displayPhoneNumber });
    } catch (err: any) {
      await failAttempt("WA_EXCHANGE_UNEXPECTED_ERROR", "EXCHANGE_PROCESSING", err);
      return res.status(500).json({ error: "exchange_failed" });
    }
  });

  // GET Health endpoint — real signals for the Super Admin panel: process
  // uptime and a lightweight live Firestore Admin SDK read (not a fake
  // "99.99% uptime" badge). Kept cheap on purpose: a single limited read.
  app.get("/api/health", async (req, res) => {
    const startedAt = Date.now();
    let firestoreReachable = false;
    try {
      await adminDb.collection("clinics").limit(1).get();
      firestoreReachable = true;
    } catch (err) {
      firestoreReachable = false;
    }
    const latencyMs = Date.now() - startedAt;
    return res.json({
      ok: firestoreReachable,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      firestoreReachable,
      latencyMs,
    });
  });

  // GET Debug Admin Firestore endpoint
  app.get("/api/debug/admin-firestore", async (req, res) => {
    try {
      const googleApplicationCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS || "NOT_SET";
      const firebaseConfigEnv = process.env.FIREBASE_CONFIG || "NOT_SET";
      const getAppsLength = getApps().length;
      const projectId = "elisa-494703";

      let readResult: any = "NOT_ATTEMPTED";
      try {
        const docRef = adminDb.doc("clinics/l9GzEcXT7uhcYHgRVVhe/integrations/whatsapp");
        const docSnap = await docRef.get();
        readResult = {
          exists: docSnap.exists,
          dataKeys: docSnap.exists ? Object.keys(docSnap.data() || {}) : []
        };
      } catch (err: any) {
        readResult = {
          error: err.message || String(err),
          code: err.code,
          stack: err.stack
        };
      }

      return res.json({
        projectId,
        googleApplicationCredentials,
        firebaseConfigEnv,
        getAppsLength,
        readResult
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---- Manual configuration (rodada final de fechamento) ----
  // Único substituto autorizado dos setDoc/deleteDoc diretos que existiam
  // em NextAdmin.tsx e WhatsAppSettings.tsx — mesma regra de
  // firestore.rules (`clinics/{id}/integrations/whatsapp`:
  // allow write: if false) que já bloqueava essas escritas na prática,
  // agora com um caminho real pra configuração manual continuar
  // funcionando: só Admin SDK, só owner/admin (authenticateOwnerOrAdmin,
  // mesmo helper do Embedded Signup).
  //
  // Hardening (rodada de correção pré-teste-real): o token Meta digitado
  // manualmente aqui agora sobe como nova versão do secret
  // `eliza-wa-token-{clinicId}` (mesmo padrão de nome/versionamento
  // explícito do Embedded Signup, Seção 8 do plano) — o Firestore só
  // guarda `accessTokenSecretName`/`accessTokenSecretVersion` (referência
  // + número da versão, nunca "latest", nunca o valor). Limitação
  // conhecida, ainda deliberadamente FORA do escopo: credenciais Twilio
  // (`twilioAuthToken`) continuam gravadas em texto puro — mesmo backlog
  // já registrado antes, não migrado nesta rodada (a ELIZA só opera com
  // WhatsApp via Meta hoje).
  function sanitizeManualConfigInput(body: any) {
    const str = (v: any) => (typeof v === "string" ? v.trim() : "");
    return {
      provider: body?.provider === "twilio" ? "twilio" as const : "meta" as const,
      phoneNumberId: str(body?.phoneNumberId),
      wabaId: str(body?.wabaId),
      businessName: str(body?.businessName),
      displayPhoneNumber: str(body?.displayPhoneNumber),
      accessToken: str(body?.accessToken),
      twilioAccountSid: str(body?.twilioAccountSid),
      twilioAuthToken: str(body?.twilioAuthToken),
      twilioWhatsAppNumber: str(body?.twilioWhatsAppNumber) || "+14155238886",
      aiEnabled: body?.aiEnabled !== false,
      humanApprovalRequired: body?.humanApprovalRequired !== false,
      apiNumber: str(body?.apiNumber),
      legacyClinicNumber: str(body?.legacyClinicNumber),
      defaultSendMode: body?.defaultSendMode === "open_whatsapp" ? "open_whatsapp" as const : "eliza_api" as const,
      allowOpenExternalWhatsApp: body?.allowOpenExternalWhatsApp !== false,
    };
  }

  app.get("/api/whatsapp/manual-config", async (req, res) => {
    const auth = await authenticateOwnerOrAdmin(req);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.code });
    try {
      const [integrationSnap, configSnap] = await Promise.all([
        adminDb.doc(`clinics/${auth.clinicId}/integrations/whatsapp`).get(),
        adminDb.doc(`clinics/${auth.clinicId}/whatsapp_settings/config`).get(),
      ]);
      const integration: any = integrationSnap.exists ? integrationSnap.data() : null;
      const config: any = configSnap.exists ? configSnap.data() : null;
      // hasAccessToken/hasTwilioAuthToken: só presença, nunca o valor —
      // é o que o form usa pra decidir se mostra a máscara "••••".
      return res.json({
        status: integration?.status || "não conectado",
        provider: integration?.provider === "twilio" ? "twilio" : "meta",
        phoneNumberId: integration?.phoneNumberId || "",
        wabaId: integration?.wabaId || "",
        businessName: integration?.businessName || "",
        displayPhoneNumber: integration?.displayPhoneNumber || "",
        hasAccessToken: !!integration?.accessTokenSecretName,
        twilioAccountSid: integration?.twilioAccountSid || "",
        hasTwilioAuthToken: !!integration?.twilioAuthToken,
        twilioWhatsAppNumber: integration?.twilioWhatsAppNumber || "+14155238886",
        aiEnabled: integration?.aiEnabled !== false,
        humanApprovalRequired: integration?.humanApprovalRequired !== false,
        apiNumber: config?.apiNumber || "",
        legacyClinicNumber: config?.legacyClinicNumber || "",
        defaultSendMode: config?.defaultSendMode || "eliza_api",
        allowOpenExternalWhatsApp: config?.allowOpenExternalWhatsApp !== false,
      });
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_MANUAL_CONFIG", errorCode: "WA_MANUAL_CONFIG_READ_FAILED", phase: "READ", ref: auth.clinicId, err });
      return res.status(500).json({ error: "manual_config_read_failed" });
    }
  });

  app.post("/api/whatsapp/manual-config", async (req, res) => {
    const auth = await authenticateOwnerOrAdmin(req);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.code });
    try {
      const input = sanitizeManualConfigInput(req.body);
      const integrationRef = adminDb.doc(`clinics/${auth.clinicId}/integrations/whatsapp`);
      const existingSnap = await integrationRef.get();
      const existingData: any = existingSnap.exists ? existingSnap.data() : {};

      // Twilio: fora de escopo desta rodada (backlog explícito já
      // registrado no plano original, Seção 15) — token mascarado
      // ("••••") continua significando "não alterar", preserva o valor
      // já salvo.
      const twilioAuthToken = input.twilioAuthToken.includes("••••") ? (existingData.twilioAuthToken || "") : input.twilioAuthToken;

      // Meta: hardening desta rodada — accessToken NUNCA é gravado bruto
      // no Firestore. Só a REFERÊNCIA do secret (nome fixo por clínica,
      // mesmo padrão já usado pelo /exchange — server.ts, secretName =
      // `eliza-wa-token-${clinicId}`) + o número EXPLÍCITO da versão nova
      // (nunca "latest", plano Seção 8) são persistidos. "••••" continua
      // significando "não alterar" — preserva nome+versão já salvos, sem
      // tocar o Secret Manager. String vazia limpa a referência (Twilio
      // já tinha essa semântica; agora replicada aqui). Qualquer outra
      // string é o token de verdade — sobe como nova versão ANTES de
      // qualquer escrita no Firestore; se o Secret Manager falhar (ex.:
      // secret ainda não provisionado), a requisição inteira falha — a
      // integração nunca fica num estado "conectado" apontando pra uma
      // versão que não existe.
      let accessTokenSecretName = existingData.accessTokenSecretName || "";
      let accessTokenSecretVersion: string | null = existingData.accessTokenSecretVersion ?? null;
      if (input.provider === "meta") {
        if (input.accessToken.includes("••••")) {
          // não alterar — mantém nome+versão já salvos.
        } else if (input.accessToken === "") {
          accessTokenSecretName = "";
          accessTokenSecretVersion = null;
        } else {
          const secretName = `eliza-wa-token-${auth.clinicId}`;
          let versionResult;
          try {
            versionResult = await getSecretManagerClient().addSecretVersion(secretName, input.accessToken);
          } catch (err: any) {
            logSanitizedWaError({ scope: "WA_MANUAL_CONFIG", errorCode: "WA_MANUAL_CONFIG_SECRET_VERSION_FAILED", phase: "SECRET_VERSION", ref: auth.clinicId, err });
            return res.status(500).json({ error: "secret_version_failed" });
          }
          accessTokenSecretName = secretName;
          accessTokenSecretVersion = versionResult.versionId;
        }
      }

      const isConnected = input.provider === "twilio"
        ? !!(input.twilioAccountSid && twilioAuthToken && input.twilioWhatsAppNumber)
        : !!(input.phoneNumberId && input.wabaId && accessTokenSecretName && accessTokenSecretVersion);

      const payload: any = {
        status: isConnected ? "conectado" : "não conectado",
        provider: input.provider,
        connectionMethod: "manual",
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        businessName: input.businessName,
        displayPhoneNumber: input.displayPhoneNumber,
        accessTokenSecretName,
        accessTokenSecretVersion,
        twilioAccountSid: input.twilioAccountSid,
        twilioAuthToken,
        twilioWhatsAppNumber: input.twilioWhatsAppNumber,
        aiEnabled: input.aiEnabled,
        humanApprovalRequired: input.humanApprovalRequired,
        updatedAt: AdminFieldValue.serverTimestamp(),
      };
      if (!existingData.createdAt) payload.createdAt = AdminFieldValue.serverTimestamp();

      await integrationRef.set(payload, { merge: true });

      await adminDb.doc(`clinics/${auth.clinicId}/integrations/whatsapp_status`).set({
        status: payload.status,
        provider: payload.provider,
        displayPhoneNumber: payload.displayPhoneNumber,
        updatedAt: AdminFieldValue.serverTimestamp(),
      }, { merge: true });

      await adminDb.doc(`clinics/${auth.clinicId}/whatsapp_settings/config`).set({
        apiNumber: input.apiNumber,
        legacyClinicNumber: input.legacyClinicNumber,
        defaultSendMode: input.defaultSendMode,
        allowOpenExternalWhatsApp: input.allowOpenExternalWhatsApp,
        updatedAt: AdminFieldValue.serverTimestamp(),
      }, { merge: true });

      await adminDb.collection(`clinics/${auth.clinicId}/integration_logs`).add({
        type: "whatsapp", action: "save_config", status: "success",
        message: "Configurações de integração atualizadas e salvas pela equipe.",
        createdAt: AdminFieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, status: payload.status });
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_MANUAL_CONFIG", errorCode: "WA_MANUAL_CONFIG_SAVE_FAILED", phase: "SAVE", ref: auth.clinicId, err });
      return res.status(500).json({ error: "manual_config_save_failed" });
    }
  });

  app.post("/api/whatsapp/manual-disconnect", async (req, res) => {
    const auth = await authenticateOwnerOrAdmin(req);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.code });
    try {
      await adminDb.doc(`clinics/${auth.clinicId}/integrations/whatsapp`).delete();
      await adminDb.doc(`clinics/${auth.clinicId}/integrations/whatsapp_status`).set({
        status: "não conectado", provider: null, displayPhoneNumber: null,
        updatedAt: AdminFieldValue.serverTimestamp(),
      }, { merge: true });
      await adminDb.collection(`clinics/${auth.clinicId}/integration_logs`).add({
        type: "whatsapp", action: "disconnect", status: "success",
        message: "A integração com WhatsApp foi desativada e desconectada manualmente.",
        createdAt: AdminFieldValue.serverTimestamp(),
      });
      return res.json({ ok: true });
    } catch (err: any) {
      logSanitizedWaError({ scope: "WA_MANUAL_CONFIG", errorCode: "WA_MANUAL_DISCONNECT_FAILED", phase: "DISCONNECT", ref: auth.clinicId, err });
      return res.status(500).json({ error: "manual_disconnect_failed" });
    }
  });

  // Shared outbound dispatch — used by the manual "/api/whatsapp/send" route
  // below AND by the AI auto-reply path (whatsappWebhookPostHandler), so both
  // write the exact same message/conversation/log shape. `sentBy`/`aiGenerated`
  // let the caller mark AI-authored replies distinctly from staff-typed ones.
  async function dispatchAndRecordOutboundWhatsAppMessage({
    clinicId, conversationId, text, sentByUserId, sentByName, source, sentBy, aiGenerated,
  }: {
    clinicId: string; conversationId: string; text: string;
    sentByUserId?: string | null; sentByName?: string | null; source?: string;
    sentBy?: "human" | "ai"; aiGenerated?: boolean;
  }): Promise<{ success: boolean; error?: string; errorCode?: any; metaResponse?: any; metaStatus?: any; waId?: any; messageId?: string }> {
    try {
      const integrationPath = `clinics/${clinicId}/integrations/whatsapp`;
      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "integration_read", clinicId, ref: conversationId });
      const integrationRef = adminDb.doc(integrationPath);
      const integrationSnap = await integrationRef.get();
      const integrationData: any = integrationSnap.data() || {};

      if (!integrationSnap.exists) {
        return { success: false, error: "A integração com WhatsApp não está configurada para esta clínica." };
      }

      const provider = integrationData.provider === "twilio" ? "twilio" : "meta";
      const displayPhoneNumber = integrationData.displayPhoneNumber || integrationData.twilioWhatsAppNumber || "Clínica";
      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "send_requested", clinicId, ref: conversationId, extra: { provider } });

      const dispatchResult = await sendWhatsAppMessage(integrationData, conversationId, text);

      let whatsappMessageId = dispatchResult.providerMessageId || "msg_failed_" + Date.now();
      let metaResponse: any = null; // corpo cru da Graph nunca chega aqui — ver sendViaMeta/whatsappGraphClient.ts.
      let errorCode: any = dispatchResult.success ? null : (dispatchResult.errorCode || "unknown_error");
      let errorMessage: any = dispatchResult.success ? null : (dispatchResult.errorMessage || "Erro desconhecido na chamada do provedor.");
      let metaStatus: any = null;
      let waId: any = (dispatchResult as any).waId || null;

      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: dispatchResult.success ? "send_dispatch_succeeded" : "send_dispatch_failed", clinicId, ref: conversationId, extra: { provider, errorCode: errorCode ? String(errorCode) : null } });

      const isSuccess = !errorCode;
      const messageId = "msg_" + Date.now().toString() + Math.random().toString(36).substring(2, 5);
      const msgPath = `clinics/${clinicId}/whatsapp_conversations/${conversationId}/messages/${messageId}`;

      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "message_doc_write", clinicId, ref: conversationId });
      const msgRef = adminDb.doc(msgPath);

      try {
        await msgRef.set({
          direction: "outbound",
          text,
          timestamp: AdminFieldValue.serverTimestamp(),
          from: displayPhoneNumber,
          to: conversationId,
          whatsappMessageId: isSuccess ? whatsappMessageId : "msg_failed_" + Date.now(),
          status: isSuccess ? "sent" : "failed",
          aiGenerated: !!aiGenerated,
          sentBy: sentBy || "human",
          sentByUserId: sentByUserId || null,
          sentByName: sentByName || null,
          source: source || "manual",
          errorCode: errorCode || null,
          errorMessage: errorMessage || null,
          metaResponse: metaResponse || null,
          metaStatus: metaStatus || null,
          waId: waId || null
        });
        logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "message_doc_saved", clinicId, ref: conversationId, extra: { success: isSuccess } });
      } catch (dbErr: any) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_MESSAGE_DOC_SAVE_FAILED", phase: "MESSAGE_DOC_SAVE", ref: conversationId, err: dbErr });
      }

      const convoPath = `clinics/${clinicId}/whatsapp_conversations/${conversationId}`;
      logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "conversation_doc_update", clinicId, ref: conversationId });
      const convoRef = adminDb.doc(convoPath);
      try {
        await convoRef.set({
          lastMessage: text,
          lastMessageAt: AdminFieldValue.serverTimestamp(),
          lastOutboundAt: AdminFieldValue.serverTimestamp(),
          unreadCount: 0,
          status: isSuccess ? "finalizado" : "pendente"
        }, { merge: true });
      } catch (dbErr: any) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_CONVERSATION_DOC_UPDATE_FAILED", phase: "CONVERSATION_DOC_UPDATE", ref: conversationId, err: dbErr });
      }

      try {
        const logsPath = `clinics/${clinicId}/integration_logs`;
        logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "integration_log_write", clinicId, ref: conversationId });
        const logsColl = adminDb.collection(logsPath);
        await logsColl.add({
          type: "whatsapp",
          action: "message_sent",
          status: isSuccess ? "success" : "error",
          recipient: conversationId,
          message: isSuccess
            ? `Mensagem${aiGenerated ? " (IA)" : ""} enviada com sucesso para ${conversationId}: "${text.substring(0, 45)}..."`
            : `Falha no envio de mensagem${aiGenerated ? " (IA)" : ""} para ${conversationId}: ${errorMessage}`,
          errorCode: errorCode || null,
          errorMessage: errorMessage || null,
          metaResponse: metaResponse || null,
          createdAt: AdminFieldValue.serverTimestamp()
        });
      } catch (logErr) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_INTEGRATION_LOG_FAILED", phase: "INTEGRATION_LOG", ref: conversationId, err: logErr });
      }

      if (!isSuccess) {
        return { success: false, error: errorMessage, errorCode, metaResponse, metaStatus, messageId: whatsappMessageId };
      }

      return { success: true, messageId: whatsappMessageId, metaResponse, metaStatus, waId };
    } catch (error: any) {
      logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_ENDPOINT_THREW", phase: "OUTER_HANDLER", ref: conversationId, err: error });

      try {
        const logsPath = `clinics/${clinicId}/integration_logs`;
        logSanitizedWaInfo({ scope: "WA_OUTBOUND", event: "integration_log_write_after_error", clinicId, ref: conversationId });
        const logsColl = adminDb.collection(logsPath);
        await logsColl.add({
          type: "whatsapp",
          action: "message_sent",
          status: "error",
          message: `Falha no envio de mensagem para ${conversationId}: ${error.message || String(error)}`,
          createdAt: AdminFieldValue.serverTimestamp()
        });
      } catch (logErr) {
        logSanitizedWaError({ scope: "WA_OUTBOUND", errorCode: "WA_SEND_INTEGRATION_LOG_AFTER_ERROR_FAILED", phase: "INTEGRATION_LOG", ref: conversationId, err: logErr });
      }

      return { success: false, error: error.message || "Erro interno ao processar envio de mensagem." };
    }
  }

  // POST Outbound Secure Sending API
  app.post("/api/whatsapp/send", async (req, res) => {
    const { clinicId, conversationId, text, sentByUserId, sentByName, source } = req.body;

    if (!clinicId || !conversationId || !text) {
      return res.status(400).json({ error: "Parâmetros clinicId, conversationId e text são requeridos." });
    }

    const result = await dispatchAndRecordOutboundWhatsAppMessage({
      clinicId, conversationId, text, sentByUserId, sentByName, source, sentBy: "human", aiGenerated: false,
    });

    if (!result.success) {
      return res.status(result.error === "A integração com WhatsApp não está configurada para esta clínica." ? 400 : (result.errorCode ? 400 : 500)).json({
        error: result.error, errorCode: result.errorCode, metaResponse: result.metaResponse, metaStatus: result.metaStatus, success: false,
      });
    }

    return res.json({ success: true, messageId: result.messageId, metaResponse: result.metaResponse, metaStatus: result.metaStatus, waId: result.waId });
  });

  app.post("/api/whatsapp/send-summary", async (req, res) => {
    const { clinicId, staffId, sendToAll } = req.body;
    if (!clinicId) {
      return res.status(400).json({ error: "Faltando clinicId." });
    }

    try {
      let recipients: any[] = [];
      
      if (sendToAll) {
        // Fetch all staff members under staff_whatsapp_access
        const colSnap = await adminDb.collection(`clinics/${clinicId}/staff_whatsapp_access`).get();
        recipients = colSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        if (!staffId) {
          return res.status(400).json({ error: "Faltando staffId para teste individual." });
        }
        const docRef = adminDb.doc(`clinics/${clinicId}/staff_whatsapp_access/${staffId}`);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          return res.status(404).json({ error: "Colaborador não cadastrado no módulo ELIZA Interna." });
        }
        recipients = [{ id: docSnap.id, ...docSnap.data() }];
      }

      if (recipients.length === 0) {
        return res.status(200).json({ success: true, results: {}, message: "Nenhum colaborador cadastrado." });
      }

      const results: { [name: string]: { status: "sucesso" | "falha", detail?: string } } = {};
      const sampa = getSampaDate();

      for (const staffData of recipients) {
        const staffName = staffData.name || staffData.id || "Sem Nome";
        const phoneRaw = staffData.phoneNormalized || staffData.phone || "";
        const cleanPhone = normalizeWhatsAppPhone(phoneRaw);
        
        let shouldSend = true;
        let skipReason = "";

        if (staffData.active !== true) {
          shouldSend = false;
          skipReason = "Colaborador está inativo (active == false).";
        } else if (staffData.authorized !== true) {
          shouldSend = false;
          skipReason = "Não autorizado (authorized != true).";
        } else if (staffData.dailySummaryEnabled !== true) {
          shouldSend = false;
          skipReason = "Resumo diário desabilitado (dailySummaryEnabled == false).";
        } else if (!cleanPhone) {
          shouldSend = false;
          skipReason = "Nenhum número de telefone celular cadastrado.";
        } else if (!(cleanPhone.startsWith("55") && cleanPhone.length >= 12 && cleanPhone.length <= 13)) {
          shouldSend = false;
          skipReason = `DDI ou tamanho de telefone inválido (${cleanPhone || 'ausente'}). Formato esperado: 55 + DDD + 9 ou 8 dígitos.`;
        }

        // Log exactly as requested in [DAILY SUMMARY RECIPIENT] format
        console.log(`[DAILY SUMMARY RECIPIENT] name="${staffName}" phone="${staffData.phone || ''}" phoneNormalized="${cleanPhone}" active=${staffData.active === true} authorized=${staffData.authorized === true} dailySummaryEnabled=${staffData.dailySummaryEnabled === true} allowedCommands=${JSON.stringify(staffData.allowedCommands || [])} shouldSend=${shouldSend} skipReason="${skipReason}"`);

        if (!shouldSend) {
          results[staffName] = { status: "falha", detail: skipReason };
          continue;
        }

        try {
          // Generate customized operational summaries
          const summaryText = await generatePersonalizedSummary(clinicId, staffData, sampa);

          // Format with Gemini if key is present
          let formattedText = summaryText;
          const apiKey = process.env.GEMINI_API_KEY;
          if (apiKey && !apiKey.startsWith("••••") && apiKey !== "test_token" && apiKey.length >= 15) {
            try {
              const ai = new GoogleGenAI({ apiKey });
              const aiResponse = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: `Você é ELIZA, a assistente oficial da clínica. Reescreva o seguinte resumo matinal de maneira extremamente acolhedora, profissional, estilosa e engajadora para WhatsApp. Utilize markdown do WhatsApp (como *negrito*, _itálico_) e emojis adequadamente. Mantenha impecavelmente todos os dados inseridos (nomes dos pacientes, horários, receitas, despesas, etc.).
                
Original:
${summaryText}

Gere o resumo formatado:`,
              });
              if (aiResponse.text) {
                formattedText = aiResponse.text.trim();
              }
            } catch (aiErr) {
              console.warn("[ELIZA_INTERNA] Call to Gemini failed for manual summary formatting:", aiErr);
            }
          }

          // Real transmission using dispatchWhatsAppMessage
          const dispatchResult = await dispatchWhatsAppMessage(clinicId, cleanPhone, formattedText);
          
          if (dispatchResult.success) {
            results[staffName] = { status: "sucesso" };
            
            // Log command
            const commandId = "summary_" + Date.now().toString() + Math.random().toString(36).substring(2, 5);
            await adminDb.collection(`clinics/${clinicId}/staff_commands`).doc(commandId).set({
              fromPhone: cleanPhone,
              staffId: staffData.id,
              professionalId: staffData.professionalId || 'not-assigned',
              rawMessage: "[Resumo Diário Manual: " + (sendToAll ? "Coletivo" : "Individual") + "]",
              intent: "DAILY_SUMMARY_DISPATCH",
              status: "success",
              response: formattedText,
              whatsappMessageId: dispatchResult.whatsappMessageId || null,
              createdAt: AdminFieldValue.serverTimestamp()
            });

            // Log integration
            await adminDb.collection(`clinics/${clinicId}/integration_logs`).add({
              type: "whatsapp",
              action: "staff_summary_sent",
              status: "success",
              message: `Resumo diário enviado com sucesso para ${staffName} (${cleanPhone})`,
              createdAt: AdminFieldValue.serverTimestamp()
            });

            // Save to clinics/{clinicId}/automation_logs as requested by Task 6
            await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
              type: "daily_summary",
              recipientName: staffName,
              recipientPhone: cleanPhone,
              status: "success",
              errorMessage: null,
              timestamp: AdminFieldValue.serverTimestamp()
            });
          } else {
            // Suggest Meta Cloud API Template approval if failed due to templates or 24h limits
            const metaErrDesc = dispatchResult.errorMessage || "Status de retorno inválido da Meta.";
            const finalErrDetail = `${metaErrDesc}. Dica: Se fora da janela de 24h, aprove um Template da Meta.`;
            results[staffName] = { status: "falha", detail: finalErrDetail };

            // Log error
            const commandId = "summary_err_" + Date.now().toString();
            await adminDb.collection(`clinics/${clinicId}/staff_commands`).doc(commandId).set({
              fromPhone: cleanPhone,
              staffId: staffData.id,
              professionalId: staffData.professionalId || 'not-assigned',
              rawMessage: "[Resumo Diário Manual: Falhou]",
              intent: "DAILY_SUMMARY_DISPATCH",
              status: "error",
              errorMessage: metaErrDesc,
              createdAt: AdminFieldValue.serverTimestamp()
            });

            await adminDb.collection(`clinics/${clinicId}/integration_logs`).add({
              type: "whatsapp",
              action: "staff_summary_failed",
              status: "error",
              message: `Falha ao transmitir resumo para ${staffName} (${cleanPhone}): ${metaErrDesc}`,
              createdAt: AdminFieldValue.serverTimestamp()
            });

            // Log to clinics/{clinicId}/automation_logs
            await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
              type: "daily_summary",
              recipientName: staffName,
              recipientPhone: cleanPhone,
              status: "error",
              errorMessage: metaErrDesc,
              timestamp: AdminFieldValue.serverTimestamp()
            });
          }
        } catch (innerErr: any) {
          results[staffName] = { status: "falha", detail: innerErr.message || "Erro no processamento interno." };
          
          await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
            type: "daily_summary",
            recipientName: staffName,
            recipientPhone: cleanPhone,
            status: "error",
            errorMessage: innerErr.message || "Erro de processamento interno",
            timestamp: AdminFieldValue.serverTimestamp()
          });
        }
      }

      return res.json({ success: true, results });
    } catch (err: any) {
      console.error("[ELIZA_INTERNA_SEND_SUMMARY] Error:", err);
      return res.status(500).json({ error: err.message || "Erro ao disparar resumo diário." });
    }
  });

  // Helper to verify scheduler secret token (Part 3)
  const verifySchedulerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader ? authHeader.replace("Bearer ", "").trim() : "";
    const expectedToken = process.env.SCHEDULER_SECRET_TOKEN || "test_scheduler_token";
    
    if (!token || token !== expectedToken) {
      console.warn("[SCHEDULER_AUTH_FAILED] Received token:", token);
      return res.status(401).json({ error: "Não autorizado. Token de segurança de agendamento inválido." });
    }
    next();
  };

  // POST /api/internal/scheduler/run-daily-summaries (Part 3)
  app.post("/api/internal/scheduler/run-daily-summaries", verifySchedulerAuth, async (req, res) => {
    console.log("[SCHEDULER] Running daily summaries scheduled task...");
    try {
      const clinicsSnap = await adminDb.collection("clinics").get();
      let totalDispatched = 0;
      
      for (const clinicDoc of clinicsSnap.docs) {
        const clinicId = clinicDoc.id;
        const staffAccessSnap = await adminDb.collection(`clinics/${clinicId}/staff_whatsapp_access`).get();
          
        for (const staffDoc of staffAccessSnap.docs) {
          const staffData = staffDoc.data();
          const staffName = staffData.name || staffDoc.id;
          const phoneRaw = staffData.phoneNormalized || staffData.phone || "";
          const cleanPhone = normalizeWhatsAppPhone(phoneRaw);
          
          let shouldSend = true;
          let skipReason = "";

          if (staffData.active !== true) {
            shouldSend = false;
            skipReason = "Colaborador está inativo (active == false).";
          } else if (staffData.authorized !== true) {
            shouldSend = false;
            skipReason = "Não autorizado (authorized != true).";
          } else if (staffData.dailySummaryEnabled !== true) {
            shouldSend = false;
            skipReason = "Resumo diário desabilitado (dailySummaryEnabled == false).";
          } else if (!cleanPhone) {
            shouldSend = false;
            skipReason = "Nenhum número de telefone celular cadastrado.";
          } else if (!(cleanPhone.startsWith("55") && cleanPhone.length >= 12 && cleanPhone.length <= 13)) {
            shouldSend = false;
            skipReason = `DDI ou tamanho de telefone inválido (${cleanPhone || 'ausente'}). Formato esperado: 55 + DDD + 9 ou 8 dígitos.`;
          }

          // Log exactly as requested in [DAILY SUMMARY RECIPIENT] format
          console.log(`[DAILY SUMMARY RECIPIENT] name="${staffName}" phone="${staffData.phone || ''}" phoneNormalized="${cleanPhone}" active=${staffData.active === true} authorized=${staffData.authorized === true} dailySummaryEnabled=${staffData.dailySummaryEnabled === true} allowedCommands=${JSON.stringify(staffData.allowedCommands || [])} shouldSend=${shouldSend} skipReason="${skipReason}"`);

          if (shouldSend) {
            const sampa = getSampaDate();
            const summaryText = await generatePersonalizedSummary(clinicId, staffData, sampa);
            
            // Apply Gemini Polish
            let polishedText = summaryText;
            const apiKey = process.env.GEMINI_API_KEY;
            if (apiKey && !apiKey.startsWith("••••") && apiKey !== "test_token" && apiKey.length >= 15) {
              try {
                const ai = new GoogleGenAI({ apiKey });
                const response = await ai.models.generateContent({
                  model: "gemini-3.5-flash",
                  contents: `Você é ELIZA, a assistente oficial de WhatsApp interna para os profissionais da clínica. Reescreva a seguinte mensagem estruturada para que soe muito cordial, profissional, calorosa, estilosa e polida, perfeitamente adequada para WhatsApp. Use markdown (como *negrito*, _itálico_) e emojis apropriadamente.
                  IMPORTANTE: Não mude nem exclua nenhum dos nomes, horários, quantidades, valores ou prazos presentes na mensagem.
                  
Mensagem original:
${summaryText}

Versão polida por ELIZA:`,
                });
                if (response.text) {
                  polishedText = response.text.trim();
                }
              } catch (err) {
                console.warn("[SCHEDULER_DAILY] Failed polishing response with Gemini, sending fallback:", err);
              }
            }
            
            const dispatchResult = await dispatchWhatsAppMessage(clinicId, cleanPhone, polishedText);
            if (dispatchResult.success) {
              totalDispatched++;
              const commandId = "sched_summary_" + Date.now().toString() + Math.random().toString(36).substring(2, 5);
              await adminDb.collection(`clinics/${clinicId}/staff_commands`).doc(commandId).set({
                fromPhone: "system-scheduler",
                staffId: staffDoc.id,
                professionalId: staffData.professionalId || 'not-assigned',
                rawMessage: "[Agendador Diário Automático]",
                intent: "GET_DAILY_SUMMARY",
                status: "success",
                response: polishedText,
                whatsappMessageId: dispatchResult.whatsappMessageId || null,
                createdAt: AdminFieldValue.serverTimestamp()
              });
              await adminDb.collection(`clinics/${clinicId}/integration_logs`).add({
                type: "whatsapp",
                action: "scheduler_summary_dispatched",
                status: "success",
                message: `Resumo diário automático enviado via agendador com sucesso para ${staffData.name}.`,
                createdAt: AdminFieldValue.serverTimestamp()
              });
              
              // Also log to automation_logs in scheduler
              await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
                type: "daily_summary",
                recipientName: staffName,
                recipientPhone: cleanPhone,
                status: "success",
                errorMessage: null,
                timestamp: AdminFieldValue.serverTimestamp()
              });
            } else {
              // Log meta error on failure
              await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
                type: "daily_summary",
                recipientName: staffName,
                recipientPhone: cleanPhone,
                status: "error",
                errorMessage: dispatchResult.errorMessage || "Falha Meta API",
                timestamp: AdminFieldValue.serverTimestamp()
              });
            }
          } else {
            // Log skipped to automation_logs
            await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
              type: "daily_summary",
              recipientName: staffName,
              recipientPhone: cleanPhone,
              status: "error",
              errorMessage: `Ignorado: ${skipReason}`,
              timestamp: AdminFieldValue.serverTimestamp()
            });
          }
        }
      }
      return res.json({ success: true, message: `Disparador de resumo diário automático finalizado. Total de envios: ${totalDispatched}` });
    } catch (err: any) {
      console.error("[SCHEDULER_DAILY_ERROR] Failed:", err);
      return res.status(500).json({ error: err.message || "Erro no agendador de resumo." });
    }
  });

  // POST /api/internal/scheduler/run-surgery-alerts (Part 3)
  app.post("/api/internal/scheduler/run-surgery-alerts", verifySchedulerAuth, async (req, res) => {
    console.log("[SCHEDULER] Running surgery alerts scheduled task...");
    try {
      const clinicsSnap = await adminDb.collection("clinics").get();
      let totalDispatched = 0;
      
      const sampa = getSampaDate();
      const sampaTomorrow = new Date(sampa.getTime() + 24 * 60000 * 60);
      const tomorrowStr = sampaTomorrow.toISOString().split("T")[0];
      const surgeryTerms = ["cirurgia", "implante", "siso", "extração", "cirúrgico", "surgery"];

      for (const clinicDoc of clinicsSnap.docs) {
        const clinicId = clinicDoc.id;
        const apptsSnap = await adminDb.collection(`clinics/${clinicId}/appointments`)
          .where("date", "==", tomorrowStr)
          .get();
        const allAppointments = apptsSnap.docs.map(doc => doc.data());

        const surgeryAppointments = allAppointments.filter((apt: any) => {
          const proc = String(apt.procedure || "").toLowerCase();
          return surgeryTerms.some(term => proc.includes(term));
        });

        if (surgeryAppointments.length === 0) {
          continue;
        }

        const staffAccessSnap = await adminDb.collection(`clinics/${clinicId}/staff_whatsapp_access`)
          .where("active", "==", true)
          .get();
          
        for (const staffDoc of staffAccessSnap.docs) {
          const staffData = staffDoc.data();
          const cleanPhone = (staffData.phoneNormalized || staffData.phone || "").replace(/\D/g, "");
          if (!cleanPhone) continue;

          if (staffData.allowSurgeryAlerts !== false) {
            const filterByProfessional = (staffData.role !== 'Dono' && staffData.role !== 'Gerente' && staffData.professionalId && staffData.professionalId !== 'not-assigned');
            let staffSurgeries = surgeryAppointments;
            if (filterByProfessional) {
              staffSurgeries = surgeryAppointments.filter((apt: any) => apt.staffId === staffData.professionalId);
            }

            if (staffSurgeries.length > 0) {
              let alertText = `🚨 *Alerta de Cirurgias Amanhã (${tomorrowStr})* 🦷\n\nOlá, ${staffData.name}.\nIdentificamos as seguintes cirurgias sob sua responsabilidade ou acompanhamento amanhã:\n\n`;
              staffSurgeries.forEach((apt: any, idx: number) => {
                alertText += `${idx + 1}. *Atendimento às ${apt.time}* - Paciente: ${apt.patientName}\n   Procedimento: _${apt.procedure || 'Cirurgia'}_ (Prof. Resp: ${apt.staffName || 'Doutor'})\n\n`;
              });
              alertText += `⚠️ *Lembrete Importante:* Certifique-se de validar se o bochecho pré-operatório, exames de sangue, tomografias, instrumentais esterilizados de implante ou próteses estão na sala cirúrgica pré-separados!`;

              const dispatchResult = await dispatchWhatsAppMessage(clinicId, cleanPhone, alertText);
              if (dispatchResult.success) {
                totalDispatched++;
                await adminDb.collection(`clinics/${clinicId}/integration_logs`).add({
                  type: "whatsapp",
                  action: "scheduler_surgery_dispatched",
                  status: "success",
                  message: `Alerta automático de cirurgias enviado para ${staffData.name}.`,
                  createdAt: AdminFieldValue.serverTimestamp()
                });
              }
            }
          }
        }
      }
      return res.json({ success: true, message: `Disparador de alertas cirúrgicos concluído. Total de envios: ${totalDispatched}` });
    } catch (err: any) {
      console.error("[SCHEDULER_SURGERY_ERROR] Failed:", err);
      return res.status(500).json({ error: err.message || "Erro no agendador de cirurgias." });
    }
  });

  // POST /api/internal/scheduler/run-pending-tasks (Part 3)
  app.post("/api/internal/scheduler/run-pending-tasks", verifySchedulerAuth, async (req, res) => {
    console.log("[SCHEDULER] Running pending tasks scheduled alert task...");
    try {
      const clinicsSnap = await adminDb.collection("clinics").get();
      let totalDispatched = 0;
      
      const sampa = getSampaDate();
      const todayStr = sampa.toISOString().split("T")[0];

      for (const clinicDoc of clinicsSnap.docs) {
        const clinicId = clinicDoc.id;
        const tasksSnap = await adminDb.collection(`clinics/${clinicId}/pending_items`)
          .where("status", "==", "pending")
          .get();
        const pendingTasks = tasksSnap.docs.map(doc => doc.data());

        const urgentTasks = pendingTasks.filter((t: any) => t.priority === "Alta");
        if (urgentTasks.length === 0) {
          continue;
        }

        const staffAccessSnap = await adminDb.collection(`clinics/${clinicId}/staff_whatsapp_access`)
          .where("active", "==", true)
          .get();
          
        for (const staffDoc of staffAccessSnap.docs) {
          const staffData = staffDoc.data();
          const cleanPhone = (staffData.phoneNormalized || staffData.phone || "").replace(/\D/g, "");
          if (!cleanPhone) continue;

          if (staffData.allowTaskReminders !== false) {
            let listText = `⚠️ *Lembrete de Tarefas Urgentes Pendentes* 🚨\n\nOlá, ${staffData.name}.\nIdentificamos as seguintes pendências de prioridade ALTA em aberto na clínica hoje (${todayStr}):\n\n`;
            urgentTasks.forEach((t: any, idx: number) => {
              listText += `📌 ${idx + 1}. *${t.title}*\n`;
              if (t.description) listText += `   _${t.description}_\n`;
              listText += `\n`;
            });
            listText += `\nSolicitamos que as tarefas acima sejam revisadas e atualizadas no painel administrativo a fim de manter a coordenação clínica perfeita!`;

            const dispatchResult = await dispatchWhatsAppMessage(clinicId, cleanPhone, listText);
            if (dispatchResult.success) {
              totalDispatched++;
              await adminDb.collection(`clinics/${clinicId}/integration_logs`).add({
                type: "whatsapp",
                action: "scheduler_tasks_dispatched",
                status: "success",
                message: `Alerta automático de tarefas pendentes enviado para ${staffData.name}.`,
                createdAt: AdminFieldValue.serverTimestamp()
              });
            }
          }
        }
      }
      return res.json({ success: true, message: `Disparador de alertas de pendências urgentes concluído. Total de envios: ${totalDispatched}` });
    } catch (err: any) {
      console.error("[SCHEDULER_TASKS_ERROR] Failed:", err);
      return res.status(500).json({ error: err.message || "Erro no agendador de tarefas pendentes." });
    }
  });

  // POST /api/internal/scheduler/run-appointment-delay-check
  // Acompanhamento de atraso da Agenda (sem WhatsApp por enquanto — só
  // Central de Tarefas/pending_items, como pedido explicitamente pelo
  // usuário enquanto a Meta ainda bloqueia o WhatsApp). Pra cada clínica,
  // agendamentos de hoje cujo horário já passou (10-70min de janela — não
  // fica gerando pra sempre um atraso muito antigo) e o status nunca saiu
  // de pendente/confirmado ganham UM pending_item pedindo confirmação —
  // ID determinístico (`agenda_delay_{appointmentId}`) garante que rodar
  // este job de novo nunca duplica a mesma pendência.
  // Não wireado a nenhum cron ainda — precisa de um Cloud Scheduler job real
  // (API nem habilitada neste projeto GCP ainda), decisão separada do usuário.
  app.post("/api/internal/scheduler/run-appointment-delay-check", verifySchedulerAuth, async (req, res) => {
    console.log("[SCHEDULER] Running appointment delay check...");
    try {
      const sampa = getSampaDate();
      const todayStr = sampa.toISOString().split("T")[0];
      const nowMinutes = sampa.getHours() * 60 + sampa.getMinutes();
      const DELAY_MIN_THRESHOLD = 10;
      const DELAY_MAX_WINDOW = 70;
      const UNSTARTED_STATUSES = new Set(["pendente", "confirmado"]);

      const clinicsSnap = await adminDb.collection("clinics").get();
      let created = 0;

      for (const clinicDoc of clinicsSnap.docs) {
        const clinicId = clinicDoc.id;
        const apptsSnap = await adminDb.collection(`clinics/${clinicId}/appointments`)
          .where("date", "==", todayStr)
          .get();

        for (const apptDoc of apptsSnap.docs) {
          const appt: any = apptDoc.data();
          const status = String(appt.status || "pendente").toLowerCase();
          if (!UNSTARTED_STATUSES.has(status)) continue;

          const [h, m] = String(appt.time || "00:00").split(":").map((n: string) => parseInt(n, 10) || 0);
          const apptMinutes = h * 60 + m;
          const delayMinutes = nowMinutes - apptMinutes;
          if (delayMinutes < DELAY_MIN_THRESHOLD || delayMinutes > DELAY_MAX_WINDOW) continue;

          const dedupeRef = adminDb.doc(`clinics/${clinicId}/pending_items/agenda_delay_${apptDoc.id}`);
          const existing = await dedupeRef.get();
          if (existing.exists) continue;

          await dedupeRef.set({
            type: "agenda_delay_check",
            title: `Paciente ${appt.patientName || "sem nome"} está em atendimento?`,
            description: `Agendamento de ${appt.treatment || "atendimento"} marcado para ${appt.time} ainda consta como "${status}" ${delayMinutes} minuto(s) depois do horário. Confirme se o paciente está em atendimento ou se houve atraso/falta.`,
            patientId: appt.patientId || null,
            patientName: appt.patientName || null,
            appointmentId: apptDoc.id,
            dueDate: todayStr,
            priority: "Média",
            status: "pending",
            source: "ELIZA — Acompanhamento de atraso",
            createdAt: AdminFieldValue.serverTimestamp(),
          });
          created++;
        }
      }
      return res.json({ success: true, message: `Checagem de atraso concluída. Pendências criadas: ${created}` });
    } catch (err: any) {
      console.error("[SCHEDULER_DELAY_CHECK_ERROR] Failed:", err);
      return res.status(500).json({ error: err.message || "Erro na checagem de atraso da Agenda." });
    }
  });

  // Helper to convert any date representation to YYYY-MM-DD in America/Sao_Paulo timezone
  const toSampaDateStr = (val: any): string => {
    if (!val) return "";
    let date: Date;
    if (typeof val.toDate === 'function') {
      date = val.toDate();
    } else if (val.seconds !== undefined) {
      date = new Date(val.seconds * 1000);
    } else if (val instanceof Date) {
      date = val;
    } else if (typeof val === 'string') {
      const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return match[0]; // Already YYYY-MM-DD
      date = new Date(val);
    } else if (typeof val === 'number') {
      date = new Date(val);
    } else {
      date = new Date();
    }
    if (isNaN(date.getTime())) return "";
    
    try {
      const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(date);
      const d = parts.find(p => p.type === 'day')?.value || '01';
      const m = parts.find(p => p.type === 'month')?.value || '01';
      const y = parts.find(p => p.type === 'year')?.value || '2026';
      return `${y}-${m}-${d}`;
    } catch (err) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  };

  // Helper to parse/normalize entries for backend processing
  const normalizeEntrySrv = (id: string, doc: any): any => {
    let totalAmount = 0;
    if (doc.totalAmount !== undefined) {
      totalAmount = Number(doc.totalAmount);
    } else if (doc.amount !== undefined) {
      totalAmount = Number(doc.amount);
    } else if (doc.value !== undefined) {
      totalAmount = Number(doc.value);
    }

    let paidAmount = 0;
    let paidAmountIsSet = false;
    if (doc.paidAmount !== undefined) {
      paidAmount = Number(doc.paidAmount);
      paidAmountIsSet = true;
    } else if (doc.paid !== undefined) {
      paidAmount = Number(doc.paid);
      paidAmountIsSet = true;
    } else if (doc.paid_amount !== undefined) {
      paidAmount = Number(doc.paid_amount);
      paidAmountIsSet = true;
    }

    let type: "income" | "expense" = "income";
    const rawType = String(doc.type || "").toLowerCase().trim();
    if (rawType === "expense" || rawType === "despesa" || rawType === "saída" || rawType === "saida") {
      type = "expense";
    }

    let status: "pending" | "partial" | "paid" | "cancelled" = "pending";
    const rawStatus = String(doc.status || "").toLowerCase().trim();
    if (rawStatus === "pago" || rawStatus === "paid" || rawStatus === "received" || rawStatus === "recebido") {
      status = "paid";
    } else if (rawStatus === "parcial" || rawStatus === "partial") {
      status = "partial";
    } else if (rawStatus === "cancelado" || rawStatus === "cancelled" || rawStatus === "cancel") {
      status = "cancelled";
    } else if (rawStatus === "pending" || rawStatus === "pendente") {
      status = "pending";
    } else {
      if (paidAmount >= totalAmount && totalAmount > 0) {
        status = "paid";
      } else if (paidAmount > 0) {
        status = "partial";
      }
    }

    if (status === "paid" && (!paidAmountIsSet || paidAmount === 0)) {
      paidAmount = totalAmount;
    }

    let pendingAmount = 0;
    if (doc.pendingAmount !== undefined) {
      pendingAmount = Number(doc.pendingAmount);
    } else {
      pendingAmount = status === "paid" ? 0 : Math.max(0, totalAmount - paidAmount);
    }

    const paymentMethod = doc.paymentMethod || doc.payment_method || doc.formaPagamento || "";
    const title = doc.title || doc.description || doc.name || "Sem descrição";
    const patientName = doc.patientName || doc.patient_name || null;

    return {
      id,
      type,
      title,
      totalAmount,
      paidAmount,
      pendingAmount,
      status,
      paymentMethod,
      patientName
    };
  };

  // Helper to aggregate financial entries on backend
  const runCalculationForClinicDate = async (clinicId: string, dateStr: string) => {
    const entriesSnap = await adminDb.collection(`clinics/${clinicId}/financial_entries`).get();
    
    let totalReceived = 0;
    let pendingAmount = 0;
    let entriesCount = 0;
    
    const byPaymentMethod = {
      dinheiro: 0,
      pix: 0,
      credito: 0,
      debito: 0,
      transferencia: 0,
      boleto: 0,
      outros: 0
    };
    
    let pendingEntries: any[] = [];
    let warnings: string[] = [];

    entriesSnap.forEach(d => {
      const docData = d.data();
      if (docData.archived) return;

      const paidAtVal = docData.paidAt || docData.paymentDate || docData.payment_date || null;
      const dueDateVal = docData.dueDate || docData.due_date || docData.date || null;
      const pDateStr = toSampaDateStr(paidAtVal || dueDateVal);
      
      if (pDateStr !== dateStr) return;

      const norm = normalizeEntrySrv(d.id, docData);
      if (norm.type !== 'income') return;

      entriesCount++;

      if (norm.status === 'paid' || norm.status === 'partial') {
        totalReceived += norm.paidAmount;
        
        const method = String(norm.paymentMethod || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (["dinheiro", "especie", "cash"].some(x => method.includes(x))) {
          byPaymentMethod.dinheiro += norm.paidAmount;
        } else if (["pix"].some(x => method.includes(x))) {
          byPaymentMethod.pix += norm.paidAmount;
        } else if (["credito", "credit"].some(x => method.includes(x))) {
          byPaymentMethod.credito += norm.paidAmount;
        } else if (["debito", "debit"].some(x => method.includes(x))) {
          byPaymentMethod.debito += norm.paidAmount;
        } else if (["transferencia", "ted", "doc", "bancaria", "bank", "transfer"].some(x => method.includes(x))) {
          byPaymentMethod.transferencia += norm.paidAmount;
        } else if (["boleto", "ticket"].some(x => method.includes(x))) {
          byPaymentMethod.boleto += norm.paidAmount;
        } else {
          byPaymentMethod.outros += norm.paidAmount;
        }
      }

      if (norm.status === 'pending' || norm.status === 'partial') {
        pendingAmount += norm.pendingAmount;
        pendingEntries.push({
          id: norm.id,
          title: norm.title,
          pendingAmount: norm.pendingAmount,
          patientName: norm.patientName || "Não Informado"
        });
      }

      if (!norm.paymentMethod && (norm.status === 'paid' || norm.status === 'partial')) {
        warnings.push(`Lançamento "${norm.title}" (ID ${norm.id}): Pago/Parcial mas sem forma de pagamento.`);
      }
      if (!docData.createdBy && !docData.responsible && !docData.professionalId && !docData.professionalName) {
        warnings.push(`Lançamento "${norm.title}" (ID ${norm.id}): Recebimento sem responsável associado.`);
      }
      if (norm.status === 'paid' && norm.paidAmount < norm.totalAmount) {
        warnings.push(`Lançamento "${norm.title}" (ID ${norm.id}): Marcado como Pago mas valor pago (R$ ${norm.paidAmount}) é menor que total (R$ ${norm.totalAmount}).`);
      }
      if (norm.status === 'pending' && norm.paidAmount > 0) {
        warnings.push(`Lançamento "${norm.title}" (ID ${norm.id}): Marcado como Pendente mas tem valor pago.`);
      }
    });

    return {
      totalReceived,
      pendingAmount,
      entriesCount,
      byPaymentMethod,
      pendingEntries,
      warnings
    };
  };

  // Helper to trigger Fluxo 2 adjustments after 18h
  const handlePostLimitAdjustment = async (clinicId: string, dateStr: string, docId: string, docData: any) => {
    try {
      const closingRef = adminDb.doc(`clinics/${clinicId}/cash_closings/${dateStr}`);
      const closingSnap = await closingRef.get();
      if (!closingSnap.exists) {
        console.log(`[CASH_CLOSING_REALTIME] Day cash closing does not exist yet. No suggested closing to adjust.`);
        return;
      }

      const closingData = closingSnap.data() || {};
      if (closingData.status !== "suggested") {
        console.log(`[CASH_CLOSING_REALTIME] Cash closing exist but is not in "suggested" status (${closingData.status}). Skipping adjustment.`);
        return;
      }

      console.log(`[CASH_CLOSING_REALTIME] Recalculating totals for ${clinicId} on ${dateStr}...`);
      const info = await runCalculationForClinicDate(clinicId, dateStr);

      if (info.totalReceived === closingData.totalReceived) {
        console.log(`[CASH_CLOSING_REALTIME] Total received matches perfectly. No adjustment needed.`);
        return;
      }

      const diff = info.totalReceived - closingData.totalReceived;
      const adjustmentId = "adj_" + Date.now();
      const adjRef = adminDb.doc(`clinics/${clinicId}/cash_closings/${dateStr}/adjustments/${adjustmentId}`);

      await adjRef.set({
        previousTotal: closingData.totalReceived || 0,
        newTotal: info.totalReceived,
        difference: diff,
        newEntries: [{
          id: docId,
          title: docData.title || docData.description || "Novo Recebimento",
          amount: docData.paidAmount || docData.totalAmount || 0,
          paymentMethod: docData.paymentMethod || docData.payment_method || docData.formaPagamento || "Outros"
        }],
        suggestedAt: AdminFieldValue.serverTimestamp(),
        status: "pending_review"
      });

      console.log(`[CASH_CLOSING_REALTIME] Saved adjustment ${adjustmentId} for clinic ${clinicId}. Triggering notifications...`);

      // Notify authorized roles
      const rolesToNotify = ['owner', 'dono', 'socio', 'financial', 'financeiro', 'manager', 'gestor', 'gerente'];
      const teamSnap = await adminDb.collection(`clinics/${clinicId}/team_members`).get();
      const membersSnap = await adminDb.collection(`clinics/${clinicId}/members`).get();
      const recipients: { name: string, phone: string }[] = [];

      const collectRecipients = (snap: any) => {
        snap.forEach((d: any) => {
          const data = d.data();
          if (data.active !== false && data.phone) {
            const roleLower = String(data.role || "").toLowerCase();
            if (rolesToNotify.includes(roleLower)) {
              const cleanPh = normalizeWhatsAppPhone(data.phone);
              if (!recipients.some(r => r.phone === cleanPh)) {
                recipients.push({
                  name: data.name || data.displayName || "Gestor",
                  phone: cleanPh
                });
              }
            }
          }
        });
      };
      collectRecipients(teamSnap);
      collectRecipients(membersSnap);

      const alertText = `⚡ *ELIZA: Atualização de Caixa Detectada!* 📊\n\nOlá, equipe de gestão.\nFoi registrado um recebimento após o fechamento parcial das 18h hoje:\n\n*💵 Total Parcial Anterior:* R$ ${(closingData.totalReceived || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n*🚀 Novo Total Estimado:* R$ ${info.totalReceived.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n*📈 Diferença:* +R$ ${diff.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n*Novo Lançamento:* ${docData.title || "Lançamento"} - R$ ${(docData.paidAmount || docData.totalAmount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n*Por favor, revise e aprove a atualização de caixa no painel Financeiro.*`;

      for (const r of recipients) {
        const dispatchResult = await dispatchWhatsAppMessage(clinicId, r.phone, alertText);
        await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
          type: "cash_closing_adjustment",
          recipientName: r.name,
          recipientPhone: r.phone,
          status: dispatchResult.success ? "success" : "error",
          errorMessage: dispatchResult.errorMessage || null,
          timestamp: AdminFieldValue.serverTimestamp()
        });
      }
    } catch (err: any) {
      console.error("[CASH_CLOSING_ADJUSTMENT_TRIGGER_ERROR]", err);
    }
  };

  // POST /api/internal/scheduler/run-cash-closing-suggestions
  app.post("/api/internal/scheduler/run-cash-closing-suggestions", verifySchedulerAuth, async (req, res) => {
    console.log("[SCHEDULER] Running cash closing suggestions task (Scheduled at 18:00 America/Sao_Paulo clock)...");
    try {
      const clinicsSnap = await adminDb.collection("clinics").get();
      let totalDispatched = 0;
      const sampa = getSampaDate();
      const dateStr = toSampaDateStr(sampa);

      for (const clinicDoc of clinicsSnap.docs) {
        const clinicId = clinicDoc.id;
        console.log(`[SCHEDULER] Processing closing suggestions for clinic ${clinicId} on ${dateStr}...`);
        
        const info = await runCalculationForClinicDate(clinicId, dateStr);

        // Create suggested daily cash closing document
        const closingRef = adminDb.doc(`clinics/${clinicId}/cash_closings/${dateStr}`);
        await closingRef.set({
          date: dateStr,
          status: "suggested",
          suggestedAt: AdminFieldValue.serverTimestamp(),
          totalReceived: info.totalReceived,
          byPaymentMethod: info.byPaymentMethod,
          pendingAmount: info.pendingAmount,
          entriesCount: info.entriesCount,
          pendingEntries: info.pendingEntries,
          warnings: info.warnings,
          createdBy: "eliza_ai",
          updatedAt: AdminFieldValue.serverTimestamp()
        });

        // Notify authorized personnel
        const rolesToNotify = ['owner', 'dono', 'socio', 'financial', 'financeiro', 'manager', 'gestor', 'gerente'];
        const teamSnap = await adminDb.collection(`clinics/${clinicId}/team_members`).get();
        const membersSnap = await adminDb.collection(`clinics/${clinicId}/members`).get();
        const recipients: { name: string, phone: string }[] = [];

        const collectRecipients = (snap: any) => {
          snap.forEach((d: any) => {
            const data = d.data();
            if (data.active !== false && data.phone) {
              const roleLower = String(data.role || "").toLowerCase();
              if (rolesToNotify.includes(roleLower)) {
                const cleanPh = normalizeWhatsAppPhone(data.phone);
                if (!recipients.some(r => r.phone === cleanPh)) {
                  recipients.push({
                    name: data.name || data.displayName || "Gestor",
                    phone: cleanPh
                  });
                }
              }
            }
          });
        };
        collectRecipients(teamSnap);
        collectRecipients(membersSnap);

        const warningsCount = info.warnings.length;
        const warningsText = warningsCount > 0 
          ? info.warnings.slice(0, 5).map(w => `• ${w}`).join("\n")
          : "• Nenhuma divergência operacional identificada.";

        const messageText = `*📊 ELIZA: Fechamento Parcial de Caixa de Hoje (${dateStr})* 💰\n\nOlá! Aqui está o resumo parcial das movimentações financeiras gerado hoje às 18h:\n\n*💰 Total Recebido hoje:* R$ ${info.totalReceived.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n*⏳ Total Pendente:* R$ ${info.pendingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n*📝 Total de Lançamentos:* ${info.entriesCount}\n\n*💳 Resumo por Forma de Pagamento:*\n- Dinheiro: R$ ${info.byPaymentMethod.dinheiro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- PIX: R$ ${info.byPaymentMethod.pix.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- Crédito: R$ ${info.byPaymentMethod.credito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- Débito: R$ ${info.byPaymentMethod.debito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- Transferência: R$ ${info.byPaymentMethod.transferencia.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- Boleto: R$ ${info.byPaymentMethod.boleto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- Outros: R$ ${info.byPaymentMethod.outros.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n⚠️ *Alertas de Divergência (${warningsCount}):*\n${warningsText}\n\n*Para aprovar este fechamento, ignorar ou revisar, acesse o painel Financeiro da ELIZA.*`;

        for (const recipient of recipients) {
          const dispatchResult = await dispatchWhatsAppMessage(clinicId, recipient.phone, messageText);
          
          await adminDb.collection(`clinics/${clinicId}/automation_logs`).add({
            type: "cash_closing_suggestion",
            recipientName: recipient.name,
            recipientPhone: recipient.phone,
            status: dispatchResult.success ? "success" : "error",
            errorMessage: dispatchResult.errorMessage || null,
            timestamp: AdminFieldValue.serverTimestamp()
          });
          
          if (dispatchResult.success) {
            totalDispatched++;
          }
        }
      }

      return res.json({ success: true, message: `Disparador de sugestões de fechamento de caixa finalizado. Notificações entregues: ${totalDispatched}` });
    } catch (err: any) {
      console.error("[SCHEDULER_CASH_CLOSING_ERROR] Failed:", err);
      return res.status(500).json({ error: err.message || "Erro no agendador de sugestão de fechamento de caixa." });
    }
  });

  // Start the background Firestore collection group listener for real-time adjustments (Fluxo 2)
  const serverStartTime = Date.now();
  console.log(`[CASH_CLOSING_REALTIME] Setting up collectionGroup financial_entries listener...`);
  try {
    adminDb.collectionGroup('financial_entries').onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added' || change.type === 'modified') {
          const docData = change.doc.data();
          const docId = change.doc.id;
          
          const pathParts = change.doc.ref.path.split('/');
          if (pathParts[0] === 'clinics' && pathParts[2] === 'financial_entries') {
            const clinicId = pathParts[1];
            
            // Safe filter: ignore initial load, allow only recent writes/updates
            const docTime = (docData.updatedAt?.seconds ? docData.updatedAt.seconds * 1000 : null) || 
                            (docData.createdAt?.seconds ? docData.createdAt.seconds * 1000 : null) || 
                            Date.now();
            
            if (docTime < serverStartTime - 10000) continue; // ignore old entries matching initial snapshot count
            
            const sampa = getSampaDate();
            const currentHour = sampa.getHours();
            if (currentHour >= 18) {
              const dateStr = toSampaDateStr(sampa);
              
              const paidAtVal = docData.paidAt || docData.paymentDate || docData.payment_date || null;
              const dueDateVal = docData.dueDate || docData.due_date || docData.date || null;
              const entryDateStr = toSampaDateStr(paidAtVal || dueDateVal);
              
              if (entryDateStr === dateStr && docData.type !== 'expense' && !docData.archived) {
                console.log(`[CASH_CLOSING_REALTIME] Detected new/modified income entry ${docId} on clinic ${clinicId} after 18h. Recalculating...`);
                await handlePostLimitAdjustment(clinicId, dateStr, docId, docData);
              }
            }
          }
        }
      }
    }, (err) => {
      console.error("[CASH_CLOSING_REALTIME_ERROR]", err);
    });
  } catch (err) {
    console.error("[CASH_CLOSING_REALTIME_SETUP_ERROR]", err);
  }

  // ============================================================================
  // SIMPLES DENTAL BRIDGE INTEGRATION (read-only, Fase 1)
  // ============================================================================
  // GET /api/bridge/state/patients — minimal identity fields only, for the
  // Bridge's local matching/reconciliation. No write endpoint exists yet
  // and none of this touches the legacy import_batches/patient_import_review
  // collections. Auth is bridgeAuth's own dedicated token
  // (BRIDGE_INTEGRATION_TOKEN), scoped per-clinic via
  // BRIDGE_ALLOWED_CLINIC_IDS — see src/lib/bridgeAuth.ts.
  const bridgeAuth = createBridgeAuthMiddleware();

  app.get("/api/bridge/state/patients", bridgeAuth, async (req: any, res) => {
    try {
      const clinicId: string = req.bridgeClinicId;
      const patientsCollection = adminDb.collection(`clinics/${clinicId}/patients`);
      const response = await fetchBridgePatientState(
        patientsCollection as any,
        FieldPath,
        clinicId,
        req.query?.pageSize,
        typeof req.query?.pageToken === "string" ? req.query.pageToken : undefined
      );
      res.json(response);
    } catch (err) {
      console.error("[BRIDGE_STATE_PATIENTS_ERROR]", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Erro interno ao consultar estado de pacientes." });
    }
  });

  // ============================================================================
  // SIMPLES DENTAL BRIDGE INTEGRATION (escrita real, ADR 0003)
  // ============================================================================
  // Credencial PRÓPRIA (BRIDGE_SYNC_TOKEN, nunca BRIDGE_INTEGRATION_TOKEN) +
  // BRIDGE_SYNC_WRITES_ENABLED=true precisam estar setados — ver
  // src/lib/bridgeSyncAuth.ts. Nunca escreve campo de identidade do
  // paciente, só agendamento/financeiro referenciando um patientId já
  // existente.
  const bridgeSyncAuth = createBridgeSyncAuthMiddleware();

  app.post("/api/bridge/sync/appointments", bridgeSyncAuth, async (req: any, res) => {
    try {
      const clinicId: string = req.bridgeSyncClinicId;
      const { bridgeSourceId, patientId, scheduledDate, scheduledTime, estimatedMinutes, professionalName, chairName } = req.body || {};
      if (!bridgeSourceId || !patientId || !scheduledDate || !scheduledTime) {
        return res.status(400).json({ error: "MALFORMED_PAYLOAD", message: "bridgeSourceId, patientId, scheduledDate e scheduledTime são obrigatórios." });
      }
      const result = await upsertAppointmentFromBridge(adminDb as any, AdminFieldValue, clinicId, {
        bridgeSourceId: String(bridgeSourceId), patientId: String(patientId), scheduledDate: String(scheduledDate),
        scheduledTime: String(scheduledTime), estimatedMinutes: Number(estimatedMinutes) || 30,
        professionalName: String(professionalName || ""), chairName: chairName ? String(chairName) : null,
      });
      console.log(`[BRIDGE_SYNC_APPOINTMENT] clinicId=${clinicId} action=${result.action} docId=${result.docId}`);
      return res.json(result);
    } catch (err: any) {
      if (err instanceof BridgePatientNotFoundError) {
        return res.status(404).json({ error: "PATIENT_NOT_FOUND", message: err.message });
      }
      console.error("[BRIDGE_SYNC_APPOINTMENT_ERROR]", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Erro interno ao sincronizar agendamento." });
    }
  });

  app.post("/api/bridge/sync/financial-entries", bridgeSyncAuth, async (req: any, res) => {
    try {
      const clinicId: string = req.bridgeSyncClinicId;
      const { bridgeIdempotencyKey, patientId, tipo, categoria, valor, situacao, dataPagamento, valorPago } = req.body || {};
      if (!bridgeIdempotencyKey || !patientId || !tipo || typeof valor !== "number" || !situacao) {
        return res.status(400).json({ error: "MALFORMED_PAYLOAD", message: "bridgeIdempotencyKey, patientId, tipo, valor e situacao são obrigatórios." });
      }
      const result = await upsertFinancialEntryFromBridge(adminDb as any, AdminFieldValue, clinicId, {
        bridgeIdempotencyKey: String(bridgeIdempotencyKey), patientId: String(patientId), tipo: String(tipo),
        categoria: categoria ? String(categoria) : null, valor: Number(valor), situacao: String(situacao),
        dataPagamento: dataPagamento ? String(dataPagamento) : null, valorPago: typeof valorPago === "number" ? valorPago : null,
      });
      console.log(`[BRIDGE_SYNC_FINANCIAL] clinicId=${clinicId} action=${result.action} docId=${result.docId}`);
      return res.json(result);
    } catch (err: any) {
      if (err instanceof BridgePatientNotFoundError) {
        return res.status(404).json({ error: "PATIENT_NOT_FOUND", message: err.message });
      }
      console.error("[BRIDGE_SYNC_FINANCIAL_ERROR]", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Erro interno ao sincronizar lançamento financeiro." });
    }
  });

  // ============================================================================
  // AUTHENTICATION ROUTES
  // ============================================================================

  /**
   * POST /api/auth/login
   * Generates JWT token
   */
  app.post("/api/auth/login", authController.login);

  /**
   * POST /api/auth/refresh
   * Refreshes JWT token
   */
  app.post("/api/auth/refresh", authController.refresh);

  /**
   * GET /api/auth/me
   * Gets current user info
   */
  app.get("/api/auth/me", authController.getCurrentUser);

  /**
   * GET /api/auth/clinics
   * Gets all clinics for user
   */
  app.get("/api/auth/clinics", authController.getUserClinics);

  /**
   * POST /api/auth/logout
   * Logout
   */
  app.post("/api/auth/logout", authController.logout);

  console.log("[AUTH] Routes initialized (/api/auth/*)");

  // ============================================================================
  // ELIZA INTELLIGENCE LAYER ROUTES (NEW)
  // ============================================================================

  /**
   * POST /api/intelligence/analyze
   * Main intelligence endpoint - analyzes patient data, clinical situations, etc
   */
  app.post("/api/intelligence/analyze", elizaAuthMiddleware, async (req, res) => {
    try {
      const elizaRequest: ElizaIntelligenceRequest = req.body;
      
      // Basic validation
      if (!elizaRequest.taskType || !elizaRequest.prompt) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "taskType e prompt são obrigatórios",
          },
        });
      }

      const { response, audit } = await elizaIntelligence.execute(req, elizaRequest);
      
      res.json(response);
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json(error);
    }
  });

  /**
   * GET /api/intelligence/tools
   * Lists available tools for the authenticated user
   */
  app.get("/api/intelligence/tools", elizaAuthMiddleware, async (req, res) => {
    try {
      const { buildContext } = await import("./src/services/elizaContextBuilder");
      const { getAvailableTools } = await import("./src/lib/elizaToolRegistry");
      
      const context = await buildContext(req, {
        taskType: "patient_analysis",
        prompt: "",
      });

      const tools = getAvailableTools(context);

      res.json({
        success: true,
        data: {
          tools: tools.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            requiresApproval: t.requiresApproval,
          })),
          total: tools.length,
        },
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message,
        },
      });
    }
  });

  /**
   * POST /api/intelligence/approve-action
   * Approves a pending action proposal
   */
  app.post("/api/intelligence/approve-action", elizaAuthMiddleware, async (req: any, res) => {
    try {
      const { actionId } = req.body;
      const clinicId = req.elizaAuth.clinicId;
      const userId = req.elizaAuth.userId;

      if (!actionId) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "actionId é obrigatório",
          },
        });
      }

      // Load action proposal
      const actionDoc = await adminDb
        .collection("clinics")
        .doc(clinicId)
        .collection("action_proposals")
        .doc(actionId)
        .get();

      if (!actionDoc.exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Ação não encontrada",
          },
        });
      }

      // Update status
      await actionDoc.ref.update({
        status: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
      });

      res.json({
        success: true,
        data: {
          actionId,
          status: "approved",
          approvedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message,
        },
      });
    }
  });

  console.log("[ELIZA] Intelligence Layer routes initialized (/api/intelligence/*)");

  // ============================================================================
  // PATIENT PORTAL ROUTES (NEW)
  // ============================================================================
  // A patient has no Firebase account and firestore.rules blocks every read/
  // write under clinics/{clinicId}/** to non-members (isClinicMember(...)),
  // by design. So this whole surface talks to Firestore exclusively through
  // adminDb (Admin SDK, bypasses rules) with its own opaque, hash-stored
  // session tokens — never Firebase Auth, never the elizaAuthMiddleware/JWT
  // layer above (that one is bootstrapped from a staff Firebase ID token and
  // isn't a fit for a patient who has no such token to begin with). Session
  // and link tokens are never stored in plaintext, and URLs handed to
  // patients never carry patientId, CPF, or phone — only an opaque token or
  // the clinic's existing `slug` field.

  const PATIENT_PORTAL_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const PATIENT_PORTAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
  const PATIENT_PORTAL_OTP_MAX_ATTEMPTS = 5;

  function portalNormalizeName(s: string): string {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function portalNormalizePhone(s: string): string {
    const digits = (s || "").replace(/\D/g, "");
    return digits.startsWith("55") && digits.length > 11 ? digits.substring(2) : digits;
  }
  function portalGenerateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }
  function portalHash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }
  function portalGenerateOtpCode(): string {
    return String(crypto.randomInt(100000, 1000000));
  }
  function portalToMs(v: any): number {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (v instanceof Date) return v.getTime();
    const parsed = new Date(v).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }

  async function createPortalSession(clinicId: string, patientId: string) {
    const rawToken = portalGenerateToken();
    const tokenHash = portalHash(rawToken);
    await adminDb.collection("patient_portal_sessions").doc(tokenHash).set({
      clinicId,
      patientId,
      tokenHash,
      createdAt: AdminFieldValue.serverTimestamp(),
      lastSeenAt: AdminFieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + PATIENT_PORTAL_SESSION_TTL_MS),
    });
    return { rawToken };
  }

  async function createPortalPendingItem(
    clinicId: string,
    patientId: string,
    patientName: string,
    payload: { type: string; title: string; description: string; extra?: Record<string, any> }
  ) {
    const ref = await adminDb.collection(`clinics/${clinicId}/pending_items`).add({
      type: payload.type,
      title: payload.title,
      description: payload.description,
      patientId,
      patientName,
      priority: "Média",
      status: "pending",
      category: "Portal do Paciente",
      source: "Portal do Paciente",
      createdAt: AdminFieldValue.serverTimestamp(),
      ...(payload.extra || {}),
    });
    // Single choke point for all 5 Portal request types — the event log's
    // "solicitação do Portal" family is written here once instead of
    // repeated in each route below.
    adminDb.collection(`clinics/${clinicId}/status_events`).add({
      entityType: "pending_item",
      entityId: ref.id,
      eventType: "pending_item_created",
      patientId,
      fromStatus: null,
      toStatus: "pending",
      professionalId: null,
      professionalName: null,
      metadata: { type: payload.type, title: payload.title, source: "Portal do Paciente" },
      createdBy: null,
      occurredAt: AdminFieldValue.serverTimestamp(),
    }).catch((e: any) => console.warn("[STATUS_EVENTS] Failed to log portal request event:", e.message || e));
    return ref;
  }

  // Shared by GET /home (display) and the portal messaging AI auto-reply
  // (context for "quando é minha consulta"-type questions) — one query/sort,
  // not reimplemented twice.
  async function getPatientNextAppointment(clinicId: string, patientId: string) {
    const apptsSnap = await adminDb.collection(`clinics/${clinicId}/appointments`).where("patientId", "==", patientId).get();
    const now = Date.now();
    return apptsSnap.docs
      .map(d => d.data() as any)
      .filter(a => !["cancelado", "faltou", "finalizado"].includes(a.status) && portalToMs(new Date(`${a.date}T${a.time || "00:00"}:00`)) >= now)
      .sort((a, b) => portalToMs(new Date(`${a.date}T${a.time || "00:00"}:00`)) - portalToMs(new Date(`${b.date}T${b.time || "00:00"}:00`)))[0] || null;
  }

  // Public-facing rate limiter (no session yet) — a blunt IP-based safety
  // net; the real per-patient throttling for OTP lives in the route logic
  // below (query-based, since express-rate-limit's default store keys by IP,
  // not by patient/phone).
  const portalPublicLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
  const portalSessionLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

  async function patientPortalAuth(req: any, res: any, next: any) {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, error: "Sessão ausente." });
      }
      const tokenHash = portalHash(authHeader.substring(7));
      const sessionRef = adminDb.collection("patient_portal_sessions").doc(tokenHash);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) {
        return res.status(401).json({ success: false, error: "Sessão inválida." });
      }
      const session: any = sessionSnap.data();
      if (portalToMs(session.expiresAt) < Date.now()) {
        return res.status(401).json({ success: false, error: "Sessão expirada. Acesse o link novamente." });
      }
      await sessionRef.update({
        lastSeenAt: AdminFieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + PATIENT_PORTAL_SESSION_TTL_MS),
      });
      req.patientPortal = { clinicId: session.clinicId, patientId: session.patientId };
      next();
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_AUTH_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao validar sessão." });
    }
  }

  // Staff-side auth for the "generate portal link" / "revoke access" actions
  // triggered from inside the real (Firebase-authenticated) app — same
  // Firebase ID Token + clinic-membership check already used by
  // authController.ts's /api/auth/login, just inlined here since it's the
  // only two routes that need it.
  async function patientPortalStaffAuth(req: any, res: any, next: any) {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, error: "Autenticação necessária." });
      }
      const decoded = await getAdminAuth().verifyIdToken(authHeader.substring(7));
      const clinicId = req.body?.clinicId;
      if (!clinicId) {
        return res.status(400).json({ success: false, error: "clinicId é obrigatório." });
      }
      const memberSnap = await adminDb.doc(`clinics/${clinicId}/members/${decoded.uid}`).get();
      if (!memberSnap.exists || memberSnap.data()?.active === false) {
        return res.status(403).json({ success: false, error: "Você não tem acesso a esta clínica." });
      }
      req.staffAuth = { uid: decoded.uid, clinicId };
      next();
    } catch (err: any) {
      return res.status(401).json({ success: false, error: "Token inválido." });
    }
  }

  // --- Access (link + OTP) ---------------------------------------------

  app.post("/api/patient-portal/link/redeem", portalPublicLimiter, async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token || typeof token !== "string") {
        return res.status(400).json({ success: false, error: "Link inválido." });
      }
      const linkSnap = await adminDb.collection("patient_portal_links").doc(portalHash(token)).get();
      if (!linkSnap.exists || linkSnap.data()?.active === false) {
        return res.status(404).json({ success: false, error: "Link inválido ou revogado. Peça um novo link à clínica." });
      }
      const link: any = linkSnap.data();
      const patientSnap = await adminDb.doc(`clinics/${link.clinicId}/patients/${link.patientId}`).get();
      if (!patientSnap.exists) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }
      const clinicSnap = await adminDb.doc(`clinics/${link.clinicId}`).get();
      const session = await createPortalSession(link.clinicId, link.patientId);
      await linkSnap.ref.update({ lastUsedAt: AdminFieldValue.serverTimestamp() });
      return res.json({
        success: true,
        data: {
          sessionToken: session.rawToken,
          patientName: patientSnap.data()?.name || "",
          clinicName: clinicSnap.data()?.name || "",
        },
      });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_LINK_REDEEM_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao validar link." });
    }
  });

  app.post("/api/patient-portal/auth/request-otp", portalPublicLimiter, async (req, res) => {
    try {
      const { clinicSlug, name, phone } = req.body || {};
      if (!clinicSlug || !name || !phone) {
        return res.status(400).json({ success: false, error: "Preencha nome completo e telefone." });
      }
      const clinicsSnap = await adminDb.collection("clinics").where("slug", "==", String(clinicSlug).toLowerCase().trim()).limit(1).get();
      if (clinicsSnap.empty) {
        return res.status(404).json({ success: false, error: "Clínica não encontrada." });
      }
      const clinicDoc = clinicsSnap.docs[0];
      const clinicId = clinicDoc.id;

      // Full-collection scan: acceptable at this clinic's current scale
      // (thousands of patients, login is an infrequent action) since phone
      // isn't stored in a normalized, query-friendly format today. Revisit
      // with a phoneNormalized index field if a much larger clinic adopts
      // the portal.
      const targetName = portalNormalizeName(name);
      const patientsSnap = await adminDb.collection(`clinics/${clinicId}/patients`).get();
      const match = patientsSnap.docs.find(d => {
        const p: any = d.data();
        return portalNormalizeName(p.name || "") === targetName && portalNormalizePhone(p.phone || "") &&
          portalNormalizePhone(p.phone || "").slice(-8) === portalNormalizePhone(phone).slice(-8);
      });

      // Always respond success-shaped even without a match, so this endpoint
      // can't be used to enumerate a clinic's patient names/phones.
      if (!match) {
        return res.json({ success: true, data: { requestId: null } });
      }
      const patientId = match.id;
      const matchPhone = (match.data() as any).phone || phone;

      const recentSnap = await adminDb.collection("patient_otp_requests")
        .where("clinicId", "==", clinicId)
        .where("patientId", "==", patientId)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();
      const now = Date.now();
      if (recentSnap.docs.some(d => now - portalToMs(d.data().createdAt) < 60_000)) {
        return res.status(429).json({ success: false, error: "Aguarde 1 minuto antes de solicitar um novo código." });
      }
      if (recentSnap.docs.filter(d => now - portalToMs(d.data().createdAt) < 24 * 60 * 60 * 1000).length >= 5) {
        return res.status(429).json({ success: false, error: "Limite diário de códigos atingido. Fale com a clínica." });
      }

      const code = portalGenerateOtpCode();
      const reqRef = await adminDb.collection("patient_otp_requests").add({
        clinicId,
        patientId,
        phone: matchPhone,
        codeHash: portalHash(code),
        attempts: 0,
        consumed: false,
        createdAt: AdminFieldValue.serverTimestamp(),
        expiresAt: new Date(now + PATIENT_PORTAL_OTP_TTL_MS),
      });

      const clinicName = clinicDoc.data()?.name || "sua clínica";
      const waResult = await dispatchWhatsAppMessage(clinicId, matchPhone, `${clinicName}: seu código de acesso ao Portal do Paciente é ${code}. Válido por 10 minutos. Não compartilhe com ninguém.`);

      return res.json({ success: true, data: { requestId: reqRef.id, whatsappSent: !!waResult.success } });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_REQUEST_OTP_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao solicitar código." });
    }
  });

  app.post("/api/patient-portal/auth/verify-otp", portalPublicLimiter, async (req, res) => {
    try {
      const { requestId, code } = req.body || {};
      if (!requestId || !code) {
        return res.status(400).json({ success: false, error: "Código inválido." });
      }
      const reqRef = adminDb.collection("patient_otp_requests").doc(requestId);
      const reqSnap = await reqRef.get();
      if (!reqSnap.exists) {
        return res.status(400).json({ success: false, error: "Código inválido ou expirado." });
      }
      const data: any = reqSnap.data();
      if (data.consumed) {
        return res.status(400).json({ success: false, error: "Este código já foi usado." });
      }
      if (portalToMs(data.expiresAt) < Date.now()) {
        return res.status(400).json({ success: false, error: "Código expirado. Solicite um novo." });
      }
      if ((data.attempts || 0) >= PATIENT_PORTAL_OTP_MAX_ATTEMPTS) {
        return res.status(429).json({ success: false, error: "Muitas tentativas. Solicite um novo código." });
      }
      if (portalHash(String(code).trim()) !== data.codeHash) {
        await reqRef.update({ attempts: AdminFieldValue.increment(1) });
        return res.status(400).json({ success: false, error: "Código incorreto." });
      }

      await reqRef.update({ consumed: true, consumedAt: AdminFieldValue.serverTimestamp() });
      const session = await createPortalSession(data.clinicId, data.patientId);

      // Lazy upsert of the future cross-clinic patient account, keyed by
      // normalized phone — seeds the global-identity architecture without
      // touching clinics/{clinicId}/patients at all.
      const phoneNorm = portalNormalizePhone(data.phone || "");
      if (phoneNorm) {
        const accountRef = adminDb.collection("patient_accounts").doc(phoneNorm);
        const accountSnap = await accountRef.get();
        await accountRef.set({
          phoneNormalized: phoneNorm,
          [`clinicLinks.${data.clinicId}`]: data.patientId,
          updatedAt: AdminFieldValue.serverTimestamp(),
          ...(accountSnap.exists ? {} : { createdAt: AdminFieldValue.serverTimestamp() }),
        }, { merge: true });
      }

      const [patientSnap, clinicSnap] = await Promise.all([
        adminDb.doc(`clinics/${data.clinicId}/patients/${data.patientId}`).get(),
        adminDb.doc(`clinics/${data.clinicId}`).get(),
      ]);
      return res.json({
        success: true,
        data: {
          sessionToken: session.rawToken,
          patientName: patientSnap.data()?.name || "",
          clinicName: clinicSnap.data()?.name || "",
        },
      });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_VERIFY_OTP_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao verificar código." });
    }
  });

  // --- Authenticated portal data -----------------------------------------

  app.get("/api/patient-portal/home", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const [patientSnap, clinicSnap, anamnesisSnap, convoSnap, upcoming] = await Promise.all([
        adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get(),
        adminDb.doc(`clinics/${clinicId}`).get(),
        adminDb.doc(`clinics/${clinicId}/patients/${patientId}/anamnesis/current`).get(),
        adminDb.doc(`clinics/${clinicId}/portal_conversations/${patientId}`).get(),
        getPatientNextAppointment(clinicId, patientId),
      ]);
      if (!patientSnap.exists) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }
      const patientData: any = patientSnap.data() || {};

      return res.json({
        success: true,
        data: {
          patientName: patientData.name || "",
          photoUrl: patientData.photoUrl || null,
          clinicName: clinicSnap.data()?.name || "",
          nextAppointment: upcoming ? {
            date: upcoming.date, time: upcoming.time, treatment: upcoming.treatment || null,
            dentistName: upcoming.dentistName || null, status: upcoming.status,
          } : null,
          anamnesisSubmitted: !!anamnesisSnap.data()?.submittedByPatient,
          missingBasicInfo: {
            birthDate: !patientData.birthDate,
            email: !patientData.email,
          },
          hasUnreadPortalMessages: !!convoSnap.data()?.unreadByPatient,
        },
      });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_HOME_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao carregar dados." });
    }
  });

  app.get("/api/patient-portal/appointments", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const snap = await adminDb.collection(`clinics/${clinicId}/appointments`).where("patientId", "==", patientId).get();
      const appointments = snap.docs
        .map(d => {
          const a: any = d.data();
          return {
            id: d.id, date: a.date || null, time: a.time || null, treatment: a.treatment || null,
            dentistName: a.dentistName || null, status: a.status || null, duration: a.duration || null,
          };
        })
        .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
      return res.json({ success: true, data: { appointments } });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_APPOINTMENTS_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao carregar agendamentos." });
    }
  });

  // Never returns internalNotes, staff recados, ELIZA intelligence output,
  // costs, commissions, or any administrative field — only the explicit
  // patientVisible entries, mapped to a narrow, patient-safe shape.
  app.get("/api/patient-portal/history", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const [treatmentsSnap, imagesSnap] = await Promise.all([
        adminDb.collection(`clinics/${clinicId}/patients/${patientId}/treatments`).get(),
        adminDb.collection(`clinics/${clinicId}/patients/${patientId}/images`).get(),
      ]);

      const entries: any[] = [];
      treatmentsSnap.docs.forEach(tDoc => {
        const t: any = tDoc.data();
        (t.evolutions || []).forEach((ev: any) => {
          if (ev.voided) return;
          // patientVisible (a evolução em si) e postOpReleasedToPortal (só
          // as instruções de pós-operatório) são liberações INDEPENDENTES —
          // uma evolução pode ficar oculta enquanto só o pós-operatório dela
          // é liberado, ou vice-versa.
          const showEvolution = !!ev.patientVisible;
          const showPostOp = !!ev.postOpReleasedToPortal && !!ev.postOpInstructions;
          if (!showEvolution && !showPostOp) return;
          entries.push({
            type: "evolution", date: ev.date || null, procedure: t.description || null,
            professional: ev.professional || t.professional || null,
            notes: showEvolution ? (ev.text || null) : null,
            postOpInstructions: showPostOp ? ev.postOpInstructions : null,
          });
        });
      });
      imagesSnap.docs.forEach(d => {
        const img: any = d.data();
        if (!img.patientVisible) return;
        entries.push({
          type: "image", date: img.date || null, title: img.title || null,
          category: img.category || null, url: img.url || null, description: img.description || null,
        });
      });
      entries.sort((a, b) => portalToMs(b.date) - portalToMs(a.date));

      return res.json({ success: true, data: { history: entries } });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_HISTORY_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao carregar histórico." });
    }
  });

  app.get("/api/patient-portal/quotations", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const snap = await adminDb.collection(`clinics/${clinicId}/patients/${patientId}/quotations`).get();
      const quotations = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter((q: any) => q.status && q.status !== "draft")
        .map((q: any) => ({
          id: q.id, title: q.title || "Orçamento", totalValue: q.totalValue || 0, status: q.status,
          createdAt: q.createdAt || null,
          items: (q.items || []).map((it: any) => ({ description: it.description, value: it.value, quantity: it.quantity })),
        }));
      return res.json({ success: true, data: { quotations } });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_QUOTATIONS_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao carregar orçamentos." });
    }
  });

  // Patient-submitted anamnesis — reuses the exact same document
  // (clinics/{clinicId}/patients/{patientId}/anamnesis/current) and field
  // shape the staff-side Prontuário already reads/writes (NextMedicalRecord.tsx),
  // plus two new fields (chiefComplaint, proceduresOfInterest). After saving,
  // calls the same AI gateway used by the rest of the app (generateElizaAIResponse,
  // defined above) with taskType 'anamnese_dossie' — already a recognized
  // critical task type in that gateway — to prepare a pre-consult dossiê for
  // whoever attends the patient. A failed AI call never blocks the save.
  app.post("/api/patient-portal/anamnesis", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const {
        chiefComplaint, proceduresOfInterest, medicalTreatment, allergies,
        medications, conditions, healingIssues, hemorrhage, habits, birthDate, email,
      } = req.body || {};

      const patientSnap = await adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get();
      if (!patientSnap.exists) return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      const patientData: any = patientSnap.data() || {};
      const patientName = patientData.name || "Paciente";

      const anamnesisPayload: Record<string, any> = {
        chiefComplaint: chiefComplaint || "", proceduresOfInterest: proceduresOfInterest || "",
        medicalTreatment: medicalTreatment || "", allergies: allergies || "", medications: medications || "",
        conditions: conditions || "", healingIssues: healingIssues || "", hemorrhage: hemorrhage || "", habits: habits || "",
        submittedByPatient: true,
        submittedAt: AdminFieldValue.serverTimestamp(),
        updatedAt: AdminFieldValue.serverTimestamp(),
      };
      const anamnesisRef = adminDb.doc(`clinics/${clinicId}/patients/${patientId}/anamnesis/current`);
      await anamnesisRef.set(anamnesisPayload, { merge: true });

      // Only fills genuinely missing cadastral fields — never overwrites
      // what the clinic staff already has on file.
      const patientUpdate: Record<string, any> = {};
      if (birthDate && !patientData.birthDate) patientUpdate.birthDate = birthDate;
      if (email && !patientData.email) patientUpdate.email = email;
      if (Object.keys(patientUpdate).length > 0) {
        await patientSnap.ref.update(patientUpdate);
      }

      let aiPreConsultSummary: any = null;
      try {
        const prompt = `Você é a Eliza, inteligência clínica odontológica/estética sênior de apoio à equipe. O paciente "${patientName}" preencheu a anamnese pelo Portal do Paciente antes da consulta. Monte um resumo pré-consulta objetivo para o profissional que vai atendê-lo.

Queixa principal do paciente: "${chiefComplaint || "não informada"}"
Procedimentos de interesse informados pelo paciente: "${proceduresOfInterest || "não informado"}"
Respostas de anamnese (fonte da verdade, não invente nada além disso):
- Tratamento médico: ${medicalTreatment || "não informado"}
- Alergias: ${allergies || "não informado"}
- Medicação contínua: ${medications || "não informado"}
- Condições (diabetes/cardíaco): ${conditions || "não informado"}
- Cicatrização: ${healingIssues || "não informado"}
- Hemorragia: ${hemorrhage || "não informado"}
- Hábitos (fumo/álcool): ${habits || "não informado"}

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, exatamente neste formato:
{"summary":"resumo em 2-3 frases do que o profissional precisa saber antes de atender","alerts":[{"type":"danger|warning|info","title":"...","description":"..."}],"suggestedFocus":["ponto de atenção ou sugestão 1"]}
Nunca invente alergias, condições, achados ou históricos que não foram informados pelo paciente acima.`;

        const aiResult = await generateElizaAIResponse({
          taskType: "anamnese_dossie",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          clinicId,
        });
        const rawText: string = aiResult?.text || "";
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          aiPreConsultSummary = {
            summary: String(parsed.summary || ""),
            alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map((a: any) => ({ type: String(a?.type || "info"), title: String(a?.title || ""), description: String(a?.description || "") })) : [],
            suggestedFocus: Array.isArray(parsed.suggestedFocus) ? parsed.suggestedFocus.map(String) : [],
            generatedAt: new Date().toISOString(),
          };
          await anamnesisRef.set({ aiPreConsultSummary }, { merge: true });
        }
      } catch (aiErr: any) {
        console.error("[PATIENT_PORTAL_ANAMNESIS_AI_ERROR]", aiErr?.message || aiErr);
      }

      await createPortalPendingItem(clinicId, patientId, patientName, {
        type: "patient_portal_anamnesis_submitted",
        title: `Anamnese respondida — ${patientName}`,
        description: `Queixa principal: ${chiefComplaint || "não informada"}.${aiPreConsultSummary?.summary ? ` Resumo da Eliza: ${aiPreConsultSummary.summary}` : " Revisar anamnese completa no prontuário antes do atendimento."}`,
      });

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_ANAMNESIS_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar anamnese." });
    }
  });

  // Foto de perfil enviada pelo próprio paciente — mesmo padrão de storage
  // do resto do app (base64 direto no doc, sem Storage), mas com teto mais
  // apertado (é só um avatar, não um exame): ~700KB de base64 já cobre uma
  // foto de celular bem comprimida.
  app.post("/api/patient-portal/profile-photo", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const { photoBase64 } = req.body || {};
      if (!photoBase64 || typeof photoBase64 !== "string" || !photoBase64.startsWith("data:image/")) {
        return res.status(400).json({ success: false, error: "Envie uma foto válida." });
      }
      if (photoBase64.length > 700_000) {
        return res.status(400).json({ success: false, error: "Foto muito grande — escolha uma imagem menor." });
      }
      const patientRef = adminDb.doc(`clinics/${clinicId}/patients/${patientId}`);
      const patientSnap = await patientRef.get();
      if (!patientSnap.exists) return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      await patientRef.update({ photoUrl: photoBase64, photoUpdatedAt: AdminFieldValue.serverTimestamp() });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_PROFILE_PHOTO_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar foto." });
    }
  });

  // --- Patient-initiated requests → real pending_items -------------------

  app.post("/api/patient-portal/requests/schedule", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const { reason, preferredDays, period, notes } = req.body || {};
      if (!reason) return res.status(400).json({ success: false, error: "Informe o motivo/procedimento." });
      const patientSnap = await adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get();
      const patientName = patientSnap.data()?.name || "Paciente";
      await createPortalPendingItem(clinicId, patientId, patientName, {
        type: "patient_portal_schedule_request",
        title: `Solicitação de horário — ${patientName}`,
        description: `Motivo: ${reason}. Dias preferidos: ${preferredDays || "sem preferência"}. Período: ${period || "sem preferência"}.${notes ? ` Obs: ${notes}` : ""}`,
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_REQ_SCHEDULE_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar solicitação." });
    }
  });

  app.post("/api/patient-portal/requests/return", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const { notes } = req.body || {};
      const patientSnap = await adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get();
      const patientName = patientSnap.data()?.name || "Paciente";

      const treatmentsSnap = await adminDb.collection(`clinics/${clinicId}/patients/${patientId}/treatments`).get();
      let lastTreatment: { description: string; professional: string | null; date: any } | null = null;
      treatmentsSnap.docs.forEach(d => {
        const t: any = d.data();
        const evs = (t.evolutions || []).slice().sort((a: any, b: any) => portalToMs(b.date) - portalToMs(a.date));
        const latestDate = evs[0]?.date;
        if (latestDate && (!lastTreatment || portalToMs(latestDate) > portalToMs(lastTreatment.date))) {
          lastTreatment = { description: t.description, professional: evs[0]?.professional || t.professional || null, date: latestDate };
        }
      });

      await createPortalPendingItem(clinicId, patientId, patientName, {
        type: "patient_portal_return_request",
        title: `Solicitação de retorno — ${patientName}`,
        description: `${lastTreatment ? `Relacionado ao tratamento "${(lastTreatment as any).description}" (profissional: ${(lastTreatment as any).professional || "não identificado"}).` : "Sem tratamento anterior identificado."}${notes ? ` Obs do paciente: ${notes}` : ""}`,
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_REQ_RETURN_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar solicitação." });
    }
  });

  app.post("/api/patient-portal/requests/quotation-interest", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const { quotationId, action } = req.body || {}; // action: 'interest' | 'talk' | 'schedule'
      if (!quotationId || !action) return res.status(400).json({ success: false, error: "Dados incompletos." });
      const [patientSnap, quotationSnap] = await Promise.all([
        adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get(),
        adminDb.doc(`clinics/${clinicId}/patients/${patientId}/quotations/${quotationId}`).get(),
      ]);
      if (!quotationSnap.exists) return res.status(404).json({ success: false, error: "Orçamento não encontrado." });
      const patientName = patientSnap.data()?.name || "Paciente";
      const quotation: any = quotationSnap.data();
      const actionLabel = action === "interest" ? "tem interesse no orçamento" : action === "talk" ? "quer conversar sobre o orçamento" : "quer agendar o orçamento";
      await createPortalPendingItem(clinicId, patientId, patientName, {
        type: "patient_portal_quotation_interest",
        title: `${patientName} ${actionLabel}`,
        description: `Orçamento "${quotation.title || quotationId}" — total ${quotation.totalValue || 0}.`,
        extra: { quotationId },
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_REQ_QUOTATION_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar solicitação." });
    }
  });

  // --- Patient <-> clinic messaging (real thread, not fire-and-forget) ---
  // clinics/{clinicId}/portal_conversations/{patientId} is the conversation
  // doc (same shape as the whatsapp_conversations/{id} pattern already used
  // elsewhere in this file) with a messages/ subcollection. Staff read/reply
  // directly via the Firestore client SDK — already covered by the
  // clinic-member wildcard rule, no new firestore.rules entry needed. Only
  // the patient side goes through these REST routes, since a patient has no
  // Firebase account and therefore no direct Firestore access.

  app.get("/api/patient-portal/messages", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const convoRef = adminDb.doc(`clinics/${clinicId}/portal_conversations/${patientId}`);
      const msgsSnap = await convoRef.collection("messages").orderBy("createdAt", "asc").limit(200).get();
      convoRef.set({ unreadByPatient: false }, { merge: true }).catch(() => {});
      return res.json({
        success: true,
        data: {
          messages: msgsSnap.docs.map(d => {
            const m: any = d.data();
            return { id: d.id, text: m.text, sender: m.sender, createdAt: m.createdAt?.toDate?.()?.toISOString?.() || null };
          }),
        },
      });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_MESSAGES_GET_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao carregar mensagens." });
    }
  });

  app.post("/api/patient-portal/messages", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ success: false, error: "Escreva uma mensagem." });
      if (text.length > 2000) return res.status(400).json({ success: false, error: "Mensagem muito longa." });

      const [patientSnap, clinicSnap] = await Promise.all([
        adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get(),
        adminDb.doc(`clinics/${clinicId}`).get(),
      ]);
      const patientName = patientSnap.data()?.name || "Paciente";
      const clinicData: any = clinicSnap.data() || {};

      const convoRef = adminDb.doc(`clinics/${clinicId}/portal_conversations/${patientId}`);
      const convoSnap = await convoRef.get();
      await convoRef.set({
        patientId,
        patientName,
        lastMessage: text,
        lastMessageAt: AdminFieldValue.serverTimestamp(),
        lastMessageSender: "patient",
        unreadByStaff: true,
        unreadByPatient: false,
        ...(convoSnap.exists ? {} : { createdAt: AdminFieldValue.serverTimestamp() }),
      }, { merge: true });
      await convoRef.collection("messages").add({
        text, sender: "patient", createdAt: AdminFieldValue.serverTimestamp(),
      });

      // Still one pending_item per message (not deduped) — this is what
      // makes ElizaAssistantContext's proactive-open listener (which only
      // reacts to newly-ADDED pending_items) fire for every message, not
      // just the first one of a conversation.
      const pendingRef = await createPortalPendingItem(clinicId, patientId, patientName, {
        type: "patient_portal_message",
        title: `Mensagem do paciente — ${patientName}`,
        description: text,
      });

      // Conversational auto-reply — always answers (unless the clinic
      // turned it off in Painel Admin) instead of only the narrow set of
      // "basic factual" questions the first version handled. It still
      // never invents anything: contact info, the patient's own next
      // appointment, and post-op guidance all come from real clinic data
      // passed in below; pricing/scheduling are explicitly off-limits and
      // routed to staff, and the pending_item above already guarantees the
      // "estou encaminhando" claim is true.
      try {
        if (clinicData.portalAiEnabled !== false) {
          const [nextAppointment, membersSnap, historySnap, knowledgeSnap] = await Promise.all([
            getPatientNextAppointment(clinicId, patientId),
            adminDb.collection(`clinics/${clinicId}/members`).get(),
            convoRef.collection("messages").orderBy("createdAt", "desc").limit(12).get(),
            adminDb.collection(`clinics/${clinicId}/portal_ai_knowledge`).orderBy("createdAt", "desc").limit(40).get(),
          ]);

          const activeMembers = membersSnap.docs.map(d => d.data() as any).filter(m => m.active !== false);
          const namesByRole = (roles: string[]) => activeMembers.filter(m => roles.includes(m.role)).map(m => m.name).filter(Boolean).join(", ");
          const secretaryNames = namesByRole(["Secretária", "Recepção"]);
          const financeNames = namesByRole(["Financeiro"]);
          const doctorNames = namesByRole(["Dentista", "Médico"]);

          const history = historySnap.docs.map(d => d.data() as any).reverse();
          const transcript = history.map(m => `${m.sender === "patient" ? "Paciente" : m.sender === "staff" ? "Equipe" : "Eliza"}: ${m.text}`).join("\n");
          const postOp = String(clinicData.portalAiPostOpInstructions || "").trim();

          // Every real staff reply in the chat gets captured as a learned
          // Q&A pair (see the "Aprovar"/reply flow in NextPortalActivity.tsx)
          // — this is that memory. Reusing one verbatim without a human
          // re-checking it is exactly what "peça autorização antes de
          // enviar" ruled out, so the model is only allowed to treat these
          // as a *suggestion* requiring approval, never an auto-send.
          const knowledgeEntries = knowledgeSnap.docs.map(d => d.data() as any);
          const knowledgeBlock = knowledgeEntries.length
            ? knowledgeEntries.map((k, i) => `${i + 1}. Pergunta parecida: "${k.question}" → Resposta que a equipe deu: "${k.answer}"`).join("\n")
            : "nenhuma resposta ensinada pela equipe ainda";

          const prompt = `Você é a Eliza, assistente de atendimento do Portal do Paciente da clínica "${clinicData.name || "a clínica"}". Converse com o paciente de forma natural, calorosa e breve, como uma secretária atenciosa faria pelo WhatsApp — cumprimente, pergunte o motivo do contato quando não estiver claro, e mantenha o fio da conversa usando o histórico abaixo.

O que você PODE fazer:
- Bater papo, tirar dúvidas simples e dar boas-vindas.
- Informar os dados reais de contato da clínica (endereço/telefone/whatsapp/e-mail) e a próxima consulta do paciente, listados abaixo.
- Compartilhar SOMENTE as orientações pós-operatórias abaixo quando perguntarem sobre cuidados pós-procedimento — nunca invente instrução clínica além do que está escrito ali.
- Direcionar o paciente para usar a opção "Solicitar horário" do próprio Portal quando ele quiser agendar.

O que você NUNCA pode fazer:
- Nunca informe, negocie ou estime valores/preços/orçamentos — se perguntarem, diga que vai encaminhar para a equipe.
- Nunca confirme, marque ou remarque um horário você mesma.
- Nunca invente diagnóstico, orientação clínica não listada abaixo, ou qualquer dado que não esteja nos blocos abaixo.
- Nunca envie diretamente ao paciente uma resposta baseada nas "respostas ensinadas pela equipe" abaixo — mesmo que a pergunta atual seja muito parecida com uma delas, isso sempre precisa de aprovação humana antes (veja "suggestedReplyForApproval" abaixo).

Quando o assunto for importante e precisar mesmo da equipe (dúvida clínica específica, reclamação, urgência, pedido de valores, ou algo fora do que você sabe responder), diga com naturalidade que já está encaminhando a mensagem para a secretária da clínica cuidar — isso é verdade, a equipe já foi avisada.

Dados reais da clínica:
- Endereço: ${clinicData.address || "não cadastrado"}
- Telefone: ${clinicData.phone || "não cadastrado"}
- WhatsApp: ${clinicData.whatsapp || "não cadastrado"}
- E-mail: ${clinicData.email || "não cadastrado"}

Próxima consulta deste paciente: ${nextAppointment ? `${nextAppointment.date} às ${nextAppointment.time || "horário não definido"}${nextAppointment.treatment ? ` (${nextAppointment.treatment})` : ""}` : "nenhuma consulta futura agendada"}

Equipe real desta clínica (para saber a quem encaminhar; mencione pelo nome só se soar natural):
- Secretária(s)/Recepção: ${secretaryNames || "não identificada no cadastro"}
- Financeiro: ${financeNames || "não identificado no cadastro"}
- Dentista(s)/Médico(s): ${doctorNames || "não identificado no cadastro"}

Orientações pós-operatórias autorizadas pela clínica (use somente isto, nada além):
${postOp || "nenhuma orientação cadastrada ainda pela clínica — se perguntarem, diga que vai confirmar com a equipe"}

Respostas reais que a equipe já deu para perguntas de pacientes no passado (memória da Eliza — use só como referência de como responder, NUNCA envie direto ao paciente sem aprovação):
${knowledgeBlock}

Histórico recente da conversa (mais recente por último; a última linha "Paciente:" é a mensagem que você deve responder agora):
${transcript}

Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{"reply": "sua resposta em português, curta e natural", "needsHumanAttention": true ou false, "suggestedReplyForApproval": "string vazia, ou uma resposta pronta baseada numa das perguntas ensinadas acima quando a pergunta atual for bem parecida com uma delas"}
"needsHumanAttention" deve ser true quando o assunto realmente precisa de alguém da equipe (valores, agendamento, dúvida clínica específica, reclamação, urgência, ou quando você preencheu "suggestedReplyForApproval"). "reply" nesse caso é só a mensagem imediata avisando que vai confirmar — nunca o conteúdo de "suggestedReplyForApproval".`;

          const aiResult = await generateElizaAIResponse({
            taskType: "portal_message_autoreply",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            clinicId,
          });
          const rawText: string = aiResult?.text || "";
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          let reply = "";
          let needsHumanAttention = false;
          let suggestedReplyForApproval = "";
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            reply = String(parsed.reply || "").trim();
            needsHumanAttention = parsed.needsHumanAttention === true;
            suggestedReplyForApproval = String(parsed.suggestedReplyForApproval || "").trim();
          }
          if (!reply) { reply = "Recebi sua mensagem! Já avisei nossa equipe e alguém vai te responder em breve."; needsHumanAttention = true; }

          await convoRef.collection("messages").add({ text: reply, sender: "ai", createdAt: AdminFieldValue.serverTimestamp() });
          await convoRef.set({
            lastMessage: reply,
            lastMessageAt: AdminFieldValue.serverTimestamp(),
            lastMessageSender: "ai",
            unreadByPatient: true,
            // A learned answer never reaches the patient on its own — it
            // waits here for a human to approve/reject from the thread
            // panel (NextPortalActivity.tsx). Overwrites any older draft;
            // only the latest question needs an answer.
            ...(suggestedReplyForApproval ? { pendingAiDraft: { text: suggestedReplyForApproval, basedOnQuestion: text, createdAt: AdminFieldValue.serverTimestamp() } } : {}),
          }, { merge: true });
          if (needsHumanAttention) await pendingRef.update({ priority: "Alta" });
        }
      } catch (aiErr: any) {
        console.error("[PATIENT_PORTAL_MESSAGE_AI_ERROR]", aiErr?.message || aiErr);
        // The "always responds" promise still holds even if the AI call
        // itself failed — a generic, non-invented acknowledgment, backed by
        // the pending_item above which really was created either way.
        try {
          const fallback = "Recebi sua mensagem! Já avisei nossa equipe e alguém vai te responder em breve.";
          await convoRef.collection("messages").add({ text: fallback, sender: "ai", createdAt: AdminFieldValue.serverTimestamp() });
          await convoRef.set({ lastMessage: fallback, lastMessageAt: AdminFieldValue.serverTimestamp(), lastMessageSender: "ai", unreadByPatient: true }, { merge: true });
        } catch { /* best-effort fallback only */ }
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_MESSAGE_POST_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar mensagem." });
    }
  });

  app.post("/api/patient-portal/reviews", portalSessionLimiter, patientPortalAuth, async (req: any, res) => {
    try {
      const { clinicId, patientId } = req.patientPortal;
      const { appointmentId, stars, comment } = req.body || {};
      const starsNum = Number(stars);
      if (!appointmentId || !starsNum || starsNum < 1 || starsNum > 5) {
        return res.status(400).json({ success: false, error: "Selecione de 1 a 5 estrelas para um atendimento válido." });
      }
      const apptSnap = await adminDb.doc(`clinics/${clinicId}/appointments/${appointmentId}`).get();
      if (!apptSnap.exists) return res.status(404).json({ success: false, error: "Atendimento não encontrado." });
      const appt: any = apptSnap.data();
      if (appt.patientId !== patientId) {
        return res.status(403).json({ success: false, error: "Este atendimento não pertence a este paciente." });
      }
      if (appt.status !== "finalizado") {
        return res.status(400).json({ success: false, error: "Só é possível avaliar atendimentos finalizados." });
      }
      const existingSnap = await adminDb.collection(`clinics/${clinicId}/patient_reviews`).where("appointmentId", "==", appointmentId).limit(1).get();
      if (!existingSnap.empty) {
        return res.status(409).json({ success: false, error: "Este atendimento já foi avaliado." });
      }
      await adminDb.collection(`clinics/${clinicId}/patient_reviews`).add({
        patientId, clinicId, appointmentId,
        professional: appt.dentistName || null,
        stars: starsNum,
        comment: (comment || "").trim() || null,
        createdAt: AdminFieldValue.serverTimestamp(),
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_REVIEW_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao enviar avaliação." });
    }
  });

  // --- Staff-side: generate / revoke portal access ------------------------

  app.post("/api/patient-portal/admin/generate-link", patientPortalStaffAuth, async (req: any, res) => {
    try {
      const { clinicId } = req.staffAuth;
      const { patientId } = req.body || {};
      if (!patientId) return res.status(400).json({ success: false, error: "patientId é obrigatório." });
      const patientSnap = await adminDb.doc(`clinics/${clinicId}/patients/${patientId}`).get();
      if (!patientSnap.exists) return res.status(404).json({ success: false, error: "Paciente não encontrado." });

      const rawToken = portalGenerateToken();
      await adminDb.collection("patient_portal_links").doc(portalHash(rawToken)).set({
        clinicId, patientId, active: true,
        createdBy: req.staffAuth.uid,
        createdAt: AdminFieldValue.serverTimestamp(),
      });
      return res.json({ success: true, data: { token: rawToken } });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_GENERATE_LINK_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao gerar link." });
    }
  });

  app.post("/api/patient-portal/admin/revoke-access", patientPortalStaffAuth, async (req: any, res) => {
    try {
      const { clinicId } = req.staffAuth;
      const { patientId } = req.body || {};
      if (!patientId) return res.status(400).json({ success: false, error: "patientId é obrigatório." });
      const [sessionsSnap, linksSnap] = await Promise.all([
        adminDb.collection("patient_portal_sessions").where("clinicId", "==", clinicId).where("patientId", "==", patientId).get(),
        adminDb.collection("patient_portal_links").where("clinicId", "==", clinicId).where("patientId", "==", patientId).get(),
      ]);
      const batch = adminDb.batch();
      sessionsSnap.docs.forEach(d => batch.delete(d.ref));
      linksSnap.docs.forEach(d => batch.update(d.ref, { active: false }));
      await batch.commit();
      return res.json({ success: true, data: { sessionsRevoked: sessionsSnap.size, linksRevoked: linksSnap.size } });
    } catch (err: any) {
      console.error("[PATIENT_PORTAL_REVOKE_ERROR]", err);
      return res.status(500).json({ success: false, error: "Erro ao revogar acessos." });
    }
  });

  // ==========================================================================
  // Cadastro → Checkout (Asaas) + 4 modalidades comerciais
  // ==========================================================================
  // Every write to `signups/{uid}` and `clinics/{id}/billing/subscription`
  // goes through here (Admin SDK) — firestore.rules blocks the client from
  // writing either directly, on purpose (see the rules file comments): a
  // clinic's own owner/admin must never be able to self-grant a paid status
  // via the browser console.

  async function checkoutAuth(req: any, res: any, next: any) {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Autenticação necessária." });
      }
      const decoded = await getAdminAuth().verifyIdToken(authHeader.substring(7));
      req.checkoutAuth = { uid: decoded.uid, email: decoded.email || "", name: decoded.name || decoded.email?.split("@")[0] || "Cliente" };
      next();
    } catch (err: any) {
      return res.status(401).json({ error: "Token inválido." });
    }
  }

  app.post("/api/auth/send-verification-email", checkoutAuth, async (req: any, res) => {
    try {
      const { email, name } = req.checkoutAuth;
      if (!email) return res.status(400).json({ error: "Conta sem e-mail." });
      const link = await getAdminAuth().generateEmailVerificationLink(email, {
        url: `${req.protocol}://${req.get("host")}/`,
      });
      await sendVerificationEmail(email, name, link);
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[CHECKOUT_SEND_VERIFICATION_ERROR]", err);
      return res.status(500).json({ error: "Falha ao enviar e-mail de verificação." });
    }
  });

  app.post("/api/checkout/create-session", checkoutAuth, async (req: any, res) => {
    try {
      const { uid, email, name } = req.checkoutAuth;
      const { planId, phone, cpfCnpj } = req.body || {};
      if (!planId || !phone || !cpfCnpj) {
        return res.status(400).json({ error: "planId, phone e cpfCnpj são obrigatórios." });
      }

      const signupRef = adminDb.doc(`signups/${uid}`);
      const existingSignup = (await signupRef.get()).data();

      // Idempotent retry: a checkout session already in flight just gets
      // re-returned, never re-created (avoids double-charging and
      // double-claiming a founder slot on page refresh / back-button).
      if (existingSignup?.status === "payment_processing" && existingSignup?.asaasCheckoutUrl) {
        return res.json({ checkoutUrl: existingSignup.asaasCheckoutUrl });
      }

      const planSnap = await adminDb.doc(`platform_plans/${planId}`).get();
      if (!planSnap.exists) return res.status(404).json({ error: "Plano não encontrado." });
      const plan = planSnap.data() as any;
      if (plan.salesEnabled === false) return res.status(400).json({ error: "Esta modalidade ainda não está disponível para venda." });

      // Price decision is a plain read here — NOT the atomic slot claim.
      // The slot is only actually consumed after the Asaas call below
      // succeeds (see the transaction further down). Deciding the price
      // this early (before calling Asaas, since Asaas needs a value) but
      // deferring the counter increment until after success is what stops a
      // failed/erroring Asaas call — bad CPF, network blip, missing API key
      // during setup, anything — from silently burning a founder slot that
      // never became a real subscription. This is exactly the bug a live
      // test caught: an early version claimed the slot before calling Asaas
      // and left it consumed on failure.
      const nowMs = Date.now();
      const promoRef = adminDb.doc("platform_config/founding_promo");
      const promoSnap = await promoRef.get();
      const promo = promoSnap.exists ? promoSnap.data() : null;
      const tentativeFounderOffer = !!promo?.active && (promo!.slotsClaimed || 0) < (promo!.totalSlots || 0) && plan.founderPriceCents != null;
      const contractedPriceCents = tentativeFounderOffer ? plan.founderPriceCents : plan.regularPriceCents;

      await signupRef.set({
        uid, name, email, phone, cpfCnpj,
        authProvider: existingSignup?.authProvider || "unknown",
        planRoleSelected: plan.planRole,
        status: "pending_payment",
        regularPriceCents: plan.regularPriceCents,
        contractedPriceCents,
        clinicId: existingSignup?.clinicId || null,
        createdAt: existingSignup?.createdAt || AdminFieldValue.serverTimestamp(),
        updatedAt: AdminFieldValue.serverTimestamp(),
      }, { merge: true });

      const customer = await findOrCreateAsaasCustomer({ name, email, cpfCnpj, phone, externalReference: uid });
      const subscription = await createAsaasSubscription({
        customerId: customer.id,
        valueCents: contractedPriceCents,
        description: `ELIZA — ${PLAN_ROLE_LABELS[plan.planRole as PlanRole] || plan.name}`,
        externalReference: uid,
      });

      // Only now — after Asaas actually confirmed a real subscription at
      // the founder price — does the slot get atomically claimed for real.
      // Known residual edge case: if two requests tie for the exact last
      // slot AND this one's Asaas call finishes first, the Asaas
      // subscription was already created at the founder price by the time
      // this transaction runs — if it then loses the re-check, the
      // customer keeps the founder price (contractedPriceCents already
      // sent to Asaas) but `founderOffer` here would read false. Rare
      // (requires a true simultaneous tie), doesn't shortchange the
      // customer, only risks the quota display being off by one in that
      // exact scenario — acceptable trade-off vs. the alternative of
      // burning a slot on every ordinary failure, which is the bug this
      // whole restructure exists to fix.
      let founderOffer = false;
      let founderPosition: number | null = null;
      if (tentativeFounderOffer) {
        const claimResult = await adminDb.runTransaction(async (tx: any) => {
          const freshPromoSnap = await tx.get(promoRef);
          const freshPromo = freshPromoSnap.exists ? freshPromoSnap.data() : null;
          const stillAvailable = !!freshPromo?.active && (freshPromo!.slotsClaimed || 0) < (freshPromo!.totalSlots || 0);
          if (stillAvailable) {
            tx.update(promoRef, { slotsClaimed: (freshPromo!.slotsClaimed || 0) + 1 });
          }
          return { claimed: stillAvailable, position: stillAvailable ? (freshPromo!.slotsClaimed || 0) + 1 : null };
        });
        founderOffer = claimResult.claimed;
        founderPosition = claimResult.position;
      }

      await signupRef.update({
        status: "payment_processing",
        founderOffer,
        founderPosition,
        promotionalStartAt: founderOffer ? new Date(nowMs).toISOString() : null,
        promotionalEndAt: founderOffer ? new Date(nowMs + 365 * 24 * 60 * 60 * 1000).toISOString() : null,
        asaasCustomerId: customer.id,
        asaasSubscriptionId: subscription.subscriptionId,
        asaasCheckoutUrl: subscription.checkoutUrl,
        updatedAt: AdminFieldValue.serverTimestamp(),
      });

      return res.json({ checkoutUrl: subscription.checkoutUrl });
    } catch (err: any) {
      console.error("[CHECKOUT_CREATE_SESSION_ERROR]", err);
      return res.status(500).json({ error: err?.message || "Falha ao iniciar o pagamento." });
    }
  });

  app.post("/api/asaas/webhook", express.json(), async (req, res) => {
    try {
      const token = req.headers["asaas-access-token"];
      if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
        return res.status(403).json({ error: "Token de webhook inválido." });
      }

      const { event, payment } = req.body || {};
      if (!payment?.id) return res.sendStatus(200);

      // Idempotency: Asaas can redeliver the same event on timeout/retry —
      // process a given payment id's confirmation exactly once.
      const eventLogRef = adminDb.doc(`asaas_webhook_events/${payment.id}`);
      const eventLogSnap = await eventLogRef.get();
      if (eventLogSnap.exists && eventLogSnap.data()?.processed) {
        return res.sendStatus(200);
      }
      await eventLogRef.set({ event, paymentId: payment.id, receivedAt: AdminFieldValue.serverTimestamp(), processed: false }, { merge: true });

      const isConfirmed = event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED";
      if (!isConfirmed || !payment.subscription) {
        return res.sendStatus(200);
      }

      const signupsSnap = await adminDb.collection("signups").where("asaasSubscriptionId", "==", payment.subscription).limit(1).get();
      if (signupsSnap.empty) {
        console.warn("[ASAAS_WEBHOOK] No signup found for subscription:", payment.subscription);
        return res.sendStatus(200);
      }
      const signupDoc = signupsSnap.docs[0];
      const signup = signupDoc.data() as any;

      await signupDoc.ref.update({ status: "paid", paidAt: AdminFieldValue.serverTimestamp(), updatedAt: AdminFieldValue.serverTimestamp() });
      await eventLogRef.update({ processed: true });

      try {
        await sendPaymentConfirmationEmail(signup.email, signup.name, {
          planLabel: PLAN_ROLE_LABELS[signup.planRoleSelected as PlanRole] || signup.planRoleSelected,
          priceCents: signup.contractedPriceCents,
          founderOffer: !!signup.founderOffer,
        });
      } catch (mailErr) {
        console.error("[ASAAS_WEBHOOK] Failed to send confirmation e-mail:", mailErr);
      }

      return res.sendStatus(200);
    } catch (err: any) {
      console.error("[ASAAS_WEBHOOK_ERROR]", err);
      return res.sendStatus(200); // never make Asaas retry-storm on our own bug
    }
  });

  app.post("/api/onboarding/finalize-billing", checkoutAuth, async (req: any, res) => {
    try {
      const { uid } = req.checkoutAuth;
      const { clinicId } = req.body || {};
      if (!clinicId) return res.status(400).json({ error: "clinicId é obrigatório." });

      const clinicSnap = await adminDb.doc(`clinics/${clinicId}`).get();
      if (!clinicSnap.exists || clinicSnap.data()?.ownerId !== uid) {
        return res.status(403).json({ error: "Você não é o proprietário desta clínica." });
      }

      const signupSnap = await adminDb.doc(`signups/${uid}`).get();
      const signup = signupSnap.data() as any;
      if (!signup || signup.status !== "paid") {
        return res.status(400).json({ error: "Nenhum pagamento confirmado encontrado para este usuário." });
      }

      await adminDb.doc(`clinics/${clinicId}/billing/subscription`).set({
        asaasCustomerId: signup.asaasCustomerId || null,
        asaasSubscriptionId: signup.asaasSubscriptionId || null,
        planRole: signup.planRoleSelected || null,
        status: "active",
        isFoundingClinic: !!signup.founderOffer,
        foundingPromoEndsAt: signup.promotionalEndAt || null,
        contractedPriceCents: signup.contractedPriceCents || null,
        createdAt: AdminFieldValue.serverTimestamp(),
        updatedAt: AdminFieldValue.serverTimestamp(),
      });
      await adminDb.doc(`signups/${uid}`).update({ clinicId, updatedAt: AdminFieldValue.serverTimestamp() });

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[FINALIZE_BILLING_ERROR]", err);
      return res.status(500).json({ error: "Falha ao vincular assinatura à clínica." });
    }
  });

  // Setting another user's password requires the Admin SDK — the client
  // SDK's secondary-auth-app trick (used elsewhere for creating accounts)
  // only works for account creation, never for updating an existing user's
  // credentials. This is the one Super Admin write that genuinely needs a
  // server endpoint rather than a direct client Firestore/Auth call.
  const PLATFORM_SUPER_ADMIN_EMAILS = ["janioteixeiracd@gmail.com", "juninhoteixeiraofc@gmail.com"];
  async function platformAdminAuth(req: any, res: any, next: any) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Token ausente." });
      const decoded = await getAdminAuth().verifyIdToken(authHeader.substring(7));
      const emailLower = (decoded.email || "").toLowerCase();
      let isAdmin = PLATFORM_SUPER_ADMIN_EMAILS.includes(emailLower);
      if (!isAdmin) {
        const adminSnap = await adminDb.doc(`platform_admins/${decoded.uid}`).get();
        isAdmin = adminSnap.exists && adminSnap.data()?.active === true;
      }
      if (!isAdmin) return res.status(403).json({ error: "Acesso restrito a administradores da plataforma." });
      req.platformAdmin = { uid: decoded.uid, email: emailLower };
      next();
    } catch (err: any) {
      return res.status(401).json({ error: "Token inválido." });
    }
  }

  app.post("/api/admin/clinics/:clinicId/set-owner-password", platformAdminAuth, async (req: any, res) => {
    try {
      const { clinicId } = req.params;
      const { newPassword } = req.body || {};
      if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ error: "A senha precisa ter pelo menos 6 caracteres." });
      }
      const clinicSnap = await adminDb.doc(`clinics/${clinicId}`).get();
      if (!clinicSnap.exists) return res.status(404).json({ error: "Clínica não encontrada." });
      const clinicData = clinicSnap.data() || {};
      const ownerId = clinicData.ownerId;
      if (!ownerId) return res.status(400).json({ error: "Esta clínica não tem um proprietário definido." });

      await getAdminAuth().updateUser(ownerId, { password: String(newPassword) });

      await adminDb.collection("platform_audit_logs").add({
        adminId: req.platformAdmin.uid,
        action: "[SUPER_ADMIN_OWNER_PASSWORD_RESET]",
        targetId: clinicId,
        targetType: "clinic",
        details: { ownerId, performedByEmail: req.platformAdmin.email },
        createdAt: AdminFieldValue.serverTimestamp(),
      });

      try {
        const ownerRecord = await getAdminAuth().getUser(ownerId);
        if (ownerRecord.email) {
          await sendAdminPasswordChangedEmail(ownerRecord.email, ownerRecord.displayName || clinicData.ownerName || "Cliente", clinicData.name || "sua clínica");
        }
      } catch (mailErr) {
        console.warn("[ADMIN_SET_OWNER_PASSWORD_MAIL_WARN]", mailErr);
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[ADMIN_SET_OWNER_PASSWORD_ERROR]", err);
      return res.status(500).json({ error: err?.message || "Falha ao redefinir a senha." });
    }
  });

  // Server-side (not the client secondary-auth-app trick used elsewhere)
  // because this needs to look up an EXISTING Auth account by e-mail —
  // something only the Admin SDK can do. Necessary because archiving a
  // clinic (soft delete) never touches the owner's Auth account, so
  // re-creating a clinic for someone who already has a login (e.g. lost
  // access to their old clinic) must reuse that account, not collide with
  // it via auth/email-already-in-use.
  app.post("/api/admin/create-clinic", platformAdminAuth, async (req: any, res) => {
    try {
      const { name, ownerName, ownerEmail, phone, planId, status, password } = req.body || {};
      if (!name || !ownerEmail || !password || String(password).length < 6) {
        return res.status(400).json({ error: "Nome, e-mail e senha (mín. 6 caracteres) são obrigatórios." });
      }
      const emailLower = String(ownerEmail).toLowerCase();

      let ownerId: string;
      let reusedExistingAccount = false;
      try {
        const existing = await getAdminAuth().getUserByEmail(emailLower);
        ownerId = existing.uid;
        reusedExistingAccount = true;
        await getAdminAuth().updateUser(ownerId, { password: String(password) });
      } catch (lookupErr: any) {
        if (lookupErr?.code !== "auth/user-not-found") throw lookupErr;
        const created = await getAdminAuth().createUser({
          email: emailLower,
          password: String(password),
          displayName: ownerName || undefined,
        });
        ownerId = created.uid;
      }

      const clinicRef = adminDb.collection("clinics").doc();
      const clinicId = clinicRef.id;

      await clinicRef.set({
        name,
        slug: String(name).toLowerCase().replace(/\s+/g, "-"),
        ownerId,
        ownerName: ownerName || "",
        ownerEmail: emailLower,
        phone: phone || "",
        planId: planId || "",
        status: status || "trial",
        active: true,
        createdAt: AdminFieldValue.serverTimestamp(),
        updatedAt: AdminFieldValue.serverTimestamp(),
      });

      await clinicRef.collection("members").doc(ownerId).set({
        uid: ownerId,
        role: "owner",
        active: true,
        joinedAt: AdminFieldValue.serverTimestamp(),
      });

      await adminDb.doc(`users/${ownerId}`).set({
        uid: ownerId,
        email: emailLower,
        name: ownerName || "",
        defaultClinicId: clinicId,
        updatedAt: AdminFieldValue.serverTimestamp(),
      }, { merge: true });

      await adminDb.doc(`platform_clinics/${clinicId}`).set({
        name,
        ownerEmail: emailLower,
        planId: planId || "",
        status: status || "trial",
        createdAt: new Date().toISOString(),
        updatedAt: AdminFieldValue.serverTimestamp(),
      }, { merge: true });

      await adminDb.collection("platform_audit_logs").add({
        adminId: req.platformAdmin.uid,
        action: reusedExistingAccount ? "[SUPER_ADMIN_CLINIC_CREATED_EXISTING_OWNER]" : "[SUPER_ADMIN_CLINIC_CREATED]",
        targetId: clinicId,
        targetType: "clinic",
        details: { ownerEmail: emailLower, ownerId, reusedExistingAccount },
        createdAt: AdminFieldValue.serverTimestamp(),
      });

      return res.json({ success: true, clinicId, uid: ownerId, reusedExistingAccount });
    } catch (err: any) {
      console.error("[ADMIN_CREATE_CLINIC_ERROR]", err);
      const friendly = err?.code === "auth/invalid-email" ? "E-mail inválido." : (err?.message || "Falha ao criar clínica.");
      return res.status(500).json({ error: friendly });
    }
  });

  app.post("/api/admin/notify-clinic", platformAdminAuth, async (req: any, res) => {
    try {
      const { to, name, clinicName, type, planLabel } = req.body || {};
      if (!to || !name || !clinicName || !type) {
        return res.status(400).json({ error: "Campos obrigatórios ausentes." });
      }
      if (type === "created") {
        await sendClinicCreatedEmail(to, name, clinicName);
      } else if (type === "plan_changed") {
        await sendPlanChangedEmail(to, name, clinicName, planLabel || "nova modalidade");
      } else {
        return res.status(400).json({ error: "Tipo de notificação desconhecido." });
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[ADMIN_NOTIFY_CLINIC_ERROR]", err);
      return res.status(500).json({ error: err?.message || "Falha ao enviar notificação." });
    }
  });

  console.log("[ELIZA] Platform Admin routes initialized (/api/admin/*)");

  console.log("[ELIZA] Checkout/Asaas routes initialized (/api/checkout/*, /api/asaas/webhook)");

  console.log("[ELIZA] Patient Portal routes initialized (/api/patient-portal/*)");

  // Serve static assets or mount Vite dev server
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        // Vite content-hashes everything under /assets/ (the filename
        // changes whenever the content does), so it's safe to tell every
        // layer (browser, CDN, the service worker) to cache it forever.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }
        // sw.js, manifest.json and index.html drive the PWA's update
        // detection — the browser re-checks sw.js on every navigation by
        // byte-comparing it, and a stale cached copy (from an aggressive
        // CDN/proxy cache) would silently block updates from ever being
        // noticed. Same risk for manifest.json/index.html referencing a
        // stale icon or stale bundle path after a deploy.
        const base = path.basename(filePath);
        if (base === 'sw.js' || base === 'manifest.json' || base === 'index.html' || base === 'offline.html') {
          res.setHeader('Cache-Control', 'no-cache');
          return;
        }
        // Everything else static (brand assets, icons, splash screens):
        // moderate cache, revalidated daily — these rarely change, but
        // aren't content-hashed, so "immutable" would be unsafe if the
        // source art is ever swapped without renaming the file.
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  console.log("META_PHONE_NUMBER_ID", process.env.WHATSAPP_PHONE_NUMBER_ID);
  console.log("META_WABA_ID", process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[ELIZA_SERVER] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
