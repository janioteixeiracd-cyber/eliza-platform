import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  signOut, 
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, query, collection, where, getDocs, limit, getDocFromServer, collectionGroup, deleteDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType, FIRESTORE_DATABASE_ID } from '../lib/firebase';
import { ENABLE_PLATFORM_ADMIN } from '../config';

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

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  clinic: ClinicData | null;
  isPlatformAdmin: boolean;
  platformRole: string | null;
  loading: boolean;
  isQuotaExceeded: boolean;
  authError: string | null;
  bootstrapTime: number;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [clinic, setClinic] = useState<ClinicData | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [platformRole, setPlatformRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapTime, setBootstrapTime] = useState(0);

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

      // 2. Handle Student Alignment & Profile Creation
      if (studentDocObj && studentRef) {
        const currentUid = firebaseUser.uid;
        let resolvedClinicId = studentDocObj.clinicId || studentRef.parent?.parent?.id;
        
        // Contextual clinic assignment fallback (Harmo Orofacial clinicId in active context)
        if (!resolvedClinicId) {
          resolvedClinicId = "l9GzEcXT7uhcYHgRVVhe";
        }

        if (!resolvedClinicId) {
          console.warn("[EDUCATION_ACCESS_DENIED] Student missing clinicId link.");
          throw new Error("Aluno encontrado, mas sem clínica vinculada. Revise o cadastro.");
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

        // Build and save the users/{uid} document with precise fields
        const studentBaseline = {
          uid: currentUid,
          email: firebaseUser.email || '',
          emailLowercase: emailLower,
          displayName: studentDocObj.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Aluno',
          name: studentDocObj.name || firebaseUser.displayName || 'Aluno',
          role: "student",
          userType: "education_student",
          clinicId: resolvedClinicId,
          defaultClinicId: resolvedClinicId,
          courseId: studentDocObj.courseId || null,
          classId: studentDocObj.classId || null,
          educationStudentId: studentDocObj.id || studentDocObj.authUid || currentUid,
          status: "active",
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

      // If we got here, they are NOT an education student. Search clinical memberships.
      console.log("[EDUCATION_STUDENT_PROFILE_MISSING] User not registered in education_students. Scanning for company memberships...");
      let foundClinicId = null;
      let foundRole = null;

      try {
        const q = query(collectionGroup(db, 'members'), where('uid', '==', firebaseUser.uid));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const mDoc = querySnapshot.docs[0];
          const mData = mDoc.data();
          if (mData.status === 'active' || mData.active === true || mData.status === 'ativo') {
            foundClinicId = mData.clinicId || mDoc.ref.parent.parent?.id;
            foundRole = mData.role;
            console.log(`[ELIZA] Found clinical membership in clinic ${foundClinicId}`);
          }
        }
      } catch (e: any) {
        console.warn("[ELIZA] Error checking clinical memberships:", e.message || e);
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

      // If no clinical membership is found, and they are not predefined platform admin
      // and they have an orphan student role or simply are trying to connect, throw friendly block
      const isPlatformUser = firebaseUser.uid === 'PnEUUeLkWIVyIdIbcynwqBa6Wv72';
      const superAdminEmails = ['janioteixeiracd@gmail.com', 'juninhoteixeiraofc@gmail.com'];
      const isSuperAdmin = isPlatformUser || 
                           superAdminEmails.includes(emailLower) || 
                           existingProfileData?.platformRole === 'super_admin' || 
                           existingProfileData?.isPlatformAdmin === true;

      const isEduStudent = (existingProfileData?.role === 'aluno' || existingProfileData?.role === 'student' || existingProfileData?.userType === 'education_student');

      if (!foundClinicId && !isSuperAdmin && (isEduStudent || (firebaseUser.email && !foundClinicId))) {
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
      await signInWithPopup(auth, googleProvider);
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

      try {
        const studentQ = query(collectionGroup(db, 'education_students'), where('emailLowercase', '==', email));
        const studentSnap = await getDocs(studentQ);
        if (!studentSnap.empty) {
          studentDoc = studentSnap.docs[0].data();
          studentRef = studentSnap.docs[0].ref;
          console.log(`[EDUCATION_STUDENT_PROFILE_FOUND] Found education student profile for: ${email}`);

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
        
        // Ensure they also have high-level users profile with Aluno role
        try {
          const profileRef = doc(db, 'users', currentUid);
          const pSnap = await getDoc(profileRef);
          
          const clinicId = studentRef.parent.parent?.id || studentDoc.clinicId || "l9GzEcXT7uhcYHgRVVhe";
          
          if (!pSnap.exists() || (pSnap.data()?.role !== 'aluno' && pSnap.data()?.role !== 'student')) {
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

  const logout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) await syncProfile(user);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      clinic, 
      isPlatformAdmin,
      platformRole,
      loading, 
      isQuotaExceeded,
      authError,
      bootstrapTime,
      loginWithGoogle,
      loginWithEmail,
      logout,
      refreshProfile 
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
