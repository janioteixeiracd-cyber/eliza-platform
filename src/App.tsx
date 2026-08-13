import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import PlatformAdminLayout from './admin/PlatformAdminLayout';
import AdminRoute from './admin/components/AdminRoute';
import { AuthProvider } from './contexts/AuthContext';
import { AdminProvider } from './contexts/AdminContext';
import CompanyInfoView from './components/CompanyInfoView';
import PrivacyPolicyView from './components/PrivacyPolicyView';
import TermsOfUseView from './components/TermsOfUseView';
import ElizaNextLayout from './next/components/ElizaNextLayout';
import AppErrorBoundary from './components/AppErrorBoundary';

export default function App() {
  return (
    <AppErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <AdminProvider>
          <div className="min-h-screen bg-white font-sans">
            <Routes>
              {/* Public Institutional Pages (Bypass Auth for Meta & Google Scrapers) */}
              <Route path="/company" element={<CompanyInfoView />} />
              <Route path="/privacy" element={<PrivacyPolicyView />} />
              <Route path="/terms" element={<TermsOfUseView />} />

              {/* Platform Admin Area */}
              <Route element={<AdminRoute />}>
                <Route path="/admin/*" element={<PlatformAdminLayout />} />
                <Route path="/super-admin/*" element={<PlatformAdminLayout />} />
              </Route>
              
              {/* ELIZA NEXT 2.0 (Sprint 1: Isolated Sandbox Environment) */}
              <Route path="/next/*" element={<ElizaNextLayout />} />
              
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
