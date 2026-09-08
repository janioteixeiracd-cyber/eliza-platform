import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';

interface ScreenContext {
  tabLabel: string;
  summary: string;
  patientId?: string | null;
}

export interface PortalNotification {
  id: string;
  patientId: string | null;
  patientName: string;
  title: string;
  description: string;
  type: string;
  createdAt: any;
  /** Present only for 'eliza_cognitive_gap' items — lets NextElizaAssistant
   *  route the professional's next reply into propose_clinical_evolution
   *  instead of the generic /api/eliza/ask. */
  cognitiveType?: string;
  appointmentId?: string | null;
  /** Só presente nos "standing gaps" (overdue_financial_risk,
   *  stale_open_budgets, recall_backlog, operational_pending_backlog) —
   *  o Insight completo que motivou a promoção (ver
   *  src/lib/elizaCore/insightGapBridge.ts), pra NextElizaAssistant
   *  renderizar via InsightCard sem re-buscar nada. */
  insightSnapshot?: any;
}

// A clinical proposal (propose_clinical_evolution) that was already
// "pending" — the professional answered ELIZA and got a preview, but never
// clicked Confirmar/Cancelar — recovered after a reload. Deliberately a
// single value, not a list: activeGapContext in NextElizaAssistant is
// singular too, so rehydrating more than one at once would make "which gap
// does my next typed reply belong to" ambiguous. See the fetch effect below
// for how the one shown is chosen.
export interface PendingClinicalProposal {
  proposalId: string;
  gapId: string;
  appointmentId: string;
  patientId: string | null;
  preview: { summary: string; details: Record<string, any> };
}

interface ElizaAssistantContextValue {
  screenContext: ScreenContext;
  setScreenContext: (tabLabel: string, summary: string, patientId?: string | null) => void;
  portalNotifications: PortalNotification[];
  consumePortalNotification: (id: string) => void;
  pendingClinicalProposal: PendingClinicalProposal | null;
  consumePendingClinicalProposal: () => void;
}

const ElizaAssistantContext = createContext<ElizaAssistantContextValue | null>(null);

