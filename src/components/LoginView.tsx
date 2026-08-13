import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, LogIn, Github, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
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
      // AuthContext handles the authError state, but we can also handle it locally for immediate UI feedback
      setErrorStatus(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row overflow-hidden font-sans">
      {/* Left Decoration - Desktop Only */}
      <div className="hidden lg:flex w-1/2 bg-slate-900 relative items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-teal-500 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-indigo-500 rounded-full blur-[120px]" />
        </div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 text-center px-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full mb-8 backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">Plataforma Dental AI-First</span>
          </div>
          <h1 className="text-6xl font-black text-white tracking-tighter leading-none mb-6">
            Gestão inteligente,<br/>
            <span className="text-teal-400 font-serif italic font-normal">sorrisos radiantes.</span>
          </h1>
          <p className="text-slate-400 text-lg font-medium leading-relaxed max-w-md mx-auto">
            A ELIZA transforma a rotina da sua clínica com inteligência de dados e automação comercial de elite.
          </p>
        </motion.div>

        {/* Decorative Circles */}
        <div className="absolute bottom-10 left-10 flex gap-4">
           {['4.9/5', 'Premium', 'Secure'].map(tag => (
             <div key={tag} className="px-4 py-2 border border-white/10 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest uppercase tracking-widest">
                {tag}
             </div>
           ))}
        </div>
      </div>

      {/* Right Form Section */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white lg:bg-transparent">
        <div className="w-full max-w-md">
          <div className="text-center mb-12">
            <div className="w-16 h-16 bg-teal-600 rounded-3xl flex items-center justify-center text-white font-bold text-3xl shadow-xl shadow-teal-600/20 mx-auto mb-6">E</div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Bem-vinda à ELIZA</h2>
            <p className="text-slate-400 text-sm font-medium">Acesse sua conta para gerenciar sua clínica.</p>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
               <button 
                 onClick={handleGoogleLogin}
                 disabled={isLoading}
                 className="flex items-center justify-center gap-4 py-4 rounded-2xl bg-white border border-slate-200 text-slate-700 text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
               >
                 <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
                 {isLoading ? 'Conectando...' : 'Entrar com Google'}
               </button>
            </div>

            <div className="relative flex items-center py-4">
              <div className="flex-grow border-t border-slate-100"></div>
              <span className="flex-shrink mx-4 text-[9px] font-black text-slate-300 uppercase tracking-widest">Ou use seu e-mail</span>
              <div className="flex-grow border-t border-slate-100"></div>
            </div>

            <form className="space-y-4" onSubmit={handleEmailLogin}>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail Corporativo</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    placeholder="exemplo@clinica.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha de Acesso</label>
                  <button type="button" className="text-[9px] font-black text-teal-600 uppercase tracking-widest hover:underline">Esqueceu?</button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {(errorStatus || authError) && (
                <div className="px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl text-[10px] font-bold text-rose-600 uppercase tracking-widest text-center">
                   {errorStatus || authError}
                </div>
              )}

              <button 
                type="submit"
                disabled={isLoading}
                className="w-full py-5 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 mt-4 group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Verificando...' : 'Acessar Dashboard'}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </div>

          <div className="mt-12 text-center">
            <p className="text-xs text-slate-400 font-medium">
              Não tem uma conta? <button className="text-teal-600 font-black uppercase tracking-tighter hover:underline">Solicite acesso</button>
            </p>
          </div>

          <div className="mt-12 flex items-center justify-center gap-2 text-slate-300">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Segurança de Nível Bancário</span>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-3 gap-y-1 items-center justify-center text-[9px] font-black uppercase tracking-widest text-slate-400">
            <Link to="/company" className="hover:text-teal-600 transition-colors">Informações da Empresa</Link>
            <span className="text-slate-200 font-normal select-none">•</span>
            <Link to="/privacy" className="hover:text-teal-600 transition-colors">Política de Privacidade</Link>
            <span className="text-slate-200 font-normal select-none">•</span>
            <Link to="/terms" className="hover:text-teal-600 transition-colors">Termos de Uso</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
