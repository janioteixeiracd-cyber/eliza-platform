import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Terminal,
  Layers,
  AlertTriangle,
  Lock,
  ArrowRight,
  CheckCircle2,
  Calendar,
  Sparkles,
  Info,
  Palette,
  Home,
  Bot,
  HeartPulse,
  Briefcase,
  MessageSquare,
  Menu,
  X,
  ClipboardList,
  Brain,
  BarChart3,
  Boxes,
  Settings2,
  GraduationCap
} from 'lucide-react';
import { doc as fsDoc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NextReadOnlyProvider } from '../context/NextReadOnlyContext';
import NextHome from './NextHome';
import NextAgenda from './NextAgenda';
import NextMedicalRecord from './NextMedicalRecord';
import NextFinancial from './NextFinancial';
import NextFacialPlanning from './NextFacialPlanning';
import NextWhatsApp from './NextWhatsApp';
import NextAICore from './NextAICore';
import NextDashboard from './NextDashboard';
import NextAdmin from './NextAdmin';
import NextAcademy from './NextAcademy';
import NextStudentPortal from './NextStudentPortal';
import NextAuditViewer from './NextAuditViewer';
import NextRoadmap from './NextRoadmap';
import NextDesignSystemDocs from './NextDesignSystemDocs';
import NextQADashboard from './NextQADashboard';
import NextCommercialDemo from './NextCommercialDemo';
import NextReports from './NextReports';
import NextInventory from './NextInventory';

