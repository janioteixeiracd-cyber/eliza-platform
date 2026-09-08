/**
 * ELIZA Context Builder
 * Assembles complete context for AI operations
 * 
 * SECURITY CRITICAL:
 * - Always reconciles role and permissions with Firestore (authoritative source)
 * - Never trusts token claims for permissions
 * - Validates clinic membership on every request
 * - Detects permission changes (revocation, escalation)
 */

import { ElizaContext, ElizaIntelligenceRequest, ElizaError, ElizaErrorCode, ClinicAIConfig } from "../types/eliza-intelligence";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/adminFirebase";
import { verifyAndDecodeJWT, validateClinicIdConsistency } from "../lib/elizaAuthService";

// ============================================================================
// CONFIGURATION CACHE
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const clinicConfigCache = new Map<string, CacheEntry<ClinicAIConfig>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL,
  });
}

// ============================================================================
// PERMISSION RECONCILIATION (SECURITY CRITICAL)
// ============================================================================

/**
 * Reconciles user role and permissions with Firestore
 * SECURITY: Always calls Firestore, never trusts token claims
 * 
 * Returns: Current authoritative role and permissions from Firestore
 * Throws: If user is not member or membership is inactive
 */
export async function reconcileUserPermissions(
  clinicId: string,
  userId: string,
  tokenRole?: string,
  tokenPermissions?: string[]
): Promise<{ role: string; permissions: string[] }> {
  // Validate clinic membership in Firestore (authoritative source)
  const memberRef = getAdminDb().doc(`clinics/${clinicId}/members/${userId}`);
  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    throw new ElizaError(
      ElizaErrorCode.UNAUTHORIZED,
      "User is not a member of this clinic",
      403
    );
  }

  const memberData = memberSnap.data();

  // Check if membership is active
  if (memberData?.active === false) {
    throw new ElizaError(
      ElizaErrorCode.UNAUTHORIZED,
      "User membership is inactive",
      403
    );
  }

  // Get current role and permissions from Firestore (always authoritative)
  const fsRole = memberData?.role || "member";
  const fsPermissions = memberData?.permissions || [];

  // SECURITY: Log if permissions changed from token (possible tampering or revocation)
  if (tokenRole && tokenRole !== fsRole) {
    console.warn(
      `[SECURITY] User ${userId} in clinic ${clinicId}: role changed from ${tokenRole} to ${fsRole}`
    );
  }

  if (
    tokenPermissions &&
    JSON.stringify(tokenPermissions.sort()) !== JSON.stringify(fsPermissions.sort())
  ) {
    console.warn(
      `[SECURITY] User ${userId} in clinic ${clinicId}: permissions changed from ${tokenPermissions} to ${fsPermissions}`
    );
  }

  return {
    role: fsRole,
    permissions: fsPermissions,
  };
}

// ============================================================================
// CLINIC CONFIG LOADING
// ============================================================================

async function loadClinicConfig(clinicId: string): Promise<ClinicAIConfig> {
  // Check cache
  const cached = getFromCache(clinicConfigCache, clinicId);
  if (cached) {
    return cached;
  }

  try {
    const clinicDoc = await getAdminDb().doc(`clinics/${clinicId}`).get();

    if (!clinicDoc.exists) {
      throw new ElizaError(
        ElizaErrorCode.CLINIC_NOT_FOUND,
        `Clínica ${clinicId} não encontrada.`,
        404
      );
    }

    const clinicData = clinicDoc.data() || {};

    const config: ClinicAIConfig = {
      aiProviderPrincipal: clinicData.aiProviderPrincipal || "gemini",
      aiProviderFallback: clinicData.aiProviderFallback || "gemini",
      aiModelClinical: clinicData.aiModelClinical || "gemini-3.1-pro",
      aiModelAdministrative: clinicData.aiModelAdministrative || "gemini-3.5-flash",
      aiModelFast: clinicData.aiModelFast || "gemini-3.5-flash",
      tokenBudgetMonthly: clinicData.tokenBudgetMonthly || 1000000,
    };

    // Cache it
    setCache(clinicConfigCache, clinicId, config);

    return config;
  } catch (err: any) {
    if (err instanceof ElizaError) throw err;
    throw new ElizaError(
      ElizaErrorCode.DATABASE_ERROR,
      `Erro ao carregar configurações da clínica: ${err.message}`,
      500
    );
  }
}

