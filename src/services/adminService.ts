import { 
  collection, 
  getDocs, 
  writeBatch, 
  doc, 
  query, 
  limit, 
  where 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';

export interface ResetProgress {
  collection: string;
  count: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

/**
 * Service to handle clinical administrative deletions
 */
export const AdminService = {
  /**
   * Resets clinic patient data securely
   * @param clinicId The current clinic ID
   * @param onProgress Callback to report progress
   */
  async resetPatientBase(
    clinicId: string, 
    onProgress: (progress: ResetProgress[]) => void
  ): Promise<{ success: boolean; totalDeleted: number }> {
    const collectionsToReset = [
      { name: 'patients', description: 'Base de Pacientes' },
      { name: 'patient_import_review', description: 'Revisão de Importação' },
      { name: 'import_batches', description: 'Lotes de Importação', filterPatients: true }
    ];

    const progress: ResetProgress[] = collectionsToReset.map(c => ({
      collection: c.description,
      count: 0,
      status: 'pending'
    }));

    onProgress([...progress]);

    let totalDeleted = 0;

    try {
      for (let i = 0; i < collectionsToReset.length; i++) {
        const colConfig = collectionsToReset[i];
        progress[i].status = 'processing';
        onProgress([...progress]);

        const colRef = collection(db, 'clinics', clinicId, colConfig.name);
        
        let deletedInCollection = 0;
        let hasMore = true;

        while (hasMore) {
          // Delete in batches of 400 (Firestore limit is 500)
          const q = query(colRef, limit(400));
          const snapshot = await getDocs(q);

          if (snapshot.empty) {
            hasMore = false;
            break;
          }

          const batch = writeBatch(db);
          snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
          });

          await batch.commit();
          deletedInCollection += snapshot.size;
          totalDeleted += snapshot.size;
          
          progress[i].count = deletedInCollection;
          onProgress([...progress]);
        }

        progress[i].status = 'completed';
        onProgress([...progress]);
      }

      return { success: true, totalDeleted };
    } catch (error: any) {
      console.error("[AdminService] Reset failed:", error);
      handleFirestoreError(error, OperationType.DELETE, `clinics/${clinicId}/admin_reset`);
      
      // Update current processing item to error
      const currentIdx = progress.findIndex(p => p.status === 'processing');
      if (currentIdx !== -1) {
        progress[currentIdx].status = 'error';
        onProgress([...progress]);
      }
      
      throw error;
    }
  }
};
