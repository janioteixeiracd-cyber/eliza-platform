import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import PlatformAdminLayout from './admin/PlatformAdminLayout';
import AdminRoute from './admin/components/AdminRoute';
import { AuthProvider } from './contexts/AuthContext';
import { AdminProvider } from './contexts/AdminContext';
import CompanyInfoView from './components/CompanyInfoView';
import PrivacyPolicyView from './components/PrivacyPolicyView';
import TermsOfUseView from './components/TermsOfUseView';
import DataDeletionView from './components/DataDeletionView';
import ElizaNextLayout from './next/components/ElizaNextLayout';
import PatientPortalApp from './portal/PatientPortalApp';
import AppErrorBoundary from './components/AppErrorBoundary';
import UpdateToast from './pwa/UpdateToast';

export default function App() {
  return (
    <AppErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <AdminProvider>
          <UpdateToast />
          <div className="min-h-screen bg-white font-sans">
            <Routes>
              {/* Public Institutional Pages (Bypass Auth for Meta & Google Scrapers) */}
              <Route path="/company" element={<CompanyInfoView />} />
              <Route path="/privacy" element={<PrivacyPolicyView />} />
              <Route path="/terms" element={<TermsOfUseView />} />
              <Route path="/data-deletion" element={<DataDeletionView />} />

              {/* Platform Admin Area */}
              <Route element={<AdminRoute />}>
                <Route path="/admin/*" element={<PlatformAdminLayout />} />
                <Route path="/super-admin/*" element={<PlatformAdminLayout />} />
              </Route>
              
              {/* ELIZA NEXT 2.0 (Sprint 1: Isolated Sandbox Environment) */}
              <Route path="/next/*" element={<ElizaNextLayout />} />

              {/* Portal do Paciente — fully public, no Firebase Auth. Own
                  opaque session token validated server-side on every call. */}
              <Route path="/portal/*" element={<PatientPortalApp />} />

              {/* Clinical Area & Public Routes */}
              <Route path="/*" element={<AppLayout />} />
            </Routes>
          </div>
        </AdminProvider>
      </AuthProvider>
    </BrowserRouter>
    </AppErrorBoundary>
  );
}
