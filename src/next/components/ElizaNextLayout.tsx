import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Lock,
  ArrowRight,
  CheckCircle2,
  Calendar,
  Sparkles,
  Info,
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
  GraduationCap,
  BookUser,
  ShieldAlert,
  Smartphone,
  LogOut,
  Sun,
  Moon,
  Bell,
  ChevronDown,
  Star
} from 'lucide-react';
import { doc as fsDoc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NextReadOnlyProvider } from '../context/NextReadOnlyContext';
import { ElizaAssistantProvider } from '../context/ElizaAssistantContext';
import ElizaLoadingScreen from '../../components/ElizaLoadingScreen';
import NextElizaAssistant from './NextElizaAssistant';
import InstallElizaButton from '../../pwa/InstallElizaButton';
import NextHome from './NextHome';
import NextAgenda from './NextAgenda';
import NextMedicalRecord from './NextMedicalRecord';
import NextPortalActivity from './NextPortalActivity';
import NextFinancial from './NextFinancial';
import NextPlanningAI from './NextPlanningAI';
import type { ProcedureCategory } from '../../lib/procedureTaxonomy';
import { getPlanCapabilities, type PlanRole } from '../../lib/planCapabilities';
import NextWhatsApp from './NextWhatsApp';
import NextAICore from './NextAICore';
import NextDashboard from './NextDashboard';
import NextAdmin, { type AdminTab } from './NextAdmin';
import NextAcademy from './NextAcademy';
import NextStudentPortal from './NextStudentPortal';
import StudentChangePasswordGate from './StudentChangePasswordGate';
import NextAuditViewer from './NextAuditViewer';
import NextRoadmap from './NextRoadmap';
import NextDesignSystemDocs from './NextDesignSystemDocs';
import NextQADashboard from './NextQADashboard';
import NextCommercialDemo from './NextCommercialDemo';
import NextReports from './NextReports';
import NextInventory from './NextInventory';

const TAB_LABELS: Record<string, string> = {
  home: 'Eliza Consciência',
  eliza: 'Assistente Central',
  agenda: 'Agenda Inteligente',
  prontuario: 'Prontuário Vivo',
  portalActivity: 'Portal do Paciente',
  taskCenter: 'Central de Tarefas',
  financeiro: 'Financeiro Inteligente',
  facialPlanning: 'Planejamento IA',
  whatsapp: 'Comunicação IA',
  reports: 'Relatórios',
  inventory: 'Estoque',
  admin: 'Painel Admin',
  academy: 'Eliza Academy',
  dashboard: 'Painel Arquitetura',
  audit: 'Audit Trail (Logs)',
  designSystem: 'Design System Docs',
  roadmap: 'Sprints & Roadmap',
  qa: 'Demo & QA Clínico',
  demo: 'Demo Comercial',
};

