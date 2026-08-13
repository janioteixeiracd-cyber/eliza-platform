import { useEffect, useState, useMemo } from 'react';
import { financialEngine, NormalizedEntry, AggregatedMetrics, HealthTelemetry } from './financialEngine';

export interface FinancialState {
  entries: NormalizedEntry[];
  metrics: AggregatedMetrics;
  isReady: boolean;
  performanceMode: boolean;
  telemetry: HealthTelemetry;
}

/**
 * Standard reactive custom hook to bind components directly to the optimal Financial Engine stream.
 * This completely prevents duplicate listens, dual loops, and recalculates metrics only once.
 */
export function useFinancial(clinicId?: string) {
  const [state, setState] = useState<FinancialState>({
    entries: financialEngine.getCache(),
    metrics: financialEngine.getMetrics(),
    isReady: financialEngine.getIsReady(),
    performanceMode: financialEngine.performanceMode,
    telemetry: financialEngine.getTelemetry(),
  });

  // Automatically start the engine if a clinic is provided
  useEffect(() => {
    if (clinicId) {
      financialEngine.start(clinicId);
    }
  }, [clinicId]);

  // Track rendering loops
  useEffect(() => {
    financialEngine.trackRenderLoop();
  });

  // Subscribe to Engine changes
  useEffect(() => {
    const unsub = financialEngine.subscribe((cache, metrics) => {
      setState({
        entries: cache,
        metrics,
        isReady: financialEngine.getIsReady(),
        performanceMode: financialEngine.performanceMode,
        telemetry: financialEngine.getTelemetry(),
      });
    });

    return () => unsub();
  }, []);

  const actions = useMemo(() => ({
    togglePerformanceMode: (active: boolean) => {
      financialEngine.togglePerformanceMode(active);
    },
    clearTelemetry: () => {
      financialEngine.clearTelemetry();
    },
    trackCustomEvent: () => {
      financialEngine.trackRead(1);
    },
    forceRefresh: () => {
      if (clinicId) {
        financialEngine.stop();
        financialEngine.start(clinicId);
      }
    }
  }), [clinicId]);

  return {
    ...state,
    ...actions,
  };
}
