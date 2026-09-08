import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  signOut, 
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, query, collection, where, getDocs, limit, getDocFromServer, collectionGroup, deleteDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType, FIRESTORE_DATABASE_ID } from '../lib/firebase';
import { ENABLE_PLATFORM_ADMIN } from '../config';
import { PlatformAdminService } from '../services/platformAdminService';

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  defaultClinicId?: string;
  role?: string;
  isPlatformAdmin?: boolean;
  platformRole?: 'super_admin' | 'admin' | 'support';
  tempPassword?: string;
  mustChangePassword?: boolean;
  createdAt?: any;
  updatedAt?: any;
  userType?: string;
  clinicId?: string;
  // Dual-role (Clinic + Academy): additive-only academic fields, present when
  // this uid ALSO has an active education_students doc while being resolved
  // primarily as staff (role/clinicId above stay the staff identity — see
  // findActiveMembership() and the case-C branch in syncProfile()).
  hasEducationAccess?: boolean;
  educationStudentId?: string;
  educationCourseId?: string | null;
  educationClassId?: string | null;
}

interface ClinicData {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontPreference?: string;
  logoBase64?: string;
  documentName?: string;
  institutionalFooter?: string;
  privacyPolicyText?: string;
  textSignature?: string;
  address?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  defaultObservationText?: string;
  technicalDirectorCouncilNumber?: string;
  companyName?: string;
  cnpj?: string;
  academyEnabled?: boolean;
  termsAccepted?: boolean;
  [key: string]: any;
}

// Cadastro → Checkout (Asaas): "authenticated, hasn't paid yet" state, read
// from clinics/{id}-sibling top-level `signups/{uid}` (never `users/{uid}` —
// see the comment on that collection's firestore.rules entry for why).
// Client only ever reads this; server.ts is the only writer.
export interface SignupData {
  id: string;
  status: 'pending_payment' | 'payment_processing' | 'paid' | 'expired';
  planRoleSelected?: 'assistant' | 'secretary' | 'manager';
  clinicId?: string | null;
  asaasCheckoutUrl?: string | null;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  clinic: ClinicData | null;
  signup: SignupData | null;
  isPlatformAdmin: boolean;
  platformRole: string | null;
  loading: boolean;
  isQuotaExceeded: boolean;
  authError: string | null;
  bootstrapTime: number;
  supportMode: { active: boolean; clinicId: string | null; clinicData: ClinicData | null };
  enterSupportMode: (clinicId: string) => Promise<void>;
  exitSupportMode: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  changeStudentPassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to strip undefined values recursively before saving to Firestore
export function removeUndefinedFields(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (obj.constructor && obj.constructor.name !== "Object" && obj.constructor.name !== "Array") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedFields);
  }
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      result[key] = removeUndefinedFields(val);
    }
  }
  return result;
}

