import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

/**
 * ELIZA Intelligence — structured event history.
 *
 * Several fields in this app are mutable and get silently overwritten on
 * every edit (`appointments.status`/`updatedAt`, `quotations.status`), so
 * there is no way to reconstruct WHEN a status actually changed just from
 * the current document. This collection is the fix, going forward only: a
 * small, append-only log of the transitions that matter for temporal
 * analysis. It intentionally does NOT duplicate what's already reliable
 * (e.g. `appointments.createdAt`, `quotations.createdAt`, `pending_items
 * .createdAt` for non-Portal items already tell us "when created" — no
 * event needed for those).
 */
export type StatusEventType =
  | 'appointment_status_changed'
  | 'appointment_rescheduled'
  | 'quotation_status_changed'
  | 'pending_item_created' // written server-side only (server.ts's createPortalPendingItem), for Portal-origin items
  | 'pending_item_resolved'
  | 'pending_item_converted'
  | 'financial_entry_status_changed';

export interface StatusEventInput {
  entityType: 'appointment' | 'quotation' | 'pending_item' | 'financial_entry';
  entityId: string;
  eventType: StatusEventType;
  patientId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  professionalId?: string | null;
  professionalName?: string | null;
  metadata?: Record<string, any>;
}

// Best-effort, non-fatal: logging history must never block or fail the
// real write it's describing.
export async function logStatusEvent(clinicId: string, input: StatusEventInput, uid?: string | null): Promise<void> {
  try {
    await addDoc(collection(db, 'clinics', clinicId, 'status_events'), {
      ...input,
      patientId: input.patientId ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      professionalId: input.professionalId ?? null,
      professionalName: input.professionalName ?? null,
      metadata: input.metadata ?? null,
      createdBy: uid || null,
      occurredAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[statusEvents] Failed to log event (non-fatal):', err);
  }
}
