/**
 * useEliza Hook
 * React hook for easy access to ELIZA Intelligence API
 */

import { useState, useCallback, useEffect } from "react";
import { ElizaFrontendClient } from "../lib/elizaFrontendClient";
import { ElizaIntelligenceRequest, ElizaIntelligenceResponse } from "../types/eliza-intelligence";

// ============================================================================
// TYPES
// ============================================================================

export interface UseElizaOptions {
  autoInitialize?: boolean;
}

export interface ElizaAnalysisState {
  loading: boolean;
  error: string | null;
  data: ElizaIntelligenceResponse | null;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useEliza(options: UseElizaOptions = {}) {
  const { autoInitialize = true } = options;

  const [client, setClient] = useState<ElizaFrontendClient | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [analysisState, setAnalysisState] = useState<ElizaAnalysisState>({
    loading: false,
    error: null,
    data: null,
  });

  // Initialize client
  useEffect(() => {
    if (autoInitialize && !client) {
      const elizaClient = new ElizaFrontendClient({
        onTokenExpired: () => {
          setIsAuthenticated(false);
          setCurrentUser(null);
        },
      });
      setClient(elizaClient);
      setIsAuthenticated(elizaClient.isAuthenticated());
    }
  }, [autoInitialize, client]);

  // ========================================================================
  // AUTHENTICATION
  // ========================================================================

  const login = useCallback(
    async (firebaseUid: string, clinicId: string) => {
      if (!client) throw new Error("Client not initialized");

      try {
        const response = await client.login({ firebaseUid, clinicId });
        setIsAuthenticated(true);

        // Load user info
        const user = await client.getCurrentUser();
        setCurrentUser(user);

        return response;
      } catch (err: any) {
        setIsAuthenticated(false);
        throw err;
      }
    },
    [client]
  );

  const logout = useCallback(async () => {
    if (!client) throw new Error("Client not initialized");
    await client.logout();
    setIsAuthenticated(false);
    setCurrentUser(null);
  }, [client]);

  // ========================================================================
  // INTELLIGENCE API
  // ========================================================================

  const analyze = useCallback(
    async (request: ElizaIntelligenceRequest) => {
      if (!client) throw new Error("Client not initialized");
      if (!isAuthenticated) throw new Error("Not authenticated");

      setAnalysisState({ loading: true, error: null, data: null });

      try {
        const response = await client.analyze(request);
        setAnalysisState({ loading: false, error: null, data: response });
        return response;
      } catch (err: any) {
        const errorMessage = err.message || "Analysis failed";
        setAnalysisState({ loading: false, error: errorMessage, data: null });
        throw err;
      }
    },
    [client, isAuthenticated]
  );

  const getTools = useCallback(async () => {
    if (!client) throw new Error("Client not initialized");
    return await client.getAvailableTools();
  }, [client]);

  const approveAction = useCallback(
    async (actionId: string) => {
      if (!client) throw new Error("Client not initialized");
      return await client.approveAction(actionId);
    },
    [client]
  );

  // ========================================================================
  // RETURN
  // ========================================================================

  return {
    // Client
    client,
    isInitialized: client !== null,

    // Authentication
    isAuthenticated,
    currentUser,
    login,
    logout,

    // Intelligence
    analyze,
    analysisState,
    getTools,
    approveAction,

    // Utils
    getToken: () => client?.getToken() || null,
  };
}

// ============================================================================
// CONTEXT FOR PROVIDER PATTERN (OPTIONAL)
// ============================================================================

import * as React from "react";
import { createContext, ReactNode } from "react";

export const ElizaContext = createContext<ReturnType<typeof useEliza> | null>(null);

export interface ElizaProviderProps {
  children: ReactNode;
  options?: UseElizaOptions;
}

export function ElizaProvider({ children, options }: ElizaProviderProps) {
  const eliza = useEliza(options);

  return <ElizaContext.Provider value={eliza}>{children}</ElizaContext.Provider>;
}

// Hook to use ElizaContext
export function useElizaContext() {
  const context = React.useContext(ElizaContext);
  if (!context) {
    throw new Error("useElizaContext must be used within ElizaProvider");
  }
  return context;
}
