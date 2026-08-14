import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  Sparkles, ArrowRight, ClipboardList, Users2, BarChart3, Rocket,
  CheckCircle2, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const FEATURES = [
  { icon: ClipboardList, title: 'Organiza', desc: 'sua rotina' },
  { icon: Users2, title: 'Conecta', desc: 'seus pacientes' },
  { icon: BarChart3, title: 'Analisa', desc: 'seus resultados' },
  { icon: Rocket, title: 'Transforma', desc: 'sua clínica' },
];

const FOUNDER_BENEFITS = [
  'Valor de lançamento fixo pelos primeiros 12 meses',
  'Suporte prioritário direto com a equipe ELIZA',
  'Acesso antecipado a cada novo módulo de IA',
];

export default function PublicLandingView() {
  const { loginWithGoogle } = useAuth();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      setStartError(err?.message || 'Falha ao iniciar. Tente novamente.');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto bg-next-bg-deep font-sans" style={{ background: 'var(--color-next-bg-deep)' }}>
      {/* NAV */}
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <span className="text-lg font-black text-white tracking-tight">ELIZA</span>
        <Link to="/login" className="text-xs font-bold text-slate-300 hover:text-white px-4 py-2 rounded-lg border border-next-border transition-colors">
          Entrar
        </Link>
      </div>

      {/* HERO */}
      <div className="relative max-w-6xl mx-auto px-6 pt-10 pb-20 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.20) 0%, transparent 65%)' }} />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-next-border rounded-full mb-8 backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-next-purple-neon" />
            <span className="text-[10px] font-bold text-next-purple-light uppercase tracking-widest">Plataforma Dental AI-First</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight leading-[1.05] mb-6 max-w-3xl mx-auto">
            Mais que um sistema. Uma equipe completa de inteligência trabalhando para o{' '}
            <span className="next-brand-gradient-text">crescimento da sua clínica</span>.
          </h1>
          <p className="text-slate-400 text-base sm:text-lg font-medium max-w-xl mx-auto mb-10">
            Gestão inteligente, sorrisos radiantes. A ELIZA organiza a rotina, conecta pacientes e transforma dados reais em decisões — com IA nativa em cada tela.
          </p>

          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleStart}
              disabled={isStarting}
              className="inline-flex items-center gap-2 px-7 py-4 next-brand-gradient-bg text-white font-bold text-sm rounded-2xl shadow-next-glow-purple-strong hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {isStarting ? 'Abrindo...' : 'Começar agora'}
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[10.5px] text-slate-500">Entre com sua conta Google — sem cartão de crédito, cadastro em segundos.</p>
            {startError && <p className="text-[11px] text-next-red-alert mt-1">{startError}</p>}
          </div>
        </div>
      </div>

      {/* FEATURES */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="next-glass-panel rounded-next-2xl p-6 text-center">
              <div className="w-12 h-12 rounded-2xl next-brand-gradient-bg flex items-center justify-center text-white mx-auto mb-4 shadow-next-glow-purple">
                <f.icon className="w-5 h-5" />
              </div>
              <p className="text-sm font-black text-white uppercase tracking-tight">{f.title}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FOUNDERS / CTA */}
      <div className="max-w-4xl mx-auto px-6 pb-24">
        <div className="next-glass-panel rounded-next-2xl p-8 sm:p-12 text-center relative overflow-hidden">
          <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 70%)' }} />
          <div className="relative z-10">
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
              Contrate a <span className="next-brand-gradient-text">ELIZA</span>.
            </h2>
            <p className="text-slate-400 text-sm font-medium mb-8">Escolha quem vai trabalhar na sua clínica.</p>

            <div className="inline-flex items-center gap-2 px-4 py-2 bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-full mb-6">
              <span className="text-[10px] font-black text-next-purple-light uppercase tracking-widest">Programa das 150 Clínicas Fundadoras</span>
            </div>

            <div className="space-y-2.5 max-w-sm mx-auto mb-8 text-left">
              {FOUNDER_BENEFITS.map((b) => (
                <div key={b} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-next-green-success flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-slate-300 font-medium">{b}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleStart}
              disabled={isStarting}
              className="inline-flex items-center gap-2 px-7 py-4 next-brand-gradient-bg text-white font-bold text-sm rounded-2xl shadow-next-glow-purple disabled:opacity-60"
            >
              {isStarting ? 'Abrindo...' : 'Quero minha clínica fundadora'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="max-w-6xl mx-auto px-6 pb-12 flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2 text-slate-500">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Segurança de Nível Bancário</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-center justify-center text-[9px] font-black uppercase tracking-widest text-slate-500">
          <span>Já tem conta? <Link to="/login" className="text-next-purple-light hover:underline">Entrar</Link></span>
          <span className="text-slate-700 font-normal select-none">•</span>
          <Link to="/company" className="hover:text-slate-300 transition-colors">Informações da Empresa</Link>
          <span className="text-slate-700 font-normal select-none">•</span>
          <Link to="/privacy" className="hover:text-slate-300 transition-colors">Política de Privacidade</Link>
          <span className="text-slate-700 font-normal select-none">•</span>
          <Link to="/terms" className="hover:text-slate-300 transition-colors">Termos de Uso</Link>
        </div>
      </div>
    </div>
  );
}
