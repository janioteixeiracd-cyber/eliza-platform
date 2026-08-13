import { db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
} from "firebase/firestore";

/**
 * Handles the creation or resolution of planning notifications.
 */
async function managePlanningNotification(
  clinicId: string,
  appointmentId: string,
  appointmentData: any,
  planningStatus: "pending" | "planned" | "cancelled"
) {
  try {
    const notifRef = collection(db, "clinics", clinicId, "notifications");

    if (planningStatus === "pending") {
      const qNotif = query(
        notifRef,
        where("appointmentId", "==", appointmentId),
        where("type", "==", "planning_required"),
        where("read", "==", false),
        limit(1)
      );
      const snapNotif = await getDocs(qNotif);

      if (snapNotif.empty) {
        const staffId = appointmentData.staffId || appointmentData.professionalId || "";
        const staffName = appointmentData.staffName || appointmentData.professionalName || "Profissional";
        const patientName = appointmentData.patientName || "Paciente";

        await addDoc(notifRef, {
          title: "Planejamento Necessário",
          message: `O paciente ${patientName} agendado para ${appointmentData.date || ""} às ${appointmentData.time || ""} necessita de planejamento cirúrgico/clínico no sistema.`,
          type: "planning_required",
          read: false,
          userId: staffId,
          appointmentId,
          patientId: appointmentData.patientId || "",
          patientName,
          date: appointmentData.date || "",
          time: appointmentData.time || "",
          severity: "medium",
          link: "planning",
          createdAt: serverTimestamp(),
        });
        console.log(`[PlanningSync] Created pending planning notification for staff ${staffId}`);
      }
    } else {
      // Resolve/read existing planning notifications for this appointment
      const qNotif = query(
        notifRef,
        where("appointmentId", "==", appointmentId),
        where("type", "==", "planning_required")
      );
      const snapNotif = await getDocs(qNotif);
      for (const d of snapNotif.docs) {
        if (!d.data().read) {
          await updateDoc(doc(db, "clinics", clinicId, "notifications", d.id), {
            read: true,
            status: "resolved",
            resolvedAt: serverTimestamp(),
          });
        }
      }
      console.log(`[PlanningSync] Resolved pending planning notifications for appointment ${appointmentId}`);
    }
  } catch (err) {
    console.error("[PlanningSync] Error managing planning notification:", err);
  }
}

/**
 * Synchronizes an appointment with its associated planned procedure.
 * Adheres strictly to the user requirements for tracking status,
 * avoiding duplicates, handling cancellations and rescheduling cleanly.
 */
export async function syncAppointmentToPlanning(
  clinicId: string,
  appointmentId: string,
  appointmentData: any,
  deleteMode = false
) {
  if (!clinicId || !appointmentId) return;

  try {
    const plannedRef = collection(db, "clinics", clinicId, "planned_procedures");
    const q = query(plannedRef, where("appointmentId", "==", appointmentId));
    const snap = await getDocs(q);

    let patientPhone = "";
    if (appointmentData.patientId) {
      try {
        const pSnap = await getDocs(
          query(
            collection(db, "clinics", clinicId, "patients"),
            where("__name__", "==", appointmentData.patientId)
          )
        );
        if (!pSnap.empty) {
          const pd = pSnap.docs[0].data();
          patientPhone = pd.phone || pd.telefone || pd.whatsapp || pd.cellphone || pd.celular || "";
        }
      } catch (e) {
        console.warn("[PlanningSync] Could not fetch patient phone:", e);
      }
    }
    
    if (!patientPhone && appointmentData.phoneNumber) {
      patientPhone = appointmentData.phoneNumber;
    }
    if (!patientPhone && appointmentData.phone) {
      patientPhone = appointmentData.phone;
    }
    if (!patientPhone && appointmentData.whatsapp) {
      patientPhone = appointmentData.whatsapp;
    }

    const procedureSelected = !!appointmentData.procedure && appointmentData.procedure.trim() !== "" && appointmentData.procedure !== "Não planejado";
    
    let planningStatus: "pending" | "planned" | "cancelled" = "pending";
    if (deleteMode || appointmentData.status === "cancelado" || appointmentData.status === "cancelled") {
      planningStatus = "cancelled";
    } else if (procedureSelected) {
      planningStatus = "planned";
    } else {
      planningStatus = "pending";
    }

    // Determine values
    const payload: any = {
      appointmentId,
      patientId: appointmentData.patientId || "manual-" + Date.now(),
      patientName: appointmentData.patientName || "Paciente sem nome",
      patientPhone: patientPhone || "",
      professionalId: appointmentData.staffId || appointmentData.professionalId || "not-assigned",
      professionalName: appointmentData.staffName || appointmentData.professionalName || "Não atribuído",
      date: appointmentData.date || "",
      time: appointmentData.time || "",
      duration: Number(appointmentData.duration) || 30,
      chair: appointmentData.chair || "Cadeira 1",
      appointmentStatus: deleteMode ? "cancelled" : appointmentData.status || "pendente",
      planningStatus,
      procedureName: procedureSelected ? appointmentData.procedure : "Não planejado",
      procedureCategory: appointmentData.procedureCategory || "Outro",
      notes: appointmentData.observations || appointmentData.notes || "",
      updatedAt: serverTimestamp(),
    };

    if (snap.empty) {
      // If we are deleting the appointment, no need to create a new cancelled document if none existed
      if (deleteMode) return;

      payload.createdAt = serverTimestamp();
      payload.expectedValue = appointmentData.expectedValue || 0;
      payload.expectedPaymentMethod = appointmentData.expectedPaymentMethod || "Pix";
      payload.materialList = appointmentData.materialList || [];
      payload.status = "Planejado";
      
      await addDoc(plannedRef, payload);
      console.log(`[PlanningSync] Created planning procedure for appointment ${appointmentId}`);
    } else {
      const docId = snap.docs[0].id;
      const existingData = snap.docs[0].data();
      
      // Preserve tracking fields from manually edited procedure if they already exist
      const updatePayload = {
        ...payload,
        status: existingData.status || "Planejado",
        expectedValue: existingData.expectedValue || payload.expectedValue || 0,
        expectedPaymentMethod: existingData.expectedPaymentMethod || payload.expectedPaymentMethod || "Pix",
        materialList: existingData.materialList || payload.materialList || [],
      };

      // If procedure is updated to something specific in edit form
      if (procedureSelected && updatePayload.procedureName && (!existingData.procedureName || existingData.procedureName === "Não planejado")) {
        updatePayload.procedureName = appointmentData.procedure;
      }

      await updateDoc(doc(db, "clinics", clinicId, "planned_procedures", docId), updatePayload);
      console.log(`[PlanningSync] Updated planning procedure ${docId} for appointment ${appointmentId}`);
    }

    // Handle notifications asynchronously
    await managePlanningNotification(clinicId, appointmentId, appointmentData, planningStatus);
  } catch (err) {
    console.error("[PlanningSync] Error syncing appointment to planning:", err);
  }
}
