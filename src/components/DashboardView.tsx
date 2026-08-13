import React, { useEffect, useState } from 'react';
import { 
  Users, 
  Calendar, 
  TrendingUp, 
  DollarSign, 
  MessageCircle,
  Sparkles, 
  AlertCircle, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock,
  Package,
  CheckCircle2,
  ChevronRight,
  Plus,
  UserPlus,
  CreditCard,
  Stethoscope,
  Bell,
  Activity,
  Wallet,
  ClipboardCheck,
  Target,
  BrainCircuit,
  Database,
  AlertTriangle
} from 'lucide-react';
import { ClinicalEvolutionMonitorService } from '../services/ClinicalEvolutionMonitorService';
import ClinicalPendingQuickResolver from './ClinicalPendingQuickResolver';
import { 
  Filter, 
  UserCheck, 
  ShieldAlert, 
  Check, 
  Trash, 
  Paperclip, 
  FileEdit,
  SlidersHorizontal,
  FileSignature,
  Search,
  X,
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, onSnapshot, where, serverTimestamp, orderBy, limit, getDocs, getCountFromServer, doc, addDoc, updateDoc } from 'firebase/firestore';
import { db, logQuery, IS_STUDIO_PREVIEW, FIRESTORE_DATABASE_ID, handleFirestoreError, OperationType } from '../lib/firebase';
import { getGenAI } from '../lib/gemini';
import { AI_CONFIG } from '../config/ai';

// In-memory module-level cache to prevent duplicate reads and loading flicker on fast navigation
let dashboardCache: any = null;
let lastCacheTime = 0;
const DASHBOARD_CACHE_TTL_MS = 15000; // 15 seconds cooldown

// Helper to format a Date object as YYYY-MM-DD in the user's local timezone
const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const saveToCache = (key: string, value: any) => {
  if (!dashboardCache) dashboardCache = {};
  dashboardCache[key] = value;
  lastCacheTime = Date.now();
};

interface DashboardProps {
  onNavigate?: (view: string) => void;
  onSelectPatient?: (patientId: string) => void;
}

