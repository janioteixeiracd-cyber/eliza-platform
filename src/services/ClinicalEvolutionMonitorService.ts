import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  limit 
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface ClinicEvolution {
  id?: string;
  appointmentId?: string;
  patientId: string;
  patientName: string;
  professionalId: string;
  professionalName: string;
  date: string;
  description: string;
  proceduresPerformed?: string;
  materialsUsed?: string;
  observations?: string;
  createdAt: string;
  createdBy: string;
}

// Memory cache for optimization
const checkedDatesCache = new Map<string, number>(); // clinicId_dateStr -> timestamp of last check
const checkedAppointmentsCache = new Map<string, number>(); // appointmentId -> timestamp of last check
const CACHE_TTL_MS = 60000; // 60 seconds Cache Time-To-Live

export const ClinicalEvolutionMonitorService = {
  /**
   * Checks if an appointment has had an evolution registered.
   * If not, and the conditions are met (status is finished or time is overdue),
   * creates an alert and pending item.
   */
  async checkAppointmentEvolution(clinicId: string, appointment: any, force = false): Promise<boolean> {
    if (!clinicId || !appointment || !appointment.id || !appointment.patientId) return false;

    const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
    const now = Date.now();
    const lastChecked = checkedAppointmentsCache.get(appointment.id);
    
    if (!force && lastChecked && (now - lastChecked) < CACHE_TTL_MS) {
      if (isDebugActive) {
        console.log(`[EvolutionMonitor] Using cached check result for appointment ${appointment.id}`);
      }
      return true;
    }

    try {
      // Mark as checked to prevent duplicate concurrent runs
      checkedAppointmentsCache.set(appointment.id, now);

      // Check if evolution already exists by appointmentId
      const evolRef = collection(db, 'clinics', clinicId, 'patients', appointment.patientId, 'evolutions');
      const qByAppt = query(evolRef, where('appointmentId', '==', appointment.id), limit(1));
      const snapByAppt = await getDocs(qByAppt);

      if (!snapByAppt.empty) {
        // Exists! Make sure any alerts for this are resolved
        await this.resolveMissingEvolutionAlert(clinicId, appointment.id, appointment.patientId, appointment.date);
        return true;
      }

      // Check if evolution exists by date and patientId
      const qByDate = query(evolRef, where('date', '==', appointment.date), limit(1));
      const snapByDate = await getDocs(qByDate);

      if (!snapByDate.empty) {
        // Exists! Resolve any alerts for this
        await this.resolveMissingEvolutionAlert(clinicId, appointment.id, appointment.patientId, appointment.date);
        return true;
      }

      // Since evolution doesn't exist, check if we should trigger the alert
      const status = (appointment.status || '').toLowerCase().trim();
      const finalStatuses = ['finalizado', 'completed', 'concluido', 'atendido'];
      let isFinished = finalStatuses.includes(status);

      // Also check time condition (now > appointment.endTime + 30 minutes)
      let isOverdue = false;
      if (appointment.date && appointment.time) {
        try {
          const start = new Date(`${appointment.date}T${appointment.time}`);
          const duration = appointment.duration ? Number(appointment.duration) : 30;
          const end = new Date(start.getTime() + duration * 60 * 1000);
          const limitTime = new Date(end.getTime() + 30 * 60 * 1000);
          if (now > limitTime.getTime()) {
            isOverdue = true;
          }
        } catch (err) {
          console.error('[EvolutionMonitor] Error parsing appointment time:', err);
        }
      }

      if (isFinished || isOverdue) {
        // Create lack-of-evolution alert
        await this.createMissingEvolutionAlert(clinicId, appointment);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[EvolutionMonitor] Error in checkAppointmentEvolution:', err);
      return false;
    }
  },

  /**
   * Sweeps daily appointments for a given date and triggers missing evolution checks.
   */
  async checkDailyMissingEvolutions(clinicId: string, dateStr: string, force = false): Promise<void> {
    if (!clinicId || !dateStr) return;

    const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
    const cacheKey = `${clinicId}_${dateStr}`;
    const now = Date.now();
    const lastChecked = checkedDatesCache.get(cacheKey);

    if (!force && lastChecked && (now - lastChecked) < CACHE_TTL_MS) {
      if (isDebugActive) {
        console.log(`[EvolutionMonitor] Daily check for ${dateStr} is on cool-down (last run: ${Math.round((now - lastChecked) / 1000)}s ago)`);
      }
      return;
    }

    try {
      if (isDebugActive) {
        console.log(`[EvolutionMonitor] Checking daily evolutions for clinic ${clinicId} on date ${dateStr}`);
      }
      checkedDatesCache.set(cacheKey, now);

      const apptsRef = collection(db, 'clinics', clinicId, 'appointments');
      const q = query(apptsRef, where('date', '==', dateStr));
      const snap = await getDocs(q);

      for (const d of snap.docs) {
        const appt = { id: d.id, ...d.data() };
        await this.checkAppointmentEvolution(clinicId, appt, force);
      }
    } catch (err) {
      console.error('[EvolutionMonitor] Error in checkDailyMissingEvolutions:', err);
    }
  },

  /**
   * Creates notifications and pending items for a missing evolution, ensuring no duplicates.
   */
  async createMissingEvolutionAlert(clinicId: string, appointment: any): Promise<void> {
    try {
      const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
      // Avoid duplicates
      const notifRef = collection(db, 'clinics', clinicId, 'notifications');
      const qNotif = query(
        notifRef, 
        where('appointmentId', '==', appointment.id), 
        where('type', '==', 'missing_clinical_evolution'), 
        where('status', '==', 'pending'),
        limit(1)
      );
      const snapNotif = await getDocs(qNotif);

      if (!snapNotif.empty) {
        // Notification already exists, skip creating another
        return;
      }

      if (isDebugActive) {
        console.log(`[EvolutionMonitor] Generating clinical evolution pending alerts for patient ${appointment.patientName}`);
      }

      const professionalName = appointment.staffName || 'Profissional';
      const patientName = appointment.patientName || 'Paciente';

      // 1. Create notification
      await addDoc(collection(db, 'clinics', clinicId, 'notifications'), {
        type: "missing_clinical_evolution",
        title: "Evolução clínica pendente",
        message: `O atendimento de ${patientName} com ${professionalName} foi finalizado, mas nenhuma evolução clínica foi registrada.`,
        patientId: appointment.patientId,
        patientName: patientName,
        appointmentId: appointment.id,
        professionalId: appointment.staffId || '',
        professionalName: professionalName,
        date: appointment.date,
        time: appointment.time || '',
        severity: "high",
        status: "pending",
        targetRoles: ["owner", "admin", "manager", "secretary", "recepcao"],
        createdAt: new Date().toISOString(),
        createdBySystem: true
       });

      // 2. Create pending_item
      await addDoc(collection(db, 'clinics', clinicId, 'pending_items'), {
        type: "missing_clinical_evolution",
        patientId: appointment.patientId,
        patientName: patientName,
        appointmentId: appointment.id,
        professionalId: appointment.staffId || '',
        professionalName: professionalName,
        dueDate: appointment.date,
        status: "pending",
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[EvolutionMonitor] Error in createMissingEvolutionAlert:', err);
    }
  },

  /**
   * Resolves notification alerts and pending items when an evolution is registered.
   */
  async resolveMissingEvolutionAlert(clinicId: string, appointmentId: string, patientId: string, date: string): Promise<void> {
    try {
      const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
      if (isDebugActive) {
        console.log(`[EvolutionMonitor] Resolving missing evolution alerts for appointment ${appointmentId}`);
      }

      // 1. Resolve notifications from clinics/{id}/notifications
      const notifRef = collection(db, 'clinics', clinicId, 'notifications');
      
      // Query notifications matching appointmentId OR patientId+date
      const qNotifByAppt = query(notifRef, where('appointmentId', '==', appointmentId), where('status', '==', 'pending'));
      const notifSnapByAppt = await getDocs(qNotifByAppt);
      
      for (const docSnap of notifSnapByAppt.docs) {
        await updateDoc(doc(db, 'clinics', clinicId, 'notifications', docSnap.id), {
          status: 'resolved',
          resolvedAt: new Date().toISOString()
        });
      }

      const qNotifByDate = query(notifRef, where('patientId', '==', patientId), where('date', '==', date), where('type', '==', 'missing_clinical_evolution'), where('status', '==', 'pending'));
      const notifSnapByDate = await getDocs(qNotifByDate);

      for (const docSnap of notifSnapByDate.docs) {
        await updateDoc(doc(db, 'clinics', clinicId, 'notifications', docSnap.id), {
          status: 'resolved',
          resolvedAt: new Date().toISOString()
        });
      }

      // 2. Resolve clinics/{id}/pending_items
      const pendingRef = collection(db, 'clinics', clinicId, 'pending_items');
      
      const qPendingByAppt = query(pendingRef, where('appointmentId', '==', appointmentId), where('status', '==', 'pending'));
      const pendingSnapByAppt = await getDocs(qPendingByAppt);

      for (const docSnap of pendingSnapByAppt.docs) {
        await updateDoc(doc(db, 'clinics', clinicId, 'pending_items', docSnap.id), {
          status: 'resolved',
          resolvedAt: new Date().toISOString()
        });
      }

      const qPendingByDate = query(pendingRef, where('patientId', '==', patientId), where('dueDate', '==', date), where('type', '==', 'missing_clinical_evolution'), where('status', '==', 'pending'));
      const pendingSnapByDate = await getDocs(qPendingByDate);

      for (const docSnap of pendingSnapByDate.docs) {
        await updateDoc(doc(db, 'clinics', clinicId, 'pending_items', docSnap.id), {
          status: 'resolved',
          resolvedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('[EvolutionMonitor] Error in resolveMissingEvolutionAlert:', err);
    }
  },

  /**
   * Resolves all pending alerts for a given patient.
   */
  async resolveEvolutionsForPatient(clinicId: string, patientId: string): Promise<void> {
    try {
      const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
      if (isDebugActive) {
        console.log(`[EvolutionMonitor] Resolving all missing evolution alerts for patient ${patientId}`);
      }

      const notifRef = collection(db, 'clinics', clinicId, 'notifications');
      const qNotif = query(notifRef, where('patientId', '==', patientId), where('status', '==', 'pending'), where('type', '==', 'missing_clinical_evolution'));
      const snapNotif = await getDocs(qNotif);
      
      const evolutionsColRef = collection(db, 'clinics', clinicId, 'patients', patientId, 'evolutions');

      for (const docSnap of snapNotif.docs) {
        const notif = docSnap.data();
        
        // Let's create an evolution record in the subcollection so the sweep won't recreate the alert!
        try {
          await addDoc(evolutionsColRef, {
            appointmentId: notif.appointmentId || '',
            patientId: patientId,
            patientName: notif.patientName || '',
            professionalId: notif.professionalId || '',
            professionalName: notif.professionalName || '',
            date: notif.date || '',
            description: "Evolução clínica registrada na ficha do paciente",
            createdAt: new Date().toISOString(),
            createdBy: "Sistema (Auto)"
          });
        } catch (eErr) {
          console.error("[EvolutionMonitor] Error adding shadow evolution record:", eErr);
        }

        // Resolve notification
        await updateDoc(doc(db, 'clinics', clinicId, 'notifications', docSnap.id), {
          status: 'resolved',
          resolvedAt: new Date().toISOString()
        });
      }

      const pendingRef = collection(db, 'clinics', clinicId, 'pending_items');
      const qPending = query(pendingRef, where('patientId', '==', patientId), where('status', '==', 'pending'), where('type', '==', 'missing_clinical_evolution'));
      const snapPending = await getDocs(qPending);
      for (const docSnap of snapPending.docs) {
        await updateDoc(doc(db, 'clinics', clinicId, 'pending_items', docSnap.id), {
          status: 'resolved',
          resolvedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('[EvolutionMonitor] Error in resolveEvolutionsForPatient:', err);
    }
  },

  /**
   * Resolves a pending evolution alert by task ID of the pending item.
   */
  async resolveSpecificPendingItem(clinicId: string, taskId: string): Promise<void> {
    try {
      const pendingDocRef = doc(db, 'clinics', clinicId, 'pending_items', taskId);
      const pendingSnap = await getDoc(pendingDocRef);
      
      if (pendingSnap.exists()) {
        const item = pendingSnap.data();
        
        if (item.type === 'missing_clinical_evolution') {
          const patientId = item.patientId;
          const apptId = item.appointmentId || '';
          const date = item.dueDate || '';

          // Add shadow evolution record in the patient's subcollection
          if (patientId) {
            const evolutionsColRef = collection(db, 'clinics', clinicId, 'patients', patientId, 'evolutions');
            try {
              await addDoc(evolutionsColRef, {
                appointmentId: apptId,
                patientId: patientId,
                patientName: item.patientName || '',
                professionalId: item.professionalId || '',
                professionalName: item.professionalName || '',
                date: date,
                description: "Evolução clínica registrada via tarefas pendentes",
                createdAt: new Date().toISOString(),
                createdBy: "Sistema (Auto via Tarefas)"
              });
            } catch (eErr) {
              console.error("[EvolutionMonitor] Error adding shadow record on specific task resolve:", eErr);
            }

            // Also resolve any associated notifications for this specific appointment/patient
            const notifRef = collection(db, 'clinics', clinicId, 'notifications');
            const qNotif = query(
              notifRef, 
              where('patientId', '==', patientId), 
              where('appointmentId', '==', apptId), 
              where('status', '==', 'pending')
            );
            const snapNotif = await getDocs(qNotif);
            for (const docSnap of snapNotif.docs) {
              await updateDoc(doc(db, 'clinics', clinicId, 'notifications', docSnap.id), {
                status: 'resolved',
                resolvedAt: new Date().toISOString()
              });
            }
          }
        }
      }

      await updateDoc(pendingDocRef, {
        status: 'resolved',
        resolvedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[EvolutionMonitor] Error in resolveSpecificPendingItem:', err);
    }
  }
};
