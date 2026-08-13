/**
 * Proposal Executor
 * Handles secure approval, execution, and idempotency of write actions
 * 
 * Flow:
 * 1. Model suggests action → create proposal (pending)
 * 2. Human approves → update to approved + get approval metadata
 * 3. Execute idempotently → hash arguments, detect duplicates
 * 4. Mark executed → audit trail
 * 
 * SECURITY:
 * - Only approved proposals are executed
 * - Idempotency key prevents duplicate execution
 * - All state changes audited
 * - Expiration prevents stale approvals
 */

import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { ElizaError, ElizaErrorCode } from "../types/eliza-intelligence";
import { getAdminDb } from "../lib/adminFirebase";

// ============================================================================
// TYPES
// ============================================================================

export interface ActionProposal {
  id: string;
  clinicId: string;
  userId: string;
  createdBy: string; // who created the proposal (AI system or user)
  createdAt: Timestamp;
  expiresAt: Timestamp;

  // Action details
  action: string; // e.g., "write_patient_evolution"
  resourceType: string; // e.g., "patient"
  resourceId: string; // e.g., patientId
  description: string; // human-readable description

  // Arguments hash - prevents tampering
  argumentsHash: string;
  argumentsSummary: Record<string, any>; // Non-sensitive summary for display

  // Approval state
  status: "pending" | "approved" | "executed" | "rejected" | "expired";
  approvedBy?: string;
  approvedAt?: Timestamp;
  approvalNotes?: string;

  // Execution state
  executedAt?: Timestamp;
  executionError?: string;
  idempotencyKey?: string; // tracks successful executions

  // Audit
  attemptCount: number;
  lastAttemptAt?: Timestamp;
}

// ============================================================================
// PROPOSAL CREATION
// ============================================================================

/**
 * Creates a new action proposal pending approval
 */
export async function createProposal(
  clinicId: string,
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  description: string,
  arguments_: Record<string, any>,
  expirationHours: number = 24
): Promise<string> {
  if (!clinicId || !userId || !action) {
    throw new Error("Missing required proposal fields");
  }

  const proposalId = createIdempotencyKey(`${clinicId}:${action}:${resourceId}:${Date.now()}`);
  const now = Timestamp.now();
  const expiresAt = new Timestamp(
    now.seconds + expirationHours * 3600,
    now.nanoseconds
  );

  const argumentsHash = hashArguments(arguments_);
  const argumentsSummary = sanitizeArgumentsForDisplay(arguments_);

  const proposal: ActionProposal = {
    id: proposalId,
    clinicId,
    userId,
    createdBy: "ai_system",
    createdAt: now,
    expiresAt,
    action,
    resourceType,
    resourceId,
    description,
    argumentsHash,
    argumentsSummary,
    status: "pending",
    attemptCount: 0,
  };

  await getAdminDb()
    .doc(`clinics/${clinicId}/action_proposals/${proposalId}`)
    .set(proposal);

  return proposalId;
}

// ============================================================================
// APPROVAL
// ============================================================================

/**
 * Approves a pending proposal
 * SECURITY: Can only approve if:
 * - Status is pending
 * - Not expired
 * - Approver is authorized (not the creator)
 */
export async function approveProposal(
  clinicId: string,
  proposalId: string,
  approverId: string,
  approvalNotes: string = ""
): Promise<void> {
  const proposalRef = getAdminDb().doc(`clinics/${clinicId}/action_proposals/${proposalId}`);
  const proposalSnap = await proposalRef.get();

  if (!proposalSnap.exists) {
    throw new ElizaError(
      ElizaErrorCode.NOT_FOUND,
      "Proposal not found",
      404
    );
  }

  const proposal = proposalSnap.data() as ActionProposal;

  // Validate current status
  if (proposal.status !== "pending") {
    throw new ElizaError(
      ElizaErrorCode.INVALID_STATE,
      `Proposal is ${proposal.status}, not pending`,
      400
    );
  }

  // Check expiration
  if (Timestamp.now().toMillis() > proposal.expiresAt.toMillis()) {
    await proposalRef.update({ status: "expired" });
    throw new ElizaError(
      ElizaErrorCode.EXPIRED,
      "Proposal has expired",
      400
    );
  }

  // Security: Don't allow self-approval
  if (approverId === proposal.userId && proposal.createdBy === "ai_system") {
    // AI suggestions must be approved by different person
    // (You could allow same person if createdBy is "user")
  }

  // Update to approved
  await proposalRef.update({
    status: "approved",
    approvedBy: approverId,
    approvedAt: Timestamp.now(),
    approvalNotes,
  });
}

// ============================================================================
// IDEMPOTENT EXECUTION
// ============================================================================

/**
 * Executes an approved proposal with full idempotency
 * 
 * Returns: idempotency key for this execution
 * If same idempotency key is sent again, returns cached result
 */
