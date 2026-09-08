import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Blocks access to the student portal until a temporary password (set by
// the professor at account creation — inviteService.ts's
// createEducationStudent) has been changed. mustChangePassword was already
// being written on the student doc before this existed; it was just never
// read anywhere, so a temp password never actually had to be replaced.
export default function StudentChangePasswordGate({ onDone }: { onDone: () => void }) {
  const { changeStudentPassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (newPassword.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    setSaving(true);
    try {
      await changeStudentPassword(newPassword);
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível trocar a senha agora. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 h-dvh overflow-y-auto text-slate-100 font-sans flex items-center justify-center p-6" style={{ background: 'var(--color-next-bg-deep)', height: 'var(--app-vh, 100dvh)' }}>
      <div className="w-full max-w-sm next-glass-panel rounded-next-2xl p-8">
        <div className="w-12 h-12 rounded-2xl next-brand-gradient-bg flex items-center justify-center text-white mb-5 shadow-next-glow-purple">
          <Lock className="w-5 h-5" />
        </div>
        <h1 className="text-lg font-black text-white tracking-tight mb-1.5">Defina sua senha</h1>
        <p className="text-xs text-slate-400 font-medium mb-6">
          Você entrou com uma senha temporária. Antes de continuar, escolha uma senha nova só sua.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nova senha</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
              autoFocus
              className="w-full mt-1 px-4 py-3 bg-slate-900 border border-next-border rounded-2xl text-sm font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-next-purple-neon/25 focus:border-next-purple-neon transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
              className="w-full mt-1 px-4 py-3 bg-slate-900 border border-next-border rounded-2xl text-sm font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-next-purple-neon/25 focus:border-next-purple-neon transition-all"
            />
          </div>
          {error && <p className="text-xs font-semibold text-next-red-alert">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 next-brand-gradient-bg text-white font-bold text-sm rounded-2xl shadow-next-glow-purple disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar e entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
