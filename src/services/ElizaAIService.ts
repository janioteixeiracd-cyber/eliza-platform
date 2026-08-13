import { getGenAI } from "../lib/gemini";
import { AI_CONFIG } from "../config/ai";
import { Type } from "@google/genai";

export interface ElizaStructuredResponse {
  summary: string;
  discrepancyAnalysis: string;
  possibleCauses: string[];
  recommendations: string[];
  riskLevel: "Baixo" | "Médio" | "Alto";
  confidence: number;
  generatedAt: string;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "Resumo executivo humanizado, claro e elegante dos fatos em português." },
    discrepancyAnalysis: { type: Type.STRING, description: "Análise profunda científica de quaisquer inconsistências, divergências ou padrões incomuns." },
    possibleCauses: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Lista de possíveis causas operacionais ou sistêmicas para a situação apurada." 
    },
    recommendations: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Ações práticas que a gestão da clínica deve tomar imediatamente para resolver ou otimizar o cenário." 
    },
    riskLevel: { 
      type: Type.STRING, 
      enum: ["Baixo", "Médio", "Alto"],
      description: "Classificação geral de risco para a integridade dos dados ou finanças." 
    },
    confidence: { type: Type.NUMBER, description: "Nível estimado de confiança na análise, de 0.0 a 1.0." },
    generatedAt: { type: Type.STRING, description: "Timestamp de geração da análise no formato YYYY-MM-DD HH:mm" }
  },
  required: ["summary", "discrepancyAnalysis", "possibleCauses", "recommendations", "riskLevel", "confidence", "generatedAt"]
};

export const ElizaAIService = {
  async runAnalysis(prompt: string, contextDescription: string): Promise<ElizaStructuredResponse> {
    console.log("[ELIZA_AI] provider:", AI_CONFIG.provider);
    console.log("[ELIZA_AI] model:", AI_CONFIG.model);
    console.log("[ELIZA_AI] key exists:", !!AI_CONFIG.apiKey);

    try {
      const ai = getGenAI();
      const finalPrompt = `
        Você é a ELIZA, mentora operacional inteligente de clínicas odontológicas. 
        Analise meticulosamente os dados fornecidos abaixo e gere um relatório estruturado no formato JSON solicitado.
        Seja empática, altamente profissional, objetiva e foque em dar insights valiosos de negócios.

        SITUAÇÃO / CONTEXTO:
        ${contextDescription}

        DADOS ANALISADOS:
        ${prompt}
      `;

      let response;
      try {
        console.log(`[ELIZA_AI] calling primary model: models/${AI_CONFIG.model}:generateContent`);
        response = await ai.models.generateContent({
          model: AI_CONFIG.model,
          contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA
          }
        });
      } catch (err) {
        console.error("[ELIZA_AI_MODEL_ERROR] Primary model failed, trying fallback...", err);
        console.log(`[ELIZA_AI] calling fallback model: models/${AI_CONFIG.fallbackModel}:generateContent`);
        response = await ai.models.generateContent({
          model: AI_CONFIG.fallbackModel,
          contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA
          }
        });
      }

      console.log("[ELIZA_AI] response:", response);

      const text = response.text;
      if (!text) {
        throw new Error("EMPTY_RESPONSE");
      }

      return JSON.parse(text) as ElizaStructuredResponse;
    } catch (error: any) {
      console.error("[ELIZA_AI] error:", error);
      throw new Error("A ELIZA AI não conseguiu gerar a análise agora. Verifique a configuração do modelo de IA.");
    }
  },

  async analyzeReconciliation({
    clinicId,
    date,
    closingTotal,
    systemTotal,
    detailsText
  }: {
    clinicId: string;
    date: string;
    closingTotal: number;
    systemTotal: number;
    detailsText?: string;
  }): Promise<ElizaStructuredResponse> {
    const payload = {
      date,
      closingTotal,
      systemTotal,
      difference: closingTotal - systemTotal,
      detailsText: detailsText || "Sem detalhes adicionais"
    };

    const context = "Fechamento de caixa diário e conciliação de saldos em dinheiro, cartões e pix.";
    const dataPrompt = `
      Data: ${payload.date}
      Total Fechado (Operacional/Físico): R$ ${payload.closingTotal.toFixed(2)}
      Total no Sistema (Deveria ter): R$ ${payload.systemTotal.toFixed(2)}
      Diferença (Falta ou Sobra): R$ ${payload.difference.toFixed(2)}
      Lançamentos Adicionais e Logs: ${payload.detailsText}
    `;

    return this.runAnalysis(dataPrompt, context);
  },

  async analyzeFinancial({
    clinicId,
    startDate,
    endDate,
    totalIncome,
    totalExpense,
    categoryBreakdown
  }: {
    clinicId: string;
    startDate: string;
    endDate: string;
    totalIncome: number;
    totalExpense: number;
    categoryBreakdown: Record<string, number>;
  }): Promise<ElizaStructuredResponse> {
    const context = "Avaliação de saúde financeira, fluxo de caixa e rentabilidade das especialidades da clínica.";
    const dataPrompt = `
      Período: ${startDate} até ${endDate}
      Receitas Consolidadas: R$ ${totalIncome.toFixed(2)}
      Despesas Consolidadas: R$ ${totalExpense.toFixed(2)}
      Saldo Líquido / Margem: R$ ${(totalIncome - totalExpense).toFixed(2)}
      Divisão de Gastos/Ganhos por Categoria: ${JSON.stringify(categoryBreakdown)}
    `;

    return this.runAnalysis(dataPrompt, context);
  },

  async analyzePatientHistory({
    clinicId,
    patientName,
    treatmentsCount,
    lastVisitDate,
    historyText
  }: {
    clinicId: string;
    patientName: string;
    treatmentsCount: number;
    lastVisitDate: string;
    historyText: string;
  }): Promise<ElizaStructuredResponse> {
    const context = "Comportamento clínico e histórico odontológico do paciente para gerar propostas preventivas e de acompanhamento personalizado.";
    const dataPrompt = `
      Paciente: ${patientName}
      Quantidade de Tratamentos: ${treatmentsCount}
      Última Consulta: ${lastVisitDate}
      Evoluções anteriores e observações anamnese: ${historyText}
    `;

    return this.runAnalysis(dataPrompt, context);
  },

  async analyzeInventory({
    clinicId,
    criticalItemsCount,
    totalSubsystemValue,
    itemsList
  }: {
    clinicId: string;
    criticalItemsCount: number;
    totalSubsystemValue: number;
    itemsList: any[];
  }): Promise<ElizaStructuredResponse> {
    const context = "Análise inteligente de suprimentos, identificação de gargalos de compras e risco de vencimento próximo.";
    const dataPrompt = `
      Itens com Estoque Crítico: ${criticalItemsCount}
      Valor aproximado do patrimônio de estoque: R$ ${totalSubsystemValue.toFixed(2)}
      Listagem resumida de materiais ativos: ${JSON.stringify(itemsList.slice(0, 15).map(i => ({ name: i.name, stock: i.stock, min: i.minStock, category: i.category, val: i.expiry })))}
    `;

    return this.runAnalysis(dataPrompt, context);
  },

  async generateInsights({
    clinicId,
    statsContext
  }: {
    clinicId: string;
    statsContext: any;
  }): Promise<ElizaStructuredResponse> {
    const context = "Geração de insights operacionais globais, benchmarks de faturamento, novos agendamentos e taxas de absenteísmo.";
    const dataPrompt = `
      Métricas gerais da clínica no momento: ${JSON.stringify(statsContext)}
    `;

    return this.runAnalysis(dataPrompt, context);
  }
};
