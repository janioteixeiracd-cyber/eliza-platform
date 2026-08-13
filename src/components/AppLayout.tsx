import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  CalendarDays,
  MessageSquare,
  MessageCircle,
  Settings, 
  LogOut, 
  Menu, 
  X, 
  Briefcase, 
  Stethoscope, 
  DollarSign, 
  Package, 
  Activity,
  ClipboardCheck,
  Wallet,
  Loader2,
  BarChart3,
  Database,
  UploadCloud,
  ShieldAlert,
  Sparkles,
  GraduationCap
} from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { Routes, Route, useLocation, Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAdmin } from '../contexts/AdminContext';
import { ENABLE_PLATFORM_ADMIN } from '../config';
import LoginView from './LoginView';
import { db, auth } from '../lib/firebase';
import { updatePassword } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, updateDoc } from 'firebase/firestore';
import OnboardingView from './OnboardingView';
import AcceptInviteView from './AcceptInviteView';
import ChatInterface from './ChatInterface';
import DashboardView from './DashboardView';
import PatientsList from './PatientsList';
import CalendarView from './CalendarView';
import CRMView from './CRMView';
import MedicalRecordView from './MedicalRecordView';
import FinancialView from './FinancialView';
import InventoryView from './InventoryView';
import ReportsView from './ReportsView';
import SettingsView from './SettingsView';
import ClinicRadarView from './ClinicRadarView';
import CashClosingView from './CashClosingView';
import TaskManagerView from './TaskManagerView';
import InternalNotesView from './InternalNotesView';
import ExcelImportPage from '../features/import/ExcelImportPage';
import IntelligentFinanceView from './IntelligentFinanceView';
import RecallHOFView from './RecallHOFView';
import PlanningView from './PlanningView';
import TeamPerformanceView from './TeamPerformanceView';
import EducationView from './EducationView';

type View = 'dashboard' | 'patients' | 'agenda' | 'chat' | 'crm' | 'medical_record' | 'financial' | 'inventory' | 'reports' | 'settings' | 'radar' | 'closing' | 'tasks' | 'import' | 'intelligent_finance' | 'notes' | 'recall_hof' | 'planning' | 'team_performance' | 'education';

