import { useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { TemporalOverviewResponse } from '../types/eliza';

// The one place that calls POST /api/eliza/temporal-overview — mirrors
// useElizaAsk's role for the main orchestrator.
export function useElizaTemporal() {
  const { clinic, user } = useAuth();

  const getOverview = useCallback(async (days: number = 30): Promise<TemporalOverviewResponse> => {
    if (!clinic?.id || !user) {
      throw new Error('Sessão não carregada — tente novamente em instantes.');
    }
    const idToken = await user.getIdToken();
    const response = await fetch('/api/eliza/temporal-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ clinicId: clinic.id, days }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data?.error || 'A Eliza não conseguiu calcular a visão temporal agora.');
    }
    return data as TemporalOverviewResponse;
  }, [clinic, user]);

  return { getOverview, ready: !!clinic?.id && !!user };
}
