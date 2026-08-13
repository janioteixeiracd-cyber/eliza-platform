import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar,
  Sparkles,
  Zap,
  ShieldCheck,
  RefreshCw,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  X,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit, addDoc, updateDoc, doc as fsDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

interface Appointment {
  id: string;
  patientName: string;
  patientId?: string;
  time?: string;
  date?: string;
  status?: string;
  treatment?: string;
  dentistName?: string;
  notes?: string;
  duration?: number;
}

interface PatientOption {
  id: string;
  name: string;
}

const WEEKDAY_LONG = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const WEEKDAY_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MORNING_HOURS = [7, 8, 9, 10, 11, 12];
const AFTERNOON_HOURS = [13, 14, 15, 16, 17, 18];
const WEEK_HOURS = Array.from({ length: 15 }, (_, i) => 7 + i); // 07:00 .. 21:00

// Pixels per hour on the day-view grid. A dashed line is drawn at the
// half-hour mark, and appointments are positioned/sized from `time` +
// `duration` (in minutes) instead of being bucketed into a fixed hour slot —
// this is what makes 10/15/30/45-minute appointments show at their real
// proportional height instead of all looking like 1-hour blocks.
const ROW_HEIGHT = 100;
const SNAP_MINUTES = 5;

const DURATION_PRESETS = [10, 15, 20, 30, 45, 60, 90];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'atendimento', label: 'Em Atendimento' },
  { value: 'finalizado', label: 'Finalizado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'faltou', label: 'Faltou' },
];

// Appointment card color is driven by STATUS (not a random per-name hash),
// so the same status always reads as the same color across the whole agenda —
// confirmado=green, atendimento=blue, finalizado=purple, cancelado=red,
// faltou=amber, pendente=neutral.
const STATUS_CARD_STYLES: Record<string, { bg: string; border: string; text: string; avatar: string; dot: string }> = {
  pendente: { bg: 'bg-slate-500/15', border: 'border-slate-400/30', text: 'text-slate-200', avatar: 'bg-slate-500/30 text-slate-200', dot: 'bg-slate-400' },
  confirmado: { bg: 'bg-emerald-500/15', border: 'border-emerald-400/30', text: 'text-emerald-200', avatar: 'bg-emerald-500/30 text-emerald-200', dot: 'bg-emerald-400' },
  atendimento: { bg: 'bg-sky-500/15', border: 'border-sky-400/30', text: 'text-sky-200', avatar: 'bg-sky-500/30 text-sky-200', dot: 'bg-sky-400' },
  finalizado: { bg: 'bg-next-purple-neon/15', border: 'border-next-purple-neon/30', text: 'text-next-purple-light', avatar: 'bg-next-purple-neon/30 text-next-purple-light', dot: 'bg-next-purple-neon' },
  cancelado: { bg: 'bg-rose-500/15', border: 'border-rose-400/30', text: 'text-rose-200', avatar: 'bg-rose-500/30 text-rose-200', dot: 'bg-rose-400' },
  faltou: { bg: 'bg-amber-500/15', border: 'border-amber-400/30', text: 'text-amber-200', avatar: 'bg-amber-500/30 text-amber-200', dot: 'bg-amber-400' },
};

function styleForStatus(status?: string) {
  return STATUS_CARD_STYLES[(status || 'pendente').toLowerCase()] || STATUS_CARD_STYLES.pendente;
}

function getLocalDateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeToMinutes(t?: string): number {
  const [h, m] = (t || '0:00').split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

function minutesToTimeStr(mins: number): string {
  const clamped = Math.max(0, Math.round(mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface LaidOutAppt { app: Appointment; start: number; end: number; lane: number; lanes: number; }

// Classic calendar interval-partitioning layout: appointments that overlap
// in time share the column width side-by-side (lanes) instead of stacking
// on top of each other, which absolute positioning by time would otherwise do.
function layoutAppointments(appts: Appointment[]): LaidOutAppt[] {
  const items = appts
    .map(a => ({ app: a, start: timeToMinutes(a.time), end: timeToMinutes(a.time) + (a.duration || 60) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters: (typeof items)[] = [];
  let current: typeof items = [];
  let currentEnd = -Infinity;
  for (const it of items) {
    if (current.length === 0 || it.start < currentEnd) {
      current.push(it);
      currentEnd = Math.max(currentEnd, it.end);
    } else {
      clusters.push(current);
      current = [it];
      currentEnd = it.end;
    }
  }
  if (current.length) clusters.push(current);

  const result: LaidOutAppt[] = [];
  for (const cluster of clusters) {
    const lanesEnd: number[] = [];
    const withLane = cluster.map(it => {
      let lane = lanesEnd.findIndex(end => end <= it.start);
      if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(it.end); }
      else lanesEnd[lane] = it.end;
      return { ...it, lane };
    });
    const lanes = Math.max(...withLane.map(w => w.lane)) + 1;
    withLane.forEach(w => result.push({ app: w.app, start: w.start, end: w.end, lane: w.lane, lanes }));
  }
  return result;
}

const CANCELLED_STATUSES = ['cancelado', 'cancelled'];
const CONFIRMED_STATUSES = ['confirmado', 'confirmed'];
const PENDING_STATUSES = ['pendente', 'aguardando', 'encaixe', 'pending', 'waiting'];
const TERMINAL_STATUSES = ['finalizado', 'completed', 'cancelado', 'cancelled', 'faltou'];

const STATUS_LABELS: Record<string, string> = {
  confirmado: 'CONFIRMADO', confirmed: 'CONFIRMADO',
  aguardando: 'EM ESPERA', encaixe: 'EM ESPERA', waiting: 'EM ESPERA',
  atendimento: 'EM ATENDIMENTO',
  retorno: 'RETORNO',
  finalizado: 'FINALIZADO', completed: 'FINALIZADO',
  cancelado: 'CANCELADO', cancelled: 'CANCELADO',
  faltou: 'FALTOU',
};

function statusBadgeClasses(s: string) {
  if (CONFIRMED_STATUSES.includes(s)) return 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success';
  if (['aguardando', 'encaixe', 'waiting'].includes(s)) return 'bg-next-orange-insight/10 border-next-orange-insight/20 text-next-orange-insight';
  if (s === 'atendimento') return 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue';
  if (s === 'retorno') return 'bg-next-purple-neon/10 border-next-purple-neon/20 text-next-purple-light';
  if (['finalizado', 'completed'].includes(s)) return 'bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue';
  if (CANCELLED_STATUSES.includes(s) || s === 'faltou') return 'bg-next-red-alert/10 border-next-red-alert/20 text-next-red-alert';
  return 'bg-slate-800 border-next-border text-slate-400';
}

interface NextAgendaProps {
  prefillPatientName?: string | null;
  onPrefillConsumed?: () => void;
  onOpenRecord?: (patientId: string) => void;
}

export default function NextAgenda({ prefillPatientName, onPrefillConsumed, onOpenRecord }: NextAgendaProps = {}) {
  const { clinic } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [clinicalTeamNames, setClinicalTeamNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [filterProfessional, setFilterProfessional] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [showCancelled, setShowCancelled] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<{ key: string; message: string } | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  // Popover shown when an appointment card is clicked — positioned via
  // `fixed` at the card's on-screen rect so it can never be clipped by the
  // day-grid's overflow-hidden container.
  const [expandedAppt, setExpandedAppt] = useState<Appointment | null>(null);
  const [expandedRect, setExpandedRect] = useState<{ top: number; left: number; bottom: number; width: number } | null>(null);

  // Live drag state for the card currently being dragged (click-and-drag to
  // reschedule). `top` is recalculated (and snapped to SNAP_MINUTES) on every
  // mousemove; the real Firestore write only happens once on mouseup.
  // `dayIndex`/`ghost*` are only populated in Week view, where a card can
  // also move horizontally to a different day.
  const [dragState, setDragState] = useState<{ id: string; top: number; dayIndex?: number; ghostX?: number; ghostY?: number; ghostLabel?: string } | null>(null);

  // Points at the 7-column day grid in Week view so drag handlers can work
  // out which day column the cursor is currently over.
  const weekGridRef = useRef<HTMLDivElement>(null);

  const [isNewApptOpen, setIsNewApptOpen] = useState(false);
  const [newAppt, setNewAppt] = useState({ patientName: '', date: '', time: '09:00', dentistName: '', treatment: '', duration: 60 });
  const [savingAppt, setSavingAppt] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!clinic?.id) return;
      try {
        setLoading(true);
        const apptsRef = collection(db, 'clinics', clinic.id, 'appointments');
        const snap = await secureGetDocs(query(apptsRef, limit(300)), 'appointments', { addAuditLog });
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment));
        setAppointments(list);

        const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
        const patSnap = await secureGetDocs(query(patientsRef, limit(50)), 'patients', { addAuditLog });
        setPatients(patSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || 'Paciente sem nome' })));

        // Real staff roster (cadastrado no Painel Admin) — só quem está
        // marcado como "Atendimento Clínico" e ativo aparece para seleção
        // ao criar um agendamento.
        const membersRef = collection(db, 'clinics', clinic.id, 'members');
        const membersSnap = await secureGetDocs(query(membersRef, limit(100)), 'members', { addAuditLog });
        setClinicalTeamNames(
          membersSnap.docs
            .map(d => d.data() as any)
            .filter(m => m.isClinicalProvider && m.active !== false)
            .map(m => m.name)
            .filter(Boolean)
        );

        addAuditLog({
          collection: 'agenda_intelligence',
          action: 'QUERY',
          status: 'SUCCESS',
          details: `Agenda carregou ${list.length} agendamentos reais da clínica.`
        });
      } catch (err) {
        console.warn('Failed to load real appointments in sandbox:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [clinic?.id]);

  const statusOf = (a: Appointment) => (a.status || 'pendente').toLowerCase();
  const todayStr = getLocalDateString(new Date());
  const selectedDateStr = getLocalDateString(selectedDate);

  const professionals = useMemo(() => {
    const set = new Set<string>();
    clinicalTeamNames.forEach(n => set.add(n));
    appointments.forEach(a => { if (a.dentistName) set.add(a.dentistName); });
    return Array.from(set).sort();
  }, [appointments, clinicalTeamNames]);

  const treatmentTypes = useMemo(() => {
    const set = new Set<string>();
    appointments.forEach(a => { if (a.treatment) set.add(a.treatment); });
    return Array.from(set).sort();
  }, [appointments]);

  const passesFilters = (a: Appointment) => {
    if (filterProfessional !== 'all' && a.dentistName !== filterProfessional) return false;
    if (filterType !== 'all' && a.treatment !== filterType) return false;
    if (!showCancelled && CANCELLED_STATUSES.includes(statusOf(a))) return false;
    return true;
  };

  const dayAppointments = useMemo(() => {
    return appointments.filter(a => a.date === selectedDateStr && passesFilters(a));
  }, [appointments, selectedDateStr, filterProfessional, filterType, showCancelled]);

  const morningAppts = dayAppointments.filter(a => parseInt((a.time || '00:00').split(':')[0], 10) < 13);
  const afternoonAppts = dayAppointments.filter(a => parseInt((a.time || '00:00').split(':')[0], 10) >= 13);

  const daysWithAppointments = useMemo(() => {
    const set = new Set<string>();
    appointments.forEach(a => { if (a.date) set.add(a.date); });
    return set;
  }, [appointments]);

  const todayAll = appointments.filter(a => a.date === todayStr);
  const confirmedToday = todayAll.filter(a => CONFIRMED_STATUSES.includes(statusOf(a)));
  const pendingToday = todayAll.filter(a => PENDING_STATUSES.includes(statusOf(a)));
  const cancelledToday = todayAll.filter(a => CANCELLED_STATUSES.includes(statusOf(a)));
  const possibleNoShows = appointments.filter(a => (a.date || '') < todayStr && !TERMINAL_STATUSES.includes(statusOf(a)));

  const patientIdFor = (app: Appointment): string | null => {
    if (app.patientId) return app.patientId;
    const match = patients.find(p => p.name.trim().toLowerCase() === (app.patientName || '').trim().toLowerCase());
    return match ? match.id : null;
  };

  // Creates a real pending_items doc — same collection/shape the legacy
  // Task Manager (TaskManagerView.tsx) and Central de Recados already read,
  // so these actions actually put a follow-up task in front of staff
  // instead of just flashing a local toast.
  const createAgendaTask = async (key: string, app: Appointment, opts: { title: string; description: string; successMessage: string }) => {
    if (!clinic?.id) return;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'pending_items'), {
        type: 'agenda_follow_up',
        title: opts.title,
        description: opts.description,
        patientId: app.patientId || null,
        patientName: app.patientName || null,
        appointmentId: app.id || null,
        dueDate: app.date || todayStr,
        priority: 'Média',
        status: 'pending',
        source: 'ELIZA NEXT — Agenda',
        createdAt: serverTimestamp(),
      });
      setActionSuccess({ key, message: 'Pendência criada de verdade — aparece na Central de Recados / Gestão de Tarefas.' });
      addAuditLog({
        collection: 'pending_items',
        action: 'WRITE',
        status: 'SUCCESS',
        details: `${opts.title} (escrita real em pending_items).`
      });
    } catch (err: any) {
      setActionSuccess({ key, message: `Falha ao gravar: ${err?.message || err}` });
    }
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const goToPrevMonth = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goToNextMonth = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToPrevDay = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  const goToNextDay = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
  const goToToday = () => setSelectedDate(new Date());

  const miniCalendarWeeks = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [selectedDate]);

  // 7-day week (Sunday to Saturday) containing selectedDate — real dates,
  // computed the same way as the mini calendar.
  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  const weekDateStrs = useMemo(() => weekDays.map(getLocalDateString), [weekDays]);

  // ---- REAL WRITES ----------------------------------------------------
  // Unlike the rest of the /next sandbox (which only simulates writes),
  // appointment creation, status changes and rescheduling here perform real
  // Firestore operations against this clinic's real `appointments`
  // collection, by explicit product decision. Every write is still logged to
  // the local audit trail as 'WRITE' (never mislabeled as a blocked simulation).

  const handleChangeStatus = async (appt: Appointment, newStatus: string) => {
    if (!clinic?.id) return;
    setUpdatingStatusId(appt.id);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'appointments', appt.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: newStatus } : a));
      addAuditLog({
        collection: 'appointments',
        action: 'WRITE',
        status: 'SUCCESS',
        details: `Status do agendamento de ${appt.patientName} alterado para "${newStatus}" (escrita real no Firestore).`
      });
      setActionSuccess({ key: `status_${appt.id}`, message: `Status atualizado para "${STATUS_LABELS[newStatus] || newStatus}" — gravado de verdade.` });
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      console.error('Failed to update appointment status:', err);
      setActionSuccess({ key: `status_error_${appt.id}`, message: `Falha ao gravar: ${err?.message || err}` });
      setTimeout(() => setActionSuccess(null), 5000);
    } finally {
      setUpdatingStatusId(null);
      setExpandedAppt(null);
      setExpandedRect(null);
    }
  };

  const handleRescheduleAppointment = async (appt: Appointment, newTime: string, newDate?: string) => {
    if (!clinic?.id) return;
    const finalDate = newDate || appt.date;
    const movedDay = !!newDate && newDate !== appt.date;
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'appointments', appt.id), {
        time: newTime,
        date: finalDate,
        updatedAt: serverTimestamp(),
      });
      setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, time: newTime, date: finalDate } : a));
      addAuditLog({
        collection: 'appointments',
        action: 'WRITE',
        status: 'SUCCESS',
        details: movedDay
          ? `Agendamento de ${appt.patientName} movido de ${appt.date} ${appt.time} para ${finalDate} ${newTime} (arrastar e soltar, escrita real no Firestore).`
          : `Agendamento de ${appt.patientName} reagendado de ${appt.time} para ${newTime} (arrastar e soltar, escrita real no Firestore).`
      });
      setActionSuccess({ key: `reschedule_${appt.id}`, message: movedDay ? `Movido para ${finalDate!.split('-').reverse().join('/')} às ${newTime} — gravado de verdade.` : `Reagendado para ${newTime} — gravado de verdade.` });
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      console.error('Failed to reschedule appointment:', err);
      setActionSuccess({ key: `reschedule_error_${appt.id}`, message: `Falha ao reagendar: ${err?.message || err}` });
      setTimeout(() => setActionSuccess(null), 5000);
    }
  };

  const openNewAppointment = (prefillDate?: string, prefillName?: string, prefillTime?: string) => {
    setNewAppt({ patientName: prefillName || '', date: prefillDate || selectedDateStr, time: prefillTime || '09:00', dentistName: '', treatment: '', duration: 60 });
    setCreateError(null);
    setIsNewApptOpen(true);
  };

  // Coming from "Agendar" on a patient card in the Pacientes tab.
  useEffect(() => {
    if (prefillPatientName) {
      openNewAppointment(undefined, prefillPatientName);
      onPrefillConsumed?.();
    }
  }, [prefillPatientName]);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    if (!newAppt.patientName.trim() || !newAppt.date || !newAppt.time) {
      setCreateError('Preencha ao menos paciente, data e horário.');
      return;
    }
    setSavingAppt(true);
    setCreateError(null);
    try {
      const matchedPatient = patients.find(p => p.name.trim().toLowerCase() === newAppt.patientName.trim().toLowerCase());
      const payload = {
        patientName: newAppt.patientName.trim(),
        patientId: matchedPatient ? matchedPatient.id : null,
        date: newAppt.date,
        time: newAppt.time,
        dentistName: newAppt.dentistName.trim() || null,
        treatment: newAppt.treatment.trim() || 'Consulta',
        duration: Number(newAppt.duration) || 60,
        status: 'pendente',
        createdAt: serverTimestamp(),
        createdBy: 'eliza_next_sandbox',
      };
      const ref = await addDoc(collection(db, 'clinics', clinic.id, 'appointments'), payload);
      setAppointments(prev => [...prev, { id: ref.id, ...payload, createdAt: undefined } as Appointment]);
      addAuditLog({
        collection: 'appointments',
        action: 'WRITE',
        status: 'SUCCESS',
        details: `Agendamento real criado para ${payload.patientName} em ${payload.date} às ${payload.time} (escrita real no Firestore, não simulada).`
      });
      setIsNewApptOpen(false);
      setSelectedDate(new Date(`${payload.date}T00:00:00`));
      setViewMode('day');
      setActionSuccess({ key: 'created', message: `Agendamento de ${payload.patientName} criado de verdade nesta clínica.` });
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      console.error('Failed to create appointment:', err);
      setCreateError(`Falha ao gravar no Firestore: ${err?.message || err}`);
    } finally {
      setSavingAppt(false);
    }
  };

  // A click on empty grid space opens "Novo agendamento" pre-filled with the
  // exact time clicked (snapped to SNAP_MINUTES), so there's no need to hunt
  // for the "Novo agendamento" button first.
  const handleSlotClick = (hours: number[], startMinutes: number, dateForClick?: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    let minutes = startMinutes + (offsetY / ROW_HEIGHT) * 60;
    minutes = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const maxMinutes = startMinutes + hours.length * 60 - SNAP_MINUTES;
    minutes = Math.max(startMinutes, Math.min(maxMinutes, minutes));
    openNewAppointment(dateForClick || selectedDateStr, undefined, minutesToTimeStr(minutes));
  };

  // When rendering a Week-view column, this tells the card's drag handler
  // which day column it started in and how to find/measure the shared
  // 7-column grid, so a vertical+horizontal drag can move the appointment to
  // a different day (not just a different time) in one gesture.
  const renderPositionedCard = (item: LaidOutAppt, hours: number[], startMinutes: number, weekCtx?: { dayIndex: number; dates: string[] }) => {
    const { app, start, lane, lanes } = item;
    const isDragging = dragState?.id === app.id;
    const naturalTop = ((start - startMinutes) / 60) * ROW_HEIGHT;
    const top = isDragging && dragState ? dragState.top : naturalTop;
    const height = Math.max(((app.duration || 60) / 60) * ROW_HEIGHT, 18);
    const style = styleForStatus(app.status);
    const widthPct = 100 / lanes;
    const leftPct = lane * widthPct;
    const compact = height < 40;
    const pid = patientIdFor(app);

    const onMouseDownCard = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const cardEl = e.currentTarget;
      const targetIsName = (e.target as HTMLElement).closest('[data-role="patient-name"]') != null;
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const maxTop = hours.length * ROW_HEIGHT - height;
      let moved = false;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startClientY;
        const deltaX = ev.clientX - startClientX;
        if (Math.abs(delta) > 4 || Math.abs(deltaX) > 4) moved = true;
        if (!moved) return;
        let rawTop = naturalTop + delta;
        rawTop = Math.max(0, Math.min(maxTop, rawTop));
        const rawMinutes = startMinutes + (rawTop / ROW_HEIGHT) * 60;
        const snappedMinutes = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
        const snappedTop = Math.max(0, Math.min(maxTop, ((snappedMinutes - startMinutes) / 60) * ROW_HEIGHT));

        let newDayIndex: number | undefined = weekCtx?.dayIndex;
        if (weekCtx) {
          const gridEl = weekGridRef.current;
          if (gridEl) {
            const rect = gridEl.getBoundingClientRect();
            const colWidth = rect.width / weekCtx.dates.length;
            const rawIndex = weekCtx.dayIndex + Math.round(deltaX / colWidth);
            newDayIndex = Math.max(0, Math.min(weekCtx.dates.length - 1, rawIndex));
          }
        }

        const ghostDayLabel = weekCtx && newDayIndex !== undefined ? ` • ${WEEKDAY_SHORT[weekDays[newDayIndex].getDay()]} ${weekDays[newDayIndex].getDate()}` : '';
        setDragState({
          id: app.id,
          top: snappedTop,
          dayIndex: newDayIndex,
          ghostX: ev.clientX,
          ghostY: ev.clientY,
          ghostLabel: `${app.patientName || 'Paciente'} • ${minutesToTimeStr(snappedMinutes)}${ghostDayLabel}`,
        });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (moved) {
          setDragState(current => {
            if (current && current.id === app.id) {
              const finalMinutes = startMinutes + (current.top / ROW_HEIGHT) * 60;
              const newTime = minutesToTimeStr(finalMinutes);
              const newDate = weekCtx && current.dayIndex !== undefined ? weekCtx.dates[current.dayIndex] : undefined;
              if (newTime !== app.time || (newDate && newDate !== app.date)) handleRescheduleAppointment(app, newTime, newDate);
            }
            return null;
          });
        } else {
          setDragState(null);
          if (targetIsName && pid) {
            onOpenRecord?.(pid);
          } else {
            const rect = cardEl.getBoundingClientRect();
            setExpandedRect({ top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width });
            setExpandedAppt(app);
          }
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    return (
      <div
        key={app.id}
        onMouseDown={onMouseDownCard}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
        className={`rounded-lg border ${style.bg} ${style.border} px-2 py-1 overflow-hidden cursor-grab active:cursor-grabbing select-none transition-shadow ${isDragging ? 'opacity-60 ring-2 ring-next-purple-neon shadow-next-glow-purple z-30' : 'z-10 hover:brightness-110'}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {!compact && (
            <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8.5px] font-bold flex-shrink-0 ${style.avatar}`}>
              {(app.patientName || '?').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <span
            data-role="patient-name"
            className={`text-[10.5px] font-bold truncate ${style.text} ${pid ? 'hover:underline cursor-pointer' : ''}`}
            title={pid ? 'Clique para abrir o prontuário do paciente' : undefined}
          >
            {app.patientName || 'Paciente sem nome'}
          </span>
          <span className="text-[9px] font-mono text-slate-400 flex-shrink-0 ml-auto">{app.time}</span>
        </div>
        {!compact && <p className="text-[9.5px] text-slate-400 truncate mt-0.5">{app.treatment || 'Consulta'}</p>}
      </div>
    );
  };

  // A hour ruler column, reused both per-half-day (Day view, each half with
  // its own ruler since morning/afternoon have different hour counts) and
  // once, shared, across all 7 columns in Week view. `headerSpacerClass` lets
  // the ruler line up with a day-column header that sits above the content
  // area (Week view) without needing one itself (Day view's header is a
  // separate shared bar above both ruler and content).
  const renderHourRuler = (hours: number[], headerSpacerClass?: string) => (
    <div className="w-14 flex-shrink-0 border-r border-next-border">
      {headerSpacerClass && <div className={`${headerSpacerClass} border-b border-next-border`} />}
      {hours.map(h => (
        <div key={h} style={{ height: ROW_HEIGHT }} className="relative">
          <span className="absolute top-1 right-2 text-[10px] font-mono text-slate-500">{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}
    </div>
  );

  // The scrollable content area for one column (one half-day in Day view, or
  // one weekday in Week view): grid lines + real appointments absolutely
  // positioned by start-time/duration (not bucketed into a fixed-height hour
  // row), so a 15 or 30-minute appointment renders proportionally shorter
  // than a 1-hour one. A click on empty space creates a new appointment at
  // that exact time (and day, for week columns via `dateForClick`).
  const renderScheduleContent = (hours: number[], appts: Appointment[], dateForClick?: string, weekCtx?: { dayIndex: number; dates: string[] }) => {
    const startMinutes = hours[0] * 60;
    const totalHeight = hours.length * ROW_HEIGHT;
    const laidOut = layoutAppointments(appts);
    return (
      <div
        className="flex-1 relative cursor-pointer"
        style={{ height: totalHeight }}
        onClick={handleSlotClick(hours, startMinutes, dateForClick)}
        title="Clique em um horário livre para criar um agendamento"
      >
        {hours.map((h, i) => (
          <React.Fragment key={h}>
            {i > 0 && <div className="absolute left-0 right-0 border-t border-next-border/60 pointer-events-none" style={{ top: i * ROW_HEIGHT }} />}
            <div className="absolute left-0 right-0 border-t border-dashed border-next-border/25 pointer-events-none" style={{ top: i * ROW_HEIGHT + ROW_HEIGHT / 2 }} />
          </React.Fragment>
        ))}
        {laidOut.map(item => renderPositionedCard(item, hours, startMinutes, weekCtx))}
      </div>
    );
  };

  const renderSchedule = (hours: number[], appts: Appointment[]) => {
    return (
      <div className="flex flex-1">
        {renderHourRuler(hours)}
        {renderScheduleContent(hours, appts)}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-8 font-sans">

      {/* HEADER */}
      <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4 z-10">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight next-brand-gradient-text">Agenda</h1>
            <p className="text-slate-400 text-xs mt-1">Consultas reais desta clínica. Criar, arrastar e alterar status grava de verdade no Firestore.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-900/70 border border-next-border rounded-xl p-1">
              <button onClick={() => setViewMode('day')} className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg ${viewMode === 'day' ? 'next-brand-gradient-bg text-white' : 'text-slate-400 hover:text-slate-200'}`}>Dia</button>
              <button onClick={() => setViewMode('week')} className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg ${viewMode === 'week' ? 'next-brand-gradient-bg text-white' : 'text-slate-400 hover:text-slate-200'}`}>Semana</button>
            </div>

            <div className="flex items-center gap-1 bg-slate-900/70 border border-next-border rounded-xl px-2 py-1.5">
              <button onClick={goToPrevMonth} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200" aria-label="Mês anterior">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold text-slate-200 px-1 font-mono">
                {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}
              </span>
              <button onClick={goToNextMonth} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200" aria-label="Próximo mês">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {viewMode === 'day' && (
              <div className="flex items-center gap-1 bg-slate-900/70 border border-next-border rounded-xl px-1.5 py-1.5">
                <button onClick={goToPrevDay} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200" aria-label="Dia anterior">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={goToNextDay} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200" aria-label="Próximo dia">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={goToToday} className="text-[11px] font-bold text-slate-300 px-2 py-1 rounded-lg hover:bg-slate-800">Hoje</button>
              </div>
            )}

            <button
              onClick={() => openNewAppointment()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple"
              style={{ minHeight: '38px' }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo agendamento</span>
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'day' && (
        <div className="flex flex-col items-center gap-2.5">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/70 border border-next-border text-xs font-bold text-slate-200">
            <Calendar className="w-3.5 h-3.5 text-next-purple-neon" />
            {WEEKDAY_LONG[selectedDate.getDay()]}, {selectedDate.getDate()}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {STATUS_OPTIONS.map(opt => (
              <span key={opt.value} className="inline-flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                <span className={`w-2 h-2 rounded-full ${styleForStatus(opt.value).dot}`} />
                {opt.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* MAIN GRID: DAY/WEEK VIEW + SIDEBAR */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <div className={`next-glass-panel rounded-next-2xl overflow-hidden ${viewMode === 'week' ? 'lg:col-span-9' : 'lg:col-span-8'}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-next-purple-neon" />
              <span className="text-xs font-mono">Carregando agenda real...</span>
            </div>
          ) : viewMode === 'day' ? (
            <div className="flex">
              <div className="flex-1 flex flex-col border-r border-next-border">
                <div className="h-9 flex items-center justify-center border-b border-next-border bg-slate-900/40">
                  <span className="text-[10.5px] font-bold text-slate-400 font-mono">07:00 – 13:00</span>
                </div>
                {renderSchedule(MORNING_HOURS, morningAppts)}
              </div>
              <div className="flex-1 flex flex-col">
                <div className="h-9 flex items-center justify-center border-b border-next-border bg-slate-900/40">
                  <span className="text-[10.5px] font-bold text-slate-400 font-mono">13:00 – 19:00</span>
                </div>
                {renderSchedule(AFTERNOON_HOURS, afternoonAppts)}
              </div>
            </div>
          ) : (
            // WEEK VIEW — same real time-grid engine as Day view (hour ruler,
            // half-hour guide lines, absolute positioning by time/duration,
            // drag-to-reschedule, click-empty-slot-to-create, click-card for
            // status, click-name for the patient record), just repeated
            // across 7 real weekday columns sharing ONE ruler (07:00-21:00)
            // instead of each column having its own. Clicking a day's header
            // still jumps to Day view for that date.
            <div className="flex">
              {renderHourRuler(WEEK_HOURS, 'h-14')}
              <div ref={weekGridRef} className="flex-1 grid grid-cols-7 divide-x divide-next-border">
                {weekDays.map((d, i) => {
                  const dStr = getLocalDateString(d);
                  const dayAppts = appointments.filter(a => a.date === dStr && passesFilters(a));
                  const isToday = dStr === todayStr;
                  const isSelected = dStr === selectedDateStr;
                  return (
                    <div key={i} className="flex flex-col">
                      <button
                        onClick={() => { setSelectedDate(d); setViewMode('day'); }}
                        className={`h-14 flex-shrink-0 flex flex-col items-center justify-center border-b border-next-border ${isSelected ? 'bg-next-purple-neon/10' : 'bg-slate-900/40 hover:bg-slate-900/70'}`}
                      >
                        <span className="text-[9.5px] font-mono text-slate-500 uppercase">{WEEKDAY_SHORT[d.getDay()]}</span>
                        <span className={`text-sm font-bold ${isToday ? 'text-next-purple-light' : 'text-slate-200'}`}>{d.getDate()}</span>
                      </button>
                      {renderScheduleContent(WEEK_HOURS, dayAppts, dStr, { dayIndex: i, dates: weekDateStrs })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === 'day' && !loading && dayAppointments.length === 0 && (
            <div className="p-8 text-center border-t border-next-border">
              <p className="text-xs font-semibold text-slate-300">Nenhum agendamento real para este dia</p>
              <p className="text-[11px] text-slate-500 mt-1">Clique em um horário livre na grade, ou use "Novo agendamento".</p>
            </div>
          )}
        </div>

        {/* SIDEBAR: MINI CALENDAR + FILTERS */}
        <div className={`space-y-6 ${viewMode === 'week' ? 'lg:col-span-3' : 'lg:col-span-4'}`}>
          <div className="next-glass-panel rounded-next-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={goToPrevMonth} className="p-1 rounded hover:bg-slate-800 text-slate-400"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs font-bold text-slate-200 font-mono">{MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}</span>
              <button onClick={goToNextMonth} className="p-1 rounded hover:bg-slate-800 text-slate-400"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAY_SHORT.map((d, i) => <span key={i} className="text-[9px] text-center font-bold text-slate-600">{d}</span>)}
            </div>
            {miniCalendarWeeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
                {week.map((date, di) => {
                  if (!date) return <span key={di} />;
                  const dStr = getLocalDateString(date);
                  const isSelected = dStr === selectedDateStr;
                  const isToday = dStr === todayStr;
                  const hasAppts = daysWithAppointments.has(dStr);
                  return (
                    <button
                      key={di}
                      onClick={() => { setSelectedDate(date); setViewMode('day'); }}
                      className={`relative text-[10.5px] h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                        isSelected ? 'next-brand-gradient-bg text-white font-bold' : isToday ? 'border border-next-purple-neon/50 text-next-purple-light font-bold' : 'text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {date.getDate()}
                      {hasAppts && !isSelected && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-next-purple-neon" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="next-glass-panel rounded-next-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-next-purple-neon" />
              <h3 className="text-xs font-bold text-slate-200">Filtros</h3>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-slate-500 uppercase">Profissional</label>
              <select value={filterProfessional} onChange={(e) => setFilterProfessional(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2">
                <option value="all">Todos</option>
                {professionals.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {professionals.length === 0 && <p className="text-[10px] text-slate-600">Nenhum profissional encontrado nos dados reais ainda.</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-slate-500 uppercase">Tipo de atendimento</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-2">
                <option value="all">Todos</option>
                {treatmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300 pt-1 cursor-pointer">
              <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-next-purple-neon w-3.5 h-3.5" />
              Exibir cancelados
            </label>
          </div>

          <AnimatePresence>
            {actionSuccess && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-next-xl p-3 flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-next-green-success flex-shrink-0 mt-0.5" />
                <div className="text-[11px] leading-tight text-slate-300">
                  <p className="font-bold text-next-green-success">{actionSuccess.message}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* OPORTUNIDADES — derivadas de agendamentos reais de hoje; as ações
          criam pendências reais em pending_items (mesma coleção da Central
          de Recados / Gestão de Tarefas do app legado), não simulam mais. */}
      <div className="next-glass-panel rounded-next-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-next-purple-neon" />
          <h3 className="text-sm font-bold text-slate-200">Oportunidades Identificadas Hoje</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Baseado em consultas reais de hoje ({confirmedToday.length} confirmadas, {pendingToday.length} pendentes, {cancelledToday.length} canceladas). As ações abaixo criam uma pendência real na Central de Recados / Gestão de Tarefas — não enviam mensagem automática ao paciente, é um lembrete de verdade para a equipe agir.
        </p>

        {cancelledToday.length === 0 && possibleNoShows.length === 0 ? (
          <div className="p-4 rounded-next-xl border border-next-border bg-slate-900/40 text-center space-y-1">
            <p className="text-xs font-semibold text-slate-300">Nenhuma oportunidade real no momento</p>
            <p className="text-[11px] text-slate-500 leading-relaxed">Assim que houver um cancelamento hoje ou uma consulta passada sem status final, ela aparece aqui automaticamente.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cancelledToday.map((app) => {
              const key = `cancel_${app.id}`;
              return (
                <div key={key} onClick={() => setActiveSuggestion(activeSuggestion === key ? null : key)} className={`cursor-pointer p-3.5 rounded-next-xl border text-left transition-all ${activeSuggestion === key ? 'bg-slate-900 border-next-purple-neon/50 shadow-next-glow-purple' : 'bg-slate-900/40 border-next-border hover:border-next-border-glow'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-next-purple-light font-mono">VAGA ABERTA POR CANCELAMENTO</span>
                    <span className="text-[9px] text-slate-500 font-mono">{app.time || '—'}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-200">{app.patientName || 'Paciente sem nome'}</h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-normal">Consulta de {app.treatment || 'atendimento'} cancelada hoje às {app.time || 'horário não informado'}.</p>
                  <AnimatePresence>
                    {activeSuggestion === key && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 pt-3 border-t border-next-border overflow-hidden">
                        <button onClick={(e) => { e.stopPropagation(); createAgendaTask(key, app, { title: `Vaga aberta às ${app.time || '—'} — avisar lista de espera`, description: `Consulta de ${app.treatment || 'atendimento'} cancelada hoje às ${app.time || 'horário não informado'}. Verificar lista de espera e oferecer o horário.`, successMessage: 'Pendência criada.' }); }} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-next-purple-neon hover:bg-next-purple-neon/90 text-white font-bold text-[10px] rounded-lg shadow-next-glow-purple" style={{ minHeight: '36px' }}>
                          <Zap className="w-3 h-3" />
                          <span>Criar Tarefa: Avisar Lista de Espera</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {possibleNoShows.map((app) => {
              const key = `noshow_${app.id}`;
              return (
                <div key={key} onClick={() => setActiveSuggestion(activeSuggestion === key ? null : key)} className={`cursor-pointer p-3.5 rounded-next-xl border text-left transition-all ${activeSuggestion === key ? 'bg-slate-900 border-next-ia-blue/50 shadow-next-glow-blue' : 'bg-slate-900/40 border-next-border hover:border-next-border-glow'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-next-ia-blue-light font-mono">POSSÍVEL FALTA NÃO REGISTRADA</span>
                    <span className="text-[9px] text-slate-500 font-mono">{app.date}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-200">{app.patientName || 'Paciente sem nome'}</h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-normal">Consulta de {app.date} segue com status "{app.status || 'pendente'}".</p>
                  <AnimatePresence>
                    {activeSuggestion === key && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 pt-3 border-t border-next-border overflow-hidden">
                        <button onClick={(e) => { e.stopPropagation(); createAgendaTask(key, app, { title: `Confirmar falta ou reengajar — ${app.patientName || 'paciente'}`, description: `Consulta de ${app.date} segue com status "${app.status || 'pendente'}" sem confirmação de comparecimento. Confirmar o que houve e, se for falta, reengajar o paciente.`, successMessage: 'Pendência criada.' }); }} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-next-purple-neon hover:bg-next-purple-neon/90 text-white font-bold text-[10px] rounded-lg shadow-next-glow-purple" style={{ minHeight: '36px' }}>
                          <Zap className="w-3 h-3" />
                          <span>Criar Tarefa: Confirmar Falta / Reengajar</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Criar, arrastar, alterar status de agendamentos e criar pendências de Oportunidades gravam de verdade nesta clínica</span>
        </span>
      </div>

      {/* DRAG GHOST — follows the cursor while an appointment is being dragged,
          showing the patient, the snapped target time and (in Week view) the
          target day, since the card itself only visually moves within its
          own origin column. */}
      {dragState && dragState.ghostX !== undefined && dragState.ghostY !== undefined && (
        <div
          className="fixed z-50 pointer-events-none px-2.5 py-1.5 rounded-lg next-brand-gradient-bg text-white text-[10.5px] font-bold shadow-next-glow-purple whitespace-nowrap"
          style={{ left: dragState.ghostX + 16, top: dragState.ghostY + 16 }}
        >
          {dragState.ghostLabel}
        </div>
      )}

      {/* APPOINTMENT DETAILS POPOVER — anchored to the clicked card's real screen position */}
      <AnimatePresence>
        {expandedAppt && expandedRect && (
          <React.Fragment>
            <div className="fixed inset-0 z-40" onClick={() => { setExpandedAppt(null); setExpandedRect(null); }} />
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="fixed z-50 w-64 next-glass-panel rounded-next-xl p-3 shadow-next-glow-purple"
              style={{
                top: Math.min(expandedRect.bottom + 6, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240),
                left: Math.min(expandedRect.left, (typeof window !== 'undefined' ? window.innerWidth : 800) - 272),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-1.5 gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-100 truncate">{expandedAppt.patientName || 'Paciente sem nome'}</p>
                  <p className="text-[10px] text-slate-500 font-mono">{expandedAppt.time} · {expandedAppt.treatment || 'Consulta'} · {expandedAppt.duration || 60}min</p>
                </div>
                <button onClick={() => { setExpandedAppt(null); setExpandedRect(null); }} className="text-slate-500 hover:text-slate-300 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
              </div>

              {patientIdFor(expandedAppt) && (
                <button
                  onClick={() => { const pid = patientIdFor(expandedAppt); if (pid) onOpenRecord?.(pid); setExpandedAppt(null); setExpandedRect(null); }}
                  className="text-[10.5px] font-bold text-next-purple-light hover:underline mb-2 block"
                >
                  Abrir prontuário do paciente →
                </button>
              )}

              <p className="text-[9.5px] font-mono text-slate-500 uppercase mb-1.5">Alterar status (grava de verdade)</p>
              <div className="flex flex-wrap gap-1">
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    disabled={updatingStatusId === expandedAppt.id}
                    onClick={() => handleChangeStatus(expandedAppt, opt.value)}
                    className={`text-[9.5px] font-bold font-mono px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                      statusOf(expandedAppt) === opt.value ? statusBadgeClasses(opt.value) : 'bg-slate-950 border-next-border text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {updatingStatusId === expandedAppt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : opt.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </React.Fragment>
        )}
      </AnimatePresence>

      {/* NEW APPOINTMENT MODAL — real write */}
      <AnimatePresence>
        {isNewApptOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !savingAppt && setIsNewApptOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md next-glass-panel rounded-next-2xl p-6"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-slate-100">Novo agendamento</h3>
                <button onClick={() => !savingAppt && setIsNewApptOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-[11px] text-amber-400/90 mb-4 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Isto grava um agendamento real nesta clínica.
              </p>

              <form onSubmit={handleCreateAppointment} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Paciente *</label>
                  <input
                    list="next-patients-list"
                    value={newAppt.patientName}
                    onChange={(e) => setNewAppt(v => ({ ...v, patientName: e.target.value }))}
                    placeholder="Nome do paciente"
                    className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1"
                  />
                  <datalist id="next-patients-list">
                    {patients.map(p => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Data *</label>
                    <input type="date" value={newAppt.date} onChange={(e) => setNewAppt(v => ({ ...v, date: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Horário *</label>
                    <input type="time" value={newAppt.time} onChange={(e) => setNewAppt(v => ({ ...v, time: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Profissional</label>
                  <input list="next-professionals-list" value={newAppt.dentistName} onChange={(e) => setNewAppt(v => ({ ...v, dentistName: e.target.value }))} placeholder="Ex: Dra. Ana Demo" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  <datalist id="next-professionals-list">
                    {professionals.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Procedimento</label>
                  <input list="next-treatments-list" value={newAppt.treatment} onChange={(e) => setNewAppt(v => ({ ...v, treatment: e.target.value }))} placeholder="Consulta" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  <datalist id="next-treatments-list">
                    {treatmentTypes.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Duração</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 mb-1.5">
                    {DURATION_PRESETS.map(d => (
                      <button
                        type="button"
                        key={d}
                        onClick={() => setNewAppt(v => ({ ...v, duration: d }))}
                        className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold border transition-colors ${
                          newAppt.duration === d ? 'next-brand-gradient-bg text-white border-transparent' : 'bg-slate-900 border-next-border text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {d}min
                      </button>
                    ))}
                  </div>
                  <input type="number" min={5} step={5} value={newAppt.duration} onChange={(e) => setNewAppt(v => ({ ...v, duration: Number(e.target.value) }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5" />
                </div>

                {createError && (
                  <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{createError}</p>
                )}

                <button
                  type="submit"
                  disabled={savingAppt}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60"
                  style={{ minHeight: '40px' }}
                >
                  {savingAppt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{savingAppt ? 'Gravando...' : 'Criar agendamento real'}</span>
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