function ElizaNextContent() {
  const { user, profile, clinic, loading, supportMode, exitSupportMode, logout, isPlatformAdmin: isPlatformAdminUser } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const navigate = useNavigate();
  // Light/dark toggle — scoped to the Eliza Next workspace only (public
  // pages, login, checkout stay dark-only by design). [data-theme="light"]
  // on the root element below is what flips it; see index.css for the
  // actual color overrides.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem('eliza_next_theme') as 'dark' | 'light') || 'light';
  });
  useEffect(() => {
    localStorage.setItem('eliza_next_theme', theme);
  }, [theme]);
  // Deep-link support: a URL like /next?tab=prontuario&patientId=xxx opens
  // straight into that patient's record — used by the "abrir em nova aba"
  // button on Agenda appointment cards so it can window.open() a real link
  // instead of only being able to jump tabs within the same browser tab.
  const [searchParams] = useSearchParams();
  const deepLinkTab = searchParams.get('tab');
  const deepLinkPatientId = searchParams.get('patientId');
  const VALID_TABS = ['home', 'eliza', 'agenda', 'prontuario', 'portalActivity', 'taskCenter', 'financeiro', 'facialPlanning', 'whatsapp', 'reports', 'inventory', 'admin', 'academy', 'studentPortal', 'dashboard', 'audit', 'designSystem', 'roadmap', 'qa', 'demo'];
  const [activeTab, setActiveTab] = useState<'home' | 'eliza' | 'agenda' | 'prontuario' | 'portalActivity' | 'taskCenter' | 'financeiro' | 'facialPlanning' | 'whatsapp' | 'reports' | 'inventory' | 'admin' | 'academy' | 'studentPortal' | 'dashboard' | 'audit' | 'designSystem' | 'roadmap' | 'qa' | 'demo'>(
    (deepLinkTab && VALID_TABS.includes(deepLinkTab) ? deepLinkTab : 'home') as any
  );

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Atalho do estado vazio do catálogo de procedimentos (Planejamento IA) —
  // "Nenhum procedimento cadastrado" agora tem um botão que já leva pra
  // Admin → Catálogo, aba Procedimentos, em vez de só um texto avisando.
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab | undefined>(undefined);
  const openAdminProcedureCatalog = () => { setAdminInitialTab('catalogo'); setActiveTab('admin'); };

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

  // Badge count for the "Portal do Paciente" nav item — same pending_items
  // this session's activity screen (NextPortalActivity.tsx) lists in full.
  const [portalPendingCount, setPortalPendingCount] = useState(0);
  useEffect(() => {
    if (!clinic?.id) { setPortalPendingCount(0); return; }
    const q = query(
      collection(db, 'clinics', clinic.id, 'pending_items'),
      where('source', '==', 'Portal do Paciente'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(q, (snap) => setPortalPendingCount(snap.size), () => setPortalPendingCount(0));
    return () => unsub();
  }, [clinic?.id]);

  const isAdminUser = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;
  // Topbar identity cluster label — real fields only (isPlatformAdmin/role),
  // never a placeholder job title.
  const userRoleLabel = isPlatformAdminUser ? 'Super Admin' : profile?.role === 'owner' ? 'Proprietário(a)' : profile?.role === 'admin' ? 'Administrador(a)' : 'Profissional';
  const canSee = (flag: string) => isAdminUser || myMember?.[flag] !== false;
  // "Contrate a ELIZA": which modality the clinic bought, layered on top of
  // (not instead of) the existing per-member permission flags above — a
  // feature only shows if BOTH the member has the flag AND the clinic's
  // modality includes it. clinic.planRole is unset for every clinic created
  // before this system existed; getPlanCapabilities() defaults those to
  // 'manager' (today's full feature set) so nobody already using Financeiro/
  // Relatórios/etc. loses access on rollout. UI-level enforcement only — see
  // src/lib/planCapabilities.ts for why, and for which capabilities are real
  // vs. still just labels.
  const clinicCapabilities = getPlanCapabilities(clinic?.planRole as PlanRole | undefined);
  const showFinanceiro = canSee('accessFinancial') && clinicCapabilities.financial;
  const showEstoque = canSee('accessInventory');
  const showRelatorios = canSee('accessReports') && clinicCapabilities.analytics;
  const showWhatsapp = clinicCapabilities.whatsapp;
  const showPlanejamentoIA = clinicCapabilities.clinicalAI;
  const showPainelAdmin = isAdminUser || myMember?.accessSettings === true;
  const showAcademy = !!clinic?.academyEnabled && (isAdminUser || myMember?.accessCourses === true);
  // Dual role (Clinic + Academy): a staff member who is ALSO an Academy
  // student (see CEREBRO decision + AuthContext.tsx's syncProfile()) keeps
  // the full operational shell and gets this single extra nav entry into
  // their own student experience (NextStudentPortal) — reusing the existing
  // tab system, not a new Clinic↔Academy mode selector (that's future work).
  // This is a DIFFERENT screen from showAcademy above (professor/admin course
  // management) — it's the student's own view of their own enrollment.
  const showMeuPortalAcademico = profile?.hasEducationAccess === true;

  // Cross-tab handoff: "Agendar" on a patient card jumps to the Agenda tab
  // and pre-fills the new-appointment form with that patient's name.
  const [prefillPatientName, setPrefillPatientName] = useState<string | null>(null);
  const handleScheduleForPatient = (name: string) => {
    setPrefillPatientName(name);
    setActiveTab('agenda');
  };

  // Cross-tab handoff: "Prontuário" on a patient card jumps to the Prontuário
  // Vivo tab with that specific patient already selected.
  const [prefillRecordPatientId, setPrefillRecordPatientId] = useState<string | null>(deepLinkTab === 'prontuario' ? deepLinkPatientId : null);
  const handleOpenRecord = (patientId: string) => {
    setPrefillRecordPatientId(patientId);
    setActiveTab('prontuario');
  };

  // Cross-tab handoff: "Gerar orçamento a partir deste planejamento" in
  // Planejamento IA jumps to Prontuário → Orçamento, patient already
  // selected and the quotation form pre-filled with the plan's data.
  const [prefillQuotationDraft, setPrefillQuotationDraft] = useState<{ title: string; items: { description: string; value: number; quantity: number; procedureCategory?: ProcedureCategory | null }[]; notes?: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string } } | null>(null);
  const handleGenerateQuotation = (payload: { patientId: string; title: string; items: { description: string; value: number; quantity: number; procedureCategory?: ProcedureCategory | null }[]; notes?: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string } }) => {
    setPrefillRecordPatientId(payload.patientId);
    setPrefillQuotationDraft({ title: payload.title, items: payload.items, notes: payload.notes, clinicalPlanRef: payload.clinicalPlanRef });
    setActiveTab('prontuario');
  };

  // Cross-tab handoff: "Agendar procedimento planejado" in Planejamento IA
  // jumps to Agenda, new-appointment form pre-filled with the patient +
  // procedure name + the plan reference — never marks the plan as executed.
  const [prefillScheduleTreatment, setPrefillScheduleTreatment] = useState<string | null>(null);
  const [prefillScheduleClinicalPlanRef, setPrefillScheduleClinicalPlanRef] = useState<{ planningId: string; versionId: string; procedureId: string } | null>(null);
  const handleSchedulePlanned = (payload: { patientName: string; treatment: string; clinicalPlanRef: { planningId: string; versionId: string; procedureId: string } }) => {
    setPrefillPatientName(payload.patientName);
    setPrefillScheduleTreatment(payload.treatment);
    setPrefillScheduleClinicalPlanRef(payload.clinicalPlanRef);
    setActiveTab('agenda');
  };

  if (loading) {
    return <ElizaLoadingScreen message="Carregando Eliza Next 2.0..." />;
  }

  // Authentication & Authorization check
  if (!user) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6" style={{ background: 'var(--color-next-bg-deep)' }}>
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

  return (
    <div
      data-theme={theme}
      className="fixed inset-0 h-dvh overflow-hidden text-slate-100 font-sans flex flex-col md:flex-row"
      style={{ background: 'var(--color-next-bg-deep)', height: 'var(--app-vh, 100dvh)', ...(supportMode.active ? { paddingTop: 'calc(2.5rem + env(safe-area-inset-top))' } : {}) }}
    >

      {/* Support Mode Banner — visible confirmation + escape hatch while a
          platform admin is viewing another clinic's real data in Next. */}
      {supportMode.active && (
        <div
          className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-slate-950 px-4 md:px-8 py-2 flex items-center justify-between shadow-lg"
          style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest leading-none">Modo Suporte Ativo</p>
              <p className="text-[9px] font-bold opacity-80 uppercase mt-0.5 truncate">Visualizando clínica: {supportMode.clinicData?.name}</p>
            </div>
          </div>
          <button
            onClick={() => { exitSupportMode(); navigate('/admin'); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 text-amber-400 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-slate-900 transition-colors flex-shrink-0"
          >
            Encerrar <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Isolated Workspace Sidebar. On mobile, when the menu is open, this
          becomes a real full-screen overlay (fixed + a definite height) —
          in normal flow (the desktop sidebar's setup) a flex column has no
          bounded height on mobile, so the inner overflow-y-auto nav below
          had nothing to actually clip against and just got cut off by the
          root's overflow-hidden with no way to scroll to the rest of it. */}
      <aside className={`eliza-sidebar-shell eliza-sidebar-bg w-full md:w-64 md:static md:h-auto bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col flex-shrink-0 ${isMobileMenuOpen ? 'fixed inset-0 z-40' : ''}`} style={isMobileMenuOpen ? { height: 'var(--app-vh, 100dvh)' } : undefined}>

        {/* Brand / Isolated Indicator */}
        <div
          className="p-4 md:p-6 border-b border-slate-800 flex flex-col gap-2"
          style={!supportMode.active ? { paddingTop: 'calc(1rem + env(safe-area-inset-top))' } : undefined}
        >
          {/* Light/dark toggle — top-left, above the logo, always visible */}
          <div className="eliza-theme-toggle flex items-center gap-1 self-start bg-slate-800/50 border border-slate-700/50 rounded-full p-1">
            <button
              onClick={() => setTheme('dark')}
              aria-label="Tema escuro"
              title="Tema escuro"
              className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'eliza-theme-toggle-active bg-next-purple-neon text-white shadow-next-glow-purple' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Moon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setTheme('light')}
              aria-label="Tema claro"
              title="Tema claro"
              className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'eliza-theme-toggle-active bg-next-purple-neon text-white shadow-next-glow-purple' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Sun className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <img src="/brand/eliza-wordmark-clean.png" alt="ELIZA" className="eliza-sidebar-logo h-16 w-auto object-contain" />
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
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'home'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Bot className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Eliza Consciência</span>
            </button>

            <button
              onClick={() => { setActiveTab('eliza'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'eliza'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Sparkles className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Assistente Central</span>
            </button>

            <button
              onClick={() => { setActiveTab('agenda'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'agenda'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Calendar className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Agenda Inteligente</span>
            </button>

            <button
              onClick={() => { setActiveTab('prontuario'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'prontuario'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <HeartPulse className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Prontuário Vivo</span>
            </button>

            <button
              onClick={() => { setActiveTab('portalActivity'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'portalActivity'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <span className="flex items-center gap-3">
                <Smartphone className="w-4 h-4 text-next-purple-neon" />
                <span className="font-semibold text-slate-200">Portal do Paciente</span>
              </span>
              {portalPendingCount > 0 && (
                <span className="text-[10px] font-black bg-next-purple-neon/20 text-next-purple-light rounded-full px-2 py-0.5 flex-shrink-0">{portalPendingCount}</span>
              )}
            </button>

            <button
              onClick={() => { setActiveTab('taskCenter'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'taskCenter'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <ClipboardList className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Central de Tarefas</span>
            </button>

            {showFinanceiro && (
            <button
              onClick={() => { setActiveTab('financeiro'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'financeiro'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Briefcase className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Financeiro Inteligente</span>
            </button>
            )}

            {showPlanejamentoIA && (
            <button
              onClick={() => { setActiveTab('facialPlanning'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'facialPlanning'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Brain className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Planejamento IA</span>
            </button>
            )}

            {showWhatsapp && (
            <button
              onClick={() => { setActiveTab('whatsapp'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'whatsapp'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <MessageSquare className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Comunicação IA</span>
            </button>
            )}

            {showRelatorios && (
            <button
              onClick={() => { setActiveTab('reports'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'reports'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
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
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'inventory'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
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
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'academy'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <GraduationCap className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Eliza Academy</span>
            </button>
            )}

            {showMeuPortalAcademico && (
            <button
              onClick={() => { setActiveTab('studentPortal'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'studentPortal'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <BookUser className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Meu Portal do Aluno</span>
            </button>
            )}

            {showPainelAdmin && (
            <button
              onClick={() => { setActiveTab('admin'); setIsMobileMenuOpen(false); }}
              className={`eliza-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                activeTab === 'admin'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-next-purple-neon shadow-next-glow-purple eliza-nav-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/45'
              }`}
              style={{ minHeight: '44px' }}
            >
              <Settings2 className="w-4 h-4 text-next-purple-neon" />
              <span className="font-semibold text-slate-200">Painel Admin</span>
            </button>
            )}

          </nav>

          <div className="px-4 pb-3">
            <div className="eliza-consciousness-card rounded-2xl p-4 next-brand-gradient-bg text-white flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                <Star className="w-4 h-4 fill-white" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black">Eliza 2.9</p>
                <p className="text-[10.5px] leading-snug opacity-90 mt-0.5">Inteligência que transforma gestão em consciência.</p>
              </div>
            </div>
          </div>

          <div className="px-4 pb-2">
            <InstallElizaButton variant="full" className="w-full justify-center inline-flex items-center gap-2 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-3 py-2.5 rounded-xl hover:bg-next-purple-neon/25 transition-colors" />
          </div>

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
            <button
              onClick={async () => {
                // Logging out alone leaves the user stranded on /next, whose
                // own !user guard shows a dead-end "Acesso Restrito" screen
                // instead of the public landing/login — navigate away
                // explicitly so logout actually exits the app.
                await logout();
                navigate('/', { replace: true });
              }}
              title="Sair"
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Sandbox Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">

        {/* Top bar — shows which screen is open instead of the old "Voltar
            ao Legado" link (removed; the sidebar nav is the only way to
            move around now). */}
        <header className="eliza-topbar h-16 border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0 bg-slate-900/40 backdrop-blur-md">
          <h2 className="text-sm font-bold text-slate-200">{TAB_LABELS[activeTab] || ''}</h2>

          <div className="flex items-center gap-4">
            {/* Real signal, not decorative — same pending Portal count the
                nav badge already shows. */}
            <button
              onClick={() => { setActiveTab('portalActivity'); setIsMobileMenuOpen(false); }}
              title="Notificações do Portal do Paciente"
              className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/45 transition-colors"
            >
              <Bell className="w-4.5 h-4.5" />
              {portalPendingCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-next-purple-neon" />
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(v => !v)}
                className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-xl hover:bg-slate-800/45 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300 overflow-hidden flex-shrink-0">
                  {profile?.photoURL ? (
                    <img src={profile.photoURL} alt={profile.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    profile?.name?.substring(0, 2).toUpperCase() || 'US'
                  )}
                </div>
                <div className="hidden sm:block text-left leading-tight">
                  <p className="text-xs font-bold text-slate-100">{profile?.name || 'Profissional'}</p>
                  <p className="text-[10px] text-slate-500">{userRoleLabel}</p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isUserMenuOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" onClick={() => setIsUserMenuOpen(false)} aria-label="Fechar menu" />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-3.5 py-3 border-b border-slate-800">
                      <p className="text-xs font-bold text-slate-200 truncate">{profile?.name || 'Profissional'}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{clinic?.name || 'Clínica Principal'}</p>
                    </div>
                    <button
                      onClick={async () => { setIsUserMenuOpen(false); await logout(); navigate('/', { replace: true }); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Sair
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Active view component render */}
        <div className="eliza-main flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            {activeTab === 'home' && <NextHome />}
            {activeTab === 'eliza' && <NextAICore />}
            {activeTab === 'agenda' && <NextAgenda prefillPatientName={prefillPatientName} onPrefillConsumed={() => { setPrefillPatientName(null); setPrefillScheduleTreatment(null); setPrefillScheduleClinicalPlanRef(null); }} onOpenRecord={handleOpenRecord} prefillTreatment={prefillScheduleTreatment} prefillClinicalPlanRef={prefillScheduleClinicalPlanRef} />}
            {activeTab === 'prontuario' && <NextMedicalRecord prefillPatientId={prefillRecordPatientId} onPrefillConsumed={() => setPrefillRecordPatientId(null)} onScheduleForPatient={handleScheduleForPatient} prefillQuotationDraft={prefillQuotationDraft} onQuotationDraftConsumed={() => setPrefillQuotationDraft(null)} onSchedulePlanned={handleSchedulePlanned} />}
            {activeTab === 'portalActivity' && <NextPortalActivity onOpenRecord={handleOpenRecord} />}
            {activeTab === 'taskCenter' && <NextPortalActivity scope="all" onOpenRecord={handleOpenRecord} />}
            {activeTab === 'financeiro' && <NextFinancial />}
            {activeTab === 'facialPlanning' && <NextPlanningAI onOpenRecord={handleOpenRecord} onGenerateQuotation={handleGenerateQuotation} onSchedulePlanned={handleSchedulePlanned} onOpenProcedureCatalog={openAdminProcedureCatalog} />}
            {activeTab === 'whatsapp' && <NextWhatsApp />}
            {activeTab === 'reports' && <NextReports />}
            {activeTab === 'inventory' && <NextInventory />}
            {activeTab === 'admin' && <NextAdmin initialTab={adminInitialTab} />}
            {activeTab === 'academy' && <NextAcademy />}
            {activeTab === 'studentPortal' && showMeuPortalAcademico && <NextStudentPortal />}
            {activeTab === 'dashboard' && <NextDashboard />}
            {activeTab === 'audit' && <NextAuditViewer />}
            {activeTab === 'designSystem' && <NextDesignSystemDocs />}
            {activeTab === 'roadmap' && <NextRoadmap />}
            {activeTab === 'qa' && <NextQADashboard />}
            {activeTab === 'demo' && <NextCommercialDemo />}
          </motion.div>
        </div>
      </main>

      <NextElizaAssistant activeTab={activeTab} />
    </div>
  );
}

export default function ElizaNextLayout() {
  const { profile, logout } = useAuth();
  const isStudentRole = profile?.role === 'aluno' || profile?.role === 'student' || (profile as any)?.userType === 'education_student';

  // Achado: temporary password set by the professor at account creation —
  // mustChangePassword was written but never enforced anywhere. Checked
  // HERE, above NextReadOnlyProvider/ElizaAssistantProvider, so their
  // onSnapshot listeners (pending_items, portal notifications) never mount
  // at all while this gate is showing — mounting them concurrently with
  // updatePassword()'s auth token refresh reproducibly crashed the
  // Firestore SDK ("INTERNAL ASSERTION FAILED: Unexpected state") when the
  // gate was rendered from inside the provider tree instead.
  if (isStudentRole && (profile as any)?.mustChangePassword) {
    return <StudentChangePasswordGate onDone={() => { /* profile re-syncs itself via refreshProfile() inside changeStudentPassword */ }} />;
  }

  // Dedicated minimal shell for students — never the admin dashboard, and
  // deliberately never wrapped in ElizaAssistantProvider: that provider's
  // listeners read pending_items/action_proposals, staff-only collections
  // per firestore.rules. A student hitting permission-denied on those
  // listeners repeatedly crashed the Firestore SDK itself ("INTERNAL
  // ASSERTION FAILED"), not just a rejected promise — so the fix is to
  // never mount them for a student session, not to catch the error.
  if (isStudentRole) {
    // NextReadOnlyProvider IS still needed here (NextStudentPortal depends
    // on useNextReadOnly()) — only ElizaAssistantProvider is skipped.
    return (
      <NextReadOnlyProvider>
        <div className="fixed inset-0 h-dvh overflow-hidden text-slate-100 font-sans flex flex-col" style={{ background: 'var(--color-next-bg-deep)', height: 'var(--app-vh, 100dvh)' }}>
          <header
            className="border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0 bg-slate-900/40 backdrop-blur-md"
            style={{ height: 'calc(4rem + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
          >
            <img src="/brand/eliza-wordmark-clean.png" alt="ELIZA" className="h-10 w-auto object-contain" />
            <button onClick={() => logout()} className="text-xs font-semibold px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700/60 transition-all">
              Sair
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
            <NextStudentPortal />
          </div>
        </div>
      </NextReadOnlyProvider>
    );
  }

  return (
    <NextReadOnlyProvider>
      <ElizaAssistantProvider>
        <ElizaNextContent />
      </ElizaAssistantProvider>
    </NextReadOnlyProvider>
  );
}
