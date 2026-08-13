export interface NextServiceState {
  isReadOnly: boolean;
  sandboxMode: boolean;
  dbConnected: boolean;
  activeClinicId: string | null;
  activeUserId: string | null;
}

export interface NextAuditLog {
  id: string;
  timestamp: Date;
  collection: string;
  action: 'READ' | 'QUERY' | 'WRITE_BLOCKED' | 'WRITE';
  parameters?: Record<string, any>;
  resultCount?: number;
  status: 'SUCCESS' | 'BLOCKED';
  details?: string;
}

export interface NextFeatureState {
  id: string;
  name: string;
  status: 'planning' | 'development' | 'testing' | 'stable';
  sprint: number;
  description: string;
  targetDate: string;
}
