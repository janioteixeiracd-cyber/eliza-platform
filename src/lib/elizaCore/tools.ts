/**
 * ELIZA Intelligence v2 — deterministic read tools.
 *
 * Every function here does real Firestore reads and real arithmetic in
 * TypeScript — never asks an LLM to compute a total, a percentage, or a
 * count. The orchestrator hands the LLM only the *output* of these
 * functions (small structured objects), never the underlying document
 * dumps, and never lets the model touch Firestore directly. clinicId is
 * always the caller's already-authenticated clinicId (see auth.ts) — these
 * functions never accept it from anywhere else.
 */
import type { Firestore } from "firebase-admin/firestore";
import { normalizeFinancialEntry } from "../../utils/financialHelpers";

function toDateSafe(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v?.toDate === "function") return v.toDate();
    if (v?.seconds !== undefined) return new Date(v.seconds * 1000);
    const match = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// TOOL: getAgendaAnalysis
// ============================================================================

export interface AgendaAnalysisResult {
  rangeFrom: string;
  rangeTo: string;
  total: number;
  byStatus: Record<string, number>;
  pendingConfirmations: number;
  cancellations: number;
  noShows: number;
  cancelledAppointments: EvidenceRow[];
  pendingAppointments: EvidenceRow[];
}
interface EvidenceRow { id: string; label: string; detail?: string }

export async function getAgendaAnalysis(
  db: Firestore,
  clinicId: string,
  opts: { days?: number } = {}
): Promise<AgendaAnalysisResult> {
  const days = opts.days ?? 7;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 1); // include "today" fully
  const to = new Date(now);
  to.setDate(to.getDate() + days);

  const snap = await db.collection(`clinics/${clinicId}/appointments`).limit(3000).get();
  const byStatus: Record<string, number> = {};
  let total = 0;
  let pendingConfirmations = 0;
  let cancellations = 0;
  let noShows = 0;
  const cancelledAppointments: EvidenceRow[] = [];
  const pendingAppointments: EvidenceRow[] = [];

  snap.forEach((doc) => {
    const data = doc.data();
    const d = toDateSafe(data.date);
    if (!d) return;
    const status = String(data.status || "pendente");

    if (status === "cancelado") {
      cancellations++;
      cancelledAppointments.push({ id: doc.id, label: data.patientName || "Paciente", detail: data.date });
    }
    if (status === "faltou") noShows++;

    if (d < from || d > to) return; // status-wide counters (above) look at all history; range counters below don't
    total++;
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (status === "pendente") {
      pendingConfirmations++;
      pendingAppointments.push({ id: doc.id, label: data.patientName || "Paciente", detail: data.date });
    }
  });

  return {
    rangeFrom: ymd(from),
    rangeTo: ymd(to),
    total,
    byStatus,
    pendingConfirmations,
    cancellations,
    noShows,
    cancelledAppointments: cancelledAppointments.slice(0, 20),
    pendingAppointments: pendingAppointments.slice(0, 20),
  };
}

// ============================================================================
// TOOL: getFinancialSummary
// ============================================================================

export interface FinancialSummaryResult {
  rangeFrom: string;
  rangeTo: string;
  incomeTotal: number;
  incomeReceived: number;
  expenseTotal: number;
  net: number;
  overdueCount: number;
  overdueAmount: number;
  overdueEntries: EvidenceRow[];
  appointmentCountInRange: number;
}

async function loadFinancialEntries(db: Firestore, clinicId: string) {
  const snap = await db.collection(`clinics/${clinicId}/financial_entries`).limit(6000).get();
  return snap.docs.map((d) => normalizeFinancialEntry({ id: d.id, ...d.data() }));
}

