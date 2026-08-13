/**
 * Schema Validator
 * Validates requests and responses against JSON schemas
 * Ensures type safety and catches invalid inputs early
 */

import { ElizaError, ElizaErrorCode, JSONSchema } from "../types/eliza-intelligence";

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates data against a JSON schema
 * Throws ElizaError if validation fails
 */
export function validateSchema(
  data: any,
  schema: JSONSchema,
  fieldName: string = "data"
): boolean {
  const errors = getValidationErrors(data, schema);

  if (errors.length > 0) {
    throw new ElizaError(
      ElizaErrorCode.INVALID_REQUEST,
      `${fieldName} validation failed: ${errors.join("; ")}`,
      400
    );
  }

  return true;
}

/**
 * Gets validation errors without throwing
 * Returns array of error messages
 */
export function getValidationErrors(data: any, schema: JSONSchema): string[] {
  const errors: string[] = [];

  // Type checking
  if (schema.type && typeof data !== schema.type) {
    errors.push(`Expected ${schema.type}, got ${typeof data}`);
    return errors; // Stop if type is wrong
  }

  // Object validation
  if (schema.type === "object" && typeof data === "object" && data !== null) {
    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Validate properties
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          const propErrors = getValidationErrors(data[key], propSchema as JSONSchema);
          errors.push(...propErrors.map(e => `${key}: ${e}`));
        }
      }
    }
  }

  // Array validation
  if (schema.type === "array" && Array.isArray(data)) {
    if (schema.items && typeof schema.items === "object") {
      for (let i = 0; i < data.length; i++) {
        const itemErrors = getValidationErrors(data[i], schema.items);
        errors.push(...itemErrors.map(e => `[${i}]: ${e}`));
      }
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`Must be one of: ${schema.enum.join(", ")}`);
  }

  // String constraints
  if (typeof data === "string") {
    if (schema.minLength && data.length < schema.minLength) {
      errors.push(`String must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength && data.length > schema.maxLength) {
      errors.push(`String must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push(`String does not match pattern: ${schema.pattern}`);
    }
  }

  // Number constraints
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`Number must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`Number must be <= ${schema.maximum}`);
    }
  }

  return errors;
}

// ============================================================================
// SCHEMAS FOR COMMON REQUESTS
// ============================================================================

/**
 * Schema for /api/intelligence/analyze request
 */
export const ANALYZE_REQUEST_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    taskType: {
      type: "string",
      enum: [
        "patient_analysis",
        "treatment_plan",
        "financial_insight",
        "recall_suggestion",
        "clinical_alert",
        "whatsapp_response",
        "marketing_copy",
        "contract_review",
      ],
      description: "Type of analysis to perform",
    },
    prompt: {
      type: "string",
      minLength: 5,
      maxLength: 5000,
      description: "The prompt/question for analysis",
    },
    patientId: {
      type: "string",
      description: "Patient ID (if relevant to task)",
    },
    conversationId: {
      type: "string",
      description: "Conversation ID for tracking",
    },
    requestedTools: {
      type: "array",
      items: { type: "string" },
      description: "Specific tools to use (optional)",
    },
    context: {
      type: "object",
      description: "Additional context (optional)",
    },
    approvalRequired: {
      type: "boolean",
      description: "Whether result requires human approval",
    },
  },
  required: ["taskType", "prompt"],
};

/**
 * Schema for /api/auth/login request
 */
export const LOGIN_REQUEST_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    clinicId: {
      type: "string",
      minLength: 1,
      description: "Clinic ID (Firestore collection ID)",
    },
  },
  required: ["clinicId"],
};

/**
 * Schema for proposal approval request
 */
export const APPROVE_ACTION_REQUEST_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    actionId: {
      type: "string",
      minLength: 1,
      description: "Action proposal ID",
    },
    approvalNotes: {
      type: "string",
      maxLength: 1000,
      description: "Optional notes from approver",
    },
  },
  required: ["actionId"],
};

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

/**
 * Validates response data against tool output schema
 * Used to ensure AI model responses are in correct format
 */
export function validateToolResponse(
  toolId: string,
  response: any,
  outputSchema: JSONSchema
): boolean {
  try {
    validateSchema(response, outputSchema, `${toolId} response`);
    return true;
  } catch (err: any) {
    console.warn(`Tool response validation failed for ${toolId}:`, err.message);
    // Don't throw - tool output often has extra fields, just warn
    return false;
  }
}

// ============================================================================
// SANITIZATION
// ============================================================================

/**
 * Removes potentially harmful fields from request data
 */
export function sanitizeRequest(data: any): any {
  const sanitized = { ...data };

  // Remove fields that should never come from client
  delete sanitized["userId"];
  delete sanitized["clinicId"];
  delete sanitized["role"];
  delete sanitized["permissions"];
  delete sanitized["admin"];
  delete sanitized["system"];

  return sanitized;
}

/**
 * Removes sensitive data from responses
 */
export function sanitizeResponse(data: any, sensitivePatterns: string[] = []): any {
  const sanitized = JSON.parse(JSON.stringify(data)); // Deep copy

  // Remove common sensitive fields
  const sensitiveFields = [
    "password",
    "token",
    "secret",
    "apiKey",
    "ssn",
    "creditCard",
    "bankAccount",
  ];

  const patterns = [...sensitiveFields, ...sensitivePatterns];

  function removeSensitive(obj: any) {
    if (typeof obj !== "object" || obj === null) return;

    for (const key of Object.keys(obj)) {
      if (patterns.some(p => key.toLowerCase().includes(p.toLowerCase()))) {
        delete obj[key];
      } else if (typeof obj[key] === "object") {
        removeSensitive(obj[key]);
      }
    }
  }

  removeSensitive(sanitized);
  return sanitized;
}
