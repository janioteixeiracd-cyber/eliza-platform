import { useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { InsightActionType } from '../types/eliza';

export interface ActionPreview {
  summary: string;
  details: Record<string, any>;
}

// The one place that talks to the Action Layer's propose/approve/reject
// routes (server.ts) — mirrors useElizaAsk's role for /api/eliza/ask, so
// InsightCard's contextual-action buttons (and any future caller) share one
// implementation instead of each re-fetching by hand.
export function useElizaActions() {
  const { clinic, user } = useAuth();

  async function authedFetch(path: string, body: Record<string, any>) {
    if (!clinic?.id || !user) throw new Error('Sessão não carregada — tente novamente em instantes.');
    const idToken = await user.getIdToken();
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ clinicId: clinic.id, ...body }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data?.error || 'A ação não pôde ser processada agora.');
    }
    return data;
  }

  // propose_clinical_evolution can resolve to a clarification instead of a
  // real proposal (question/insufficient reply, never routed to
  // execute()) — callers must check `type` before assuming a proposalId exists.
  const propose = useCallback(async (
    actionType: InsightActionType,
    input: Record<string, any>
  ): Promise<{ type: 'proposal'; proposalId: string; preview: ActionPreview } | { type: 'clarification'; message: string; messageType: string }> => {
    const data = await authedFetch('/api/eliza/actions/propose', { actionType, input });
    if (data.clarification) {
      return { type: 'clarification', message: data.clarification, messageType: data.messageType };
    }
    return { type: 'proposal', proposalId: data.proposalId, preview: data.preview };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic, user]);

  const approve = useCallback(async (proposalId: string, overrides?: Record<string, any>): Promise<{ status: string; result: any }> => {
    const data = await authedFetch(`/api/eliza/actions/${proposalId}/approve`, overrides ? { overrides } : {});
    return { status: data.status, result: data.result };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic, user]);

  const reject = useCallback(async (proposalId: string): Promise<void> => {
    await authedFetch(`/api/eliza/actions/${proposalId}/reject`, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic, user]);

  return { propose, approve, reject };
}