export async function getFinancialSummary(
  db: Firestore,
  clinicId: string,
  range: { from: Date; to: Date }
): Promise<FinancialSummaryResult> {
  const entries = await loadFinancialEntries(db, clinicId);
  const now = new Date();

  let incomeTotal = 0;
  let incomeReceived = 0;
  let expenseTotal = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  const overdueEntries: EvidenceRow[] = [];

  for (const e of entries) {
    if (!e) continue;
    const due = toDateSafe(e.dueDate);
    const inRange = due && due >= range.from && due <= range.to;

    if (inRange && e.type === "income") {
      incomeTotal += e.totalAmount;
      incomeReceived += e.paidAmount;
    }
    if (inRange && e.type === "expense") {
      expenseTotal += e.totalAmount;
    }

    if (e.type === "income" && (e.status === "pending" || e.status === "partial") && due && due < now && due.toDateString() !== now.toDateString()) {
      overdueCount++;
      overdueAmount += e.pendingAmount;
      if (overdueEntries.length < 20) {
        overdueEntries.push({ id: e.id, label: e.patientName || e.description || "Lançamento", detail: `R$ ${e.pendingAmount.toFixed(2)}` });
      }
    }
  }

  const apptSnap = await db.collection(`clinics/${clinicId}/appointments`).limit(3000).get();
  let appointmentCountInRange = 0;
  apptSnap.forEach((doc) => {
    const d = toDateSafe(doc.data().date);
    if (d && d >= range.from && d <= range.to) appointmentCountInRange++;
  });

  return {
    rangeFrom: ymd(range.from),
    rangeTo: ymd(range.to),
    incomeTotal,
    incomeReceived,
    expenseTotal,
    net: incomeReceived - expenseTotal,
    overdueCount,
    overdueAmount,
    overdueEntries,
    appointmentCountInRange,
  };
}

// ============================================================================
// TOOL: comparePeriods
// ============================================================================

export interface PeriodComparisonResult {
  periodA: FinancialSummaryResult;
  periodB: FinancialSummaryResult;
  revenueDelta: number;
  revenueDeltaPct: number | null;
  appointmentCountDelta: number;
  avgTicketA: number | null;
  avgTicketB: number | null;
  avgTicketDeltaPct: number | null;
}

export async function comparePeriods(
  db: Firestore,
  clinicId: string,
  periodA: { from: Date; to: Date },
  periodB: { from: Date; to: Date }
): Promise<PeriodComparisonResult> {
  const [a, b] = await Promise.all([
    getFinancialSummary(db, clinicId, periodA),
    getFinancialSummary(db, clinicId, periodB),
  ]);

  const revenueDelta = a.incomeReceived - b.incomeReceived;
  const revenueDeltaPct = b.incomeReceived > 0 ? (revenueDelta / b.incomeReceived) * 100 : null;
  const avgTicketA = a.appointmentCountInRange > 0 ? a.incomeReceived / a.appointmentCountInRange : null;
  const avgTicketB = b.appointmentCountInRange > 0 ? b.incomeReceived / b.appointmentCountInRange : null;
  const avgTicketDeltaPct = avgTicketA != null && avgTicketB != null && avgTicketB > 0
    ? ((avgTicketA - avgTicketB) / avgTicketB) * 100
    : null;

  return {
    periodA: a,
    periodB: b,
    revenueDelta,
    revenueDeltaPct,
    appointmentCountDelta: a.appointmentCountInRange - b.appointmentCountInRange,
    avgTicketA,
    avgTicketB,
    avgTicketDeltaPct,
  };
}

// ============================================================================
// TOOL: getOpenBudgets
// ============================================================================

export interface OpenBudgetsResult {
  count: number;
  totalValue: number;
  items: (EvidenceRow & { patientId: string; totalValue: number; ageDays: number })[];
}

export async function getOpenBudgets(db: Firestore, clinicId: string): Promise<OpenBudgetsResult> {
  // No clinicId field on quotation docs (they're path-scoped only), and no
  // existing index for a clinic-scoped collectionGroup query — same
  // in-memory path-prefix safety check already used elsewhere in this
  // codebase (see server.ts's WhatsApp message-status matching) instead of
  // trusting an unfiltered collectionGroup result.
  const snap = await db.collectionGroup("quotations").limit(4000).get();
  const now = new Date();
  const items: OpenBudgetsResult["items"] = [];
  let totalValue = 0;

  snap.forEach((doc) => {
    if (!doc.ref.path.startsWith(`clinics/${clinicId}/`)) return;
    const data = doc.data();
    if (data.status !== "draft") return; // draft = created but never approved/rejected: "sem resposta"
    const patientId = doc.ref.parent.parent?.id || "";
    const createdAt = toDateSafe(data.createdAt) || now;
    const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const value = Number(data.totalValue) || 0;
    totalValue += value;
    items.push({ id: doc.id, patientId, label: data.title || "Orçamento", totalValue: value, ageDays });
  });

  items.sort((x, y) => y.ageDays - x.ageDays);
  return { count: items.length, totalValue, items: items.slice(0, 30) };
}