// Dual-role support (Clinic + Academy): a single Firebase Auth uid can hold
// an active `members` doc AND an active `education_students` doc at the same
// time (see CEREBRO: identidade-unica-membro-e-aluna-simultaneos). This is
// the ONE place that answers "is this uid an active clinic staff member?" —
// both syncProfile() and loginWithEmail() call it independently of whatever
// education_students lookup they also run, so neither path can short-circuit
// the other and mistake "found a student doc" for "this whole identity is a
// student, not staff too".
async function findActiveMembership(uid: string): Promise<{ clinicId: string; role: string } | null> {
  try {
    const q = query(collectionGroup(db, 'members'), where('uid', '==', uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const mDoc = snap.docs[0];
      const mData = mDoc.data();
      if (mData.status === 'active' || mData.active === true || mData.status === 'ativo') {
        const clinicId = mData.clinicId || mDoc.ref.parent.parent?.id;
        if (clinicId) return { clinicId, role: mData.role };
      }
    }
  } catch (e: any) {
    console.warn('[ELIZA] Error checking clinical memberships:', e.message || e);
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [clinic, setClinic] = useState<ClinicData | null>(null);
  const [signup, setSignup] = useState<SignupData | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [platformRole, setPlatformRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapTime, setBootstrapTime] = useState(0);
  // Platform-admin "support mode": lets a super admin temporarily view a
  // different clinic's real data for support/debugging. Lives here (not in
  // AdminContext) so the override reaches every consumer of useAuth().clinic
  // across both the legacy app and Eliza Next automatically — those ~20+
  // components each call useAuth() directly, they don't receive clinic via
  // props from a shared layout.
  const [supportMode, setSupportMode] = useState<{ active: boolean; clinicId: string | null; clinicData: ClinicData | null }>({
    active: false,
    clinicId: null,
    clinicData: null,
  });
  const effectiveClinic = supportMode.active && supportMode.clinicData ? supportMode.clinicData : clinic;

  // Cadastro → Checkout: read-only listener on the caller's own signups/{uid}
  // doc. Independent of the clinic/membership resolution below — a brand new
  // signup has neither yet, and AppLayout.tsx branches on `signup?.status`
  // before it ever reaches the "no clinic" fallback.
  useEffect(() => {
    if (!user?.uid) { setSignup(null); return; }
    const unsub = onSnapshot(doc(db, 'signups', user.uid), (snap) => {
      setSignup(snap.exists() ? ({ id: snap.id, ...snap.data() } as SignupData) : null);
    }, () => setSignup(null));
    return () => unsub();
  }, [user?.uid]);

  const enterSupportMode = async (clinicId: string) => {
    if (!isPlatformAdmin || !user) return;
    try {
      const clinicSnap = await getDoc(doc(db, 'clinics', clinicId));
      if (clinicSnap.exists()) {
        const clinicData = { id: clinicSnap.id, ...clinicSnap.data() } as ClinicData;
        setSupportMode({ active: true, clinicId, clinicData });
        await PlatformAdminService.logAdminAction(
          user.uid,
          '[SUPER_ADMIN_SUPPORT_ACCESS] Entrou em modo suporte para depuração',
          clinicId,
          'clinic',
          { clinicName: clinicData.name }
        );
      }
    } catch (error) {
      console.error('[AuthContext] Error entering support mode:', error);
      throw error;
    }
  };

  const exitSupportMode = () => {
    if (user && supportMode.clinicId) {
      PlatformAdminService.logAdminAction(
        user.uid,
        'support_mode_exit',
        supportMode.clinicId,
        'clinic'
      );
    }
    setSupportMode({ active: false, clinicId: null, clinicData: null });
  };

  // Safety loading timeout - never get stuck for more than 8 seconds
  useEffect(() => {
    let timer: any;
    if (loading) {
      const start = Date.now();
      timer = setTimeout(() => {
        console.warn(`[ELIZA] Boot sequence took too long (>8s). Forcing loading to false.`);
        setLoading(false);
        setAuthError("Tempo de conexão excedido. Verifique sua rede.");
      }, 8000);
      
      const interval = setInterval(() => {
        setBootstrapTime(Math.floor((Date.now() - start) / 1000));
      }, 500); // More frequent update for diagnostics
      
      return () => {
        clearTimeout(timer);
        clearInterval(interval);
      };
    }
  }, [loading]);

  const isQuotaError = (error: any) => {
    if (!error) return false;
    const msg = error.message?.toLowerCase() || '';
    const code = error.code?.toLowerCase() || '';
    return msg.includes('quota') || 
           msg.includes('exceeded') || 
           code.includes('resource-exhausted') || 
           code.includes('quota');
  };

  const syncProfile = async (firebaseUser: User) => {
    const profilePath = `users/${firebaseUser.uid}`;
    const profileRef = doc(db, 'users', firebaseUser.uid);
    const emailLower = firebaseUser.email?.trim().toLowerCase() || "";
    
    console.log(`[ELIZA] Syncing profile for ${firebaseUser.email} (UID: ${firebaseUser.uid})...`);
    
    try {
      // 1. Check if the authenticated user is an education student
      console.log("[EDUCATION_STUDENT_PROFILE_LOOKUP_START] Probing education_students for student profile...");
      let studentDocObj: any = null;
      let studentRef: any = null;

      try {
        const studentQ = query(collectionGroup(db, 'education_students'), where('authUid', '==', firebaseUser.uid));
        const studentSnap = await getDocs(studentQ);
        if (!studentSnap.empty) {
          studentDocObj = studentSnap.docs[0].data();
          studentRef = studentSnap.docs[0].ref;
          console.log("[EDUCATION_STUDENT_PROFILE_FOUND] Found student profile by authUid in education_students.");
        }
      } catch (e: any) {
        console.warn("Failed lookup in education_students by authUid:", e.message || e);
      }

      if (!studentDocObj && emailLower) {
        try {
          const studentQEmail = query(collectionGroup(db, 'education_students'), where('emailLowercase', '==', emailLower));
          const studentSnapEmail = await getDocs(studentQEmail);
          if (!studentSnapEmail.empty) {
            studentDocObj = studentSnapEmail.docs[0].data();
            studentRef = studentSnapEmail.docs[0].ref;
            console.log("[EDUCATION_STUDENT_PROFILE_FOUND] Found student profile by emailLowercase in education_students.");
          }
        } catch (e: any) {
          console.warn("Failed lookup in education_students by emailLowercase:", e.message || e);
        }
      }

      // 2. Auto-relink & fail-safe clinicId resolution for the student doc,
      // if one was found — done unconditionally here (before we know whether
      // this uid is ALSO staff) because relinking the academic doc's own
      // authUid/id is a data-integrity fix orthogonal to which role wins the
      // profile below.
      let resolvedStudentClinicId: string | null = null;
      if (studentDocObj && studentRef) {
        const currentUid = firebaseUser.uid;
        resolvedStudentClinicId = studentDocObj.clinicId || studentRef.parent?.parent?.id || null;

        // Fail-safe: no hardcoded fallback clinic. A student whose doc doesn't
        // resolve to a real clinic path must never be silently associated
        // with a real production clinic — that was the previous behavior
        // (see CEREBRO: "Fallback hardcoded de clinicId em login de aluno").
        if (!resolvedStudentClinicId) {
          console.error("[EDUCATION_ACCESS_DENIED] Student doc missing resolvable clinicId — refusing to guess.", { uid: firebaseUser.uid, studentRefPath: studentRef?.path });
          await signOut(auth);
          throw new Error("Aluno encontrado, mas sem clínica vinculada corretamente. Contate a secretaria da clínica.");
        }

        // Auto-relink student record in education_students if ID or authUid doesn't match current UID
        if (studentDocObj.id !== currentUid || studentDocObj.authUid !== currentUid) {
          console.log(`[EDUCATION_STUDENT_AUTHUID_SAVED] Mismatched UIDs detected: ${studentDocObj.id} vs ${currentUid}. Relinking automatically...`);
          try {
            const cleanStudentData = removeUndefinedFields({
              ...studentDocObj,
              id: currentUid,
              authUid: currentUid,
              emailLowercase: emailLower,
              updatedAt: serverTimestamp()
            });

            const newStudentRef = doc(db, studentRef.parent.path, currentUid);
            await setDoc(newStudentRef, cleanStudentData, { merge: true });

            if (studentRef.id !== currentUid) {
              await deleteDoc(studentRef);
            }

            studentRef = newStudentRef;
            studentDocObj = cleanStudentData;
            console.log(`[EDUCATION_STUDENT_AUTHUID_SAVED] Student successfully relinked across database to UID: ${currentUid}`);
          } catch (migrateErr) {
            console.error("Failed to auto-migrate student link:", migrateErr);
          }
        }
      }

      // 3. Resolve clinical/operational membership — ALWAYS runs, regardless
      // of whether an education_students doc was also found. This is the fix
      // for the mutually-exclusive resolution bug: previously this lookup
      // only ran when NO student doc existed, so a uid with both an active
      // members doc AND an active education_students doc (dual role: Clinic
      // staff + Academy student, see CEREBRO decision) was always resolved
      // as student-only, silently losing operational access.
      console.log("[ELIZA] Scanning for clinical memberships (independently of education_students lookup)...");
      const activeMembership = await findActiveMembership(firebaseUser.uid);
      const foundClinicId = activeMembership?.clinicId ?? null;
      const foundRole = activeMembership?.role ?? null;
      const isStaffMember = !!activeMembership;
      if (isStaffMember) {
        console.log(`[ELIZA] Found clinical membership in clinic ${foundClinicId}`);
      }

      // 4. Case B — student ONLY (no active staff membership): exact
      // pre-existing student-only behavior, unchanged.
      if (studentDocObj && studentRef && !isStaffMember) {
        const currentUid = firebaseUser.uid;
        const studentBaseline = {
          uid: currentUid,
          email: firebaseUser.email || '',
          emailLowercase: emailLower,
          displayName: studentDocObj.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Aluno',
          name: studentDocObj.name || firebaseUser.displayName || 'Aluno',
          role: "student",
          userType: "education_student",
          clinicId: resolvedStudentClinicId,
          defaultClinicId: resolvedStudentClinicId,
          courseId: studentDocObj.courseId || null,
          classId: studentDocObj.classId || null,
          educationStudentId: studentDocObj.id || studentDocObj.authUid || currentUid,
          status: "active",
          // Propagated so ElizaNextLayout can gate the student portal behind
          // a mandatory change-password screen — this field was being written
          // at student creation (inviteService.ts) but never read anywhere,
          // so a temporary password never actually had to be changed.
          mustChangePassword: studentDocObj.mustChangePassword === true,
          createdAt: studentDocObj.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        console.log("[EDUCATION_USER_PROFILE_CREATE_START] Upserting user record into users/ collection...");
        try {
          const cleanedPayload = removeUndefinedFields(studentBaseline);
          await setDoc(profileRef, cleanedPayload, { merge: true });
          console.log("[EDUCATION_USER_PROFILE_CREATED] Successfully registered student under users/");
          console.log("[EDUCATION_ACCESS_GRANTED] Access granted to the Education workspace.");
          setProfile(cleanedPayload);
          return cleanedPayload;
        } catch (profileErr: any) {
          console.error("[EDUCATION_USER_PROFILE_CREATE_ERROR] Failed to save/align student users/ profile:", profileErr.message || profileErr);
          return null;
        }
      }

      // 5. Case A (staff only) and Case C (staff + student, dual role) both
      // fall through here. The academic side is layered ADDITIVELY on top of
      // the normal staff profile resolution below — role/clinicId/defaultClinicId
      // always come from the staff membership (foundRole/foundClinicId), never
      // overwritten by the academic doc. This guarantees adding or removing an
      // education_students link can never change operational permissions.
      // Deliberately NOT included: studentDocObj.mustChangePassword. That
      // field exists to force a change on a temporary password issued when a
      // BRAND NEW student account is created — a dual-role person already
      // has a working, self-chosen staff password, so an academic temp-
      // password flag (however it got set) must never gate their login. Since
      // `role` above always resolves to the staff role for case C, the
      // top-level `isStudentRole && mustChangePassword` gate in
      // ElizaNextLayout.tsx can never fire for a dual-role profile by
      // construction — no separate check needed here.
      const academicPatch: { hasEducationAccess: boolean; educationStudentId: string | null; educationCourseId: string | null; educationClassId: string | null } | null =
        (studentDocObj && studentRef && isStaffMember)
          ? {
              hasEducationAccess: true,
              educationStudentId: studentDocObj.id || studentDocObj.authUid || firebaseUser.uid,
              educationCourseId: studentDocObj.courseId || null,
              educationClassId: studentDocObj.classId || null,
            }
          : null;

      if (!studentDocObj) {
        console.log("[EDUCATION_STUDENT_PROFILE_MISSING] User not registered in education_students.");
      }

      // Verify if they have an existing users profile already
      let existingProfileData: any = null;
      try {
        const snap = await getDocFromServer(profileRef);
        if (snap.exists()) {
          existingProfileData = snap.data();
        }
      } catch (err: any) {
        console.warn("Failed to check existing profile:", err.message || err);
      }

      // If no clinical membership is found and they are not a platform admin,
      // only block access when they were previously a student whose
      // education_students record has since gone missing/orphaned — a
      // genuinely new user (no prior profile, not a student) must fall
      // through to the baseline-profile branch below so Cadastro→Checkout
      // and first-time Google sign-up both work.
      const isPlatformUser = firebaseUser.uid === 'PnEUUeLkWIVyIdIbcynwqBa6Wv72';
      const superAdminEmails = ['janioteixeiracd@gmail.com', 'juninhoteixeiraofc@gmail.com'];
      const isSuperAdmin = isPlatformUser ||
                           superAdminEmails.includes(emailLower) ||
                           existingProfileData?.platformRole === 'super_admin' ||
                           existingProfileData?.isPlatformAdmin === true;

      const isEduStudent = (existingProfileData?.role === 'aluno' || existingProfileData?.role === 'student' || existingProfileData?.userType === 'education_student');

      if (!foundClinicId && !isSuperAdmin && isEduStudent) {
        if (existingProfileData?.defaultClinicId !== 'onboarding') {
          console.error("[EDUCATION_ACCESS_DENIED] Authentication was successful but student profile is offline in database.");
          throw new Error("Login realizado, mas seu cadastro de aluno não foi localizado. Fale com a instituição.");
        }
      }

      // Save/align clinical profile
      if (existingProfileData) {
        let needsUpdate = false;
        const updatePayload: any = {};
        
        if (!existingProfileData.name && firebaseUser.displayName) {
          updatePayload.name = firebaseUser.displayName;
          needsUpdate = true;
        }

        if (superAdminEmails.includes(emailLower)) {
          if (existingProfileData.platformRole !== 'super_admin') {
            updatePayload.platformRole = 'super_admin';
            needsUpdate = true;
          }
          if (existingProfileData.isPlatformAdmin !== true) {
            updatePayload.isPlatformAdmin = true;
            needsUpdate = true;
          }
        }

        // Operational identity always wins when an active membership exists —
        // self-heals a profile that a previous version of this function may
        // have overwritten with the academic role (the exact bug this
        // checkpoint fixes), and is a no-op for every profile that was
        // already correct (foundRole/foundClinicId already match).
        if (isStaffMember) {
          if (existingProfileData.role !== foundRole) {
            updatePayload.role = foundRole;
            needsUpdate = true;
          }
          if (existingProfileData.clinicId !== foundClinicId) {
            updatePayload.clinicId = foundClinicId;
            needsUpdate = true;
          }
          if (existingProfileData.defaultClinicId !== foundClinicId) {
            updatePayload.defaultClinicId = foundClinicId;
            needsUpdate = true;
          }
          if (existingProfileData.userType === 'education_student') {
            updatePayload.userType = null;
            needsUpdate = true;
          }
        }

        // Academic access layered additively — granting/revoking it never
        // touches role/clinicId above.
        if (academicPatch) {
          for (const [key, value] of Object.entries(academicPatch)) {
            if (existingProfileData[key] !== value) {
              updatePayload[key] = value;
              needsUpdate = true;
            }
          }
        } else if (isStaffMember && existingProfileData.hasEducationAccess === true) {
          // Academic link was removed/deactivated since the last sync — clear
          // the stale flag so the Academy nav entry disappears. Operational
          // membership above is untouched either way.
          updatePayload.hasEducationAccess = false;
          updatePayload.educationStudentId = null;
          updatePayload.educationCourseId = null;
          updatePayload.educationClassId = null;
          needsUpdate = true;
        }

        if (needsUpdate) {
          updatePayload.updatedAt = serverTimestamp();
          await updateDoc(profileRef, removeUndefinedFields(updatePayload));
          existingProfileData = { ...existingProfileData, ...updatePayload };
        }

        setProfile(existingProfileData);
        return existingProfileData;
      } else {
        const baseline: UserProfile = {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuário',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL || '',
          defaultClinicId: foundClinicId || undefined,
          role: foundRole || undefined,
          platformRole: superAdminEmails.includes(emailLower) ? 'super_admin' : undefined,
          isPlatformAdmin: superAdminEmails.includes(emailLower) ? true : undefined,
          ...(academicPatch || {}),
          createdAt: serverTimestamp() as any,
          updatedAt: serverTimestamp() as any
        };
        const cleanedBaseline = removeUndefinedFields(baseline);
        await setDoc(profileRef, cleanedBaseline);
        setProfile(cleanedBaseline);
        return cleanedBaseline;
      }
    } catch (err: any) {
      console.error(`[ELIZA] Profile Sync FAILED for users/${firebaseUser.uid}:`, err.message);
      // Propagate error for UI feedback during login
      throw err;
    }
  };

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeClinic: (() => void) | null = null;

    // Surfaces errors from the signInWithRedirect fallback in loginWithGoogle
    // (e.g. account-exists-with-different-credential). On success this
    // resolves to the same user onAuthStateChanged below already picks up —
    // this call exists only for the error path, not to drive sign-in itself.
    getRedirectResult(auth).catch((error: any) => {
      console.error("[ELIZA] Google Redirect Login Error:", error.message);
      setAuthError(error.message);
    });

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log(`[ELIZA] Auth state changed: ${firebaseUser ? 'LOGGED_IN (' + firebaseUser.email + ')' : 'LOGGED_OUT'}`);
      
      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setClinic(null);
        setIsPlatformAdmin(false);
        setPlatformRole(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setLoading(true);
      setAuthError(null);
      
      try {
        // Step 1: Sync User Profile
        const currentProfile = await syncProfile(firebaseUser);
        
        // Step 2: Handle Admin Scopes
        let isAdmin = false;
        let pRole = null;
        
        const superAdminEmails = ['janioteixeiracd@gmail.com', 'juninhoteixeiraofc@gmail.com'];
        const userEmailLower = firebaseUser.email?.trim().toLowerCase() || "";
        
        if (
          currentProfile?.platformRole === 'super_admin' ||
          currentProfile?.isPlatformAdmin === true ||
          superAdminEmails.includes(userEmailLower)
        ) {
          isAdmin = true;
          pRole = currentProfile?.platformRole || 'super_admin';

          // Self-healing bootstrap: isPlatformAdmin/platformRole above only
          // gate the CLIENT-side UI. firestore.rules' isPlatformAdmin()
          // checks a real platform_admins/{uid} doc (or one hardcoded prod
          // UID) — without this, a hardcoded-email account would see the
          // admin shell but every Firestore read inside it would be denied.
          if (superAdminEmails.includes(userEmailLower)) {
            setDoc(doc(db, 'platform_admins', firebaseUser.uid), {
              email: userEmailLower,
              name: firebaseUser.displayName || userEmailLower,
              role: pRole,
              active: true,
              grantedBy: 'system-bootstrap',
              updatedAt: serverTimestamp(),
            }, { merge: true }).catch((e) => console.warn('[ELIZA] Failed to self-heal platform_admins doc:', e));
          }
        } else if (ENABLE_PLATFORM_ADMIN) {
          try {
            const adminSnap = await getDoc(doc(db, 'platform_admins', firebaseUser.uid));
            if (adminSnap.exists()) {
              const adminData = adminSnap.data();
              if (adminData.active) {
                isAdmin = true;
                pRole = adminData.role || 'super_admin';
              }
            }
          } catch (e) {
            // Ignore admin check errors for normal users
          }
        }
        setIsPlatformAdmin(isAdmin);
        setPlatformRole(pRole);

        // Step 3: Identify Clinic
        if (currentProfile?.defaultClinicId) {
          const cid = currentProfile.defaultClinicId;
          
          if (cid === 'onboarding') {
            setClinic(null);
          } else {
             const isStudent = currentProfile?.role === 'aluno' || currentProfile?.role === 'student' || currentProfile?.userType === 'education_student';
             
             if (isStudent) {
                console.log(`[ELIZA] Student clinic identified directly: ${cid}`);
                try {
                  const cSnap = await getDoc(doc(db, 'clinics', cid));
                  if (cSnap.exists()) {
                     console.log(`[ELIZA] Clinic verified and loaded for student: ${cSnap.data().name}`);
                     setClinic({ id: cSnap.id, ...cSnap.data() } as ClinicData);
                  } else {
                     console.warn("[ELIZA] Student clinic document missing");
                     setClinic(null);
                  }
                } catch (e: any) {
                  console.error("[ELIZA] Failed to load clinic for student:", e.message || e);
                  setClinic(null);
                }
             } else {
                console.log(`[ELIZA] Probing clinic association: clinics/${cid}`);
                const memberRef = doc(db, 'clinics', cid, 'members', firebaseUser.uid);
                
                try {
                  const mSnap = await getDoc(memberRef);
                  if (mSnap.exists() && (mSnap.data().status === 'active' || mSnap.data().active === true || mSnap.data().status === 'ativo')) {
                    const cSnap = await getDoc(doc(db, 'clinics', cid));
                    if (cSnap.exists()) {
                       console.log(`[ELIZA] Clinic verified and loaded: ${cSnap.data().name}`);
                       setClinic({ id: cSnap.id, ...cSnap.data() } as ClinicData);
                    } else {
                       console.warn("[ELIZA] Clinic document missing but member exists");
                       setClinic(null);
                    }
                  } else {
                    console.warn(`[ELIZA] No active membership found for users/${firebaseUser.uid} in clinics/${cid}`);
                    setClinic(null);
                  }
                } catch (e) {
                  console.error("[ELIZA] Failed to verify membership:", e);
                  setClinic(null);
                }
             }
          }
        } else {
          setClinic(null);
        }

      } catch (err: any) {
        console.error("[ELIZA] Auth bootstrap failure:", err.message);
        setAuthError(err.message);
      } finally {
        setLoading(false);
        console.log("[ELIZA] Auth initialization finalized.");
      }

      // Live Listeners
      if (unsubscribeProfile) unsubscribeProfile();
      unsubscribeProfile = onSnapshot(doc(db, 'users', firebaseUser.uid), (snap) => {
        if (snap.exists()) setProfile(snap.data() as UserProfile);
      });
    }, (error) => {
      console.error("[ELIZA] Authentication stream error:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeClinic) unsubscribeClinic();
    };
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (popupErr: any) {
        // Popups are unreliable in the wild — in-app browsers (WhatsApp,
        // Instagram), Safari's stricter defaults, and some corporate/privacy
        // extensions block them outright with no way for the user to allow
        // it retroactively. A full-page redirect has no such restriction;
        // onAuthStateChanged below picks up the result automatically once
        // Firebase navigates back. Only auth/popup-blocked falls back here —
        // auth/popup-closed-by-user means the person deliberately canceled,
        // and forcing a redirect in that case would be surprising, not helpful.
        if (popupErr.code === 'auth/popup-blocked') {
          console.warn('[ELIZA] Google popup blocked — falling back to redirect.');
          await signInWithRedirect(auth, googleProvider);
          return;
        }
        throw popupErr;
      }
    } catch (error: any) {
      console.error("[ELIZA] Google Login Error:", error.message);
      setAuthError(error.message);
      if (isQuotaError(error)) setIsQuotaExceeded(true);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const loginWithEmail = async (emailRaw: string, pass: string) => {
    setLoading(true);
    setAuthError(null);
    
    const email = emailRaw.trim().toLowerCase();
    console.log(`[EDUCATION_LOGIN_ATTEMPT] Attempting email login for: ${emailRaw}`);
    console.log(`[EDUCATION_LOGIN_EMAIL_NORMALIZED] Normalized email to: ${email}`);

    try {
      // 1. Perform Firebase Auth login first. The education-student lookup
      // below requires isSignedIn() per firestore.rules, so it cannot run
      // (and must not be attempted) before authentication succeeds.
      let authUser: User;
      try {
        let result;
        try {
          result = await signInWithEmailAndPassword(auth, email, pass);
        } catch (firstErr: any) {
          // A transient auth/network-request-failed can surface even when the
          // request actually reached the emulator (observed against the local
          // emulator under load). One immediate retry clears it without
          // masking a genuine credentials failure, which won't change on retry.
          if (firstErr.code === 'auth/network-request-failed') {
            console.warn('[ELIZA] Sign-in hit auth/network-request-failed, retrying once...');
            result = await signInWithEmailAndPassword(auth, email, pass);
          } else {
            throw firstErr;
          }
        }
        authUser = result.user;
        console.log(`[EDUCATION_LOGIN_AUTH_SUCCESS] Firebase Auth login succeed for: ${authUser.email}`);
      } catch (authErr: any) {
        console.error(`[EDUCATION_LOGIN_AUTH_FAILED] Firebase Auth login failed:`, authErr.message);

        let friendlyMsg = "Falha no login. Verifique seu e-mail e senha.";
        if (authErr.code === 'auth/user-not-found') {
          friendlyMsg = "Este e-mail não está vinculado a nenhum aluno ativo.";
        } else if (authErr.code === 'auth/wrong-password' || authErr.code === 'auth/invalid-credential' || authErr.code === 'auth/invalid-password') {
          friendlyMsg = "Senha incorreta.";
        } else if (authErr.code === 'auth/invalid-email') {
          friendlyMsg = "E-mail inválido.";
        }
        throw new Error(friendlyMsg);
      }

      // 2. Post-auth check for education-student structure (blocked/expired status).
      console.log(`[ELIZA] Checking if email belongs to an education student...`);
      let studentDoc: any = null;
      let studentRef: any = null;
      // Dual role (Clinic + Academy): populated below if an active clinic
      // membership exists for this uid, independently of the education
      // student doc. Scoped here (not inside the try block) so both the
      // blocked/expired gate above AND the profile-write guard further down
      // can read the same result instead of querying twice or drifting.
      let dualRoleMembership: { clinicId: string; role: string } | null = null;

      try {
        const studentQ = query(collectionGroup(db, 'education_students'), where('emailLowercase', '==', email));
        const studentSnap = await getDocs(studentQ);
        if (!studentSnap.empty) {
          studentDoc = studentSnap.docs[0].data();
          studentRef = studentSnap.docs[0].ref;
          console.log(`[EDUCATION_STUDENT_PROFILE_FOUND] Found education student profile for: ${email}`);

          // Dual role (Clinic + Academy): a blocked/expired ACADEMIC status
          // must never lock a person out of the app entirely if they also
          // hold an active clinic membership — that membership is a fully
          // independent identity. Only gate login on the academic-only path.
          dualRoleMembership = await findActiveMembership(authUser.uid);
          if (!dualRoleMembership) {
            // Check if blocked
            if (studentDoc.status === 'bloqueado' || studentDoc.status === 'inativo') {
              console.warn(`[EDUCATION_ACCESS_BLOCKED] Access blocked for student: ${email}`);
              await signOut(auth);
              throw new Error("Seu acesso está bloqueado. Fale com a instituição.");
            }

            // Check if expired
            const todayStr = new Date().toISOString().slice(0, 10);
            const isExpired = studentDoc.accessExpirationDate && (todayStr > studentDoc.accessExpirationDate) && !studentDoc.permAccessAfterEnd;
            if (isExpired) {
              console.warn(`[EDUCATION_ACCESS_EXPIRED] Access expired for student: ${email}`);
              await signOut(auth);
              throw new Error("Seu acesso ao curso expirou.");
            }
          } else if (studentDoc.status === 'bloqueado' || studentDoc.status === 'inativo') {
            console.warn(`[EDUCATION_ACCESS_BLOCKED] Academic access blocked for ${email}, but an active clinic membership exists — allowing login as staff.`);
          }
        } else {
          console.log(`[EDUCATION_STUDENT_PROFILE_MISSING] No student profile matching emailLowercase: ${email}`);
        }
      } catch (checkErr: any) {
        if (checkErr.message === "Seu acesso está bloqueado. Fale com a instituição." ||
            checkErr.message === "Seu acesso ao curso expirou.") {
          throw checkErr;
        }
        console.warn("[ELIZA] Error checking education student profile:", checkErr);
      }

      // 3. Post-login auto-linking & synchronization
      if (studentDoc && studentRef) {
        const currentUid = authUser.uid;
        
        // Confirm if the student document is correctly key-indexed by the user's correct Auth UID
        if (studentDoc.id !== currentUid || studentDoc.authUid !== currentUid) {
          console.log(`[EDUCATION_STUDENT_AUTHUID_SAVED] Student is not linked properly. Mismatched UID: ${studentDoc.id} vs actual auth UID ${currentUid}. Linking automatically.`);
          
          try {
            // Write student to the correct path
            const newRef = doc(db, studentRef.parent.path, currentUid);
            const studentPayload = {
              ...studentDoc,
              id: currentUid,
              authUid: currentUid,
              emailLowercase: email,
              updatedAt: serverTimestamp()
            };
            await setDoc(newRef, removeUndefinedFields(studentPayload), { merge: true });

            // Only delete the old record if it actually lives at a different path.
            // studentDoc.id is a data field that may simply be absent (e.g. students
            // created without it) — that alone doesn't mean the doc is misplaced.
            // Comparing studentDoc.id here would delete the record we just wrote,
            // since newRef and studentRef point at the same document.
            if (studentRef.id !== currentUid) {
              await deleteDoc(studentRef);
            }
            console.log(`[EDUCATION_STUDENT_AUTHUID_SAVED] Successfully migrated and linked student ${email} to correct Auth UID: ${currentUid}`);
          } catch (migrateErr) {
            console.error("Failed to auto-migrate student link:", migrateErr);
          }
        }
        
        // Fail-safe: no hardcoded fallback clinic. Resolved and checked
        // BEFORE the try/catch below — that catch only swallows benign,
        // transient Firestore errors, and must never also swallow this
        // (see syncProfile() above for the same fix and rationale).
        const clinicId = studentRef.parent.parent?.id || studentDoc.clinicId;
        if (!clinicId) {
          console.error("[EDUCATION_ACCESS_DENIED] Student doc missing resolvable clinicId — refusing to guess.", { uid: currentUid, studentRefPath: studentRef?.path });
          await signOut(auth);
          throw new Error("Aluno encontrado, mas sem clínica vinculada corretamente. Contate a secretaria da clínica.");
        }

        // Ensure they also have high-level users profile with Aluno role.
        // Skipped entirely when an active clinic membership also exists for
        // this uid (dual role) — writing role:'student' here would clobber
        // the staff identity. syncProfile() (run right after, via
        // onAuthStateChanged) is the single place that resolves the dual-role
        // profile correctly, additively, without this shortcut.
        try {
          const profileRef = doc(db, 'users', currentUid);
          const pSnap = await getDoc(profileRef);

          if (!dualRoleMembership && (!pSnap.exists() || (pSnap.data()?.role !== 'aluno' && pSnap.data()?.role !== 'student'))) {
            const baselineProfile = {
              uid: currentUid,
              name: studentDoc.name || authUser.displayName || email.split('@')[0],
              email: email,
              emailLowercase: email,
              phone: studentDoc.phone || '',
              role: 'student',
              userType: 'education_student',
              defaultClinicId: clinicId,
              clinicId: clinicId,
              tempPassword: studentDoc.tempPassword || null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            await setDoc(profileRef, removeUndefinedFields(baselineProfile), { merge: true });
            console.log(`[EDUCATION_STUDENT_AUTHUID_SAVED] User profile successfully created/aligned inside users/ collection.`);
          }
        } catch (profileErr) {
          console.error("Failed to align users/ profile:", profileErr);
        }
      }
      
    } catch (error: any) {
      setAuthError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Cadastro → Checkout: the actual account-creation half of `registerWithEmail`
  // + `createUserWithEmailAndPassword` was imported but never called anywhere
  // in this file before — this is that gap being filled. Doesn't write
  // `signups/{uid}` itself (that's server.ts-only, see firestore.rules) —
  // CheckoutView creates it lazily on mount via a server endpoint.
  const registerWithEmail = async (name: string, emailRaw: string, pass: string) => {
    setLoading(true);
    setAuthError(null);
    const email = emailRaw.trim().toLowerCase();
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name.trim() });
      // Explicit write instead of relying on syncProfile's onAuthStateChanged
      // race to pick up the right displayName — timing between updateProfile
      // and the listener firing isn't guaranteed.
      await setDoc(doc(db, 'users', cred.user.uid), removeUndefinedFields({
        uid: cred.user.uid, name: name.trim(), email, updatedAt: serverTimestamp(),
      }), { merge: true });
    } catch (error: any) {
      console.error('[ELIZA] Email registration error:', error.message);
      let friendlyMsg = error.message;
      if (error.code === 'auth/email-already-in-use') friendlyMsg = 'Este e-mail já tem uma conta — tente entrar em vez de cadastrar.';
      else if (error.code === 'auth/weak-password') friendlyMsg = 'Senha muito fraca — use pelo menos 6 caracteres.';
      else if (error.code === 'auth/invalid-email') friendlyMsg = 'E-mail inválido.';
      setAuthError(friendlyMsg);
      throw new Error(friendlyMsg);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      setSupportMode({ active: false, clinicId: null, clinicData: null });
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) await syncProfile(user);
  };

  // Mandatory first-login password change for students created with a
  // temporary password (inviteService.ts's createEducationStudent). Clears
  // mustChangePassword on both the education_students doc (source of truth,
  // re-read on every profile sync above) and the mirrored users/ profile, so
  // a stale cached profile can't leave the gate open.
  const changeStudentPassword = async (newPassword: string) => {
    if (!user) throw new Error('Sessão não carregada.');
    if (!newPassword || newPassword.length < 6) throw new Error('A nova senha precisa ter pelo menos 6 caracteres.');
    await updatePassword(user, newPassword);
    const clinicId = profile?.clinicId || profile?.defaultClinicId;
    const studentId = (profile as any)?.educationStudentId || user.uid;
    if (clinicId) {
      await updateDoc(doc(db, 'clinics', clinicId, 'education_students', studentId), {
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      }).catch((err) => console.warn('[AuthContext] Failed to clear mustChangePassword on education_students:', err));
    }
    await updateDoc(doc(db, 'users', user.uid), {
      mustChangePassword: false,
      updatedAt: serverTimestamp(),
    }).catch((err) => console.warn('[AuthContext] Failed to clear mustChangePassword on users profile:', err));
    await refreshProfile();
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      clinic: effectiveClinic,
      signup,
      isPlatformAdmin,
      platformRole,
      loading,
      isQuotaExceeded,
      authError,
      bootstrapTime,
      supportMode,
      enterSupportMode,
      exitSupportMode,
      loginWithGoogle,
      loginWithEmail,
      registerWithEmail,
      logout,
      refreshProfile,
      changeStudentPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
