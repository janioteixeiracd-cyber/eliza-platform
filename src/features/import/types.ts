import { Timestamp } from 'firebase/firestore';

export interface ImportedPatient {
  patient_id: string;
  name: string;
  normalized_name?: string;
  cpf?: string | null;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  status: "active" | "review" | "suspect";
  source: string;
  imported_at: Timestamp | Date;
  updated_at: Timestamp | Date;
  import_batch_id: string;
  raw_import_data: Record<string, any>;
}

export interface ImportedFinancialEntry {
  entry_id: string;
  patient_id?: string | null;
  patient_name?: string | null;
  date: string;
  competence_month: string;
  type: "receita" | "despesa" | "outro";
  original_type?: string;
  category?: string | null;
  subcategory?: string | null;
  description: string;
  amount: number;
  payment_method?: string | null;
  status: "pago" | "aberto" | "cancelado" | "pendente" | "outro";
  original_status?: string;
  needs_review?: boolean;
  review_status?: "pending" | "linked" | "ignored" | "none";
  source: string;
  imported_at: Timestamp | Date;
  updated_at: Timestamp | Date;
  import_batch_id: string;
  raw_import_data: Record<string, any>;
}

export interface ImportBatch {
  import_batch_id: string;
  file_name: string;
  imported_at: Timestamp | Date;
  imported_by: string;
  status: "validated" | "imported" | "failed" | "partial";
  total_patients_in_file: number;
  total_patients_created: number;
  total_patients_updated: number;
  total_financial_entries_in_file: number;
  total_financial_entries_created: number;
  total_financial_entries_updated: number;
  total_receitas: number;
  total_despesas: number;
  total_receitas_vinculadas: number;
  total_receitas_sem_vinculo: number;
  total_amount_receitas: number;
  total_amount_despesas: number;
  warnings: string[];
  errors: string[];
  is_test_import?: boolean;
}

export interface FinancialMatchCandidate {
  financial_entry_id: string;
  candidate_patient_id: string;
  candidate_patient_name: string;
  confidence: string | number;
  reason: string;
  import_batch_id: string;
}

export interface PatientImportReview {
  patient_id: string;
  name: string;
  reason: string;
  raw_import_data: object;
  import_batch_id: string;
  review_status: "pending" | "confirmed" | "merged" | "ignored" | "archived";
}

export interface ImportLog {
  level: "info" | "warning" | "error";
  message: string;
  row_number?: number | null;
  sheet_name?: string | null;
  created_at: Timestamp | Date;
}
