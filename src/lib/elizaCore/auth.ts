/**
 * ELIZA Intelligence v2 — authentication.
 *
 * Deliberately does NOT introduce a second auth system. The app already
 * authenticates every staff session with Firebase Auth; this reuses that
 * exact mechanism (verify the real Firebase ID token, then check real
 * Firestore clinic membership) — the same pattern already proven in
 * server.ts's `patientPortalStaffAuth`. clinicId always arrives from the
 * client as a claim to verify, never as a fact to trust: a request is only
 * authorized once the token's uid is confirmed to be an active member of
 * that exact clinicId in Firestore.
 */
import { getAdminAuth, getAdminDb } from "../adminFirebase";
import { ElizaError, ElizaErrorCode } from "../../types/eliza-intelligence";

export interface ElizaAuthedUser {
  uid: string;
  clinicId: string;
  memberRole: string;
  isOwnerOrAdmin: boolean;
  memberData: Record<string, any>;
}

/**
 * Verifies the bearer token and confirms active membership in the claimed
 * clinic. Throws ElizaError (401/403) on any failure — callers should catch
 * and translate to an HTTP response, never assume success.
 */
export async function authenticateElizaRequest(req: any): Promise<ElizaAuthedUser> {
  const authHeader = req.headers?.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new ElizaError(ElizaErrorCode.AUTH_ERROR, "Autenticação necessária.", 401);
  }

  const clinicId = req.body?.clinicId || req.query?.clinicId;
  if (!clinicId || typeof clinicId !== "string") {
    throw new ElizaError(ElizaErrorCode.VALIDATION_ERROR, "clinicId é obrigatório.", 400);
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(authHeader.substring(7));
  } catch (err: any) {
    throw new ElizaError(ElizaErrorCode.INVALID_TOKEN, "Token inválido ou expirado.", 401);
  }

  const db = getAdminDb();
  const [memberSnap, clinicSnap, platformAdminSnap] = await Promise.all([
    db.doc(`clinics/${clinicId}/members/${decoded.uid}`).get(),
    db.doc(`clinics/${clinicId}`).get(),
    db.doc(`platform_admins/${decoded.uid}`).get(),
  ]);

  if (!memberSnap.exists) {
    throw new ElizaError(ElizaErrorCode.UNAUTHORIZED, "Você não é membro desta clínica.", 403);
  }
  const memberData = memberSnap.data() || {};
  if (memberData.active === false || memberData.status === "inactive") {
    throw new ElizaError(ElizaErrorCode.UNAUTHORIZED, "Seu acesso a esta clínica está inativo.", 403);
  }

  const clinicData = clinicSnap.exists ? clinicSnap.data() || {} : {};
  const memberRole = String(memberData.role || "");
  // Mesma regra exata de isPlatformAdmin() em firestore.rules — sem isto, um
  // Platform Admin (rótulo "Super Admin" na UI) que não seja literalmente o
  // ownerId desta clínica específica caía fora da checagem de owner/admin e
  // a Eliza recusava mostrar financeiro pra ele.
  const isPlatformAdmin =
    decoded.uid === "PnEUUeLkWIVyIdIbcynwqBa6Wv72" ||
    (platformAdminSnap.exists && platformAdminSnap.data()?.active === true);
  const isOwnerOrAdmin =
    isPlatformAdmin ||
    clinicData.ownerId === decoded.uid ||
    memberRole === "Dono" ||
    memberRole === "Gerente" ||
    memberRole.toLowerCase() === "owner" ||
    memberRole.toLowerCase() === "admin";

  return {
    uid: decoded.uid,
    clinicId,
    memberRole,
    isOwnerOrAdmin,
    memberData,
  };
}

/**
 * Financial visibility follows the exact same rule already used by the
 * WhatsApp "resumo do dia" command (server.ts's generatePersonalizedSummary)
 * — reused here rather than inventing a second permission model.
 */
