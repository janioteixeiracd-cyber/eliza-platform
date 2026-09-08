import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { PatientPortalProvider } from './PatientPortalContext';
import PatientPortalLinkEntry from './PatientPortalLinkEntry';
import PatientPortalOtpEntry from './PatientPortalOtpEntry';

// Fully isolated from AuthContext/Firebase Auth — patients never have a
// Firebase account. Mounted at /portal/* in App.tsx, outside AppLayout and
// ElizaNextLayout entirely.
export default function PatientPortalApp() {
  return (
    <PatientPortalProvider>
      <Routes>
        <Route path="t/:token" element={<PatientPortalLinkEntry />} />
        <Route path=":clinicSlug" element={<PatientPortalOtpEntry />} />
        <Route path="*" element={<PatientPortalOtpEntry />} />
      </Routes>
    </PatientPortalProvider>
  );
}