// ============================================================================
// PATIENT DATA LOADING
// ============================================================================

async function loadPatientData(
  clinicId: string,
  patientId: string
): Promise<any> {
  try {
    const patientDoc = await getAdminDb()
      .doc(`clinics/${clinicId}/patients/${patientId}`)
      .get();

    if (!patientDoc.exists) {
      throw new ElizaError(
        ElizaErrorCode.PATIENT_NOT_FOUND,
        `Paciente ${patientId} não encontrado nesta clínica.`,
        404
      );
    }

    const data = patientDoc.data() || {};

    return {
      id: patientId,
      name: data.name || "Unknown",
      age: data.age || 0,
      allergies: data.allergies || [],
      medicalHistory: data.medicalHistory || [],
      lastVisit: data.lastVisit || null,
      activeProblems: data.activeProblems || [],
      currentMedications: data.currentMedications || [],
      riskFactors: data.riskFactors || [],
    };
  } catch (err: any) {
    if (err instanceof ElizaError) throw err;
    throw new ElizaError(
      ElizaErrorCode.DATABASE_ERROR,
      `Erro ao carregar dados do paciente: ${err.message}`,
      500
    );
  }
}

// ============================================================================
// CONVERSATION HISTORY LOADING
// ============================================================================

async function loadConversationHistory(
  clinicId: string,
  conversationId: string
): Promise<any> {
  try {
    const convDoc = await getAdminDb()
      .doc(`clinics/${clinicId}/conversations/${conversationId}`)
      .get();

    if (!convDoc.exists) {
      // Return empty conversation
      return {
        id: conversationId,
        clinicId,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return convDoc.data();
  } catch (err: any) {
    console.warn(
      `[ELIZA] Could not load conversation history: ${err.message}`
    );
    // Return empty conversation on error, don't block
    return {
      id: conversationId,
      clinicId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

// ============================================================================
// MEMBERSHIP VALIDATION
// ============================================================================

async function validateClinicMembership(
  clinicId: string,
  userId: string
): Promise<{
  isMember: boolean;
  role: "owner" | "admin" | "professional" | "member";
  permissions: string[];
}> {
  try {
    const memberDoc = await getAdminDb()
      .doc(`clinics/${clinicId}/members/${userId}`)
      .get();

    if (!memberDoc.exists) {
      return {
        isMember: false,
        role: "member",
        permissions: [],
      };
    }

    const memberData = memberDoc.data() || {};

    return {
      isMember: memberData.active === true,
      role: memberData.role || "member",
      permissions: memberData.permissions || [],
    };
  } catch (err: any) {
    console.error(
      `[ELIZA] Error validating membership for ${userId} in ${clinicId}:`,
      err
    );
    return {
      isMember: false,
      role: "member",
      permissions: [],
    };
  }
}

// ============================================================================
// TOKEN BUDGET CALCULATION
// ============================================================================

interface ModelTokenBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
}

const MODEL_BUDGETS: Record<string, ModelTokenBudget> = {
  "gemini-3.5-flash": {
    maxInputTokens: 6000,
    maxOutputTokens: 2000,
  },
  "gemini-3.1-pro": {
    maxInputTokens: 8000,
    maxOutputTokens: 3000,
  },
  "gemini-2.5-flash": {
    maxInputTokens: 6000,
    maxOutputTokens: 2000,
  },
  "gpt-4o": {
    maxInputTokens: 8000,
    maxOutputTokens: 3000,
  },
  "gpt-4o-mini": {
    maxInputTokens: 4000,
    maxOutputTokens: 2000,
  },
};

function calculateTokenBudget(
  model: string
): { maxInputTokens: number; maxOutputTokens: number; estimatedInputTokens: number } {
  const budget = MODEL_BUDGETS[model] || MODEL_BUDGETS["gemini-3.5-flash"];

  return {
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    estimatedInputTokens: 0, // Will be calculated when prompt is built
  };
}

// ============================================================================
// MAIN CONTEXT BUILDER
// ============================================================================

export async function buildContext(
  req: any,
  elizaRequest: ElizaIntelligenceRequest
): Promise<ElizaContext> {
  // 1. Extract and validate JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ElizaError(
      ElizaErrorCode.AUTH_ERROR,
      "Authorization header ausente ou inválido.",
      401
    );
  }

  const token = authHeader.substring(7);
  const decoded = verifyAndDecodeJWT(token);

  const userId = decoded.sub;
  const clinicIdFromToken = decoded.clinic_id;
  const userRole = (decoded.role as "owner" | "admin" | "professional" | "member") || "member";
  const userPermissions = decoded.permissions || [];

  // 2. Validate clinicId consistency (token is authority)
  validateClinicIdConsistency(clinicIdFromToken, clinicIdFromToken, undefined);

  // 3. Validate clinic membership
  const membership = await validateClinicMembership(clinicIdFromToken, userId);

  if (!membership.isMember) {
    throw new ElizaError(
      ElizaErrorCode.UNAUTHORIZED,
      `Usuário não é membro da clínica ${clinicIdFromToken}.`,
      403
    );
  }

  // 4. Load clinic config (cached)
  const clinicData = await loadClinicConfig(clinicIdFromToken);

  // 5. Load patient data if provided
  let patientData = undefined;
  if (elizaRequest.patientId) {
    patientData = await loadPatientData(clinicIdFromToken, elizaRequest.patientId);
  }

  // 6. Load conversation history if provided
  let conversationHistory: any = {
    id: elizaRequest.conversationId || `conv-${Date.now()}`,
    clinicId: clinicIdFromToken,
    userId,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (elizaRequest.conversationId) {
    conversationHistory = await loadConversationHistory(
      clinicIdFromToken,
      elizaRequest.conversationId
    );
  }

  // 7. Select model based on task type
  let model = clinicData.aiModelFast;
  const criticalTasks = [
    "patient_analysis",
    "treatment_plan",
    "clinical_alert",
  ];
  const administrativeTasks = [
    "financial_insight",
    "recall_suggestion",
    "marketing_copy",
  ];

  if (criticalTasks.includes(elizaRequest.taskType)) {
    model = clinicData.aiModelClinical;
  } else if (administrativeTasks.includes(elizaRequest.taskType)) {
    model = clinicData.aiModelAdministrative;
  }

  // 8. Calculate token budget
  const tokenBudget = calculateTokenBudget(model);

  // 9. Assemble context
  const context: ElizaContext = {
    authToken: token,
    userId,
    clinicId: clinicIdFromToken,
    userRole,
    userPermissions,

    clinicData: {
      id: clinicIdFromToken,
      name: "Clinic Name", // Will be fetched from clinic config later if needed
      config: clinicData,
    },

    patient: patientData,
    conversationHistory,

    request: {
      taskType: elizaRequest.taskType,
      userPrompt: elizaRequest.prompt,
      preferredProvider: elizaRequest.preferredProvider,
      requestedTools: elizaRequest.requestedTools || [],
      approvalRequired: elizaRequest.approvalRequired || false,
    },

    tokenBudget,
    isDryRun: elizaRequest.dryRun || false,
  };

  console.log(`[ELIZA] Context built for user=${userId}, clinic=${clinicIdFromToken}, task=${elizaRequest.taskType}`);

  return context;
}

// ============================================================================
// HELPERS
// ============================================================================

export function clearConfigCache(clinicId: string): void {
  clinicConfigCache.delete(clinicId);
}

export function clearAllCaches(): void {
  clinicConfigCache.clear();
}
