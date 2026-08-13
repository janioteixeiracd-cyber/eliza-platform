import { getGenAI } from "../lib/gemini";
import { AI_CONFIG } from "../config/ai";
import { Type } from "@google/genai";

export interface ExtractedPatientData {
  patient: {
    name: string;
    phone: string;
    email: string;
    cpf: string;
    birthDate: string;
    address: string;
    notes: string;
  };
  clinicalHistory: Array<{
    date: string;
    type: string;
    description: string;
    professional: string;
    products: string;
    notes: string;
    confidence: "alta" | "média" | "baixa";
  }>;
  financialHistory: Array<{
    date: string;
    description: string;
    amount: number;
    paidAmount: number;
    pendingAmount: number;
    status: "pending" | "paid" | "partial";
    paymentMethod: string;
    installments: number;
    notes: string;
    confidence: "alta" | "média" | "baixa";
  }>;
  alerts: string[];
  missingInformation: string[];
  confidence: "alta" | "média" | "baixa";
}

const PATIENT_MIGRATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    patient: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Nome completo do paciente." },
        phone: { type: Type.STRING, description: "Telefone ou WhatsApp de contato." },
        email: { type: Type.STRING, description: "E-mail cadastrado." },
        cpf: { type: Type.STRING, description: "CPF do paciente." },
        birthDate: { type: Type.STRING, description: "Data de nascimento." },
        address: { type: Type.STRING, description: "Endereço residencial." },
        notes: { type: Type.STRING, description: "Anotações livre do cadastro anterior." }
      },
      required: ["name", "phone", "email", "cpf", "birthDate", "address", "notes"]
    },
    clinicalHistory: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Data do procedimento/evolução no formato ISO 8601 (YYYY-MM-DD) ou aproximada se não souber." },
          type: { type: Type.STRING, description: "Tipo de procedimento, ex: Restauração, Limpeza, Implante, Ortodontia, Avaliação, etc." },
          description: { type: Type.STRING, description: "Detalhes do dente, procedimentos realizados ou evolução médica." },
          professional: { type: Type.STRING, description: "Nome do profissional/dentista responsável se indicado." },
          products: { type: Type.STRING, description: "Materiais ou produtos aplicados (ex: marca do implante, resina, etc.)." },
          notes: { type: Type.STRING, description: "Observações extras da sessão clínica." },
          confidence: { type: Type.STRING, enum: ["alta", "média", "baixa"], description: "Confiança da IA na precisão deste registro clínico." }
        },
        required: ["date", "type", "description", "professional", "products", "notes", "confidence"]
      }
    },
    financialHistory: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Data de vencimento ou pagamento (YYYY-MM-DD)." },
          description: { type: Type.STRING, description: "Descrição do item ou parcela financeira (ex: Parcela 1/5 - Implante)." },
          amount: { type: Type.NUMBER, description: "Valor total cobrado neste lançamento." },
          paidAmount: { type: Type.NUMBER, description: "Valor já quitado (pago)." },
          pendingAmount: { type: Type.NUMBER, description: "Valor ainda em aberto (pago restante)." },
          status: { type: Type.STRING, enum: ["pending", "paid", "partial"], description: "Vencido/Aberto = pending. Pago = paid. Pago parcial = partial." },
          paymentMethod: { type: Type.STRING, description: "Forma de pagamento (Cartão, PIX, Boleto, Cheque, Dinheiro, etc.)." },
          installments: { type: Type.INTEGER, description: "Número de parcelas totais ou número da parcela se puder inferir." },
          notes: { type: Type.STRING, description: "Observações do financeiro." },
          confidence: { type: Type.STRING, enum: ["alta", "média", "baixa"], description: "Confiança da IA na precisão deste lançamento financeiro." }
        },
        required: ["date", "description", "amount", "paidAmount", "pendingAmount", "status", "paymentMethod", "installments", "notes", "confidence"]
      }
    },
    alerts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Alertas clínicos ou financeiros cruciais detectados, como alergias marcadas de vermelho, tratamentos incompletos ou dívidas expressivas."
    },
    missingInformation: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Dados padrão do paciente ausentes nos arquivos que devesse solicitar ao paciente futuramente."
    },
    confidence: { type: Type.STRING, enum: ["alta", "média", "baixa"], description: "Nível de confiança global na análise da migração do paciente." }
  },
  required: ["patient", "clinicalHistory", "financialHistory", "alerts", "missingInformation", "confidence"]
};

