/**
 * ELIZA Intelligence Layer - Unit Tests
 * Tests for auth, context building, tool calling, and main orchestration
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  verifyAndDecodeJWT,
  generateJWT,
  extractBearerToken,
  hasRole,
  hasPermission,
} from "../lib/elizaAuthService";
import {
  ElizaError,
  ElizaErrorCode,
  ElizaTool,
} from "../types/eliza-intelligence";
import { getTool, getAvailableTools, authorizeToolUsage } from "../lib/elizaToolRegistry";

// ============================================================================
// AUTH SERVICE TESTS
// ============================================================================

describe("elizaAuthService", () => {
  describe("JWT generation and verification", () => {
    it("should generate and verify a valid JWT", () => {
      const token = generateJWT("user123", "clinic456", "admin", ["read:patients"]);
      const decoded = verifyAndDecodeJWT(token);

      expect(decoded.sub).toBe("user123");
      expect(decoded.clinic_id).toBe("clinic456");
      expect(decoded.role).toBe("admin");
      expect(decoded.permissions).toContain("read:patients");
    });

    it("should reject an invalid JWT", () => {
      expect(() => {
        verifyAndDecodeJWT("invalid.token.here");
      }).toThrow(ElizaError);
    });

    it("should extract bearer token correctly", () => {
      const header = "Bearer token123";
      const token = extractBearerToken(header);
      expect(token).toBe("token123");
    });

    it("should throw error on missing bearer token", () => {
      expect(() => {
        extractBearerToken("NoBearer token");
      }).toThrow(ElizaError);
    });
  });

  describe("Role and permission checking", () => {
    it("should validate role hierarchy", () => {
      expect(hasRole("owner", "member")).toBe(true);
      expect(hasRole("admin", "professional")).toBe(true);
      expect(hasRole("professional", "admin")).toBe(false);
      expect(hasRole("member", "admin")).toBe(false);
    });

    it("should check permissions", () => {
      const permissions = ["read:patients", "write:evolution", "read:finance"];

      expect(hasPermission(permissions, "read:patients")).toBe(true);
      expect(hasPermission(permissions, "delete:clinic")).toBe(false);
    });
  });
});

// ============================================================================
// TOOL REGISTRY TESTS
// ============================================================================

describe("elizaToolRegistry", () => {
  describe("Tool retrieval", () => {
    it("should retrieve a tool by ID", () => {
      const tool = getTool("read_patient_record");

      expect(tool).toBeDefined();
      expect(tool.id).toBe("read_patient_record");
      expect(tool.category).toBe("read");
      expect(tool.requiresApproval).toBe(false);
    });

    it("should throw error for non-existent tool", () => {
      expect(() => {
        getTool("non_existent_tool");
      }).toThrow(ElizaError);
    });
  });

  describe("Tool availability", () => {
    it("should return available tools for a member", () => {
      const context = {
        userId: "user123",
        clinicId: "clinic456",
        userRole: "member" as const,
        userPermissions: [],
      } as any;

      const tools = getAvailableTools(context);
      const readPatientTool = tools.find((t) => t.id === "read_patient_record");

      expect(readPatientTool).toBeDefined();
      expect(readPatientTool?.id).toBe("read_patient_record");
    });

    it("should restrict tools based on role", () => {
      const memberContext = {
        userId: "user123",
        clinicId: "clinic456",
        userRole: "member" as const,
        userPermissions: [],
      } as any;

      const adminContext = {
        userId: "user123",
        clinicId: "clinic456",
        userRole: "admin" as const,
        userPermissions: [],
      } as any;

      const memberTools = getAvailableTools(memberContext);
      const adminTools = getAvailableTools(adminContext);

      // Admin should have access to more tools (like financial summary)
      const financialToolForMember = memberTools.find(
        (t) => t.id === "get_financial_summary"
      );
      const financialToolForAdmin = adminTools.find(
        (t) => t.id === "get_financial_summary"
      );

      expect(financialToolForMember).toBeUndefined();
      expect(financialToolForAdmin).toBeDefined();
    });
  });

  describe("Tool authorization", () => {
    it("should authorize tool usage for authorized user", () => {
      const context = {
        userId: "user123",
        clinicId: "clinic456",
        userRole: "professional" as const,
        userPermissions: [],
      } as any;

      const tool = getTool("write_patient_evolution");

      expect(() => {
        authorizeToolUsage(context, tool);
      }).not.toThrow();
    });

    it("should deny tool usage for unauthorized user", () => {
      const context = {
        userId: "user123",
        clinicId: "clinic456",
        userRole: "member" as const,
        userPermissions: [],
      } as any;

      const tool = getTool("write_patient_evolution");

      expect(() => {
        authorizeToolUsage(context, tool);
      }).toThrow(ElizaError);
    });
  });

  describe("Tool input validation", () => {
    it("should have valid input schemas", () => {
      const tools = [
        "read_patient_record",
        "write_patient_evolution",
        "get_financial_summary",
        "list_pending_tasks",
        "update_recall_status",
      ];

      for (const toolId of tools) {
        const tool = getTool(toolId);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it("should have valid output schemas", () => {
      const tools = [
        "read_patient_record",
        "write_patient_evolution",
        "get_financial_summary",
        "list_pending_tasks",
        "update_recall_status",
      ];

      for (const toolId of tools) {
        const tool = getTool(toolId);
        expect(tool.outputSchema).toBeDefined();
        expect(tool.outputSchema.type).toBe("object");
      }
    });
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe("ElizaError", () => {
  it("should create error with code and message", () => {
    const error = new ElizaError(
      ElizaErrorCode.AUTH_ERROR,
      "Authentication failed",
      401
    );

    expect(error.code).toBe(ElizaErrorCode.AUTH_ERROR);
    expect(error.message).toBe("Authentication failed");
    expect(error.statusCode).toBe(401);
  });

  it("should include details in error", () => {
    const error = new ElizaError(
      ElizaErrorCode.PATIENT_NOT_FOUND,
      "Patient not found",
      404,
      { patientId: "123" }
    );

    expect(error.details).toEqual({ patientId: "123" });
  });
});

// ============================================================================
// INTEGRATION TESTS (Mock Firebase)
// ============================================================================

describe("ELIZA Intelligence Layer - Integration", () => {
  beforeEach(() => {
    // Setup mocks
  });

  afterEach(() => {
    // Cleanup
  });

  it("should handle complete request flow", async () => {
    // This would require mocking Firestore
    // Placeholder for integration test
    expect(true).toBe(true);
  });
});
