/**
 * ELIZA Tool Registry
 * Defines and manages all available tools that AI can execute
 * 5 core tools implemented: read_patient_record, write_patient_evolution, 
 * get_financial_summary, list_pending_tasks, update_recall_status
 */

import {
  ElizaTool,
  ElizaContext,
  ElizaError,
  ElizaErrorCode,
  JSONSchema,
} from "../types/eliza-intelligence";
import { getFirestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./adminFirebase";

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

/**
 * Tool 1: Read Patient Record
 * Allows reading complete patient medical record
 */
const READ_PATIENT_RECORD: ElizaTool = {
  id: "read_patient_record",
  name: "Ler Prontuário do Paciente",
  description:
    "Busca o prontuário completo de um paciente incluindo dados clínicos, alergias, histórico de procedimentos e últimas evoluções",
  category: "read",

  requiredPermissions: {
    clinicRole: "member",
    moduleAccess: ["patients", "medical_records"],
    scopeClinicOnly: true,
  },

  inputSchema: {
    type: "object",
    properties: {
      patientId: {
        type: "string",
        description: "ID único do paciente no Firestore",
      },
      includeFinancial: {
        type: "boolean",
        description:
          "Incluir informações financeiras (pendências, pagamentos)",
        default: false,
      },
    },
    required: ["patientId"],
  },

  outputSchema: {
    type: "object",
    properties: {
      patientId: { type: "string" },
      name: { type: "string" },
      age: { type: "number" },
      gender: { type: "string" },
      contact: { type: "object" },
      allergies: { type: "array", items: { type: "string" } },
      medicalHistory: { type: "array", items: { type: "object" } },
      procedures: { type: "array", items: { type: "object" } },
      evolutions: { type: "array", items: { type: "object" } },
      financialData: {
        type: "object",
        properties: {
          totalDebt: { type: "number" },
          lastPayment: { type: "string" },
        },
      },
    },
  },

  requiresApproval: false,

  handler: async (input: any, context: ElizaContext) => {
    const { patientId, includeFinancial } = input;

    // Validate patient belongs to clinic
    const patientRef = getAdminDb().doc(
      `clinics/${context.clinicId}/patients/${patientId}`
    );
    const patientSnap = await patientRef.get();

    if (!patientSnap.exists) {
      throw new ElizaError(
        ElizaErrorCode.PATIENT_NOT_FOUND,
        `Paciente ${patientId} não encontrado nesta clínica.`,
        404
      );
    }

    const patientData = patientSnap.data();

    // Fetch related data
    const evolutions = await patientRef.collection("evolutions").limit(10).get();
    const procedures = await patientRef.collection("procedures").limit(20).get();

    const result: any = {
      patientId,
      name: patientData?.name || "N/A",
      age: patientData?.age || 0,
      gender: patientData?.gender || "N/A",
      contact: {
        phone: patientData?.phone || "",
        email: patientData?.email || "",
      },
      allergies: patientData?.allergies || [],
      medicalHistory: patientData?.medicalHistory || [],
      procedures: procedures.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      evolutions: evolutions.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };

    if (includeFinancial) {
      const financial = await getAdminDb()
        .doc(`clinics/${context.clinicId}/patients/${patientId}/financial/summary`)
        .get()
        .catch(() => null);

      if (financial?.exists) {
        result.financialData = financial.data();
      }
    }

    return result;
  },
};

/**
 * Tool 2: Write Patient Evolution
 * Allows writing new clinical evolution note to patient record
 * Requires approval
 */
const WRITE_PATIENT_EVOLUTION: ElizaTool = {
  id: "write_patient_evolution",
  name: "Registrar Evolução Clínica",
  description:
    "Registra uma nova evolução/anotação clínica no prontuário do paciente. Requer aprovação.",
  category: "write",

  requiredPermissions: {
    clinicRole: "professional",
    moduleAccess: ["patients", "medical_records"],
    scopeClinicOnly: true,
  },

  inputSchema: {
    type: "object",
    properties: {
      patientId: {
        type: "string",
        description: "ID do paciente",
      },
      evolutionText: {
        type: "string",
        description: "Texto da evolução clínica",
      },
      clinicalFindings: {
        type: "array",
        items: { type: "string" },
        description: "Achados clínicos relevantes",
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
        description: "Recomendações para o paciente",
      },
    },
    required: ["patientId", "evolutionText"],
  },

  outputSchema: {
    type: "object",
    properties: {
      evolutionId: { type: "string" },
      patientId: { type: "string" },
      createdAt: { type: "string" },
      status: { type: "string" },
    },
  },

  requiresApproval: true,

  handler: async (input: any, context: ElizaContext) => {
    const { patientId, evolutionText, clinicalFindings, recommendations } = input;

    // Validate patient
    const patientRef = getAdminDb().doc(
      `clinics/${context.clinicId}/patients/${patientId}`
    );
    const patientSnap = await patientRef.get();

    if (!patientSnap.exists) {
      throw new ElizaError(
        ElizaErrorCode.PATIENT_NOT_FOUND,
        `Paciente ${patientId} não encontrado.`,
        404
      );
    }

    // Create evolution
    const evolutionData = {
      patientId,
      text: evolutionText,
      clinicalFindings: clinicalFindings || [],
      recommendations: recommendations || [],
      createdBy: context.userId,
      createdAt: new Date(),
      clinicId: context.clinicId,
    };

    const evolutionRef = await patientRef.collection("evolutions").add(evolutionData);

    return {
      evolutionId: evolutionRef.id,
      patientId,
      createdAt: new Date().toISOString(),
      status: "created",
    };
  },
};

/**
 * Tool 3: Get Financial Summary
 * Retrieves financial summary for clinic
 */
/**
 * SECURITY: This tool is DISABLED because it currently returns mock data
 * instead of real financial data. This is dangerous in production.
 * 
 * TODO: Implement real financial data fetching from Firestore
 * before re-enabling this tool.
 * 
 * To re-enable:
 * 1. Query Firestore /clinics/{clinicId}/financial_entries
 * 2. Aggregate real income and expenses
 * 3. Validate data before returning
 * 4. Remove this warning and set disabled: false
 */
const GET_FINANCIAL_SUMMARY: ElizaTool = {
  id: "get_financial_summary",
  name: "Resumo Financeiro [DESATIVADO]",
  description:
    "⚠️ DESATIVADO: Ferramenta retorna dados fictícios. Será habilitada quando integrada com dados reais.",
  category: "read",
  disabled: true, // Mark as disabled

  requiredPermissions: {
    clinicRole: "admin",
    moduleAccess: ["finance"],
    scopeClinicOnly: true,
  },

  inputSchema: {
    type: "object",
    properties: {
      period: {
        type: "string",
        enum: ["today", "week", "month", "year"],
        description: "Período para o qual gerar resumo",
        default: "month",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      error: { type: "string" },
    },
  },

  requiresApproval: false,

  handler: async (input: any, context: ElizaContext) => {
    throw new ElizaError(
      ElizaErrorCode.TOOL_DISABLED,
      "Ferramenta de resumo financeiro está desativada. Dados reais não estão disponíveis yet.",
      503
    );
  },
};

/**
 * Tool 4: List Pending Tasks
 * Retrieves pending items for clinic
 */
const LIST_PENDING_TASKS: ElizaTool = {
  id: "list_pending_tasks",
  name: "Listar Tarefas Pendentes",
  description: "Lista todas as tarefas e itens pendentes da clínica",
  category: "read",

  requiredPermissions: {
    clinicRole: "member",
    moduleAccess: ["pending_items"],
    scopeClinicOnly: true,
  },

  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Número máximo de itens a retornar",
        default: 20,
      },
      priority: {
        type: "string",
        enum: ["high", "medium", "low", "any"],
        description: "Filtrar por prioridade",
        default: "any",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            priority: { type: "string" },
            dueDate: { type: "string" },
            status: { type: "string" },
          },
        },
      },
      total: { type: "number" },
    },
  },

  requiresApproval: false,

  handler: async (input: any, context: ElizaContext) => {
    const { limit = 20, priority } = input;

    const query = getAdminDb()
      .collection("clinics")
      .doc(context.clinicId)
      .collection("pending_items");

    const q = priority && priority !== "any" ? query.where("priority", "==", priority) : query;

    const snapshots = await q.limit(limit).get();

    return {
      items: snapshots.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      total: snapshots.size,
    };
  },
};