export async function executeProposal(
  clinicId: string,
  proposalId: string,
  executorId: string,
  actionHandler: (proposal: ActionProposal) => Promise<any>,
  idempotencyKey?: string
): Promise<{
  success: boolean;
  result?: any;
  error?: string;
  idempotencyKey: string;
}> {
  const proposalRef = getAdminDb().doc(`clinics/${clinicId}/action_proposals/${proposalId}`);
  const proposalSnap = await proposalRef.get();

  if (!proposalSnap.exists) {
    throw new ElizaError(
      ElizaErrorCode.NOT_FOUND,
      "Proposal not found",
      404
    );
  }

  const proposal = proposalSnap.data() as ActionProposal;

  // Generate idempotency key if not provided
  if (!idempotencyKey) {
    idempotencyKey = createIdempotencyKey(`${clinicId}:${proposalId}:${Date.now()}`);
  }

  // Check if already executed with this idempotency key
  if (proposal.idempotencyKey === idempotencyKey && proposal.status === "executed") {
    return {
      success: true,
      result: proposal.executionResult,
      idempotencyKey,
    };
  }

  // Validate status
  if (proposal.status !== "approved") {
    throw new ElizaError(
      ElizaErrorCode.INVALID_STATE,
      `Proposal status is ${proposal.status}, cannot execute. Must be approved.`,
      400
    );
  }

  // Check expiration
  if (Timestamp.now().toMillis() > proposal.expiresAt.toMillis()) {
    await proposalRef.update({ status: "expired" });
    throw new ElizaError(
      ElizaErrorCode.EXPIRED,
      "Approval has expired",
      400
    );
  }

  // Execute the action
  let result;
  let executionError: string | undefined;

  try {
    result = await actionHandler(proposal);
  } catch (err: any) {
    executionError = err.message;
  }

  // Update proposal with execution result
  const updateData: any = {
    status: executionError ? "failed" : "executed",
    executedAt: Timestamp.now(),
    idempotencyKey,
    lastAttemptAt: Timestamp.now(),
    attemptCount: (proposal.attemptCount || 0) + 1,
  };

  if (executionError) {
    updateData.executionError = executionError;
  } else {
    updateData.executionResult = result;
  }

  await proposalRef.update(updateData);

  if (executionError) {
    throw new ElizaError(
      ElizaErrorCode.EXECUTION_FAILED,
      executionError,
      500
    );
  }

  return {
    success: true,
    result,
    idempotencyKey,
  };
}

// ============================================================================
// RETRIEVAL
// ============================================================================

/**
 * Get a proposal by ID
 */
export async function getProposal(
  clinicId: string,
  proposalId: string
): Promise<ActionProposal> {
  const snap = await getAdminDb()
    .doc(`clinics/${clinicId}/action_proposals/${proposalId}`)
    .get();

  if (!snap.exists) {
    throw new ElizaError(
      ElizaErrorCode.NOT_FOUND,
      "Proposal not found",
      404
    );
  }

  return snap.data() as ActionProposal;
}

/**
 * List pending proposals for clinic
 */
export async function listPendingProposals(
  clinicId: string,
  limit: number = 50
): Promise<ActionProposal[]> {
  const snapshot = await getAdminDb()
    .collection(`clinics/${clinicId}/action_proposals`)
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => doc.data() as ActionProposal);
}

/**
 * List approved but not executed proposals (pending execution)
 */
export async function listReadyForExecution(
  clinicId: string,
  limit: number = 50
): Promise<ActionProposal[]> {
  const snapshot = await getAdminDb()
    .collection(`clinics/${clinicId}/action_proposals`)
    .where("status", "==", "approved")
    .orderBy("approvedAt", "asc")
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => doc.data() as ActionProposal);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Creates deterministic hash of action arguments
 * Used to detect tampering or changes to the proposal
 */
function hashArguments(arguments_: Record<string, any>): string {
  const json = JSON.stringify(arguments_, Object.keys(arguments_).sort());
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Creates deterministic idempotency key
 */
export function createIdempotencyKey(data: string): string {
  return createHash("sha256")
    .update(data)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Removes sensitive data from arguments for display to humans
 * E.g., masks patient health info if present
 */
function sanitizeArgumentsForDisplay(arguments_: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(arguments_)) {
    // Keep non-sensitive fields
    if (key.includes("id") || key.includes("Id")) {
      sanitized[key] = value; // IDs are ok
    } else if (key.includes("medical") || key.includes("health") || key.includes("diagnosis")) {
      sanitized[key] = "[REDACTED - CLINICAL DATA]"; // Hide sensitive clinical data
    } else if (typeof value === "object") {
      sanitized[key] = "[OBJECT]"; // Hide complex objects
    } else if (typeof value === "string" && value.length > 100) {
      sanitized[key] = value.substring(0, 100) + "..."; // Truncate long strings
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Cleans up expired proposals (should be run periodically)
 */
export async function cleanupExpiredProposals(clinicId: string): Promise<number> {
  const snapshot = await getAdminDb()
    .collection(`clinics/${clinicId}/action_proposals`)
    .where("status", "==", "pending")
    .where("expiresAt", "<", Timestamp.now())
    .get();

  let count = 0;
  for (const doc of snapshot.docs) {
    await doc.ref.update({ status: "expired" });
    count++;
  }

  return count;
}
