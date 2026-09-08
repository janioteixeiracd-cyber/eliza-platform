import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, connectAuthEmulator } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import firebaseConfig from '../../firebase-applet-config.json';

// Create a secondary app instance to handle account creation without logging
// out the admin. Unique name to avoid conflicts.
const inviteAppName = "ELIZA_INVITE_APP";

// This secondary app is independent from the main app in lib/firebase.ts, so
// it does NOT automatically inherit the emulator connection — without this,
// account creation would silently hit real production Auth even when the
// rest of the app is talking to the local emulator. Same opt-in guard/flag as
// lib/firebase.ts (VITE_USE_FIREBASE_EMULATOR), guarded against being
// connected twice (throws if called more than once per Auth instance).
const useEmulator = (import.meta as any).env?.VITE_USE_FIREBASE_EMULATOR === 'true';

function getSecondaryAuth() {
  const existingApp = getApps().find(a => a.name === inviteAppName);
  const secondaryApp = existingApp || initializeApp(firebaseConfig, inviteAppName);
  const secondaryAuth = getAuth(secondaryApp);
  if (useEmulator && !(globalThis as any).__ELIZA_INVITE_EMULATOR_CONNECTED__) {
    (globalThis as any).__ELIZA_INVITE_EMULATOR_CONNECTED__ = true;
    connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    console.log('[InviteService] Secondary app connected to LOCAL AUTH EMULATOR — not touching production elisa-494703 data.');
  }
  return secondaryAuth;
}

async function createSecondaryAuthUser(email: string, password: string): Promise<string> {
  const secondaryAuth = getSecondaryAuth();
  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = userCredential.user.uid;
    await signOut(secondaryAuth);
    return uid;
  } catch (authError: any) {
    if (authError.code === 'auth/email-already-in-use') {
      throw new Error("Este e-mail já possui uma conta. Peça para a pessoa entrar e solicitar vínculo com a clínica.");
    }
    throw authError;
  }
}

export const InviteService = {
  createStaffMember: async (
    adminClinicId: string,
    staffData: { email: string; name: string; role: string; password?: string; isClinicalProvider?: boolean }
  ) => {
    console.log(`[InviteService] Creating staff member: ${staffData.email} for clinic ${adminClinicId}`);
    const password = staffData.password || "Eliza12345";
    const newUid = await createSecondaryAuthUser(staffData.email, password);

    const memberPath = `clinics/${adminClinicId}/members/${newUid}`;
    const memberRef = doc(db, 'clinics', adminClinicId, 'members', newUid);
    console.log("[INVITE] writing member path:", memberPath);
    try {
      const isClinFallVal = ['dentist', 'dentist_gp', 'especialista', 'professional', 'clinical_professional', 'doctor', 'dentista', 'odontologista'].includes(staffData.role?.toLowerCase() || '');
      await setDoc(memberRef, {
        uid: newUid,
        email: staffData.email.toLowerCase(),
        name: staffData.name,
        role: staffData.role,
        active: true,
        status: "active",
        clinicId: adminClinicId,
        invitedBy: getAuth().currentUser?.uid || 'system',
        isClinicalProvider: staffData.isClinicalProvider !== undefined ? staffData.isClinicalProvider : isClinFallVal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        mustChangePassword: true
      });
    } catch (memberWriteErr: any) {
      console.error("[INVITE] Error writing to clinic membership:", memberWriteErr.message);
      throw new Error(`Permissão insuficiente ao salvar vínculo em ${memberPath}: ${memberWriteErr.message}`);
    }

    console.log(`[InviteService] Membership linked for ${newUid}. Profile will be created on first login.`);
    return { success: true, uid: newUid, isNewUser: true };
  },

  // Same emulator-safe secondary-app pattern as createStaffMember, but for
  // Eliza Academy students: writes to education_students/{uid} instead of
  // members/{uid}, and mirrors users/{uid} with role:'aluno' so the login
  // routes into the student portal (matches firestore.rules' isStudentOfClinic
  // helper, which checks exactly this pair of docs).
  createEducationStudent: async (
    adminClinicId: string,
    studentData: { email: string; name: string; password?: string; courseId?: string; batchName?: string; permissions?: Record<string, boolean>; accessExpirationDate?: string | null }
  ) => {
    console.log(`[InviteService] Creating education student: ${studentData.email} for clinic ${adminClinicId}`);
    const password = studentData.password || "Eliza12345";
    const newUid = await createSecondaryAuthUser(studentData.email, password);

    const studentRef = doc(db, 'clinics', adminClinicId, 'education_students', newUid);
    try {
      await setDoc(studentRef, {
        authUid: newUid,
        uid: newUid,
        email: studentData.email.toLowerCase(),
        emailLowercase: studentData.email.toLowerCase(),
        name: studentData.name,
        courseId: studentData.courseId || null,
        batchName: studentData.batchName || null,
        status: 'ativo',
        accessExpirationDate: studentData.accessExpirationDate || null,
        ...(studentData.permissions || {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        mustChangePassword: true,
        // Persisted (not just shown once in the creation UI) so an admin who
        // forgets the password later can still look it up instead of being
        // stuck — the same reason a reset also rewrites this field.
        tempPassword: password,
      });
      await setDoc(doc(db, 'users', newUid), {
        uid: newUid,
        name: studentData.name,
        email: studentData.email.toLowerCase(),
        role: 'aluno',
        defaultClinicId: adminClinicId,
        clinicId: adminClinicId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (writeErr: any) {
      console.error("[INVITE] Error writing education student docs:", writeErr.message);
      throw new Error(`Permissão insuficiente ao salvar aluno: ${writeErr.message}`);
    }

    console.log(`[InviteService] Education student linked for ${newUid}.`);
    return { success: true, uid: newUid, isNewUser: true };
  },

  // Same emulator-safe secondary-app pattern, for granting brand-new people
  // Super Admin access to the platform (writes platform_admins/{uid}, gated
  // by firestore.rules' isPlatformAdmin()). Distinct from grantPlatformAdmin
  // in platformAdminService.ts, which handles the case where the person
  // already has an account.
  createPlatformAdmin: async (
    adminData: { email: string; name: string; role: string; password?: string },
    grantedByUid: string
  ) => {
    console.log(`[InviteService] Creating platform admin: ${adminData.email}`);
    const password = adminData.password || "Eliza12345";
    const newUid = await createSecondaryAuthUser(adminData.email, password);

    try {
      await setDoc(doc(db, 'platform_admins', newUid), {
        email: adminData.email.toLowerCase(),
        name: adminData.name,
        role: adminData.role,
        active: true,
        grantedBy: grantedByUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', newUid), {
        uid: newUid,
        name: adminData.name,
        email: adminData.email.toLowerCase(),
        platformRole: adminData.role,
        isPlatformAdmin: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (writeErr: any) {
      console.error("[INVITE] Error writing platform admin docs:", writeErr.message);
      throw new Error(`Permissão insuficiente ao conceder acesso: ${writeErr.message}`);
    }

    console.log(`[InviteService] Platform admin linked for ${newUid}.`);
    return { success: true, uid: newUid, isNewUser: true };
  },
};
