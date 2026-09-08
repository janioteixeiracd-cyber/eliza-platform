import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { PlatformAdminService, PlatformMetric } from '../services/platformAdminService';
import { ENABLE_PLATFORM_ADMIN } from '../config';
import type { PlanRole, PlanCapabilities } from '../lib/planCapabilities';

interface FoundingPromo { totalSlots: number; slotsClaimed: number; active: boolean; updatedAt?: any; }
type PlanFormData = { name: string; planRole: PlanRole; regularPriceCents: number; founderPriceCents: number; description?: string; maxUsers?: number | null; capabilities: PlanCapabilities; salesEnabled: boolean; active: boolean };

interface AdminContextType {
  metrics: PlatformMetric[];
  clinics: any[];
  users: any[];
  auditLogs: any[];
  plans: any[];
  platformAdmins: any[];
  isLoading: boolean;
  supportMode: {
    active: boolean;
    clinicId: string | null;
    clinicData: any | null;
  };
  enterSupportMode: (clinicId: string) => Promise<void>;
  exitSupportMode: () => void;
  createClinic: (clinicData: {
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone: string;
    planId: string;
    status: string;
  }, password: string) => Promise<string>;
  updateClinicStatus: (clinicId: string, status: string) => Promise<void>;
  updateClinicPlan: (clinicId: string, planId: string) => Promise<void>;
  archiveClinic: (clinicId: string) => Promise<void>;
  addClinicSupportNote: (clinicId: string, noteText: string) => Promise<void>;
  createPlan: (planData: PlanFormData) => Promise<string>;
  updatePlan: (planId: string, patch: Partial<PlanFormData>) => Promise<void>;
  deactivatePlan: (planId: string) => Promise<void>;
  foundingPromo: FoundingPromo | null;
  updateFoundingPromo: (patch: Partial<{ totalSlots: number; active: boolean }>) => Promise<void>;
  grantPlatformAdmin: (email: string, role: string) => Promise<string>;
  revokePlatformAdmin: (targetUid: string) => Promise<void>;
  updatePlatformAdminRole: (targetUid: string, role: string) => Promise<void>;
  getAiUsageRollup: () => ReturnType<typeof PlatformAdminService.getAiUsageRollup>;
  checkSystemHealth: () => ReturnType<typeof PlatformAdminService.checkSystemHealth>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, user, supportMode, enterSupportMode, exitSupportMode } = useAuth();
  const [metrics, setMetrics] = useState<PlatformMetric[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [platformAdmins, setPlatformAdmins] = useState<any[]>([]);
  const [foundingPromo, setFoundingPromo] = useState<FoundingPromo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isPlatformAdmin || !ENABLE_PLATFORM_ADMIN) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    
    // Log [SUPER_ADMIN_ACCESS_GRANTED] on successful entry
    if (user) {
      PlatformAdminService.logAdminAction(
        user.uid,
        '[SUPER_ADMIN_ACCESS_GRANTED] Administrador acessou o painel de controle global',
        'platform',
        'system'
      );
    }

    const unsubMetrics = PlatformAdminService.subscribeToMetrics((data) => {
      setMetrics(data);
    });

    const unsubClinics = PlatformAdminService.subscribeToClinics((data) => {
      setClinics(data);
      setIsLoading(false);
    });

    const unsubUsers = PlatformAdminService.subscribeToUsers((data) => {
      setUsers(data);
    });

    const unsubLogs = PlatformAdminService.subscribeToAuditLogs((data) => {
      setAuditLogs(data);
    });

    const unsubPlans = PlatformAdminService.subscribeToPlans((data) => {
      setPlans(data);
    });

    const unsubPlatformAdmins = PlatformAdminService.subscribeToPlatformAdmins((data) => {
      setPlatformAdmins(data);
    });

    const unsubFoundingPromo = PlatformAdminService.subscribeToFoundingPromo((data) => {
      setFoundingPromo(data);
    });

    return () => {
      unsubMetrics();
      unsubClinics();
      unsubUsers();
      unsubLogs();
      unsubPlans();
      unsubPlatformAdmins();
      unsubFoundingPromo();
    };
  }, [isPlatformAdmin, user]);

  // Best-effort e-mail notification via the Hostinger SMTP gateway in
  // server.ts — never blocks or fails the underlying admin action (a
  // password reset or clinic creation must still succeed even if the mail
  // send fails for some reason).
  const notifyClinicOwner = async (payload: { to: string; name: string; clinicName: string; type: 'created' | 'plan_changed'; planLabel?: string }) => {
    try {
      if (!payload.to) return;
      const idToken = await user?.getIdToken();
      if (!idToken) return;
      await fetch('/api/admin/notify-clinic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn('[AdminContext] Failed to send clinic notification e-mail:', e);
    }
  };

  const createClinic = async (clinicData: {
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone: string;
    planId: string;
    status: string;
  }, password: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    // Server-side (not the client secondary-auth-app trick) because it needs
    // to look up an existing Auth account by e-mail — e.g. re-creating a
    // clinic for someone who already has a login but lost access to their
    // old (archived) one. Only the Admin SDK can do that lookup.
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/create-clinic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ ...clinicData, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao criar clínica.');
    notifyClinicOwner({ to: clinicData.ownerEmail, name: clinicData.ownerName, clinicName: clinicData.name, type: 'created' });
    return data.clinicId as string;
  };

  const updateClinicStatus = async (clinicId: string, status: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updateClinicStatus(clinicId, status, user.uid);
  };

  const updateClinicPlan = async (clinicId: string, planId: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updateClinicPlan(clinicId, planId, user.uid);
    const clinic = clinics.find((c: any) => c.id === clinicId);
    const plan = plans.find((p: any) => p.id === planId);
    if (clinic?.ownerEmail) {
      notifyClinicOwner({ to: clinic.ownerEmail, name: clinic.ownerName || 'Cliente', clinicName: clinic.name, type: 'plan_changed', planLabel: plan?.name || planId });
    }
  };

  // Soft delete: hides the clinic from the default admin view without
  // touching its data (patients, records, financeiro) — see ClinicsManagement.tsx.
  const archiveClinic = async (clinicId: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updateClinicStatus(clinicId, 'archived', user.uid);
  };

  const addClinicSupportNote = async (clinicId: string, noteText: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.addClinicSupportNote(clinicId, noteText, user.uid, user.email || '');
  };

  const createPlan = async (planData: PlanFormData) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    return await PlatformAdminService.createPlan(planData, user.uid);
  };

  const updatePlan = async (planId: string, patch: Partial<PlanFormData>) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updatePlan(planId, patch, user.uid);
  };

  const deactivatePlan = async (planId: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.deactivatePlan(planId, user.uid);
  };

  const updateFoundingPromo = async (patch: Partial<{ totalSlots: number; active: boolean }>) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updateFoundingPromo(patch, user.uid);
  };

  const grantPlatformAdmin = async (email: string, role: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    return await PlatformAdminService.grantPlatformAdmin(email, role, user.uid);
  };

  const revokePlatformAdmin = async (targetUid: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.revokePlatformAdmin(targetUid, user.uid);
  };

  const updatePlatformAdminRole = async (targetUid: string, role: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updatePlatformAdminRole(targetUid, role, user.uid);
  };

  const getAiUsageRollup = () => PlatformAdminService.getAiUsageRollup();
  const checkSystemHealth = () => PlatformAdminService.checkSystemHealth();

  return (
    <AdminContext.Provider value={{
      metrics,
      clinics,
      users,
      auditLogs,
      plans,
      platformAdmins,
      isLoading,
      supportMode,
      enterSupportMode,
      exitSupportMode,
      createClinic,
      updateClinicStatus,
      updateClinicPlan,
      archiveClinic,
      addClinicSupportNote,
      createPlan,
      updatePlan,
      deactivatePlan,
      foundingPromo,
      updateFoundingPromo,
      grantPlatformAdmin,
      revokePlatformAdmin,
      updatePlatformAdminRole,
      getAiUsageRollup,
      checkSystemHealth,
    }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}
