import { collection, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getGenAI } from "../lib/gemini";
import { AI_CONFIG } from "../config/ai";

interface AnalyzeReconciliationParams {
  clinicId: string;
  date: string; // "YYYY-MM-DD" style
  closingTotal: number;
  systemTotal: number;
}

export const ElizaAnalysisService = {
  async analyzeReconciliation({ clinicId, date, closingTotal, systemTotal }: AnalyzeReconciliationParams): Promise<string> {
    console.log("[ELIZA_AI] Starting reconciliation analysis");
    console.log("[ELIZA_AI] clinicId:", clinicId);

    let entries: any[] = [];
    try {
      const colRef = collection(db, 'clinics', clinicId, 'financial_entries');
      const snap = await getDocs(colRef);
      entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error: any) {
      console.log("[ELIZA_AI] error fetching entries from Firestore:", error);
      throw error;
    }

    console.log("[ELIZA_AI] entries:", entries.length);

    // Filter entries corresponding to our target date
    const targetDateStr = date;
    const dayEntries = entries.filter(e => {
      const dateVal = e.date || e.createdAt;
      if (!dateVal) return false;
      try {
        const parsedDate = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
        if (isNaN(parsedDate.getTime())) return false;
        return parsedDate.toISOString().split('T')[0] === targetDateStr;
      } catch {
        return false;
      }
    });

    const difference = closingTotal - systemTotal;
    const entriesPaid = dayEntries.filter(e => e.status === 'pago');
    const entriesPending = dayEntries.filter(e => e.status === 'pendente' || e.status === 'aberto' || e.status === 'atrasado');

    const incomeEntries = dayEntries.filter(e => e.type === 'receita');
    const expenseEntries = dayEntries.filter(e => e.type === 'despesa');

    const totalIncome = incomeEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalExpense = expenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // Compute payment methods
    const paymentMethodsMap: { [key: string]: number } = {};
    const noPaymentMethodEntries: any[] = [];
    dayEntries.forEach(e => {
      const method = e.payment_method || e.paymentMethod;
      if (e.status === 'pago') {
        if (method) {
          paymentMethodsMap[method] = (paymentMethodsMap[method] || 0) + (Number(e.amount) || 0);
        } else {
          noPaymentMethodEntries.push(e);
        }
      }
    });

    const uniquePatients = Array.from(new Set(dayEntries.map(e => e.patient_name || e.patientName).filter(Boolean)));
    const uniqueCreators = Array.from(new Set(dayEntries.map(e => e.createdByName || e.createdBy || e.creatorName).filter(Boolean)));

    // Look for divergences Automatically
    const possibleDivergences: string[] = [];
    if (noPaymentMethodEntries.length > 0) {
      possibleDivergences.push(`Existem ${noPaymentMethodEntries.length} lançamentos pagos sem forma de pagamento registrada.`);
    }
    if (entriesPending.length > 0) {
      possibleDivergences.push(`Existem ${entriesPending.length} lançamentos pendentes com vencimento hoje.`);
    }

    // Check if absolute difference matches any specific entries
    const matchingDiffEntries = dayEntries.filter(e => Math.abs((Number(e.amount) || 0) - Math.abs(difference)) < 0.01);
    if (matchingDiffEntries.length > 0) {
      matchingDiffEntries.forEach(e => {
        possibleDivergences.push(`O lançamento "${e.description}" com valor de R$ ${Number(e.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} coincide exatamente com o valor da diferença.`);
      });
    }

    const payload = {
      date,
      closingTotal,
      systemTotal,
      difference,
      entradasCount: incomeEntries.length,
      entradasTotal: totalIncome,
      saidasCount: expenseEntries.length,
      saidasTotal: totalExpense,
      formasPagamentoMap: paymentMethodsMap,
      lancamentosPendentes: entriesPending.map(e => ({
        id: e.id,
        description: e.description,
        amount: e.amount,
        type: e.type,
        patientName: e.patient_name || e.patientName || 'Não Informado'
      })),
      lancamentosPagos: entriesPaid.map(e => ({
        id: e.id,
        description: e.description,
        amount: e.amount,
        type: e.type,
        paymentMethod: e.payment_method || e.paymentMethod || 'Não Informado',
        patientName: e.patient_name || e.patientName || 'Não Informado'
      })),
      pacientesVinculados: uniquePatients,
      usuariosLancadores: uniqueCreators,
      possiveisDivergencias: possibleDivergences,
      semFormaDePagamento: noPaymentMethodEntries.map(e => ({
        id: e.id,
        description: e.description,
        amount: e.amount,
        type: e.type
      }))
    };

    console.log("[ELIZA_AI] payload:", payload);

    try {
      const ai = getGenAI();
      const prompt = `
        Aja como ELIZA, a inteligência operacional avançada da clínica odontológica. Seu papel agora é conduzir uma análise pericial de conciliação financeira de fechamento de caixa para a data ${payload.date}.

        Aqui estão os dados reais da clínica capturados do sistema:
        - Data do Fechamento: ${payload.date}
        - Total Informado no Fechamento: R$ ${payload.closingTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        - Total Calculado pelo Sistema: R$ ${payload.systemTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        - Diferença Apurada: R$ ${payload.difference.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

        Resumo das Transações:
        - Entradas do Dia: ${payload.entradasCount} lançamentos, totalizando R$ ${payload.entradasTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        - Saídas do Dia: ${payload.saidasCount} lançamentos, totalizando R$ ${payload.saidasTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        - Divisão por Forma de Pagamento Registrada: ${JSON.stringify(payload.formasPagamentoMap)}
        - Pacientes Atendidos/Vinculados: ${payload.pacientesVinculados.join(', ') || 'Nenhum'}
        - Operadores/Usuários que Lançaram: ${payload.usuariosLancadores.join(', ') || 'Nenhum'}
        - Pagamentos sem forma de pagamento indicada: ${JSON.stringify(payload.semFormaDePagamento)}
        
        Lançamentos Pendentes no período:
        ${JSON.stringify(payload.lancamentosPendentes)}

        Lançamentos Pagos no período:
        ${JSON.stringify(payload.lancamentosPagos)}

        Possíveis Alertas e Pistas de Divergências Identificadas Automaticamente:
        ${payload.possiveisDivergencias.length > 0 ? payload.possiveisDivergencias.map((d, i) => `${i+1}. ${d}`).join('\n') : 'Nenhum alerta imediato.'}

        Sua resposta DEVE ser extremamente humana, clara, direta, elegante e prática. Explique rigorosamente:
        1. Se houve sobra (diferença positiva) ou falta (diferença negativa) de caixa ou equilibrado.
        2. O valor exato da diferença.
        3. Quais lançamentos específicos podem justificar a diferença (olhe os alertas de valores coincidentes ou formas de pagamento ausentes).
        4. Identifique precisamente quais pagamentos estão sem forma de pagamento preenchida.
        5. Quais lançamentos estão apenas pendentes/não liquidados no período.
        6. Forneça uma sugestão prática de passo-a-passo operacional para corrigir ou auditar esse problema hoje.
        7. Forneça um nível de confiança da sua análise (ex: "Nível de Confiança: Alta/Média/Baixa") com uma justificativa curtíssima baseada nos dados disponíveis.

        Regras importantes de estilo:
        - Use formatação Markdown profissional com títulos discretos, sem exagero de emojis.
        - Não cite que você é uma IA "criada pela Google" ou algo similar; seja simplesmente a ELIZA, mentora operacional da clínica.
        - Cite valores em R$ e use nomes reais contidos no payload para dar credibilidade absoluta à análise.
      `;

      let result;
      try {
        console.log(`[ELIZA_AI] calling primary model: models/${AI_CONFIG.model}:generateContent`);
        result = await ai.models.generateContent({
          model: AI_CONFIG.model,
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        });
      } catch (err) {
        console.error("[ELIZA_AI_MODEL_ERROR] Primary model failed, trying fallback...", err);
        console.log(`[ELIZA_AI] calling fallback model: models/${AI_CONFIG.fallbackModel}:generateContent`);
        result = await ai.models.generateContent({
          model: AI_CONFIG.fallbackModel,
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        });
      }

      if (!result.text) {
        throw new Error("Empty response returned from Gemini API");
      }

      return result.text;
    } catch (error: any) {
      console.log("[ELIZA_AI] error:", error);
      throw error;
    }
  }
};
