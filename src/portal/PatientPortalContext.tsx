import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

interface PortalSession {
  patientName: string;
  clinicName: string;
}

interface PatientPortalContextType {
  session: PortalSession | null;
  loading: boolean;
  redeemLink: (token: string) => Promise<{ success: boolean; error?: string }>;
  requestOtp: (clinicSlug: string, name: string, phone: string) => Promise<{ success: boolean; requestId: string | null; error?: string }>;
  verifyOtp: (requestId: string, code: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  apiFetch: (path: string, options?: RequestInit) => Promise<any>;
}

const STORAGE_KEY = 'eliza_patient_portal_session_token';

const PatientPortalContext = createContext<PatientPortalContextType | undefined>(undefined);

// A patient has no Firebase account, so this context never touches
// AuthContext/Firebase Auth — it holds a single opaque session token
// (returned by server.ts's /api/patient-portal/* routes) in localStorage
// and attaches it as a Bearer header on every authenticated call.
export function PatientPortalProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [loading, setLoading] = useState(true);

  const apiFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const token = localStorage.getItem(STORAGE_KEY);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as any) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api/patient-portal${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      if (res.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
      }
      throw new Error(data?.error || 'Erro ao comunicar com o servidor.');
    }
    return data.data;
  }, []);

  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (!existing) { setLoading(false); return; }
    apiFetch('/home')
      .then((data) => setSession({ patientName: data.patientName, clinicName: data.clinicName }))
      .catch(() => { /* apiFetch already clears the stored token on 401 */ })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redeemLink = async (token: string) => {
    try {
      const res = await fetch('/api/patient-portal/link/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { success: false, error: data?.error || 'Link inválido.' };
      localStorage.setItem(STORAGE_KEY, data.data.sessionToken);
      setSession({ patientName: data.data.patientName, clinicName: data.data.clinicName });
      return { success: true };
    } catch {
      return { success: false, error: 'Erro de conexão. Tente novamente.' };
    }
  };

  const requestOtp = async (clinicSlug: string, name: string, phone: string) => {
    try {
      const res = await fetch('/api/patient-portal/auth/request-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinicSlug, name, phone }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { success: false, requestId: null, error: data?.error || 'Erro ao solicitar código.' };
      return { success: true, requestId: data.data.requestId };
    } catch {
      return { success: false, requestId: null, error: 'Erro de conexão. Tente novamente.' };
    }
  };

  const verifyOtp = async (requestId: string, code: string) => {
    try {
      const res = await fetch('/api/patient-portal/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { success: false, error: data?.error || 'Código inválido.' };
      localStorage.setItem(STORAGE_KEY, data.data.sessionToken);
      setSession({ patientName: data.data.patientName, clinicName: data.data.clinicName });
      return { success: true };
    } catch {
      return { success: false, error: 'Erro de conexão. Tente novamente.' };
    }
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  return (
    <PatientPortalContext.Provider value={{ session, loading, redeemLink, requestOtp, verifyOtp, logout, apiFetch }}>
      {children}
    </PatientPortalContext.Provider>
  );
}

export function usePatientPortal() {
  const ctx = useContext(PatientPortalContext);
  if (!ctx) throw new Error('usePatientPortal must be used within PatientPortalProvider');
  return ctx;
}