// ============================================================================
// TOOL: getRecallCandidates
// ============================================================================

export interface RecallCandidatesResult {
  count: number;
  items: (EvidenceRow & { patientId: string; daysSinceLastVisit: number })[];
}

export async function getRecallCandidates(db: Firestore, clinicId: string): Promise<RecallCandidatesResult> {
  const snap = await db.collection(`clinics/${clinicId}/appointments`).limit(3000).get();
  const now = new Date();
  const lastByPatient = new Map<string, { date: Date; patientId: string }>();
  const upcomingPatients = new Set<string>();

  snap.forEach((doc) => {
    const data = doc.data();
    const d = toDateSafe(data.date);
    if (!d) return;
    const patientId = data.patientId || data.patientName || doc.id;
    if (d <= now) {
      const prev = lastByPatient.get(patientId);
      if (!prev || d > prev.date) lastByPatient.set(patientId, { date: d, patientId: data.patientId || "" });
    } else {
      upcomingPatients.add(patientId);
    }
  });

  const items: RecallCandidatesResult["items"] = [];
  lastByPatient.forEach((info, key) => {
    if (upcomingPatients.has(key)) return;
    const days = Math.floor((now.getTime() - info.date.getTime()) / (1000 * 60 * 60 * 24));
    if (days > 90) {
      items.push({ id: info.patientId || key, patientId: info.patientId, label: String(key), daysSinceLastVisit: days });
    }
  });

  items.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
  return { count: items.length, items: items.slice(0, 30) };
}

// ============================================================================
// TOOL: getPendingItems
// ============================================================================

export interface PendingItemsResult {
  count: number;
  items: EvidenceRow[];
}

export async function getPendingItems(db: Firestore, clinicId: string): Promise<PendingItemsResult> {
  const snap = await db
    .collection(`clinics/${clinicId}/pending_items`)
    .where("status", "==", "pending")
    .limit(200)
    .get();

  const items: EvidenceRow[] = snap.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, label: data.title || data.type || "Pendência", detail: data.patientName || data.source };
  });

  return { count: items.length, items: items.slice(0, 30) };
}

// ============================================================================
// TOOL: getPatientContext
// ============================================================================
// The one tool every patient-scoped screen (Prontuário, Planejamento IA)
// should call through the same orchestrator instead of each re-querying
// Firestore its own way. patientId is validated against clinicId by the
// caller (server.ts's /api/eliza/ask) before this ever runs — this
// function trusts that the pairing has already been checked.

export interface PatientContextResult {
  patientId: string;
  name: string;
  phone: string | null;
  anamnesis: {
    allergies: string | null;
    conditions: string | null;
    medications: string | null;
    chiefComplaint: string | null;
    proceduresOfInterest: string | null;
    submittedByPatient: boolean;
  } | null;
  openQuotations: { id: string; label: string; value: number; ageDays: number }[];
  upcomingAppointments: EvidenceRow[];
  lastAppointment: EvidenceRow | null;
  overdueFinancial: { count: number; amount: number; items: EvidenceRow[] };
  lastEvolution: { date: string; professional: string; text: string } | null;
}

