import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, getDocs, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Calendar, 
  Search, 
  Plus, 
  Clock, 
  MessageSquare, 
  Send, 
  ChevronRight, 
  SlidersHorizontal, 
  CheckCircle, 
  AlertTriangle,
  User,
  Activity,
  Heart,
  TrendingUp,
  Award,
  ArrowUpRight,
  RefreshCw,
  SearchCheck,
  Zap,
  DollarSign,
  Briefcase,
  Smartphone
} from 'lucide-react';

// Interfaces based on actual request
export interface AestheticProcedure {
  id: string;
  patientId: string;
  patientName: string;
  procedureType: string;
  category: string;
  productUsed: string;
  brand: string;
  area: string;
  appliedAt: string; // ISO date YYYY-MM-DD
  professionalId: string;
  professionalName: string;
  durationEstimateMonths: number;
  recommendedReturnDate: string; // ISO date YYYY-MM-DD
  recallStatus: 'active' | 'upcoming' | 'overdue' | 'completed' | 'cancelled';
  notes: string;
  createdAt: any;
  updatedAt: any;
}

interface Patient {
  id: string;
  name: string;
  phone: string;
  email?: string;
  status?: string;
}

export default function RecallHOFView() {
  const { clinic, user } = useAuth();
  
  // Data State
  const [procedures, setProcedures] = useState<AestheticProcedure[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  // Dynamic Prontuários live states
  const [mainTab, setMainTab] = useState<'crm' | 'prontuario'>('crm');
  const [allTreatments, setAllTreatments] = useState<any[]>([]);
  const [treatmentsLoading, setTreatmentsLoading] = useState(false);
  
  // UI State
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCrmModalOpen, setIsCrmModalOpen] = useState(false);
  const [selectedRecall, setSelectedRecall] = useState<AestheticProcedure | null>(null);
  const [customMsg, setCustomMsg] = useState('');
  
  // Add Form State
  const [formData, setFormData] = useState({
    patientId: '',
    procedureType: 'Toxina Botulínica',
    category: 'Harmonização Facial',
    productUsed: '',
    brand: '',
    area: '',
    appliedAt: new Date().toISOString().split('T')[0],
    durationEstimateMonths: 5,
    notes: ''
  });

  // Biological Defs Table
  const recurrenceStandards = [
    { type: 'Toxina Botulínica', label: 'Botox', interval: '4 a 6 meses (Padrão: 5 meses)', icon: '💉' },
    { type: 'Bioestimulador', label: 'Bioestimulador de Colágeno', interval: '30 dias retorno | 90 dias manutenção | 6-12 meses nova sessão', icon: '✨' },
    { type: 'Preenchimento', label: 'Preenchimento (Ácido Hialurônico)', interval: '6 a 18 meses', icon: '👄' },
    { type: 'Skinbooster', label: 'Protocolo Hidratação Profunda', interval: '30 a 45 dias protocolo', icon: '💧' },
    { type: 'Fios PDO', label: 'Fios de Sustentação PDO', interval: '6 a 12 meses', icon: '🧵' },
    { type: 'Enzimas', label: 'Enzimas Lipolíticas / Redutoras', interval: '7 a 30 dias', icon: '🧴' },
    { type: 'Rinomodelação', label: 'Rinomodelação Estruturada', interval: '6 a 12 meses', icon: '👃' },
  ];

  // Load Real-time Data
  useEffect(() => {
    if (!clinic) return;

    setLoading(true);
    // 1. Fetch Patients for selection dropdown and lookup
    const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
    const unsubPatients = onSnapshot(patientsRef, (snap) => {
      const pList: Patient[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as Patient));
      setPatients(pList);
    });

    // 2. Fetch Aesthetic Procedures
    const procRef = collection(db, 'clinics', clinic.id, 'aesthetic_procedures');
    const unsubProcedures = onSnapshot(procRef, (snap) => {
      const procList: AestheticProcedure[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data
        } as AestheticProcedure;
      });
      setProcedures(procList);
      setLoading(false);
    });

    return () => {
      unsubPatients();
      unsubProcedures();
    };
  }, [clinic]);

  // Load live treatments across all patient charts once patients list loads
  useEffect(() => {
    if (!clinic || patients.length === 0) return;

    const loadAllTreatments = async () => {
      setTreatmentsLoading(true);
      try {
        const promises = patients.map(async (p) => {
          const tRef = collection(db, 'clinics', clinic.id, 'patients', p.id, 'treatments');
          const snap = await getDocs(tRef);
          return snap.docs.map(doc => ({
            id: doc.id,
            patientId: p.id,
            patientName: p.name,
            phone: p.phone || '',
            ...doc.data()
          }));
        });
        const results = await Promise.all(promises);
        const flattened = results.flat();
        console.log("[RECALL_HOF] Live treatments loaded count:", flattened.length);
        setAllTreatments(flattened);
      } catch (err) {
        console.error("[RECALL_HOF] Error fetching patient treatments:", err);
      } finally {
        setTreatmentsLoading(false);
      }
    };

    loadAllTreatments();
  }, [clinic, patients]);

  const hofKeywords = [
    'toxina', 'botox', 'preenchimento', 'labial', 'acid', 'ácido', 'hialuronico', 'hialurônico', 
    'estimulador', 'bioestimulador', 'sculptra', 'radiesse', 'elleva', 'fios', 'pdo', 'sustentacao', 'sustentação',
    'rinomodelacao', 'rinomodelação', 'skinbooster', 'lipopada', 'enzima', 'bichectomia', 'harmonizacao', 'harmonização', 'hof'
  ];

  const detectProcedureType = (desc: string): string => {
    const lowercase = (desc || '').toLowerCase();
    if (lowercase.includes('toxina') || lowercase.includes('botox') || lowercase.includes('dysport') || lowercase.includes('xeomin')) {
      return 'Toxina Botulínica';
    }
    if (lowercase.includes('bioestimulador') || lowercase.includes('sculptra') || lowercase.includes('radiesse') || lowercase.includes('elleva')) {
      return 'Bioestimulador';
    }
    if (lowercase.includes('preenchimento') || lowercase.includes('ácido hialurônico') || lowercase.includes('hialuronico') || lowercase.includes('labial') || lowercase.includes('malar') || lowercase.includes('olheira') || lowercase.includes('boca')) {
      return 'Preenchimento';
    }
    if (lowercase.includes('skinbooster') || lowercase.includes('hidratação profunda')) {
      return 'Skinbooster';
    }
    if (lowercase.includes('fio') || lowercase.includes('pdo') || lowercase.includes('sustentação') || lowercase.includes('sustentacao')) {
      return 'Fios PDO';
    }
    if (lowercase.includes('enzima') || lowercase.includes('lipólise') || lowercase.includes('lipopapada')) {
      return 'Enzimas';
    }
    if (lowercase.includes('rinomodelação') || lowercase.includes('rinomodelacao')) {
      return 'Rinomodelação';
    }
    return 'Toxina Botulínica';
  };

  const handleActivateRecallFromProntuario = (t: any) => {
    const detectedType = detectProcedureType(t.description);
    let est = 6;
    if (detectedType === 'Toxina Botulínica') est = 5;
    else if (detectedType === 'Bioestimulador') est = 3;
    else if (detectedType === 'Preenchimento') est = 12;
    else if (detectedType === 'Skinbooster') est = 1;
    else if (detectedType === 'Fios PDO') est = 8;
    else if (detectedType === 'Enzimas') est = 1;
    else if (detectedType === 'Rinomodelação') est = 10;

    let appliedAt = new Date().toISOString().split('T')[0];
    if (t.completedAt) {
      appliedAt = t.completedAt;
    }

    setFormData({
      patientId: t.patientId,
      procedureType: detectedType,
      category: 'Harmonização Facial',
      productUsed: '',
      brand: '',
      area: t.description || '',
      appliedAt,
      durationEstimateMonths: est,
      notes: `Vínculo automático criado a partir do prontuário eletrônico. Procedimento original: "${t.description}".`
    });
    setIsAddModalOpen(true);
  };

  // Handle Form Change with intelligent return estimate computation
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let updatedFormData = { ...formData, [name]: value };

    // Automatically update recommended duration estimate based on type
    if (name === 'procedureType') {
      let est = 6;
      if (value === 'Toxina Botulínica') est = 5;
      else if (value === 'Bioestimulador') est = 3; // return/maintenance average
      else if (value === 'Preenchimento') est = 12;
      else if (value === 'Skinbooster') est = 1; // 1 month
      else if (value === 'Fios PDO') est = 8;
      else if (value === 'Enzimas') est = 1;
      else if (value === 'Rinomodelação') est = 10;
      
      updatedFormData.durationEstimateMonths = est;
    }

    setFormData(updatedFormData);
  };

  // Add new procedure to DB
  const handleAddProcedure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !formData.patientId) return;

    try {
      const selectedPatient = patients.find(p => p.id === formData.patientId);
      if (!selectedPatient) return;

      // Calculate return date
      const appDate = new Date(formData.appliedAt);
      const returnDateObj = new Date(appDate);
      returnDateObj.setMonth(returnDateObj.getMonth() + Number(formData.durationEstimateMonths));
      const recommendedReturnDate = returnDateObj.toISOString().split('T')[0];

      // Calculate initial status
      let recallStatus: AestheticProcedure['recallStatus'] = 'active';
      const today = new Date();
      if (returnDateObj < today) {
        recallStatus = 'overdue';
      } else {
        // if between today and next 30 days
        const diffTime = Math.abs(returnDateObj.getTime() - today.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 30) {
          recallStatus = 'upcoming';
        }
      }

      const newProcedureData = {
        patientId: formData.patientId,
        patientName: selectedPatient.name,
        procedureType: formData.procedureType,
        category: formData.category,
        productUsed: formData.productUsed || 'N/A',
        brand: formData.brand || 'N/A',
        area: formData.area || 'Face Completa',
        appliedAt: formData.appliedAt,
        professionalId: user?.uid || 'unknown',
        professionalName: user?.displayName || 'Dra. Colaboradora',
        durationEstimateMonths: Number(formData.durationEstimateMonths),
        recommendedReturnDate,
        recallStatus,
        notes: formData.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(collection(db, 'clinics', clinic.id, 'aesthetic_procedures'), newProcedureData);

      // Reset form & Close
      setFormData({
        patientId: '',
        procedureType: 'Toxina Botulínica',
        category: 'Harmonização Facial',
        productUsed: '',
        brand: '',
        area: '',
        appliedAt: new Date().toISOString().split('T')[0],
        durationEstimateMonths: 5,
        notes: ''
      });
      setIsAddModalOpen(false);
    } catch (err) {
      console.error("[Recall HOF] Error creating procedure:", err);
    }
  };

  const handleDeleteProcedure = async (id: string) => {
    if (!clinic) return;
    if (confirm("Deseja realmente apagar este registro estético?")) {
      try {
        await deleteDoc(doc(db, 'clinics', clinic.id, 'aesthetic_procedures', id));
      } catch (err) {
        console.error("Error deleting aesthetic procedure:", err);
      }
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: AestheticProcedure['recallStatus']) => {
    if (!clinic) return;
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'aesthetic_procedures', id), {
        recallStatus: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  // Open Message CRM modal
  const handleOpenCrm = (proc: AestheticProcedure) => {
    setSelectedRecall(proc);
    
    // Choose humanized text templates dynamically
    let template = '';
    if (proc.procedureType === 'Toxina Botulínica') {
      template = `Oi ${proc.patientName.split(' ')[0]} 😊\nPassando para lembrar que já estamos entrando no período ideal para a manutenção da sua Toxina Botulínica (${proc.area}). O efeito biológico costuma durar cerca de 4 a 6 meses.\n\nQuer que eu verifique os melhores dias e horários para agendarmos a sua reavaliação?`;
    } else if (proc.procedureType === 'Bioestimulador') {
      template = `Olá ${proc.patientName.split(' ')[0]}! Tudo bem? ✨\nLembrei aqui que o protocolo do seu Bioestimulador de Colágeno aplicado em ${new Date(proc.appliedAt).toLocaleDateString('pt-BR')} está se aproximando do período de manutenção. Manter o estímulo é fundamental para garantir a firmeza da pele no longo prazo.\n\nQual o melhor período do dia para você vir nos fazer uma visita?`;
    } else {
      template = `Olá ${proc.patientName.split(' ')[0]}! 😊\nComo está o pós-procedimento da sua Harmonização Facial (${proc.procedureType})? Passando para acompanhar seus resultados e planejar seu retoque ideal para manter seus traços descansados e naturais.\n\nQuer que eu reserve uma janela amanhã para conversarmos?`;
    }
    
    setCustomMsg(template);
    setIsCrmModalOpen(true);
  };

  // Build automatic contact score calculations ("ELIZA Recall Score")
  const calculateRecallScore = (proc: AestheticProcedure) => {
    let score = 50; // default medium priority
    
    // 1. Recurrence status
    if (proc.recallStatus === 'overdue') score += 25;
    if (proc.recallStatus === 'upcoming') score += 15;
    
    // 2. High ticket categories get bonus score
    if (proc.procedureType.includes('Preenchimento') || proc.procedureType.includes('Rinomodelação')) {
      score += 15;
    }
    // 3. Estimate duration
    if (proc.durationEstimateMonths <= 5) score += 10; // rapid reapplication like botox
    
    return Math.min(score, 100);
  };

  // Filtering Logic
  const filteredProcedures = procedures.filter(proc => {
    const isMatchedSearch = proc.patientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            proc.procedureType.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!isMatchedSearch) return false;

    if (activeFilter === 'all') return true;
    if (activeFilter === 'botox_vencendo') return proc.procedureType === 'Toxina Botulínica' && proc.recallStatus === 'upcoming';
    if (activeFilter === 'botox_atrasado') return proc.procedureType === 'Toxina Botulínica' && proc.recallStatus === 'overdue';
    if (activeFilter === 'bio_manutencao') return proc.procedureType === 'Bioestimulador' && (proc.recallStatus === 'upcoming' || proc.recallStatus === 'overdue');
    if (activeFilter === 'preenchimento') return proc.procedureType === 'Preenchimento';
    if (activeFilter === 'high_score') return calculateRecallScore(proc) >= 75;
    if (activeFilter === 'overdue') return proc.recallStatus === 'overdue';
    return true;
  });

  // Derived metrics for Dashboard HOF
  const stats = {
    botoxUpcoming: procedures.filter(p => p.procedureType === 'Toxina Botulínica' && p.recallStatus === 'upcoming').length,
    botoxOverdue: procedures.filter(p => p.procedureType === 'Toxina Botulínica' && p.recallStatus === 'overdue').length,
    bioestimuladoresPending: procedures.filter(p => p.procedureType === 'Bioestimulador' && p.recallStatus !== 'completed').length,
    totalOverdue: procedures.filter(p => p.recallStatus === 'overdue').length,
    totalProcedures: procedures.length,
    // simulated forecast value (e.g. 1950.00 BRL per average HOF)
    potentialRevenue: procedures.filter(p => p.recallStatus === 'upcoming' || p.recallStatus === 'overdue')
                        .reduce((sum, p) => sum + (p.procedureType === 'Toxina Botulínica' ? 1200 : 2500), 0)
  };

  return (
    <div className="bg-slate-50 h-full overflow-y-auto p-4 lg:p-8 font-sans pb-24 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-indigo-100 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-indigo-600 animate-pulse" />
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">ELIZA Recall Inteligente HOF</h1>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-relaxed mt-1">
              Ciclos biológicos de Harmonização Facial, monitoramento de reapplication e oportunidade ativa de recorrência estética premium.
            </p>
          </div>
          
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-5 py-3 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-2xl shadow-lg shadow-indigo-600/20 active:scale-95 transition-all self-start md:self-auto"
          >
            <Plus className="w-4 h-4" />
            Lançar Procedimento Realizado
          </button>
        </div>

        {/* 1. Dashboard Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Potencial de Recall</span>
              <p className="text-2xl font-black text-emerald-600">R$ {stats.potentialRevenue.toLocaleString('pt-BR')}</p>
              <span className="text-[9px] text-slate-400 font-bold block">Faturamento HOF estimado a recuperar</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Botox Vencendo</span>
              <p className="text-2xl font-black text-indigo-600">{stats.botoxUpcoming} <span className="text-xs text-slate-400 font-medium">pacientes</span></p>
              <span className="text-[9px] text-indigo-600 font-bold block">Próximos 30 dias (reaplicação)</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Retornos Atrasados</span>
              <p className="text-2xl font-black text-rose-500">{stats.totalOverdue} <span className="text-xs text-slate-400 font-medium font-sans">vencidos</span></p>
              <span className="text-[9px] text-rose-500 font-bold block">Passaram do tempo biológico ideal</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Bioestimuladores</span>
              <p className="text-2xl font-black text-amber-500">{stats.bioestimuladoresPending} <span className="text-xs text-slate-400 font-medium">em fase</span></p>
              <span className="text-[9px] text-slate-400 font-bold block">Acompanhamento e colágeno</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-50 flex items-center justify-center text-amber-600">
              <Heart className="w-5 h-5" />
            </div>
          </div>

        </div>

        {/* 2. IA Predictions & Smart Assistant Alerts */}
        <div className="p-4 sm:p-6 bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-3xl border border-indigo-800 shadow-xl shadow-indigo-950/10 relative overflow-hidden">
          <div className="hidden md:flex absolute right-0 bottom-0 top-0 opacity-10 items-center pr-10">
            <Sparkles className="w-56 h-56 text-white rotate-12" />
          </div>
          
          <div className="relative z-10 space-y-2.5 sm:space-y-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/30 border border-indigo-400/20 text-[8.5px] font-black uppercase tracking-widest text-indigo-300">
                ELIZA INSIGHT COMERCIAL
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            </div>
            
            <h2 className="text-base sm:text-lg font-bold leading-tight">Sugestão de Contato Ativo do Dia</h2>
            <p className="text-[11px] sm:text-xs text-indigo-100 max-w-2xl leading-relaxed">
              Baseado no tempo biológico das aplicações, identificamos que há <strong className="text-indigo-300">{stats.botoxUpcoming} pacientes com Botox prestes a vencer</strong> e outros <strong className="text-indigo-300">{stats.botoxOverdue} pacientes com re-aplicação atrasada</strong>. Realizar abordagens elegantes com estas listas têm até 83% mais chances de fechamento estético recorrente.
            </p>
            
            <div className="flex flex-wrap gap-3 pt-1">
              <div className="p-2 sm:p-2.5 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-2.5">
                <div className="p-1.5 bg-indigo-600/30 rounded-lg text-indigo-300">
                  <TrendingUp className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-[9px] text-indigo-200">Previsão Comercial</p>
                  <p className="text-[11px] font-bold">Botox médio: R$ 1.200,00</p>
                </div>
              </div>

              <div className="p-2 sm:p-2.5 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-2.5">
                <div className="p-1.5 bg-purple-600/30 rounded-lg text-purple-300">
                  <Award className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-[9px] text-indigo-200">Potencial VIP</p>
                  <p className="text-[11px] font-bold">Fidelização em HOF alta</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Biological Return Defs (Tabela de Recorrência) */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">Tabela de Padrão Biológico HOF</h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {recurrenceStandards.map((item, index) => (
              <div key={index} className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl space-y-2 hover:bg-slate-100/50 transition-all">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-xs font-black text-slate-800 leading-tight block">{item.label}</span>
                </div>
                <p className="text-[10px] text-slate-500 font-medium leading-relaxed bg-white px-2 py-1.5 rounded-xl border border-slate-200">
                  {item.interval}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Filter, Search, and CRM Patient List Grid */}
        <div className="space-y-4">
          
          {/* Main Visual tab view mode switcher  */}
          <div className="flex border-b border-slate-200/80 bg-white rounded-2xl p-1 shadow-sm max-w-fit gap-1">
            <button
              onClick={() => setMainTab('crm')}
              className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                mainTab === 'crm' 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/15' 
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              🚀 CRM Recalls Programados ({procedures.length})
            </button>
            <button
              onClick={() => setMainTab('prontuario')}
              className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                mainTab === 'prontuario' 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/15' 
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              📂 Prontuários: Lançamentos HOF ({
                allTreatments.filter(t => {
                  const desc = (t.description || '').toLowerCase();
                  return hofKeywords.some(kw => desc.includes(kw));
                }).length
              })
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </button>
          </div>

          {mainTab === 'crm' ? (
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                {/* Quick Filter Buttons */}
                <div className="flex gap-1 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/80 overflow-x-auto no-scrollbar max-w-full scroll-smooth">
                  {[
                    { id: 'all', label: 'Todos os Recalls' },
                    { id: 'botox_vencendo', label: 'Botox Vencendo (30d)' },
                    { id: 'botox_atrasado', label: 'Botox Atrasados' },
                    { id: 'bio_manutencao', label: 'Bioestimuladores' },
                    { id: 'preenchimento', label: 'Preenchimentos' },
                    { id: 'high_score', label: 'Score Alto (>=75)' },
                    { id: 'overdue', label: 'Atrasados Geral' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setActiveFilter(filter.id)}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                        activeFilter === filter.id 
                          ? 'bg-white text-indigo-700 shadow-sm border border-slate-250' 
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                {/* Live Search */}
                <div className="relative w-full lg:w-80">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar paciente ou procedimento..."
                    className="w-full pl-10 pr-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-500 transition-all font-sans"
                  />
                </div>
              </div>

              {/* Core Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                {loading ? (
                  <div className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-2" />
                    Carregando registros de Harmonização Facial...
                  </div>
                ) : filteredProcedures.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <SearchCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-xs font-bold uppercase tracking-wide">Nenhum recall cadastrado neste filtro</p>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-md mx-auto">Tente redefinir o filtro rápido ou cadastrar novas aplicações clínicas de harmonização.</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop Core Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                            <th className="p-4 pl-6">Paciente</th>
                            <th className="p-4">Procedimento / Área</th>
                            <th className="p-4">Aplicação / Estimativa</th>
                            <th className="p-4">Retorno Ideal</th>
                            <th className="p-4">Score</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right pr-6">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                          {filteredProcedures.map((proc) => {
                            const score = calculateRecallScore(proc);
                            return (
                              <tr key={proc.id} className="hover:bg-slate-50/50 transition-colors">
                                
                                {/* Patient Block */}
                                <td className="p-4 pl-6">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200">
                                      <User className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <span className="font-bold text-slate-800 block">{proc.patientName}</span>
                                      <span className="text-[9px] text-slate-400 font-bold block">{patients.find(p => p.id === proc.patientId)?.phone || 'Sem telefone'}</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Procedure Type & Area */}
                                <td className="p-4">
                                  <div>
                                    <span className="font-bold text-slate-800 block">{proc.procedureType}</span>
                                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-tighter block">Área: {proc.area}</span>
                                  </div>
                                </td>

                                {/* Applied date & estimate */}
                                <td className="p-4">
                                  <div>
                                    <span className="block">{new Date(proc.appliedAt).toLocaleDateString('pt-BR')}</span>
                                    <span className="text-[9px] text-slate-400 font-bold block">{proc.durationEstimateMonths} meses previstos</span>
                                  </div>
                                </td>

                                {/* Recommended return date */}
                                <td className="p-4">
                                  <div className="flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                    <span className="font-bold text-indigo-700">{new Date(proc.recommendedReturnDate).toLocaleDateString('pt-BR')}</span>
                                  </div>
                                </td>

                                {/* Recall Score */}
                                <td className="p-4">
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                                    score >= 80 ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                    score >= 60 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                    'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}>
                                    <Zap className="w-3 h-3" />
                                    {score}
                                  </span>
                                </td>

                                {/* Recall Status badge */}
                                <td className="p-4">
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                    proc.recallStatus === 'overdue' ? 'bg-rose-50 text-rose-600' :
                                    proc.recallStatus === 'upcoming' ? 'bg-amber-50 text-amber-600' :
                                    proc.recallStatus === 'active' ? 'bg-blue-50 text-blue-600' :
                                    proc.recallStatus === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                                    'bg-slate-100 text-slate-400'
                                  }`}>
                                    {proc.recallStatus === 'overdue' ? 'Atrasado' :
                                     proc.recallStatus === 'upcoming' ? 'Retorno Próximo' :
                                     proc.recallStatus === 'active' ? 'Ativo' :
                                     proc.recallStatus === 'completed' ? 'Agendado' : 'Cancelado'}
                                  </span>
                                </td>

                                {/* Actions */}
                                <td className="p-4 text-right pr-6 space-x-1.5 whitespace-nowrap">
                                  <button
                                    onClick={() => handleOpenCrm(proc)}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-100 rounded-xl hover:bg-teal-100 transition-all click-feedback"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    Contatar
                                  </button>
                                  
                                  <select
                                    value={proc.recallStatus}
                                    onChange={(e) => handleUpdateStatus(proc.id, e.target.value as any)}
                                    className="text-[10px] font-bold bg-white border border-slate-200/80 rounded-xl text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 p-1 py-1.5"
                                  >
                                    <option value="active">Ativo</option>
                                    <option value="upcoming">Retorno Próximo</option>
                                    <option value="overdue">Atrasado</option>
                                    <option value="completed">Resolvido</option>
                                    <option value="cancelled">Cancelado</option>
                                  </select>

                                  <button
                                    onClick={() => handleDeleteProcedure(proc.id)}
                                    className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  </button>
                                </td>

                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Core Card List */}
                    <div className="block md:hidden divide-y divide-slate-100">
                      {filteredProcedures.map((proc) => {
                        const score = calculateRecallScore(proc);
                        const phone = patients.find(p => p.id === proc.patientId)?.phone || 'Sem telefone';
                        return (
                          <div key={proc.id} className="p-4 bg-white space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-200 shrink-0">
                                  <User className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-extrabold text-slate-950 text-xs truncate">{proc.patientName}</h4>
                                  <span className="text-[9px] text-slate-400 font-bold block">{phone}</span>
                                </div>
                              </div>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black shrink-0 ${
                                score >= 80 ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                score >= 60 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                <Zap className="w-2.5 h-2.5" />
                                {score}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3 text-[11px] font-semibold text-slate-600 bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
                              <div>
                                <span className="text-[8px] text-slate-400 uppercase tracking-wider block">Procedimento</span>
                                <span className="text-slate-800 font-bold block truncate">{proc.procedureType}</span>
                                <span className="text-[8px] text-slate-400 uppercase tracking-wider block mt-1">Área</span>
                                <span className="text-slate-700 block truncate">{proc.area}</span>
                              </div>
                              <div>
                                <span className="text-[8px] text-slate-400 uppercase tracking-wider block">Aplicação</span>
                                <span className="text-slate-750 block">{new Date(proc.appliedAt).toLocaleDateString('pt-BR')}</span>
                                <span className="text-[8px] text-slate-400 uppercase tracking-wider block mt-1">Retorno Ideal</span>
                                <span className="font-bold text-indigo-700 block">{new Date(proc.recommendedReturnDate).toLocaleDateString('pt-BR')}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1 gap-2">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-widest ${
                                proc.recallStatus === 'overdue' ? 'bg-rose-50 text-rose-600' :
                                proc.recallStatus === 'upcoming' ? 'bg-amber-50 text-amber-600' :
                                proc.recallStatus === 'active' ? 'bg-blue-50 text-blue-600' :
                                proc.recallStatus === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                                'bg-slate-100 text-slate-400'
                              }`}>
                                {proc.recallStatus === 'overdue' ? 'Atrasado' :
                                 proc.recallStatus === 'upcoming' ? 'Retorno Próximo' :
                                 proc.recallStatus === 'active' ? 'Ativo' :
                                 proc.recallStatus === 'completed' ? 'Agendado' : 'Cancelado'}
                              </span>
                              
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleOpenCrm(proc)}
                                  className="px-2.5 py-1.5 text-[9.5px] font-black uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-100 rounded-lg hover:bg-teal-100 transition-all"
                                >
                                  Contatar
                                </button>
                                <select
                                  value={proc.recallStatus}
                                  onChange={(e) => handleUpdateStatus(proc.id, e.target.value as any)}
                                  className="text-[9.5px] font-bold bg-white border border-slate-200 rounded-lg text-slate-500 focus:outline-none p-1"
                                >
                                  <option value="active">Ativo</option>
                                  <option value="upcoming">Retorno</option>
                                  <option value="overdue">Atrasado</option>
                                  <option value="completed">Resolvido</option>
                                  <option value="cancelled">Canc.</option>
                                </select>
                                <button
                                  onClick={() => handleDeleteProcedure(proc.id)}
                                  className="p-1 px-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Dynamic treatments from patient records header */}
              <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-3xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-black text-slate-800 uppercase">Leitor Automático de Prontuários (HOF)</h4>
                  <p className="text-[10px] text-slate-500">
                    Estes são os tratamentos de Harmonização Facial digitados nas fichas dos pacientes pelos dentistas. 
                    Você pode iniciar o monitoramento de recall ativo para qualquer um deles com 1 clique!
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Filtrar prontuários..."
                    className="w-full pl-10 pr-4 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* Patient Treatments List Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                {treatmentsLoading ? (
                  <div className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-2" />
                    Varrendo prontuários em busca de tratamentos de Harmonização Facial...
                  </div>
                ) : allTreatments.filter(t => {
                  const desc = (t.description || '').toLowerCase();
                  return hofKeywords.some(kw => desc.includes(kw)) &&
                         (t.patientName?.toLowerCase().includes(searchTerm.toLowerCase() ) || desc.includes(searchTerm.toLowerCase()));
                }).length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <SearchCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-xs font-bold uppercase tracking-wide">Nenhum tratamento HOF localizado</p>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-md mx-auto">
                      Não foram localizados registros clínicos com termos comuns de harmonização facial (Botox, Preenchimento, Bioestimuladores, etc.).
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Desktop Patient Treatments Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                            <th className="p-4 pl-6">Paciente</th>
                            <th className="p-4">Procedimento Lançado no Prontuário</th>
                            <th className="p-4">Fase / Status</th>
                            <th className="p-4">Dentista Responsável</th>
                            <th className="p-4">Vínculo de CRM</th>
                            <th className="p-4 text-right pr-6">Integração</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                          {allTreatments
                            .filter(t => {
                              const desc = (t.description || '').toLowerCase();
                              return hofKeywords.some(kw => desc.includes(kw)) &&
                                     (t.patientName?.toLowerCase().includes(searchTerm.toLowerCase() ) || desc.includes(searchTerm.toLowerCase()));
                            })
                            .map((t) => {
                              // Cross check if already integrated in crm active recalls
                              const isAlreadyIntegrated = procedures.some(proc => 
                                proc.patientId === t.patientId && 
                                (proc.procedureType.toLowerCase().includes(detectProcedureType(t.description).toLowerCase()) || 
                                 t.description.toLowerCase().includes(proc.procedureType.toLowerCase()))
                              );

                              return (
                                <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                  {/* Patient */}
                                  <td className="p-4 pl-6">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200">
                                        <User className="w-4 h-4" />
                                      </div>
                                      <div>
                                        <span className="font-bold text-slate-800 block">{t.patientName}</span>
                                        <span className="text-[9px] text-slate-400 font-bold block">{t.phone || 'Sem celular'}</span>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Procedure description */}
                                  <td className="p-4">
                                    <div className="space-y-1">
                                      <span className="font-bold text-slate-800 block">{t.description}</span>
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-[8px] font-black uppercase text-indigo-600 border border-indigo-100">
                                        {detectProcedureType(t.description)}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Clinical records treatment status */}
                                  <td className="p-4">
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                      t.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                    }`}>
                                      {t.status === 'completed' ? 'Concluído' : 'Em Andamento'}
                                    </span>
                                  </td>

                                  {/* Dentist */}
                                  <td className="p-4">
                                    <span className="text-slate-600 font-semibold block">{t.professional || 'Profissional da Clínica'}</span>
                                  </td>

                                  {/* Integration trace */}
                                  <td className="p-4">
                                    {isAlreadyIntegrated ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-emerald-50 text-[10px] font-black text-emerald-700 border border-emerald-100 shadow-sm leading-none">
                                        ✓ Monitoramento Ativado
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-slate-100 text-[10px] font-black text-slate-500 leading-none">
                                        Sem Acompanhamento Activo
                                      </span>
                                    )}
                                  </td>

                                  {/* Trigger recall creation button */}
                                  <td className="p-4 text-right pr-6">
                                    {isAlreadyIntegrated ? (
                                      <span className="text-[10px] text-slate-400 font-bold">Monitorado</span>
                                    ) : (
                                      <button
                                        onClick={() => handleActivateRecallFromProntuario(t)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-md shadow-indigo-600/10 active:scale-95 click-feedback"
                                      >
                                        <Clock className="w-3.5 h-3.5" />
                                        Ativar Recall
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Patient Treatments Cards */}
                    <div className="block md:hidden divide-y divide-slate-100">
                      {allTreatments
                        .filter(t => {
                          const desc = (t.description || '').toLowerCase();
                          return hofKeywords.some(kw => desc.includes(kw)) &&
                                 (t.patientName?.toLowerCase().includes(searchTerm.toLowerCase() ) || desc.includes(searchTerm.toLowerCase()));
                        })
                        .map((t) => {
                          const isAlreadyIntegrated = procedures.some(proc => 
                            proc.patientId === t.patientId && 
                            (proc.procedureType.toLowerCase().includes(detectProcedureType(t.description).toLowerCase()) || 
                             t.description.toLowerCase().includes(proc.procedureType.toLowerCase()))
                          );
                          return (
                            <div key={t.id} className="p-4 bg-white space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-200 shrink-0">
                                    <User className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="font-extrabold text-slate-950 text-xs truncate">{t.patientName}</h4>
                                    <p className="text-[9px] text-slate-400 font-bold">{t.phone || 'Sem celular'}</p>
                                  </div>
                                </div>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[8px] font-black uppercase text-indigo-600 border border-indigo-100 shrink-0 ${t.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                  {t.status === 'completed' ? 'Concluído' : 'Em Andamento'}
                                </span>
                              </div>

                              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-700 font-semibold space-y-1">
                                <p className="text-[11px] text-slate-900 font-bold leading-snug">
                                  {t.description}
                                </p>
                                <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1">
                                  <span>Dr(a): <strong className="text-slate-600">{t.professional || 'Dentista'}</strong></span>
                                  <span className="bg-indigo-50 border border-indigo-150 px-2 py-0.5 text-indigo-600 rounded font-black uppercase text-[8px]">
                                    {detectProcedureType(t.description)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-1 gap-2">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-[9px] font-black uppercase ${isAlreadyIntegrated ? 'bg-emerald-55 text-emerald-750 border border-emerald-100' : 'bg-slate-100 text-slate-500'}`}>
                                  {isAlreadyIntegrated ? '✓ Monitorado' : 'Sem Acompanhamento'}
                                </span>
                                <div className="shrink-0">
                                  {isAlreadyIntegrated ? (
                                    <span className="text-[10px] text-slate-400 font-bold">Monitorado</span>
                                  ) : (
                                    <button
                                      onClick={() => handleActivateRecallFromProntuario(t)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-md shadow-indigo-600/10 active:scale-95"
                                    >
                                      <Clock className="w-3.5 h-3.5" />
                                      Ativar Recall
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

        </div>

      </div>

      {/* MODAL 1: ADD RECALL APPLICATION */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl p-6 w-full max-w-lg space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                  <h3 className="text-sm font-black text-slate-900 uppercase">Novo Lançamento Facial HOF</h3>
                </div>
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-1 px-3 text-xs font-bold bg-slate-100 text-slate-400 hover:bg-slate-200/50 rounded-lg"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={handleAddProcedure} className="space-y-4">
                
                {/* SELECT Patient */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Paciente HOF</label>
                  <select
                    name="patientId"
                    value={formData.patientId}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Selecione o Paciente...</option>
                    {patients.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* SELECT Procedure Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tipo de Procedimento</label>
                    <select
                      name="procedureType"
                      value={formData.procedureType}
                      onChange={handleFormChange}
                      required
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none hover:bg-slate-50 transition-colors"
                    >
                      <option value="Toxina Botulínica">Toxina Botulínica (Botox)</option>
                      <option value="Bioestimulador">Bioestimulador de Colágeno</option>
                      <option value="Preenchimento">Preenchimento de Ácido Hialurônico</option>
                      <option value="Skinbooster">Skinbooster / Protocolo</option>
                      <option value="Fios PDO">Fios de Sustentação PDO</option>
                      <option value="Enzimas">Lipólise Enzimática</option>
                      <option value="Rinomodelação">Rinomodelação Estruturada</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Estimativa Biológica (Meses)</label>
                    <input
                      type="number"
                      name="durationEstimateMonths"
                      value={formData.durationEstimateMonths}
                      onChange={handleFormChange}
                      required
                      min={1}
                      max={24}
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Produto / Marca</label>
                    <input
                      type="text"
                      name="productUsed"
                      value={formData.productUsed}
                      onChange={handleFormChange}
                      placeholder="Ex: Botox, Sculptra, Restylane..."
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-850"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Região / Área de Aplicação</label>
                    <input
                      type="text"
                      name="area"
                      value={formData.area}
                      onChange={handleFormChange}
                      placeholder="Ex: Terço Superior, Labial, Malar"
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-850"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Data da Aplicação</label>
                    <input
                      type="date"
                      name="appliedAt"
                      value={formData.appliedAt}
                      onChange={handleFormChange}
                      required
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-800"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Categoria HOF</label>
                    <input
                      type="text"
                      name="category"
                      value={formData.category} // fixed Harmonização Facial
                      disabled
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-250 bg-slate-50 text-slate-400 rounded-xl cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Patient notes description */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Observações do Produto / Retoque</label>
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleFormChange}
                    rows={3}
                    placeholder="Registrar quantidade aplicada em UI, ML ou recomendação pós..."
                    className="w-full px-3 py-2 text-xs border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none font-sans text-slate-800"
                  />
                </div>

                {/* Action button */}
                <button
                  type="submit"
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
                >
                  Registrar Aplicação HOF
                </button>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: CRM WHATSAPP MESSAGE SENDER */}
      <AnimatePresence>
        {isCrmModalOpen && selectedRecall && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl p-6 w-full max-w-md space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-teal-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase">Mensagem Personalizada ELIZA</h3>
                </div>
                <button 
                  onClick={() => setIsCrmModalOpen(false)}
                  className="p-1 px-3 text-xs font-bold bg-slate-150 text-slate-500 hover:bg-slate-200 rounded-lg"
                >
                  Voltar
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                  <p className="text-xs font-bold text-slate-800">{selectedRecall.patientName}</p>
                  <p className="text-[10px] text-slate-400 leading-normal mt-1">
                    Procedimento: <strong>{selectedRecall.procedureType}</strong> realizado em {new Date(selectedRecall.appliedAt).toLocaleDateString('pt-BR')}.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Estrutura de Conversa Humanizada</label>
                  <textarea
                    value={customMsg}
                    onChange={(e) => setCustomMsg(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 text-xs border border-slate-250 rounded-xl focus:border-indigo-500 focus:outline-none font-sans text-slate-850 bg-slate-50/50"
                  />
                </div>

                <div className="space-y-2">
                  <a
                    href={`https://api.whatsapp.com/send?phone=${encodeURIComponent(patients.find(p => p.id === selectedRecall.patientId)?.phone || '').replace(/[^\d]/g, '')}&text=${encodeURIComponent(customMsg)}`}
                    target="_blank"
                    referrerPolicy="no-referrer"
                    onClick={() => {
                      // Automatically mark as contacted/upcoming on successful click
                      handleUpdateStatus(selectedRecall.id, 'upcoming');
                      setIsCrmModalOpen(false);
                    }}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/25 active:scale-95 transition-all text-center"
                  >
                    <Smartphone className="w-4 h-4" />
                    Enviar WhatsApp Oficial
                  </a>
                  
                  <button
                    onClick={() => {
                      handleUpdateStatus(selectedRecall.id, 'completed');
                      setIsCrmModalOpen(false);
                    }}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all mt-1"
                  >
                    Marcar como já Reagendado / Conpactado
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
