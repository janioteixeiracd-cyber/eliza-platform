import {
  collection,
  collectionGroup,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp,
  orderBy,
  limit,
  addDoc
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';

export interface PlatformMetric {
  id?: string;
  activeClinics: number;
  activeUsers: number;
  mrr: number;
  aiUsageCount: number;
  date: any;
}

export const PlatformAdminService = {
  /**
   * Listen to global platform metrics
   */
  subscribeToMetrics: (onData: (metrics: PlatformMetric[]) => void) => {
    const q = query(collection(db, 'platform_metrics'), orderBy('date', 'desc'), limit(30));
    return onSnapshot(q, (snap) => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlatformMetric)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'platform_metrics'));
  },

  /**
   * Listen to all clinics (real-time from 'clinics' collection)
   */
  subscribeToClinics: (onData: (clinics: any[]) => void) => {
    const q = query(collection(db, 'clinics'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.warn("[PlatformAdminService] Failed to listen to 'clinics' collection directly, trying 'platform_clinics' fallback:", err);
      const fallbackQ = query(collection(db, 'platform_clinics'), orderBy('createdAt', 'desc'));
      return onSnapshot(fallbackQ, (fallbackSnap) => {
        onData(fallbackSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    });
  },

  /**
   * Listen to all users (real-time from 'users' collection)
   */
  subscribeToUsers: (onData: (users: any[]) => void) => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.warn("[PlatformAdminService] Failed to listen to 'users' collection directly, trying 'platform_users' fallback:", err);
      const fallbackQ = query(collection(db, 'platform_users'), orderBy('createdAt', 'desc'));
      return onSnapshot(fallbackQ, (fallbackSnap) => {
        onData(fallbackSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    });
  },

  /**
   * Listen to global platform audit logs
   */
  subscribeToAuditLogs: (onData: (logs: any[]) => void) => {
    const q = query(collection(db, 'platform_audit_logs'), orderBy('createdAt', 'desc'), limit(150));
    return onSnapshot(q, (snap) => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'platform_audit_logs'));
  },

  /**
   * Sync a clinic's metadata to the platform summary
   */
  syncClinicMetadata: async (clinicId: string, data: any) => {
     const ref = doc(db, 'platform_clinics', clinicId);
     await setDoc(ref, {
       ...data,
       updatedAt: serverTimestamp()
     }, { merge: true });
  },

  /**
   * Global User Index Update
   */
  syncUserMetadata: async (userId: string, data: any) => {
    const ref = doc(db, 'platform_users', userId);
    await setDoc(ref, {
       ...data,
       updatedAt: serverTimestamp()
    }, { merge: true });
  },

  /**
   * Record an audit log for admin actions
   */
  logAdminAction: async (adminId: string, action: string, targetId: string, targetType: string, details: any = {}) => {
    try {
      await addDoc(collection(db, 'platform_audit_logs'), {
        adminId,
        action,
        targetId,
        targetType,
        details,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error("[PlatformAdminService] Failed to write audit log:", e);
    }
  },

  /**
   * Update Clinic Status
   */
  updateClinicStatus: async (clinicId: string, status: string, adminId: string) => {
    const ref = doc(db, 'clinics', clinicId);
    await updateDoc(ref, { status, updatedAt: serverTimestamp() });
    
    // Also update backup index
    try {
      await updateDoc(doc(db, 'platform_clinics', clinicId), { status, updatedAt: serverTimestamp() });
    } catch (e) {}

    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_CLINIC_STATUS_UPDATED] Status alterado para: ${status}`,
      clinicId,
      'clinic',
      { status }
    );
  },

  /**
   * Update Clinic Plan
   */
  updateClinicPlan: async (clinicId: string, planId: string, adminId: string) => {
    const ref = doc(db, 'clinics', clinicId);
    await updateDoc(ref, { planId, updatedAt: serverTimestamp() });
    
    // Also update backup index
    try {
      await updateDoc(doc(db, 'platform_clinics', clinicId), { planId, updatedAt: serverTimestamp() });
    } catch (e) {}

    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_PLAN_UPDATED] Plano alterado para: ${planId}`,
      clinicId,
      'clinic',
      { planId }
    );
  },

  /**
   * Add Support Note to a clinic
   */
  addClinicSupportNote: async (clinicId: string, noteText: string, adminId: string, adminEmail: string) => {
    const notesRef = collection(db, 'clinics', clinicId, 'support_notes');
    await addDoc(notesRef, {
      text: noteText,
      createdAt: serverTimestamp(),
      authorId: adminId,
      authorEmail: adminEmail
    });

    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_SUPPORT_ACCESS] Nota de suporte adicionada`,
      clinicId,
      'clinic',
      { noteText: noteText.substring(0, 100) }
    );
  },

  /**
   * Create a new clinic
   */
  createClinic: async (clinicData: {
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone: string;
    planId: string;
    status: string;
  }, adminId: string) => {
    const ref = collection(db, 'clinics');
    const newDoc = await addDoc(ref, {
      ...clinicData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Create the platform clinic index
    await PlatformAdminService.syncClinicMetadata(newDoc.id, {
      name: clinicData.name,
      ownerEmail: clinicData.ownerEmail,
      planId: clinicData.planId,
      status: clinicData.status,
      createdAt: new Date().toISOString()
    });

    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_CLINICS_LOADED] Nova clínica criada: ${clinicData.name}`,
      newDoc.id,
      'clinic',
      clinicData
    );

    return newDoc.id;
  },

  /**
   * Plan Management
   */
  subscribeToPlans: (onData: (plans: any[]) => void) => {
    const q = query(collection(db, 'platform_plans'), orderBy('price', 'asc'));
    return onSnapshot(q, (snap) => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'platform_plans'));
  },

  createPlan: async (planData: { name: string; price: number; description?: string; maxUsers?: number | null; active: boolean }, adminId: string) => {
    const ref = await addDoc(collection(db, 'platform_plans'), {
      ...planData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_PLAN_CREATED] Plano "${planData.name}" criado`,
      ref.id,
      'plan',
      planData
    );
    return ref.id;
  },

  updatePlan: async (planId: string, patch: Partial<{ name: string; price: number; description: string; maxUsers: number | null; active: boolean }>, adminId: string) => {
    await updateDoc(doc(db, 'platform_plans', planId), { ...patch, updatedAt: serverTimestamp() });
    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_PLAN_UPDATED] Plano atualizado`,
      planId,
      'plan',
      patch
    );
  },

  deactivatePlan: async (planId: string, adminId: string) => {
    await updateDoc(doc(db, 'platform_plans', planId), { active: false, updatedAt: serverTimestamp() });
    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_PLAN_DEACTIVATED] Plano desativado`,
      planId,
      'plan',
      {}
    );
  },

  /**
   * Platform Admin Access Management (platform_admins collection)
   */
  subscribeToPlatformAdmins: (onData: (admins: any[]) => void) => {
    const q = query(collection(db, 'platform_admins'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'platform_admins'));
  },

  // Grants access to someone who already has a users/ account (looked up by
  // email). Throws a clear, catchable error if no matching account exists —
  // the caller should offer "convidar novo administrador" instead.
  grantPlatformAdmin: async (email: string, role: string, adminId: string) => {
    const emailLower = email.trim().toLowerCase();
    const usersQ = query(collection(db, 'users'), where('email', '==', emailLower));
    const usersSnap = await getDocs(usersQ);
    if (usersSnap.empty) {
      throw new Error('Nenhuma conta encontrada com esse e-mail. Use "Convidar novo administrador" para criar uma conta.');
    }
    const targetUser = usersSnap.docs[0];
    const targetUid = targetUser.id;

    await setDoc(doc(db, 'platform_admins', targetUid), {
      email: emailLower,
      name: targetUser.data()?.name || emailLower,
      role,
      active: true,
      grantedBy: adminId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await updateDoc(doc(db, 'users', targetUid), { platformRole: role, isPlatformAdmin: true, updatedAt: serverTimestamp() });

    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_ACCESS_MANAGED] Acesso concedido a ${emailLower} (${role})`,
      targetUid,
      'platform_admin',
      { email: emailLower, role }
    );
    return targetUid;
  },

  revokePlatformAdmin: async (targetUid: string, adminId: string) => {
    await updateDoc(doc(db, 'platform_admins', targetUid), { active: false, updatedAt: serverTimestamp() });
    await updateDoc(doc(db, 'users', targetUid), { isPlatformAdmin: false, updatedAt: serverTimestamp() }).catch(() => {});
    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_ACCESS_MANAGED] Acesso revogado`,
      targetUid,
      'platform_admin',
      {}
    );
  },

  updatePlatformAdminRole: async (targetUid: string, role: string, adminId: string) => {
    await updateDoc(doc(db, 'platform_admins', targetUid), { role, updatedAt: serverTimestamp() });
    await updateDoc(doc(db, 'users', targetUid), { platformRole: role, updatedAt: serverTimestamp() }).catch(() => {});
    await PlatformAdminService.logAdminAction(
      adminId,
      `[SUPER_ADMIN_ACCESS_MANAGED] Papel alterado para ${role}`,
      targetUid,
      'platform_admin',
      { role }
    );
  },

  /**
   * Real AI usage rollup, aggregated client-side from the ai_usage_logs
   * subcollection under every clinic (a Firestore collectionGroup query —
   * allowed for platform admins via the clinics wildcard subcollection
   * rule). No fabricated numbers: only what was actually logged by
   * server.ts's AI gateway.
   * NOTE: does not include AI calls that bypass the gateway (WhatsApp
   * draft/polish, marketing tips) — those aren't logged anywhere yet.
   */
  getAiUsageRollup: async (): Promise<{
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    byClinic: Record<string, { clinicId: string; calls: number }>;
    sampledCount: number;
  }> => {
    const q = query(collectionGroup(db, 'ai_usage_logs'), orderBy('createdAt', 'desc'), limit(1000));
    const snap = await getDocs(q);
    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byClinic: Record<string, { clinicId: string; calls: number }> = {};
    let successCalls = 0;
    let failedCalls = 0;

    snap.docs.forEach(d => {
      const data = d.data();
      if (data.success) successCalls++; else failedCalls++;
      const provider = data.provider || 'desconhecido';
      const model = data.model || 'desconhecido';
      byProvider[provider] = (byProvider[provider] || 0) + 1;
      byModel[model] = (byModel[model] || 0) + 1;
      const clinicId = d.ref.parent.parent?.id || 'desconhecida';
      if (!byClinic[clinicId]) byClinic[clinicId] = { clinicId, calls: 0 };
      byClinic[clinicId].calls++;
    });

    return {
      totalCalls: snap.size,
      successCalls,
      failedCalls,
      byProvider,
      byModel,
      byClinic,
      sampledCount: snap.size,
    };
  },

  /**
   * Real system health signal: hits the backend's /api/health (process
   * uptime + a live Firestore Admin SDK read), not a hardcoded badge.
   */
  checkSystemHealth: async (): Promise<{ ok: boolean; uptimeSeconds: number; timestamp: string; firestoreReachable: boolean; latencyMs: number } | { ok: false; error: string }> => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Falha ao consultar /api/health' };
    }
  },
};