export default function DashboardView({ onNavigate, onSelectPatient }: DashboardProps) {
  const { profile, clinic } = useAuth();
  const [patientCount, setPatientCount] = useState(dashboardCache?.patientCount || 0);
  const [appointmentCount, setAppointmentCount] = useState(dashboardCache?.appointmentCount || 0);
  const [financialStats, setFinancialStats] = useState(dashboardCache?.financialStats || { total: 0, paid: 0, pending: 0, today: 0 });
  const [todayAppointments, setTodayAppointments] = useState<any[]>(dashboardCache?.todayAppointments || []);
  const [waitingCount, setWaitingCount] = useState(dashboardCache?.waitingCount || 0);
  const [pendingConfirmations, setPendingConfirmations] = useState(dashboardCache?.pendingConfirmations || 0);
  const [activeIssues, setActiveIssues] = useState<any[]>(dashboardCache?.activeIssues || []);
  const [pendingTasks, setPendingTasks] = useState<any[]>(dashboardCache?.pendingTasks || []);
  const [resolvedTasks, setResolvedTasks] = useState<any[]>(dashboardCache?.resolvedTasks || []);
  const [showEvolutionHistory, setShowEvolutionHistory] = useState(false);
  const [staff, setStaff] = useState<any[]>([]);
  const [selectedTaskToResolve, setSelectedTaskToResolve] = useState<any | null>(null);
  const [monitorFilter, setMonitorFilter] = useState('all'); 
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [assigningLoading, setAssigningLoading] = useState(false);
  const [internalNotesStats, setInternalNotesStats] = useState(dashboardCache?.internalNotesStats || { pending: 0, urgent: 0, overdue: 0 });
  const [lastClosing, setLastClosing] = useState<any>(dashboardCache?.lastClosing || null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(dashboardCache?.aiAnalysis || null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recentActivity, setRecentActivity] = useState<any[]>(dashboardCache?.recentActivity || []);
  const [isDataLoaded, setIsDataLoaded] = useState(dashboardCache ? true : false);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Bom dia';
    if (hour >= 12 && hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  useEffect(() => {
    if (!clinic) return;
    const unsubStaff = onSnapshot(collection(db, 'clinics', clinic.id, 'members'), (snapshot) => {
      setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      console.warn('Dashboard staff load issue (will default to empty):', error);
    });
    return () => unsubStaff();
  }, [clinic]);

  useEffect(() => {
    if (!clinic) {
      console.log("[ELIZA] dashboard wait state: clinic not yet loaded");
      return;
    }

    const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
    const now = Date.now();
    const timeSinceLastFetch = now - lastCacheTime;

    if (dashboardCache && timeSinceLastFetch < DASHBOARD_CACHE_TTL_MS) {
      if (isDebugActive) {
        console.log("[ELIZA] Dashboard bootstrap bypassed: using cached statistics from less than 15s ago.");
      }
      setIsDataLoaded(true);
      return;
    }

    if (isDebugActive) {
      console.log("[ELIZA] entering dashboard bootstrap");
    }

    let unsubToday = () => {};
    let unsubFinance = () => {};
    let unsubEntriesFinance = () => {};
    let unsubIssues = () => {};
    let unsubTasks = () => {};
    let unsubNotes = () => {};
    let unsubClosing = () => {};
    let unsubActivity = () => {};

    // Use getCountFromServer for efficient patient count
    const updatePatientCount = async () => {
      const path = `clinics/${clinic.id}/patients`;
      if (isDebugActive) {
        console.log(`[ELIZA] loading patients count for ${path}...`);
      }
      try {
        const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
        const q = query(patientsRef, where('status', '==', 'active'));
        
        logQuery('Dashboard', 'patients', 'count', 1);
        try {
          const subSnap = await getCountFromServer(q);
          const count = subSnap.data().count;
          if (isDebugActive) {
            console.log(`[ELIZA] patients count loaded: ${count}`);
          }
          setPatientCount(count);
          saveToCache('patientCount', count);
        } catch (e: any) {
          console.warn("[ELIZA] patients count error, trying fallback:", e.message);
          if (e.message?.includes('index') && IS_STUDIO_PREVIEW) {
            // Simplified count for preview if index missing
            const snap = await getDocs(query(patientsRef, limit(100)));
            const activeCount = snap.docs.filter(d => d.data().status === 'active').length;
            setPatientCount(activeCount);
            saveToCache('patientCount', activeCount);
          } else {
            throw e;
          }
        }
      } catch (err: any) {
        console.error(`[ELIZA] ERROR in dashboard patients query (${path}):`, err.message);
        handleFirestoreError(err, OperationType.GET, path);
      } finally {
        setIsDataLoaded(true);
      }
    };
    updatePatientCount();


    // Today's Appointments & Operational Statuses
    const todayStr = getLocalDateString();
    const apptsPath = `clinics/${clinic.id}/appointments`;
    
    if (isDebugActive) {
      console.log(`[ELIZA] loading appointments query for path ${apptsPath} (date: ${todayStr}, limit: 100)...`);
    }
    logQuery('Dashboard', 'appointments', { clinicId: clinic.id, date: todayStr }, 100);
    const qToday = query(
      collection(db, 'clinics', clinic.id, 'appointments'),
      where('date', '==', todayStr),
      limit(100)
    );
    
    unsubToday = onSnapshot(qToday, (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] appointments loaded: ${snap.size} docs`);
      }
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      // Sort in memory to avoid needing a composite index on (date, time)
      const sortedList = [...list].sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''));
      setTodayAppointments(sortedList);
      setAppointmentCount(sortedList.length);
      const waiting = sortedList.filter((a: any) => a.status === 'waiting' || (a as any).inClinic).length;
      setWaitingCount(waiting);
      const pendingConf = sortedList.filter((a: any) => !a.status || a.status === 'pending').length;
      setPendingConfirmations(pendingConf);

      saveToCache('todayAppointments', sortedList);
      saveToCache('appointmentCount', sortedList.length);
      saveToCache('waitingCount', waiting);
      saveToCache('pendingConfirmations', pendingConf);
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard appointments query (${apptsPath}):`, err.message);
      if (err.message?.includes('index')) {
        if (isDebugActive) {
          console.log(`[ELIZA] trying fallback for appointments (limited scan)...`);
        }
        const qFallback = query(collection(db, 'clinics', clinic.id, 'appointments'), limit(50));
        unsubToday = onSnapshot(qFallback, (s) => {
          const list = s.docs.map(d => ({ id: d.id, ...d.data() } as any)).filter(a => a.date === todayStr);
          setTodayAppointments(list);
          saveToCache('todayAppointments', list);
        });
      } else {
        handleFirestoreError(err, OperationType.GET, apptsPath);
      }
    });

    // Financial Overview (Monthly + Today)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0,0,0,0);
    const startOfMonthISO = startOfMonth.toISOString();
    const transPath = `clinics/${clinic.id}/transactions`;
    const entriesPath = `clinics/${clinic.id}/financial_entries`;

    const processFinancialDocs = (docs: any[]) => {
      let total = 0;
      let paid = 0;
      let pending = 0;
      let todayInc = 0;

      docs.forEach(data => {
        const amount = data.amount || 0;
        const dateStr = data.date && typeof data.date === 'string' ? data.date.split('T')[0] : '';

        if (data.type === 'income' || data.type === 'receita') {
          total += amount;
          if (data.status === 'paid' || data.status === 'received' || data.status === 'pago') paid += amount;
          else pending += amount;
          
          if (dateStr === todayStr) {
            todayInc += amount;
          }
        }
      });
      return { total, paid, pending, today: todayInc };
    };

    let subFinancialDocs: any[] = [];
    let entryFinancialDocs: any[] = [];

    const updateFinancialStats = () => {
      const stats = processFinancialDocs([...subFinancialDocs, ...entryFinancialDocs]);
      setFinancialStats(stats);
      saveToCache('financialStats', stats);
    };

    const limitFinance = IS_STUDIO_PREVIEW ? 50 : 100;

    if (isDebugActive) {
      console.log(`[ELIZA] loading transactions query for path ${transPath} (since: ${startOfMonthISO}, limit: ${limitFinance})...`);
    }
    logQuery('Dashboard', 'transactions', { clinicId: clinic.id }, limitFinance);
    const qSubFinance = query(
      collection(db, 'clinics', clinic.id, 'transactions'),
      where('date', '>=', startOfMonthISO),
      limit(limitFinance)
    );
    unsubFinance = onSnapshot(qSubFinance, (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] transactions loaded: ${snap.size} docs`);
      }
      subFinancialDocs = snap.docs.map(d => d.data());
      updateFinancialStats();
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard transactions query (${transPath}):`, err.message);
      if (err.message?.includes('index')) {
        if (isDebugActive) {
          console.log(`[ELIZA] trying fallback for transactions (limited scan)...`);
        }
        const qFallback = query(collection(db, 'clinics', clinic.id, 'transactions'), limit(limitFinance));
        unsubFinance = onSnapshot(qFallback, (s) => {
          subFinancialDocs = s.docs.map(d => d.data()).filter(d => (d.date || '') >= startOfMonthISO);
          updateFinancialStats();
        });
      } else {
        handleFirestoreError(err, OperationType.GET, transPath);
      }
    });

    if (isDebugActive) {
      console.log(`[ELIZA] loading financial_entries query for path ${entriesPath} (since: ${startOfMonthISO}, limit: ${limitFinance})...`);
    }
    const qEntriesFinance = query(
      collection(db, 'clinics', clinic.id, 'financial_entries'),
      where('date', '>=', startOfMonthISO),
      limit(limitFinance)
    );
    unsubEntriesFinance = onSnapshot(qEntriesFinance, (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] financial_entries loaded: ${snap.size} docs`);
      }
      entryFinancialDocs = snap.docs.map(d => d.data());
      updateFinancialStats();
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard financial_entries query (${entriesPath}):`, err.message);
      if (err.message?.includes('index')) {
        if (isDebugActive) {
          console.log(`[ELIZA] trying fallback for financial_entries (limited scan)...`);
        }
        const qFallback = query(collection(db, 'clinics', clinic.id, 'financial_entries'), limit(limitFinance));
        unsubEntriesFinance = onSnapshot(qFallback, (s) => {
          entryFinancialDocs = s.docs.map(d => d.data()).filter(d => (d.date || '') >= startOfMonthISO);
          updateFinancialStats();
        });
      } else {
        handleFirestoreError(err, OperationType.GET, entriesPath);
      }
    });

    // Operational Pulse Data
    if (isDebugActive) {
      console.log(`[ELIZA] loading clinic_issues query...`);
    }
    unsubIssues = onSnapshot(query(collection(db, 'clinics', clinic.id, 'clinic_issues'), limit(50)), (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] clinic_issues loaded: ${snap.size} docs`);
      }
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).filter((i: any) => i.status !== 'Resolvido').slice(0, 3);
      setActiveIssues(data);
      saveToCache('activeIssues', data);
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard clinic_issues query:`, err.message);
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/clinic_issues`);
    });

    if (isDebugActive) {
      console.log(`[ELIZA] loading pending_items query...`);
    }
    unsubTasks = onSnapshot(query(collection(db, 'clinics', clinic.id, 'pending_items'), limit(100)), (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] pending_items loaded: ${snap.size} docs`);
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      // Sort client-side by date/time or createdAt so newer items are first
      items.sort((a: any, b: any) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        if (timeA !== timeB) return timeB - timeA;
        return (b.resolvedAt || '').localeCompare(a.resolvedAt || '');
      });

      const pending = items.filter((t: any) => t.status === 'pending');
      const resolved = items.filter((t: any) => t.status === 'resolved' || t.status === 'completed' || t.status === 'atendido');

      setPendingTasks(pending);
      setResolvedTasks(resolved);
      saveToCache('pendingTasks', pending);
      saveToCache('resolvedTasks', resolved);
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard pending_items query:`, err.message);
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/pending_items`);
    });

    if (isDebugActive) {
      console.log(`[ELIZA] loading internal_notes query...`);
    }
    unsubNotes = onSnapshot(query(collection(db, 'clinics', clinic.id, 'internal_notes'), limit(100)), (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] internal_notes loaded: ${snap.size} docs`);
      }
      const notes = snap.docs.map(d => d.data() as any);
      const pending = notes.filter(n => n.status === 'pendente' || n.status === 'em_andamento').length;
      const urgent = notes.filter(n => n.priority === 'urgente' && n.status !== 'resolvido').length;
      const tDay = getLocalDateString();
      const overdue = notes.filter(n => n.due_date && n.due_date < tDay && n.status !== 'resolvido').length;
      
      const noteStats = { pending, urgent, overdue };
      setInternalNotesStats(noteStats);
      saveToCache('internalNotesStats', noteStats);
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard internal_notes query:`, err.message);
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/internal_notes`);
    });

    if (isDebugActive) {
      console.log(`[ELIZA] loading daily_closings query...`);
    }
    unsubClosing = onSnapshot(query(collection(db, 'clinics', clinic.id, 'daily_closings'), orderBy('createdAt', 'desc'), limit(1)), (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] daily_closings loaded: ${snap.size} docs`);
      }
      if (!snap.empty) {
        const item = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setLastClosing(item);
        saveToCache('lastClosing', item);
      }
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard daily_closings query:`, err.message);
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/daily_closings`);
    });

    // Recent Activity Log
    if (isDebugActive) {
      console.log(`[ELIZA] loading activity_logs query...`);
    }
    unsubActivity = onSnapshot(query(collection(db, 'clinics', clinic.id, 'activity_logs'), orderBy('timestamp', 'desc'), limit(6)), (snap) => {
      if (isDebugActive) {
        console.log(`[ELIZA] activity_logs loaded: ${snap.size} docs`);
      }
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setRecentActivity(logs);
      saveToCache('recentActivity', logs);
    }, (err) => {
      console.error(`[ELIZA] ERROR in dashboard activity_logs query:`, err.message);
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/activity_logs`);
    });

    // Launch automated missing evolution check sweep upon landing on dashboard
    const dashboardCheckTodayStr = getLocalDateString();
    ClinicalEvolutionMonitorService.checkDailyMissingEvolutions(clinic.id, dashboardCheckTodayStr);

    return () => {
      if (isDebugActive) {
        console.log("[ELIZA] exiting dashboard bootstrap (unmounting listeners)");
      }
      unsubToday();
      unsubFinance();
      unsubEntriesFinance();
      unsubIssues();
      unsubTasks();
      unsubNotes();
      unsubClosing();
      unsubActivity();
    };
  }, [clinic]);

  const generateOperationalPulse = async () => {
    if (!clinic || isAnalyzing) return;
    if (dashboardCache?.aiAnalysis) {
      return; // Already cached AI pulse, skip calling Gemini
    }
    setIsAnalyzing(true);
    try {
      const ai = getGenAI();
      const pulsePrompt = `
        Analise o estado operacional desta clínica odontológica hoje (${new Date().toLocaleDateString()}):
        - Consultas Hoje: ${appointmentCount}
        - Faturamento Previsto Hoje: R$ ${financialStats.today}
        - Problemas no Radar: ${activeIssues.length}
        - Pendências Urgentes: ${pendingTasks.length}
        - Último Fechamento: ${lastClosing?.status === 'balanced' ? 'Conciliado' : 'Divergente'}
        
        Aja como ELIZA. Gere UM insight operacional CRÍTICO e PRÁTICO para o dia de hoje, em apenas duas frases curtas. 
        O objetivo é ajudar o gestor a tomar decisões agora. Use tom de parceira estratégica.
      `;
      const result = await ai.models.generateContent({
        model: AI_CONFIG.model,
        contents: [{ role: "user", parts: [{ text: pulsePrompt }] }]
      });
      setAiAnalysis(result.text);
      saveToCache('aiAnalysis', result.text);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (clinic && (appointmentCount > 0 || activeIssues.length > 0 || pendingTasks.length > 0)) {
      generateOperationalPulse();
    }
  }, [appointmentCount, activeIssues.length, pendingTasks.length, clinic]);

  const stats = [
    { label: 'Agenda de Hoje', value: appointmentCount.toString(), icon: Calendar, sub: `${waitingCount} na clínica`, type: 'highlight' },
    { label: 'Previsto Hoje', value: `R$ ${financialStats.today.toLocaleString('pt-BR')}`, icon: DollarSign, sub: 'Faturamento diário', type: 'positive' },
    { label: 'Ações no Radar', value: activeIssues.length.toString(), icon: Activity, sub: 'Problemas ativos', type: 'warning' },
    { label: 'Recados Pendentes', value: internalNotesStats.pending.toString(), icon: MessageCircle, sub: `${internalNotesStats.urgent} urgentes`, type: 'neutral', action: 'notes' },
    { label: 'Pendências', value: pendingTasks.length.toString(), icon: ClipboardCheck, sub: 'Prioridades do time', type: 'neutral' },
  ];

  const getAiInsights = () => {
    const insights = [];
    
    if (waitingCount > 0) {
      insights.push({
        title: 'Fluxo na Clínica',
        content: `Você tem ${waitingCount} ${waitingCount === 1 ? 'paciente' : 'pacientes'} aguardando ou em atendimento agora.`,
        severity: 'info',
        action: 'Ver Recepção'
      });
    }

    if (pendingConfirmations > 0) {
      insights.push({
        title: 'Confirmações Pendentes',
        content: `Existem ${pendingConfirmations} horários de hoje ainda não confirmados. Sugiro enviar lembrete via WhatsApp.`,
        severity: 'warning',
        action: 'Enviar Lembretes'
      });
    }

    if (financialStats.today > 5000) {
      insights.push({
        title: 'Excelente Batimento Diário',
        content: `O faturamento previsto para hoje é de R$ ${financialStats.today.toLocaleString()}. Ótima performance operacional!`,
        severity: 'success',
        action: 'Ver Detalhes'
      });
    }

    if (insights.length === 0) {
      insights.push({
        title: 'Relatório Matinal',
        content: 'Tudo sob controle. Sua agenda está organizada e não há pendências críticas no momento.',
        severity: 'success',
        action: 'Ver Guia'
      });
    }

    return insights;
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6 lg:p-10 scroll-smooth custom-scrollbar">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            {getGreeting()}, {profile?.name?.split(' ')[0] || 'Doutor(a)'}
          </h2>
          <p className="text-slate-500 text-sm font-medium mt-1">A ELIZA já organizou sua agenda e preparou os insights do dia.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
             {[1].map(i => (
               <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-teal-600 flex items-center justify-center text-[10px] font-bold text-white shadow-sm ring-2 ring-teal-50">
                 {profile?.name?.charAt(0) || 'U'}
               </div>
             ))}
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Equipe Online</p>
        </div>
      </div>

      {/* stats Grid - Operational KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className={`p-6 rounded-[2rem] border shadow-sm hover:shadow-md transition-all group cursor-pointer ${
              stat.type === 'highlight' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200'
            }`}
            onClick={() => (stat as any).action && onNavigate?.((stat as any).action)}
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-2xl transition-colors ${
                stat.type === 'highlight' ? 'bg-white/10' : 'bg-slate-50 group-hover:bg-teal-50'
              }`}>
                <stat.icon className={`w-6 h-6 ${
                  stat.type === 'highlight' ? 'text-teal-400' : 'text-slate-400 group-hover:text-teal-600'
                }`} />
              </div>
              <div className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                stat.type === 'highlight' ? 'bg-white/10 text-teal-400' : 'bg-slate-50 text-slate-400'
              }`}>
                Operational
              </div>
            </div>
            <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-1 ${
              stat.type === 'highlight' ? 'text-slate-400' : 'text-slate-500'
            }`}>{stat.label}</p>
            <h3 className="text-3xl font-black tracking-tight">{stat.value}</h3>
            <p className={`text-[10px] font-bold mt-2 ${
              stat.type === 'highlight' ? 'text-teal-400/80' : 'text-slate-400'
            }`}>{stat.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Command Center Column */}
        <div className="lg:col-span-8 space-y-10">
          
          {/* Section: Central de Comandos (Операционный центр) */}
          <section>
            <div className="flex items-center justify-between mb-6">
               <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                 <Activity className="w-4 h-4 text-teal-600" />
                 Painel de Comandos
               </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               {[
                 { label: 'Novo Paciente', icon: UserPlus, color: 'bg-teal-600', action: 'patients' },
                 { label: 'Agendar Consulta', icon: Calendar, color: 'bg-slate-900', action: 'agenda' },
                 { label: 'Fechamento de Caixa', icon: Wallet, color: 'bg-slate-900', action: 'closing' },
                 { label: 'Reportar Problema', icon: AlertCircle, color: 'bg-rose-600', action: 'radar' },
               ].map((action) => (
                 <button 
                  key={action.label}
                  onClick={() => onNavigate?.(action.action)}
                  className="flex flex-col items-center justify-center p-6 bg-white border border-slate-200 rounded-[2.5rem] hover:border-teal-400 transition-all group shadow-sm"
                 >
                   <div className={`w-12 h-12 ${action.color} rounded-2xl flex items-center justify-center text-white mb-3 shadow-lg shadow-slate-900/10 group-hover:scale-110 transition-transform`}>
                      <action.icon className="w-5 h-5" />
                   </div>
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-tight">{action.label}</span>
                 </button>
               ))}
            </div>
          </section>

          {/* AI Intelligence ELIZA - OPERATIONAL PULSE */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600 animate-pulse" />
                Pulso Operacional ELIZA
              </h3>
              <button className="text-[9px] font-bold text-slate-400 border-b border-slate-200">Ver Todas as Recomendações</button>
            </div>
            <div className="bg-white rounded-[3rem] p-10 border-2 border-teal-50 shadow-xl shadow-teal-600/5 relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8">
                  <BrainCircuit className="w-12 h-12 text-teal-600/10" />
               </div>
               <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-6">
                     <span className="px-3 py-1 bg-teal-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest">Análise em Tempo Real</span>
                     {isAnalyzing && <span className="text-[9px] font-bold text-teal-600 animate-pulse italic">A ELIZA está pensando...</span>}
                  </div>
                  <h4 className="text-xl font-black text-slate-900 tracking-tight mb-4 max-w-lg">
                    {aiAnalysis || "Aguardando dados críticos para gerar o diagnóstico matinal da sua clínica."}
                  </h4>
                  <div className="flex flex-wrap gap-4 mt-8">
                     <button onClick={() => onNavigate?.('tasks')} className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-teal-600 transition-all">Priorizar Pendências</button>
                     <button onClick={() => onNavigate?.('radar')} className="bg-white border border-slate-200 text-slate-600 px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all">Ver Radar</button>
                  </div>
               </div>
            </div>
          </section>

          {/* UI Panel: Monitor Compacto de Pendências Clínicas ELIZA */}
          {(() => {
            // Helper to map and sanitize Firestore pending task records
            const mapAndNormalizeTask = (item: any) => {
              const type = item.type || 'missing_clinical_evolution';
              let origin = item.origin || 'evolução';
              let priority = item.priority || 'Média';
              let title = item.title || 'Falta Evolução';
              let displayType = 'Evolução clínica';

              if (type.includes('evolution') || type.includes('missing_clinical_evolution')) {
                origin = 'evolução';
                title = item.title || 'Falta Registar Evolução';
                displayType = 'Evolução Clínica';
                priority = item.priority || 'Alta';
              } else if (type.includes('planning') || type.includes('planning_required')) {
                origin = 'planejamento';
                title = item.title || 'Planejamento Pendente';
                displayType = 'Planejamento Cirúrgico';
                priority = item.priority || 'Urgente';
              } else if (type.includes('contract')) {
                origin = 'contrato';
                title = item.title || 'Assinatura de Contrato';
                displayType = 'Contrato de Serviço';
                priority = item.priority || 'Média';
              } else if (type.includes('image') || type?.includes('photo')) {
                origin = 'imagem';
                title = item.title || 'Upload Foto Diagnóstico';
                displayType = 'Registro Fotográfico';
                priority = item.priority || 'Baixa';
              }

              const rawDate = item.dueDate || item.date || item.appointmentDate || (item.createdAt ? (typeof item.createdAt === 'string' ? item.createdAt.split('T')[0] : '') : '') || getLocalDateString();
              const dateStr = rawDate === getLocalDateString() ? 'Hoje' : rawDate;

              return {
                ...item,
                type,
                origin,
                priority,
                title,
                displayType,
                dateStr,
                dueDate: rawDate
              };
            };

            // Inline handler to update Firestore professional assignments instantly
            const handleAssignProfessional = async (taskId: string, memberId: string) => {
              if (!clinic) return;
              if (!memberId) {
                setAssigningTaskId(null);
                return;
              }
              const member = staff.find(s => s.id === memberId);
              if (!member) return;

              setAssigningLoading(true);
              try {
                const taskRef = doc(db, 'clinics', clinic.id, 'pending_items', taskId);
                await updateDoc(taskRef, {
                  professionalId: member.id,
                  professionalName: member.name,
                  staffId: member.id,
                  staffName: member.name
                });
                console.log('[CLINICAL_PENDING_PROFESSIONAL_ASSIGNED]', taskId, member.name);
                setAssigningTaskId(null);
              } catch (err: any) {
                console.error('Error assigning professional:', err);
                alert("Erro ao atribuir profissional: " + err.message);
              } finally {
                setAssigningLoading(false);
              }
            };

            // Inline instant mark resolved
            const handleInstantResolve = async (task: any) => {
              if (!clinic) return;

              // Security permission check
              const role = (profile?.role || '').toLowerCase();
              const isAdminOrGestor = ['admin', 'owner', 'manager', 'gestor', 'diretor', 'financeiro'].includes(role);
              const hasExplicitPermission = (profile as any)?.permissions?.includes('resolver pendências clínicas') || (profile as any)?.isClinicalProvider;
              const isResponsible = profile?.uid === task.professionalId || profile?.uid === task.responsibleUid || profile?.name === task.professionalName || profile?.name === task.staffName;

              if (!isAdminOrGestor && !hasExplicitPermission && !isResponsible) {
                console.warn('[CLINICAL_PENDING_PERMISSION_DENIED]', profile?.uid);
                alert("Você não possui permissão para resolver esta pendência.");
                return;
              }

              const conf = window.confirm(`Deseja marcar essa pendência de ${task.patientName || 'paciente'} como resolvida no sistema?`);
              if (!conf) return;

              try {
                await ClinicalEvolutionMonitorService.resolveSpecificPendingItem(clinic.id, task.id);
                
                // Add log to Patient History subcollection
                if (task.patientId) {
                  await addDoc(collection(db, 'clinics', clinic.id, 'patients', task.patientId, 'history'), {
                    action: 'pending_resolved_instant',
                    title: 'Pendência Clínica Concluída',
                    description: `A pendência de tipo "${mapAndNormalizeTask(task).displayType}" foi resolvida com sucesso diretamente pelo monitor.`,
                    resolvedBy: profile?.name || 'Sistema',
                    resolvedByUid: profile?.uid || '',
                    createdAt: new Date().toISOString()
                  });
                }
                
                console.log('[CLINICAL_PENDING_RESOLVED]', task.id);
                alert("Pendência resolvida com sucesso!");
              } catch (err: any) {
                console.error('[CLINICAL_PENDING_RESOLVER_ERROR]', err);
                alert("Erro ao resolver: " + err.message);
              }
            };

            // Premium test simulation engine to populate real Firebase Firestore tasks
            const handleSimulatePendingTask = async (type: string) => {
              if (!clinic) return;
              try {
                // Find a real patient inside current appointments list or fallback logically
                const randomPatientId = todayAppointments[0]?.patientId || 'temp_patient_eliza_1';
                const randomPatientName = todayAppointments[0]?.patientName || 'Isabela Maria de Oliveira';
                const randomStaffId = staff[0]?.id || profile?.uid || 'temp_staff_1';
                const randomStaffName = staff[0]?.name || profile?.name || 'Dr. Ricardo Novaes';

                let title = '';
                let description = '';
                let origin = '';
                let priority = 'Média';

                if (type === 'missing_clinical_evolution') {
                  title = 'Falta Evolução Clínica';
                  description = `O atendimento de ${randomPatientName} foi finalizado, mas não possui documento de evolução registrado.`;
                  origin = 'evolução';
                  priority = 'Urgente';
                } else if (type === 'planning_pending') {
                  title = 'Planejamento Cirúrgico Exigido';
                  description = `Paciente ${randomPatientName} necessita de planejamento cirúrgico/HOF no prontuário.`;
                  origin = 'planejamento';
                  priority = 'Alta';
                } else if (type === 'contract_pending') {
                  title = 'Contrato Odontológico Pendente';
                  description = `Pendente assinatura digital de contrato de prestação de serviços para ${randomPatientName}.`;
                  origin = 'contrato';
                  priority = 'Média';
                } else if (type === 'image_pending') {
                  title = 'Upload de Fotografias de Diagnóstico';
                  description = `Faltam fotos de acompanhamento clínico e Raio-X inicial de face para ${randomPatientName}.`;
                  origin = 'imagem';
                  priority = 'Baixa';
                }

                await addDoc(collection(db, 'clinics', clinic.id, 'pending_items'), {
                  type,
                  patientId: randomPatientId,
                  patientName: randomPatientName,
                  appointmentId: todayAppointments[0]?.id || '',
                  professionalId: randomStaffId,
                  professionalName: randomStaffName,
                  dueDate: getLocalDateString(),
                  status: 'pending',
                  priority,
                  origin,
                  title,
                  description,
                  createdAt: new Date().toISOString()
                });

                console.log('[CLINICAL_PENDING_SIMULATED]', type);
                alert(`Sucesso! Pendência real de "${getPendingTypeLabel(type)}" inserida no Firestore clínica "${clinic.name}"!`);
              } catch (err: any) {
                alert("Erro ao simular: " + err.message);
              }
            };

            const getPendingTypeLabel = (type: string) => {
              if (type?.includes('evolution') || type?.includes('missing_clinical_evolution')) return 'Evolução Clínica';
              if (type?.includes('planning')) return 'Planejamento Cirúrgico';
              if (type?.includes('contract')) return 'Contrato de Serviços';
              if (type?.includes('image') || type?.includes('photo')) return 'Documento / Imagem';
              return 'Pendência Geral';
            };

            const getPriorityColor = (priority: string) => {
              const p = String(priority).toLowerCase();
              if (p === 'urgente' || p === 'alta') return 'bg-rose-50 border-rose-100/60 text-rose-600';
              if (p === 'média' || p === 'médio') return 'bg-amber-50 border-amber-100/60 text-amber-700';
              return 'bg-slate-50 border-slate-150 text-slate-500';
            };

            const getOriginColor = (origin: string) => {
              const o = String(origin).toLowerCase();
              if (o.includes('evolu') || o.includes('missing_clinical_evolution')) return 'bg-teal-50 text-teal-700 border-teal-100';
              if (o.includes('planeja')) return 'bg-amber-50 text-amber-700 border-amber-100';
              if (o.includes('contrat')) return 'bg-indigo-50 text-indigo-700 border-indigo-100';
              if (o.includes('imag') || o.includes('foto')) return 'bg-blue-50 text-blue-700 border-blue-100';
              return 'bg-slate-50 text-slate-600 border-slate-200';
            };

            // Client-side search and filtering logic
            const allItems = !showEvolutionHistory ? pendingTasks : resolvedTasks;
            
            // Map types & normalize first
            const normalizedItems = allItems.map(item => mapAndNormalizeTask(item));
            
            // Standard search filters
            const [searchQuery, setSearchQuery] = useState('');
            const [selectedProfessionalFilterId, setSelectedProfessionalFilterId] = useState('');

            const filteredItems = normalizedItems.filter(item => {
              // Primary categorical filters
              if (monitorFilter === 'evolution' && item.origin !== 'evolução') return false;
              if (monitorFilter === 'planning' && item.origin !== 'planejamento') return false;
              if (monitorFilter === 'contracts' && item.origin !== 'contrato') return false;
              if (monitorFilter === 'images' && item.origin !== 'imagem') return false;

              // Unassigned filter
              if (monitorFilter === 'unassigned') {
                const pId = item.professionalId || item.responsibleUid || item.staffId || '';
                if (pId && pId !== 'not-assigned') return false;
              }

              // Urgent filter
              if (monitorFilter === 'urgent') {
                const prio = String(item.priority).toLowerCase();
                if (prio !== 'urgente' && prio !== 'alta' && item.severity !== 'high') return false;
              }

              // Today filter
              const todayStr = getLocalDateString();
              if (monitorFilter === 'today') {
                if (item.dueDate !== todayStr) return false;
              }

              // Overdue/Past filter
              if (monitorFilter === 'overdue') {
                if (item.dueDate >= todayStr || item.status !== 'pending') return false;
              }

              // Selected professional dropdown filter
              if (selectedProfessionalFilterId) {
                const pId = item.professionalId || item.responsibleUid || item.staffId || '';
                if (pId !== selectedProfessionalFilterId) return false;
              }

              // Keyword search match
              if (searchQuery.trim() !== '') {
                const query = searchQuery.toLowerCase();
                const patientName = String(item.patientName || '').toLowerCase();
                const profName = String(item.professionalName || item.staffName || '').toLowerCase();
                const procedure = String(item.procedureName || item.description || '').toLowerCase();
                
                return patientName.includes(query) || profName.includes(query) || procedure.includes(query);
              }

              return true;
            });

            // Log rendering action as required
            console.log('[CLINICAL_MONITOR_COMPACT_RENDER]', filteredItems.length);

            return (
              <section className="bg-white rounded-[2.5rem] p-6 border border-slate-200/80 shadow-md shadow-slate-100/40 font-sans">
                {/* Section Title banner */}
                <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-slate-900 rounded-xl text-white">
                      <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                        Painel Monitor de Pendências Clínicas
                      </h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                        Ficha consolidada com atalhos de resolução rápida
                      </p>
                    </div>
                  </div>

                  {/* Toggle Mode: Pendings vs Resolved */}
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start xl:self-auto">
                    <button
                      onClick={() => {
                        setShowEvolutionHistory(false);
                        setMonitorFilter('all');
                      }}
                      className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all select-none cursor-pointer ${!showEvolutionHistory ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Pendentes ({pendingTasks.length})
                    </button>
                    <button
                      onClick={() => {
                        setShowEvolutionHistory(true);
                        setMonitorFilter('all');
                      }}
                      className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all select-none cursor-pointer ${showEvolutionHistory ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Histórico Solucionados ({resolvedTasks.length})
                    </button>
                  </div>
                </header>

                {/* Live simulation triggers (Playground for clinical test logs) */}
                <div className="flex flex-wrap gap-2 items-center bg-teal-50/40 p-3 rounded-2xl border border-teal-100/60 mb-4">
                  <span className="text-[9px] font-black text-teal-800 uppercase tracking-widest flex items-center gap-1.5 shrink-0 select-none">
                    <Sparkles className="w-3.5 h-3.5 animate-spin text-teal-600" /> SIMULAR PENDÊNCIAS FIRESTORE:
                  </span>
                  <button onClick={() => handleSimulatePendingTask('missing_clinical_evolution')} className="bg-white hover:bg-slate-50 border border-teal-200 text-[8px] font-black text-teal-700 uppercase tracking-wide px-2.5 py-1.5 rounded-lg transition-all cursor-pointer">
                    + Evolução
                  </button>
                  <button onClick={() => handleSimulatePendingTask('planning_pending')} className="bg-white hover:bg-slate-50 border border-teal-200 text-[8px] font-black text-teal-700 uppercase tracking-wide px-2.5 py-1.5 rounded-lg transition-all cursor-pointer">
                    + Planejamento
                  </button>
                  <button onClick={() => handleSimulatePendingTask('contract_pending')} className="bg-white hover:bg-slate-50 border border-teal-200 text-[8px] font-black text-teal-700 uppercase tracking-wide px-2.5 py-1.5 rounded-lg transition-all cursor-pointer">
                    + Contrato
                  </button>
                  <button onClick={() => handleSimulatePendingTask('image_pending')} className="bg-white hover:bg-slate-50 border border-teal-200 text-[8px] font-black text-teal-700 uppercase tracking-wide px-2.5 py-1.5 rounded-lg transition-all cursor-pointer">
                    + Imagem/Anexo
                  </button>
                </div>

                {/* Subheader: Search Query & Professional Pulldown */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
                  <div className="md:col-span-8 relative flex items-center">
                    <Search className="w-4 h-4 absolute left-3 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Pesquisar por paciente, profissional ou procedimento..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs font-medium pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-slate-400 transition-all font-sans placeholder-slate-400"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <select
                      value={selectedProfessionalFilterId}
                      onChange={(e) => setSelectedProfessionalFilterId(e.target.value)}
                      className="w-full text-xs font-black text-slate-700 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-slate-400 font-sans"
                    >
                      <option value="">Filtrar Profissional...</option>
                      {staff.map(member => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Custom badges filter selectors */}
                <div className="flex flex-wrap gap-1.5 mb-4 border-b border-slate-100 pb-3">
                  {[
                    { id: 'all', label: 'Todas as origens' },
                    { id: 'evolution', label: 'Evolução' },
                    { id: 'planning', label: 'Planejamentos' },
                    { id: 'contracts', label: 'Contratos' },
                    { id: 'images', label: 'Imagens' },
                    { id: 'unassigned', label: 'Sem profissional asignado' },
                    { id: 'urgent', label: 'Urgentes' },
                    { id: 'today', label: 'Para hoje' },
                    { id: 'overdue', label: 'Atrasadas' },
                  ].map((btn) => (
                    <button
                      key={btn.id}
                      onClick={() => setMonitorFilter(btn.id)}
                      className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                        monitorFilter === btn.id 
                          ? 'bg-slate-900 border border-slate-900 text-white' 
                          : 'bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                {/* Main Table Layout container */}
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-left border-collapse font-sans min-w-[700px]">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-100 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                        <th className="py-3 px-4">Tipo / Diagnóstico</th>
                        <th className="py-3 px-4">Paciente</th>
                        <th className="py-3 px-4">Responsável</th>
                        <th className="py-3 px-4 text-center">Data Limite</th>
                        <th className="py-3 px-4 text-center">Prioridade</th>
                        <th className="py-3 px-4 text-right">Ações Rápidas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-400">
                            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                              <ClipboardCheck className="w-8 h-8 text-slate-300 mb-2 animate-pulse" />
                              <p className="font-bold text-xs text-slate-650">Nenhuma pendência clínica localizada</p>
                              <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">Todos os prontuários e agendamentos estão em dia</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredItems.map((task) => {
                          const pColor = getPriorityColor(task.priority);
                          const oColor = getOriginColor(task.origin);
                          const isUnassigned = !task.professionalId || task.professionalId === 'not-assigned';

                          return (
                            <tr key={task.id} className="hover:bg-slate-50/40 transition-colors group">
                              {/* 1. Category / title */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2 max-w-[220px]">
                                  <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider border shrink-0 ${oColor}`}>
                                    {task.origin}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="font-bold text-slate-800 truncate" title={task.title}>{task.title}</p>
                                    <p className="text-[9px] text-slate-400 truncate font-medium mt-0.5">{task.description}</p>
                                  </div>
                                </div>
                              </td>

                              {/* 2. Patient name */}
                              <td className="py-3 px-4 font-bold text-slate-800">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-black flex items-center justify-center text-[10px] uppercase select-none">
                                    {String(task.patientName || 'P').charAt(0)}
                                  </div>
                                  <span className="truncate max-w-[130px]">{task.patientName || 'Não Identificado'}</span>
                                </div>
                              </td>

                              {/* 3. Professional assigning dropdown picker */}
                              <td className="py-3 px-4">
                                {assigningTaskId === task.id ? (
                                  <div className="flex items-center gap-1 min-w-[140px]">
                                    <select
                                      disabled={assigningLoading}
                                      onChange={(e) => handleAssignProfessional(task.id, e.target.value)}
                                      className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-[10px] font-bold text-slate-800 outline-none focus:border-slate-550"
                                      defaultValue=""
                                    >
                                      <option value="">Atribuir a...</option>
                                      {staff.map(member => (
                                        <option key={member.id} value={member.id}>{member.name}</option>
                                      ))}
                                    </select>
                                    <button
                                      disabled={assigningLoading}
                                      onClick={() => setAssigningTaskId(null)}
                                      className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 min-w-[130px]">
                                    <span className={`font-bold ${isUnassigned ? 'text-amber-500 italic' : 'text-slate-600'}`}>
                                      {task.professionalName || task.staffName || 'Não atribuído'}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setAssigningTaskId(task.id);
                                        console.log('[CLINICAL_PENDING_RESOLVER_OPEN] Assign mode:', task.id);
                                      }}
                                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200/60 rounded text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
                                      title="Atribuir Profissional"
                                    >
                                      <FileEdit className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </td>

                              {/* 4. Due Date */}
                              <td className="py-3 px-4 text-center font-bold text-slate-500">
                                <span className={task.dateStr === 'Hoje' ? "text-rose-500 font-black animate-pulse" : ""}>
                                  {task.dateStr}
                                </span>
                              </td>

                              {/* 5. Priority / Status */}
                              <td className="py-3 px-4 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[8.5px] font-bold uppercase ${pColor}`}>
                                  {task.priority || 'Médio'}
                                </span>
                              </td>

                              {/* 6. Quick Action buttons */}
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Resolver Opens Side Panel */}
                                  <button
                                    onClick={() => {
                                      setSelectedTaskToResolve(task);
                                    }}
                                    className="px-2.5 py-1.5 bg-slate-900 border border-slate-900 hover:bg-slate-850 hover:bg-teal-600 hover:border-teal-600 text-white font-black text-[9px] uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                                  >
                                    Resolver
                                  </button>

                                  {/* Navigate to Profile Chart */}
                                  <button
                                    onClick={() => {
                                      if (onSelectPatient && task.patientId) {
                                        onSelectPatient(task.patientId);
                                      }
                                    }}
                                    className="p-1.5 hover:bg-slate-200/60 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                                    title="Abrir Prontuário"
                                  >
                                    <User className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Instant check unresolved */}
                                  <button
                                    onClick={() => handleInstantResolve(task)}
                                    className="p-1.5 hover:bg-slate-200/60 border border-slate-200 rounded-lg text-slate-500 hover:text-emerald-600 transition-colors cursor-pointer"
                                    title="Marcar Resolvido Direto"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mount Drawer Side Resolver Panel */}
                <AnimatePresence>
                  {selectedTaskToResolve && (
                    <ClinicalPendingQuickResolver
                      isOpen={!!selectedTaskToResolve}
                      onClose={() => {
                        setSelectedTaskToResolve(null);
                        setAssigningTaskId(null);
                      }}
                      task={selectedTaskToResolve}
                      staff={staff}
                      clinicId={clinic.id}
                      currentUser={profile}
                      onResolved={(updatedTask) => {
                        // Optimistically update lists instantly
                        if (updatedTask.status === 'resolved') {
                          setPendingTasks(prev => prev.filter(t => t.id !== updatedTask.id));
                          setResolvedTasks(prev => [updatedTask, ...prev]);
                        }
                      }}
                    />
                  )}
                </AnimatePresence>
              </section>
            );
          })()}

          {/* Detailed Agenda Center */}
          <section className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
              <div>
                <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-3">
                  <Clock className="w-5 h-5 text-teal-600" />
                  Agenda de Hoje
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Sincronizado há poucos segundos</p>
              </div>
              <button className="bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest px-6 py-2.5 rounded-xl text-slate-600 hover:bg-slate-50 transition-all shadow-sm">Agenda Completa</button>
            </div>
            <div className="divide-y divide-slate-50">
              {todayAppointments.map((apt) => (
                <div key={apt.id} className="p-6 flex items-center justify-between hover:bg-slate-50/50 transition-all group">
                  <div className="flex items-center gap-6">
                    <div className="text-center w-16">
                      <p className="text-sm font-black text-slate-900">{apt.time || '--:--'}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Horário</p>
                    </div>
                    <div className="w-px h-10 bg-slate-100" />
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 font-black text-sm group-hover:bg-teal-50 group-hover:text-teal-600 transition-all">
                        {(apt.patientName || 'P').charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">{apt.patientName}</p>
                          {(apt as any).inClinic && (
                            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" title="Na clínica" />
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide mt-0.5">{apt.procedure || 'Consulta Geral'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] ${
                        apt.status === 'Confirmado' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                        apt.status === 'waiting' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                        apt.status === 'Aguardando' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                        'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {apt.status === 'waiting' ? 'Chegou na Clínica' : apt.status || 'Agendado'}
                      </span>
                      <button className="text-[9px] font-bold text-slate-400 hover:text-teal-600 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-all">Detalhes do Paciente →</button>
                    </div>
                  </div>
                </div>
              ))}
              {todayAppointments.length === 0 && (
                <div className="py-24 text-center">
                   <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-200 mx-auto mb-6 border-2 border-dashed border-slate-100">
                      <Calendar className="w-8 h-8" />
                   </div>
                   <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhuma consulta registrada para hoje</h4>
                   <button className="mt-6 bg-slate-900 text-white px-8 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl shadow-slate-900/10">Criar Novo Agendamento</button>
                </div>
              )}
            </div>
            <div className="p-6 bg-slate-50 flex justify-center">
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">Exibindo agenda operacional do dia</p>
            </div>
          </section>
        </div>

        {/* Operational Sidebar Dashboard */}
        <div className="lg:col-span-4 space-y-8">
           {/* Financial Health - Performance Mode */}
           <section className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-48 h-48 bg-teal-500/10 rounded-full -mr-24 -mt-24 transition-transform group-hover:scale-110 duration-1000"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-8">
                   <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-teal-400/80">Saúde Financeira</h4>
                   <TrendingUp className="w-5 h-5 text-teal-400" />
                </div>
                <div className="space-y-8">
                  <div>
                    <p className="text-[11px] uppercase opacity-40 font-bold mb-2">Faturamento Hoje</p>
                    <p className="text-4xl font-black tracking-tight">R$ {financialStats.today.toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div className="p-4 bg-white/5 rounded-3xl border border-white/5 backdrop-blur-sm">
                        <p className="text-[9px] uppercase opacity-40 font-bold mb-1">Mês (Auditado)</p>
                        <p className="text-base font-bold text-emerald-400">R$ {(financialStats.paid / 1000).toFixed(1)}k</p>
                     </div>
                     <div className="p-4 bg-white/5 rounded-3xl border border-white/5 backdrop-blur-sm">
                        <p className="text-[9px] uppercase opacity-40 font-bold mb-1">Em Aberto</p>
                        <p className="text-base font-bold text-amber-400">R$ {(financialStats.pending / 1000).toFixed(1)}k</p>
                     </div>
                  </div>
                  <div className="pt-4 border-t border-white/5">
                     <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest opacity-60 mb-3">
                        <span>Meta do Mês</span>
                        <span>{(financialStats.paid / 500).toFixed(0)}%</span>
                     </div>
                     <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-teal-500 rounded-full shadow-[0_0_10px_rgba(20,184,166,0.5)]" 
                          style={{ width: `${Math.min((financialStats.paid / 500), 100)}%` }} 
                        />
                     </div>
                  </div>
                  <button className="w-full bg-teal-500 hover:bg-teal-400 text-slate-900 transition-all font-black py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-teal-500/20">
                    Relatório Detalhado
                  </button>
                </div>
              </div>
           </section>

           {/* AI Operational Log */}
           <section className="bg-white rounded-[3rem] border border-slate-200 p-8 shadow-sm">
             <div className="flex items-center justify-between mb-8">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Atividade Recente</h4>
                <div className="w-8 h-8 bg-slate-50 rounded-xl flex items-center justify-center">
                   <Activity className="w-4 h-4 text-slate-300" />
                </div>
             </div>
             <div className="space-y-8">
               {recentActivity.length > 0 ? recentActivity.map((item, i) => (
                 <div key={item.id} className="flex gap-5 group cursor-default">
                    <div className="relative">
                       <div className={`w-2.5 h-2.5 rounded-full ring-4 ring-white shadow-sm mt-1.5 transition-all group-hover:scale-125 ${
                         item.type === 'success' ? 'bg-emerald-500' : 
                         item.type === 'warning' ? 'bg-amber-500' :
                         item.type === 'error' ? 'bg-rose-500' : 'bg-teal-500'
                       }`}></div>
                       {i !== recentActivity.length - 1 && <div className="absolute top-4 left-1/2 -translate-x-1/2 w-px h-12 bg-slate-100"></div>}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 leading-tight group-hover:text-teal-600 transition-colors uppercase tracking-tight">{item.action}</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-tighter">
                        {item.userName || 'Sistema'} • {item.timestamp?.toDate ? new Date(item.timestamp.toDate()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora'}
                      </p>
                    </div>
                 </div>
               )) : (
                 <div className="py-10 text-center opacity-40">
                   <p className="text-[10px] font-black uppercase tracking-widest">Nenhuma atividade registrada</p>
                 </div>
               )}
             </div>
             <button className="w-full mt-10 py-4 rounded-2xl text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-100 hover:bg-slate-50 transition-all">
               Ver Log de Auditoria
             </button>
           </section>

           {/* Inventory Monitor */}
           <div className="p-8 bg-teal-50/50 rounded-[3rem] border border-teal-100/50 flex items-center justify-between group cursor-pointer hover:bg-teal-50 transition-all shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white rounded-[1.5rem] flex items-center justify-center shadow-sm border border-teal-50 group-hover:rotate-6 transition-transform">
                   <Package className="w-6 h-6 text-teal-600" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-teal-600/60 uppercase tracking-[0.2em] mb-1">Operações</p>
                   <p className="text-sm font-bold text-slate-900 tracking-tight">Estoque Crítico (2)</p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-teal-600 shadow-sm opacity-0 group-hover:opacity-100 transition-all">
                 <ChevronRight className="w-4 h-4" />
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
