import React, { useState } from 'react';
import { KeyRound, Plus, X, Loader2, ShieldCheck, ShieldOff, UserPlus, Mail } from 'lucide-react';
import { useAdmin } from '../../contexts/AdminContext';
import { useAuth } from '../../contexts/AuthContext';
import { InviteService } from '../../services/inviteService';

const ROLES = ['super_admin', 'admin', 'support'];
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Administrador',
  support: 'Suporte',
};

export default function PlatformAccessManagement() {
  const { platformAdmins, grantPlatformAdmin, revokePlatformAdmin, updatePlatformAdminRole } = useAdmin();
  const { user } = useAuth();

  const [mode, setMode] = useState<'existing' | 'invite' | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('admin');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<any | null>(null);

  const resetForm = () => {
    setMode(null);
    setEmail('');
    setName('');
    setRole('admin');
    setError(null);
  };

  const handleGrantExisting = async () => {
    if (!email.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await grantPlatformAdmin(email.trim(), role);
      resetForm();
    } catch (e: any) {
      setError(e?.message || 'Falha ao conceder acesso.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInviteNew = async () => {
    if (!email.trim() || !name.trim() || !user) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await InviteService.createPlatformAdmin({ email: email.trim(), name: name.trim(), role }, user.uid);
      resetForm();
    } catch (e: any) {
      setError(e?.message || 'Falha ao convidar administrador.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!pendingRevoke) return;
    setIsSubmitting(true);
    try {
      await revokePlatformAdmin(pendingRevoke.id);
      setPendingRevoke(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Acessos Administrativos</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Quem tem acesso ao painel Super Admin da ELIZA</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setMode('existing')}
            className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all"
          >
            <Mail className="w-4 h-4" /> Conceder a existente
          </button>
          <button
            onClick={() => setMode('invite')}
            className="px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-teal-600/15"
          >
            <UserPlus className="w-4 h-4" /> Convidar novo
          </button>
        </div>
      </header>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Administradores da Plataforma ({platformAdmins.length})</h3>
        </div>
        {platformAdmins.length === 0 ? (
          <div className="py-20 text-center opacity-40 flex flex-col items-center justify-center space-y-4">
            <KeyRound className="w-12 h-12 text-slate-400 stroke-1" />
            <p className="text-[10px] font-black uppercase tracking-widest">Nenhum administrador cadastrado nesta lista ainda</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Nome', 'E-mail', 'Papel', 'Status', 'Ações'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {platformAdmins.map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{a.name || '—'}</p>
                      <p className="text-[9px] text-slate-400 font-mono">{a.id}</p>
                    </td>
                    <td className="px-6 py-4 text-[11px] text-slate-600 font-medium">{a.email}</td>
                    <td className="px-6 py-4">
                      <select
                        value={a.role || 'admin'}
                        onChange={(e) => updatePlatformAdminRole(a.id, e.target.value)}
                        disabled={!a.active}
                        className="bg-slate-50 border border-slate-200 rounded-lg text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 outline-none focus:border-teal-500 disabled:opacity-50"
                      >
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      {a.active !== false ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-600"><ShieldCheck className="w-3.5 h-3.5" /> Ativo</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-rose-500"><ShieldOff className="w-3.5 h-3.5" /> Revogado</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {a.active !== false && (
                        <button
                          onClick={() => setPendingRevoke(a)}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[9px] font-black uppercase tracking-widest rounded-lg transition-colors"
                        >
                          Revogar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GRANT / INVITE MODAL */}
      {mode && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-md shadow-2xl p-8 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                {mode === 'existing' ? 'Conceder acesso a conta existente' : 'Convidar novo administrador'}
              </h3>
              <button onClick={resetForm} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-relaxed">
              {mode === 'existing'
                ? 'A pessoa já precisa ter uma conta na ELIZA (qualquer clínica). Vamos apenas conceder o papel de administrador da plataforma.'
                : 'Cria uma conta nova do zero e já concede acesso ao painel Super Admin.'}
            </p>

            <div className="space-y-3">
              {mode === 'invite' && (
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Nome</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome completo"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pessoa@eliza.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Papel</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 uppercase outline-none focus:border-teal-500 transition-all"
                >
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>

            {error && <p className="text-[10px] text-rose-600 font-bold">{error}</p>}

            <div className="flex gap-4 pt-2">
              <button onClick={resetForm} className="flex-1 py-3 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-xl">Cancelar</button>
              <button
                onClick={mode === 'existing' ? handleGrantExisting : handleInviteNew}
                disabled={isSubmitting || !email.trim() || (mode === 'invite' && !name.trim())}
                className="flex-1 py-3 bg-teal-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {isSubmitting ? 'Processando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REVOKE CONFIRM MODAL */}
      {pendingRevoke && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 w-full max-w-sm shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200 text-center">
            <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldOff className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Revogar acesso?</h3>
              <p className="text-[11px] text-slate-500 font-medium mt-2">{pendingRevoke.name || pendingRevoke.email} perderá acesso ao painel Super Admin. O histórico fica registrado.</p>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setPendingRevoke(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-xl">Cancelar</button>
              <button onClick={handleRevoke} disabled={isSubmitting} className="flex-1 py-3 bg-rose-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl disabled:opacity-50">
                {isSubmitting ? 'Revogando...' : 'Revogar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
