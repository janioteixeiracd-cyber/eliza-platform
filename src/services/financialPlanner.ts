import { getGenAI } from "../lib/gemini";
import { AI_CONFIG } from "../config/ai";
import { ClinicPayable, Commission, OverdueReceivable } from "../types/finance";

const FINANCIAL_PLANNER_PROMPT = `
Você é a inteligência financeira da ELIZA. Sua função é analisar contas a pagar, contas atrasadas, receitas abertas, receitas recebidas, comissões da equipe e histórico financeiro. 
Gere planos práticos e realistas para melhorar o caixa, priorizar pagamentos, recuperar inadimplência e evitar atraso de comissões. 

REGRAS:
1. Não invente valores. Use apenas os dados fornecidos.
2. Quando faltar dado, sinalize incerteza. 
3. Trabalhe com cenários: conservador, provável e otimista. 
4. Dê recomendações claras, numeradas e com justificativa.
5. Retorne a resposta em formato estruturado (JSON ou Markdown limpo).

ESTRUTURA DESEJADA:
- Diagnóstico Financeiro
- Plano de Ação (7, 15, 30 dias)
- Prioridades de Pagamento
- Lista de Cobrança Prioritária
- Cenários de Recebimento
- Sugestões de Renegociação
`;

export interface PlanningContext {
  payables: ClinicPayable[];
  overdueReceivables: OverdueReceivable[];
  pendingCommissions: Commission[];
  upcomingReceivables: any[];
  historicalAverageReceipts: number;
  historicalAverageExpenses: number;
}

export async function generateFinancialPlan(context: PlanningContext) {
  try {
    const ai = getGenAI();
    
    const promptData = `
DADOS PARA ANÁLISE:
- Contas a Pagar: ${JSON.stringify(context.payables)}
- Recebimentos Atrasados: ${JSON.stringify(context.overdueReceivables)}
- Comissões Pendentes: ${JSON.stringify(context.pendingCommissions)}
- Recebimentos Previstos: ${JSON.stringify(context.upcomingReceivables)}
- Média Histórica Recebimento: R$ ${context.historicalAverageReceipts}
- Média Histórica Despesa: R$ ${context.historicalAverageExpenses}
`;

    const response = await ai.models.generateContent({
      model: AI_CONFIG.model, 
      config: {
        systemInstruction: FINANCIAL_PLANNER_PROMPT,
        responseMimeType: "application/json"
      },
      contents: [{
        role: 'user',
        parts: [{ text: promptData }]
      }]
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error('Error generating financial plan:', error);
    throw error;
  }
}
