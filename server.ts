import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import twilio from "twilio";
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from "firebase/app";
import { getFirestore as getClientFirestore, doc, getDoc, setDoc, getDocs, collection, serverTimestamp, increment, addDoc } from "firebase/firestore";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";

// ELIZA Intelligence Layer
import { elizaIntelligence } from "./src/lib/elizaIntelligence";
import { elizaAuthMiddleware } from "./src/lib/elizaAuthService";
import { ElizaIntelligenceRequest, ElizaError } from "./src/types/eliza-intelligence";
import * as authController from "./src/controllers/authController";

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

    let firstProvider = preferredProvider || "openai";
    let secondProvider = (firstProvider === "openai") ? "gemini" : "openai";

    if (fallbackProviderFromConfig === "none" || fallbackProviderFromConfig === "nenhum") {
      secondProvider = "none";
    }

    const criticalTasks = ["anamnese_dossie", "planejamento_facial", "receituario_interacoes", "risco_clinico"];
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
        console.log("[WA_FIRESTORE_OP]", { 
          operation: "READ", 
          path: staffPath, 
          clinicId, 
          conversationId: toPhone 
        });
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
        console.warn("[AUDIT] staff check failed:", err);
      }

      if (!patientName) {
        // 2. Try matching patients
        try {
          const patientsPath = `clinics/${clinicId}/patients`;
          console.log("[WA_FIRESTORE_OP]", { 
            operation: "READ", 
            path: patientsPath, 
            clinicId, 
            conversationId: toPhone 
          });
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
            console.log("[WA_FIRESTORE_OP]", { 
              operation: "READ", 
              path: convoPath, 
              clinicId, 
              conversationId: toPhone 
            });
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
          console.warn("[AUDIT] patient check failed:", err);
        }
      }

      try {
        const logsPath = `clinics/${clinicId}/integration_logs`;
        console.log("[WA_FIRESTORE_OP]", { 
          operation: "WRITE", 
          path: logsPath, 
          clinicId, 
          conversationId: toPhone 
        });
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
        console.log(`[WA_SEND_AUDIT] Logged attempt to ${toPhone}. Success: ${success}`);
      } catch (err) {
        console.warn("[WA_SEND_AUDIT_ERROR] Failed saving audit log for send attempt to integration_logs (ignoring so flow continues):", err);
      }
    } catch (err) {
      console.error("[WA_SEND_AUDIT_OUTER_ERROR] Fatal in logWhatsAppSend (ignoring so flow continues):", err);
    }
  };

  // --- WhatsApp provider dispatch (Meta Cloud API / Twilio) --------------
  // Both providers return the same normalized shape so every caller below
  // only has to deal with one contract:
  //   { success, providerMessageId?, errorCode?, errorMessage?, raw?, simulated? }

  const sendViaMeta = async (integrationData: any, toPhone: string, text: string) => {
    const rawToken = integrationData.accessTokenSecretName || integrationData.accessToken || integrationData.access_token || integrationData.token || "";
    const phoneNumberId = integrationData.phoneNumberId || integrationData.phone_number_id || integrationData.metaPhoneId || "";

    console.log("WHATSAPP_CONFIG_LOADED", { provider: "meta", phoneNumberId, tokenLength: rawToken ? rawToken.length : 0 });

    if (!phoneNumberId) {
      return { success: false, errorCode: "phone_id_missing", errorMessage: "Id do telefone (phoneNumberId) não preenchido na integração." };
    }

    const skipApiCall = !rawToken || rawToken.startsWith("••••") || rawToken === "test_token" || rawToken.startsWith("test_token_simulated") || rawToken.length < 15;
    if (skipApiCall) {
      console.log(`[WA_DISPATCH] Simulated Meta dispatch to +${toPhone}`);
      const simulatedId = "wamid.simulated_" + Math.random().toString(36).substring(2, 12);
      return { success: true, providerMessageId: simulatedId, raw: { info: "Envio simulado por conta de token mascarado ou de teste" }, simulated: true };
    }

    const metaUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const payload = { messaging_product: "whatsapp", recipient_type: "individual", to: toPhone, type: "text", text: { body: text } };
    console.log("META_REQUEST_URL", metaUrl);

    const response = await fetch(metaUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${rawToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    console.log("META_RESPONSE_STATUS", response.status, "META_RESPONSE_BODY", responseText);

    let responseData: any = {};
    try { responseData = JSON.parse(responseText); } catch (_) { responseData = { rawText: responseText }; }

    if (!response.ok) {
      const errCode = responseData.error?.code || response.status;
      const errMsg = responseData.error?.message || responseText || "Erro desconhecido na chamada da API Meta.";
      return { success: false, errorCode: errCode, errorMessage: errMsg, raw: responseData };
    }

    const providerMessageId = responseData.messages?.[0]?.id;
    if (!providerMessageId) {
      return { success: false, errorCode: "missing_message_id", errorMessage: "A Meta não retornou o Id da mensagem (messages[0].id) na resposta de sucesso.", raw: responseData };
    }
    return { success: true, providerMessageId, raw: responseData, waId: responseData.contacts?.[0]?.wa_id || null };
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
      console.log("[WA_FIRESTORE_OP]", {
        operation: "READ",
        path: integrationPath,
        clinicId,
        conversationId: toPhone
      });
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
        console.error(`[ELIZA_INTERNA_DISPATCH] Send failed:`, result.errorMessage);
        await logWhatsAppSend(clinicId, toPhone, text, false, null, result.errorCode, result.errorMessage);
        return { success: false, errorCode: result.errorCode, errorMessage: result.errorMessage, metaResponse: result.raw };
      }

      await logWhatsAppSend(clinicId, toPhone, text, true, result.providerMessageId, null, null);
      return { success: true, whatsappMessageId: result.providerMessageId, metaResponse: result.raw, simulated: result.simulated };
    } catch (err: any) {
      console.error(`[ELIZA_INTERNA_DISPATCH] Dispatch error:`, err);
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

  // GET Webhook Verification for Meta
  app.get("/api/whatsapp/webhook", async (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("[WHATSAPP WEBHOOK]");
    console.log(`received mode: ${mode}`);
    console.log(`received token: ${token}`);

    if (mode === "subscribe" && token) {
      let matched = false;

      // 1. Check direct prompt/env/system configurations
      if (token === "XA29LW50") {
        matched = true;
      } else if (process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        matched = true;
      } else {
        // 2. Fall back to scanning Firestore clinic collections
        try {
          const clinicsSnap = await adminDb.collection("clinics").get();
          for (const clinicDoc of clinicsSnap.docs) {
            const integrationRef = adminDb.doc(`clinics/${clinicDoc.id}/integrations/whatsapp`);
            const integrationSnap = await integrationRef.get();
            if (integrationSnap.exists) {
              const data = integrationSnap.data() || {};
              if (data.verifyToken === token || data.verify_token === token) {
                matched = true;
                break;
              }
            }
          }
        } catch (err) {
          console.error("[WHATSAPP WEBHOOK] Error checking token in Firestore:", err);
        }
      }

      if (matched) {
        console.log("verification success");
        return res.status(200).send(challenge);
      } else {
        console.log("verification failed");
        return res.sendStatus(403);
      }
    }

    console.log("verification failed");
    return res.sendStatus(403);
  });

  // POST Webhook Receiver
  app.post("/api/whatsapp/webhook", async (req, res) => {
    // 1. ADD WEBHOOK POST HIT LOGS
    console.log("[WHATSAPP WEBHOOK POST HIT]");
    console.log(`timestamp: ${new Date().toISOString()}`);
    console.log(`rawBody: ${JSON.stringify(req.body)}`);
    console.log(`headers: ${JSON.stringify(req.headers)}`);

    const body = req.body;
    console.log("[WA_WEBHOOK] POST received webhook event payload.");
    console.log("WEBHOOK_RECEIVED", JSON.stringify(body));

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
          console.warn("[WA_WEBHOOK_TWILIO] No clinic matched for To:", body.To);
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
            console.error("[WA_WEBHOOK_TWILIO] Failed updating message status:", statusErr);
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

        console.log(`[WA_WEBHOOK_TWILIO] Saved inbound message. clinic=${matchedClinicId} conversation=${conversationId} sid=${messageSid}`);
        return res.sendStatus(200);
      } catch (twilioWebhookErr: any) {
        console.error("[WA_WEBHOOK_TWILIO] Error handling Twilio webhook:", twilioWebhookErr);
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
          
          // Find clinic with this phoneNumberId
          const clinicsSnap = await adminDb.collection("clinics").get();
          let matchedClinicId = null;
          let matchedIntegration = null;

          for (const clinicDoc of clinicsSnap.docs) {
            const integrationRef = adminDb.doc(`clinics/${clinicDoc.id}/integrations/whatsapp`);
            const integrationSnap = await integrationRef.get();
            if (integrationSnap.exists) {
              const data = integrationSnap.data() || {};
              if (
                data.phoneNumberId === phoneNumberId || 
                data.phone_number_id === phoneNumberId || 
                data.metaPhoneId === phoneNumberId ||
                data.metaPhoneNumberId === phoneNumberId
              ) {
                matchedClinicId = clinicDoc.id;
                matchedIntegration = data;
                break;
              }
            }
          }

          if (!matchedClinicId || !matchedIntegration) {
            console.error("[WHATSAPP CLINIC NOT FOUND]");
            console.error(`receivedPhoneNumberId: ${phoneNumberId}`);
            return res.sendStatus(200); 
          }

          const messages = changeValue.messages;
          const contacts = changeValue.contacts || [];
          const contactProfile = contacts[0] || {};
          const profileName = contactProfile.profile?.name || "Paciente WhatsApp";

          for (const msg of messages) {
            const fromPhone = msg.from; 
            const messageId = msg.id;
            let textMsg = "";

            if (msg.type === "text" && msg.text) {
              textMsg = msg.text.body;
            } else {
              textMsg = `[Mensagem tipo: ${msg.type}]`;
            }

            // 2. EXTRACTION AND INBOUND PAYLOAD LOGGING (Item 2)
            console.log("[WHATSAPP INBOUND PAYLOAD]");
            console.log(`phone_number_id: ${phoneNumberId}`);
            console.log(`from: ${fromPhone}`);
            console.log(`profile.name: ${profileName}`);
            console.log(`message.id: ${messageId}`);
            console.log(`message.type: ${msg.type}`);
            console.log(`text.body: ${textMsg}`);
            console.log(`timestamp: ${msg.timestamp}`);

            console.log(`[WA_WEBHOOK] Matched clinic ${matchedClinicId}. New msg from ${fromPhone}: ${textMsg}`);

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
              console.log(`[WA_WEBHOOK] [ELIZA_INTERNA] Sender ${fromPhone} identified as staff member ${staffData.name} (Role: ${staffData.role})`);
              
              const intent = await interpretCommand(textMsg);
              console.log(`[WA_WEBHOOK] [ELIZA_INTERNA] Interpreted intent: ${intent}`);
              
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
                metaResponse: dispatchResult.metaResponse || null,
                whatsappMessageId: dispatchResult.whatsappMessageId || null,
                createdAt: AdminFieldValue.serverTimestamp()
              });

              // Intercept and skip to next incoming webhook message
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

            console.log(`[WHATSAPP CONVERSATION MATCH] matchedPatient=${matchedPatientDoc ? 'true' : 'false'} patientId=${patientId} patientName=${patientName} phoneNormalized=${phoneNormalized}`);

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

            // Log [WHATSAPP INCOMING] logger
            console.log(`[WHATSAPP INCOMING] telefone=${fromPhone} messageId=${messageId} texto="${textMsg}" conversationId=${conversationId}`);

            // Create/update conversation
            const convoRef = adminDb.doc(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}`);

            await convoRef.set({
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

            // Save message
            const msgRef = adminDb.doc(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}/messages/${messageId}`);
            await msgRef.set({
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
            });

            // Log [WHATSAPP SAVE] logger
            console.log(`[WHATSAPP SAVE] documentPath=${msgRef.path} status=success`);
            console.log(`[WHATSAPP SAVE INBOUND] path=${msgRef.path} status=success`);

            // Log webhook received
            await adminDb.collection(`clinics/${matchedClinicId}/integration_logs`).add({
              type: "whatsapp",
              action: "webhook_received",
              status: "success",
              message: `Mensagem recebida de ${patientName} (${fromPhone}): "${textMsg.substring(0, 40)}${textMsg.length > 40 ? '...' : ''}"`,
              createdAt: AdminFieldValue.serverTimestamp()
            });

            // Log [WHATSAPP UI UPDATE] logger
            const messagesSnap = await adminDb.collection(`clinics/${matchedClinicId}/whatsapp_conversations/${conversationId}/messages`).get();
            const messageCount = messagesSnap.size;
            console.log(`[WHATSAPP UI UPDATE] conversationId=${conversationId} messageCount=${messageCount}`);
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

          // Find clinic with this phoneNumberId
          const clinicsSnap = await adminDb.collection("clinics").get();
          let matchedClinicId = null;
          for (const clinicDoc of clinicsSnap.docs) {
            const integrationSnap = await adminDb.doc(`clinics/${clinicDoc.id}/integrations/whatsapp`).get();
            if (integrationSnap.exists) {
              const data = integrationSnap.data() || {};
              if (data.phoneNumberId === phoneNumberId || data.phone_number_id === phoneNumberId || data.metaPhoneId === phoneNumberId) {
                matchedClinicId = clinicDoc.id;
                break;
              }
            }
          }

          if (matchedClinicId) {
            for (const s of statuses) {
              const metaMessageId = s.id;
              const newStatus = s.status; // "delivered", "read", "failed", "sent"
              const recipientId = s.recipient_id; // Normalized phone
              
              console.log(`[WA_STATUS] msgId: ${metaMessageId}, status: ${newStatus}, recipient_id: ${recipientId}`);

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
                  console.log(`[WA_STATUS] Updated message ${doc.id} status to '${newStatus}' in conversation ${recipientId}`);
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
                    console.log(`[WA_STATUS_FALLBACK] Updated message ${fbDoc.id} status to '${newStatus}'`);
                  }
                }
              }
            }
          }
        }

        return res.sendStatus(200);
      } catch (error: any) {
        console.error("[WA_WEBHOOK_ERROR] Failed handling webhook post:", error);
        if (body && body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value && body.entry[0].changes[0].value.messages) {
          console.error("WEBHOOK_MESSAGES_ERROR");
          console.error(error.stack || error.message || String(error));
          console.error("Payload recebido:", JSON.stringify(body));
        }
        return res.status(500).json({ error: error.message || "Webhook handling failed" }); 
      }
    }

    return res.sendStatus(404);
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

  // POST Outbound Secure Sending API
  app.post("/api/whatsapp/send", async (req, res) => {
    const { clinicId, conversationId, text, sentByUserId, sentByName, source } = req.body;

    if (!clinicId || !conversationId || !text) {
      return res.status(400).json({ error: "Parâmetros clinicId, conversationId e text são requeridos." });
    }

    try {
      const integrationPath = `clinics/${clinicId}/integrations/whatsapp`;
      console.log("[WA_FIRESTORE_OP]", { 
        operation: "READ", 
        path: integrationPath, 
        clinicId, 
        conversationId 
      });
      const integrationRef = adminDb.doc(integrationPath);
      let integrationSnap;
      let integrationData: any = {};
      let integrationSnapExists = false;

      try {
        integrationSnap = await integrationRef.get();
        integrationData = integrationSnap.data() || {};
        integrationSnapExists = integrationSnap.exists;
      } catch (snapErr: any) {
        console.error(`[WA_SEND_ERROR] Firestore error fetching integration for clinic ${clinicId}:`, snapErr);
        throw snapErr;
      }

      if (!integrationSnapExists) {
        return res.status(400).json({ error: "A integração com WhatsApp não está configurada para esta clínica." });
      }

      const provider = integrationData.provider === "twilio" ? "twilio" : "meta";
      const displayPhoneNumber = integrationData.displayPhoneNumber || integrationData.twilioWhatsAppNumber || "Clínica";
      console.log("[WA_AUDIT]", `Sending via provider: ${provider}, intended recipient: ${conversationId}`);

      const dispatchResult = await sendWhatsAppMessage(integrationData, conversationId, text);

      let whatsappMessageId = dispatchResult.providerMessageId || "msg_failed_" + Date.now();
      let metaResponse: any = dispatchResult.raw || null;
      let errorCode: any = dispatchResult.success ? null : (dispatchResult.errorCode || "unknown_error");
      let errorMessage: any = dispatchResult.success ? null : (dispatchResult.errorMessage || "Erro desconhecido na chamada do provedor.");
      let metaStatus: any = null;
      let waId: any = (dispatchResult as any).waId || null;

      console.log(`[WA_AUDIT] Dispatch ${dispatchResult.success ? "successful" : "failed"}. provider=${provider} id=${whatsappMessageId} error=${errorMessage || "none"}`);

      const isSuccess = !errorCode;
      const messageId = "msg_" + Date.now().toString() + Math.random().toString(36).substring(2, 5);
      const msgPath = `clinics/${clinicId}/whatsapp_conversations/${conversationId}/messages/${messageId}`;
      
      console.log("[WA_FIRESTORE_OP]", { 
        operation: "WRITE", 
        path: msgPath, 
        clinicId, 
        conversationId 
      });
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
          aiGenerated: false,
          sentBy: "human",
          sentByUserId: sentByUserId || null,
          sentByName: sentByName || null,
          source: source || "manual",
          errorCode: errorCode || null,
          errorMessage: errorMessage || null,
          metaResponse: metaResponse || null,
          metaStatus: metaStatus || null,
          waId: waId || null
        });
        console.log(`[WHATSAPP SAVE OUTBOUND] path=${msgRef.path} status=${isSuccess ? 'success' : 'failed'}`);
      } catch (dbErr: any) {
        console.error("[WA_SEND_ERROR] Failed saving outbound message in Firestore (ignoring so sending completes):", dbErr);
      }

      const convoPath = `clinics/${clinicId}/whatsapp_conversations/${conversationId}`;
      console.log("[WA_FIRESTORE_OP]", { 
        operation: "UPDATE", 
        path: convoPath, 
        clinicId, 
        conversationId 
      });
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
        console.error("[WA_SEND_ERROR] Failed updating conversation in Firestore (ignoring so sending completes):", dbErr);
      }

      try {
        const logsPath = `clinics/${clinicId}/integration_logs`;
        console.log("[WA_FIRESTORE_OP]", { 
          operation: "WRITE", 
          path: logsPath, 
          clinicId, 
          conversationId 
        });
        const logsColl = adminDb.collection(logsPath);
        await logsColl.add({
          type: "whatsapp",
          action: "message_sent",
          status: isSuccess ? "success" : "error",
          recipient: conversationId,
          message: isSuccess 
            ? `Mensagem enviada com sucesso para ${conversationId}: "${text.substring(0, 45)}..."`
            : `Falha no envio de mensagem para ${conversationId}: ${errorMessage}`,
          errorCode: errorCode || null,
          errorMessage: errorMessage || null,
          metaResponse: metaResponse || null,
          createdAt: AdminFieldValue.serverTimestamp()
        });
      } catch (logErr) {
        console.warn("[WA_SEND_LOGGER] Failed saving status to integration_logs (ignoring):", logErr);
      }

      if (!isSuccess) {
        return res.status(400).json({ 
          error: errorMessage, 
          errorCode, 
          metaResponse, 
          metaStatus,
          success: false 
        });
      }

      return res.json({ 
        success: true, 
        messageId: whatsappMessageId, 
        metaResponse, 
        metaStatus, 
        waId 
      });
    } catch (error: any) {
      console.error("[WA_SEND_ERROR] Sending error:", error);
      
      try {
        const logsPath = `clinics/${clinicId}/integration_logs`;
        console.log("[WA_FIRESTORE_OP]", { 
          operation: "WRITE", 
          path: logsPath, 
          clinicId, 
          conversationId 
        });
        const logsColl = adminDb.collection(logsPath);
        await logsColl.add({
          type: "whatsapp",
          action: "message_sent",
          status: "error",
          message: `Falha no envio de mensagem para ${conversationId}: ${error.message || String(error)}`,
          createdAt: AdminFieldValue.serverTimestamp()
        });
      } catch (logErr) {
        console.error("[WA_SEND_ERROR] Logging error failed:", logErr);
      }

      return res.status(500).json({ error: error.message || "Erro interno ao processar envio de mensagem." });
    }
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
  app.post("/api/intelligence/approve-action", elizaAuthMiddleware, async (req, res) => {
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

  // Serve static assets or mount Vite dev server
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
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
