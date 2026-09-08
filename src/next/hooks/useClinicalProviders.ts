import { useCallback, useEffect, useState } from 'react';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { secureGetDocs } from '../services/next-db';
import { useNextReadOnly } from '../context/NextReadOnlyContext';

export interface ClinicalProviderOption {
  uid: string;
  name: string;
}

/**
 * Fonte única de "profissional real" (membro com agenda liberada) — usada
 * tanto pelo seletor de profissional do Orçamento quanto pelo do
 * Agendamento, pra nunca divergir em quem conta como profissional válido.
 */
export function useClinicalProviders(clinicId: string | undefined): {
  providers: ClinicalProviderOption[];
  loading: boolean;
  reload: () => void;
} {
  const { addAuditLog } = useNextReadOnly();
  const [providers, setProviders] = useState<ClinicalProviderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!clinicId) { setProviders([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const membersRef = collection(db, 'clinics', clinicId, 'members');
        const snap = await secureGetDocs(query(membersRef, limit(200)), 'members', { addAuditLog });
        if (cancelled) return;
        const list: ClinicalProviderOption[] = snap.docs
          .map(d => ({ uid: d.id, ...(d.data() as any) }))
          .filter(m => m.isClinicalProvider === true && m.active !== false && m.name)
          .map(m => ({ uid: m.uid, name: m.name as string }));
        setProviders(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, reloadToken]);

  const reload = useCallback(() => setReloadToken(t => t + 1), []);

  return { providers, loading, reload };
}
