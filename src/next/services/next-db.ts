import { 
  getDoc, 
  getDocs, 
  DocumentReference, 
  Query, 
  DocumentSnapshot, 
  QuerySnapshot 
} from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../../lib/firebase';

interface AuditLogger {
  addAuditLog: (log: {
    collection: string;
    action: 'READ' | 'QUERY' | 'WRITE_BLOCKED';
    parameters?: Record<string, any>;
    resultCount?: number;
    status: 'SUCCESS' | 'BLOCKED';
    details?: string;
  }) => void;
}

/**
 * Secure proxy read operations for ELIZA NEXT
 */
export async function secureGetDoc<T = any>(
  docRef: DocumentReference,
  auditLogger?: AuditLogger
): Promise<DocumentSnapshot<T>> {
  const path = docRef.path;
  const collectionName = docRef.parent.id;
  try {
    const snap = await getDoc(docRef);
    
    if (auditLogger) {
      auditLogger.addAuditLog({
        collection: collectionName,
        action: 'READ',
        parameters: { path },
        resultCount: snap.exists() ? 1 : 0,
        status: 'SUCCESS',
        details: `Documento lido com sucesso de ${path}`
      });
    }
    
    return snap as DocumentSnapshot<T>;
  } catch (error) {
    if (auditLogger) {
      auditLogger.addAuditLog({
        collection: collectionName,
        action: 'READ',
        parameters: { path },
        status: 'BLOCKED',
        details: `Erro na leitura de ${path}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    handleFirestoreError(error, OperationType.GET, path);
    throw error;
  }
}

export async function secureGetDocs<T = any>(
  q: Query,
  collectionName: string,
  auditLogger?: AuditLogger
): Promise<QuerySnapshot<T>> {
  try {
    const snap = await getDocs(q);
    
    if (auditLogger) {
      auditLogger.addAuditLog({
        collection: collectionName,
        action: 'QUERY',
        parameters: { count: snap.size },
        resultCount: snap.size,
        status: 'SUCCESS',
        details: `Consulta realizada em '${collectionName}'. Retornados ${snap.size} registros.`
      });
    }
    
    return snap as QuerySnapshot<T>;
  } catch (error) {
    if (auditLogger) {
      auditLogger.addAuditLog({
        collection: collectionName,
        action: 'QUERY',
        status: 'BLOCKED',
        details: `Falha na consulta em '${collectionName}': ${error instanceof Error ? error.message : String(error)}`
      });
    }
    handleFirestoreError(error, OperationType.LIST, collectionName);
    throw error;
  }
}