export default function AppLayout() {
  const { 
    user, 
    profile, 
    clinic: authClinic, 
    isPlatformAdmin, 
    loading, 
    isQuotaExceeded, 
    logout,
    bootstrapTime,
    authError
  } = useAuth();
  const { supportMode, exitSupportMode } = useAdmin();
  const clinic = supportMode.active ? supportMode.clinicData : authClinic;
  const [activeView, setActiveView] = useState<View>('dashboard');

  // Student role auto-routing
  React.useEffect(() => {
    if (profile?.role === 'aluno' || profile?.role === 'student' || profile?.userType === 'education_student') {
      setActiveView('education');
    }
  }, [profile?.role, profile?.userType]);

  // Student temporary password change states
  const [isChangingPasswordModalOpen, setIsChangingPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(null);
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPasswordChangeError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError('As senhas não coincidem.');
      return;
    }

    setPasswordChangeLoading(true);
    setPasswordChangeError(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Nenhum usuário conectado.');

      await updatePassword(currentUser, newPassword);

      // Clean the tempPassword in Firestore profile under users/{uid}
      await updateDoc(doc(db, 'users', currentUser.uid), {
        tempPassword: null,
        updatedAt: serverTimestamp()
      });

      // Update student profile in any clinics under `education_students` using search
      try {
        const { query, collectionGroup, where, getDocs } = await import('firebase/firestore');
        const studentQ = query(collectionGroup(db, 'education_students'), where('authUid', '==', currentUser.uid));
        const studentSnap = await getDocs(studentQ);
        for (const docSnap of studentSnap.docs) {
          await updateDoc(docSnap.ref, {
            tempPassword: null,
            updatedAt: serverTimestamp()
          });
        }
      } catch (colErr) {
        console.warn("[STUDENT_PW_COL_ERR] Optional collection update skipped:", colErr);
      }

      setPasswordChangeSuccess(true);
      setNewPassword('');
      setConfirmNewPassword('');
      setTimeout(() => {
        setIsChangingPasswordModalOpen(false);
        setPasswordChangeSuccess(false);
      }, 3000);
    } catch (err: any) {
      console.error("[STUDENT_PW_CHANGE_ERR]", err);
      let errorMsg = 'Erro ao atualizar a senha: ';
      if (err.code === 'auth/requires-recent-login') {
        errorMsg = 'Para alterar a senha por motivos de segurança, você precisa fazer logout e login novamente para confirmar sua sessão.';
      } else {
        errorMsg += err.message;
      }
      setPasswordChangeError(errorMsg);
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopExpanded, setIsDesktopExpanded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [showPwaPrompt, setShowPwaPrompt] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isAccessChecking, setIsAccessChecking] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleAccessCheck = async (clinicId: string) => {
    if (!user) return;
    setIsAccessChecking(true);
    setAccessError(null);
    try {
      console.log("[ACCESS_CHECK] auth uid:", user.uid);
      const memberRef = doc(db, "clinics", clinicId, "members", user.uid);
      const memberDoc = await getDoc(memberRef);
      console.log("[ACCESS_CHECK] member exists:", memberDoc.exists());

      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        // reparar automaticamente users/{uid}
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
          uid: user.uid,
          name: memberData.name || user.displayName || user.email?.split('@')[0] || 'Usuário',
          email: user.email?.toLowerCase() || '',
          defaultClinicId: clinicId,
          role: memberData.role || 'colaborador',
          updatedAt: serverTimestamp()
        }, { merge: true });

        console.log("[ACCESS_CHECK] users profile repaired successfully. Reloading...");
        window.location.reload();
      } else {
        setAccessError("Seu usuário autenticado ainda não foi cadastrado como membro desta clínica.");
      }
    } catch (err: any) {
      console.error("[ACCESS_CHECK] Error:", err);
      setAccessError(`Erro ao verificar acesso: ${err.message}`);
    } finally {
      setIsAccessChecking(false);
    }
  };

  // Check if already in standalone mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

  React.useEffect(() => {
    // Show PWA installation prompt after 3 seconds if not standalone
    const timer = setTimeout(() => {
      if (!isStandalone) {
        setShowPwaPrompt(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isStandalone]);

  React.useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const pId = searchParams.get('patientId');
    if (pId) {
      setSelectedPatientId(pId);
      setActiveView('patients');
    }
  }, [location.search]);

  // TEAM AUTOMATIC MIGRATION (from members -> team_members)
  React.useEffect(() => {
    if (!clinic?.id) return;
    async function runMigration() {
      try {
        const migratedKey = `eliza_migrated_team_${clinic?.id}`;
        if (localStorage.getItem(migratedKey)) return;

        console.log(`[Migration] Starting team migration for clinic ${clinic?.id}...`);
        const membersRef = collection(db, 'clinics', clinic?.id, 'members');
        const teamMembersRef = collection(db, 'clinics', clinic?.id, 'team_members');

        const membersSnap = await getDocs(membersRef);
        const teamSnap = await getDocs(teamMembersRef);

        const membersList = membersSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
        const teamList = teamSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

        for (const m of membersList) {
          const emailLower = m.email?.toLowerCase().trim();
          const nameLower = m.name?.toLowerCase().trim();

          // Check if this member is already represented in team_members
          const existingTeam = teamList.find(t => 
            (t.email && t.email.toLowerCase().trim() === emailLower) || 
            (t.name && t.name.toLowerCase().trim() === nameLower) ||
            t.uid === m.id || 
            t.id === m.id
          );

          const isClinFallVal = ['dentist', 'dentist_gp', 'especialista', 'professional', 'clinical_professional', 'doctor', 'dentista', 'odontologista'].includes(m.role?.toLowerCase() || '');

          if (!existingTeam) {
            // Create matching team_members document with the ID as the member's ID/UID
            const newTeamDocRef = doc(db, 'clinics', clinic?.id, 'team_members', m.id);
            await setDoc(newTeamDocRef, {
              id: m.id,
              uid: m.id,
              name: m.name || '',
              displayName: m.name || '',
              email: m.email || '',
              role: m.role || 'other',
              active: m.active !== false,
              isClinicalProvider: m.isClinicalProvider ?? isClinFallVal,
              isProfessional: m.isClinicalProvider ?? isClinFallVal,
              isCommissionable: false,
              defaultCommissionPercent: 0,
              financial: {
                commissionPercent: 0,
                commissionEnabled: false,
                receiveFinancialSummary: false
              },
              attendance: {
                isProfessional: m.isClinicalProvider ?? isClinFallVal
              },
              marketing: { enabled: false },
              secretary: { enabled: false },
              created_at: serverTimestamp(),
              updated_at: serverTimestamp()
            });
            console.log(`[Migration] Created team_member for ${m.name} (${m.id})`);
          } else {
            // Update existing team_member to link with this member's UID if needed, ensuring no data loss
            const updatePayload: any = {
              uid: m.id,
              email: existingTeam.email || m.email || '',
              updated_at: serverTimestamp()
            };

            // If financial nested key doesn't exist, build it
            if (!existingTeam.financial) {
              updatePayload.financial = {
                commissionPercent: existingTeam.defaultCommissionPercent ?? (existingTeam.percentage || 0),
                commissionEnabled: existingTeam.isCommissionable ?? (existingTeam.commission_enabled !== false),
                receiveFinancialSummary: false
              };
            }
            if (!existingTeam.attendance) {
              updatePayload.attendance = {
                isProfessional: existingTeam.isProfessional ?? isClinFallVal
              };
            }
            if (!existingTeam.marketing) {
              updatePayload.marketing = { enabled: false };
            }
            if (!existingTeam.secretary) {
              updatePayload.secretary = { enabled: false };
            }

            await updateDoc(doc(db, 'clinics', clinic?.id, 'team_members', existingTeam.id), updatePayload);
            console.log(`[Migration] Linked existing team_member ${existingTeam.id} with UID ${m.id}`);
          }
        }

        localStorage.setItem(migratedKey, 'true');
        console.log(`[Migration] Team migration finished for clinic ${clinic?.id}.`);
      } catch (error) {
        console.error(`[Migration] Team migration failed:`, error);
      }
    }
    runMigration();
  }, [clinic?.id]);

  // NAVIGATION EVENT LISTENER
  React.useEffect(() => {
    const handleNavigation = (e: Event) => {
      const customEvent = e as CustomEvent<View>;
      if (customEvent.detail) {
        setActiveView(customEvent.detail);
      }
    };
    const handleSelectPatient = (e: Event) => {
      const customEvent = e as CustomEvent<{ patientId: string; tab?: string }>;
      if (customEvent.detail && customEvent.detail.patientId) {
        setSelectedPatientId(customEvent.detail.patientId);
        setActiveView('patients');
        if (customEvent.detail.tab) {
          localStorage.setItem('medical-record-active-tab', customEvent.detail.tab);
        }
      }
    };
    window.addEventListener('navigate-view', handleNavigation);
    window.addEventListener('select-patient', handleSelectPatient);
    return () => {
      window.removeEventListener('navigate-view', handleNavigation);
      window.removeEventListener('select-patient', handleSelectPatient);
    };
  }, []);

  // CLINIC OVERRIDE for Support Mode


  if (isQuotaExceeded) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="max-w-md bg-white p-12 rounded-[40px] shadow-2xl shadow-rose-200/50 border border-rose-100 flex flex-col items-center gap-6">
          <div className="w-20 h-20 bg-rose-50 text-rose-600 rounded-[32px] flex items-center justify-center shadow-inner">
            <Database className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Limite de Uso Excedido</h2>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              Infelizmente, o limite de uso diário do sistema gratuito foi atingido. 
              <br /><br />
              Este é um limite do Google Cloud (Firestore) e será redefinido automaticamente amanhã.
            </p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-4 bg-rose-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-rose-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Verificar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    const isSlow = bootstrapTime > 4;
    const isError = bootstrapTime > 8 || !!authError;

    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-8 max-w-sm w-full">
          <div className="w-20 h-20 bg-teal-600 rounded-[2.5rem] flex items-center justify-center text-white font-bold text-4xl animate-bounce shadow-2xl shadow-teal-600/30">E</div>
          
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="flex items-center gap-2 text-slate-400 font-bold text-[10px] uppercase tracking-[0.3em]">
               <Loader2 className={`w-4 h-4 ${!isError ? 'animate-spin' : ''}`} />
               {isSlow ? 'Sincronização Lenta' : 'Sincronizando Dados'}
            </div>

            {(isSlow || isError) && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 flex flex-col items-center text-center gap-6"
              >
                <div className={`w-12 h-12 ${isError ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'} rounded-2xl flex items-center justify-center`}>
                  {isError ? <ShieldAlert className="w-6 h-6" /> : <Activity className="w-6 h-6" />}
                </div>
                
                <div>
                  <p className="text-xs font-black text-slate-900 uppercase tracking-tight mb-1">
                    {isError ? 'Falha na Inicialização' : 'Quase lá...'}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                    {authError || "Estamos tendo dificuldade para conectar com os servidores da ELIZA. Verifique sua conexão."}
                  </p>
                </div>

                <div className="w-full flex flex-col gap-2">
                  <button 
                    onClick={() => window.location.reload()}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Tentar Novamente
                  </button>
                  <button 
                    onClick={() => logout()}
                    className="w-full py-4 bg-white text-slate-400 border border-slate-100 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-rose-600 transition-all"
                  >
                    Sair da Conta
                  </button>
                </div>

                {/* Secret Debug Button */}
                <button 
                  onClick={() => setShowDebug(!showDebug)}
                  className="text-[9px] font-bold text-slate-300 uppercase tracking-widest hover:text-slate-500"
                >
                  {showDebug ? 'Esconder Diagnóstico' : 'Ver Diagnóstico'}
                </button>

                {showDebug && (
                  <div className="w-full text-[9px] font-mono text-slate-400 bg-slate-50 p-4 rounded-2xl text-left border border-slate-100 flex flex-col gap-2 overflow-x-auto">
                    <div className="flex justify-between border-b border-slate-200/50 pb-1"><span>UID:</span> <span className="text-slate-600">{user?.uid || 'NONE'}</span></div>
                    <div className="flex justify-between border-b border-slate-200/50 pb-1"><span>Email:</span> <span className="text-slate-600">{user?.email || 'NONE'}</span></div>
                    <div className="flex justify-between border-b border-slate-200/50 pb-1"><span>CID:</span> <span className="text-slate-600">{profile?.defaultClinicId || 'NONE'}</span></div>
                    <div className="flex justify-between border-b border-slate-200/50 pb-1"><span>Boot:</span> <span className="text-slate-600">{bootstrapTime}s</span></div>
                    <div className="flex justify-between border-b border-slate-200/50 pb-1"><span>Admin:</span> <span className={isPlatformAdmin ? 'text-teal-600' : ''}>{isPlatformAdmin ? 'YES' : 'NO'}</span></div>
                    <div className="flex justify-between"><span>Method:</span> <span>{user?.providerData?.[0]?.providerId || 'password'}</span></div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Allow invitation acceptance without full auth
  if (location.pathname === '/accept-invite') {
    return <AcceptInviteView />;
  }

  if (!user) {
    return <LoginView />;
  }

  // If user is a platform admin and hits / but has no clinic, redirect to /admin
  if (isPlatformAdmin && !clinic && location.pathname === '/') {
    return <Navigate to="/admin" />;
  }

  if (!clinic) {
    // If user has a specific clinic ID but association failed (and it's not onboarding)
    if (profile?.defaultClinicId && profile.defaultClinicId !== 'onboarding') {
      return (
        <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-100 via-slate-50 to-white">
          <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 flex flex-col items-center text-center gap-8 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-2 bg-teal-500" />
            <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center relative shadow-inner">
               <ShieldAlert className="w-10 h-10 text-slate-300" />
               <motion.div 
                 animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                 transition={{ repeat: Infinity, duration: 3 }}
                 className="absolute inset-0 bg-teal-500/5 rounded-[2.5rem]" 
               />
            </div>
            
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase tracking-widest">Acesso Restrito</h2>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                Seu acesso ainda não foi vinculado a uma clínica ou está aguardando ativação pelo administrador.
              </p>
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-3xl">
                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">ID de Destino: {profile.defaultClinicId}</p>
              </div>
            </div>

            {accessError && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-[10px] font-bold text-rose-600 tracking-normal uppercase">
                {accessError}
              </div>
            )}

            <div className="w-full flex flex-col gap-3">
              <button 
                onClick={() => handleAccessCheck(profile.defaultClinicId!)}
                disabled={isAccessChecking}
                className="w-full py-4 bg-teal-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-teal-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isAccessChecking ? 'Verificando...' : `Acessar clínica ${profile.defaultClinicId}`}
              </button>
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                Verificar Novamente
              </button>
              <button 
                onClick={() => logout()}
                className="w-full py-4 bg-white text-slate-400 border border-slate-100 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-rose-600 hover:border-rose-100 transition-all"
              >
                Sair da Conta
              </button>
            </div>

            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">
              Se você é um novo administrador, fale com o suporte ELIZA.
            </p>
          </div>
        </div>
      );
    }
    return <OnboardingView />;
  }

  const handlePatientSelect = (id: string) => {
    setSelectedPatientId(id);
    setActiveView('medical_record');
  };

  const isStudentRole = profile?.role === 'aluno' || profile?.role === 'student' || profile?.userType === 'education_student';

  const menuItems = isStudentRole
    ? [
        { id: 'education', label: 'Portal do Aluno', icon: GraduationCap, group: 'Acadêmico' },
        { id: 'settings', label: 'Minha Conta', icon: Settings, group: 'Sistema' }
      ]
    : [
        { id: 'dashboard', label: 'Início', icon: LayoutDashboard, group: 'Visão Geral' },
        { id: 'notes', label: 'Central de Recados', icon: MessageCircle, group: 'Visão Geral' },
        { id: 'radar', label: 'Radar da Clínica', icon: Activity, group: 'Visão Geral' },
        { id: 'agenda', label: 'Agenda', icon: Calendar, group: 'Visão Geral' },
        
        { id: 'patients', label: 'Pacientes', icon: Users, group: 'Clínico' },
        { id: 'education', label: 'Cursos / ELIZA Education', icon: GraduationCap, group: 'Clínico' },
        
        { id: 'chat', label: 'Central Atendimento', icon: MessageSquare, group: 'Inteligência' },
        { id: 'closing', label: 'Fechamento de Caixa', icon: Wallet, group: 'Inteligência' },
        { id: 'tasks', label: 'Prioridades', icon: ClipboardCheck, group: 'Inteligência' },

        { id: 'crm', label: 'Leads & Vendas', icon: Briefcase, group: 'Comercial' },
        { id: 'recall_hof', label: 'Recall Inteligente HOF', icon: Sparkles, group: 'Comercial' },
        
        { id: 'planning', label: 'Planejamento', icon: CalendarDays, group: 'Gestão' },
        { id: 'financial', label: 'Financeiro', icon: DollarSign, group: 'Gestão' },
        { id: 'intelligent_finance', label: 'Financeiro Inteligente', icon: Activity, group: 'Gestão' },
        { id: 'team_performance', label: 'Gestão de Colaboradores', icon: Users, group: 'Gestão' },
        { id: 'inventory', label: 'Estoque', icon: Package, group: 'Gestão' },
        { id: 'reports', label: 'Relatórios', icon: BarChart3, group: 'Gestão' },
        { id: 'import', label: 'Importação Excel', icon: UploadCloud, group: 'Gestão' },
        
        { id: 'settings', label: 'Configurações', icon: Settings, group: 'Sistema' },
      ];

  const groupedMenu = menuItems.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {} as Record<string, typeof menuItems>);

  const mobileTabs = isStudentRole
    ? [
        { id: 'education', label: 'Estudos', icon: GraduationCap },
        { id: 'settings', label: 'Minha Conta', icon: Settings },
      ]
    : [
        { id: 'dashboard', label: 'Início', icon: LayoutDashboard },
        { id: 'agenda', label: 'Agenda', icon: Calendar },
        { id: 'patients', label: 'Pacientes', icon: Users },
        { id: 'chat', label: 'ELIZA AI', icon: MessageSquare },
        { id: 'settings', label: 'Ajustes', icon: Settings },
      ];

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {/* Mobile Menu Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200 flex flex-col transform transition-all duration-300 ease-in-out
        lg:relative lg:translate-x-0
        ${isDesktopExpanded ? 'w-72' : 'lg:w-[80px] w-72'}
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Sidebar Header */}
        <div 
          onClick={() => {
            if (!isDesktopExpanded) setIsDesktopExpanded(true);
          }}
          className={`h-20 flex items-center border-b border-slate-200 shrink-0 transition-all duration-300 ${!isDesktopExpanded ? 'cursor-pointer lg:hover:bg-slate-50' : ''} ${isDesktopExpanded ? 'px-8' : 'lg:justify-center lg:px-0 px-8'}`}
        >
          {isDesktopExpanded ? (
            <>
              <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-teal-600/20 ring-4 ring-teal-50 shrink-0 select-none">E</div>
              <div className="ml-4 flex-1 min-w-0">
                <h1 className="text-xl font-bold tracking-tighter text-slate-900 truncate">ELIZA</h1>
                <p className="text-[10px] text-teal-600 font-bold uppercase tracking-widest mt-0.5 truncate">Dental Platform</p>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="ml-auto lg:hidden">
                <X className="w-6 h-6 text-slate-400" />
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDesktopExpanded(false);
                }} 
                className="hidden lg:flex ml-auto w-8 h-8 items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-all select-none"
                title="Recolher menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center w-full relative group">
              <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-teal-600/20 ring-4 ring-teal-50 shrink-0 group-hover:scale-105 transition-all">E</div>
              <div className="absolute inset-x-0 mx-auto w-10 h-10 flex items-center justify-center bg-teal-700/90 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer shadow-lg shadow-teal-600/30">
                <Menu className="w-5 h-5 text-white animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Navigation */}
        <nav className={`flex-1 space-y-8 overflow-y-auto custom-scrollbar transition-all duration-300 ${isDesktopExpanded ? 'p-6' : 'lg:p-3 p-6'}`}>
          {Object.entries(groupedMenu).map(([group, items]) => (
            <div key={group} className="space-y-2.5">
              <p className={`text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-3 transition-opacity duration-300 ${isDesktopExpanded ? 'opacity-100' : 'lg:opacity-0 lg:h-0 lg:overflow-hidden lg:mb-0 lg:hidden'}`}>
                {group}
              </p>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id as View);
                    setIsSidebarOpen(false);
                  }}
                  className={`
                    w-full flex items-center transition-all font-semibold text-sm
                    ${activeView === item.id 
                      ? 'bg-teal-50 text-teal-700 shadow-sm border border-teal-100' 
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}
                    ${isDesktopExpanded 
                      ? 'px-4 py-3 gap-4 rounded-xl' 
                      : 'lg:px-0 lg:py-3 lg:justify-center lg:gap-0 lg:rounded-xl'}
                  `}
                  title={!isDesktopExpanded ? item.label : undefined}
                >
                  <div className="relative flex items-center justify-center">
                    <item.icon className={`w-5 h-5 shrink-0 ${activeView === item.id ? 'text-teal-600' : 'text-slate-400'}`} />
                    {item.id === 'chat' && !isDesktopExpanded && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-sm shadow-emerald-500/50"></span>
                    )}
                  </div>
                  <span className={`transition-all duration-300 whitespace-nowrap ${isDesktopExpanded ? 'opacity-100 max-w-full ml-4' : 'lg:opacity-0 lg:max-w-0 lg:overflow-hidden lg:hidden'}`}>
                    {item.label}
                  </span>
                  {item.id === 'chat' && isDesktopExpanded && (
                    <span className="ml-auto w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-sm shadow-emerald-500/50"></span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Support Mode Indicator in Sidebar */}
        {supportMode.active && (
          <div className={`transition-all duration-300 ${isDesktopExpanded ? 'mx-6 mt-4 p-4 rounded-[2rem] bg-amber-50 border border-amber-200 flex flex-col gap-3' : 'lg:mx-2 lg:mt-4 lg:p-2 lg:rounded-xl lg:bg-amber-50 lg:border lg:border-amber-100 lg:flex lg:flex-col lg:items-center mx-6 mt-4 p-4 rounded-[2rem] bg-amber-50/50 border border-amber-200 flex flex-col gap-3'}`}>
             <div className={`flex items-center gap-3 ${isDesktopExpanded ? 'px-1' : 'lg:justify-center'}`}>
                <div className="w-8 h-8 bg-amber-500 text-white rounded-xl flex items-center justify-center shrink-0" title="Acesso de Suporte">
                   <ShieldAlert className="w-4 h-4" />
                </div>
                <div className={isDesktopExpanded ? '' : 'lg:hidden'}>
                   <p className="text-[10px] font-black text-amber-900 uppercase">Acesso de Suporte</p>
                   <p className="text-[8px] font-bold text-amber-600 uppercase tracking-tighter">Auditado pela ELIZA</p>
                </div>
             </div>
             <button 
               onClick={() => {
                  exitSupportMode();
                  navigate('/admin');
               }} 
               className={`w-full py-2 bg-white text-amber-600 text-[8px] font-black uppercase tracking-widest rounded-xl hover:bg-amber-100 transition-all border border-amber-100 ${isDesktopExpanded ? '' : 'lg:hidden'}`}
               title="Sair do Suporte"
             >
                Encerrar e Voltar Admin
             </button>
          </div>
        )}

        {/* Sidebar Footer */}
        <div className={`border-t border-slate-200 bg-slate-50/50 transition-all duration-300 ${isDesktopExpanded ? 'p-6' : 'lg:p-3 p-6'}`}>
          <div className={`flex items-center mb-6 transition-all duration-300 ${isDesktopExpanded ? 'px-4 gap-4' : 'lg:justify-center lg:px-0 lg:gap-0'}`}>
            <div className="w-10 h-10 rounded-xl bg-slate-200 border border-slate-300 overflow-hidden shadow-sm shrink-0">
               {profile?.photoURL ? (
                 <img src={profile.photoURL} alt={profile.name} className="w-full h-full object-cover" />
               ) : (
                 <div className="w-full h-full flex items-center justify-center bg-teal-100 text-teal-700 font-bold uppercase shrink-0">{profile?.name?.[0]}</div>
               )}
            </div>
            <div className={`overflow-hidden transition-all duration-300 ${isDesktopExpanded ? 'opacity-100 max-w-full ml-4 flex-1 min-w-0' : 'lg:opacity-0 lg:max-w-0 lg:hidden'}`}>
              <p className="text-xs font-bold text-slate-900 truncate">{profile?.name}</p>
              <p className="text-[10px] text-teal-600 font-black uppercase tracking-tighter truncate">{clinic?.name}</p>
            </div>
          </div>
          
          {isPlatformAdmin && ENABLE_PLATFORM_ADMIN && (
            <button 
              onClick={() => navigate('/super-admin')}
              className={`
                w-full flex items-center rounded-xl bg-amber-50/50 border border-amber-100 shadow-sm font-bold text-[10px] uppercase tracking-widest text-amber-600 hover:bg-amber-50 transition-all
                ${isDesktopExpanded ? 'px-4 py-3 gap-4 mb-2' : 'lg:px-0 lg:py-3 lg:justify-center lg:mb-2 lg:gap-0'}
              `}
              title="Plataforma ELIZA"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span className={`transition-all duration-300 whitespace-nowrap ${isDesktopExpanded ? 'opacity-100 max-w-full ml-4' : 'lg:opacity-0 lg:max-w-0 lg:hidden'}`}>Plataforma ELIZA</span>
            </button>
          )}

          <button 
            onClick={() => logout()}
            className={`
              w-full flex items-center rounded-xl bg-white border border-slate-100 shadow-sm font-bold text-[10px] uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors
              ${isDesktopExpanded ? 'px-4 py-3 gap-4' : 'lg:px-0 lg:py-3 lg:justify-center lg:gap-0'}
            `}
            title="Encerrar Sessão"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className={`transition-all duration-300 whitespace-nowrap ${isDesktopExpanded ? 'opacity-100 max-w-full ml-4' : 'lg:opacity-0 lg:max-w-0 lg:hidden'}`}>Encerrar Sessão</span>
          </button>

          <div className="mt-4 pt-4 border-t border-slate-105 flex flex-col items-center justify-center text-center">
            <div className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[8px] font-black uppercase tracking-widest text-slate-400/80 ${isDesktopExpanded ? 'flex-row' : 'lg:flex-col lg:gap-1.5'}`}>
              <Link to="/company" className="hover:text-teal-600 transition-colors whitespace-nowrap" title="Informações da Empresa">
                {isDesktopExpanded ? 'Informações da Empresa' : 'Empresa'}
              </Link>
              <span className={`text-slate-200 select-none ${isDesktopExpanded ? 'inline' : 'lg:hidden'}`}>•</span>
              <Link to="/privacy" className="hover:text-teal-600 transition-colors whitespace-nowrap" title="Política de Privacidade">
                {isDesktopExpanded ? 'Política de Privacidade' : 'Privacidade'}
              </Link>
              <span className={`text-slate-200 select-none ${isDesktopExpanded ? 'inline' : 'lg:hidden'}`}>•</span>
              <Link to="/terms" className="hover:text-teal-600 transition-colors whitespace-nowrap" title="Termos de Uso">
                {isDesktopExpanded ? 'Termos de Uso' : 'Termos'}
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Mobile Navbar - Premium App Style */}
        <header className="h-16 lg:hidden bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-teal-600 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-teal-600/20">E</div>
             <div className="flex flex-col">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-900 leading-none mb-0.5">
                  {menuItems.find(i => i.id === activeView)?.label}
                </h2>
                <div className="flex items-center gap-1">
                   <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                   <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Sincronizado</span>
                </div>
             </div>
          </div>
          <button onClick={() => setIsSidebarOpen(true)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 border border-slate-100 text-slate-500">
            <Menu className="w-5 h-5" />
          </button>
        </header>

        {/* Content Section */}
        <main className="flex-1 overflow-hidden relative pb-20 lg:pb-0 flex flex-col">
          {/* Aluno Temporary Password Banner Notification */}
          {(profile?.role === 'aluno' || profile?.role === 'student' || profile?.userType === 'education_student') && profile?.tempPassword && (
            <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 z-30 shrink-0 text-slate-800 font-sans select-none">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100/80 text-amber-800 rounded-xl shrink-0">
                  <ShieldAlert className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-slate-900 leading-none">Aviso importante de segurança</p>
                  <p className="text-[11px] font-semibold text-slate-600 mt-1">
                    Você está conectado com uma senha provisória gerada pela administração. Altere-a agora por segurança.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsChangingPasswordModalOpen(true)}
                className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer shadow-md shrink-0 self-start sm:self-center"
              >
                Definir Senha Segura
              </button>
            </div>
          )}

          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto"
          >
            {activeView === 'dashboard' && (
              <DashboardView 
                onNavigate={(view: any) => setActiveView(view)} 
                onSelectPatient={(patientId) => {
                  setSelectedPatientId(patientId);
                  setActiveView('patients');
                }}
              />
            )}
            {activeView === 'agenda' && (
              <CalendarView 
                preSelectedPatientId={selectedPatientId}
                onNavigate={(view: any) => setActiveView(view)}
                onSelectPatient={(patientId) => {
                  setSelectedPatientId(patientId);
                  setActiveView('patients');
                }}
                onNavigateToChat={(patientId) => {
                  if (patientId) {
                    setSelectedPatientId(patientId);
                  }
                  setActiveView('chat');
                }}
              />
            )}
            {activeView === 'patients' && (
              selectedPatientId 
                ? <MedicalRecordView 
                    preSelectedId={selectedPatientId} 
                    onSelectPatient={setSelectedPatientId} 
                    onSchedulePatient={(patientId) => {
                      setSelectedPatientId(patientId);
                      setActiveView('agenda');
                    }}
                    onNavigateToChat={(patientId) => {
                      setActiveView('chat');
                    }}
                  />
                : <PatientsList 
                    onSelectPatient={setSelectedPatientId} 
                    onSchedulePatient={(patientId) => {
                      setSelectedPatientId(patientId);
                      setActiveView('agenda');
                    }}
                  />
            )}
            {activeView === 'chat' && <ChatInterface />}
            {activeView === 'crm' && <CRMView />}
            {activeView === 'financial' && (
              <FinancialView 
                onSelectPatient={(patientId) => {
                  setSelectedPatientId(patientId);
                  setActiveView('patients');
                }}
              />
            )}
            {activeView === 'inventory' && <InventoryView />}
            {activeView === 'reports' && <ReportsView />}
            {activeView === 'settings' && <SettingsView />}
            {activeView === 'radar' && <ClinicRadarView />}
            {activeView === 'closing' && <CashClosingView />}
            {activeView === 'tasks' && (
              <TaskManagerView 
                onSelectPatient={(patientId) => {
                  setSelectedPatientId(patientId);
                  setActiveView('patients');
                }}
              />
            )}
            {activeView === 'notes' && <InternalNotesView />}
            {activeView === 'import' && <ExcelImportPage />}
            {activeView === 'intelligent_finance' && <IntelligentFinanceView />}
            {activeView === 'recall_hof' && <RecallHOFView />}
            {activeView === 'planning' && <PlanningView />}
            {activeView === 'team_performance' && <TeamPerformanceView />}
            {activeView === 'education' && <EducationView />}
          </motion.div>
        </main>

        {/* Mobile Bottom Navigation - iOS Style */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-20 bg-white/95 backdrop-blur-xl border-t border-slate-200 px-6 flex items-center justify-between z-40 pb-5">
           {mobileTabs.map((tab) => {
             const Icon = tab.icon;
             const isActive = activeView === tab.id;
             return (
               <button
                 key={tab.id}
                 onClick={() => {
                   setActiveView(tab.id as View);
                   if (tab.id === 'patients') setSelectedPatientId(null);
                 }}
                 className="flex flex-col items-center gap-1 group relative py-2"
               >
                 <div className={`
                    w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300
                    ${isActive ? 'bg-teal-50 text-teal-600' : 'text-slate-400 group-active:scale-95'}
                 `}>
                   <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-[1.5px]'}`} />
                 </div>
                 <span className={`text-[8px] font-black uppercase tracking-[0.1em] transition-colors ${isActive ? 'text-teal-600' : 'text-slate-400'}`}>
                   {tab.label}
                 </span>
                 {isActive && (
                   <motion.div 
                     layoutId="mobileTabIndicator"
                     className="absolute -bottom-1 w-1 h-1 bg-teal-600 rounded-full"
                   />
                 )}
               </button>
             );
           })}
        </nav>

        {/* PWA Install Prompt */}
        {showPwaPrompt && (
          <div className="lg:hidden fixed bottom-24 left-4 right-4 z-50">
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="bg-slate-900 text-white p-6 rounded-[2.5rem] shadow-2xl shadow-teal-900/40 flex items-center gap-4 border border-slate-700/50"
            >
              <div className="w-12 h-12 bg-teal-600 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-teal-600/30">
                 <UploadCloud className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                 <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-1">Instalar ELIZA</p>
                 <p className="text-xs font-medium text-slate-300 leading-tight">Adicione à tela inicial para uma experiência de aplicativo.</p>
              </div>
              <button 
                onClick={() => setShowPwaPrompt(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          </div>
        )}

        {/* Change password modal popup */}
        {isChangingPasswordModalOpen && (
          <div className="fixed inset-0 bg-slate-950/80 z-[120] flex items-center justify-center p-4 backdrop-blur-xs select-none">
            <div className="bg-white rounded-[2.5rem] border border-slate-200/60 p-8 w-full max-w-md relative text-left shadow-2xl text-slate-850">
              <button 
                onClick={() => setIsChangingPasswordModalOpen(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 font-extrabold text-[#71717a] border-0 bg-transparent cursor-pointer text-sm"
              >
                ✕
              </button>
              
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-teal-50 text-teal-650 rounded-2xl flex items-center justify-center text-3xl mx-auto shadow-inner">🔑</div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mt-2">Definir Senha Permanente</h3>
                  <p className="text-[9.5px] text-slate-450 font-bold uppercase tracking-wider leading-relaxed">Crie uma senha forte e secreta para proteger seu login de estudante</p>
                </div>

                {passwordChangeError && (
                  <div className="p-4 bg-rose-50 border border-rose-105 rounded-2xl text-[10px] font-bold text-rose-600 text-center uppercase leading-normal">
                    {passwordChangeError}
                  </div>
                )}

                {passwordChangeSuccess ? (
                  <div className="p-8 text-center space-y-3">
                    <div className="text-4xl animate-bounce">🎉</div>
                    <h4 className="text-xs font-black uppercase text-emerald-600 tracking-widest">Senha Atualizada!</h4>
                    <p className="text-[9.5px] text-slate-450 font-bold uppercase leading-relaxed">Sua senha foi alterada com sucesso. A barra de aviso foi desativada.</p>
                  </div>
                ) : (
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="space-y-1.5 text-left">
                      <label className="text-[9.5px] font-black text-slate-400 uppercase pl-1 block">Nova Senha</label>
                      <input 
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        required
                        className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5 text-left">
                      <label className="text-[9.5px] font-black text-slate-400 uppercase pl-1 block">Confirmar Nova Senha</label>
                      <input 
                        type="password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Digite novamente"
                        required
                        className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-900"
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={passwordChangeLoading}
                      className="w-full py-4 bg-slate-900 text-white hover:bg-slate-800 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                    >
                      {passwordChangeLoading ? 'Atualizando...' : 'Definir Senha Definitiva'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