export async function getPatientContext(db: Firestore, clinicId: string, patientId: string): Promise<PatientContextResult> {
  const patientRef = db.doc(`clinics/${clinicId}/patients/${patientId}`);
  const [patientSnap, anamnesisSnap, quotationsSnap, treatmentsSnap] = await Promise.all([
    patientRef.get(),
    patientRef.collection("anamnesis").doc("current").get(),
    patientRef.collection("quotations").limit(50).get(),
    patientRef.collection("treatments").limit(50).get(),
  ]);

  const patientData = patientSnap.exists ? patientSnap.data() || {} : {};
  const anamnesisData = anamnesisSnap.exists ? anamnesisSnap.data() || {} : null;
  const now = new Date();

  const openQuotations: PatientContextResult["openQuotations"] = [];
  quotationsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.status !== "draft") return;
    const createdAt = toDateSafe(data.createdAt) || now;
    openQuotations.push({
      id: doc.id,
      label: data.title || "Orçamento",
      value: Number(data.totalValue) || 0,
      ageDays: Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    });
  });

  let lastEvolution: PatientContextResult["lastEvolution"] = null;
  treatmentsSnap.forEach((doc) => {
    const evolutions = doc.data().evolutions || [];
    for (const ev of evolutions) {
      if (ev.voided) continue;
      const d = toDateSafe(ev.date);
      if (!d) continue;
      if (!lastEvolution || d > toDateSafe((lastEvolution as any)._d)!) {
        lastEvolution = { date: ymd(d), professional: ev.professional || "", text: String(ev.text || "").slice(0, 200), _d: ev.date } as any;
      }
    }
  });
  if (lastEvolution) delete (lastEvolution as any)._d;

  const [appointmentsSnap, financialSnap] = await Promise.all([
    db.collection(`clinics/${clinicId}/appointments`).where("patientId", "==", patientId).limit(50).get(),
    db.collection(`clinics/${clinicId}/financial_entries`).where("patientId", "==", patientId).limit(100).get(),
  ]);

  const upcomingAppointments: EvidenceRow[] = [];
  let lastAppointment: EvidenceRow | null = null;
  let lastAppointmentDate: Date | null = null;
  appointmentsSnap.forEach((doc) => {
    const data = doc.data();
    const d = toDateSafe(data.date);
    if (!d) return;
    if (d >= now) {
      upcomingAppointments.push({ id: doc.id, label: data.date, detail: data.status });
    } else if (!lastAppointmentDate || d > lastAppointmentDate) {
      lastAppointmentDate = d;
      lastAppointment = { id: doc.id, label: data.date, detail: `${data.status || ""}${data.treatment ? ` — ${data.treatment}` : ""}`.trim() };
    }
  });

  let overdueCount = 0;
  let overdueAmount = 0;
  const overdueItems: EvidenceRow[] = [];
  financialSnap.forEach((doc) => {
    const e = normalizeFinancialEntry({ id: doc.id, ...doc.data() });
    if (!e || e.type !== "income" || (e.status !== "pending" && e.status !== "partial")) return;
    const due = toDateSafe(e.dueDate);
    if (due && due < now && due.toDateString() !== now.toDateString()) {
      overdueCount++;
      overdueAmount += e.pendingAmount;
      overdueItems.push({ id: e.id, label: e.description || "Lançamento", detail: `R$ ${e.pendingAmount.toFixed(2)}` });
    }
  });

  return {
    patientId,
    name: patientData.name || "Paciente",
    phone: patientData.phone || null,
    anamnesis: anamnesisData
      ? {
          allergies: anamnesisData.allergies || null,
          conditions: anamnesisData.conditions || null,
          medications: anamnesisData.medications || null,
          chiefComplaint: anamnesisData.chiefComplaint || null,
          proceduresOfInterest: anamnesisData.proceduresOfInterest || null,
          submittedByPatient: !!anamnesisData.submittedByPatient,
        }
      : null,
    openQuotations,
    upcomingAppointments,
    lastAppointment,
    overdueFinancial: { count: overdueCount, amount: overdueAmount, items: overdueItems },
    lastEvolution,
  };
}

// ============================================================================
// TOOL: resolvePatientsByName
// ============================================================================
// Lets the general assistant (asked from Home/any screen, not already
// scoped to a patient's own record) answer "look up patient X" questions.
// Case/accent-insensitive substring match over the real patients collection
// — same cost class as getOpenBudgets/getRecallCandidates above (already a
// full clinic-wide read per question), so this doesn't change the system's
// performance posture, just reuses it for one more real lookup.
function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export interface PatientNameMatch { id: string; name: string }

export async function resolvePatientsByName(db: Firestore, clinicId: string, nameQuery: string): Promise<PatientNameMatch[]> {
  const term = normalizeName(nameQuery);
  if (term.length < 3) return [];
  const snap = await db.collection(`clinics/${clinicId}/patients`).get();
  const matches: PatientNameMatch[] = [];
  snap.forEach((doc) => {
    const name = doc.data()?.name;
    if (typeof name === "string" && normalizeName(name).includes(term)) {
      matches.push({ id: doc.id, name });
    }
  });
  return matches.slice(0, 5);
}
