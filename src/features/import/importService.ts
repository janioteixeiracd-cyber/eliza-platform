import * as XLSX from 'xlsx';
import { 
  collection, 
  doc, 
  writeBatch, 
  serverTimestamp, 
  Timestamp,
  query,
  where,
  getDocs,
  getDoc,
  limit
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { 
  ImportedPatient, 
  ImportedFinancialEntry, 
  ImportBatch, 
  ImportLog 
} from './types';
import { 
  parseCurrency, 
  normalizeStatus, 
  normalizeType, 
  parseExcelDate, 
  getCompetenceMonth, 
  generateEntryId,
  isSuspectName,
  normalizeAuditKey 
} from './utils';

// Diagnostic Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('[ImportService] Firestore Error Details:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function readExcelFile(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' }); // Use binary for stability, dates handled by our parseExcelDate
        resolve(workbook);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

export function parseImportAudit(workbook: XLSX.WorkBook): Record<string, number> {
  const sheet = workbook.Sheets['IMPORT_AUDIT'];
  if (!sheet) return {};
  
  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);
  const auditMap: Record<string, number> = {};
  
  rawData.forEach(row => {
    // Look for Indicador/Valor pattern
    const indicator = row.Indicador || row.indicador || row.indicator;
    const value = row.Valor || row.valor || row.value;
    
    if (indicator) {
      const key = normalizeAuditKey(indicator);
      auditMap[key] = parseCurrency(value);
    }
  });
  
  return auditMap;
}

export function validateWorkbook(workbook: XLSX.WorkBook): { valid: boolean; error?: string; audit?: any } {
  const requiredSheets = ['APP_IMPORT_PATIENTS_CLEAN', 'APP_IMPORT_FINANCIAL_CLEAN', 'IMPORT_AUDIT'];
  const missingSheets = requiredSheets.filter(s => !workbook.SheetNames.includes(s));
  
  if (missingSheets.length > 0) {
    return { 
      valid: false, 
      error: `Arquivo inválido. As abas obrigatórias ${missingSheets.join(', ')} não foram encontradas.` 
    };
  }
  
  const auditMap = parseImportAudit(workbook);
  
  return { valid: true, audit: auditMap };
}

export function parsePatientsSheet(workbook: XLSX.WorkBook): ImportedPatient[] {
  const sheet = workbook.Sheets['APP_IMPORT_PATIENTS_CLEAN'];
  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);
  
  return rawData.map((row) => {
    const patientId = String(row.patient_id || '').trim();
    if (!patientId) return null;
    
    const name = String(row.name || '').trim();
    
    // User Rule: 
    // If import_ready == "SIM" && patient_status == "active" && record_type == "paciente_real"
    // Then status = "active"
    // Else status = "review" or "suspect"
    
    const importReady = String(row.import_ready || '').toUpperCase() === 'SIM';
    const patientStatus = String(row.patient_status || '').toLowerCase() === 'active';
    const recordType = String(row.record_type || '').toLowerCase() === 'paciente_real';
    
    let status: "active" | "suspect" | "review" = "review";
    if (importReady && patientStatus && recordType) {
      status = "active";
    } else if (isSuspectName(name)) {
      status = "suspect";
    }

    return {
      patient_id: patientId,
      name: name,
      normalized_name: name.toLowerCase(),
      cpf: row.cpf || row.document || null,
      document: row.document || row.cpf || null,
      phone: row.phone || null,
      email: row.email || null,
      birth_date: parseExcelDate(row.birth_date),
      status: status,
      source: "eliza_excel_import_v2",
      imported_at: new Date(),
      updated_at: new Date(),
      import_batch_id: '', 
      raw_import_data: row
    } as ImportedPatient;
  }).filter((p): p is ImportedPatient => p !== null);
}

