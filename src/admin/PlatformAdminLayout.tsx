import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart3,
  Users,
  Building2,
  CreditCard,
  ShieldAlert,
  Settings,
  LogOut,
  Activity,
  Database,
  ArrowRight,
  Eye,
  X,
  Menu,
  Cpu,
  Zap,
  KeyRound
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAdmin } from '../contexts/AdminContext';
import { useNavigate } from 'react-router-dom';
import AdminDashboard from './components/AdminDashboard';
import ClinicsManagement from './components/ClinicsManagement';
import PlatformUsers from './components/PlatformUsers';
import PlatformFinance from './components/PlatformFinance';
import PlatformIntegrations from './components/PlatformIntegrations';
import PlatformAiUsage from './components/PlatformAiUsage';
import PlatformLogs from './components/PlatformLogs';
import PlatformSupport from './components/PlatformSupport';
import PlatformAccessManagement from './components/PlatformAccessManagement';

export default function PlatformAdminLayout() {
  const { platformRole, logout } = useAuth();
  const { supportMode, exitSupportMode, checkSystemHealth } = useAdmin();
  const [activeView, setActiveView] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const [health, setHealth] = useState<{ ok: boolean; latencyMs?: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const runCheck = async () => {
      const result = await checkSystemHealth();
      if (!cancelled) setHealth(result);
    };
    runCheck();
    const interval = setInterval(runCheck, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const menuItems = [
    { id: 'dashboard', label: 'Master Overview', icon: BarChart3 },
    { id: 'clinics', label: 'Clínicas', icon: Building2 },
    { id: 'users', label: 'Usuários', icon: Users },
    { id: 'access', label: 'Acessos', icon: KeyRound },
    { id: 'finance', label: 'Assinaturas', icon: CreditCard },
    { id: 'integrations', label: 'Integrações', icon: Zap },
    { id: 'ai', label: 'Uso de IA', icon: Cpu },
    { id: 'logs', label: 'Logs da Plataforma', icon: Database },
    { id: 'support', label: 'Suporte', icon: ShieldAlert }
  ];

  const currentLabel = menuItems.find((m) => m.id === activeView)?.label || 'Master Overview';

  return (
    <div
      className={`fixed inset-0 h-dvh overflow-hidden bg-slate-50 font-sans text-slate-800 flex flex-col md:flex-row ${supportMode.active ? 'pt-10 md:pt-12' : ''}`}
      style={{ height: 'var(--app-vh, 100dvh)' }}
    >
      {/* Support Mode Overlay Banner */}
      {supportMode.active && (
        <div
          className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white px-4 md:px-8 py-2 flex items-center justify-between shadow-2xl"
          style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
        >
           <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                 <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                 <p className="text-[10px] font-black uppercase tracking-widest leading-none">Modo Suporte Ativo</p>
                 <p className="text-[9px] font-bold opacity-80 uppercase mt-0.5 truncate">Visualizando Clínica: <span className="underline">{supportMode.clinicData?.name}</span></p>
              </div>
           </div>
           <button
             onClick={exitSupportMode}
             className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-1.5 bg-white text-amber-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-amber-50 transition-colors flex-shrink-0"
           >
              Encerrar <X className="w-3 h-3" />
           </button>
        </div>
      )}

      {/* Admin Sidebar — collapsible on mobile, permanent on desktop */}
      <aside className="w-full md:w-72 bg-slate-900 text-white flex flex-col flex-shrink-0 border-b md:border-b-0 md:border-r border-white/5">
        <div
          className="px-5 md:px-10 py-4 md:py-0 md:h-24 flex items-center justify-between gap-4 border-b border-white/5"
          style={{ paddingTop: !supportMode.active ? 'calc(1rem + env(safe-area-inset-top))' : undefined }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img src="/brand/eliza-wordmark-light.png" alt="Eliza" className="h-8 md:h-9 w-auto object-contain flex-shrink-0" />
            <p className="text-[9px] text-teal-400 font-black uppercase tracking-widest truncate">Global Admin</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen((v) => !v)}
            className="md:hidden p-2 text-slate-400 hover:text-white transition-colors rounded-lg bg-white/5 border border-white/10 flex-shrink-0"
            aria-label="Menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5 text-teal-400" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <div className={`${isMobileMenuOpen ? 'flex' : 'hidden md:flex'} flex-col flex-1 overflow-y-auto custom-scrollbar`}>
          <nav className="flex-1 p-4 md:p-8 space-y-1.5 md:space-y-2">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => { setActiveView(item.id); setIsMobileMenuOpen(false); }}
                className={`
                  w-full flex items-center gap-4 px-4 md:px-5 py-3.5 md:py-4 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest
                  ${activeView === item.id
                    ? 'bg-white text-slate-900 shadow-xl shadow-black/20'
                    : 'text-slate-500 hover:bg-white/5 hover:text-white'}
                `}
                style={{ minHeight: '44px' }}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>

          <div
            className="p-4 md:p-8 border-t border-white/5 space-y-4 md:space-y-6 flex-shrink-0"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center gap-4 px-2">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center font-black text-teal-400 uppercase text-xs border border-white/10 shadow-inner flex-shrink-0">
                {platformRole?.[0] || 'A'}
              </div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black uppercase tracking-widest text-white truncate">Administrador</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter truncate">{platformRole}</p>
              </div>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => navigate('/')}
                className="w-full flex items-center justify-between px-5 md:px-6 py-3.5 md:py-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-white/10 transition-all group"
              >
                <span>Ir para App Cliente</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform flex-shrink-0" />
              </button>
              <button
                 onClick={() => {
                    logout();
                    navigate('/');
                 }}
                 className="w-full flex items-center justify-center gap-3 px-5 md:px-6 py-3.5 md:py-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-rose-400 hover:bg-rose-500/10 transition-all"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Admin Area */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 md:h-24 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-10 flex-shrink-0 gap-3">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
             <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${health === null ? 'bg-slate-300' : health.ok ? 'bg-emerald-500 animate-ping' : 'bg-rose-500 animate-ping'}`}></div>
             <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">
               <span className="md:hidden">{currentLabel}</span>
               <span className="hidden md:inline">{health === null ? 'Verificando infraestrutura...' : health.ok ? 'Backend e Firestore respondendo' : 'Backend indisponível'}</span>
             </span>
          </div>
          <div className="flex items-center gap-4 md:gap-8 flex-shrink-0">
             <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">Health Check Global</span>
                <span className={`text-[9px] font-bold uppercase tracking-tighter ${health?.ok ? 'text-emerald-600' : health === null ? 'text-slate-400' : 'text-rose-600'}`}>
                  {health === null ? 'Consultando /api/health...' : health.ok ? `OK — ${health.latencyMs}ms` : 'Falha na checagem'}
                </span>
             </div>
             <div className="hidden md:block w-px h-8 bg-slate-100"></div>
             <button className="relative p-2 text-slate-400 hover:text-slate-900 transition-colors">
                <Activity className="w-5 h-5" />
                {health && !health.ok && <span className="absolute top-0 right-0 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>}
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/50">
          <AnimatePresence mode="wait">
             {supportMode.active ? (
               <motion.div
                 key="support-view"
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="p-4 md:p-8"
               >
                 <div className="bg-white rounded-[2rem] md:rounded-[3rem] p-6 md:p-12 border border-slate-200 shadow-xl max-w-4xl mx-auto text-center space-y-6 md:space-y-8">
                    <div className="w-20 h-20 md:w-24 md:h-24 bg-amber-50 text-amber-500 rounded-[2rem] md:rounded-[2.5rem] flex items-center justify-center mx-auto border-4 border-white shadow-lg">
                       <Eye className="w-8 h-8 md:w-10 md:h-10" />
                    </div>
                    <div>
                       <h2 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight uppercase">Modo Suporte Habilitado</h2>
                       <p className="text-xs md:text-sm text-slate-500 mt-2 font-medium">Você está visualizando os dados restritos da clínica <span className="font-bold text-slate-900 underline">{supportMode.clinicData?.name}</span>.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
                       <div className="p-5 md:p-6 bg-slate-50 rounded-2xl md:rounded-3xl border border-slate-100 text-left">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">ID da Unidade</p>
                          <p className="text-[11px] font-mono font-bold text-slate-700 break-all">{supportMode.clinicId}</p>
                       </div>
                       <div className="p-5 md:p-6 bg-slate-50 rounded-2xl md:rounded-3xl border border-slate-100 text-left">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status de Serviço</p>
                          <p className="text-[11px] font-bold text-emerald-600 uppercase italic">Acesso Autorizado</p>
                       </div>
                    </div>

                    <div className="bg-rose-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-rose-100 flex items-start gap-3 md:gap-4 text-left">
                       <ShieldAlert className="w-6 h-6 text-rose-500 shrink-0" />
                       <div>
                          <p className="text-xs font-black text-rose-900 uppercase">IMPORTANTE: Auditoria Gradual</p>
                          <p className="text-[10px] text-rose-700 font-medium leading-relaxed mt-1">
                             Toda ação realizada neste modo é vinculada ao seu UID ({platformRole}) e registrada permanentemente no `platform_audit_logs`.
                          </p>
                       </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center">
                       <button
                         onClick={() => {
                           // AppLayout reads supportMode.active from AdminContext and swaps in
                           // supportMode.clinicData as the working clinic — this is real, not a stub.
                           navigate('/');
                         }}
                         className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-2xl shadow-slate-900/20"
                       >
                          Entrar na Clínica <ArrowRight className="w-4 h-4" />
                       </button>
                       <button
                         onClick={exitSupportMode}
                         className="px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                       >
                          Voltar ao Gerenciamento
                       </button>
                    </div>
                 </div>
               </motion.div>
             ) : (
               <motion.div
                 key={activeView}
                 initial={{ opacity: 0, y: 10 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: -10 }}
                 transition={{ duration: 0.2 }}
               >
                  {activeView === 'dashboard' && <AdminDashboard />}
                  {activeView === 'clinics' && <ClinicsManagement />}
                  {activeView === 'users' && <PlatformUsers />}
                  {activeView === 'access' && <PlatformAccessManagement />}
                  {activeView === 'finance' && <PlatformFinance />}
                  {activeView === 'integrations' && <PlatformIntegrations />}
                  {activeView === 'ai' && <PlatformAiUsage />}
                  {activeView === 'logs' && <PlatformLogs />}
                  {activeView === 'support' && <PlatformSupport />}
               </motion.div>
             )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
