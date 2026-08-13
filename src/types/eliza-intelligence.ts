/**
 * ELIZA Intelligence Layer - Type Definitions
 * Complete type system for AI orchestration, tool calling, and governance
 */

// ============================================================================
// REQUEST & RESPONSE TYPES
// ============================================================================

export interface ElizaIntelligenceRequest {
  taskType: 
    | "patient_analysis"
    | "treatment_plan"
    | "financial_insight"
    | "recall_suggestion"
    | "clinical_alert"
    | "whatsapp_response"
    | "marketing_copy"
    | "contract_review";
  
  prompt: string;
  patientId?: string;
  conversationId?: string;
  
  context?: Record<string, any>;
  preferredProvider?: "gemini" | "openai";
  requestedTools?: string[];
  approvalRequired?: boolean;
  dryRun?: boolean;
}

export interface ElizaIntelligenceResponse {
  success: true;
  data: {
    analysisResult: {
      type: "text" | "structured" | "action";
      content: string | Record<string, any>;
      confidence?: number;
      alerts?: string[];
    };
    metadata: {
      taskType: string;
      modelUsed: string;
      provider: "gemini" | "openai";
      tokensUsed: {
        input: number;
        output: number;
        total: number;
      };
      executedTools: ExecutedToolRecord[];
      processingTime: number;
      conversationId: string;
    };
    executedActions?: ExecutedActionRecord[];
    suggestedNextSteps?: string[];
  };
  audit: AuditMetadata;
}

export interface ElizaIntelligenceErrorResponse {
  success: false;
  error: {
    code: ElizaErrorCode;
    message: string;
    details?: string;
    debug?: {
      stackTrace?: string;
      failedStep?: string;
    };
  };
  audit: AuditMetadata;
}

// ============================================================================
// CONTEXT & MEMORY
// ============================================================================

export interface ElizaContext {
  // Authentication & Authorization
  authToken: string;
  userId: string;
  clinicId: string;
  userRole: "owner" | "admin" | "professional" | "member";
  userPermissions: string[];
  
  // Clinic
  clinicData: {
    id: string;
    name: string;
    config: ClinicAIConfig;
  };
  
  // Patient (if applicable)
  patient?: PatientContextData;
  
  // Conversation
  conversationHistory: ConversationRecord;
  
  // Request
  request: {
    taskType: string;
    userPrompt: string;
    preferredProvider?: "gemini" | "openai";
    requestedTools?: string[];
    approvalRequired?: boolean;
  };
  
  // Tokens
  tokenBudget: {
    maxInputTokens: number;
    maxOutputTokens: number;
    estimatedInputTokens: number;
  };
  
  // Flags
  isDryRun?: boolean;
  isTestMode?: boolean;
}

export interface ClinicAIConfig {
  aiProviderPrincipal: "gemini" | "openai";
  aiProviderFallback: "gemini" | "openai" | "none";
  aiModelClinical: string;
  aiModelAdministrative: string;
  aiModelFast: string;
  tokenBudgetMonthly?: number;
}

export interface PatientContextData {
  id: string;
  name: string;
  age: number;
  allergies: string[];
  medicalHistory: string[];
  lastVisit: string;
  activeProblems: string[];
  currentMedications?: string[];
  riskFactors?: string[];
}

export interface ConversationRecord {
  id: string;
  clinicId: string;
  userId: string;
  patientId?: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
  title?: string;
  tags?: string[];
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tokens?: number;
  modelUsed?: string;
  tasksExecuted?: string[];
}

// ============================================================================
// TOOLS & TOOL CALLING
// ============================================================================

export interface ElizaTool {
  id: string;
  name: string;
  description: string;
  category: "read" | "write" | "execute";
  
  requiredPermissions: {
    clinicRole: "owner" | "admin" | "professional" | "member";
    moduleAccess: string[];
    scopeClinicOnly: boolean;
  };
  
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  requiresApproval: boolean;
  
  handler: (input: any, context: ElizaContext) => Promise<any>;
}

export interface JSONSchema {
  type: string;
  properties: Record<string, any>;
  required?: string[];
  enum?: any[];
  items?: JSONSchema;
  [key: string]: any;
}

export interface ToolCallRequest {
  toolId: string;
  input: Record<string, any>;
  requiresApproval: boolean;
}

