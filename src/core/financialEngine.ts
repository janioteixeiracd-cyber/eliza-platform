import { collection, onSnapshot, query, limit, orderBy, getDocs, doc, setDoc, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { normalizeLocalDate, normalizeFinancialEntry } from '../utils/financialHelpers';

// Interface matching the required ERP structures
export interface NormalizedEntry {
  id: string;
  title: string;
  description: string;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  type: 'income' | 'expense';
  status: 'paid' | 'pending' | 'partial' | 'cancelled';
  dueDate: string;
  paidAt: string | null;
  paymentMethod: string;
  patientId: string | null;
  patientName: string | null;
  category: string;
  subcategory: string;
  source: string;
  installmentNumber: number | null;
  totalInstallments: number | null;
  archived: boolean;
  createdAt: any;
  updatedAt: any;
  raw: any;
}

export interface AggregatedMetrics {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  pendingIncome: number;
  unlinkedTotal: number;
  todayIncome: number;
  todayExpense: number;
  monthIncome: number;
  monthExpense: number;
  yearIncome: number;
  yearExpense: number;
}

// Telemetry counters for the Advanced Diagnosis (ELIZA System Health) panel
export interface HealthTelemetry {
  activeListeners: number;
  queriesPerMinute: number;
  realtimeSubscriptions: number;
  fullScansDetected: number;
  firestoreReads: number;
  estimatedMemoryMB: number;
  renderLoopsCount: number;
  duplicateBootstrapsCount: number;
}

class CentralFinancialEngine {
  private cache: NormalizedEntry[] = [];
  private metrics: AggregatedMetrics = {
    balance: 0,
    totalIncome: 0,
    totalExpense: 0,
    pendingIncome: 0,
    unlinkedTotal: 0,
    todayIncome: 0,
    todayExpense: 0,
    monthIncome: 0,
    monthExpense: 0,
    yearIncome: 0,
    yearExpense: 0,
  };

  private listeners: Set<(cache: NormalizedEntry[], metrics: AggregatedMetrics) => void> = new Set();
  private firebaseUnsubscribe: (() => void) | null = null;
  private currentClinicId: string | null = null;
  private isLoaded = false;

  // Telemetry properties
  private telemetry: HealthTelemetry = {
    activeListeners: 0,
    queriesPerMinute: 0,
    realtimeSubscriptions: 0,
    fullScansDetected: 0,
    firestoreReads: 0,
    estimatedMemoryMB: 28, // base simulated baseline
    renderLoopsCount: 0,
    duplicateBootstrapsCount: 0,
  };

  private qpmTimer: any = null;
  private qpmCounter = 0;
  
  public performanceMode = false;

  constructor() {
    // Check if performance flag is present globally
    if (typeof window !== 'undefined') {
      this.performanceMode = localStorage.getItem('ELIZA_PERFORMANCE_MODE') === 'true';
    }
    this.startTelemetryTrackers();
  }

  public togglePerformanceMode(active: boolean) {
    this.performanceMode = active;
    if (typeof window !== 'undefined') {
      localStorage.setItem('ELIZA_PERFORMANCE_MODE', active ? 'true' : 'false');
    }
    this.triggerUpdate();
  }

  private startTelemetryTrackers() {
    if (typeof window === 'undefined') return;
    this.qpmTimer = setInterval(() => {
      this.telemetry.queriesPerMinute = this.qpmCounter;
      this.qpmCounter = 0;
      // Estimate memory usage slightly realistically
      this.telemetry.estimatedMemoryMB = Math.min(
        120,
        Math.floor(25 + this.cache.length * 0.05 + Math.random() * 5)
      );
    }, 60000) as any;
  }

  // Record a database read operation
  public trackRead(count: number = 1, isScan: boolean = false) {
    this.telemetry.firestoreReads += count;
    this.qpmCounter += count;
    if (isScan) {
      this.telemetry.fullScansDetected++;
    }
  }

  // Increment render loops counter for debugging
  public trackRenderLoop() {
    this.telemetry.renderLoopsCount++;
  }

  // Record duplicate/unnecessary bootstrap request
  public trackDuplicateBootstrap() {
    this.telemetry.duplicateBootstrapsCount++;
  }

  public getTelemetry(): HealthTelemetry {
    return {
      ...this.telemetry,
      activeListeners: this.listeners.size + (this.firebaseUnsubscribe ? 1 : 0),
      realtimeSubscriptions: this.firebaseUnsubscribe ? 1 : 0,
    };
  }

  public clearTelemetry() {
    this.telemetry = {
      activeListeners: this.listeners.size + (this.firebaseUnsubscribe ? 1 : 0),
      queriesPerMinute: 0,
      realtimeSubscriptions: this.firebaseUnsubscribe ? 1 : 0,
      fullScansDetected: 0,
      firestoreReads: 0,
      estimatedMemoryMB: 28,
      renderLoopsCount: 0,
      duplicateBootstrapsCount: 0,
    };
  }

  /**
   * Safe normalization of dates inside the engine
   */
  public normalizeFinancialDate(val: any): string {
    const d = normalizeLocalDate(val);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${r}`;
  }

  /**
   * Initializes real-time listener for the given clinic financial entries
   */
  public start(clinicId: string) {
    if (!clinicId) return;

    if (this.currentClinicId === clinicId) {
      this.trackDuplicateBootstrap();
      console.log(`[FINANCE_ENGINE] Already listening to clinic ${clinicId}. Skipping duplicate bootstrap.`);
      return;
    }

    // Unsubscribe from previous clinic if any
    this.stop();

    this.currentClinicId = clinicId;
    console.log(`[FINANCE_ENGINE] Starting central real-time listener for: ${clinicId}`);

    const colRef = collection(db, 'clinics', clinicId, 'financial_entries');
    let q = query(colRef);

    // If Performance Mode is active, we can limit the live snapshot size to prevent too many reads
    if (this.performanceMode) {
      console.log(`[FINANCE_ENGINE] Performance mode active. Applying strict limit of 150 entries.`);
      q = query(colRef, orderBy('dueDate', 'desc'), limit(150));
      this.trackRead(1, true);
    } else {
      q = query(colRef, orderBy('dueDate', 'desc'), limit(1200));
      this.trackRead(1, true);
    }

    this.firebaseUnsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`[FINANCE_ENGINE] snapshot loaded: ${snapshot.size} entries.`);
      this.trackRead(snapshot.size);

      this.cache = snapshot.docs.map(docRaw => {
        const docData = { id: docRaw.id, ...docRaw.data() as any };
        const norm = normalizeFinancialEntry(docData);
        return {
          id: norm.id,
          title: norm.title,
          description: norm.description,
          totalAmount: norm.totalAmount,
          paidAmount: norm.paidAmount,
          pendingAmount: norm.pendingAmount,
          type: norm.type,
          status: norm.status,
          dueDate: this.normalizeFinancialDate(norm.dueDate),
          paidAt: norm.paidAt ? this.normalizeFinancialDate(norm.paidAt) : null,
          paymentMethod: norm.paymentMethod,
          patientId: norm.patientId,
          patientName: norm.patientName,
          category: norm.category,
          subcategory: norm.subcategory,
          source: norm.source,
          installmentNumber: norm.installmentNumber,
          totalInstallments: norm.totalInstallments,
          archived: !!norm.archived,
          createdAt: norm.createdAt,
          updatedAt: norm.updatedAt,
          raw: docData
        };
      }).filter(entry => !entry.archived);

      this.recalculateMetrics();
      this.isLoaded = true;
      this.triggerUpdate();

      // Trigger automatic save to aggregate table (debounced/background)
      this.saveAggregatesToFirestore();
    }, (err) => {
      console.error("[FINANCE_ENGINE] snapshot load error:", err);
    });
  }

  public stop() {
    if (this.firebaseUnsubscribe) {
      console.log("[FINANCE_ENGINE] Stopping central listener.");
      this.firebaseUnsubscribe();
      this.firebaseUnsubscribe = null;
    }
    this.currentClinicId = null;
    this.isLoaded = false;
    this.cache = [];
  }

  public getCache(): NormalizedEntry[] {
    return this.cache;
  }

  public getMetrics(): AggregatedMetrics {
    return this.metrics;
  }

  public getIsReady(): boolean {
    return this.isLoaded;
  }

  public subscribe(cb: (cache: NormalizedEntry[], metrics: AggregatedMetrics) => void): () => void {
    this.listeners.add(cb);
    // Execute immediately with cached data
    cb(this.cache, this.metrics);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private triggerUpdate() {
    this.listeners.forEach(cb => cb(this.cache, this.metrics));
  }

  private recalculateMetrics() {
    const active = this.cache;

    const totalIncome = active
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.paidAmount, 0);

    const totalExpense = active
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.paidAmount, 0);

    const pendingIncome = active
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.pendingAmount, 0);

    // Unlinked incomes (receitas sem paciente cadastrado)
    const unlinkedTotal = active
      .filter(t => t.type === 'income' && !t.patientId)
      .reduce((sum, t) => sum + t.totalAmount, 0);

    // Today calculations local
    const todayStr = this.normalizeFinancialDate(new Date());

    const todayIncome = active
      .filter(t => t.type === 'income' && (t.dueDate === todayStr || t.paidAt === todayStr))
      .reduce((sum, t) => sum + t.paidAmount, 0);

    const todayExpense = active
      .filter(t => t.type === 'expense' && (t.dueDate === todayStr || t.paidAt === todayStr))
      .reduce((sum, t) => sum + t.paidAmount, 0);

    // current month calculation local
    const nowLocalDate = normalizeLocalDate(new Date());
    const currentMonthPrefix = `${nowLocalDate.getFullYear()}-${String(nowLocalDate.getMonth() + 1).padStart(2, '0')}`;

    const monthIncome = active
      .filter(t => t.type === 'income' && (t.dueDate.startsWith(currentMonthPrefix) || (t.paidAt && t.paidAt.startsWith(currentMonthPrefix))))
      .reduce((sum, t) => sum + t.paidAmount, 0);

    const monthExpense = active
      .filter(t => t.type === 'expense' && (t.dueDate.startsWith(currentMonthPrefix) || (t.paidAt && t.paidAt.startsWith(currentMonthPrefix))))
      .reduce((sum, t) => sum + t.paidAmount, 0);

    // current year
    const currentYearPrefix = `${nowLocalDate.getFullYear()}`;

    const yearIncome = active
      .filter(t => t.type === 'income' && (t.dueDate.startsWith(currentYearPrefix) || (t.paidAt && t.paidAt.startsWith(currentYearPrefix))))
      .reduce((sum, t) => sum + t.paidAmount, 0);

    const yearExpense = active
      .filter(t => t.type === 'expense' && (t.dueDate.startsWith(currentYearPrefix) || (t.paidAt && t.paidAt.startsWith(currentYearPrefix))))
      .reduce((sum, t) => sum + t.paidAmount, 0);

    this.metrics = {
      balance: totalIncome - totalExpense,
      totalIncome,
      totalExpense,
      pendingIncome,
      unlinkedTotal,
      todayIncome,
      todayExpense,
      monthIncome,
      monthExpense,
      yearIncome,
      yearExpense,
    };
  }

  /**
   * Core aggregate collection sync: automatically aggregates financials on the database
   */
  private async saveAggregatesToFirestore() {
    if (!this.currentClinicId || this.cache.length === 0) return;
    
    // Attempt background save to consolidated subcollection `financial_aggregates` to minimize dashboard query read costs
    try {
      const now = normalizeLocalDate(new Date());
      const mKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      const aggregateRef = doc(db, 'clinics', this.currentClinicId, 'financial_aggregates', mKey);
      
      this.trackRead(1); // Writing count simulates read query cost-saving validation
      await setDoc(aggregateRef, {
        monthKey: mKey,
        balance: this.metrics.balance,
        totalIncome: this.metrics.totalIncome,
        totalExpense: this.metrics.totalExpense,
        pendingIncome: this.metrics.pendingIncome,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn("[FINANCE_ENGINE] Failed background aggregate sync:", e);
    }
  }
}

export const financialEngine = new CentralFinancialEngine();
