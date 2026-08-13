import { collection, getDocs, doc, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { normalizeLocalDate, normalizeFinancialEntry } from '../utils/financialHelpers';

export interface DashboardParams {
  clinicId: string;
  mode: 'payment' | 'due';
  period: 'today' | 'week' | 'month' | 'year' | 'custom';
  customRange?: { start: string; end: string };
}

export interface NormalizedTransaction {
  id: string;
  description: string;
  category: string;
  subcategory: string;
  title: string;
  amount: number; // maps to totalAmount for backwards compatibility
  paidAmount: number;
  pendingAmount: number;
  type: 'income' | 'expense';
  status: 'paid' | 'pending' | 'partial' | 'cancelled';
  date: Date; // general parsed date or creation date
  dueDate: Date;
  paymentDate: Date | null;
  paymentMethod: string;
  patientId: string | null;
  patientName: string | null;
  source: 'manual' | 'quotation' | 'imported' | 'system' | 'legacy';
  quotationId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  archived: boolean;
  raw: any;
}

export interface PeriodStats {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  pendingIncome: number;
}

export interface DashboardData {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  pendingIncome: number;
  unlinkedTotal: number;
  filteredTransactions: NormalizedTransaction[];
  todayStats: PeriodStats;
  monthStats: PeriodStats;
  yearStats: PeriodStats;
  diagnostics: {
    totalLoadedEntries: number;
    countPaid: number;
    countPending: number;
    countPartial: number;
    countCancelled: number;
    sumPaidAmount: number;
    sumPendingAmount: number;
    countLegacy: number;
    countMissingPatientId: number;
    countMissingStatus: number;
    detectedFields: string[];
    rawDocSampleKeys: string[];
  };
}

/**
 * Audit log helper to register financial changes.
 */
export async function saveFinancialLog(
  clinicId: string,
  user: { uid: string; email?: string; name?: string } | null,
  action: 'create' | 'update' | 'delete' | 'repair' | 'receive',
  entityId: string,
  before: any,
  after: any
) {
  try {
    const logsRef = collection(db, 'clinics', clinicId, 'financial_logs');
    await addDocToCollection(logsRef, {
      userId: user?.uid || 'system',
      userEmail: user?.email || 'system',
      userName: user?.name || 'Sistema',
      action,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("[SAVE_FINANCIAL_LOG_ERROR]", err);
  }
}

// Low-level helper to avoid Firestore permissions errors while appending
async function addDocToCollection(ref: any, data: any) {
  try {
    const { addDoc } = await import('firebase/firestore');
    await addDoc(ref, data);
  } catch (e) {
    console.error("[addDocToCollection_FAIL]", e);
  }
}

/**
 * Calculates start and end timestamps in America/Sao_Paulo timezone local equivalents.
 */
export function getLocalDateBounds(
  period: 'today' | 'week' | 'month' | 'year' | 'custom',
  customRange?: { start: string; end: string }
): { start: Date; end: Date } {
  // We use current time in America/Sao_Paulo
  const nowInSaoPaulo = normalizeLocalDate(new Date());
  const year = nowInSaoPaulo.getFullYear();
  const month = nowInSaoPaulo.getMonth();
  const day = nowInSaoPaulo.getDate();

  let start = new Date(year, month, day, 0, 0, 0, 0);
  let end = new Date(year, month, day, 23, 59, 59, 999);

  if (period === 'week') {
    // Sunday 00:00 to Saturday 23:59 local
    const dayOfWeek = nowInSaoPaulo.getDay(); // 0 is Sunday, 6 is Saturday
    start = new Date(year, month, day - dayOfWeek, 0, 0, 0, 0);
    end = new Date(year, month, day + (6 - dayOfWeek), 23, 59, 59, 999);
  } else if (period === 'month') {
    // 1st day of current month to last day of current month
    start = new Date(year, month, 1, 0, 0, 0, 0);
    end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  } else if (period === 'year') {
    // Jan 1st to Dec 31st
    start = new Date(year, 0, 1, 0, 0, 0, 0);
    end = new Date(year, 11, 31, 23, 59, 59, 999);
  } else if (period === 'custom' && customRange) {
    if (customRange.start) {
      const [y, m, d] = customRange.start.split('-').map(Number);
      start = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      start = new Date(0); // Epoch beginning
    }
    if (customRange.end) {
      const [y, m, d] = customRange.end.split('-').map(Number);
      end = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      end = new Date(year, month, day, 23, 59, 59, 999);
    }
  }

  return { start, end };
}

export async function getFinancialDashboardData({
  clinicId,
  mode,
  period,
  customRange
}: DashboardParams): Promise<DashboardData> {
  console.log("[FINANCE_ERP] Calculating stats", { clinicId, mode, period, customRange });

  // 1. Fetch from clinics/{clinicId}/financial_entries AND clinics/{clinicId}/clinic_payables
  const entriesRef = collection(db, 'clinics', clinicId, 'financial_entries');
  const payablesRef = collection(db, 'clinics', clinicId, 'clinic_payables');
  
  const [snap, snapPayables] = await Promise.all([
    getDocs(entriesRef).catch(err => {
      console.warn("[FINANCE_ERP] Failed to fetch financial_entries:", err);
      return { docs: [] };
    }),
    getDocs(payablesRef).catch(err => {
      console.warn("[FINANCE_ERP] Failed to fetch clinic_payables:", err);
      return { docs: [] };
    })
  ]);

  const rawDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const rawPayables = (snapPayables?.docs || []).map(doc => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      description: data.description || "Despesa de Contas a Pagar",
      amount: Number(data.amount || 0),
      value: Number(data.amount || 0),
      category: data.category || "Materiais",
      type: "expense",
      status: data.status === "paid" ? "pago" : (data.status === "open" ? "pendente" : (data.status === "canceled" ? "cancelado" : "pendente")),
      dueDate: data.due_date || null,
      due_date: data.due_date || null,
      paidAmount: data.status === "paid" ? Number(data.amount || 0) : 0,
      paid_amount: data.status === "paid" ? Number(data.amount || 0) : 0,
      paidAt: data.paid_at || null,
      paymentDate: data.paid_at || null,
      payment_date: data.paid_at || null,
      source: "payables",
      ...data
    };
  });

  const combinedRawDocs = [...rawDocs, ...rawPayables];

  // 2. Normalize entries using standard helper
  const allUniqueFields = new Set<string>();
  let countLegacy = 0;
  let countMissingPatientId = 0;
  let countMissingStatus = 0;
  let countPaid = 0;
  let countPending = 0;
  let countPartial = 0;
  let countCancelled = 0;
  let sumPaidAmount = 0;
  let sumPendingAmount = 0;

  const normalizedList: NormalizedTransaction[] = combinedRawDocs.map(docRaw => {
    // Track unique keys configuration for diagnosis
    Object.keys(docRaw).forEach(k => allUniqueFields.add(k));

    const norm = normalizeFinancialEntry(docRaw);

    // Diagnostics stats computation
    if (norm.source === 'legacy') countLegacy++;
    if (!norm.patientId) countMissingPatientId++;
    if (!docRaw.status) countMissingStatus++;

    if (norm.archived === false) {
      if (norm.status === 'paid') {
        countPaid++;
        sumPaidAmount += norm.paidAmount;
      } else if (norm.status === 'pending') {
        countPending++;
        sumPendingAmount += norm.pendingAmount;
      } else if (norm.status === 'partial') {
        countPartial++;
        sumPaidAmount += norm.paidAmount;
        sumPendingAmount += norm.pendingAmount;
      } else if (norm.status === 'cancelled') {
        countCancelled++;
      }
    }

    return {
      id: norm.id,
      description: norm.description,
      category: norm.category,
      subcategory: norm.subcategory,
      title: norm.title,
      amount: norm.totalAmount, // Map to totalAmount for downstream backwards compatibility
      paidAmount: norm.paidAmount,
      pendingAmount: norm.pendingAmount,
      type: norm.type,
      status: norm.status,
      date: normalizeLocalDate(norm.createdAt || norm.dueDate || new Date()),
      dueDate: normalizeLocalDate(norm.dueDate),
      paymentDate: norm.paidAt ? normalizeLocalDate(norm.paidAt) : null,
      paymentMethod: norm.paymentMethod,
      patientId: norm.patientId,
      patientName: norm.patientName,
      source: norm.source,
      quotationId: norm.quotationId,
      installmentNumber: norm.installmentNumber,
      totalInstallments: norm.totalInstallments,
      archived: norm.archived,
      raw: docRaw // reference to raw Firestore document
    };
  });

  const sampleDocKeys = rawDocs.length > 0 ? Object.keys(rawDocs[0]) : [];

  // 3. Resolve filtered transactions
  const bounds = getLocalDateBounds(period, customRange);

  const getTargetDate = (t: NormalizedTransaction, dateMode: 'payment' | 'due') => {
    if (dateMode === 'due') {
      return t.dueDate;
    }
    // Mode 'payment': use paymentDate if paid/partial; fallback to dueDate if pending
    if ((t.status === 'paid' || t.status === 'partial') && t.paymentDate) {
      return t.paymentDate;
    }
    return t.dueDate;
  };

  const filteredTransactions = normalizedList.filter(t => {
    if (t.archived) return false;
    const targetDate = getTargetDate(t, mode);
    return targetDate >= bounds.start && targetDate <= bounds.end;
  });

  // Calculate stats for general periods using accurate bounds
  const getStatsForRange = (start: Date, end: Date): PeriodStats => {
    const rangeList = normalizedList.filter(t => {
      if (t.archived) return false;
      const targetDate = getTargetDate(t, mode);
      return targetDate >= start && targetDate <= end;
    });

    // Rule 6: sum of paidAmount where type == income/expense
    const totalIncome = rangeList
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.paidAmount, 0);

    const totalExpense = rangeList
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.paidAmount, 0);

    // Rule 6: sum of pendingAmount where type == income (unpaid)
    const pendingIncome = rangeList
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.pendingAmount, 0);

    return {
      balance: totalIncome - totalExpense,
      totalIncome,
      totalExpense,
      pendingIncome
    };
  };

  // Pre-calculate stats for Today, Month, Year widgets
  const todayBounds = getLocalDateBounds('today');
  const monthBounds = getLocalDateBounds('month');
  const yearBounds = getLocalDateBounds('year');

  const todayStats = getStatsForRange(todayBounds.start, todayBounds.end);
  const monthStats = getStatsForRange(monthBounds.start, monthBounds.end);
  const yearStats = getStatsForRange(yearBounds.start, yearBounds.end);

  // Active filter state calculations
  const activeStats = getStatsForRange(bounds.start, bounds.end);

  // Unlinked incomes count (receitas sem paciente cadastrado)
  const unlinkedTotal = filteredTransactions
    .filter(t => t.type === 'income' && !t.patientId)
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    balance: activeStats.balance,
    totalIncome: activeStats.totalIncome,
    totalExpense: activeStats.totalExpense,
    pendingIncome: activeStats.pendingIncome,
    unlinkedTotal,
    filteredTransactions,
    todayStats,
    monthStats,
    yearStats,
    diagnostics: {
      totalLoadedEntries: rawDocs.length,
      countPaid,
      countPending,
      countPartial,
      countCancelled,
      sumPaidAmount,
      sumPendingAmount,
      countLegacy,
      countMissingPatientId,
      countMissingStatus,
      detectedFields: Array.from(allUniqueFields),
      rawDocSampleKeys: sampleDocKeys
    }
  };
}

