import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginView() {
  const { loginWithGoogle, loginWithEmail, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setErrorStatus(null);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error(err);
      setErrorStatus(err.message || 'Falha ao entrar com Google');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setErrorStatus(null);
    try {
      await loginWithEmail(email, password);
    } catch (err: any) {
      console.error("[Login] Email login failed:", err.message);
      setErrorStatus(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-dvh overflow-y-auto bg-next-bg-deep flex items-center justify-center p-6 font-sans" style={{ background: 'var(--color-next-bg-deep)', height: 'var(--app-vh, 100dvh)' }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 65%)' }} />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/5 border border-next-border rounded-full mb-6">
            <Sparkles className="w-3.5 h-3.5 text-next-purple-neon" />
            <span className="text-[10px] font-bold text-next-purple-light uppercase tracking-widest">Plataforma Dental AI-First</span>
          </Link>
          <div className="w-16 h-16 next-brand-gradient-bg rounded-3xl flex items-center justify-center text-white font-black text-3xl shadow-next-glow-purple-strong mx-auto mb-6">E</div>
          <h2 className="text-2xl font-black text-white tracking-tight mb-1.5">Bem-vinda à Eliza Clínica Inteligente</h2>
          <p className="text-slate-400 text-sm font-medium">Acesse sua conta para gerenciar sua clínica.</p>
        </div>

        <div className="next-glass-panel rounded-next-2xl p-7 space-y-6">
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-4 py-4 rounded-2xl bg-white text-slate-800 text-xs font-bold uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-60"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
            {isLoading ? 'Conectando...' : 'Entrar com Google'}
          </button>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-next-border"></div>
            <span className="flex-shrink mx-4 text-[9px] font-black text-slate-600 uppercase tracking-widest">Ou use seu e-mail</span>
            <div className="flex-grow border-t border-next-border"></div>
          </div>

          <form className="space-y-4" onSubmit={handleEmailLogin}>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">E-mail Corporativo</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-900 border border-next-border rounded-2xl text-sm font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-next-purple-neon/25 focus:border-next-purple-neon transition-all"
                  placeholder="exemplo@clinica.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center ml-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Senha de Acesso</label>
                <button type="button" className="text-[9px] font-black text-next-purple-light uppercase tracking-widest hover:underline">Esqueceu?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-900 border border-next-border rounded-2xl text-sm font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-next-purple-neon/25 focus:border-next-purple-neon transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {(errorStatus || authError) && (
              <div className="px-4 py-3 bg-next-red-alert/10 border border-next-red-alert/25 rounded-xl text-[10px] font-bold text-next-red-alert uppercase tracking-widest text-center">
                {errorStatus || authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 next-brand-gradient-bg text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-next-glow-purple hover:scale-[1.01] active:scale-[0.99] transition-transform disabled:opacity-60"
            >
              {isLoading ? 'Verificando...' : 'Acessar Dashboard'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-500 font-medium">
            Não tem uma conta?{' '}
            <Link to="/register" className="text-next-purple-light font-black uppercase tracking-tight hover:underline">Cadastre-se</Link>
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-slate-600">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Segurança de Nível Bancário</span>
        </div>

        <div className="mt-6 flex flex-wrap gap-x-3 gap-y-1 items-center justify-center text-[9px] font-black uppercase tracking-widest text-slate-600">
          <Link to="/company" className="hover:text-slate-300 transition-colors">Informações da Empresa</Link>
          <span className="text-slate-700 font-normal select-none">•</span>
          <Link to="/privacy" className="hover:text-slate-300 transition-colors">Política de Privacidade</Link>
          <span className="text-slate-700 font-normal select-none">•</span>
          <Link to="/terms" className="hover:text-slate-300 transition-colors">Termos de Uso</Link>
          <span className="text-slate-700 font-normal select-none">•</span>
          <Link to="/data-deletion" className="hover:text-slate-300 transition-colors">Exclusão de Dados</Link>
        </div>
      </motion.div>
    </div>
  );
}