export function canAccessFinance(user: ElizaAuthedUser): boolean {
  if (user.isOwnerOrAdmin) return true;
  const role = user.memberRole.toLowerCase();
  if (role === "financeiro" || role === "financial") return true;
  const perms: string[] = user.memberData.permissions || [];
  return perms.includes("visualizar_financeiro") || perms.includes("financeiro") || perms.includes("financial");
}

export interface AcademyAuthedUser {
  uid: string;
  clinicId: string;
  turmaId: string;
  role: 'student' | 'staff';
}

/**
 * Same shape as authenticateElizaRequest, but for the Academy tutor endpoint
 * — the caller may be a STUDENT (education_enrollments, no `members` doc at
 * all) or turma staff/admin, so this checks both instead of requiring clinic
 * membership. Mirrors firestore.rules' hasValidEnrollment()/isTurmaStaff()
 * exactly, so server-side authorization for the AI action matches
 * client-side authorization for the same data.
 */
export async function authenticateAcademyRequest(req: any): Promise<AcademyAuthedUser> {
  const authHeader = req.headers?.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new ElizaError(ElizaErrorCode.AUTH_ERROR, "Autenticação necessária.", 401);
  }
  const clinicId = req.body?.clinicId;
  const turmaId = req.body?.turmaId;
  if (!clinicId || typeof clinicId !== "string" || !turmaId || typeof turmaId !== "string") {
    throw new ElizaError(ElizaErrorCode.VALIDATION_ERROR, "clinicId e turmaId são obrigatórios.", 400);
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(authHeader.substring(7));
  } catch (err: any) {
    throw new ElizaError(ElizaErrorCode.INVALID_TOKEN, "Token inválido ou expirado.", 401);
  }

  const db = getAdminDb();
  const [enrollSnap, staffSnap, memberSnap, clinicSnap] = await Promise.all([
    db.doc(`clinics/${clinicId}/education_enrollments/${turmaId}_${decoded.uid}`).get(),
    db.doc(`clinics/${clinicId}/education_turmas/${turmaId}/staff/${decoded.uid}`).get(),
    db.doc(`clinics/${clinicId}/members/${decoded.uid}`).get(),
    db.doc(`clinics/${clinicId}`).get(),
  ]);

  const hasValidEnrollment = enrollSnap.exists && enrollSnap.data()?.status !== "cancelada";
  const isActiveTurmaStaff = staffSnap.exists && staffSnap.data()?.active === true;
  const memberData = memberSnap.exists ? memberSnap.data() || {} : {};
  const memberRole = String(memberData.role || memberData.courseRole || "");
  const clinicData = clinicSnap.exists ? clinicSnap.data() || {} : {};
  const isClinicAdmin = memberSnap.exists
    && (memberData.active === true || memberData.status === "active" || memberData.status === "ativo")
    && (clinicData.ownerId === decoded.uid || ["owner", "admin", "administrator", "dono", "administrador"].includes(memberRole.toLowerCase()) || memberData.courseRole === "admin_curso");

  if (isActiveTurmaStaff || isClinicAdmin) {
    return { uid: decoded.uid, clinicId, turmaId, role: "staff" };
  }
  if (hasValidEnrollment) {
    return { uid: decoded.uid, clinicId, turmaId, role: "student" };
  }
  throw new ElizaError(ElizaErrorCode.UNAUTHORIZED, "Você não tem vínculo com esta turma.", 403);
}

/**
 * A patientId is only ever trustworthy after this check — confirms the
 * patient document actually lives under this exact clinicId's
 * subcollection before any tool is allowed to read/write anything scoped
 * to it. Never skip this just because the frontend already "knows" which
 * clinic the patient belongs to.
 */
export async function validatePatientBelongsToClinic(clinicId: string, patientId: string): Promise<boolean> {
  const snap = await getAdminDb().doc(`clinics/${clinicId}/patients/${patientId}`).get();
  return snap.exists;
}
