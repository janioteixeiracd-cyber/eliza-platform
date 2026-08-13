import React, { useState, useEffect, useRef } from "react";
import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  User,
  Users,
  Calendar as CalendarIcon,
  MoreVertical,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Filter,
  Download,
  CalendarDays,
  CalendarRange,
  Zap,
  Phone,
  MessageCircle,
  FileText,
  Search,
  AlertTriangle,
  Stethoscope,
  ExternalLink,
  Edit2,
  Sparkles,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ClinicalEvolutionMonitorService } from "../services/ClinicalEvolutionMonitorService";
import { syncAppointmentToPlanning } from "../services/planningSyncService";

const MINUTE_HEIGHT = 1.8;
const HOUR_HEIGHT = 60 * MINUTE_HEIGHT; // 108px
const HALF_HOUR_HEIGHT = 30 * MINUTE_HEIGHT; // 54px
const QUARTER_HOUR_HEIGHT = 15 * MINUTE_HEIGHT; // 27px

interface Appointment {
  id: string;
  patientName: string;
  patientId?: string;
  date: string;
  time: string;
  status:
    | "confirmado"
    | "pendente"
    | "atendimento"
    | "cancelado"
    | "encaixe"
    | "retorno"
    | "finalizado"
    | "aguardando"
    | "faltou";
  procedure: string;
  staffId: string;
  staffName: string;
  duration: number; // minutes
  observations?: string;
  phoneNumber?: string;
  raw?: any;
  chair?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: any;
}

interface Staff {
  id: string;
  name: string;
  role?: string;
  active?: boolean;
  status?: string;
  isClinicalProvider?: boolean;
  displayName?: string;
}

interface Patient {
  id: string;
  name: string;
  phone?: string;
}

const statusColors: Record<
  string,
  { bg: string; text: string; border: string; dot: string }
> = {
  confirmado: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-100",
    dot: "bg-emerald-500",
  },
  pendente: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-100",
    dot: "bg-amber-500",
  },
  atendimento: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-100",
    dot: "bg-blue-500",
  },
  cancelado: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-100",
    dot: "bg-rose-500",
  },
  encaixe: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-100",
    dot: "bg-purple-500",
  },
  retorno: {
    bg: "bg-teal-50",
    text: "text-teal-700",
    border: "border-teal-100",
    dot: "bg-teal-500",
  },
  finalizado: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
    dot: "bg-slate-500",
  },
  aguardando: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-100",
    dot: "bg-violet-500",
  },
  faltou: {
    bg: "bg-pink-50",
    text: "text-pink-700",
    border: "border-pink-100",
    dot: "bg-pink-500",
  },
};

const statusLabels: Record<string, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  atendimento: "Em Atendimento",
  cancelado: "Cancelado",
  encaixe: "Encaixe",
  retorno: "Retorno",
  finalizado: "Finalizado",
  aguardando: "Aguardando na recepção",
  faltou: "Faltou",
  fechado: "Fechado",
};

const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7:00 to 21:00