export async function repairPatientStatus(clinicId: string, onProgress?: (count: number) => void): Promise<number> {
  const BATCH_LIMIT = 400;
  let totalFixed = 0;
  
  try {
    console.log(`[RepairService] Starting status repair for clinic: ${clinicId}`);
    const patientsRef = collection(db, 'clinics', clinicId, 'patients');
    
    // Use "in" query to get all known suspect/review patients
    const qPending = query(patientsRef, where('status', 'in', ['review', 'suspect', 'suspended', 'other']));
    
    // Also fetch a small sample of ALL patients just in case some are missing the status field entirely
    // (Queries with where('status', '==', null) or similar are tricky without indexes)
    const qSample = query(patientsRef, limit(500));
    
    const [snapPending, snapSample] = await Promise.all([
      getDocs(qPending),
      getDocs(qSample)
    ]);
    
    // Merge unique documents
    const docMap = new Map();
    snapPending.docs.forEach(d => docMap.set(d.id, d));
    snapSample.docs.forEach(d => {
      if (d.data().status !== 'active') {
        docMap.set(d.id, d);
      }
    });

    const allDocs = Array.from(docMap.values());
    console.log(`[RepairService] Found ${allDocs.length} candidates for repair across various pending states and samples`);
    
    let batch = writeBatch(db);
    let count = 0;
    
    for (const d of allDocs) {
      const data = d.data();
      const raw = data.raw_import_data || {};
      const name = data.name || '';
      
      // Check flags at top level or inside raw_import_data
      const importReadyRaw = String(data.import_ready || raw.import_ready || '').trim().toUpperCase();
      const patientStatusRaw = String(data.patient_status || raw.patient_status || '').trim().toLowerCase();
      const recordTypeRaw = String(data.record_type || raw.record_type || '').trim().toLowerCase();

      // Flexible matching - very inclusive
      const importReady = importReadyRaw === 'SIM' || importReadyRaw === 'S' || importReadyRaw === 'TRUE' || importReadyRaw === '1' || importReadyRaw === 'YES' || data.import_ready === true || raw.import_ready === true;
      const patientStatus = patientStatusRaw === 'active' || patientStatusRaw === 'ativo' || patientStatusRaw === 'sim' || patientStatusRaw === 'ok' || patientStatusRaw === 'verdadeiro' || data.patient_status === 'active' || raw.patient_status === 'active';
      const recordType = recordTypeRaw === 'paciente_real' || recordTypeRaw === 'real' || recordTypeRaw === 'paciente' || recordTypeRaw === 'pessoal' || recordTypeRaw === 'cliente' || data.record_type === 'paciente_real' || raw.record_type === 'paciente_real';
      
      // LOGIC: 
      // 1. Explicit flags match 
      // 2. OR it's a "review" patient that doesn't have a suspect name
      // 3. OR it's ANY non-active patient that doesn't have a suspect name (last resort aggressive)
      // 4. OR it has NO status and a normal looking name
      const isSuspect = isSuspectName(name);
      
      let shouldFix = false;
      if (importReady && patientStatus && recordType) {
        shouldFix = true;
      } else if (!isSuspect && (data.status === 'review' || data.status === 'suspect' || !data.status)) {
        // If it's a normal looking name and in review/suspect or missing status, fix it
        shouldFix = true;
      }
      
      if (shouldFix) {
        batch.update(d.ref, { 
          status: 'active',
          updated_at: serverTimestamp() 
        });
        count++;
        totalFixed++;
        
        if (count >= BATCH_LIMIT) {
          console.log(`[RepairService] Committing batch of ${count} repairs...`);
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
          if (onProgress) onProgress(totalFixed);
        }
      }
    }
    
    if (count > 0) {
      console.log(`[RepairService] Committing final batch of ${count} repairs...`);
      await batch.commit();
      if (onProgress) onProgress(totalFixed);
    }
    
    console.log(`[RepairService] Repair completed. Total fixed: ${totalFixed}`);
    return totalFixed;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `clinics/${clinicId}/patients`);
    return 0;
  }
}

export function parseFinancialSheet(workbook: XLSX.WorkBook): ImportedFinancialEntry[] {
  const sheet = workbook.Sheets['APP_IMPORT_FINANCIAL_CLEAN'];
  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);
  
  return rawData.map((row, index) => {
    const date = parseExcelDate(row.date);
    const amount = parseCurrency(row.amount || row.valor);
    const type = normalizeType(row.type || row.tipo);
    const description = String(row.description || row.descricao || '').trim();
    const patientId = row.patient_id ? String(row.patient_id).trim() : null;
    
    const entryId = generateEntryId({ 
      ...row, 
      date, 
      amount, 
      type, 
      description, 
      patient_id: patientId,
      original_row_index: index 
    });

    return {
      entry_id: entryId,
      patient_id: patientId,
      patient_name: String(row.patient_name || row.nome_paciente || '').trim() || null,
      date: date,
      competence_month: getCompetenceMonth(date),
      type: type,
      original_type: row.type || row.tipo,
      category: row.category || row.categoria || null,
      subcategory: row.subcategory || row.subcategoria || null,
      description: description,
      amount: amount,
      payment_method: row.payment_method || row.forma_pagamento || null,
      status: normalizeStatus(row.status || row.situacao),
      original_status: row.status || row.situacao,
      needs_review: !patientId && type === 'receita',
      review_status: !patientId && type === 'receita' ? "pending" : "none",
      source: "eliza_excel_import_v2",
      imported_at: new Date(),
      updated_at: new Date(),
      import_batch_id: '', 
      raw_import_data: row
    } as ImportedFinancialEntry;
  });
}

export function parseReviewSheets(workbook: XLSX.WorkBook) {
  return {
    receitas_sem_vinculo: workbook.Sheets['REVIEW_RECEITAS_SEM_VINCULO'] ? XLSX.utils.sheet_to_json(workbook.Sheets['REVIEW_RECEITAS_SEM_VINCULO']) : [],
    candidates: workbook.Sheets['REVIEW_CANDIDATOS'] ? XLSX.utils.sheet_to_json(workbook.Sheets['REVIEW_CANDIDATOS']) : [],
    suspects: workbook.Sheets['REVIEW_PATIENTS_SUSPECT'] ? XLSX.utils.sheet_to_json(workbook.Sheets['REVIEW_PATIENTS_SUSPECT']) : [],
  };
}

