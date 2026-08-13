import { Timestamp } from 'firebase/firestore';

export type Role = string;

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  email: string | null;
  phone: string | null;
  active: boolean;
  commission_enabled: boolean;
  default_commission_rules?: string[]; // IDs of rules
  created_at: Timestamp | Date;
  updated_at: Timestamp | Date;
}

export type CommissionType = 'sale' | 'recovery' | 'procedure' | 'fixed' | 'tiered' | 'custom';
export type CalculationBase = 'received_amount' | 'gross_amount' | 'net_amount' | 'fixed_amount';

export interface CommissionTier {
  min: number;
  max: number | null;
  amount: number;
}

export interface CommissionRule {
  id: string;
  name: string;
  description: string;
  member_id: string | null; // Null if applies to role
  role_target: Role | null;
  commission_type: CommissionType;
  calculation_base: CalculationBase;
  percentage?: number;
  fixed_amount?: number;
  tiers?: CommissionTier[];
  applies_to_categories: string[];
  applies_to_payment_status: string[];
  active: boolean;
  created_at: Timestamp | Date;
  updated_at: Timestamp | Date;
}

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'canceled' | 'on_hold';

export interface Commission {
  id: string;
  member_id: string;
  member_name: string;
  financial_entry_id: string;
  patient_id: string | null;
  patient_name: string | null;
  commission_type: CommissionType;
  rule_id: string | null;
  base_amount: number;
  percentage?: number;
  fixed_amount?: number;
  commission_amount: number;
  status: CommissionStatus;
  source: 'manual' | 'automatic' | 'import' | 'ai_suggestion';
  generated_at: Timestamp | Date;
  due_date: string | null;
  paid_at: Timestamp | Date | null;
  payment_financial_entry_id?: string | null;
  notes: string | null;
  import_batch_id?: string | null;
  created_at: Timestamp | Date;
  updated_at: Timestamp | Date;
}

export type PayableStatus = 'open' | 'paid' | 'overdue' | 'negotiated' | 'canceled';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface ClinicPayable {
  id: string;
  description: string;
  supplier: string | null;
  category: string;
  amount: number;
  due_date: string;
  status: PayableStatus;
  priority: Priority;
  payment_method: string | null;
  paid_at: Timestamp | Date | null;
  notes: string | null;
  is_recurring: boolean;
  recurrence_rule?: string | null;
  created_at: Timestamp | Date;
  updated_at: Timestamp | Date;
}

export interface FinancialEntryExtension {
  sale_responsible_id?: string | null;
  sale_responsible_name?: string | null;
  collection_responsible_id?: string | null;
  collection_responsible_name?: string | null;
  procedure_responsible_id?: string | null;
  procedure_responsible_name?: string | null;
  commission_generated?: boolean;
  commission_ids?: string[];
  is_overdue_recovery?: boolean;
  original_due_date?: string | null;
  received_after_due_date?: boolean;
}

export type CollectionStatus = 'não iniciado' | 'em contato' | 'prometeu pagar' | 'negociado' | 'pago' | 'sem resposta' | 'incobrável';

export interface OverdueReceivable {
  id?: string;
  patient_id: string;
  patient_name: string;
  amount: number;
  due_date: string;
  days_overdue: number;
  collection_responsible_id: string | null;
  collection_status: CollectionStatus;
  next_follow_up_date?: string | null;
  promise_to_pay_date?: string | null;
  collection_notes?: string | null;
  reprogramming_history?: any[];
  description?: string;
  raw?: any;
}