// Helper to format a Date object as YYYY-MM-DD in the user's local timezone
const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function CalendarView({
  onSelectPatient,
  preSelectedPatientId,
  onNavigateToChat,
  onNavigate,
}: {
  onSelectPatient?: (patientId: string | null) => void;
  preSelectedPatientId?: string | null;
  onNavigateToChat?: (patientId?: string) => void;
  onNavigate?: (view: any) => void;
}) {
  const { clinic, user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isSaturdayUtilitarian, setIsSaturdayUtilitarian] =
    useState<boolean>(false);
  const [isSundayUtilitarian, setIsSundayUtilitarian] =
    useState<boolean>(false);

  useEffect(() => {
    if (!clinic?.id) return;
    const unsub = onSnapshot(doc(db, "clinics", clinic.id), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setIsSaturdayUtilitarian(!!data.saturdayUtilitarian);
        setIsSundayUtilitarian(!!data.sundayUtilitarian);
      }
    });
    return unsub;
  }, [clinic?.id]);
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [hasHandledPreselected, setHasHandledPreselected] = useState(false);
  const [missingEvolutions, setMissingEvolutions] = useState<
    Record<string, boolean>
  >({});

  const [patientSearch, setPatientSearch] = useState("");
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [newAppointment, setNewAppointment] = useState({
    patientName: "",
    patientId: "",
    time: "09:00",
    date: getLocalDateString(),
    procedure: "",
    status: "pendente" as Appointment["status"],
    staffId: "",
    duration: 30,
    chair: "Cadeira 1",
    observations: "",
  });

  const [newApptTreatments, setNewApptTreatments] = useState<any[]>([]);
  const [loadingNewApptTreatments, setLoadingNewApptTreatments] =
    useState(false);
  const [selectedTreatmentId, setSelectedTreatmentId] =
    useState<string>("custom");

  const [editForm, setEditForm] = useState({
    id: "",
    patientName: "",
    patientId: "",
    time: "09:00",
    date: getLocalDateString(),
    procedure: "",
    status: "pendente" as Appointment["status"],
    staffId: "",
    duration: 30,
    chair: "Cadeira 1",
    observations: "",
  });

  const [openTreatments, setOpenTreatments] = useState<any[]>([]);
  const [loadingTreatments, setLoadingTreatments] = useState(false);

  const [isEditingInDrawer, setIsEditingInDrawer] = useState(false);
  const [isWhatsAppIntegrated, setIsWhatsAppIntegrated] = useState(false);
  const [plannedProcedures, setPlannedProcedures] = useState<any[]>([]);
  const [loadingPlanning, setLoadingPlanning] = useState(false);

  // States for inline planning editor
  const [isEditingInlinePlan, setIsEditingInlinePlan] = useState(false);
  const [inlineProcedureName, setInlineProcedureName] = useState("");
  const [inlineCategory, setInlineCategory] = useState("Outro");
  const [inlineValue, setInlineValue] = useState(0);
  const [inlinePaymentMethod, setInlinePaymentMethod] = useState("Pix");
  const [inlineMaterials, setInlineMaterials] = useState<string[]>([]);
  const [rawMaterialInput, setRawMaterialInput] = useState("");
  const [patientApprovedBudgets, setPatientApprovedBudgets] = useState<any[]>(
    [],
  );
  const [patientTreatments, setPatientTreatments] = useState<any[]>([]);
  const [loadingApprovedData, setLoadingApprovedData] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clinic) {
      console.log("[ELIZA] calendar wait state: clinic not yet loaded");
      return;
    }

    const isDebugActive =
      (import.meta as any).env?.VITE_DEBUG_FIREBASE === "true";

    if (isDebugActive) {
      console.log("[ELIZA] entering calendar bootstrap");
    }

    const startOfMonth = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      1,
    );
    const endOfMonth = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth() + 1,
      0,
    );
    const startStr = getLocalDateString(startOfMonth);
    const endStr = getLocalDateString(endOfMonth);
    const apptsPath = `clinics/${clinic.id}/appointments`;

    if (isDebugActive) {
      console.log(
        `[ELIZA] loading appointments query for ${apptsPath} (${startStr} to ${endStr})...`,
      );
    }
    const qA = query(
      collection(db, "clinics", clinic.id, "appointments"),
      where("date", ">=", startStr),
      where("date", "<=", endStr),
    );

    let unsubA = () => {};
    let unsubS = () => {};
    let unsubP = () => {};
    let unsubPending = () => {};

    unsubA = onSnapshot(
      qA,
      (snapshot) => {
        if (isDebugActive) {
          console.log(`[ELIZA] appointments loaded: ${snapshot.size} docs`);
        }
        const list = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Appointment,
        );
        // Sort in memory to avoid needing a composite index on (date, time)
        const sortedList = [...list].sort((a, b) => {
          const dateCompare = (a.date || "").localeCompare(b.date || "");
          if (dateCompare !== 0) return dateCompare;
          return (a.time || "").localeCompare(b.time || "");
        });
        setAppointments(sortedList);
      },
      (err) => {
        console.error(`[ELIZA] ERROR in calendar:appointments: ${err.message}`);
        if (err.message?.includes("index")) {
          if (isDebugActive) {
            console.log(`[ELIZA] trying fallback for calendar appointments...`);
          }
          // Fallback to limited global query if index is missing
          const qFallback = query(
            collection(db, "clinics", clinic.id, "appointments"),
            limit(300),
          );
          unsubA = onSnapshot(qFallback, (snap) => {
            setAppointments(
              snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Appointment),
            );
          });
        } else {
          handleFirestoreError(err, OperationType.GET, apptsPath);
        }
      },
    );

    if (isDebugActive) {
      console.log(`[ELIZA] loading members query for calendar...`);
    }
    unsubS = onSnapshot(
      collection(db, "clinics", clinic.id, "team_members"),
      (snapshot) => {
        if (isDebugActive) {
          console.log(`[ELIZA] team_members loaded: ${snapshot.size} docs`);
        }
        const filteredClinical = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }) as Staff)
          .filter((member) => {
            if (member.active === false || member.status === "inactive")
              return false;
            if (member.isClinicalProvider !== undefined) {
              return member.isClinicalProvider === true;
            }
            const role = (member.role || "").toLowerCase().trim();
            const clinicalRoles = [
              "dentist",
              "dentist_gp",
              "cirurgiao_dentista",
              "cirurgião dentista",
              "especialista",
              "professional",
              "clinical_professional",
              "doctor",
              "dentista",
              "odontologista",
              "médico",
            ];
            return clinicalRoles.includes(role);
          });
        setStaff(filteredClinical);
      },
      (err) => {
        console.error(`[ELIZA] ERROR in calendar:team_members: ${err.message}`);
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/team_members`,
        );
      },
    );

    if (isDebugActive) {
      console.log(`[ELIZA] loading patients query (limited) for calendar...`);
    }
    unsubP = onSnapshot(
      collection(db, "clinics", clinic.id, "patients"),
      (snapshot) => {
        if (isDebugActive) {
          console.log(`[ELIZA] patients loaded: ${snapshot.size} docs`);
        }
        setPatients(
          snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as Patient,
          ),
        );
      },
      (err) => {
        console.error(`[ELIZA] ERROR in calendar:patients: ${err.message}`);
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/patients`,
        );
      },
    );

    if (isDebugActive) {
      console.log(`[ELIZA] subscribing to missing evolution pending items...`);
    }
    unsubPending = onSnapshot(
      query(
        collection(db, "clinics", clinic.id, "pending_items"),
        where("type", "==", "missing_clinical_evolution"),
        where("status", "==", "pending"),
      ),
      (snapshot) => {
        const missing: Record<string, boolean> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.appointmentId) {
            missing[data.appointmentId] = true;
          }
        });
        setMissingEvolutions(missing);
      },
      (err) => {
        console.error(
          "[CalendarView] Error loading missing evolutions query:",
          err,
        );
      },
    );

    ClinicalEvolutionMonitorService.checkDailyMissingEvolutions(
      clinic.id,
      formatDate(selectedDate),
    );

    return () => {
      if (isDebugActive) {
        console.log("[ELIZA] exiting calendar bootstrap");
      }
      unsubA();
      unsubS();
      unsubP();
      unsubPending();
    };
  }, [clinic, selectedDate.getMonth(), selectedDate.getFullYear()]);

  useEffect(() => {
    if (clinic?.id) {
      ClinicalEvolutionMonitorService.checkDailyMissingEvolutions(
        clinic.id,
        formatDate(selectedDate),
      );
    }
  }, [selectedDate, clinic?.id]);

  useEffect(() => {
    if (preSelectedPatientId && patients.length > 0 && !hasHandledPreselected) {
      const match = patients.find((p) => p.id === preSelectedPatientId);
      if (match) {
        setNewAppointment((prev) => ({
          ...prev,
          patientName: match.name,
          patientId: match.id,
          date: formatDate(selectedDate),
        }));
        setPatientSearch(match.name);
        setIsAddModalOpen(true);
        setHasHandledPreselected(true);
      }
    }
  }, [preSelectedPatientId, patients, hasHandledPreselected, selectedDate]);

  useEffect(() => {
    const term = (patientSearch || "").trim().toLowerCase();
    if (term) {
      setFilteredPatients(
        patients.filter((p) => (p.name || "").toLowerCase().includes(term)),
      );
    } else {
      setFilteredPatients([]);
    }
  }, [patientSearch, patients]);

  useEffect(() => {
    if (!clinic || !selectedAppointment) {
      setOpenTreatments([]);
      return;
    }

    let pId = selectedAppointment.patientId;
    if (!pId) {
      const match = patients.find(
        (p) =>
          p.name.toLowerCase() ===
          selectedAppointment.patientName.toLowerCase(),
      );
      if (match) {
        pId = match.id;
      }
    }

    if (!pId) {
      setOpenTreatments([]);
      return;
    }

    setLoadingTreatments(true);
    const treatmentsRef = collection(
      db,
      "clinics",
      clinic.id,
      "patients",
      pId,
      "treatments",
    );
    const q = query(treatmentsRef, limit(5));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setOpenTreatments(list);
        setLoadingTreatments(false);
      },
      (err) => {
        console.error("[ELIZA] Error loading client treatments:", err);
        setLoadingTreatments(false);
      },
    );

    return () => unsub();
  }, [selectedAppointment, clinic, patients]);

  // Read active WhatsApp integration state
  useEffect(() => {
    if (!clinic) {
      setIsWhatsAppIntegrated(false);
      return;
    }
    const integrationRef = doc(
      db,
      "clinics",
      clinic.id,
      "integrations",
      "whatsapp",
    );
    const unsub = onSnapshot(
      integrationRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setIsWhatsAppIntegrated(data.status === "conectado");
        } else {
          setIsWhatsAppIntegrated(false);
        }
      },
      (err) => {
        console.error("[ELIZA] Error checking whatsapp integration:", err);
        setIsWhatsAppIntegrated(false);
      },
    );
    return () => unsub();
  }, [clinic]);

  // Read planned procedures in real-time
  useEffect(() => {
    if (!clinic || !selectedAppointment) {
      setPlannedProcedures([]);
      return;
    }

    let pId = selectedAppointment.patientId;
    if (!pId) {
      const match = patients.find(
        (p) =>
          p.name.toLowerCase() ===
          selectedAppointment.patientName.toLowerCase(),
      );
      if (match) {
        pId = match.id;
      }
    }

    if (!pId) {
      setPlannedProcedures([]);
      return;
    }

    setLoadingPlanning(true);
    const plannedRef = collection(
      db,
      "clinics",
      clinic.id,
      "planned_procedures",
    );
    const q = query(plannedRef, where("patientId", "==", pId));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }));
        setPlannedProcedures(list);
        setLoadingPlanning(false);
      },
      (err) => {
        console.error("[ELIZA] Error loading planned procedures:", err);
        setLoadingPlanning(false);
      },
    );

    return () => unsub();
  }, [selectedAppointment, clinic, patients]);

  // Fetch patient approved budgets and treatments
  useEffect(() => {
    if (!clinic || !selectedAppointment) {
      setPatientApprovedBudgets([]);
      setPatientTreatments([]);
      return;
    }

    let pId = selectedAppointment.patientId;
    if (!pId) {
      const match = patients.find(
        (p) =>
          p.name.toLowerCase() ===
          selectedAppointment.patientName.toLowerCase(),
      );
      if (match) pId = match.id;
    }

    if (!pId) {
      setPatientApprovedBudgets([]);
      setPatientTreatments([]);
      return;
    }

    setLoadingApprovedData(true);
    const patientBasePath = `clinics/${clinic.id}/patients/${pId}`;

    // Query approved budgets (quotations)
    const qQuotationsRef = collection(db, patientBasePath, "quotations");
    const qQuotations = query(
      qQuotationsRef,
      where("status", "==", "approved"),
    );

    // Query active treatments
    const qTreatmentsRef = collection(db, patientBasePath, "treatments");

    let unsubQ = () => {};
    let unsubT = () => {};

    try {
      unsubQ = onSnapshot(qQuotations, (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPatientApprovedBudgets(list);
      });

      unsubT = onSnapshot(
        qTreatmentsRef,
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setPatientTreatments(list);
          setLoadingApprovedData(false);
        },
        (err) => {
          console.error("[ELIZA] Error loading treats snapshot:", err);
          setLoadingApprovedData(false);
        },
      );
    } catch (err) {
      console.error(
        "[ELIZA] Error loading patient medical info for planning:",
        err,
      );
      setLoadingApprovedData(false);
    }

    return () => {
      unsubQ();
      unsubT();
    };
  }, [clinic, selectedAppointment, patients]);

  // Prefill inline editor states when active appointment plan is found
  useEffect(() => {
    if (!selectedAppointment) {
      setIsEditingInlinePlan(false);
      return;
    }
    const appointmentPlan = plannedProcedures.find(
      (p) => p.appointmentId === selectedAppointment.id,
    );
    if (appointmentPlan) {
      setInlineProcedureName(
        appointmentPlan.procedureName !== "Não planejado"
          ? appointmentPlan.procedureName
          : "",
      );
      setInlineCategory(appointmentPlan.procedureCategory || "Outro");
      setInlineValue(appointmentPlan.expectedValue || 0);
      setInlinePaymentMethod(appointmentPlan.expectedPaymentMethod || "Pix");
      setInlineMaterials(appointmentPlan.materialList || []);
      setRawMaterialInput(
        appointmentPlan.materialList
          ? appointmentPlan.materialList.join(", ")
          : "",
      );
    } else {
      setInlineProcedureName("");
      setInlineCategory("Outro");
      setInlineValue(0);
      setInlinePaymentMethod("Pix");
      setInlineMaterials([]);
      setRawMaterialInput("");
    }
  }, [selectedAppointment, plannedProcedures]);

  useEffect(() => {
    if (!clinic || !newAppointment.patientId) {
      setNewApptTreatments([]);
      setSelectedTreatmentId("custom");
      return;
    }

    setLoadingNewApptTreatments(true);
    const treatmentsRef = collection(
      db,
      "clinics",
      clinic.id,
      "patients",
      newAppointment.patientId,
      "treatments",
    );
    const q = query(treatmentsRef, limit(15));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setNewApptTreatments(list);
        setLoadingNewApptTreatments(false);
      },
      (err) => {
        console.error(
          "[ELIZA] Error loading treatments for new appointment:",
          err,
        );
        setLoadingNewApptTreatments(false);
      },
    );

    return () => unsub();
  }, [newAppointment.patientId, clinic]);

  const handleTimelineClick = (h: number, m: string) => {
    const hStr = h < 10 ? `0${h}` : `${h}`;
    setNewAppointment({
      patientName: "",
      patientId: "",
      time: `${hStr}:${m}`,
      date: formatDate(selectedDate),
      procedure: "",
      status: "pendente",
      staffId: staff[0]?.id || "",
      duration: 30,
      chair: "Cadeira 1",
      observations: "",
    });
    setPatientSearch("");
    setIsAddModalOpen(true);
  };

  const formatDate = (date: Date) => getLocalDateString(date);

  const addMinutesToTime = (timeStr: string, minutes: number) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    const total = h * 60 + m + minutes;
    const endH = Math.floor(total / 60) % 24;
    const endM = total % 60;
    return `${endH < 10 ? `0${endH}` : endH}:${endM < 10 ? `0${endM}` : endM}`;
  };

  const checkConflict = (
    date: string,
    time: string,
    duration: number,
    staffId: string,
    chair: string,
    excludeId?: string,
  ) => {
    const start = timeToMinutes(time);
    const end = start + duration;

    return appointments.some((apt) => {
      if (excludeId && apt.id === excludeId) return false;
      if (apt.date !== date) return false;
      if (apt.status === "cancelado") return false;

      const aptStart = timeToMinutes(apt.time);
      const aptEnd = aptStart + apt.duration;

      const overlap = start < aptEnd && end > aptStart;
      if (overlap) {
        return apt.staffId === staffId || (chair && apt.chair === chair);
      }
      return false;
    });
  };

  const handleOpenEditModal = (apt: Appointment) => {
    setEditForm({
      id: apt.id,
      patientName: apt.patientName,
      patientId: apt.patientId || "",
      time: apt.time,
      date: apt.date,
      procedure: apt.procedure || "",
      status: apt.status,
      staffId: apt.staffId || "",
      duration: apt.duration || 30,
      chair: apt.chair || "Cadeira 1",
      observations: apt.observations || "",
    });
    setPatientSearch(apt.patientName);
    setIsEditModalOpen(true);
  };

  const handleUpdateAppointment = async () => {
    if (!editForm.id || !clinic) return;
    const staffMember = staff.find((s) => s.id === editForm.staffId);
    const path = `clinics/${clinic.id}/appointments/${editForm.id}`;
    try {
      await updateDoc(
        doc(db, "clinics", clinic.id, "appointments", editForm.id),
        {
          patientName: editForm.patientName,
          patientId: editForm.patientId,
          time: editForm.time,
          date: editForm.date,
          procedure: editForm.procedure,
          status: editForm.status,
          staffId: editForm.staffId,
          staffName: staffMember?.name || "Não atribuído",
          duration: editForm.duration,
          chair: editForm.chair,
          observations: editForm.observations,
          updatedAt: serverTimestamp(),
        },
      );
      await syncAppointmentToPlanning(clinic.id, editForm.id, {
        patientName: editForm.patientName,
        patientId: editForm.patientId,
        time: editForm.time,
        date: editForm.date,
        procedure: editForm.procedure,
        status: editForm.status,
        staffId: editForm.staffId,
        staffName: staffMember?.name || "Não atribuído",
        duration: editForm.duration,
        chair: editForm.chair,
        observations: editForm.observations,
      });
      setIsEditModalOpen(false);
      setSelectedAppointment(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleUpdateInDrawer = async () => {
    if (!editForm.id || !clinic) return;
    const staffMember = staff.find((s) => s.id === editForm.staffId);
    const path = `clinics/${clinic.id}/appointments/${editForm.id}`;
    try {
      await updateDoc(
        doc(db, "clinics", clinic.id, "appointments", editForm.id),
        {
          time: editForm.time,
          date: editForm.date,
          procedure: editForm.procedure,
          status: editForm.status,
          staffId: editForm.staffId,
          staffName: staffMember?.name || "Não atribuído",
          duration: editForm.duration,
          chair: editForm.chair,
          observations: editForm.observations,
          updatedAt: serverTimestamp(),
        },
      );

      const updated = {
        ...selectedAppointment!,
        time: editForm.time,
        date: editForm.date,
        procedure: editForm.procedure,
        status: editForm.status,
        staffId: editForm.staffId,
        staffName: staffMember?.name || "Não atribuído",
        duration: editForm.duration,
        chair: editForm.chair,
        observations: editForm.observations,
      };

      await syncAppointmentToPlanning(clinic.id, editForm.id, updated);
      setSelectedAppointment(updated);
      setIsEditingInDrawer(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleQuickStatusChange = async (newStatus: Appointment["status"]) => {
    if (!selectedAppointment || !clinic) return;
    const path = `clinics/${clinic.id}/appointments/${selectedAppointment.id}`;
    try {
      await updateDoc(
        doc(db, "clinics", clinic.id, "appointments", selectedAppointment.id),
        { status: newStatus },
      );

      await syncAppointmentToPlanning(clinic.id, selectedAppointment.id, {
        ...selectedAppointment,
        status: newStatus,
      });

      if (newStatus === "finalizado") {
        await ClinicalEvolutionMonitorService.checkAppointmentEvolution(
          clinic.id,
          { ...selectedAppointment, status: newStatus as any },
        );
      }

      setSelectedAppointment((prev) =>
        prev ? { ...prev, status: newStatus } : null,
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const getWhatsAppLink = () => {
    if (!selectedAppointment) return "#";
    const pId = selectedAppointment.patientId;
    let matchedPatient = patients.find((p) => p.id === pId);
    if (!matchedPatient && selectedAppointment.patientName) {
      matchedPatient = patients.find(
        (p) =>
          p.name.toLowerCase() ===
          selectedAppointment.patientName.toLowerCase(),
      );
    }
    const rawPhone =
      matchedPatient?.phone ||
      selectedAppointment.phoneNumber ||
      (selectedAppointment as any).raw?.phone ||
      "";
    const cleanPhone = rawPhone.replace(/\D/g, "");
    if (!cleanPhone) return "";
    const finalPhone = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;
    return `https://wa.me/${finalPhone}`;
  };

  const handleDropAppointment = async (
    e: React.DragEvent,
    targetDate: string,
    targetTime: string,
  ) => {
    e.preventDefault();
    const appointmentId = e.dataTransfer.getData("appointmentId");
    if (!appointmentId || !clinic) return;

    const apt = appointments.find((a) => a.id === appointmentId);
    if (!apt) return;

    if (apt.date === targetDate && apt.time === targetTime) return;

    const path = `clinics/${clinic.id}/appointments/${appointmentId}`;
    try {
      await updateDoc(
        doc(db, "clinics", clinic.id, "appointments", appointmentId),
        {
          date: targetDate,
          time: targetTime,
          updatedAt: serverTimestamp(),
        },
      );
      await syncAppointmentToPlanning(clinic.id, appointmentId, {
        ...apt,
        date: targetDate,
        time: targetTime,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleAddAppointment = async () => {
    if (!newAppointment.patientName || !newAppointment.staffId || !clinic)
      return;
    const staffMember = staff.find((s) => s.id === newAppointment.staffId);
    const path = `clinics/${clinic.id}/appointments`;
    try {
      const docRef = await addDoc(
        collection(db, "clinics", clinic.id, "appointments"),
        {
          ...newAppointment,
          staffName: staffMember?.name || "Não atribuído",
          createdAt: serverTimestamp(),
          createdBy: user?.uid || "system",
          createdByName:
            user?.displayName || user?.email || "Recepção / Sistema",
        },
      );
      await syncAppointmentToPlanning(clinic.id, docRef.id, {
        ...newAppointment,
        staffName: staffMember?.name || "Não atribuído",
        createdBy: user?.uid || "system",
        createdByName: user?.displayName || user?.email || "Recepção / Sistema",
      });
      setIsAddModalOpen(false);
      setNewAppointment({
        patientName: "",
        patientId: "",
        time: "09:00",
        date: formatDate(selectedDate),
        procedure: "",
        status: "pendente",
        staffId: "",
        duration: 30,
        chair: "Cadeira 1",
        observations: "",
      });
      setPatientSearch("");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleSaveInlinePlanning = async (
    procedureName: string,
    category: string,
    value: number,
    paymentMethod: string,
    materials: string[],
  ) => {
    if (!clinic || !selectedAppointment) return;

    try {
      // 1. Update appointment's procedure and details
      const apptRef = doc(
        db,
        "clinics",
        clinic.id,
        "appointments",
        selectedAppointment.id,
      );
      await updateDoc(apptRef, {
        procedure: procedureName,
        procedureCategory: category,
        updatedAt: serverTimestamp(),
      });

      // 2. Query and update or create matching planned procedure document
      const plannedRef = collection(
        db,
        "clinics",
        clinic.id,
        "planned_procedures",
      );
      const q = query(
        plannedRef,
        where("appointmentId", "==", selectedAppointment.id),
      );
      const snap = await getDocs(q);

      const payload: any = {
        appointmentId: selectedAppointment.id,
        patientId: selectedAppointment.patientId || "manual-" + Date.now(),
        patientName: selectedAppointment.patientName,
        date: selectedAppointment.date,
        time: selectedAppointment.time,
        duration: Number(selectedAppointment.duration) || 30,
        chair: selectedAppointment.chair || "Cadeira 1",
        procedureName: procedureName,
        procedureCategory: category,
        expectedValue: Number(value) || 0,
        expectedPaymentMethod: paymentMethod,
        materialList: materials,
        planningStatus: "planned",
        status: "Planejado",
        updatedAt: serverTimestamp(),
      };

      if (!snap.empty) {
        await updateDoc(
          doc(db, "clinics", clinic.id, "planned_procedures", snap.docs[0].id),
          payload,
        );
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(plannedRef, payload);
      }

      // 3. Keep sync service updated to resolve notifications
      await syncAppointmentToPlanning(clinic.id, selectedAppointment.id, {
        ...selectedAppointment,
        procedure: procedureName,
        procedureCategory: category,
        expectedValue: Number(value) || 0,
        expectedPaymentMethod: paymentMethod,
        materialList: materials,
      });

      setIsEditingInlinePlan(false);
    } catch (err) {
      console.error("[ELIZA PINLINE] Error saving inline planning:", err);
      throw err;
    }
  };

  const getWeekDays = (baseDate: Date) => {
    const days = [];
    const curr = new Date(baseDate);
    const first = curr.getDate() - curr.getDay();
    for (let i = 0; i < 7; i++) {
      const d = new Date(curr);
      d.setDate(first + i);
      days.push(d);
    }
    return days;
  };

  const timeToMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  };

  const renderAppointment = (apt: Appointment) => {
    const startMinutes = timeToMinutes(apt.time);
    const top = (startMinutes - 7 * 60) * MINUTE_HEIGHT; // Dynamic height using scalar
    const height = Math.max(apt.duration * MINUTE_HEIGHT - 2, 28);
    const colors = statusColors[apt.status] || statusColors.pendente;
    const isMissingEvolution =
      (apt.status === "finalizado" ||
        (apt.status as string) === "concluido" ||
        (apt.status as string) === "completed" ||
        (apt.status as string) === "atendido") &&
      missingEvolutions[apt.id];

    const isCompact = height < 40;

    // Side-by-side positioning logic for overlapping appointments
    const dayApts = appointments.filter(
      (a) =>
        a.date === apt.date &&
        (selectedStaffId === "all" || a.staffId === selectedStaffId),
    );

    const getAppointmentLayout = () => {
      const activeDayApts = dayApts;

      // Sort by start time, then by duration descending
      const sorted = [...activeDayApts].sort((a, b) => {
        const startA = timeToMinutes(a.time);
        const startB = timeToMinutes(b.time);
        if (startA !== startB) return startA - startB;
        return b.duration - a.duration;
      });

      const columns: Appointment[][] = [];
      const aptToColIndex = new Map<string, number>();

      for (const item of sorted) {
        const start = timeToMinutes(item.time);
        const end = start + item.duration;

        let assignedIndex = -1;
        for (let c = 0; c < columns.length; c++) {
          let overlaps = false;
          for (const existing of columns[c]) {
            const existStart = timeToMinutes(existing.time);
            const existEnd = existStart + existing.duration;
            if (start < existEnd && existStart < end) {
              overlaps = true;
              break;
            }
          }
          if (!overlaps) {
            assignedIndex = c;
            break;
          }
        }

        if (assignedIndex === -1) {
          columns.push([item]);
          assignedIndex = columns.length - 1;
        } else {
          columns[assignedIndex].push(item);
        }
        aptToColIndex.set(item.id, assignedIndex);
      }

      const colIndex = aptToColIndex.get(apt.id) ?? 0;
      const targetStart = timeToMinutes(apt.time);
      const targetEnd = targetStart + apt.duration;

      const overlappingApts = sorted.filter((item) => {
        const start = timeToMinutes(item.time);
        const end = start + item.duration;
        return targetStart < end && start < targetEnd;
      });

      const colIndexesInvolved = overlappingApts.map(
        (item) => aptToColIndex.get(item.id) ?? 0,
      );
      const maxInvolvedColIndex =
        colIndexesInvolved.length > 0 ? Math.max(...colIndexesInvolved) : 0;
      const totalCols = Math.max(maxInvolvedColIndex + 1, 1);

      return { colIndex, totalCols };
    };

    const layout = getAppointmentLayout();
    const leftPercent = (layout.colIndex / layout.totalCols) * 100;
    const widthPercent = 100 / layout.totalCols;

    // Resolve professional names
    const doctorName = apt.staffName || staff.find((s) => s.id === apt.staffId)?.name || "";
    
    // Helper to get initials / short name
    const getShortDoctorName = (nameStr: string) => {
      if (!nameStr) return "";
      const cleaned = nameStr.replace(/^(dr\(a\)\.?|dr\.?|dra\.?|prof\.?)\s+/i, "").trim();
      const parts = cleaned.split(/\s+/);
      if (parts.length === 0) return "";
      if (parts.length === 1) return parts[0];
      const firstName = parts[0];
      const lastName = parts[parts.length - 1];
      return `${firstName} ${lastName[0]}.`;
    };
    const docShort = getShortDoctorName(doctorName);

    return (
      <div
        onClick={() => setSelectedAppointment(apt)}
        key={apt.id}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData("appointmentId", apt.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        style={{
          top: `${top}px`,
          height: `${height}px`,
          left: `calc(${leftPercent}% + 4px)`,
          width: `calc(${widthPercent}% - 8px)`,
        }}
        className={`absolute rounded-xl border-2 border-l-4 ${colors.bg} ${colors.border} cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md hover:scale-[1.01] transition-all group overflow-visible z-10 ${
          isMissingEvolution
            ? "shadow-[0_0_12px_rgba(244,63,94,0.12)] ring-1 ring-rose-200/40"
            : ""
        } ${
          apt.status === "confirmado"
            ? "border-l-emerald-500"
            : apt.status === "pendente"
              ? "border-l-amber-500"
              : apt.status === "atendimento"
                ? "border-l-blue-500"
                : apt.status === "aguardando"
                  ? "border-l-violet-500"
                  : apt.status === "faltou"
                    ? "border-l-pink-500"
                    : apt.status === "cancelado"
                      ? "border-l-rose-500"
                      : apt.status === "encaixe"
                        ? "border-l-purple-500"
                        : apt.status === "retorno"
                          ? "border-l-teal-500"
                          : "border-l-slate-450"
        }`}
        title={`${apt.patientName} (${apt.time}) - ${apt.procedure || "Consulta"}`}
      >
        {isCompact ? (
          <div className="flex items-center justify-between h-full px-2 py-0.5">
            <div className="flex items-center gap-2 truncate min-w-0 w-full">
              <div
                className={`w-2 h-2 rounded-full ${isMissingEvolution ? "bg-rose-500 animate-pulse ring-2 ring-rose-100" : colors.dot} shrink-0`}
              />
              <span className="font-semibold text-[10px] text-slate-600 tabular-nums shrink-0">
                {apt.time}
              </span>
              <span className="font-semibold text-[13.5px] text-slate-900 truncate leading-tight whitespace-nowrap">
                {apt.patientName}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500 text-[10px] truncate">
                {apt.procedure || "Consulta"}
              </span>
              {apt.chair && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-indigo-700 font-semibold bg-indigo-50/80 px-1 py-0.2 rounded border border-indigo-100 text-[8.5px] uppercase tracking-wide">
                    {apt.chair}
                  </span>
                </>
              )}
              {docShort && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-teal-700 font-semibold bg-teal-50/80 px-1 py-0.2 rounded border border-teal-100 text-[8.5px] uppercase tracking-wide">
                    {docShort}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full justify-between p-2.5">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${isMissingEvolution ? "bg-rose-500 animate-pulse ring-2 ring-rose-100" : colors.dot} shrink-0`}
                  />
                  <span className="text-[10.5px] font-semibold text-slate-500 tabular-nums tracking-wide">
                    {apt.time} - {addMinutesToTime(apt.time, apt.duration)}
                  </span>
                </div>
                {isMissingEvolution && (
                  <span className="text-[8.5px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse whitespace-nowrap shrink-0">
                    Evolução Pendente
                  </span>
                )}
              </div>
              <p
                className="text-[15px] font-semibold text-slate-900 mt-1 lines-clamp-2 leading-snug tracking-tight break-words whitespace-normal overflow-hidden" 
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {apt.patientName}
              </p>
            </div>
            <div className="flex items-center justify-between gap-1.5 mt-1 text-[10px] text-slate-500 font-medium w-full min-w-0">
              <span className="truncate text-slate-600 max-w-[50%]">{apt.procedure || "Consulta"}</span>
              <div className="flex items-center gap-1 shrink-0">
                {apt.chair && (
                  <span className="text-indigo-700 font-semibold bg-indigo-50 border border-indigo-100/50 px-1.5 py-0.5 rounded text-[8.5px] uppercase tracking-wide">
                    {apt.chair}
                  </span>
                )}
                {docShort && (
                  <span className="text-teal-700 font-semibold bg-teal-50 border border-teal-100/50 px-1.5 py-0.5 rounded text-[8.5px] uppercase tracking-wide">
                    {docShort}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Small Exclamation tool tip on bottom right */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            setActiveTooltipId(activeTooltipId === apt.id ? null : apt.id);
          }}
          onMouseEnter={() => setActiveTooltipId(apt.id)}
          onMouseLeave={() => setActiveTooltipId(null)}
          className="absolute bottom-1 right-1 z-30 cursor-pointer p-0.5 rounded-full hover:bg-slate-200/50 active:bg-slate-300/60 transition-colors"
        >
          <AlertCircle className="w-3 h-3 text-slate-400 hover:text-teal-600 transition-colors" />

          {activeTooltipId === apt.id && (
            <div className="absolute bottom-6 right-0 w-52 p-2.5 bg-slate-900 border border-slate-800 text-white text-[10px] rounded-xl shadow-xl z-50 pointer-events-none select-none">
              <div className="font-extrabold text-teal-400 uppercase tracking-widest text-[8px] mb-1">
                Criado Por
              </div>
              <div className="flex flex-col gap-1 leading-tight text-slate-300">
                <div>
                  <span className="text-slate-500 font-bold">Por:</span>{" "}
                  <strong className="text-white">
                    {apt.createdByName ||
                      apt.createdBy ||
                      apt.staffName ||
                      "Recepção / Sistema"}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 font-bold">Data/Hora:</span>{" "}
                  <strong className="text-white">
                    {apt.createdAt
                      ? apt.createdAt.seconds
                        ? new Date(
                            apt.createdAt.seconds * 1000,
                          ).toLocaleDateString("pt-BR") +
                          " às " +
                          new Date(
                            apt.createdAt.seconds * 1000,
                          ).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : new Date(apt.createdAt).toLocaleDateString("pt-BR") +
                          " às " +
                          new Date(apt.createdAt).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                      : `Agendado p/ ${apt.date}`}
                  </strong>
                </div>
              </div>
              <div className="absolute right-2 bottom-[-4px] w-2 h-2 bg-slate-900 rotate-45 border-r border-b border-indigo-950/20"></div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* Real-time Operational Header */}
      <div className="h-20 border-b border-slate-100 px-6 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Agenda
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Tempo Real
              </p>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-100" />

          {/* Date Navigation Hub */}
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
              <button
                onClick={() => {
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() - (viewMode === "day" ? 1 : 7));
                  setSelectedDate(d);
                }}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-500"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                onClick={() => setSelectedDate(new Date())}
                className="px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-teal-600 transition-colors"
              >
                Hoje
              </button>

              <button
                onClick={() => {
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() + (viewMode === "day" ? 1 : 7));
                  setSelectedDate(d);
                }}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-500"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-900 capitalize leading-none">
                {selectedDate.toLocaleDateString("pt-BR", {
                  day: "numeric",
                  month: "long",
                })}
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">
                {selectedDate.toLocaleDateString("pt-BR", { weekday: "long" })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Professional Quick Selector */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-100">
            <User className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="bg-transparent text-[10px] font-bold uppercase tracking-widest text-slate-600 outline-none pr-2"
            >
              <option value="all">Filtro Profissional</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || "Sem nome"}
                </option>
              ))}
            </select>
          </div>

          {/* View Switcher */}
          <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
            <button
              onClick={() => setViewMode("day")}
              className={`p-1.5 rounded-lg transition-all ${viewMode === "day" ? "bg-white shadow-sm text-teal-600" : "text-slate-400 hover:text-slate-600"}`}
            >
              <CalendarDays className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`p-1.5 rounded-lg transition-all ${viewMode === "week" ? "bg-white shadow-sm text-teal-600" : "text-slate-400 hover:text-slate-600"}`}
            >
              <CalendarRange className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="h-10 bg-teal-600 text-white px-5 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-teal-600/20 hover:bg-teal-700 transition-all flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Agendamento
          </button>
        </div>
      </div>

      {/* Main Operational Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Support Sidebar (Mini Calendar & AI) */}
        <aside className="w-64 border-r border-slate-100 h-full overflow-y-auto bg-slate-50/50 p-5 shrink-0 hidden 2xl:block custom-scrollbar">
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm mb-6 text-center">
            <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">
              Abril 2026
            </h3>
            <div className="grid grid-cols-7 gap-1 text-[9px] font-bold text-slate-300 mb-2">
              <span>D</span>
              <span>S</span>
              <span>T</span>
              <span>Q</span>
              <span>Q</span>
              <span>S</span>
              <span>S</span>
            </div>
            <div className="grid grid-cols-7 gap-1 px-1">
              {Array.from({ length: 30 }).map((_, i) => (
                <button
                  key={i}
                  className={`h-7 rounded-lg text-[10px] font-bold flex items-center justify-center transition-all ${
                    i + 1 === 28
                      ? "bg-teal-600 text-white shadow-md shadow-teal-600/20"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl p-4 text-white shadow-lg mb-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-16 h-16 bg-teal-500/20 rounded-full blur-2xl group-hover:bg-teal-500/30 transition-all"></div>
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-teal-500/20 rounded-lg">
                <Zap className="w-3 h-3 text-teal-400" />
              </div>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-teal-400">
                ELIZA Insights
              </h4>
            </div>
            <p className="text-[10px] text-white/70 leading-relaxed font-medium">
              Você tem 3 horários vagos hoje à tarde. Sugiro oferecer para o
              paciente Carlos Alberto que está na fila de espera.
            </p>
            <button className="mt-4 w-full py-2 bg-white/10 hover:bg-white/20 transition-all rounded-lg text-[9px] font-bold uppercase tracking-widest border border-white/5">
              Otimizar Agenda
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between ml-1">
              <h4 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                Confirmar hoje
              </h4>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[8px] font-bold">
                {
                  appointments.filter(
                    (a) =>
                      a.status === "pendente" &&
                      a.date === formatDate(new Date()),
                  ).length
                }
              </span>
            </div>
            {appointments
              .filter(
                (a) =>
                  a.status === "pendente" && a.date === formatDate(new Date()),
              )
              .slice(0, 3)
              .map((apt) => (
                <div
                  key={apt.id}
                  onClick={() => setSelectedAppointment(apt)}
                  className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between group cursor-pointer hover:border-teal-200 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 text-xs font-black">
                      {apt.patientName.charAt(0)}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-[10px] font-bold text-slate-900 truncate">
                        {apt.patientName}
                      </p>
                      <p className="text-[8px] text-slate-400 font-bold uppercase">
                        {apt.time} • {apt.procedure || "Consulta"}
                      </p>
                    </div>
                  </div>
                  <button className="p-1.5 opacity-0 group-hover:opacity-100 bg-slate-50 rounded-lg text-slate-400 transition-all">
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            {appointments.filter(
              (a) =>
                a.status === "pendente" && a.date === formatDate(new Date()),
            ).length === 0 && (
              <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">
                  Nenhuma confirmação pendente
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* The Grid Component */}
        <div className="flex-1 flex flex-col bg-slate-50/30 overflow-hidden">
          {/* Day View Info Grid (Quick Stats) */}
          <div className="px-6 py-4 flex items-center gap-4 shrink-0 bg-white shadow-sm z-10 border-b border-slate-100 overflow-x-auto custom-scrollbar">
            {[
              {
                label: "Confirmados",
                value: appointments.filter(
                  (a) =>
                    a.status === "confirmado" &&
                    a.date === formatDate(selectedDate),
                ).length,
                color: "text-emerald-600",
              },
              {
                label: "Pendentes",
                value: appointments.filter(
                  (a) =>
                    a.status === "pendente" &&
                    a.date === formatDate(selectedDate),
                ).length,
                color: "text-amber-600",
              },
              {
                label: "Cancelados",
                value: appointments.filter(
                  (a) =>
                    a.status === "cancelado" &&
                    a.date === formatDate(selectedDate),
                ).length,
                color: "text-rose-600",
              },
              { label: "Ocupação", value: "72%", color: "text-teal-600" },
            ].map((stat, idx) => (
              <div
                key={idx}
                className={`px-4 py-2 rounded-xl flex items-center gap-3 border border-slate-100 bg-white shrink-0`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${stat.color.replace("text", "bg")}`}
                />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter leading-none">
                    {stat.label}
                  </p>
                  <p
                    className={`text-sm font-black ${stat.color} leading-none mt-1`}
                  >
                    {stat.value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto relative custom-scrollbar scroll-smooth"
          >
            <div
              className="relative flex min-h-full"
              style={{ height: `${15 * 60 * MINUTE_HEIGHT}px` }}
            >
              {/* Vertical Hour Markers */}
              <div className="w-16 border-r border-slate-205 bg-white sticky left-0 z-20 shrink-0">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="relative select-none"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  >
                    <span className="absolute top-2 left-0 right-0 text-center text-[11px] font-black text-slate-500 tabular-nums tracking-wide">
                      {h < 10 ? `0${h}` : h}:00
                    </span>
                  </div>
                ))}
              </div>

              {/* Grid Content */}
              <div className="flex-1 relative">
                {/* Horizontal guide lines */}
                {hours.map((h) => {
                  const hourTop = (h - 7) * HOUR_HEIGHT;
                  const m15Top = hourTop + QUARTER_HOUR_HEIGHT;
                  const m30Top = hourTop + HALF_HOUR_HEIGHT;
                  const m45Top =
                    hourTop + HALF_HOUR_HEIGHT + QUARTER_HOUR_HEIGHT;
                  return (
                    <React.Fragment key={h}>
                      {/* Darker Hourly separator */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-slate-350/90 h-px pointer-events-none"
                        style={{ top: `${hourTop}px` }}
                      />
                      {/* Very light 15-minute helper line */}
                      <div
                        className="absolute left-0 right-0 border-t border-slate-200/35 h-px pointer-events-none"
                        style={{ top: `${m15Top}px` }}
                      />
                      {/* Medium 30-minute dashed separator */}
                      <div
                        className="absolute left-0 right-0 border-t border-dashed border-slate-200/80 h-px pointer-events-none"
                        style={{ top: `${m30Top}px` }}
                      />
                      {/* Very light 45-minute helper line */}
                      <div
                        className="absolute left-0 right-0 border-t border-slate-200/35 h-px pointer-events-none"
                        style={{ top: `${m45Top}px` }}
                      />
                    </React.Fragment>
                  );
                })}

                {/* Vertical Column for Today */}
                <div className="absolute inset-0 flex">
                  {viewMode === "day" ? (
                    <div className="flex-1 relative">
                      <div className="absolute inset-0 pointer-events-auto">
                        {hours.map((h) => {
                          const hStr = h < 10 ? `0${h}` : `${h}`;
                          const intervals = ["00", "15", "30", "45"];
                          return (
                            <React.Fragment key={h}>
                              {intervals.map((m) => {
                                const offset = Number(m) * MINUTE_HEIGHT;
                                return (
                                  <div
                                    key={m}
                                    onClick={() => handleTimelineClick(h, m)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) =>
                                      handleDropAppointment(
                                        e,
                                        formatDate(selectedDate),
                                        `${hStr}:${m}`,
                                      )
                                    }
                                    className="absolute left-0 right-0 border-t border-slate-100/10 hover:bg-teal-500/[0.04] transition-all cursor-pointer flex items-center pl-4 group"
                                    style={{
                                      top: `${(h - 7) * HOUR_HEIGHT + offset}px`,
                                      height: `${QUARTER_HOUR_HEIGHT}px`,
                                    }}
                                  >
                                    <span className="text-[9px] font-bold text-teal-600 bg-white border border-teal-100 px-3 py-1 rounded-xl shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 z-20 pointer-events-none">
                                      <Plus className="w-3.5 h-3.5" /> Marcar
                                      consulta às {hStr}:{m}
                                    </span>
                                  </div>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {appointments
                        .filter(
                          (a) =>
                            a.date === formatDate(selectedDate) &&
                            (selectedStaffId === "all" ||
                              a.staffId === selectedStaffId),
                        )
                        .map((apt) => renderAppointment(apt))}

                      {/* Current Time Indicator */}
                      {formatDate(selectedDate) === formatDate(new Date()) && (
                        <div
                          className="absolute left-0 right-0 border-t-2 border-rose-500 z-30 pointer-events-none flex items-center"
                          style={{
                            top: `${(timeToMinutes(`${new Date().getHours()}:${new Date().getMinutes()}`) - 7 * 60) * MINUTE_HEIGHT}px`,
                          }}
                        >
                          <div className="w-2 h-2 rounded-full bg-rose-500 -ml-1 border-2 border-white shadow-sm" />
                        </div>
                      )}
                    </div>
                  ) : (
                    getWeekDays(selectedDate)
                      .filter((day) => {
                        const dow = day.getDay(); // 0 is Sunday, 6 is Saturday
                        if (dow !== 0 && dow !== 6) {
                          return true; // Monday to Friday are always visible
                        }
                        if (dow === 6 && isSaturdayUtilitarian) {
                          return true; // Show Saturday if enabled in settings
                        }
                        if (dow === 0 && isSundayUtilitarian) {
                          return true; // Show Sunday if enabled in settings
                        }
                        // Otherwise, only display Saturday or Sunday if there is an appointment scheduled
                        const dayStr = formatDate(day);
                        return appointments.some(
                          (a) => a.date === dayStr && a.status !== "cancelado",
                        );
                      })
                      .map((day, dIdx) => (
                        <div
                          key={dIdx}
                          className={`flex-1 relative border-r-2 border-slate-200/90 ${formatDate(day) === formatDate(new Date()) ? "bg-teal-50/20" : ""}`}
                        >
                          <div className="sticky top-0 left-0 right-0 h-10 border-b-2 border-slate-205 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center z-20">
                            <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider leading-none">
                              {day.toLocaleDateString("pt-BR", {
                                weekday: "short",
                              })}
                            </span>
                            <span
                              className={`text-sm font-black mt-0.5 ${formatDate(day) === formatDate(new Date()) ? "text-teal-600" : "text-slate-800"}`}
                            >
                              {day.getDate()}
                            </span>
                          </div>

                          {/* Interactive click-to-book background slots for Week days */}
                          <div className="absolute inset-0 pointer-events-auto">
                            {hours.map((h) => {
                              const hStr = h < 10 ? `0${h}` : `${h}`;
                              const intervals = ["00", "15", "30", "45"];
                              return (
                                <React.Fragment key={h}>
                                  {intervals.map((m) => {
                                    const offset = Number(m) * MINUTE_HEIGHT;
                                    return (
                                      <div
                                        key={m}
                                        onClick={() => {
                                          setNewAppointment({
                                            patientName: "",
                                            patientId: "",
                                            time: `${hStr}:${m}`,
                                            date: formatDate(day),
                                            procedure: "",
                                            status: "pendente",
                                            staffId: staff[0]?.id || "",
                                            duration: 30,
                                            chair: "Cadeira 1",
                                            observations: "",
                                          });
                                          setPatientSearch("");
                                          setIsAddModalOpen(true);
                                        }}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) =>
                                          handleDropAppointment(
                                            e,
                                            formatDate(day),
                                            `${hStr}:${m}`,
                                          )
                                        }
                                        className="absolute left-0 right-0 border-t border-slate-100/10 hover:bg-teal-500/[0.03] transition-all cursor-pointer flex items-center pl-1 group z-0"
                                        style={{
                                          top: `${(h - 7) * HOUR_HEIGHT + offset}px`,
                                          height: `${QUARTER_HOUR_HEIGHT}px`,
                                        }}
                                      >
                                        <span className="text-[8px] font-bold text-teal-600 bg-white px-1.5 py-0.5 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
                                          +{hStr}:{m}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </div>

                          {appointments
                            .filter(
                              (a) =>
                                a.date === formatDate(day) &&
                                (selectedStaffId === "all" ||
                                  a.staffId === selectedStaffId),
                            )
                            .map((apt) => renderAppointment(apt))}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Appointment Details Side Drawer (Non-blocking, elegant) */}
      <AnimatePresence>
        {selectedAppointment && (
          <motion.div
            initial={{ x: "100%", opacity: 0.9 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0.9 }}
            transition={{ type: "spring", damping: 30, stiffness: 220 }}
            className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-slate-200/90 shadow-2xl z-[70] flex flex-col pointer-events-auto"
          >
            {/* Header */}
            <div className="h-16 border-b border-slate-100 px-6 flex items-center justify-between bg-slate-50/50 shrink-0">
              <h3 className="text-[11px] font-black text-[#1E293B] uppercase tracking-widest flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-teal-600" /> Operações da
                Agenda
              </h3>
              <button
                onClick={() => {
                  setSelectedAppointment(null);
                  setIsEditingInDrawer(false);
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-all"
              >
                <XCircle className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Inner scrollable area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar leading-normal">
              {/* Patient Profile Box */}
              <div className="flex items-start gap-4 p-4 bg-slate-50/50 border border-slate-100 rounded-3xl">
                <div className="w-11 h-11 rounded-2xl bg-teal-600 text-white font-black text-lg flex items-center justify-center shrink-0 shadow-sm">
                  {selectedAppointment.patientName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-extrabold text-slate-900 truncate">
                    {selectedAppointment.patientName}
                  </h4>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {(() => {
                      const pId = selectedAppointment.patientId;
                      let matchedPatient = patients.find((p) => p.id === pId);
                      if (!matchedPatient && selectedAppointment.patientName) {
                        matchedPatient = patients.find(
                          (p) =>
                            p.name.toLowerCase() ===
                            selectedAppointment.patientName.toLowerCase(),
                        );
                      }
                      return (
                        matchedPatient?.phone ||
                        selectedAppointment.phoneNumber ||
                        (selectedAppointment as any).raw?.phone ||
                        "(Sem telefone)"
                      );
                    })()}
                  </p>

                  {/* Action Shortcuts */}
                  {(() => {
                    let pId = selectedAppointment.patientId;
                    if (!pId) {
                      const match = patients.find(
                        (p) =>
                          p.name.toLowerCase() ===
                          selectedAppointment.patientName.toLowerCase(),
                      );
                      if (match) pId = match.id;
                    }
                    if (!pId) return null;

                    return (
                      <div className="flex items-center gap-3 mt-2.5">
                        <button
                          onClick={() => {
                            setSelectedAppointment(null);
                            onSelectPatient?.(pId);
                          }}
                          className="text-[9px] font-black text-teal-600 uppercase tracking-widest hover:text-teal-700 cursor-pointer flex items-center gap-1 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs"
                        >
                          <User className="w-3 h-3 text-teal-600" /> Ver Ficha
                        </button>
                        <a
                          href={`/?patientId=${pId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-700 cursor-pointer flex items-center gap-1 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs"
                        >
                          <ExternalLink className="w-3 h-3 text-indigo-600" />{" "}
                          Nova Aba
                        </a>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Status Section */}
              <div className="space-y-1.5">
                <span className="text-[8.5px] font-black uppercase tracking-widest text-[#64748B]">
                  Status Operacional
                </span>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[
                    {
                      status: "pendente",
                      label: "Aguardando conf.",
                      dot: "bg-amber-500",
                      activeBg: "bg-amber-50 border-amber-300 text-amber-800",
                    },
                    {
                      status: "confirmado",
                      label: "Confirmada",
                      dot: "bg-emerald-500",
                      activeBg:
                        "bg-emerald-50 border-emerald-300 text-emerald-800",
                    },
                    {
                      status: "aguardando",
                      label: "Na Recepção",
                      dot: "bg-violet-500",
                      activeBg:
                        "bg-violet-50 border-violet-350 text-violet-800",
                    },
                    {
                      status: "atendimento",
                      label: "Em atendimento",
                      dot: "bg-blue-500",
                      activeBg: "bg-blue-50 border-blue-300 text-blue-800",
                    },
                    {
                      status: "finalizado",
                      label: "Finalizada",
                      dot: "bg-slate-500",
                      activeBg: "bg-slate-100 border-slate-350 text-slate-800",
                    },
                    {
                      status: "faltou",
                      label: "Falta",
                      dot: "bg-orange-500",
                      activeBg:
                        "bg-orange-50 border-orange-300 text-orange-850",
                    },
                    {
                      status: "cancelado",
                      label: "Canc. Paciente",
                      dot: "bg-rose-500",
                      activeBg: "bg-rose-50 border-rose-300 text-rose-800",
                    },
                    {
                      status: "cancelado_profissional",
                      label: "Canc. Profissional",
                      dot: "bg-red-500",
                      activeBg: "bg-red-50 border-red-300 text-red-800",
                    },
                  ].map((opt) => {
                    const isActive = selectedAppointment.status === opt.status;
                    return (
                      <button
                        key={opt.status}
                        onClick={() =>
                          handleQuickStatusChange(opt.status as any)
                        }
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-[10px] font-bold text-left transition-all ${
                          isActive
                            ? `${opt.activeBg} font-black shadow-sm scale-[1.02]`
                            : "bg-white border-slate-150 hover:bg-slate-50 text-slate-600"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${opt.dot} shrink-0`}
                        />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* WhatsApp Quick Action Button */}
              <div className="pt-1">
                {isWhatsAppIntegrated ? (
                  <button
                    onClick={() => {
                      if (selectedAppointment && onNavigateToChat) {
                        onNavigateToChat(selectedAppointment.patientId);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl text-[10.5px] font-black uppercase tracking-widest transition-all shadow-sm bg-slate-900 border border-slate-800 text-teal-400 hover:bg-slate-800"
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span>Conversa Interna ELIZA</span>
                  </button>
                ) : (
                  (() => {
                    const link = getWhatsAppLink();
                    if (!link) {
                      return (
                        <button
                          disabled
                          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl text-[10.5px] font-black uppercase tracking-widest bg-slate-100 text-slate-400 cursor-not-allowed"
                        >
                          <MessageCircle className="w-4 h-4 shrink-0" />
                          <span>WhatsApp (Sem Telefone)</span>
                        </button>
                      );
                    }
                    return (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl text-[10.5px] font-black uppercase tracking-widest transition-all shadow-sm bg-[#25D366] text-white hover:bg-[#20ba59] shadow-inner shadow-green-600/10 text-center"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>Mensagem convencional wa.me</span>
                      </a>
                    );
                  })()
                )}
              </div>

              {/* Editable Information Fields Area */}
              <div className="border-t border-slate-100 pt-5 space-y-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#64748B]">
                    Dados do Agendamento
                  </span>
                  <button
                    onClick={() => {
                      if (!isEditingInDrawer) {
                        setEditForm({
                          id: selectedAppointment.id,
                          patientName: selectedAppointment.patientName,
                          patientId: selectedAppointment.patientId || "",
                          time: selectedAppointment.time,
                          date: selectedAppointment.date,
                          procedure: selectedAppointment.procedure,
                          status: selectedAppointment.status,
                          staffId: selectedAppointment.staffId,
                          duration: selectedAppointment.duration,
                          chair: selectedAppointment.chair || "Cadeira 1",
                          observations: selectedAppointment.observations || "",
                        });
                      }
                      setIsEditingInDrawer(!isEditingInDrawer);
                    }}
                    className="text-[9.5px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
                  >
                    {isEditingInDrawer ? "Voltar ao Resumo" : "Editar Detalhes"}
                  </button>
                </div>

                {isEditingInDrawer ? (
                  /* Inline Edit Form */
                  <div className="space-y-4 bg-slate-50/40 p-4 border border-slate-200/50 rounded-2xl animate-fade-in">
                    {/* Date Selector */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Data
                      </label>
                      <input
                        type="date"
                        value={editForm.date}
                        onChange={(e) =>
                          setEditForm({ ...editForm, date: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                      />
                    </div>

                    {/* Time Selector */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          Início
                        </label>
                        <input
                          type="time"
                          value={editForm.time}
                          onChange={(e) =>
                            setEditForm({ ...editForm, time: e.target.value })
                          }
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1 flex flex-col justify-end">
                        <span className="text-[10px] text-slate-550 font-bold block mb-1">
                          Fim:{" "}
                          <strong className="text-slate-800">
                            {addMinutesToTime(editForm.time, editForm.duration)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Duration Select */}
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Duração
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {[15, 30, 45, 60, 90, 120].map((mins) => {
                          const isSel = editForm.duration === mins;
                          return (
                            <button
                              key={mins}
                              type="button"
                              onClick={() =>
                                setEditForm({ ...editForm, duration: mins })
                              }
                              className={`px-2.5 py-1 text-[9.5px] rounded border font-semibold transition-all ${
                                isSel
                                  ? "bg-slate-900 border-slate-900 text-teal-400 font-black shadow-xs shadow-slate-900/10"
                                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {mins}m
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Choose Profissional */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Profissional Responsável
                      </label>
                      <select
                        value={editForm.staffId}
                        onChange={(e) =>
                          setEditForm({ ...editForm, staffId: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium cursor-pointer"
                      >
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.displayName || s.name} (
                            {s.role === "dentist"
                              ? "Dentista"
                              : s.role === "doctor"
                                ? "Médico(a)"
                                : s.role}
                            )
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Procedure Description */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Procedimento
                      </label>
                      <input
                        type="text"
                        value={editForm.procedure || ""}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            procedure: e.target.value,
                          })
                        }
                        placeholder="Ex: Toxina Botulínica"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                      />
                    </div>

                    {/* Chair / Room */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Cadeira / Consultório
                      </label>
                      <select
                        value={editForm.chair}
                        onChange={(e) =>
                          setEditForm({ ...editForm, chair: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium cursor-pointer"
                      >
                        <option value="Cadeira 1">Cadeira 1</option>
                        <option value="Cadeira 2">Cadeira 2</option>
                        <option value="Cadeira 3">Cadeira 3</option>
                        <option value="Consultório VIP">Consultório VIP</option>
                      </select>
                    </div>

                    {/* Observations */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Observações
                      </label>
                      <textarea
                        value={editForm.observations}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            observations: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium min-h-[60px]"
                        placeholder="Insira detalhes ou orientações..."
                      />
                    </div>

                    {/* Actions and Save button */}
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingInDrawer(false)}
                        className="flex-1 py-2 border border-slate-200 rounded-xl text-[9px] font-bold uppercase tracking-widest text-[#64748B] hover:bg-slate-50 transition-all"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleUpdateInDrawer}
                        className="flex-1 py-2 bg-teal-600 text-white rounded-xl text-[9px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/10 hover:bg-teal-700 transition-all"
                      >
                        Gravar
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Static Information Cards */
                  <div className="grid grid-cols-2 gap-4 bg-slate-50/30 p-2 border border-slate-100 rounded-2xl">
                    <div className="p-3">
                      <p className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Horário & Cadeira
                      </p>
                      <p className="text-[11.5px] font-black text-slate-800">
                        {selectedAppointment.time} (
                        {selectedAppointment.duration}min)
                      </p>
                      <span className="text-[10px] text-slate-500 font-bold block mt-0.5">
                        {selectedAppointment.chair || "Cadeira 1"}
                      </span>
                    </div>
                    <div className="p-3">
                      <p className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Procedimento
                      </p>
                      <p className="text-[11.5px] font-black text-slate-800 truncate">
                        {selectedAppointment.procedure || "Consulta"}
                      </p>
                      <span className="text-[10px] text-slate-500 font-bold block mt-0.5">
                        {selectedAppointment.staffName}
                      </span>
                    </div>
                    {selectedAppointment.observations && (
                      <div className="col-span-2 p-3 border-t border-slate-100 bg-white/50 rounded-xl">
                        <p className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                          Observações
                        </p>
                        <p className="text-[11px] text-slate-600 italic font-medium">
                          "{selectedAppointment.observations}"
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Planned Procedures from clinically mapped items */}
              {/* Planejamento Clínico Vinculado Section */}
              <div className="mb-6 p-5 bg-gradient-to-br from-indigo-50/70 to-purple-50/50 border border-indigo-100/50 rounded-3xl space-y-3.5">
                <div className="flex justify-between items-center pb-1.5 border-b border-indigo-100/40">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-[#1E1B4B] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />{" "}
                    Planejamento Clínico
                  </h4>
                </div>
                {loadingPlanning ? (
                  <p className="text-[11px] text-slate-400 italic font-medium">
                    Buscando planejamento...
                  </p>
                ) : isEditingInlinePlan ? (
                  <div className="space-y-4 bg-white/95 p-4 rounded-2xl border border-indigo-100 shadow-inner flex flex-col">
                    <div className="flex justify-between items-center border-b border-indigo-50 pb-2">
                      <span className="text-xs font-black text-indigo-950 uppercase tracking-wide">
                        Planejar Caso Clínico
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsEditingInlinePlan(false)}
                        className="text-slate-400 hover:text-slate-600 text-[10px] font-bold"
                      >
                        Cancelar
                      </button>
                    </div>

                    {/* Approved treatments options first */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-indigo-950 tracking-wider flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-indigo-600 animate-pulse" />{" "}
                        Tratamentos Aprovados na Ficha
                      </label>

                      {loadingApprovedData ? (
                        <p className="text-[10px] text-slate-400 italic">
                          Buscando orçamentos aprovados...
                        </p>
                      ) : (
                        (() => {
                          const approvedOptions: {
                            name: string;
                            source: string;
                            value?: number;
                          }[] = [];

                          patientApprovedBudgets.forEach((budget: any) => {
                            if (budget.items && Array.isArray(budget.items)) {
                              budget.items.forEach((item: any) => {
                                if (item.description) {
                                  const name = item.description.trim();
                                  if (
                                    !approvedOptions.some(
                                      (opt) =>
                                        opt.name.toLowerCase() ===
                                        name.toLowerCase(),
                                    )
                                  ) {
                                    approvedOptions.push({
                                      name,
                                      source: `Orçamento Aprovado: ${budget.title || "Sem Título"}`,
                                      value: item.value || 0,
                                    });
                                  }
                                }
                              });
                            }
                          });

                          patientTreatments.forEach((treat: any) => {
                            if (treat.description) {
                              const name = treat.description.trim();
                              if (
                                !approvedOptions.some(
                                  (opt) =>
                                    opt.name.toLowerCase() ===
                                    name.toLowerCase(),
                                )
                              ) {
                                approvedOptions.push({
                                  name,
                                  source: "Plano de Tratamento Ativo",
                                  value: treat.amount || 0,
                                });
                              }
                            }
                          });

                          if (approvedOptions.length > 0) {
                            return (
                              <div className="max-h-36 overflow-y-auto space-y-1.5 p-1 border border-slate-100 rounded-xl bg-slate-50/50 custom-scrollbar">
                                {approvedOptions.map((opt, oIdx) => {
                                  const isSelected =
                                    inlineProcedureName.toLowerCase() ===
                                    opt.name.toLowerCase();
                                  return (
                                    <button
                                      key={oIdx}
                                      type="button"
                                      onClick={() => {
                                        setInlineProcedureName(opt.name);
                                        if (opt.value)
                                          setInlineValue(opt.value);
                                        // Auto-guess category
                                        const matchedCat = [
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
                                        ].find((c) =>
                                          opt.name
                                            .toLowerCase()
                                            .includes(c.toLowerCase()),
                                        );
                                        if (matchedCat)
                                          setInlineCategory(matchedCat);
                                      }}
                                      className={`w-full text-left p-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all ${
                                        isSelected
                                          ? "bg-teal-50 border-teal-200 text-teal-800 font-extrabold shadow-sm"
                                          : "bg-white border-slate-150 hover:bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      <div className="flex-1 pr-2">
                                        <div className="font-extrabold leading-tight text-[10.5px] truncate">
                                          {opt.name}
                                        </div>
                                        <div className="text-[8px] font-bold text-slate-400 leading-none mt-1 uppercase tracking-wider truncate">
                                          {opt.source}
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0">
                                        {opt.value ? (
                                          <span className="font-bold text-slate-900">
                                            R$ {opt.value}
                                          </span>
                                        ) : (
                                          <span className="text-[9px] text-slate-400">
                                            ---
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          } else {
                            return (
                              <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-100 text-amber-800 text-[10px] font-bold">
                                Nenhum tratamento aprovado / plano ativo
                                encontrado na ficha do paciente. Insira as
                                informações manualmente abaixo.
                              </div>
                            );
                          }
                        })()
                      )}
                    </div>

                    {/* Manual field */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Tratamento Previsto (Manual / Novo)
                      </label>
                      <input
                        type="text"
                        value={inlineProcedureName}
                        onChange={(e) => setInlineProcedureName(e.target.value)}
                        placeholder="Ex: Toxina Botulínica, Profilaxia, Ortodontia..."
                        className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-900 focus:border-indigo-400"
                      />
                    </div>

                    {/* Grid for parameters */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Categoria
                        </label>
                        <select
                          value={inlineCategory}
                          onChange={(e) => setInlineCategory(e.target.value)}
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-800 focus:border-indigo-400"
                        >
                          {[
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
                          ].map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Valor Previsto (R$)
                        </label>
                        <input
                          type="number"
                          value={inlineValue}
                          onChange={(e) =>
                            setInlineValue(Number(e.target.value))
                          }
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-900 focus:border-indigo-400"
                        />
                      </div>
                    </div>

                    {/* Pay Method & Materials */}
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Forma de Pagamento
                        </label>
                        <select
                          value={inlinePaymentMethod}
                          onChange={(e) =>
                            setInlinePaymentMethod(e.target.value)
                          }
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-800 focus:border-indigo-400"
                        >
                          {[
                            "Pix",
                            "Cartão de Crédito",
                            "Cartão de Débito",
                            "Dinheiro",
                            "Boleto",
                            "Financiamento",
                            "Convênio",
                          ].map((pm) => (
                            <option key={pm} value={pm}>
                              {pm}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Materiais Insumos (separados por vírgula)
                        </label>
                        <input
                          type="text"
                          value={rawMaterialInput}
                          onChange={(e) => {
                            setRawMaterialInput(e.target.value);
                            const mats = e.target.value
                              .split(",")
                              .map((m) => m.trim())
                              .filter(Boolean);
                            setInlineMaterials(mats);
                          }}
                          placeholder="Ex: luvas, agulhas, resina"
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-900 focus:border-indigo-400"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        if (!inlineProcedureName.trim()) {
                          alert(
                            "Por favor, digite ou selecione um procedimento previsto.",
                          );
                          return;
                        }
                        try {
                          await handleSaveInlinePlanning(
                            inlineProcedureName,
                            inlineCategory,
                            inlineValue,
                            inlinePaymentMethod,
                            inlineMaterials,
                          );
                          alert("Planejamento atualizado!");
                        } catch (err) {
                          alert("Erro ao salvar planejamento.");
                        }
                      }}
                      className="w-full py-2.5 mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> Salvar Planejamento
                    </button>
                  </div>
                ) : (
                  (() => {
                    const appointmentPlan = plannedProcedures.find(
                      (p) => p.appointmentId === selectedAppointment.id,
                    );
                    const isPlanFound = !!appointmentPlan;
                    const isPlanned =
                      isPlanFound &&
                      (appointmentPlan.planningStatus === "planned" ||
                        (appointmentPlan.procedureName &&
                          appointmentPlan.procedureName !== "Não planejado"));

                    if (!isPlanned) {
                      return (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-black uppercase tracking-widest px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg border border-amber-200">
                              PLANEJAMENTO PENDENTE
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-bold leading-relaxed">
                            Este agendamento não possui nenhum planejamento
                            clínico ou procedimental associado.
                          </p>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => setIsEditingInlinePlan(true)}
                              className="py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[9px] uppercase tracking-wider rounded-xl text-center block transition-all cursor-pointer"
                            >
                              Planejar Agora
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (onNavigate) {
                                  localStorage.setItem(
                                    "planning_focus_appointment_id",
                                    selectedAppointment.id,
                                  );
                                  onNavigate("planning");
                                }
                              }}
                              className="py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-[9px] uppercase tracking-wider rounded-xl text-center block transition-all cursor-pointer"
                            >
                              Painel Completo
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-black uppercase tracking-widest px-2.5 py-1 bg-teal-50 text-teal-700 rounded-lg border border-teal-200">
                            PLANEJADO
                          </span>
                        </div>

                        <div className="text-xs space-y-1.5 bg-white/70 p-3.5 rounded-2xl border border-indigo-100/20">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-[#3F3D56] text-[12px]">
                              {appointmentPlan.procedureCategory ||
                                "Harmonização"}
                            </span>
                            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded border border-indigo-200">
                              {appointmentPlan.status || "Planejado"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-bold">
                            Procedimento:{" "}
                            <strong className="text-slate-800">
                              {appointmentPlan.procedureName}
                            </strong>
                          </p>
                          <p className="text-[11px] text-slate-550 font-medium">
                            Tempo estimado:{" "}
                            <strong className="text-slate-850">
                              {selectedAppointment.duration} min
                            </strong>
                          </p>
                          {Number(appointmentPlan.expectedValue) > 0 && (
                            <p className="text-[11px] text-slate-555 font-semibold">
                              Valor Previsto:{" "}
                              <strong className="text-slate-850">
                                R$ {appointmentPlan.expectedValue} (
                                {appointmentPlan.expectedPaymentMethod || "Pix"}
                                )
                              </strong>
                            </p>
                          )}
                          {appointmentPlan.materialList &&
                            appointmentPlan.materialList.length > 0 && (
                              <div className="text-[10.5px] text-slate-500 font-semibold">
                                <span className="font-bold text-slate-400 uppercase tracking-wide block text-[8px] mt-1.5">
                                  Materiais Previstos
                                </span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {appointmentPlan.materialList.map(
                                    (mat: string, mIdx: number) => (
                                      <span
                                        key={mIdx}
                                        className="px-1.5 py-0.5 bg-slate-100/80 border border-slate-200 text-slate-600 rounded text-[9px] font-extrabold"
                                      >
                                        {mat}
                                      </span>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => setIsEditingInlinePlan(true)}
                            className="py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[9px] uppercase tracking-wider rounded-xl text-center block transition-all cursor-pointer"
                          >
                            Editar Plano
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (onNavigate) {
                                localStorage.setItem(
                                  "planning_focus_appointment_id",
                                  selectedAppointment.id,
                                );
                                onNavigate("planning");
                              }
                            }}
                            className="py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-[9px] uppercase tracking-wider rounded-xl text-center block transition-all cursor-pointer"
                          >
                            Ir ao Painel
                          </button>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Condensed Patient History Details */}
              {(() => {
                const patientHistory = appointments
                  .filter(
                    (a) =>
                      a.patientName === selectedAppointment.patientName &&
                      a.id !== selectedAppointment.id,
                  )
                  .sort(
                    (a, b) =>
                      b.date.localeCompare(a.date) ||
                      b.time.localeCompare(a.time),
                  );

                const lastAppointment = patientHistory[0];

                return (
                  <div className="mb-6 p-5 bg-slate-50 border border-slate-150 rounded-3xl space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-[#5A6A85] border-b border-slate-200/50 pb-1.5">
                      Histórico Resumido
                    </h4>
                    {patientHistory.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic font-semibold">
                        Primeira consulta deste paciente.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-[11px] text-slate-500 font-semibold">
                          Última consulta:{" "}
                          <strong className="text-slate-800">
                            {lastAppointment.date
                              .split("-")
                              .reverse()
                              .join("/")}{" "}
                            ({lastAppointment.time})
                          </strong>
                          <span className="block text-[10px] text-slate-500 font-bold mt-1">
                            Status:{" "}
                            <strong className="text-slate-700 capitalize">
                              {lastAppointment.status}
                            </strong>{" "}
                            • {lastAppointment.procedure || "Consulta"}
                          </span>
                        </div>

                        {patientHistory.length > 1 && (
                          <div className="text-[10px] text-slate-405 max-h-24 overflow-y-auto space-y-1.5 mt-2.5 custom-scrollbar">
                            <span className="font-extrabold uppercase text-[8px] tracking-wider text-slate-400">
                              Consultas Anteriores
                            </span>
                            {patientHistory.slice(1, 4).map((hApt) => (
                              <div
                                key={hApt.id}
                                className="flex justify-between items-center bg-white p-2 rounded-xl border border-slate-100"
                              >
                                <span className="font-bold text-slate-600">
                                  {hApt.date.split("-").reverse().join("/")}
                                </span>
                                <span className="font-black text-slate-800 truncate max-w-[120px]">
                                  {hApt.procedure || "Consulta"}
                                </span>
                                <span className="font-black text-[8.5px] uppercase text-indigo-600">
                                  {hApt.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Footer with Delete controls */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
              <button
                onClick={async () => {
                  if (
                    !confirm("Tem certeza de que deseja remover esta consulta?")
                  )
                    return;
                  if (clinic && selectedAppointment) {
                    const path = `clinics/${clinic.id}/appointments/${selectedAppointment.id}`;
                    try {
                      await syncAppointmentToPlanning(
                        clinic.id,
                        selectedAppointment.id,
                        selectedAppointment,
                        true,
                      );
                      await deleteDoc(
                        doc(
                          db,
                          "clinics",
                          clinic.id,
                          "appointments",
                          selectedAppointment.id,
                        ),
                      );
                      setSelectedAppointment(null);
                      setIsEditingInDrawer(false);
                    } catch (err) {
                      handleFirestoreError(err, OperationType.DELETE, path);
                    }
                  }
                }}
                className="text-rose-500 hover:text-rose-600 font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-lg hover:bg-rose-50"
              >
                Excluir Consulta
              </button>

              <button
                onClick={() => {
                  setSelectedAppointment(null);
                  setIsEditingInDrawer(false);
                }}
                className="bg-slate-900 border border-slate-800 text-teal-400 px-5.5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-sm hover:bg-slate-805"
              >
                Fechar Operações
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: Novo Agendamento */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex justify-end">
            {/* Backdrop allowing background agenda to remain visible */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-slate-900/30 backdrop-blur-xs"
            />

            {/* Side Drawer Panel */}
            <motion.div
              initial={{ x: "100%", opacity: 0.9 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0.9 }}
              transition={{ type: "tween", duration: 0.25 }}
              className="relative w-full max-w-[500px] bg-white h-full shadow-2xl flex flex-col z-10 border-l border-slate-100"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-500 to-emerald-500" />

              {/* Drawer Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Novo Agendamento
                </h3>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="text-slate-300 hover:text-slate-600 transition-colors"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {/* Paciente input */}
                <div className="space-y-1.5 relative">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Paciente
                  </label>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                    <input
                      value={patientSearch}
                      onChange={(e) => {
                        setPatientSearch(e.target.value);
                        setNewAppointment({
                          ...newAppointment,
                          patientName: e.target.value,
                          patientId: "",
                        });
                      }}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 focus:bg-white transition-all font-bold text-slate-800"
                      placeholder="Nome do paciente..."
                    />
                  </div>
                  {filteredPatients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl z-20 max-h-48 overflow-y-auto p-2">
                      {filteredPatients.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setNewAppointment({
                              ...newAppointment,
                              patientName: p.name,
                              patientId: p.id,
                            });
                            setPatientSearch(p.name);
                            setFilteredPatients([]);
                          }}
                          className="w-full text-left px-4 py-3 text-xs hover:bg-slate-50 rounded-xl flex items-center justify-between group transition-colors"
                        >
                          <span className="font-bold text-slate-700">
                            {p.name}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-teal-600" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Profissional and Status */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Profissional
                    </label>
                    <select
                      value={newAppointment.staffId}
                      onChange={(e) =>
                        setNewAppointment({
                          ...newAppointment,
                          staffId: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 appearance-none font-bold text-slate-700"
                    >
                      <option value="">Selecione...</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Status
                    </label>
                    <select
                      value={newAppointment.status}
                      onChange={(e) =>
                        setNewAppointment({
                          ...newAppointment,
                          status: e.target.value as any,
                        })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-700"
                    >
                      <option value="pendente">Pendente</option>
                      <option value="confirmado">Confirmado</option>
                      <option value="aguardando">Aguardando na recepção</option>
                      <option value="atendimento">Em Atendimento</option>
                      <option value="finalizado">Finalizado</option>
                      <option value="faltou">Faltou</option>
                      <option value="cancelado">Cancelado</option>
                      <option value="encaixe">Encaixe</option>
                    </select>
                  </div>
                </div>

                {/* Data of consulta and Horario */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Data da Consulta
                    </label>
                    <input
                      type="date"
                      value={newAppointment.date}
                      onChange={(e) =>
                        setNewAppointment({
                          ...newAppointment,
                          date: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-700"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Horário
                    </label>
                    <input
                      type="time"
                      value={newAppointment.time}
                      onChange={(e) =>
                        setNewAppointment({
                          ...newAppointment,
                          time: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-700"
                    />
                  </div>
                </div>

                {/* Chair / Room & Procedure */}
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Cadeira / Sala
                    </label>
                    <select
                      value={newAppointment.chair}
                      onChange={(e) =>
                        setNewAppointment({
                          ...newAppointment,
                          chair: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-700"
                    >
                      <option value="Cadeira 1">Cadeira 1</option>
                      <option value="Cadeira 2">Cadeira 2</option>
                      <option value="Cadeira 3">Cadeira 3</option>
                      <option value="Consultório VIP">Consultório VIP</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
                      Procedimento / Tratamento
                    </label>
                    {newAppointment.patientId &&
                    newApptTreatments.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex bg-slate-100 p-1 rounded-2xl w-fit border border-slate-200/55">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTreatmentId("custom");
                              setNewAppointment((prev) => ({
                                ...prev,
                                procedure: "",
                              }));
                            }}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-extrabold tracking-tight transition-all uppercase ${selectedTreatmentId === "custom" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Escrever Livremente
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const firstT = newApptTreatments[0];
                              setSelectedTreatmentId(firstT.id);
                              setNewAppointment((prev) => ({
                                ...prev,
                                procedure: firstT.description,
                              }));
                            }}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-extrabold tracking-tight transition-all uppercase ${selectedTreatmentId !== "custom" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Tratamento Planejado ({newApptTreatments.length})
                          </button>
                        </div>

                        {selectedTreatmentId !== "custom" ? (
                          <div className="space-y-1.5 animate-fadeIn">
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-2 py-0.5 rounded-md uppercase ml-1">
                              Tratamento do Planejamento Disponível
                            </span>
                            <select
                              value={selectedTreatmentId}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedTreatmentId(val);
                                const match = newApptTreatments.find(
                                  (t) => t.id === val,
                                );
                                if (match) {
                                  setNewAppointment((prev) => ({
                                    ...prev,
                                    procedure:
                                      match.description ||
                                      match.procedure ||
                                      "",
                                  }));
                                }
                              }}
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-700 shadow-xs"
                            >
                              {newApptTreatments.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.description ||
                                    t.procedure ||
                                    "Sem descrição"}{" "}
                                  (
                                  {t.status === "completed" ||
                                  t.status === "concluido"
                                    ? "Concluído"
                                    : "Em Aberto"}
                                  )
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <input
                            value={newAppointment.procedure}
                            onChange={(e) =>
                              setNewAppointment({
                                ...newAppointment,
                                procedure: e.target.value,
                              })
                            }
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-700"
                            placeholder="Ex: Avaliação ou Harmonização Facial"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          value={newAppointment.procedure}
                          onChange={(e) =>
                            setNewAppointment({
                              ...newAppointment,
                              procedure: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-teal-500 font-bold text-slate-750"
                          placeholder="Ex: Avaliação ou Botox"
                        />
                        {newAppointment.patientId && (
                          <p className="text-[9px] font-bold text-slate-400 ml-1">
                            Nenhum tratamento planejado cadastrado para este
                            paciente.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Duração
                  </label>
                  <div className="grid grid-cols-6 gap-1 sm:gap-1.5">
                    {[15, 30, 45, 60, 90, 120].map((mins) => (
                      <button
                        key={mins}
                        onClick={() =>
                          setNewAppointment({
                            ...newAppointment,
                            duration: mins,
                          })
                        }
                        className={`py-3 rounded-xl text-[10px] font-black transition-all border ${newAppointment.duration === mins ? "bg-teal-600 border-teal-600 text-white" : "bg-slate-50 border-slate-100 text-slate-400"}`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>

                {/* Observations */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Observações
                  </label>
                  <textarea
                    value={newAppointment.observations}
                    onChange={(e) =>
                      setNewAppointment({
                        ...newAppointment,
                        observations: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs type-semibold outline-none focus:border-teal-500 min-h-[80px]"
                    placeholder="Observações adicionais..."
                  />
                </div>

                {/* Conflict Alert */}
                {newAppointment.staffId &&
                  checkConflict(
                    newAppointment.date,
                    newAppointment.time,
                    newAppointment.duration,
                    newAppointment.staffId,
                    newAppointment.chair,
                  ) && (
                    <div className="p-4 bg-amber-50 border border-amber-250 rounded-2xl flex items-start gap-3.5 text-amber-800 text-xs shadow-sm">
                      <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <span className="font-bold text-[11px] text-amber-900">
                          Aviso de Conflito de Agendamento!
                        </span>
                        <p className="text-[10px] text-amber-700 font-bold mt-0.5">
                          O profissional ou a cadeira selecionada já possui uma
                          consulta agendada que coincide com este intervalo de
                          tempo. Verifique a ocupação.
                        </p>
                      </div>
                    </div>
                  )}
              </div>

              {/* Drawer Footer - ALWAYS FIXED AT BOTTOM */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-4 shrink-0">
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-3.5 bg-white border border-slate-200 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddAppointment}
                  className="flex-1 py-3.5 bg-teal-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-teal-600/20 hover:bg-teal-700 transition-colors"
                >
                  Agendar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Editar Agendamento */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-[100] flex justify-end">
            {/* Backdrop allowing background agenda to remain visible */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="absolute inset-0 bg-slate-900/30 backdrop-blur-xs"
            />

            {/* Side Drawer Panel */}
            <motion.div
              initial={{ x: "100%", opacity: 0.9 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0.9 }}
              transition={{ type: "tween", duration: 0.25 }}
              className="relative w-full max-w-[500px] bg-white h-full shadow-2xl flex flex-col z-10 border-l border-slate-100"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500" />

              {/* Drawer Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Editar Agendamento
                </h3>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-slate-300 hover:text-slate-600 transition-colors"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {/* Paciente */}
                <div className="space-y-1.5 relative">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Paciente
                  </label>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                    <input
                      value={editForm.patientName}
                      disabled
                      className="w-full pl-11 pr-4 py-3 bg-slate-100 border border-slate-100 rounded-2xl text-xs outline-none text-slate-500 cursor-not-allowed font-bold"
                      placeholder="Nome do paciente..."
                    />
                  </div>
                </div>

                {/* Profissional and Status */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Profissional
                    </label>
                    <select
                      value={editForm.staffId}
                      onChange={(e) =>
                        setEditForm({ ...editForm, staffId: e.target.value })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-750"
                    >
                      <option value="">Selecione...</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Status
                    </label>
                    <select
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          status: e.target.value as any,
                        })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-755"
                    >
                      <option value="pendente">Pendente</option>
                      <option value="confirmado">Confirmado</option>
                      <option value="aguardando">Aguardando na recepção</option>
                      <option value="atendimento">Em Atendimento</option>
                      <option value="finalizado">Finalizado</option>
                      <option value="faltou">Faltou</option>
                      <option value="cancelado">Cancelado</option>
                      <option value="encaixe">Encaixe</option>
                    </select>
                  </div>
                </div>

                {/* Data of Consulta and Horario */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Data da Consulta
                    </label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) =>
                        setEditForm({ ...editForm, date: e.target.value })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-700"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Horário
                    </label>
                    <input
                      type="time"
                      value={editForm.time}
                      onChange={(e) =>
                        setEditForm({ ...editForm, time: e.target.value })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-700"
                    />
                  </div>
                </div>

                {/* Chair / Sala and Procedure */}
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Cadeira / Sala
                    </label>
                    <select
                      value={editForm.chair}
                      onChange={(e) =>
                        setEditForm({ ...editForm, chair: e.target.value })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-700"
                    >
                      <option value="Cadeira 1">Cadeira 1</option>
                      <option value="Cadeira 2">Cadeira 2</option>
                      <option value="Cadeira 3">Cadeira 3</option>
                      <option value="Consultório VIP">Consultório VIP</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Procedimento
                    </label>
                    <input
                      value={editForm.procedure}
                      onChange={(e) =>
                        setEditForm({ ...editForm, procedure: e.target.value })
                      }
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-750"
                      placeholder="Ex: Avaliação"
                    />
                  </div>
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Duração
                  </label>
                  <div className="grid grid-cols-6 gap-1 sm:gap-1.5">
                    {[15, 30, 45, 60, 90, 120].map((mins) => (
                      <button
                        key={mins}
                        onClick={() =>
                          setEditForm({ ...editForm, duration: mins })
                        }
                        className={`py-3 rounded-xl text-[10px] font-black transition-all border ${editForm.duration === mins ? "bg-indigo-600 border-indigo-600 text-white" : "bg-slate-50 border-slate-100 text-slate-400"}`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>

                {/* Observations */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Observações
                  </label>
                  <textarea
                    value={editForm.observations}
                    onChange={(e) =>
                      setEditForm({ ...editForm, observations: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:border-indigo-500 min-h-[80px]"
                    placeholder="Observações adicionais..."
                  />
                </div>

                {/* Conflict Alert */}
                {editForm.staffId &&
                  checkConflict(
                    editForm.date,
                    editForm.time,
                    editForm.duration,
                    editForm.staffId,
                    editForm.chair,
                    editForm.id,
                  ) && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3.5 text-amber-800 text-xs shadow-sm">
                      <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <span className="font-bold text-[11px] text-amber-900">
                          Aviso de Conflito de Agendamento!
                        </span>
                        <p className="text-[10px] text-amber-700 font-bold mt-0.5">
                          O profissional ou a cadeira selecionada já possui uma
                          consulta agendada que coincide com este intervalo de
                          tempo. Verifique a ocupação.
                        </p>
                      </div>
                    </div>
                  )}
              </div>

              {/* Drawer Footer - ALWAYS FIXED AT BOTTOM */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-4 shrink-0">
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-3.5 bg-white border border-slate-200 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateAppointment}
                  className="flex-1 py-3.5 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-colors"
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