/**
 * Tool 5: Update Recall Status
 * Updates recall status for a patient
 * Requires approval
 */
const UPDATE_RECALL_STATUS: ElizaTool = {
  id: "update_recall_status",
  name: "Atualizar Status de Recall",
  description:
    "Atualiza o status de recall/retorno de um paciente (em atraso, contatado, reagendado)",
  category: "write",

  requiredPermissions: {
    clinicRole: "professional",
    moduleAccess: ["patients", "recall"],
    scopeClinicOnly: true,
  },

  inputSchema: {
    type: "object",
    properties: {
      patientId: {
        type: "string",
        description: "ID do paciente",
      },
      status: {
        type: "string",
        enum: ["overdue", "contacted", "rescheduled", "completed"],
        description: "Novo status de recall",
      },
      notes: {
        type: "string",
        description: "Notas sobre o recall",
      },
    },
    required: ["patientId", "status"],
  },

  outputSchema: {
    type: "object",
    properties: {
      patientId: { type: "string" },
      status: { type: "string" },
      updatedAt: { type: "string" },
    },
  },

  requiresApproval: true,

  handler: async (input: any, context: ElizaContext) => {
    const { patientId, status, notes } = input;

    const patientRef = getAdminDb().doc(
      `clinics/${context.clinicId}/patients/${patientId}`
    );

    await patientRef.update({
      recallStatus: status,
      recallNotes: notes || "",
      recallUpdatedAt: new Date(),
      recallUpdatedBy: context.userId,
    });

    return {
      patientId,
      status,
      updatedAt: new Date().toISOString(),
    };
  },
};