function ElizaNextContent() {
  const { user, profile, clinic, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'eliza' | 'agenda' | 'prontuario' | 'financeiro' | 'facialPlanning' | 'whatsapp' | 'reports' | 'inventory' | 'admin' | 'academy' | 'dashboard' | 'audit' | 'designSystem' | 'roadmap' | 'qa' | 'demo'>('home');

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Own membership doc — drives per-member nav visibility below. isAdmin
  // (owner or role admin/owner) always sees everything regardless of these
  // flags; a missing flag (member created before permissions existed) is
  // treated as allowed, same "!== false" convention used across the app.
  const [myMember, setMyMember] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    async function fetchMyMembership() {
      if (!clinic?.id || !user?.uid) { setMyMember(null); return; }
      try {
        const snap = await getDoc(fsDoc(db, 'clinics', clinic.id, 'members', user.uid));
        setMyMember(snap.exists() ? snap.data() : null);
      } catch (err) {
        console.warn('Failed to load own membership permissions:', err);
        setMyMember(null);
      }
    }
    fetchMyMembership();
  }, [clinic?.id, user?.uid]);

  const isAdminUser = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;
  const canSee = (flag: string) => isAdminUser || myMember?.[flag] !== false;
  const showFinanceiro = canSee('accessFinancial');
  const showEstoque = canSee('accessInventory');
  const showRelatorios = canSee('accessReports');
  const showPainelAdmin = isAdminUser || myMember?.accessSettings === true;
  const showAcademy = !!clinic?.academyEnabled && (isAdminUser || myMember?.accessCourses === true);
  // Internal dev/roadmap/QA/sales-demo screens — no clinical or operational
  // value to regular staff, so admin-only rather than a per-member flag.
  const showDevTools = isAdminUser;

  // Students never get the admin shell — same gate the legacy app uses
  // (AppLayout.tsx) to route a student login into a dedicated, minimal
  // portal instead of exposing Financeiro/Estoque/Painel Admin/etc.
  const isStudentRole = profile?.role === 'aluno' || profile?.role === 'student' || (profile as any)?.userType === 'education_student';

  // Cross-tab handoff: "Agendar" on a patient card jumps to the Agenda tab
  // and pre-fills the new-appointment form with that patient's name.
  const [prefillPatientName, setPrefillPatientName] = useState<string | null>(null);
  const handleScheduleForPatient = (name: string) => {
    setPrefillPatientName(name);
    setActiveTab('agenda');
  };

  // Cross-tab handoff: "Prontuário" on a patient card jumps to the Prontuário
  // Vivo tab with that specific patient already selected.
  const [prefillRecordPatientId, setPrefillRecordPatientId] = useState<string | null>(null);
  const handleOpenRecord = (patientId: string) => {
    setPrefillRecordPatientId(patientId);
    setActiveTab('prontuario');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-6">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mb-4"
        />
        <p className="text-slate-400 font-mono text-sm">Carregando ELIZA NEXT 2.0...</p>
      </div>
    );
  }

  // Authentication & Authorization check
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-xl"
        >
          <div className="w-16 h-16 bg-red-950/50 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6 text-red-400">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-semibold text-slate-100 mb-2 font-sans tracking-tight">Acesso Restrito</h2>
          <p className="text-slate-400 text-sm mb-6 font-sans leading-relaxed">
            Para acessar o ambiente isolado do <strong className="text-slate-200">ELIZA NEXT 2.0</strong>, você precisa estar autenticado na plataforma clínica principal.
          </p>
          <a 
            href="/" 
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-emerald-950/40"
          >
            Ir para Login Principal <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    );
  }

  // Dedicated minimal shell for students — never the admin sidebar. Mirrors
  // legacy AppLayout.tsx's isStudentRole gate, which restricts students to
  // only "Portal do Aluno" + account, nothing administrative.
  if (isStudentRole) {
    return (
      <div className="fixed inset-0 overflow-hidden bg-slate-950 text-slate-100 font-sans flex flex-col">
        <header className="h-16 border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0 bg-slate-900/40 backdrop-blur-md">
          <img src="/brand/eliza-wordmark-clean.png" alt="ELIZA" className="h-10 w-auto object-contain" />
          <a href="/" className="text-xs font-semibold px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700/60 transition-all">
            Sair
          </a>
        </header>
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <NextStudentPortal />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950 text-slate-100 font-sans flex flex-col md:flex-row">

      {/* Isolated Workspace Sidebar */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col flex-shrink-0">
        
        {/* Brand / Isolated Indicator */}
        <div className="p-4 md:p-6 border-b border-slate-800 flex flex-col gap-2">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <img src="/brand/eliza-wordmark-clean.png" alt="ELIZA" className="h-16 w-auto object-contain" />
            </div>

            {/* Mobile Menu Toggle Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-slate-200 transition-colors rounded-lg bg-slate-800/50 border border-slate-700/50"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5 text-next-purple-neon" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Container for Mobile Navigation & Footer */}
        <div className={`${isMobileMenuOpen ? 'flex' : 'hidden md:flex'} flex-col flex-1 overflow-y-auto custom-scrollbar`}>
          {/* Navigation Menu */}
          <nav className="flex-1 p-4 space-y-1">
            <button
              onClick={() => { setActiveTab('home'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'home' 
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Bot className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Eliza Consciência</span>
            </button>

            <button
              onClick={() => { setActiveTab('eliza'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'eliza' 
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Sparkles className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Assistente Central</span>
            </button>

            <button
              onClick={() => { setActiveTab('agenda'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'agenda' 
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Calendar className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Agenda Inteligente</span>
            </button>

            <button
              onClick={() => { setActiveTab('prontuario'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'prontuario' 
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <HeartPulse className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Prontuário Vivo</span>
            </button>

            {showFinanceiro && (
            <button
              onClick={() => { setActiveTab('financeiro'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'financeiro'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Briefcase className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Financeiro Inteligente</span>
            </button>
            )}

            <button
              onClick={() => { setActiveTab('facialPlanning'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'facialPlanning'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Brain className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Planejamento Facial</span>
            </button>

            <button
              onClick={() => { setActiveTab('whatsapp'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'whatsapp' 
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <MessageSquare className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Comunicação Inteligente</span>
            </button>

            {showRelatorios && (
            <button
              onClick={() => { setActiveTab('reports'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'reports'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <BarChart3 className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Relatórios</span>
            </button>
            )}

            {showEstoque && (
            <button
              onClick={() => { setActiveTab('inventory'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'inventory'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Boxes className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Estoque</span>
            </button>
            )}

            {showAcademy && (
            <button
              onClick={() => { setActiveTab('academy'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'academy'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <GraduationCap className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Eliza Academy</span>
            </button>
            )}

            {showPainelAdmin && (
            <button
              onClick={() => { setActiveTab('admin'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'admin'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Settings2 className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Painel Admin</span>
            </button>
            )}

            {showDevTools && (
            <div className="pt-2 mt-2 border-t border-slate-800/70">
              <p className="px-4 pb-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600">Ferramentas internas (admin)</p>

              <button
                onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  activeTab === 'dashboard'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
                }`}
                style={{ minHeight: '44px' }}
              >
                <Layers className="w-4 h-4" />
                <span>Painel Arquitetura</span>
              </button>

              <button
                onClick={() => { setActiveTab('audit'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  activeTab === 'audit'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
                }`}
                style={{ minHeight: '44px' }}
              >
                <Terminal className="w-4 h-4" />
                <span>Audit Trail (Logs)</span>
              </button>

              <button
                onClick={() => { setActiveTab('designSystem'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  activeTab === 'designSystem'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
                }`}
                style={{ minHeight: '44px' }}
              >
                <Palette className="w-4 h-4" />
                <span>Design System Docs</span>
              </button>

              <button
                onClick={() => { setActiveTab('roadmap'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  activeTab === 'roadmap'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
                }`}
                style={{ minHeight: '44px' }}
              >
                <Sparkles className="w-4 h-4" />
                <span>Sprints & Roadmap</span>
              </button>

              <button
                onClick={() => { setActiveTab('qa'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  activeTab === 'qa'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
                }`}
                style={{ minHeight: '44px' }}
              >
                <ClipboardList className="w-4 h-4" />
                <span>Demo & QA Clínico</span>
                <span className="text-[9px] font-mono font-bold bg-slate-800 text-slate-400 px-1 rounded">S11</span>
              </button>

              <button
                onClick={() => { setActiveTab('demo'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  activeTab === 'demo'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
                }`}
                style={{ minHeight: '44px' }}
              >
                <Sparkles className="w-4 h-4 text-next-purple-neon animate-pulse" />
                <span className="font-semibold text-slate-200">Demo Comercial</span>
                <span className="text-[9px] font-mono font-bold bg-next-purple-neon/20 text-next-purple-light px-1 rounded">S12</span>
              </button>
            </div>
            )}
          </nav>

          {/* User context footer */}
          <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300 overflow-hidden">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt={profile.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                profile?.name?.substring(0, 2).toUpperCase() || 'US'
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200 truncate">{profile?.name || 'Profissional'}</p>
              <p className="text-[10px] text-slate-500 font-mono truncate">{clinic?.name || 'Clínica Principal'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Sandbox Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
        
        {/* Top bar */}
        <header className="h-16 border-b border-slate-800 px-6 flex items-center justify-end flex-shrink-0 bg-slate-900/40 backdrop-blur-md">
          <a
            href="/"
            className="text-xs font-semibold px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700/60 transition-all"
          >
            Voltar ao Legado
          </a>
        </header>

        {/* Active view component render */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            {activeTab === 'home' && <NextHome />}
            {activeTab === 'eliza' && <NextAICore />}
            {activeTab === 'agenda' && <NextAgenda prefillPatientName={prefillPatientName} onPrefillConsumed={() => setPrefillPatientName(null)} onOpenRecord={handleOpenRecord} />}
            {activeTab === 'prontuario' && <NextMedicalRecord prefillPatientId={prefillRecordPatientId} onPrefillConsumed={() => setPrefillRecordPatientId(null)} onScheduleForPatient={handleScheduleForPatient} />}
            {activeTab === 'financeiro' && <NextFinancial />}
            {activeTab === 'facialPlanning' && <NextFacialPlanning />}
            {activeTab === 'whatsapp' && <NextWhatsApp />}
            {activeTab === 'reports' && <NextReports />}
            {activeTab === 'inventory' && <NextInventory />}
            {activeTab === 'admin' && <NextAdmin />}
            {activeTab === 'academy' && <NextAcademy />}
            {activeTab === 'dashboard' && <NextDashboard />}
            {activeTab === 'audit' && <NextAuditViewer />}
            {activeTab === 'designSystem' && <NextDesignSystemDocs />}
            {activeTab === 'roadmap' && <NextRoadmap />}
            {activeTab === 'qa' && <NextQADashboard />}
            {activeTab === 'demo' && <NextCommercialDemo />}
          </motion.div>
        </div>
      </main>
    </div>
  );
}

export default function ElizaNextLayout() {
  return (
    <NextReadOnlyProvider>
      <ElizaNextContent />
    </NextReadOnlyProvider>
  );
}