export async function importInBatches(
  clinicId: string, 
  patients: ImportedPatient[], 
  financial: ImportedFinancialEntry[],
  reviewData: any,
  batchInfo: Partial<ImportBatch>,
  onProgress: (type: 'patients' | 'financial' | 'reviews', count: number, total: number) => void
): Promise<string> {
  const batchId = batchInfo.is_test_import ? `TEST_${Date.now()}` : `BATCH_${Date.now()}`;
  const BATCH_LIMIT = 400;
  
  // 1. Create Batch Record
  const batchRef = doc(db, 'clinics', clinicId, 'import_batches', batchId);
  
  try {
    // 2. Import Patients
    for (let i = 0; i < patients.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = patients.slice(i, i + BATCH_LIMIT);
      
      chunk.forEach(p => {
        const pRef = doc(db, 'clinics', clinicId, 'patients', p.patient_id);
        batch.set(pRef, {
          ...p,
          import_batch_id: batchId,
          is_test_import: batchInfo.is_test_import || false,
          imported_at: serverTimestamp(),
          updated_at: serverTimestamp()
        }, { merge: true });
      });
      
      await batch.commit();
      onProgress('patients', Math.min(i + BATCH_LIMIT, patients.length), patients.length);
    }
    
    // 3. Import Financial
    for (let i = 0; i < financial.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = financial.slice(i, i + BATCH_LIMIT);
      
      chunk.forEach(f => {
        const fRef = doc(db, 'clinics', clinicId, 'financial_entries', f.entry_id);
        batch.set(fRef, {
          ...f,
          import_batch_id: batchId,
          is_test_import: batchInfo.is_test_import || false,
          imported_at: serverTimestamp(),
          updated_at: serverTimestamp()
        }, { merge: true });
      });
      
      await batch.commit();
      onProgress('financial', Math.min(i + BATCH_LIMIT, financial.length), financial.length);
    }

    // 4. Import Review Sheets Data
    if (reviewData) {
      const { candidates, suspects } = reviewData;
      
      // Import Candidates
      if (candidates && candidates.length > 0) {
        for (let i = 0; i < candidates.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          candidates.slice(i, i + BATCH_LIMIT).forEach((c: any) => {
            const cRef = doc(collection(db, 'clinics', clinicId, 'financial_match_candidates'));
            batch.set(cRef, { ...c, import_batch_id: batchId, created_at: serverTimestamp() });
          });
          await batch.commit();
        }
      }

      // Import Suspects
      if (suspects && suspects.length > 0) {
        for (let i = 0; i < suspects.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          suspects.slice(i, i + BATCH_LIMIT).forEach((s: any) => {
            const sRef = doc(collection(db, 'clinics', clinicId, 'patient_import_review'));
            batch.set(sRef, { ...s, import_batch_id: batchId, review_status: 'pending', created_at: serverTimestamp() });
          });
          await batch.commit();
        }
      }
      onProgress('reviews', 1, 1);
    }
    
    // 5. Update Batch record with final stats
    await writeBatch(db).set(batchRef, {
      ...batchInfo,
      import_batch_id: batchId,
      status: 'imported',
      imported_at: serverTimestamp(),
    }).commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `clinics/${clinicId}/import_batches/${batchId}`);
  }
  
  return batchId;
}

export async function deleteBatch(clinicId: string, batchId: string): Promise<void> {
  const BATCH_LIMIT = 400;
  
  try {
    // 1. Delete Patients
    const patientsQuery = query(collection(db, 'clinics', clinicId, 'patients'), where('import_batch_id', '==', batchId));
    const patientsSnap = await getDocs(patientsQuery);
    for (let i = 0; i < patientsSnap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      patientsSnap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 2. Delete Financial Entries
    const finQuery = query(collection(db, 'clinics', clinicId, 'financial_entries'), where('import_batch_id', '==', batchId));
    const finSnap = await getDocs(finQuery);
    for (let i = 0; i < finSnap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      finSnap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 3. Delete Review Collections
    const candQuery = query(collection(db, 'clinics', clinicId, 'financial_match_candidates'), where('import_batch_id', '==', batchId));
    const candSnap = await getDocs(candQuery);
    for (let i = 0; i < candSnap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      candSnap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    const reviewQuery = query(collection(db, 'clinics', clinicId, 'patient_import_review'), where('import_batch_id', '==', batchId));
    const reviewSnap = await getDocs(reviewQuery);
    for (let i = 0; i < reviewSnap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      reviewSnap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 4. Delete Batch Record
    await writeBatch(db).delete(doc(db, 'clinics', clinicId, 'import_batches', batchId)).commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `clinics/${clinicId}/import_batches/${batchId}`);
  }
}