// ============================================================================
// REGISTRY
// ============================================================================

const TOOL_REGISTRY = new Map<string, ElizaTool>([
  [READ_PATIENT_RECORD.id, READ_PATIENT_RECORD],
  [WRITE_PATIENT_EVOLUTION.id, WRITE_PATIENT_EVOLUTION],
  [GET_FINANCIAL_SUMMARY.id, GET_FINANCIAL_SUMMARY],
  [LIST_PENDING_TASKS.id, LIST_PENDING_TASKS],
  [UPDATE_RECALL_STATUS.id, UPDATE_RECALL_STATUS],
]);

// ============================================================================
// REGISTRY QUERIES
// ============================================================================

export function getTool(toolId: string): ElizaTool {
  const tool = TOOL_REGISTRY.get(toolId);
  if (!tool) {
    throw new ElizaError(
      ElizaErrorCode.TOOL_NOT_FOUND,
      `Ferramenta '${toolId}' não encontrada.`,
      404
    );
  }
  return tool;
}

export function getAllTools(): ElizaTool[] {
  return Array.from(TOOL_REGISTRY.values());
}

export function getToolsForCategory(category: "read" | "write" | "execute"): ElizaTool[] {
  return Array.from(TOOL_REGISTRY.values()).filter((t) => t.category === category);
}

export function getAvailableTools(context: ElizaContext): ElizaTool[] {
  return Array.from(TOOL_REGISTRY.values()).filter((tool) => {
    // Check role
    const roleHierarchy = {
      owner: 4,
      admin: 3,
      professional: 2,
      member: 1,
    };

    const roleHierarchyValues = {
      owner: 4,
      admin: 3,
      professional: 2,
      member: 1,
    };

    const userRoleLevel = roleHierarchyValues[context.userRole] || 0;
    const requiredRoleLevel = roleHierarchyValues[tool.requiredPermissions.clinicRole] || 0;

    if (userRoleLevel < requiredRoleLevel) {
      return false;
    }

    // Check scoping
    if (tool.requiredPermissions.scopeClinicOnly) {
      // Only clinic members can use
      if (context.userRole === "member") {
        return true;
      }
    }

    return true;
  });
}

/**
 * Validates that user has permission to use a tool
 */
export function authorizeToolUsage(
  context: ElizaContext,
  tool: ElizaTool
): boolean {
  const roleHierarchy = {
    owner: 4,
    admin: 3,
    professional: 2,
    member: 1,
  };

  const userRoleLevel = roleHierarchy[context.userRole] || 0;
  const requiredRoleLevel = roleHierarchy[tool.requiredPermissions.clinicRole] || 0;

  if (userRoleLevel < requiredRoleLevel) {
    throw new ElizaError(
      ElizaErrorCode.TOOL_PERMISSION_DENIED,
      `Sua função '${context.userRole}' não tem permissão para usar '${tool.name}'.`,
      403
    );
  }

  return true;
}

/**
 * Executes a tool with the given input and context
 */
export async function executeTool(
  toolId: string,
  input: any,
  context: ElizaContext
): Promise<any> {
  const tool = getTool(toolId);

  // Validate permissions
  authorizeToolUsage(context, tool);

  // Execute
  try {
    const result = await tool.handler(input, context);
    return result;
  } catch (err: any) {
    throw new ElizaError(
      ElizaErrorCode.TOOL_EXECUTION_ERROR,
      `Erro ao executar ferramenta '${tool.name}': ${err.message}`,
      500,
      { toolId, originalError: err.message }
    );
  }
}

// Export tools for testing
export { READ_PATIENT_RECORD, WRITE_PATIENT_EVOLUTION, GET_FINANCIAL_SUMMARY, LIST_PENDING_TASKS, UPDATE_RECALL_STATUS };
