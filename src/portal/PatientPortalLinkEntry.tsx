import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { usePatientPortal } from './PatientPortalContext';
import PatientPortalShell from './PatientPortalShell';
import ElizaLoadingScreen from '../components/ElizaLoadingScreen';
import { ShieldAlert } from 'lucide-react';

// The individual secure link — /portal/t/:token. The token is opaque and
// never carries patientId, CPF, or phone; server.ts resolves it server-side.
export default function PatientPortalLinkEntry() {
  const { token } = useParams();
  const { session, loading, redeemLink } = usePatientPortal();
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(true);

  useEffect(() => {
    if (loading || session) { setRedeeming(false); return; }
    if (!token) { setError('Link inválido.'); setRedeeming(false); return; }
    redeemLink(token).then((res) => {
      if (!res.success) setError(res.error || 'Link inválido ou expirado.');
      setRedeeming(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, token]);

  if (loading || redeeming) return <ElizaLoadingScreen message="Acessando seu Portal..." />;
  if (session) return <PatientPortalShell />;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#07050c' }}>
      <div className="max-w-sm w-full next-glass-panel rounded-next-2xl p-6 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-next-red-alert mx-auto" />
        <p className="text-sm font-bold text-slate-200">Não foi possível acessar</p>
        <p className="text-xs text-slate-400">{error}</p>
      </div>
    </div>
  );
}
