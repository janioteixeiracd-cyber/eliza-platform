import { useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { AssistantAnswer, ScreenType, ConversationHistoryTurn } from '../types/eliza';

export interface AskElizaOptions {
  screenType?: ScreenType;
  patientId?: string | null;
  pageContext?: { tabLabel: string; summary: string } | null;
  /** Last few turns of this same conversation — lets the model resolve "esses horários"/"esse paciente" without re-deriving context. Caller owns the history array; this hook doesn't keep its own. */
  conversationHistory?: ConversationHistoryTurn[];
}

// The one place that calls POST /api/eliza/ask — every screen (Assistente
// Central, Home, Prontuário, Planejamento) uses this same hook instead of
// each building its own fetch/prompt, so there is exactly one client-side
// implementation of "ask the orchestrator" to keep in sync with the backend
// contract.
export function useElizaAsk() {
  const { clinic, user } = useAuth();

  const ask = useCallback(async (question: string, options: AskElizaOptions = {}): Promise<AssistantAnswer> => {
    if (!clinic?.id || !user) {
      throw new Error('Sessão não carregada — tente novamente em instantes.');
    }
    const idToken = await user.getIdToken();
    const response = await fetch('/api/eliza/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        clinicId: clinic.id,
        question,
        screenType: options.screenType || 'geral',
        patientId: options.patientId || undefined,
        pageContext: options.pageContext || null,
        conversationHistory: options.conversationHistory && options.conversationHistory.length > 0 ? options.conversationHistory : undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data?.error || 'A Eliza não conseguiu responder agora.');
    }
    return {
      summary: data.summary || '',
      insights: Array.isArray(data.insights) ? data.insights : [],
      periodComparison: data.periodComparison || null,
      dataSufficiency: data.dataSufficiency === 'insufficient' ? 'insufficient' : 'ok',
      caveats: Array.isArray(data.caveats) ? data.caveats : [],
      resolvedPatientId: data.resolvedPatientId || null,
      resolvedPatientName: data.resolvedPatientName || null,
      meta: data.meta || undefined,
    };
  }, [clinic, user]);

  return { ask, ready: !!clinic?.id && !!user };
}