export function ElizaAssistantProvider({ children }: { children: React.ReactNode }) {
  const { clinic } = useAuth();
  const [screenContext, setScreenContextState] = useState<ScreenContext>({ tabLabel: '', summary: '', patientId: null });
  // Avoid redundant re-renders when a tab's effect re-fires with the same summary.
  const lastRef = useRef<string>('');

  const setScreenContext = useCallback((tabLabel: string, summary: string, patientId?: string | null) => {
    const key = `${tabLabel}::${summary}::${patientId || ''}`;
    if (lastRef.current === key) return;
    lastRef.current = key;
    setScreenContextState({ tabLabel, summary, patientId: patientId || null });
  }, []);

  const [portalNotifications, setPortalNotifications] = useState<PortalNotification[]>([]);

  // Live trigger for the floating assistant: watches for NEW pending_items
  // created by the Patient Portal (server.ts's /api/patient-portal/requests/*
  // and /anamnesis routes, which all write source: 'Portal do Paciente').
  // The first snapshot batch is skipped on purpose — otherwise every item
  // that already existed before this tab was opened would "pop" the
  // assistant open on load, which isn't what "chegar uma solicitação nova"
  // means. Only genuinely new arrivals while the app is open trigger it.
  useEffect(() => {
    if (!clinic?.id) { setPortalNotifications([]); return; }
    const isInitialLoad = { current: true };
    const q = query(
      collection(db, 'clinics', clinic.id, 'pending_items'),
      where('source', '==', 'Portal do Paciente'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (isInitialLoad.current) {
        isInitialLoad.current = false;
        return;
      }
      const added = snap.docChanges().filter((c) => c.type === 'added');
      if (added.length === 0) return;
      const newOnes: PortalNotification[] = added.map((c) => {
        const data = c.doc.data() as any;
        return {
          id: c.doc.id,
          patientId: data.patientId || null,
          patientName: data.patientName || 'Paciente',
          title: data.title || '',
          description: data.description || '',
          type: data.type || '',
          createdAt: data.createdAt || null,
        };
      });
      setPortalNotifications((prev) => [...newOnes, ...prev]);
    }, (err) => {
      console.error('[ELIZA_ASSISTANT] Failed to watch Portal do Paciente notifications:', err);
    });
    return () => unsub();
  }, [clinic?.id]);

  // Same "one Consciência, one bubble" mechanism generalized to a second
  // real source: cognitive gaps ELIZA detects on its own (today: an
  // appointment finalized without a matching evolution/execution — see
  // src/lib/elizaCore/cognitiveEvents.ts). Filtering by status=='pending'
  // means a gap that gets resolved (professional answered and the
  // proposal was executed, or the detector self-corrected) is dropped from
  // the live query automatically — it can never "pop" again for the same
  // event. Same skip-first-batch guard as above, same target array, same
  // consumption in NextElizaAssistant.tsx — this is not a second assistant.
  useEffect(() => {
    if (!clinic?.id) return;
    const isInitialLoad = { current: true };
    const q = query(
      collection(db, 'clinics', clinic.id, 'pending_items'),
      where('type', '==', 'eliza_cognitive_gap'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (isInitialLoad.current) {
        isInitialLoad.current = false;
        return;
      }
      const added = snap.docChanges().filter((c) => c.type === 'added');
      if (added.length === 0) return;
      const newOnes: PortalNotification[] = added.map((c) => {
        const data = c.doc.data() as any;
        return {
          id: c.doc.id,
          patientId: data.patientId || null,
          patientName: data.patientName || 'Paciente',
          title: data.title || '',
          description: data.description || '',
          type: data.type || 'eliza_cognitive_gap',
          cognitiveType: data.cognitiveType || null,
          appointmentId: data.appointmentId || null,
          insightSnapshot: data.insightSnapshot || null,
          createdAt: data.createdAt || null,
        };
      });
      setPortalNotifications((prev) => [...newOnes, ...prev]);
    }, (err) => {
      console.error('[ELIZA_ASSISTANT] Failed to watch cognitive gaps:', err);
    });
    return () => unsub();
  }, [clinic?.id]);

  const consumePortalNotification = useCallback((id: string) => {
    setPortalNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Achado B3-R fix: a pending proposal only ever lived in NextElizaAssistant's
  // React state, so a reload silently orphaned it — still sitting in
  // Firestore, `pending`, with nothing on screen to act on it. This runs
  // ONCE per clinic load (getDocs, not a live listener — we don't want an
  // already-open conversation to be clobbered later by this firing again),
  // fetches candidate propose_clinical_evolution proposals still pending,
  // and picks the single most recent one by createdAt. Equality-only filters
  // (no orderBy) on purpose — avoids requiring a new composite Firestore
  // index just for this recovery path; sorting the (small) result client-side
  // is cheap and simpler to operate.
  const [pendingClinicalProposal, setPendingClinicalProposal] = useState<PendingClinicalProposal | null>(null);
  useEffect(() => {
    if (!clinic?.id) { setPendingClinicalProposal(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'clinics', clinic.id, 'action_proposals'),
          where('actionType', '==', 'propose_clinical_evolution'),
          where('status', '==', 'pending'),
          limit(10)
        );
        const snap = await getDocs(q);
        if (cancelled || snap.empty) return;
        let best: { id: string; data: any; createdAtMs: number } | null = null;
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const ms = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;
          if (!best || ms > best.createdAtMs) best = { id: d.id, data, createdAtMs: ms };
        });
        if (!best) return;
        const gapId = best.data.executionInput?.gapId;
        const appointmentId = best.data.executionInput?.appointmentId;
        if (!gapId || !appointmentId) return; // malformed/legacy doc — nothing safe to rehydrate
        setPendingClinicalProposal({
          proposalId: best.id,
          gapId,
          appointmentId,
          patientId: best.data.executionInput?.patientId || null,
          preview: best.data.preview,
        });
      } catch (err) {
        console.error('[ELIZA_ASSISTANT] Failed to check for a pending clinical proposal to recover:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [clinic?.id]);

  const consumePendingClinicalProposal = useCallback(() => {
    setPendingClinicalProposal(null);
  }, []);

  return (
    <ElizaAssistantContext.Provider value={{ screenContext, setScreenContext, portalNotifications, consumePortalNotification, pendingClinicalProposal, consumePendingClinicalProposal }}>
      {children}
    </ElizaAssistantContext.Provider>
  );
}

// Called by each tab to publish a real, current-data summary of what's on
// screen right now — this is what lets the floating assistant answer
// without the user having to re-explain context. Pass '' to clear when the
// tab unmounts data (e.g. leaving a patient record).
export function useSetElizaScreenContext(tabLabel: string, summary: string, patientId?: string | null) {
  const ctx = useContext(ElizaAssistantContext);
  React.useEffect(() => {
    if (ctx) ctx.setScreenContext(tabLabel, summary, patientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabLabel, summary, patientId]);
}

export function useElizaAssistantContext() {
  const ctx = useContext(ElizaAssistantContext);
  if (!ctx) throw new Error('useElizaAssistantContext must be used within ElizaAssistantProvider');
  return ctx;
}
