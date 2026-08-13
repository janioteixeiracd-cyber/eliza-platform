import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { PlatformAdminService, PlatformMetric } from '../services/platformAdminService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ENABLE_PLATFORM_ADMIN } from '../config';

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
  }) => Promise<string>;
  updateClinicStatus: (clinicId: string, status: string) => Promise<void>;
  updateClinicPlan: (clinicId: string, planId: string) => Promise<void>;
  addClinicSupportNote: (clinicId: string, noteText: string) => Promise<void>;
  createPlan: (planData: { name: string; price: number; description?: string; maxUsers?: number | null; active: boolean }) => Promise<string>;
  updatePlan: (planId: string, patch: Partial<{ name: string; price: number; description: string; maxUsers: number | null; active: boolean }>) => Promise<void>;
  deactivatePlan: (planId: string) => Promise<void>;
  grantPlatformAdmin: (email: string, role: string) => Promise<string>;
  revokePlatformAdmin: (targetUid: string) => Promise<void>;
  updatePlatformAdminRole: (targetUid: string, role: string) => Promise<void>;
  getAiUsageRollup: () => ReturnType<typeof PlatformAdminService.getAiUsageRollup>;
  checkSystemHealth: () => ReturnType<typeof PlatformAdminService.checkSystemHealth>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, user } = useAuth();
  const [metrics, setMetrics] = useState<PlatformMetric[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [platformAdmins, setPlatformAdmins] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [supportMode, setSupportMode] = useState<{
    active: boolean;
    clinicId: string | null;
    clinicData: any | null;
  }>({
    active: false,
    clinicId: null,
    clinicData: null
  });

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

    return () => {
      unsubMetrics();
      unsubClinics();
      unsubUsers();
      unsubLogs();
      unsubPlans();
      unsubPlatformAdmins();
    };
  }, [isPlatformAdmin, user]);

  const enterSupportMode = async (clinicId: string) => {
    if (!isPlatformAdmin || !user) return;

    try {
      const clinicSnap = await getDoc(doc(db, 'clinics', clinicId));
      if (clinicSnap.exists()) {
        setSupportMode({
          active: true,
          clinicId,
          clinicData: { id: clinicSnap.id, ...clinicSnap.data() }
        });

        // Audit log [SUPER_ADMIN_SUPPORT_ACCESS]
        await PlatformAdminService.logAdminAction(
          user.uid,
          '[SUPER_ADMIN_SUPPORT_ACCESS] Entrou em modo suporte para depuração',
          clinicId,
          'clinic',
          { clinicName: clinicSnap.data().name }
        );
      }
    } catch (error) {
      console.error("[AdminContext] Error entering support mode:", error);
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
    setSupportMode({
      active: false,
      clinicId: null,
      clinicData: null
    });
  };

  const createClinic = async (clinicData: {
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone: string;
    planId: string;
    status: string;
  }) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    return await PlatformAdminService.createClinic(clinicData, user.uid);
  };

  const updateClinicStatus = async (clinicId: string, status: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updateClinicStatus(clinicId, status, user.uid);
  };

  const updateClinicPlan = async (clinicId: string, planId: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updateClinicPlan(clinicId, planId, user.uid);
  };

  const addClinicSupportNote = async (clinicId: string, noteText: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.addClinicSupportNote(clinicId, noteText, user.uid, user.email || '');
  };

  const createPlan = async (planData: { name: string; price: number; description?: string; maxUsers?: number | null; active: boolean }) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    return await PlatformAdminService.createPlan(planData, user.uid);
  };

  const updatePlan = async (planId: string, patch: Partial<{ name: string; price: number; description: string; maxUsers: number | null; active: boolean }>) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.updatePlan(planId, patch, user.uid);
  };

  const deactivatePlan = async (planId: string) => {
    if (!isPlatformAdmin || !user) throw new Error("Unauthorized");
    await PlatformAdminService.deactivatePlan(planId, user.uid);
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
      addClinicSupportNote,
      createPlan,
      updatePlan,
      deactivatePlan,
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
