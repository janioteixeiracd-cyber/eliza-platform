import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { usePatientPortal } from './PatientPortalContext';
import PatientPortalShell from './PatientPortalShell';
import ElizaLoadingScreen from '../components/ElizaLoadingScreen';

// Fallback access — full name + phone, followed by mandatory WhatsApp OTP.
// /portal/:clinicSlug reuses the clinic's existing `slug` field, so no new
// field or ID is needed to route the request to the right clinic.
export default function PatientPortalOtpEntry() {
  const { clinicSlug } = useParams();
  const { session, loading, requestOtp, verifyOtp } = usePatientPortal();
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading) return <ElizaLoadingScreen message="Carregando Portal do Paciente..." />;
  if (session) return <PatientPortalShell />;

  if (!clinicSlug) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center" style={{ background: '#07050c' }}>
        <p className="text-sm text-slate-400 max-w-xs">Peça à sua clínica o link de acesso ao Portal do Paciente.</p>
      </div>
    );
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true); setError(null); setInfo(null);
    const res = await requestOtp(clinicSlug, name.trim(), phone.trim());
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Erro ao solicitar código.'); return; }
    setRequestId(res.requestId);
    setInfo('Se os dados estiverem corretos, você vai receber um código pelo WhatsApp em instantes.');
    setStep('otp');
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestId) { setError('Não foi possível confirmar seus dados. Volte e tente novamente.'); return; }
    if (!code.trim()) return;
    setSubmitting(true); setError(null);
    const res = await verifyOtp(requestId, code.trim());
    setSubmitting(false);
    if (!res.success) setError(res.error || 'Código incorreto.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#07050c' }}>
      <div className="max-w-sm w-full next-glass-panel rounded-next-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-next-purple-neon" />
          <h1 className="text-sm font-bold text-slate-100">Portal do Paciente</h1>
        </div>
        {step === 'form' ? (
          <form onSubmit={submitForm} className="space-y-3 mt-4">
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Nome completo</label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Telefone / WhatsApp</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
            </div>
            {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
            <button type="submit" disabled={submitting} className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{submitting ? 'Enviando...' : 'Receber código por WhatsApp'}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-3 mt-4">
            {info && <p className="text-[11px] text-slate-400">{info}</p>}
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Código recebido</label>
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" className="w-full bg-slate-900 border border-next-border rounded-lg text-lg tracking-[0.4em] text-center text-slate-100 font-mono px-3 py-3 mt-1" />
            </div>
            {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
            <button type="submit" disabled={submitting || code.length < 6} className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{submitting ? 'Verificando...' : 'Entrar'}</span>
            </button>
            <button type="button" onClick={() => { setStep('form'); setCode(''); setError(null); }} className="w-full text-[11px] text-slate-500 hover:text-slate-300 py-1">Corrigir dados</button>
          </form>
        )}
      </div>
    </div>
  );
}
