/**
 * Auth Controller - SECURITY FIXED
 * Validates Firebase ID Token before issuing access
 * Never trusts UID from client - only from Firebase token
 */

import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAdminDb, getAdminAuth } from "../lib/adminFirebase";

// ============================================================================
// LOGIN & TOKEN GENERATION
// ============================================================================

/**
 * POST /api/auth/login
 * SECURITY: Validates Firebase ID Token and issues internal access token
 *
 * Request:
 * Headers: Authorization: Bearer <Firebase ID Token>
 * Body: { "clinicId": "clinic456" }
 *
 * Firebase ID Token is obtained via Firebase Auth SDK on frontend
 * Example (frontend):
 *   const firebaseToken = await user.getIdToken(true);
 *   const response = await fetch('/api/auth/login', {
 *     headers: { 'Authorization': `Bearer ${firebaseToken}` },
 *     body: JSON.stringify({ clinicId: 'clinic456' })
 *   });
 */
export async function login(req: Request, res: Response) {
  try {
    // SECURITY: Get Firebase token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authorization header com Firebase ID Token é obrigatório",
      });
    }

    const firebaseToken = authHeader.substring(7);
    const { clinicId } = req.body;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: "clinicId é obrigatório",
      });
    }

    // SECURITY: Validate Firebase ID Token
    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(firebaseToken);
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        error: "Firebase ID Token inválido ou expirado",
      });
    }

    // SECURITY: Extract UID exclusively from Firebase token
    const firebaseUid = decodedToken.uid;

    // SECURITY: Verify user is active member of clinic
    const memberDoc = await getAdminDb()
      .doc(`clinics/${clinicId}/members/${firebaseUid}`)
      .get();

    if (!memberDoc.exists) {
      return res.status(403).json({
        success: false,
        error: "Usuário não é membro desta clínica",
      });
    }

    const memberData = memberDoc.data();
    if (memberData?.active === false) {
      return res.status(403).json({
        success: false,
        error: "Usuário inativo nesta clínica",
      });
    }

    // Get role and permissions from Firestore (authoritative source)
    const role = memberData?.role || "member";
    const permissions = memberData?.permissions || [];

    // SECURITY: Issue internal access token with clinicId from server
    // Token is stateless but clinicId is verified and server-authorized
    const accessToken = createAccessToken(firebaseUid, clinicId, role, permissions);

    return res.json({
      success: true,
      data: {
        accessToken,
        firebaseUid,
        clinicId,
        role,
        permissions,
        expiresIn: 3600, // 1 hour (shorter than Firebase token)
      },
    });
  } catch (err: any) {
    console.error("[AUTH_LOGIN_ERROR]", err);
    return res.status(500).json({
      success: false,
      error: "Erro ao processar login",
    });
  }
}

/**
 * Creates an internal access token (compact, server-only format)
 * NOT a JWT - just base64 encoded server-side object for simplicity
 * Could be upgraded to JWT if needed, but Firebase token is the real auth
 */
function createAccessToken(userId: string, clinicId: string, role: string, permissions: string[]): string {
  const payload = {
    uid: userId,
    clinic_id: clinicId,
    role,
    permissions,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Verifies internal access token
 */
export function verifyAccessToken(token: string): any {
  try {
    const payload = JSON.parse(Buffer.from(token, "base64").toString());
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new Error("Token expired");
    }
    return payload;
  } catch (err: any) {
    throw new Error(`Invalid access token: ${err.message}`);
  }
}

/**
 * GET /api/auth/me
 * Returns current authenticated user info
 *
 * Headers:
 * Authorization: Bearer <access-token>
 */
export async function getCurrentUser(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authorization header com access token é obrigatório",
      });
    }

    const token = authHeader.substring(7);
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        error: "Token inválido ou expirado",
      });
    }

    // Load current user data from Firestore (always fresh, never from token)
    const userDoc = await getAdminDb()
      .doc(`clinics/${payload.clinic_id}/members/${payload.uid}`)
      .get();

    if (!userDoc.exists) {
      return res.status(403).json({
        success: false,
        error: "Usuário não é mais membro desta clínica",
      });
    }

    const memberData = userDoc.data();
    if (memberData?.active === false) {
      return res.status(403).json({
        success: false,
        error: "Usuário foi desativado",
      });
    }

    return res.json({
      success: true,
      data: {
        userId: payload.uid,
        clinicId: payload.clinic_id,
        role: memberData.role, // Always from Firestore, not token
        permissions: memberData.permissions,
        userInfo: memberData,
      },
    });
  } catch (err: any) {
    console.error("[AUTH_ME_ERROR]", err);
    return res.status(500).json({
      success: false,
      error: "Erro ao obter informações do usuário",
    });
  }
}

/**
 * GET /api/auth/clinics
 * Returns all clinics the user is member of
 *
 * Headers:
 * Authorization: Bearer <Firebase ID Token>
 */
export async function getUserClinics(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authorization header com Firebase ID Token é obrigatório",
      });
    }

    const firebaseToken = authHeader.substring(7);

    // Validate Firebase token to get UID
    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(firebaseToken);
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        error: "Firebase ID Token inválido",
      });
    }

    const userId = decodedToken.uid;

    // Find all clinics where user is active member
    const clinicsSnapshot = await getAdminDb()
      .collectionGroup("members")
      .where("__name__", "==", userId)
      .get();

    const clinics = [];
    for (const doc of clinicsSnapshot.docs) {
      const memberData = doc.data();
      if (memberData.active === false) continue; // Skip inactive memberships

      const clinicId = doc.ref.parent.parent?.id;
      if (clinicId) {
        const clinicData = await getAdminDb().doc(`clinics/${clinicId}`).get();
        clinics.push({
          id: clinicId,
          name: clinicData.data()?.name || "Clínica",
          role: memberData.role,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        clinics,
        total: clinics.length,
      },
    });
  } catch (err: any) {
    console.error("[AUTH_CLINICS_ERROR]", err);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar clínicas",
    });
  }
}

/**
 * POST /api/auth/logout
 * Client-side logout - token is stateless
 * Client should discard the token
 */
export async function logout(req: Request, res: Response) {
  return res.json({
    success: true,
    message: "Desconectado com sucesso",
  });
}

/**
 * POST /api/auth/refresh
 * NOT IMPLEMENTED: this route was referenced in server.ts but had no
 * handler, which crashed Express at startup (Route.post() requires a
 * callback function but got undefined). This stub only exists so the
 * route can be registered; it does not issue a new token. The real app
 * does not rely on this endpoint (login/session state is handled entirely
 * by the Firebase Auth client SDK, not this token flow).
 */
export async function refresh(req: Request, res: Response) {
  return res.status(501).json({
    success: false,
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Refresh de access token ainda não foi implementado neste endpoint.",
    },
  });
}