/**
 * Normalizes old fields, solves duplicates, recalculates status & margins, and archives broken entries.
 */
export async function repairFinancialDatabase(
  clinicId: string,
  currentUser: { uid: string; email?: string; name?: string } | null
): Promise<{ repairedCount: number; archivedCount: number; duplicatesRemoved: number }> {
  console.log("[FINANCE_ERP] Launching repairFinancialDatabase repair stream.");

  const entriesRef = collection(db, 'clinics', clinicId, 'financial_entries');
  const snap = await getDocs(entriesRef);
  const rawDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  let repairedCount = 0;
  let archivedCount = 0;
  let duplicatesRemoved = 0;

  const batch = writeBatch(db);

  // Find duplicates by patientId, quotationId, installmentNumber, totalAmount
  const groups: Record<string, any[]> = {};
  
  rawDocs.forEach(doc => {
    // Skip already archived
    if (doc.archived) return;

    const patientId = doc.patientId || doc.patient_id;
    const qId = doc.quotationId || doc.quotation_id;
    const instNum = doc.installmentNumber || doc.installment_number;
    
    // Normalize total amount
    const totalAmount = doc.totalAmount !== undefined ? doc.totalAmount : (doc.amount !== undefined ? doc.amount : doc.value || 0);

    if (patientId && qId && instNum && totalAmount > 0) {
      const key = `${patientId}_${qId}_${instNum}_${Number(totalAmount).toFixed(2)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(doc);
    }
  });

  // Unique document IDs to delete/archive as duplicates
  const markedAsDuplicateIds = new Set<string>();

  Object.entries(groups).forEach(([key, list]) => {
    if (list.length > 1) {
      // Sort: best entry is paid and has paymentMethod, latest updated
      const sorted = [...list].sort((a, b) => {
        const aStatus = String(a.status || '').toLowerCase().trim();
        const bStatus = String(b.status || '').toLowerCase().trim();
        const aIsPaid = aStatus === 'paid' || aStatus === 'pago';
        const bIsPaid = bStatus === 'paid' || bStatus === 'pago';

        if (aIsPaid && !bIsPaid) return -1;
        if (!aIsPaid && bIsPaid) return 1;

        const aHasMethod = !!(a.paymentMethod || a.payment_method);
        const bHasMethod = !!(b.paymentMethod || b.payment_method);
        if (aHasMethod && !bHasMethod) return -1;
        if (!aHasMethod && bHasMethod) return 1;

        return 0;
      });

      const best = sorted[0];
      const duplicates = sorted.slice(1);

      duplicates.forEach(dup => {
        markedAsDuplicateIds.add(dup.id);
        // Add duplicate's paidAmount to the best document if duplicate has some payment
        const dupPaid = Number(dup.paidAmount || dup.paid || dup.paid_amount || 0);
        if (dupPaid > 0) {
          const currentBestPaid = Number(best.paidAmount || best.paid || best.paid_amount || 0);
          best.paidAmount = currentBestPaid + dupPaid;
        }
      });
    }
  });

  // Now inspect and update each document
  for (const docRaw of rawDocs) {
    const isDuplicate = markedAsDuplicateIds.has(docRaw.id);
    const docRef = doc(db, 'clinics', clinicId, 'financial_entries', docRaw.id);

    if (isDuplicate) {
      // Archive duplicate
      batch.update(docRef, {
        archived: true,
        archivedReason: 'merged_duplicate',
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || 'system'
      });
      duplicatesRemoved++;
      
      await saveFinancialLog(clinicId, currentUser, 'repair', docRaw.id, docRaw, {
        ...docRaw,
        archived: true,
        archivedReason: 'merged_duplicate'
      });
      continue;
    }

    // Normalize using standard helpers
    const norm = normalizeFinancialEntry(docRaw);

    // Recalculate pendingAmount & status accurately
    const totalAmount = norm.totalAmount;
    let paidAmount = norm.paidAmount;
    let pendingAmount = Math.max(0, totalAmount - paidAmount);
    
    let status: 'paid' | 'pending' | 'partial' | 'cancelled' = norm.status;
    if (status !== 'cancelled') {
      if (pendingAmount <= 0) {
        status = 'paid';
        pendingAmount = 0;
      } else if (paidAmount > 0) {
        status = 'partial';
      } else {
        status = 'pending';
      }
    }

    // Check if the record is completely broken or empty (e.g. amount == 0 and has no content)
    const isBroken = !norm.title || (norm.totalAmount <= 0 && norm.paidAmount <= 0);

    if (isBroken) {
      // Mark as archived
      batch.update(docRef, {
        archived: true,
        archivedReason: 'broken_zero_amount',
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || 'system'
      });
      archivedCount++;

      await saveFinancialLog(clinicId, currentUser, 'repair', docRaw.id, docRaw, {
        ...docRaw,
        archived: true,
        archivedReason: 'broken_zero_amount'
      });
    } else {
      // Apply clean normalized state
      const updatedFields = {
        title: norm.title,
        description: norm.description,
        totalAmount,
        paidAmount,
        pendingAmount,
        status,
        type: norm.type,
        category: norm.category,
        subcategory: norm.subcategory,
        dueDate: norm.dueDate,
        paidAt: norm.paidAt,
        paymentMethod: norm.paymentMethod,
        patientId: norm.patientId,
        patientName: norm.patientName,
        source: norm.source,
        quotationId: norm.quotationId,
        installmentNumber: norm.installmentNumber,
        totalInstallments: norm.totalInstallments,
        archived: norm.archived,
        archivedReason: norm.archivedReason,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || 'system'
      };

      batch.update(docRef, updatedFields);
      repairedCount++;

      // Log the update
      await saveFinancialLog(clinicId, currentUser, 'repair', docRaw.id, docRaw, updatedFields);
    }
  }

  // Commit batch changes to Firebase
  await batch.commit();

  console.log("[FINANCE_ERP] Database repair committed successfully.", { repairedCount, archivedCount, duplicatesRemoved });
  return { repairedCount, archivedCount, duplicatesRemoved };
}
