import React, { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import {
  CalendarDays,
  CalendarRange,
  Users,
  DollarSign,
  Package,
  Plus,
  Trash2,
  Edit2,
  Check,
  Play,
  CheckCircle,
  AlertCircle,
  Calendar,
  Briefcase,
  Layers,
  Sparkles,
  Loader2,
  Clock,
  User,
  Info,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  X,
  CreditCard,
  CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGenAI } from "../lib/gemini";

// Interfaces
interface PlannedProcedure {
  id: string;
  patientId: string;
  patientName: string;
  appointmentId?: string;
  professionalId: string;
  professionalName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  chair: string;
  procedureCategory: string;
  procedureName: string;
  expectedValue: number;
  expectedPaymentMethod: string;
  materialList: string[];
  status: "Planejado" | "Sala preparada" | "Paciente chegou" | "Em atendimento" | "Realizado" | "Não realizado" | "Reagendado";
  notes?: string;
  planningStatus?: "pending" | "planned" | "cancelled";
  patientPhone?: string;
  realizedValue?: number;
  realizedAt?: any;
  createdAt: any;
  updatedAt: any;
}

interface Professional {
  id: string;
  name: string;
  role?: string;
}

interface DBPatient {
  id: string;
  name: string;
}

// Available standard choices for procedures and materials
const PROCEDURE_CATEGORIES = [
  "Toxina Botulínica",
  "Ácido Hialurônico (Preenchimento)",
  "Fios de Sustentação / PDO",
  "Cirurgia Oral",
  "Implantes",
  "Bichectomia",
  "Lentes de Contato / Facetas",
  "Ortodontia",
  "Periodontia",
  "Endodontia",
  "Clínico Geral",
  "Outro",
];

const STANDARD_MATERIALS = [
  "toxina botulínica",
  "ácido hialurônico",
  "cânulas",
  "fios",
  "kits cirúrgicos",
  "anestésico",
  "implantes",
  "biomateriais",
];

const STATUS_OPTIONS: PlannedProcedure["status"][] = [
  "Planejado",
  "Sala preparada",
  "Paciente chegou",
  "Em atendimento",
  "Realizado",
  "Não realizado",
  "Reagendado",
];

const STATUS_STYLES: Record<PlannedProcedure["status"], { bg: string; text: string; dot: string; border: string }> = {
  "Planejado": { bg: "bg-slate-50", text: "text-slate-700", dot: "bg-slate-400", border: "border-slate-200" },
  "Sala preparada": { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500", border: "border-indigo-100" },
  "Paciente chegou": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", border: "border-amber-100" },
  "Em atendimento": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", border: "border-blue-100" },
  "Realizado": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", border: "border-emerald-100" },
  "Não realizado": { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500", border: "border-rose-100" },
  "Reagendado": { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500", border: "border-purple-100" },
};

export default function PlanningView() {
  const { clinic, profile, user } = useAuth();

  // Selected date tracker - defaults to today
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeSubtab, setActiveSubtab] = useState<"semana" | "hoje" | "amanha" | "profissional" | "pendentes" | "financeiro" | "materiais">("semana");

  // DB States
  const [plannedProcedures, setPlannedProcedures] = useState<PlannedProcedure[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [dbPatients, setDbPatients] = useState<DBPatient[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal / Form States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItemToEdit, setSelectedItemToEdit] = useState<PlannedProcedure | null>(null);

  // Form State
  const [formPatientSearch, setFormPatientSearch] = useState("");
  const [formPatientId, setFormPatientId] = useState("");
  const [formPatientName, setFormPatientName] = useState("");
  const [formProfessionalId, setFormProfessionalId] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formTime, setFormTime] = useState("09:00");
  const [formChair, setFormChair] = useState("Cadeira 1");
  const [formCategory, setFormCategory] = useState(PROCEDURE_CATEGORIES[0]);
  const [formProcedureName, setFormProcedureName] = useState("");
  const [formExpectedValue, setFormExpectedValue] = useState<number>(0);
  const [formRealizedValue, setFormRealizedValue] = useState<number>(0);
  const [formPaymentMethod, setFormPaymentMethod] = useState("Pix");
  const [formMaterials, setFormMaterials] = useState<string[]>([]);
  const [formStatus, setFormStatus] = useState<PlannedProcedure["status"]>("Planejado");
  const [formNotes, setFormNotes] = useState("");

  // AI Insights caching
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);

  // Helpers to calculate start/end of the chosen date's week (Monday - Sunday)
  const getWeekDates = (date: Date) => {
    const temp = new Date(date);
    const day = temp.getDay();
    const diff = temp.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(temp.setDate(diff));
    
    const week = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(monday);
      nextDay.setDate(monday.getDate() + i);
      week.push(nextDay);
    }
    return week;
  };

  const weekDates = getWeekDates(selectedDate);
  const mondayDateStr = weekDates[0].toISOString().split("T")[0];
  const sundayDateStr = weekDates[6].toISOString().split("T")[0];
  const todayDateStr = new Date().toISOString().split("T")[0];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDateStr = tomorrow.toISOString().split("T")[0];

  // Focus and open edit modal for linked agenda item
  useEffect(() => {
    if (loading || plannedProcedures.length === 0) return;
    
    const focusId = localStorage.getItem("planning_focus_appointment_id");
    if (focusId) {
      const match = plannedProcedures.find((p) => p.appointmentId === focusId);
      if (match) {
        openEditModal(match);
      }
      localStorage.removeItem("planning_focus_appointment_id");
    }
  }, [loading, plannedProcedures]);

  // Load planned procedures
  useEffect(() => {
    if (!clinic) return;

    setLoading(true);
    const proceduresRef = collection(db, "clinics", clinic.id, "planned_procedures");
    
    // Listing all procedures for real-time dashboard capabilities with maximum safety
    const q = query(proceduresRef);

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PlannedProcedure);
        // Sort by date, then by time
        const sorted = list.sort((a, b) => {
          const compDate = (a.date || "").localeCompare(b.date || "");
          if (compDate !== 0) return compDate;
          return (a.time || "").localeCompare(b.time || "");
        });
        setPlannedProcedures(sorted);
        setLoading(false);
      },
      (err) => {
        console.error("Erro ao escutar planejamentos:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [clinic]);

  // Load clinic professionals/members
  useEffect(() => {
    if (!clinic) return;
    const membersRef = collection(db, "clinics", clinic.id, "team_members");
    const unsub = onSnapshot(membersRef, (snap) => {
      setProfessionals(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name || "Sem Nome",
          role: d.data().role || "Colaborador",
        }))
      );
    });
    return () => unsub();
  }, [clinic]);

  // Load patients list for search / autocomplete
  useEffect(() => {
    if (!clinic) return;
    const patientsRef = collection(db, "clinics", clinic.id, "patients");
    const unsub = onSnapshot(patientsRef, (snap) => {
      setDbPatients(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name || "Sem Nome",
        }))
      );
    });
    return () => unsub();
  }, [clinic]);

  // Run AI Insight Generator
  const generateAIInsight = async () => {
    if (!clinic) return;
    setLoadingInsight(true);
    setAiInsight(null);
    try {
      const totalExpected = plannedProcedures.reduce((acc, p) => acc + (p.expectedValue || 0), 0);
      const realizedTotal = plannedProcedures.reduce((acc, p) => acc + (p.status === "Realizado" ? (p.realizedValue || p.expectedValue || 0) : 0), 0);
      
      const materialsNeeded: Record<string, number> = {};
      plannedProcedures.forEach((p) => {
        (p.materialList || []).forEach((m) => {
          materialsNeeded[m] = (materialsNeeded[m] || 0) + 1;
        });
      });

      const highValuePatients = plannedProcedures
        .filter((p) => p.expectedValue >= 1000)
        .map((p) => `${p.patientName} (${p.procedureCategory}: R$ ${p.expectedValue})`);

      const noValueProcedures = plannedProcedures
        .filter((p) => !p.expectedValue || p.expectedValue === 0)
        .map((p) => `${p.patientName} (${p.procedureName || p.procedureCategory})`);

      const professionalFaturamento = professionals.map((prof) => {
        const profProcs = plannedProcedures.filter((p) => p.professionalId === prof.id);
        const expected = profProcs.reduce((acc, p) => acc + (p.expectedValue || 0), 0);
        return `${prof.name}: R$ ${expected}`;
      });

      const prompt = `Analise o planejamento cirúrgico/clínico e operacional da semana na clínica odontológica/estética ELIZA para o período de ${mondayDateStr} até ${sundayDateStr}.

Métricas da Semana:
- Faturamento Total Planejado: R$ ${totalExpected}
- Faturamento Realizado até agora: R$ ${realizedTotal}
- Faturamento por Profissional:
  ${professionalFaturamento.join("\n  ")}

Materiais de Insumos Planejados:
${Object.entries(materialsNeeded).map(([k, v]) => `  - ${k}: necessário para ${v} procedimento(s)`).join("\n")}

Pacientes de Alto Valor Planejados:
${highValuePatients.length > 0 ? highValuePatients.join(", ") : "Nenhum de valor >= R$ 1000"}

Procedimentos Sem Previsão de Valor Planejado:
${noValueProcedures.length > 0 ? noValueProcedures.join(", ") : "Nenhum"}

Por favor, gere um bloco curto e refinado chamado "Insight da Semana", estruturado exatamente com os seguintes parágrafos em markdown polido:
1. **Métricas e Previsão Financeira**: Faturamento previsto, faturamento realizado até agora, análise rápida da produtividade de faturamento por profissional.
2. **Insumos e Materiais Críticos**: Quais materiais e kits cirúrgicos precisam ser separados ou comprados com urgência para sustentar a agenda.
3. **Alertas Operacionais & Oportunidades Comerciais**: Chame atenção para pacientes de alto valor, procedimentos pendentes sem valor definido, riscos de gargalo por profissional e como otimizar os horários.

Seja extremamente objetivo, use termos elegantes como "insumos críticos", "faturamento projetado", "eficiência clínica" e retorne o markdown diretamente.`;

      const ai = getGenAI();
      const result = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });

      setAiInsight(result.text || "Não foi possível gerar a análise clínica.");
    } catch (err) {
      console.error("Erro do Gemini AI:", err);
      setAiInsight("Erro ao gerar Insights da ELIZA AI. Verifique se a sua chave de API está cadastrada.");
    } finally {
      setLoadingInsight(false);
    }
  };

  // Open Add Modal from patient profile (triggered externally or manual)
  const openNewPlanning = (patientId?: string, patientName?: string) => {
    setFormPatientId(patientId || "");
    setFormPatientName(patientName || "");
    setFormPatientSearch(patientName || "");
    setFormProfessionalId(professionals[0]?.id || "");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormTime("09:00");
    setFormChair("Cadeira 1");
    setFormCategory(PROCEDURE_CATEGORIES[0]);
    setFormProcedureName("");
    setFormExpectedValue(0);
    setFormRealizedValue(0);
    setFormPaymentMethod("Pix");
    setFormMaterials([]);
    setFormStatus("Planejado");
    setFormNotes("");
    setIsAddModalOpen(true);
  };

  // Create document in Firestore
  const handleCreateProcedure = async () => {
    if (!clinic) return;
    if (!formPatientName) {
      alert("Por favor, selecione ou informe o nome do paciente.");
      return;
    }

    const selectedProf = professionals.find((p) => p.id === formProfessionalId);
    
    // Create planned procedure
    const payload: Omit<PlannedProcedure, "id"> = {
      patientId: formPatientId || "manual-" + Date.now(),
      patientName: formPatientName,
      professionalId: formProfessionalId || "not-assigned",
      professionalName: selectedProf?.name || "Sem atribuição",
      date: formDate,
      time: formTime,
      chair: formChair,
      procedureCategory: formCategory,
      procedureName: formProcedureName || formCategory,
      expectedValue: Number(formExpectedValue) || 0,
      expectedPaymentMethod: formPaymentMethod,
      materialList: formMaterials,
      status: formStatus,
      notes: formNotes,
      planningStatus: (formProcedureName && formProcedureName.trim() !== "" && formProcedureName !== "Não planejado") ? "planned" : "pending",
      realizedValue: ["Realizado"].includes(formStatus) ? Number(formRealizedValue || formExpectedValue) : 0,
      realizedAt: ["Realizado"].includes(formStatus) ? new Date().toISOString() : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, "clinics", clinic.id, "planned_procedures"), payload);
      setIsAddModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/planned_procedures`);
    }
  };

  // Populate Edit Modal
  const openEditModal = (item: PlannedProcedure) => {
    setSelectedItemToEdit(item);
    setFormPatientId(item.patientId);
    setFormPatientName(item.patientName);
    setFormPatientSearch(item.patientName);
    setFormProfessionalId(item.professionalId);
    setFormDate(item.date);
    setFormTime(item.time);
    setFormChair(item.chair);
    setFormCategory(item.procedureCategory);
    setFormProcedureName(item.procedureName || "");
    setFormExpectedValue(item.expectedValue || 0);
    setFormRealizedValue(item.realizedValue || item.expectedValue || 0);
    setFormPaymentMethod(item.expectedPaymentMethod || "Pix");
    setFormMaterials(item.materialList || []);
    setFormStatus(item.status || "Planejado");
    setFormNotes(item.notes || "");
    setIsEditModalOpen(true);
  };

  const handleUpdateProcedure = async () => {
    if (!clinic || !selectedItemToEdit) return;

    const selectedProf = professionals.find((p) => p.id === formProfessionalId);
    const payload: Partial<PlannedProcedure> = {
      patientId: formPatientId,
      patientName: formPatientName,
      professionalId: formProfessionalId,
      professionalName: selectedProf?.name || "Sem atribuição",
      date: formDate,
      time: formTime,
      chair: formChair,
      procedureCategory: formCategory,
      procedureName: formProcedureName || formCategory,
      expectedValue: Number(formExpectedValue) || 0,
      expectedPaymentMethod: formPaymentMethod,
      materialList: formMaterials,
      status: formStatus,
      notes: formNotes,
      planningStatus: (formProcedureName && formProcedureName.trim() !== "" && formProcedureName !== "Não planejado") ? "planned" : "pending",
      realizedValue: formStatus === "Realizado" ? Number(formRealizedValue || formExpectedValue) : 0,
      realizedAt: formStatus === "Realizado" ? (selectedItemToEdit.realizedAt || new Date().toISOString()) : null,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, "clinics", clinic.id, "planned_procedures", selectedItemToEdit.id), payload);
      setIsEditModalOpen(false);
      setSelectedItemToEdit(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/planned_procedures/${selectedItemToEdit.id}`);
    }
  };

  // Delete Planned Procedure
  const handleDeleteProcedure = async (id: string) => {
    if (!clinic) return;
    if (!confirm("Tem certeza de que deseja remover este procedimento do planejamento?")) return;
    try {
      await deleteDoc(doc(db, "clinics", clinic.id, "planned_procedures", id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `clinics/${clinic.id}/planned_procedures/${id}`);
    }
  };

  // Fast operational status transition
  const handleQuickStatusChange = async (id: string, newStatus: PlannedProcedure["status"]) => {
    if (!clinic) return;
    const item = plannedProcedures.find((p) => p.id === id);
    if (!item) return;

    const payload: Partial<PlannedProcedure> = {
      status: newStatus,
      realizedValue: newStatus === "Realizado" ? (item.realizedValue || item.expectedValue || 0) : 0,
      realizedAt: newStatus === "Realizado" ? new Date().toISOString() : null,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, "clinics", clinic.id, "planned_procedures", id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/planned_procedures/${id}`);
    }
  };

  // Date Shift Controllers
  const shiftWeek = (direction: "prev" | "next") => {
    const temp = new Date(selectedDate);
    temp.setDate(temp.getDate() + (direction === "prev" ? -7 : 7));
    setSelectedDate(temp);
  };

  // Local calculation & aggregates for the weekly scope
  const weekProcedures = plannedProcedures.filter(
    (p) => p.date >= mondayDateStr && p.date <= sundayDateStr && p.planningStatus !== "cancelled"
  );

  const faturamentoPrevisto = weekProcedures.reduce((acc, p) => acc + (p.expectedValue || 0), 0);
  const recebimentoPrevisto = weekProcedures.reduce((acc, p) => acc + (p.status !== "Não realizado" ? (p.expectedValue || 0) : 0), 0);
  const faturamentoRealizado = weekProcedures.reduce((acc, p) => acc + (p.status === "Realizado" ? (p.realizedValue || p.expectedValue || 0) : 0), 0);
  const faturamentoPendente = weekProcedures.reduce((acc, p) => acc + (p.status !== "Realizado" && p.status !== "Não realizado" ? (p.expectedValue || 0) : 0), 0);

  // Filter today's, tomorrow's and pending items (excluding cancelled)
  const todayProcedures = plannedProcedures.filter((p) => p.date === todayDateStr && p.planningStatus !== "cancelled");
  const tomorrowProcedures = plannedProcedures.filter((p) => p.date === tomorrowDateStr && p.planningStatus !== "cancelled");
  const pendingProcedures = plannedProcedures.filter((p) => p.planningStatus === "pending");

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      
      {/* Upper Operational Header */}
      <header className="h-20 border-b border-slate-200 bg-white shrink-0 px-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-lg font-bold text-slate-950 tracking-tight">Planejamento Operacional</h1>
            <p className="text-[10px] text-teal-600 font-bold uppercase tracking-wider">Cronograma & Fluxos de Trabalho</p>
          </div>

          <div className="h-8 w-px bg-slate-200" />

          {/* Week Selector Grid */}
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => shiftWeek("prev")}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-500"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setSelectedDate(new Date())}
                className="px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-teal-600"
              >
                Semana Atual
              </button>
              <button
                onClick={() => shiftWeek("next")}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-500"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-900 leading-tight">
                De {weekDates[0].toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} até{" "}
                {weekDates[6].toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Apurando a nível semanal</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openNewPlanning()}
            className="bg-teal-600 text-white rounded-xl h-10 px-5 font-bold text-[10px] uppercase tracking-widest hover:bg-teal-700 transition-all shadow-md flex items-center gap-2 cursor-pointer shadow-teal-500/10"
          >
            <Plus className="w-4 h-4" /> Planejar Procedimento
          </button>
        </div>
      </header>

      {/* Main Container Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Real-time Subviews Navigation list */}
        <div className="w-72 border-r border-slate-200 bg-white h-full overflow-y-auto shrink-0 flex flex-col justify-between hidden md:flex">
          <div className="p-6 space-y-6">
            <div className="space-y-1.5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subabas operacionais</p>
              
              <button
                onClick={() => setActiveSubtab("semana")}
                className={`w-full flex items-center justify-between p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "semana" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <CalendarRange className={`w-4 h-4 ${activeSubtab === "semana" ? "text-teal-600" : "text-slate-400"}`} />
                  <span>Visão da Semana</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] text-slate-650 font-black">{weekProcedures.length}</span>
              </button>

              <button
                onClick={() => setActiveSubtab("hoje")}
                className={`w-full flex items-center justify-between p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "hoje" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <CalendarDays className={`w-4 h-4 ${activeSubtab === "hoje" ? "text-teal-600" : "text-slate-400"}`} />
                  <span>Hoje</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-rose-50 border border-rose-100/50 text-[10px] text-rose-600 font-extrabold">{todayProcedures.length}</span>
              </button>

              <button
                onClick={() => setActiveSubtab("amanha")}
                className={`w-full flex items-center justify-between p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "amanha" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Calendar className={`w-4 h-4 ${activeSubtab === "amanha" ? "text-teal-600" : "text-slate-400"}`} />
                  <span>Amanhã</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-100/30 text-[10px] text-blue-600 font-extrabold">{tomorrowProcedures.length}</span>
              </button>

              <button
                onClick={() => setActiveSubtab("pendentes")}
                className={`w-full flex items-center justify-between p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "pendentes" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className={`w-4 h-4 ${activeSubtab === "pendentes" ? "text-teal-600" : "text-slate-400"}`} />
                  <span>Pendentes</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-150 text-[10px] text-amber-600 font-extrabold">{pendingProcedures.length}</span>
              </button>

              <button
                onClick={() => setActiveSubtab("profissional")}
                className={`w-full flex items-center gap-3 p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "profissional" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Users className={`w-4 h-4 ${activeSubtab === "profissional" ? "text-teal-600" : "text-slate-400"}`} />
                <span>Por Profissional</span>
              </button>

              <button
                onClick={() => setActiveSubtab("financeiro")}
                className={`w-full flex items-center gap-3 p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "financeiro" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <DollarSign className={`w-4 h-4 ${activeSubtab === "financeiro" ? "text-teal-600" : "text-slate-400"}`} />
                <span>Financeiro Previsto</span>
              </button>

              <button
                onClick={() => setActiveSubtab("materiais")}
                className={`w-full flex items-center gap-3 p-3 rounded-xl font-bold text-sm transition-all ${
                  activeSubtab === "materiais" ? "bg-teal-50 text-teal-750 border border-teal-100" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Package className={`w-4 h-4 ${activeSubtab === "materiais" ? "text-teal-600" : "text-slate-400"}`} />
                <span>Materiais da Semana</span>
              </button>
            </div>

            {/* AI Action Panel */}
            <div className="rounded-2xl bg-slate-900 text-white p-5 border border-slate-800 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-20 h-20 bg-teal-500/10 rounded-full blur-2xl group-hover:bg-teal-500/20 transition-all" />
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-emerald-400 font-extrabold animate-pulse" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400">ELIZA AI CO-PILOTO</h3>
              </div>
              <p className="text-[10px] font-medium text-slate-300 leading-relaxed mb-4">
                Analise gargalos materiais, otimize o faturamento da semana e descubra oportunidades clínicas ocultas baseadas em procedimentos.
              </p>
              <button
                onClick={generateAIInsight}
                disabled={loadingInsight}
                className="w-full bg-white/10 hover:bg-white/20 hover:scale-[1.02] border border-white/10 py-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-white tracking-widext transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loadingInsight ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-white" />
                    Analisando...
                  </>
                ) : (
                  <>Gerar Insight IA</>
                )}
              </button>
            </div>
          </div>

          <div className="p-6 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                <Info className="w-3.5 h-3.5" />
              </div>
              <p className="text-[9px] text-slate-400 font-bold leading-tight uppercase">
                Para vincular um agendamento, crie-o na agenda do consultório.
              </p>
            </div>
          </div>
        </div>

        {/* Dynamic Mobile Subtab selector inside view */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          <div className="bg-white border-b border-slate-200 p-2 overflow-x-auto min-h-12 flex md:hidden gap-1 shrink-0">
            {[
              { id: "semana", label: "Semana" },
              { id: "hoje", label: "Hoje" },
              { id: "amanha", label: "Amanhã" },
              { id: "pendentes", label: "Pendentes" },
              { id: "profissional", label: "Profissional" },
              { id: "financeiro", label: "Financeiro" },
              { id: "materiais", label: "Insumos" },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setActiveSubtab(st.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeSubtab === st.id ? "bg-teal-600 text-white font-extrabold" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Core Scrollable Panel */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
            
            {/* AI Insight Header Banner if loaded */}
            {aiInsight && (
              <motion.div
                initial={{ opacity: 0, y: -15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-teal-50/50 via-teal-50/10 to-white/10 border border-teal-150 p-6 rounded-3xl relative shadow-sm"
              >
                <button
                  onClick={() => setAiInsight(null)}
                  className="absolute top-4 right-4 p-1 hover:bg-slate-105 rounded-full text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex gap-4 items-start">
                  <div className="p-3 bg-teal-600 text-white rounded-2xl shrink-0 shadow-lg shadow-teal-500/20 animate-bounce">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-teal-950 uppercase tracking-widest">Co-Piloto Operacional Eliza AI</h2>
                    <p className="text-[10px] text-teal-600 font-bold uppercase tracking-widest mt-0.5 mb-4">Relatório Inteligente Operacional</p>
                    <div className="prose prose-slate text-xs text-slate-700 font-medium leading-relaxed max-w-none space-y-4">
                      {aiInsight.split("\n\n").map((para, idx) => (
                        <p key={idx}>{para.replace(/\*\*/g, "")}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Aggregated Realtime Highlights */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
              <div className="bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Previsão Bruta</h3>
                  <p className="text-lg font-black text-slate-950 tracking-tight">R$ {faturamentoPrevisto.toLocaleString("pt-BR")}</p>
                </div>
                <div className="p-4 bg-teal-50 text-teal-600 rounded-2xl">
                  <DollarSign className="w-5 h-5 stroke-[2.5]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Realizado</h3>
                  <p className="text-lg font-black text-emerald-600 tracking-tight">R$ {faturamentoRealizado.toLocaleString("pt-BR")}</p>
                </div>
                <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl">
                  <TrendingUp className="w-5 h-5 stroke-[2.5]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Pendente Operação</h3>
                  <p className="text-lg font-black text-slate-650 tracking-tight">R$ {faturamentoPendente.toLocaleString("pt-BR")}</p>
                </div>
                <div className="p-4 bg-slate-50 text-indigo-600 rounded-2xl">
                  <Clock className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Projetado Líquido</h3>
                  <p className="text-lg font-black text-indigo-700 tracking-tight">R$ {recebimentoPrevisto.toLocaleString("pt-BR")}</p>
                </div>
                <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <CheckCircle className="w-5 h-5 stroke-[2.5]" />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-teal-600" />
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Apurando Planejamentos...</p>
              </div>
            ) : (
              <div className="space-y-6">
                
                {/* 1. Visão da Semana */}
                {activeSubtab === "semana" && (
                  <div className="grid grid-cols-1 xl:grid-cols-7 gap-4">
                    {weekDates.map((dayDate) => {
                      const dayStr = dayDate.toISOString().split("T")[0];
                      const dayProcedures = plannedProcedures.filter((p) => p.date === dayStr);
                      const isToday = dayStr === todayDateStr;

                      return (
                        <div
                          key={dayStr}
                          className={`bg-white rounded-3xl border border-slate-205 shadow-sm p-4 flex flex-col h-[480px] ${
                            isToday ? "ring-2 ring-teal-500/20 bg-teal-50/5 border-teal-200" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3 shrink-0">
                            <div>
                              <p className="text-xs font-black text-slate-950 uppercase tracking-tighter capitalize leading-none">
                                {dayDate.toLocaleDateString("pt-BR", { weekday: "short" })}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold tracking-widest">
                                {dayDate.toLocaleDateString("pt-BR", { day: "numeric" })}
                              </p>
                            </div>
                            {dayProcedures.length > 0 && (
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] text-slate-605 font-black">{dayProcedures.length}</span>
                            )}
                          </div>

                          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                            {dayProcedures.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                                <Calendar className="w-5 h-5 text-slate-200 mb-1" />
                                <p className="text-[9px] text-slate-350 font-bold uppercase tracking-widest leading-relaxed">Sem planejamentos</p>
                              </div>
                            ) : (
                              dayProcedures.map((item) => {
                                const stStyle = STATUS_STYLES[item.status] || STATUS_STYLES["Planejado"];
                                return (
                                  <div
                                    key={item.id}
                                    className="p-3 rounded-2xl border border-slate-200/60 bg-white hover:shadow-md transition-all group relative flex flex-col justify-between"
                                  >
                                    <div>
                                      <div className="flex items-center justify-between gap-1.5 mb-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <div className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
                                          <span className="text-[9px] font-bold text-slate-450 tablular-nums">{item.time}</span>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                          <button
                                            onClick={() => openEditModal(item)}
                                            className="p-1 hover:bg-slate-100 rounded-lg text-slate-500"
                                            title="Editar Procedimento"
                                          >
                                            <Edit2 className="w-3 h-3" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteProcedure(item.id)}
                                            className="p-1 hover:bg-rose-50 rounded-lg text-rose-600"
                                            title="Excluir"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>

                                      <p className="text-[11px] font-black text-slate-950 leading-tight truncate">{item.patientName}</p>
                                      <p className="text-[9px] font-semibold text-teal-650 tracking-wide truncate mt-0.5">{item.procedureName}</p>
                                      
                                      {item.chair && (
                                        <span className="inline-block px-1.5 py-0.2 rounded bg-indigo-50 border border-indigo-100/50 text-[7px] text-indigo-600 font-bold uppercase mt-1 tracking-wider">
                                          {item.chair}
                                        </span>
                                      )}
                                    </div>

                                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                                      <span className="text-[10px] font-black text-slate-900">R$ {item.expectedValue || 0}</span>
                                      
                                      <select
                                        value={item.status}
                                        onChange={(e) => handleQuickStatusChange(item.id, e.target.value as any)}
                                        className="bg-transparent text-[8px] font-black uppercase tracking-wider text-slate-450 outline-none pr-1 max-w-16 cursor-pointer"
                                      >
                                        {STATUS_OPTIONS.map((st) => (
                                          <option key={st} value={st}>
                                            {st}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2. Hoje */}
                {activeSubtab === "hoje" && (
                  <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-sm overflow-hidden p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                      <div>
                        <h2 className="text-md font-bold text-slate-950">Procedimentos de Hoje ({new Date().toLocaleDateString("pt-BR")})</h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Fila sequencial cirúrgica & operacional</p>
                      </div>
                      <span className="px-3 py-1 bg-teal-50 text-teal-700 text-xs font-black rounded-xl">{todayProcedures.length} agendamentos planejados</span>
                    </div>

                    {todayProcedures.length === 0 ? (
                      <div className="h-64 flex flex-col items-center justify-center text-center p-6">
                        <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mb-3">
                          <Calendar className="w-8 h-8" />
                        </div>
                        <p className="text-sm font-black text-slate-900 uppercase tracking-widest mb-1">Nenhum procedimento no planejamento</p>
                        <p className="text-xs font-semibold text-slate-400 max-w-sm">Use o botão no topo direito ou a tela de prontuário de paciente para incluir itens no planejamento</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                              <th className="py-3 px-4">Horário</th>
                              <th className="py-3 px-4">Paciente</th>
                              <th className="py-3 px-4">Cirurgião / Responsável</th>
                              <th className="py-3 px-3">Procedimento</th>
                              <th className="py-3 px-3">Cadeira / Sala</th>
                              <th className="py-3 px-3">Insumos Planejados</th>
                              <th className="py-3 px-4 text-right">Previsão</th>
                              <th className="py-3 px-4">Status Operacional</th>
                              <th className="py-3 px-4 text-right">Ação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {todayProcedures.map((item) => {
                              const stStyle = STATUS_STYLES[item.status] || STATUS_STYLES["Planejado"];
                              return (
                                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="py-4 px-4 font-black text-xs text-slate-900 tablular-nums">{item.time}</td>
                                  <td className="py-4 px-4">
                                    <p className="font-extrabold text-sm text-slate-950">{item.patientName}</p>
                                    {item.notes && <p className="text-[10px] text-slate-400 font-medium italic mt-0.5">{item.notes}</p>}
                                  </td>
                                  <td className="py-4 px-4 font-bold text-xs text-slate-700">{item.professionalName}</td>
                                  <td className="py-4 px-3">
                                    <span className="px-2 py-1 bg-teal-50 border border-teal-100 rounded-lg text-[10px] text-teal-700 font-extrabold uppercase">
                                      {item.procedureCategory}
                                    </span>
                                    <p className="text-[11px] font-bold text-slate-500 mt-1">{item.procedureName}</p>
                                  </td>
                                  <td className="py-4 px-3">
                                    <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-[9px] text-indigo-600 font-black uppercase tracking-wider">
                                      {item.chair}
                                    </span>
                                  </td>
                                  <td className="py-4 px-3">
                                    {item.materialList && item.materialList.length > 0 ? (
                                      <div className="flex flex-wrap gap-1 max-w-48">
                                        {item.materialList.map((m) => (
                                          <span key={m} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100 text-[8px] text-amber-700 font-semibold uppercase">
                                            {m}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-slate-400 font-semibold">Nenhum</span>
                                    )}
                                  </td>
                                  <td className="py-4 px-4 text-right">
                                    <p className="font-black text-xs text-slate-950">R$ {item.expectedValue}</p>
                                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{item.expectedPaymentMethod}</p>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
                                      {item.status}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => openEditModal(item)}
                                        className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
                                        title="Editar"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteProcedure(item.id)}
                                        className="p-1.5 hover:bg-rose-50 rounded-xl text-rose-600 transition-colors"
                                        title="Excluir"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 2.5. Amanhã */}
                {activeSubtab === "amanha" && (
                  <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-sm overflow-hidden p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                      <div>
                        <h2 className="text-md font-bold text-slate-950">Procedimentos de Amanhã ({new Date(Date.now() + 86400000).toLocaleDateString("pt-BR")})</h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Cronograma operacional antecipado</p>
                      </div>
                      <span className="px-3 py-1 bg-teal-50 text-teal-700 text-xs font-black rounded-xl">{tomorrowProcedures.length} agendamentos planejados</span>
                    </div>

                    {tomorrowProcedures.length === 0 ? (
                      <div className="h-64 flex flex-col items-center justify-center text-center p-6">
                        <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mb-3">
                          <Calendar className="w-8 h-8" />
                        </div>
                        <p className="text-sm font-black text-slate-900 uppercase tracking-widest mb-1">Nenhum procedimento no planejamento para amanhã</p>
                        <p className="text-xs font-semibold text-slate-400 max-w-sm">Use o botão no topo direito ou a agenda para planejar o dia de amanhã.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                              <th className="py-3 px-4">Horário</th>
                              <th className="py-3 px-4">Paciente</th>
                              <th className="py-3 px-4">Cirurgião / Responsável</th>
                              <th className="py-3 px-3">Procedimento</th>
                              <th className="py-3 px-3">Cadeira / Sala</th>
                              <th className="py-3 px-3">Insumos Planejados</th>
                              <th className="py-3 px-4 text-right">Previsão</th>
                              <th className="py-3 px-4">Status Operacional</th>
                              <th className="py-3 px-4 text-right">Ação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {tomorrowProcedures.map((item) => {
                              const stStyle = STATUS_STYLES[item.status] || STATUS_STYLES["Planejado"];
                              return (
                                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="py-4 px-4 font-black text-xs text-slate-900 tablular-nums">{item.time}</td>
                                  <td className="py-4 px-4">
                                    <p className="font-extrabold text-sm text-slate-950">{item.patientName}</p>
                                    {item.notes && <p className="text-[10px] text-slate-400 font-medium italic mt-0.5">{item.notes}</p>}
                                  </td>
                                  <td className="py-4 px-4 font-bold text-xs text-slate-700">{item.professionalName}</td>
                                  <td className="py-4 px-3">
                                    <span className="px-2 py-1 bg-teal-50 border border-teal-100 rounded-lg text-[10px] text-teal-700 font-extrabold uppercase">
                                      {item.procedureCategory}
                                    </span>
                                    <p className="text-[11px] font-bold text-slate-500 mt-1">{item.procedureName}</p>
                                  </td>
                                  <td className="py-4 px-3">
                                    <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-[9px] text-indigo-600 font-black uppercase tracking-wider">
                                      {item.chair}
                                    </span>
                                  </td>
                                  <td className="py-4 px-3">
                                    {item.materialList && item.materialList.length > 0 ? (
                                      <div className="flex flex-wrap gap-1 max-w-48">
                                        {item.materialList.map((m) => (
                                          <span key={m} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100 text-[8px] text-amber-700 font-semibold uppercase">
                                            {m}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-slate-400 font-semibold">Nenhum</span>
                                    )}
                                  </td>
                                  <td className="py-4 px-4 text-right">
                                    <p className="font-black text-xs text-slate-950">R$ {item.expectedValue}</p>
                                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{item.expectedPaymentMethod}</p>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
                                      {item.status}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => openEditModal(item)}
                                        className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
                                        title="Editar"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteProcedure(item.id)}
                                        className="p-1.5 hover:bg-rose-50 rounded-xl text-rose-600 transition-colors"
                                        title="Excluir"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 2.6. Pendentes de planejamento */}
                {activeSubtab === "pendentes" && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm flex items-center justify-between">
                      <div>
                        <h2 className="text-md font-bold text-slate-950">Atendimentos Pendentes de Planejamento</h2>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Agendamentos criados que necessitam de definição cirúrgica & insumos</p>
                      </div>
                      <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-black rounded-xl border border-amber-200/50">{pendingProcedures.length} agendamentos pendentes</span>
                    </div>

                    {pendingProcedures.length === 0 ? (
                      <div className="bg-white rounded-3xl p-12 border border-slate-200/80 shadow-sm text-center flex flex-col items-center justify-center">
                        <div className="w-16 h-16 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mb-3 shadow-inner">
                          <CheckCircle className="w-8 h-8" />
                        </div>
                        <p className="text-sm font-black text-slate-900 uppercase tracking-widest mb-1">Tudo Planejado!</p>
                        <p className="text-xs font-semibold text-slate-400 max-w-sm font-medium">Todos os agendamentos já possuem planejamento clínico associado.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {pendingProcedures.map((item) => {
                          return (
                            <div 
                              key={item.id} 
                              className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 hover:shadow-md transition-all flex flex-col justify-between relative group"
                            >
                              <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                                    <span className="text-[11px] font-bold text-slate-500 tablular-nums">
                                      {item.time || "00:00"} • {new Date(item.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
                                    </span>
                                  </div>
                                  <span className="px-2.5 py-0.5 rounded-lg bg-amber-50 border border-amber-200/50 text-[8px] text-amber-700 font-black uppercase tracking-wider">
                                    PENDENTE
                                  </span>
                                </div>

                                <div className="space-y-1">
                                  <h3 className="text-sm font-black text-slate-900 group-hover:text-teal-600 transition-colors">{item.patientName}</h3>
                                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1 mt-1">
                                    <User className="w-3 h-3 text-slate-300" /> Profissional: 
                                    <strong className="text-slate-600 ml-0.5">{item.professionalName}</strong>
                                  </p>
                                </div>

                                <div className="p-3 bg-slate-50/75 rounded-2xl border border-slate-100">
                                  <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest mb-1">Procedimento Inicial</p>
                                  <p className="text-xs font-extrabold text-slate-700">{item.procedureName || "Não planejado"}</p>
                                </div>
                                
                                {item.notes && (
                                  <p className="text-[10px] text-slate-400 italic font-medium leading-relaxed">
                                    "{item.notes}"
                                  </p>
                                )}
                              </div>

                              <div className="mt-5 pt-4 border-t border-slate-110 flex items-center gap-2">
                                <button
                                  onClick={() => openEditModal(item)}
                                  className="flex-1 py-2.5 bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-850 text-white font-black text-[9px] uppercase tracking-wider rounded-xl shadow-md cursor-pointer text-center block transition-all"
                                >
                                  Planejar agora
                                </button>
                                <button
                                  onClick={() => handleDeleteProcedure(item.id)}
                                  className="p-2.5 hover:bg-rose-50 rounded-xl text-rose-600 transition-colors border border-transparent hover:border-rose-100"
                                  title="Remover"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Por Profissional */}
                {activeSubtab === "profissional" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {professionals.map((prof) => {
                      const profProcedures = plannedProcedures.filter((p) => p.professionalId === prof.id);
                      const expectedMoney = profProcedures.reduce((acc, p) => acc + (p.expectedValue || 0), 0);
                      const completedCount = profProcedures.filter((p) => p.status === "Realizado").length;
                      const pendingCount = profProcedures.length - completedCount;

                      return (
                        <div key={prof.id} className="bg-white rounded-[2rem] border border-slate-205 shadow-sm p-6 space-y-5 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                              <div>
                                <h3 className="text-md font-black text-slate-950 leading-none mb-1">{prof.name}</h3>
                                <p className="text-[10px] text-teal-600 font-bold uppercase tracking-widest">{prof.role}</p>
                              </div>
                              <span className="px-2.5 py-1 bg-slate-100 text-[10px] text-slate-650 font-black rounded-lg">{profProcedures.length} Planejados</span>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-450 font-semibold">Projetado Bruto</span>
                                <span className="text-slate-950 font-black">R$ {expectedMoney.toLocaleString("pt-BR")}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs animate-pulse">
                                <span className="text-slate-450 font-semibold">Carga de Trabalho</span>
                                <span className="text-slate-950 font-black">
                                  {completedCount} de {profProcedures.length} realizados
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mt-1">
                                <div
                                  className="bg-teal-600 h-full rounded-full transition-all"
                                  style={{
                                    width: `${profProcedures.length > 0 ? (completedCount / profProcedures.length) * 105 : 0}%`,
                                  }}
                                />
                              </div>
                            </div>

                            {/* Procedure List in Miniature */}
                            <div className="mt-5 space-y-2 max-h-48 overflow-y-auto pr-1 select-none custom-scrollbar">
                              {profProcedures.length === 0 ? (
                                <p className="text-[10px] text-slate-350 font-semibold uppercase tracking-widest text-center py-4">Nenhum procedimento alocado</p>
                              ) : (
                                profProcedures.map((p) => {
                                  const stStyle = STATUS_STYLES[p.status] || STATUS_STYLES["Planejado"];
                                  return (
                                    <div key={p.id} className="p-2 border border-slate-100 bg-slate-50/50 rounded-xl flex items-center justify-between gap-2">
                                      <div className="flex flex-col min-w-0">
                                        <p className="text-[11px] font-extrabold text-slate-905 truncate">{p.patientName}</p>
                                        <p className="text-[8px] text-slate-400 font-black uppercase mt-0.5 truncate">{p.procedureName}</p>
                                      </div>
                                      <span className={`px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider rounded border ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}>
                                        {p.status}
                                      </span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                            <span className="text-[9px] text-slate-400 font-bold uppercase">Realizados: {completedCount} | Pendentes: {pendingCount}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 4. Financeiro Previsto */}
                {activeSubtab === "financeiro" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      {/* Left: expected revenue by Category */}
                      <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-sm p-6 space-y-4">
                        <div>
                          <h3 className="text-sm font-black text-slate-950 uppercase tracking-widest">Distribuição por Categoria</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Faturamento previsto categorizado</p>
                        </div>

                        <div className="space-y-5">
                          {PROCEDURE_CATEGORIES.map((cat) => {
                            const catProcedures = plannedProcedures.filter((p) => p.procedureCategory === cat);
                            const totalMoney = catProcedures.reduce((acc, p) => acc + (p.expectedValue || 0), 0);
                            if (totalMoney === 0) return null;

                            return (
                              <div key={cat} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-extrabold text-slate-900">{cat}</span>
                                  <span className="font-black text-slate-950">
                                    R$ {totalMoney.toLocaleString("pt-BR")}{" "}
                                    <span className="text-[9px] font-medium text-slate-400">({catProcedures.length} procs)</span>
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                  <div
                                    className="bg-indigo-600 h-full rounded-full"
                                    style={{
                                      width: `${faturamentoPrevisto > 0 ? (totalMoney / faturamentoPrevisto) * 105 : 0}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}

                          {plannedProcedures.length === 0 && (
                            <p className="text-xs text-slate-400 text-center py-6">Nenhum procedimento lançado no faturamento.</p>
                          )}
                        </div>
                      </div>

                      {/* Right: revenue by Payment Method */}
                      <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-sm p-6 space-y-4">
                        <div>
                          <h3 className="text-sm font-black text-slate-950 uppercase tracking-widest">Método de Recebimento Previsto</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Metodologias de pagamento estimadas</p>
                        </div>

                        <div className="space-y-5">
                          {["Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Dinheiro"].map((method) => {
                            const methodProcedures = plannedProcedures.filter((p) => p.expectedPaymentMethod === method);
                            const totalMoney = methodProcedures.reduce((acc, p) => acc + (p.expectedValue || 0), 0);
                            if (totalMoney === 0) return null;

                            return (
                              <div key={method} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-extrabold text-slate-900">{method}</span>
                                  <span className="font-black text-slate-950">
                                    R$ {totalMoney.toLocaleString("pt-BR")}{" "}
                                    <span className="text-[9px] font-medium text-slate-400">({methodProcedures.length} procs)</span>
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                  <div
                                    className="bg-teal-600 h-full rounded-full"
                                    style={{
                                      width: `${faturamentoPrevisto > 0 ? (totalMoney / faturamentoPrevisto) * 105 : 0}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}

                          {plannedProcedures.length === 0 && (
                            <p className="text-xs text-slate-400 text-center py-6">Nenhuma estimativa de pagamento lançada.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Sequential Finance List */}
                    <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-sm p-6">
                      <div className="border-b border-slate-100 pb-4 mb-4">
                        <h3 className="text-sm font-black text-slate-950 uppercase tracking-widest">Detalhamento dos Lançamentos</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-semibold">Tabela de previsões cirúrgicas</p>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                              <th className="py-2.5 px-3">Data/Hora</th>
                              <th className="py-2.5 px-3">Paciente</th>
                              <th className="py-2.5 px-3">Categoria</th>
                              <th className="py-2.5 px-3">Profissional</th>
                              <th className="py-2.5 px-3">Forma de Pagamento</th>
                              <th className="py-2.5 px-3 text-right">Previsão Bruta</th>
                              <th className="py-2.5 px-3">Situação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {plannedProcedures.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="py-3 px-3 font-semibold text-slate-800 tabular-nums">
                                  {item.date} {item.time}
                                </td>
                                <td className="py-3 px-3 font-bold text-slate-950">{item.patientName}</td>
                                <td className="py-3 px-3">
                                  <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg font-bold">
                                    {item.procedureCategory}
                                  </span>
                                </td>
                                <td className="py-3 px-3 font-semibold text-slate-600">{item.professionalName}</td>
                                <td className="py-3 px-3 font-bold text-slate-550">{item.expectedPaymentMethod}</td>
                                <td className="py-3 px-3 text-right font-black text-slate-950">R$ {item.expectedValue}</td>
                                <td className="py-3 px-3">
                                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_STYLES[item.status]?.dot || "bg-slate-300"}`} title={item.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Materiais da Semana */}
                {activeSubtab === "materiais" && (
                  <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-sm p-6 space-y-4">
                    <div className="border-b border-slate-105 pb-4 mb-4">
                      <h3 className="text-sm font-bold text-slate-950 leading-none">Insumos e Inbound Materiais Cirúrgicos</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Materiais requeridos compilados por agendamentos</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-4">
                      {STANDARD_MATERIALS.map((mat) => {
                        const counting = plannedProcedures.filter((p) => (p.materialList || []).includes(mat));
                        return (
                          <div key={mat} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
                            <div>
                              <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest">{mat}</p>
                              <p className="text-lg font-black text-slate-950 tracking-tight mt-1">{counting.length} procedimentos</p>
                            </div>
                            {counting.length > 0 && (
                              <div className="mt-3 text-[10px] text-teal-650 font-bold uppercase pr-1 animate-pulse">
                                Requer separação ou autoclave
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Materials mapping */}
                    <div className="space-y-4 pt-4 border-t border-slate-150">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Detalhamento dos Insumos por Clínico de Paciente</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plannedProcedures
                          .filter((p) => p.materialList && p.materialList.length > 0)
                          .map((p) => (
                            <div key={p.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex items-start gap-3">
                              <div className="p-3 bg-teal-50 text-teal-650 rounded-xl">
                                <Package className="w-5 h-5 stroke-[2.5]" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-950 truncate">{p.patientName}</p>
                                <p className="text-[10px] font-semibold text-slate-500 truncate">{p.date} • {p.time}</p>
                                <div className="flex flex-wrap gap-1 mt-2.5">
                                  {p.materialList.map((m) => (
                                    <span key={m} className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide rounded bg-indigo-50 border border-indigo-100/50 text-indigo-700">
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        
                        {plannedProcedures.filter((p) => p.materialList && p.materialList.length > 0).length === 0 && (
                          <p className="text-xs text-slate-400 py-6 text-center col-span-2">Nenhum insumo planejado para os atendimentos desta semana.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: Adicionar Procedimento ao Planejamento */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <h2 className="text-md font-bold text-slate-950">Novo Planejamento Cirúrgico / Procedimento</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Vincule materiais e previsões</p>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded-full text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 p-6 space-y-4 overflow-y-auto custom-scrollbar">
                
                {/* Patient autocomplete selection */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Selecione o Paciente</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formPatientSearch}
                        onChange={(e) => {
                          setFormPatientSearch(e.target.value);
                          setFormPatientName(e.target.value);
                          setFormPatientId("");
                        }}
                        placeholder="Pesquise ou digite o nome..."
                        className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                      />
                      {formPatientSearch && !formPatientId && (
                        <div className="absolute left-0 right-0 top-12 max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg z-20 custom-scrollbar">
                          {dbPatients
                            .filter((p) => p.name.toLowerCase().includes(formPatientSearch.toLowerCase()))
                            .map((p) => (
                              <button
                                key={p.id}
                                onClick={() => {
                                  setFormPatientId(p.id);
                                  setFormPatientName(p.name);
                                  setFormPatientSearch(p.name);
                                }}
                                className="w-full text-left p-2 hover:bg-slate-50 text-xs font-bold border-b border-slate-100/50"
                              >
                                {p.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Profissional Responsável</label>
                    <select
                      value={formProfessionalId}
                      onChange={(e) => setFormProfessionalId(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      <option value="">Selecione o Cirurgião</option>
                      {professionals.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Data</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Horário</label>
                    <input
                      type="time"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Cadeira / Consultório</label>
                    <input
                      type="text"
                      value={formChair}
                      onChange={(e) => setFormChair(e.target.value)}
                      placeholder="Ex: Cadeira 1"
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Categoria do Procedimento</label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      {PROCEDURE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tratamento Específico</label>
                    <input
                      type="text"
                      value={formProcedureName}
                      onChange={(e) => setFormProcedureName(e.target.value)}
                      placeholder="Ex: Aplicação de 50U Botox"
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor Previsto (R$)</label>
                    <input
                      type="number"
                      value={formExpectedValue || ""}
                      onChange={(e) => setFormExpectedValue(Number(e.target.value))}
                      placeholder="Ex: 1200"
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Forma de Pagamento Prevista</label>
                    <select
                      value={formPaymentMethod}
                      onChange={(e) => setFormPaymentMethod(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      <option value="Pix">Pix</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Boleto">Boleto</option>
                      <option value="Dinheiro">Dinheiro</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Status Operacional</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Checklist de Materiais Necessários */}
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Insumos e Materiais Obrigatórios</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {STANDARD_MATERIALS.map((mat) => {
                      const isChecked = formMaterials.includes(mat);
                      return (
                        <button
                          key={mat}
                          onClick={() => {
                            if (isChecked) {
                              setFormMaterials(formMaterials.filter((m) => m !== mat));
                            } else {
                              setFormMaterials([...formMaterials, mat]);
                            }
                          }}
                          className={`flex items-center gap-2 p-2 border rounded-xl text-left text-[10px] font-bold uppercase transition-all ${
                            isChecked
                              ? "bg-teal-50 border-teal-500 text-teal-700 shadow-sm shadow-teal-500/5 font-black"
                              : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-white ${isChecked ? "bg-teal-600 border-teal-600" : "border-slate-300"}`}>
                            {isChecked && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                          </span>
                          <span className="truncate">{mat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observações Operacionais</label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Insumos adicionais, restrições do paciente, etc..."
                    rows={2}
                    className="w-full p-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold resize-none"
                  />
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 shrink-0 flex items-center justify-end gap-3">
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-5 h-11 rounded-xl text-xs font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateProcedure}
                  className="px-6 h-11 rounded-xl text-[10px] uppercase font-black tracking-widest text-white bg-teal-600 hover:bg-teal-700 cursor-pointer shadow-lg shadow-teal-500/10"
                >
                  Salvar Planejamento
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Editar Procedimento */}
      <AnimatePresence>
        {isEditModalOpen && selectedItemToEdit && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <h2 className="text-md font-bold text-slate-950">Editar Planejamento Operacional</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Ajuste insumos ou status operacional</p>
                </div>
                <button
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedItemToEdit(null);
                  }}
                  className="w-8 h-8 flex items-center justify-center bg-slate-250 hover:bg-slate-300 rounded-full text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 p-6 space-y-4 overflow-y-auto custom-scrollbar">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Paciente</label>
                    <input
                      type="text"
                      value={formPatientName}
                      disabled
                      className="w-full h-11 px-3 border border-slate-200 bg-slate-50 rounded-xl outline-none text-xs font-bold text-slate-450"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Profissional Responsável</label>
                    <select
                      value={formProfessionalId}
                      onChange={(e) => setFormProfessionalId(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      <option value="">Selecione o Cirurgião</option>
                      {professionals.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Data</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Horário</label>
                    <input
                      type="time"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Cadeira / Consultório</label>
                    <input
                      type="text"
                      value={formChair}
                      onChange={(e) => setFormChair(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Categoria do Procedimento</label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      {PROCEDURE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tratamento Específico</label>
                    <input
                      type="text"
                      value={formProcedureName}
                      onChange={(e) => setFormProcedureName(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor Previsto (R$)</label>
                    <input
                      type="number"
                      value={formExpectedValue || ""}
                      onChange={(e) => setFormExpectedValue(Number(e.target.value))}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Forma de Pagamento</label>
                    <select
                      value={formPaymentMethod}
                      onChange={(e) => setFormPaymentMethod(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      <option value="Pix">Pix</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Boleto">Boleto</option>
                      <option value="Dinheiro">Dinheiro</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Status Operacional</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-bold"
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  {formStatus === "Realizado" && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor Realizado (R$)</label>
                      <input
                        type="number"
                        value={formRealizedValue || ""}
                        onChange={(e) => setFormRealizedValue(Number(e.target.value))}
                        className="w-full h-11 px-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold"
                      />
                    </div>
                  )}
                </div>

                {/* Checklist de Materiais Necessários */}
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Insumos e Materiais Obrigatórios</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {STANDARD_MATERIALS.map((mat) => {
                      const isChecked = formMaterials.includes(mat);
                      return (
                        <button
                          key={mat}
                          onClick={() => {
                            if (isChecked) {
                              setFormMaterials(formMaterials.filter((m) => m !== mat));
                            } else {
                              setFormMaterials([...formMaterials, mat]);
                            }
                          }}
                          className={`flex items-center gap-2 p-2 border rounded-xl text-left text-[10px] font-bold uppercase transition-all ${
                            isChecked
                              ? "bg-teal-50 border-teal-500 text-teal-700 shadow-sm shadow-teal-500/5 font-black"
                              : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-white ${isChecked ? "bg-teal-600 border-teal-600" : "border-slate-300"}`}>
                            {isChecked && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                          </span>
                          <span className="truncate">{mat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observações Operacionais</label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Insumos adicionais, restrições do paciente, etc..."
                    rows={2}
                    className="w-full p-3 border border-slate-250 bg-white rounded-xl focus:border-teal-500 outline-none text-xs font-semibold resize-none"
                  />
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 shrink-0 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedItemToEdit(null);
                  }}
                  className="px-5 h-11 rounded-xl text-xs font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateProcedure}
                  className="px-6 h-11 rounded-xl text-[10px] uppercase font-black tracking-widest text-white bg-teal-600 hover:bg-teal-700 cursor-pointer shadow-lg shadow-teal-500/10"
                >
                  Salvar Alterações
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