export const PatientMigrationAIService = {
  async analyzePatientMigration({
    clinicId,
    migrationId,
    files,
    additionalNotes
  }: {
    clinicId: string;
    migrationId: string;
    files: Array<{ name: string; type: string; base64: string }>;
    additionalNotes?: string;
  }): Promise<ExtractedPatientData> {
    console.log("[PATIENT_MIGRATION] initiating analysis with", files.length, "files for migrationId:", migrationId);
    
    // Step 12 Log:
    console.log("[PATIENT_MIGRATION] upload:", files.map(f => ({ name: f.name, type: f.type, size: f.base64.length })));

    try {
      const ai = getGenAI();

      let prompt = `
        Você é o motor de migração inteligente da ELIZA. Sua missão é ler as imagens, prints de telas de sistemas antigos (como Simples Dental, Dental Office, etc.), fotos de fichas físicas ou documentos em PDF anexados, e reconstruir com riqueza de detalhes a ficha do paciente em formato JSON.
        
        Você deve analisar cuidadosamente os arquivos em anexo e extrair tudo o que for legível e compreensível, sem inventar informações. Se um campo não estiver presente ou não puder ser deduzido com segurança, retorne string vazia.
        
        Para dados de DATA (como aniversário, procedimentos e parcelas financeiras), use o formato YYYY-MM-DD. Se apenas o ano for conhecido, preencha as partes aproximadas como YYYY-01-01 e registre essa incerteza em notes.
        
        Para status de finanças:
        - "paid" se o pagamento estiver claramente faturado ou marcado como quitado/pago.
        - "pending" se estiver marcado como em aberto, a receber, vencido ou pendente.
        - "partial" se houver indicação de pagamento parcial.

        Para cada item clínico e financeiro extraído, estime bem a confiança ("alta", "média" ou "baixa") baseado em quão claros estão os dados no documento. Adicione alertas se houver informações de saúde críticas ou anotações de débitos expressivos.

        Instruções Adicionais do Usuário:
        ${additionalNotes || "Nenhuma nota extra informada pelo usuário."}
      `;

      // Build parts list
      const parts: any[] = [
        { text: prompt }
      ];

      // Format attachments for GoogleGenAI SDK
      for (const file of files) {
        // Strip out the data URI prefix if present
        let cleanBase64 = file.base64;
        if (cleanBase64.includes(";base64,")) {
          cleanBase64 = cleanBase64.split(";base64,")[1];
        }

        parts.push({
          inlineData: {
            mimeType: file.type || "image/png",
            data: cleanBase64
          }
        });
      }

      console.log(`[PATIENT_MIGRATION] calling gemini-2.5-flash for extraction...`);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: PATIENT_MIGRATION_SCHEMA
        }
      });

      const extractedText = response.text;
      if (!extractedText) {
        throw new Error("Resposta vazia retornada pela IA");
      }

      const extractedData = JSON.parse(extractedText) as ExtractedPatientData;
      
      // Step 12 Log:
      console.log("[PATIENT_MIGRATION] extracted:", JSON.stringify(extractedData));

      return extractedData;
    } catch (error: any) {
      console.error("[PATIENT_MIGRATION] error during AI analysis:", error);
      throw new Error(`A ELIZA Inteligente falhou em analisar os arquivos da migração: ${error.message}`);
    }
  }
};
