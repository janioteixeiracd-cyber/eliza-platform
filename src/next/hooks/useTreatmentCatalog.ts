import { useCallback, useEffect, useState } from 'react';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { secureGetDocs } from '../services/next-db';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { DEFAULT_TREATMENT_CATALOG, type TreatmentCatalogItem } from '../../data/treatmentCatalog';

export type { TreatmentCatalogItem };

/**
 * Catálogo de tratamentos da clínica (clinics/{clinicId}/treatment_catalog),
 * mesclado em memória com o catálogo estático default — mesmo padrão já
 * usado pelo app legado (MedicalRecordView.tsx/SettingsView.tsx). Nunca
 * grava nada sozinho: uma clínica que nunca cadastrou nada continua vendo
 * os itens default até cadastrar os próprios (por nome, case-insensitive).
 */
export function useTreatmentCatalog(clinicId: string | undefined): {
  items: TreatmentCatalogItem[];
  loading: boolean;
  reload: () => void;
} {
  const { addAuditLog } = useNextReadOnly();
  const [dbItems, setDbItems] = useState<TreatmentCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!clinicId) { setDbItems([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ref = collection(db, 'clinics', clinicId, 'treatment_catalog');
        const snap = await secureGetDocs(query(ref, limit(500)), 'treatment_catalog', { addAuditLog });
        if (cancelled) return;
        setDbItems(snap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || '',
            category: data.category || '',
            subcategory: data.subcategory || '',
            defaultPrice: Number(data.defaultPrice) || 0,
            baseValue: Number(data.defaultPrice) || 0,
            description: data.description || '',
            estimatedDuration: Number(data.estimatedDuration) || 0,
            requiresFaces: !!data.requiresFaces,
            requiresRegion: !!data.requiresRegion,
            active: data.active !== false,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            createdBy: data.createdBy,
          } as TreatmentCatalogItem;
        }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, reloadToken]);

  const reload = useCallback(() => setReloadToken(t => t + 1), []);

  const items: TreatmentCatalogItem[] = [
    ...dbItems,
    ...DEFAULT_TREATMENT_CATALOG.filter(
      def => !dbItems.some(dbItem => dbItem.name.toLowerCase() === def.name.toLowerCase())
    ),
  ];

  return { items, loading, reload };
}
