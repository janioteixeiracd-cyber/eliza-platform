import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const COOLDOWN_MS = 10 * 60 * 1000; // 10 min

function cooldownKey(clinicId: string, checkpoint: string): string {
  return `eliza_standing_gap_check__${clinicId}__${checkpoint}`;
}

/**
 * Dispara POST /api/eliza/cognitive-events/check-standing ao montar a tela
 * (nunca em background/cron — decisão explícita do plano da Fase 1), com
 * cooldown local pra não bater o endpoint a cada re-render/troca de aba.
 * O resultado (gap criado/atualizado/resolvido) chega pro usuário via o
 * onSnapshot já existente em ElizaAssistantContext.tsx — este hook nunca
 * lê a resposta, só dispara a checagem.
 */
export function useElizaStandingGapCheck(checkpoint: 'financeiro_open' | 'agenda_open'): void {
  const { clinic, user } = useAuth();

  useEffect(() => {
    if (!clinic?.id || !user) return;
    const key = cooldownKey(clinic.id, checkpoint);
    let lastRun = 0;
    try {
      lastRun = Number(sessionStorage.getItem(key) || 0);
    } catch {
      // sessionStorage indisponível (ex: modo privado) — segue sem cooldown,
      // pior caso é uma checagem a mais, nunca um erro.
    }
    if (Date.now() - lastRun < COOLDOWN_MS) return;

    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        await fetch('/api/eliza/cognitive-events/check-standing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ clinicId: clinic.id, checkpoint }),
        });
        if (cancelled) return;
        try {
          sessionStorage.setItem(key, String(Date.now()));
        } catch {
          // idem — não bloqueia o fluxo se não conseguir gravar o cooldown.
        }
      } catch (err) {
        // Best-effort: proatividade nunca deve quebrar a tela que a chamou.
        console.warn('[ELIZA_STANDING_GAP_CHECK] Falha ao verificar pendências:', err);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id, user, checkpoint]);
}
