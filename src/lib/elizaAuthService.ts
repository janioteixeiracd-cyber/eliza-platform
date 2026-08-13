/**
 * ELIZA Authentication Service
 * Handles JWT validation, clinicId extraction, and authorization
 */

import jwt from "jsonwebtoken";
import { ElizaError, ElizaErrorCode, JWTPayload } from "../types/eliza-intelligence";

// ============================================================================
// CONFIGURATION
// ============================================================================

// In production, this should come from Secret Manager
const SIGNING_KEY = process.env.ELIZA_JWT_SECRET || "eliza-dev-secret-change-in-prod";
const JWT_ISSUER = "eliza.clinic";
const JWT_ALGORITHM = "HS256";
const JWT_EXPIRY = "5h";

// ============================================================================
// JWT GENERATION (for server-side token creation)
// ============================================================================

export function generateJWT(
  userId: string,
  clinicId: string,
  role: "owner" | "admin" | "professional" | "member",
  permissions: string[] = []
): string {
  const payload: Omit<JWTPayload, "exp" | "iat"> = {
    sub: userId,
    clinic_id: clinicId,
    role,
    permissions,
    iss: JWT_ISSUER,
  };

  return jwt.sign(payload, SIGNING_KEY, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRY,
  });
}

// ============================================================================
// JWT VALIDATION & EXTRACTION
// ============================================================================

export function verifyAndDecodeJWT(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, SIGNING_KEY, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    }) as JWTPayload;

    return decoded;
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ElizaError(
        ElizaErrorCode.TOKEN_EXPIRED,
        "Token expirado. Faça login novamente.",
        401
      );
    } else if (err instanceof jwt.JsonWebTokenError) {
      throw new ElizaError(
        ElizaErrorCode.INVALID_TOKEN,
        "Token inválido.",
        401
      );
    }
    throw new ElizaError(
      ElizaErrorCode.AUTH_ERROR,
      "Erro ao validar autenticação.",
      401
    );
  }
}

export function extractBearerToken(authHeader: string): string {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ElizaError(
      ElizaErrorCode.AUTH_ERROR,
      "Header de autenticação ausente ou inválido.",
      401
    );
  }

  return authHeader.substring(7); // Remove "Bearer " prefix
}

export function extractClinicIdFromJWT(token: string): string {
  const decoded = verifyAndDecodeJWT(token);
  return decoded.clinic_id;
}

// ============================================================================
// CLINIC ID VALIDATION
// ============================================================================

/**
 * Validates that clinicId is consistent across all sources
 * - JWT (authority)
 * - Context
 * - Body (optional, should NOT be used)
 */
export function validateClinicIdConsistency(
  tokenClinicId: string,
  contextClinicId: string,
  bodyClinicId?: string
): string {
  // If body provides clinicId, it must match JWT
  if (bodyClinicId) {
    if (bodyClinicId !== tokenClinicId) {
      throw new ElizaError(
        ElizaErrorCode.SECURITY_MISMATCH,
        "SECURITY: clinicId no body não corresponde ao JWT.",
        403,
        { tokenClinicId, bodyClinicId }
      );
    }
  }

  // Context clinicId must match JWT
  if (contextClinicId !== tokenClinicId) {
    throw new ElizaError(
      ElizaErrorCode.SECURITY_MISMATCH,
      "SECURITY: clinicId no contexto não corresponde ao JWT.",
      403,
      { tokenClinicId, contextClinicId }
    );
  }

  return tokenClinicId;
}

// Add SECURITY_MISMATCH to error codes if not already there
declare global {
  namespace ElizaErrorCode {
    const SECURITY_MISMATCH: "SECURITY_MISMATCH";
  }
}

// Extend ElizaErrorCode enum
(ElizaErrorCode as any).SECURITY_MISMATCH = "SECURITY_MISMATCH";

// ============================================================================
// MIDDLEWARE FACTORY
// ============================================================================

/**
 * Express middleware that validates JWT and extracts clinicId
 * Attaches decoded JWT and clinicId to req for downstream handlers
 */
export function elizaAuthMiddleware(
  req: any,
  res: any,
  next: any
) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractBearerToken(authHeader);
    const decoded = verifyAndDecodeJWT(token);

    // Attach to request
    req.elizaAuth = {
      token,
      decoded,
      userId: decoded.sub,
      clinicId: decoded.clinic_id,
      role: decoded.role,
      permissions: decoded.permissions || [],
    };

    next();
  } catch (err: any) {
    const statusCode = err.statusCode || 401;
    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || ElizaErrorCode.AUTH_ERROR,
        message: err.message,
      },
    });
  }
}

// ============================================================================
// PERMISSION CHECKING
// ============================================================================

export function hasPermission(
  userPermissions: string[],
  requiredPermission: string
): boolean {
  return userPermissions.includes(requiredPermission);
}

export function hasRole(
  userRole: "owner" | "admin" | "professional" | "member",
  requiredRole: "owner" | "admin" | "professional" | "member"
): boolean {
  const roleHierarchy = {
    owner: 4,
    admin: 3,
    professional: 2,
    member: 1,
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export function validateUserRole(
  userRole: string,
  allowedRoles: string[]
): boolean {
  return allowedRoles.includes(userRole);
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isValidJWTPayload(payload: any): payload is JWTPayload {
  return (
    typeof payload === "object" &&
    typeof payload.sub === "string" &&
    typeof payload.clinic_id === "string" &&
    typeof payload.role === "string" &&
    Array.isArray(payload.permissions) &&
    typeof payload.exp === "number" &&
    typeof payload.iat === "number" &&
    payload.iss === JWT_ISSUER
  );
}
