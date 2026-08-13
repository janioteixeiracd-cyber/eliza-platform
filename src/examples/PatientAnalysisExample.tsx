/**
 * Patient Analysis Example Component
 * Shows how to use ELIZA Intelligence Layer in a React component
 *
 * Usage:
 * 1. User logs in
 * 2. Component loads with patient ID
 * 3. Calls ELIZA to analyze patient
 * 4. Shows results + suggested actions
 */

import React, { useState, useEffect } from "react";
import { useEliza } from "../hooks/useEliza";
import { ElizaIntelligenceRequest } from "../types/eliza-intelligence";

interface PatientAnalysisExampleProps {
  patientId: string;
  clinicId: string;
  firebaseUid: string;
}

export function PatientAnalysisExample({
  patientId,
  clinicId,
  firebaseUid,
}: PatientAnalysisExampleProps) {
  // ========================================================================
  // SETUP
  // ========================================================================

  const eliza = useEliza();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // ========================================================================
  // LIFECYCLE
  // ========================================================================

  // Step 1: Login on mount
  useEffect(() => {
    if (!eliza.isAuthenticated && eliza.isInitialized) {
      eliza
        .login(firebaseUid, clinicId)
        .then(() => {
          setIsLoggedIn(true);
          setLoginError(null);
        })
        .catch((err) => {
          setLoginError(err.message);
          console.error("Login failed:", err);
        });
    }
  }, [eliza, firebaseUid, clinicId]);

  // Step 2: Analyze patient once logged in
  const handleAnalyzePatient = async () => {
    if (!eliza.isAuthenticated) {
      setLoginError("Não autenticado");
      return;
    }

    const request: ElizaIntelligenceRequest = {
      taskType: "patient_analysis",
      prompt: `Por favor, analise o prontuário do paciente ${patientId} de forma completa. 
               Forneça: resumo clínico, alergias/alertas, condições relevantes, procedimentos recentes, 
               pendências, retornos atrasados, ações prioritárias sugeridas.`,
      patientId,
      conversationId: `patient-analysis-${patientId}-${Date.now()}`,
      requestedTools: ["read_patient_record"],
    };

    try {
      const response = await eliza.analyze(request);

      if (response.success) {
        return response.data;
      } else {
        setLoginError("Erro na análise");
      }
    } catch (err: any) {
      setLoginError(err.message);
    }
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  if (!isLoggedIn) {
    return (
      <div className="p-4 border border-red-200 bg-red-50 rounded">
        <h3 className="font-bold text-red-800">Autenticação</h3>
        <p className="text-red-700">
          {loginError || "Autenticando..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="border-b pb-4">
        <h2 className="text-2xl font-bold">Análise de Paciente</h2>
        <p className="text-gray-600">Paciente: {patientId}</p>
        {eliza.currentUser && (
          <p className="text-sm text-gray-500">
            Conectado como: {eliza.currentUser.userInfo?.name || eliza.currentUser.userId}
            {" "}({eliza.currentUser.role})
          </p>
        )}
      </div>

      {/* Analysis Button */}
      <button
        onClick={handleAnalyzePatient}
        disabled={eliza.analysisState.loading}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
      >
        {eliza.analysisState.loading ? "Analisando..." : "Analisar Paciente"}
      </button>

      {/* Error */}
      {eliza.analysisState.error && (
        <div className="p-4 border border-red-200 bg-red-50 rounded">
          <h4 className="font-bold text-red-800">Erro</h4>
          <p className="text-red-700">{eliza.analysisState.error}</p>
        </div>
      )}

      {/* Results */}
      {eliza.analysisState.data?.success && (
        <div className="space-y-4">
          {/* Analysis Result */}
          <div className="border border-green-200 bg-green-50 rounded p-4">
            <h3 className="font-bold text-green-800 mb-2">Análise</h3>
            <div className="prose prose-sm max-w-none text-gray-800">
              {eliza.analysisState.data.data.analysisResult.content}
            </div>
          </div>

          {/* Alerts */}
          {eliza.analysisState.data.data.analysisResult.alerts &&
            eliza.analysisState.data.data.analysisResult.alerts.length > 0 && (
              <div className="border border-yellow-200 bg-yellow-50 rounded p-4">
                <h3 className="font-bold text-yellow-800 mb-2">Alertas</h3>
                <ul className="list-disc pl-5 text-yellow-700">
                  {eliza.analysisState.data.data.analysisResult.alerts.map((alert, i) => (
                    <li key={i}>{alert}</li>
                  ))}
                </ul>
              </div>
            )}

          {/* Metadata */}
          <div className="bg-gray-100 rounded p-4 text-xs text-gray-600">
            <p>
              <strong>Modelo:</strong>{" "}
              {eliza.analysisState.data.data.metadata.modelUsed}
            </p>
            <p>
              <strong>Tokens:</strong>{" "}
              {eliza.analysisState.data.data.metadata.tokensUsed.total}
            </p>
            <p>
              <strong>Tempo:</strong>{" "}
              {eliza.analysisState.data.data.metadata.processingTime}ms
            </p>
            <p>
              <strong>Request ID:</strong>{" "}
              {eliza.analysisState.data.audit.requestId}
            </p>
          </div>

          {/* Suggested Actions */}
          {eliza.analysisState.data.data.suggestedNextSteps &&
            eliza.analysisState.data.data.suggestedNextSteps.length > 0 && (
              <div className="border border-blue-200 bg-blue-50 rounded p-4">
                <h3 className="font-bold text-blue-800 mb-2">Próximos Passos</h3>
                <ol className="list-decimal pl-5 text-blue-700 space-y-1">
                  {eliza.analysisState.data.data.suggestedNextSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
        </div>
      )}

      {/* Logout */}
      <button
        onClick={() => {
          eliza.logout();
          setIsLoggedIn(false);
        }}
        className="mt-4 px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500 text-sm"
      >
        Logout
      </button>
    </div>
  );
}

// ============================================================================
// USAGE IN APP
// ============================================================================

/*
In your main App component:

import { ElizaProvider } from "./hooks/useEliza";
import { PatientAnalysisExample } from "./examples/PatientAnalysisExample";

function App() {
  return (
    <ElizaProvider>
      <PatientAnalysisExample
        patientId="patient-123"
        clinicId="clinic-456"
        firebaseUid="firebase-user-789"
      />
    </ElizaProvider>
  );
}

export default App;
*/
