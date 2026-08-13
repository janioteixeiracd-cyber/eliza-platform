import React from 'react';
import { Navigate, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Loader2, ShieldAlert } from 'lucide-react';
import { ENABLE_PLATFORM_ADMIN } from '../../config';

export default function AdminRoute() {
  const { isPlatformAdmin, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (!ENABLE_PLATFORM_ADMIN || !isPlatformAdmin) {
    if (ENABLE_PLATFORM_ADMIN) {
      console.warn("[AdminRoute] Access denied. User is not a platform admin.");
    }
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 font-sans">
        <div className="max-w-md w-full bg-slate-800 rounded-[2.5rem] p-8 border border-slate-700 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mx-auto border border-rose-500/20 shadow-lg">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black uppercase tracking-tight text-white">Acesso Restrito</h2>
            <p className="text-slate-400 text-sm font-medium leading-relaxed">
              Acesso restrito ao administrador da plataforma.
            </p>
          </div>
          <div className="pt-4 flex flex-col gap-2">
            <Link 
              to="/" 
              className="w-full py-3 bg-teal-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-teal-700 transition-all text-center"
            >
              Ir para o App Clínico
            </Link>
            <button 
              onClick={async () => {
                try {
                  await logout();
                } catch (e) {
                  console.error(e);
                }
              }}
              className="w-full py-3 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
            >
              Sair da Conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
