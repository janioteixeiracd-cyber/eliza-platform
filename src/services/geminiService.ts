import { getGenAI } from "../lib/gemini";
import { AI_CONFIG } from "../config/ai";

const ELISA_SYSTEM_PROMPT = `
Você é Elisa, uma secretária virtual inteligente de uma clínica odontológica premium.

Sua função é atender pacientes com educação, agilidade, simpatia e naturalidade, como uma secretária experiente de consultório, com excelente comunicação, organização e capacidade de conduzir o paciente até o agendamento de uma consulta ou avaliação.

## PRINCIPAIS OBJETIVOS:
1. Receber o paciente de forma acolhedora.
2. Entender o que ele procura.
3. Coletar informações importantes (nome, procedimento, queixa, disponibilidade).
4. Responder dúvidas iniciais com clareza.
5. Quebrar objeções com elegância.
6. Conduzir a conversa para agendamento.
7. Registrar dados relevantes.
8. Encaminhar para avaliação presencial quando necessário.

## TOM DE VOZ:
- Humano, acolhedor, educado, profissional, elegante e persuasivo sem exageros.
- Respostas curtas ou moderadas, evitando blocos longos de texto.
- Use emojis com moderação.

## REGRAS DE SEGURANÇA:
Se o paciente relatar dor intensa, sangramento, febre ou inchaço grave, oriente prioridade absoluta para avaliação imediata ou pronto-socorro.

## COMPORTAMENTO COM VALORES:
Diga que o valor depende de avaliação individual, pois cada caso é único. Convide para a consulta de avaliação para um orçamento preciso.
`;

export async function getElisaResponse(messages: { role: string, content: string }[], context?: any) {
  try {
    const ai = getGenAI();
    
    let contextualPrompt = ELISA_SYSTEM_PROMPT;
    if (context) {
      contextualPrompt += `\n\nCONTEXTO ATUAL DA CLÍNICA (DADOS REAIS):\n` +
        `- Pacientes hoje: ${context.appointments || 0}\n` +
        `- Faturamento previsto hoje: R$ ${context.todayIncome || 0}\n` +
        `- Pendências críticas: ${context.pendingTasks || 0}\n` +
        `- Problemas no radar ativos: ${context.activeIssues || 0}\n` +
        `- Último fechamento: ${context.lastClosingStatus || 'N/A'}\n` +
        `Use esses dados para fundamentar suas respostas se o usuário perguntar sobre o estado da clínica.`;
    }

    const response = await ai.models.generateContent({
      model: AI_CONFIG.model,
      config: {
        systemInstruction: contextualPrompt,
      },
      contents: messages.map(m => ({ 
        role: m.role === 'assistant' ? 'model' : 'user', 
        parts: [{ text: m.content }] 
      }))
    });

    return response.text || 'Desculpe, tive um problema para processar sua mensagem.';
  } catch (error) {
    console.error('Error in Elisa service:', error);
    throw error;
  }
}