export interface ExecutedToolRecord {
  toolId: string;
  input: any;
  output: any;
  duration: number;
  executedAt: Date;
  executedBy: "system" | "human_approved";
  status: "success" | "failed";
  error?: string;
}

export interface ActionProposal {
  id: string;
  clinicId: string;
  status: "pending_approval" | "approved" | "rejected";
  proposedBy: "system";
  proposedAt: Date;
  
  toolId: string;
  toolInput: any;
  proposedOutput: any;
  
  approvalRequestedFrom?: string[];
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}

export interface ExecutedActionRecord {
  actionId: string;
  description: string;
  status: "success" | "pending_approval" | "failed";
  recordedAt: Date;
  executedBy?: string;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export enum ElizaErrorCode {
  // Validation
  VALIDATION_ERROR = "VALIDATION_ERROR",
  SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED",
  
  // Authentication
  AUTH_ERROR = "AUTH_ERROR",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  INVALID_TOKEN = "INVALID_TOKEN",
  
  // Authorization
  UNAUTHORIZED = "UNAUTHORIZED",
  INSUFFICIENT_PERMISSION = "INSUFFICIENT_PERMISSION",
  CLINIC_NOT_FOUND = "CLINIC_NOT_FOUND",
  
  // Resource
  PATIENT_NOT_FOUND = "PATIENT_NOT_FOUND",
  CONVERSATION_NOT_FOUND = "CONVERSATION_NOT_FOUND",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  
  // AI/Model
  MODEL_ERROR = "MODEL_ERROR",
  MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE",
  TOKEN_LIMIT_EXCEEDED = "TOKEN_LIMIT_EXCEEDED",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  
  // Tool Execution
  TOOL_EXECUTION_ERROR = "TOOL_EXECUTION_ERROR",
  TOOL_PERMISSION_DENIED = "TOOL_PERMISSION_DENIED",
  
  // Internal
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
}

export class ElizaError extends Error {
  constructor(
    public code: ElizaErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = "ElizaError";
  }
}

// ============================================================================
// AUDIT & LOGGING
// ============================================================================

export interface AuditMetadata {
  requestId: string;
  clinicId: string;
  userId: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface AIAuditLog {
  requestId: string;
  clinicId: string;
  userId: string;
  timestamp: Date;
  operation: "analyze" | "plan" | "execute" | "approve";
  taskType: string;
  status: "success" | "failed" | "pending_approval";
  request: {
    prompt: string;
    patientId?: string;
    tools: string[];
  };
  response: {
    modelUsed: string;
    provider: string;
    tokensUsed: { input: number; output: number; total: number };
    actionExecuted?: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
  actions: {
    actionId: string;
    toolId: string;
    status: "executed" | "pending_approval" | "rejected";
    approvedAt?: Date;
    approvedBy?: string;
  }[];
}

export interface AIMetrics {
  successRate: number;
  errorRate: number;
  pendingApprovalRate: number;
  
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgLatencyMs: number;
  
  totalTokensUsed: number;
  avgTokensPerRequest: number;
  estimatedCostUSD: number;
  
  toolExecutionCount: Record<string, number>;
  toolSuccessRate: Record<string, number>;
  
  userApprovalRate: number;
}

// ============================================================================
// API GATEWAY TYPES
// ============================================================================

export interface APIRequest extends Express.Request {
  headers: {
    authorization: string;
    [key: string]: any;
  };
  body: ElizaIntelligenceRequest;
}

export interface JWTPayload {
  sub: string;
  clinic_id: string;
  role: string;
  permissions: string[];
  exp: number;
  iat: number;
  iss: string;
}

// ============================================================================
// MODEL & PROVIDER TYPES
// ============================================================================

export type AIProvider = "gemini" | "openai";

export interface ModelConfig {
  name: string;
  provider: AIProvider;
  contextWindow: number;
  costPerMilTokens: {
    input: number;
    output: number;
  };
  supportedTaskTypes: string[];
}

export interface PromptTemplate {
  id: string;
  promptType: string;
  version: number;
  status: "active" | "draft" | "archived";
  systemInstruction: string;
  examples: {
    input: string;
    output: string;
    taskType: string;
  }[];
  constraints: {
    description: string;
    severity: "error" | "warning";
  }[];
  createdAt: Date;
  createdBy: string;
  approvedAt?: Date;
  approvedBy?: string;
  metrics?: {
    totalCalls: number;
    successRate: number;
    avgTokens: number;
    avgDuration: number;
  };
}
