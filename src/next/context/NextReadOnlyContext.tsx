import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { NextAuditLog, NextServiceState } from '../types/next-types';

interface NextReadOnlyContextType {
  state: NextServiceState;
  auditLogs: NextAuditLog[];
  addAuditLog: (log: Omit<NextAuditLog, 'id' | 'timestamp'>) => void;
  clearAuditLogs: () => void;
}

const NextReadOnlyContext = createContext<NextReadOnlyContextType | undefined>(undefined);

export function NextReadOnlyProvider({ children }: { children: React.ReactNode }) {
  const { user, clinic } = useAuth();
  const [auditLogs, setAuditLogs] = useState<NextAuditLog[]>([]);

  // Historical note: this module started as a strictly read-only sandbox
  // (isReadOnly/sandboxMode were hardcoded true). That's no longer accurate —
  // Agenda, Prontuário, Financeiro, Estoque, Painel Admin e Academy already
  // write real data. Nothing currently reads these two fields (kept on the
  // type for backwards compatibility), so they're set to reflect reality
  // rather than the old sandbox posture.
  const state: NextServiceState = {
    isReadOnly: false,
    sandboxMode: false,
    dbConnected: !!user,
    activeClinicId: clinic?.id || null,
    activeUserId: user?.uid || null
  };

  const addAuditLog = (log: Omit<NextAuditLog, 'id' | 'timestamp'>) => {
    const newLog: NextAuditLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date()
    };
    setAuditLogs(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
    
    // Log in development console for debugging
    console.log(`[ELIZA NEXT AUDIT] [${newLog.action}] [${newLog.status}] Collection: ${newLog.collection}`, newLog.details || '');
  };

  const clearAuditLogs = () => {
    setAuditLogs([]);
  };

  // Add initial audit logs for sandbox boot
  useEffect(() => {
    addAuditLog({
      collection: 'system',
      action: 'READ',
      status: 'SUCCESS',
      details: 'Isolamento de ambiente iniciado. ELIZA NEXT 2.0 operacional — leituras e gravações reais.'
    });
  }, []);

  return (
    <NextReadOnlyContext.Provider value={{ state, auditLogs, addAuditLog, clearAuditLogs }}>
      {children}
    </NextReadOnlyContext.Provider>
  );
}

export function useNextReadOnly() {
  const context = useContext(NextReadOnlyContext);
  if (context === undefined) {
    throw new Error('useNextReadOnly must be used within a NextReadOnlyProvider');
  }
  return context;
}
