import { collection, getDocs, doc, setDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getGenAI } from "../lib/gemini";
import { AI_CONFIG } from "../config/ai";
import { Type } from "@google/genai";

export interface ExtractedItem {
  rawName: string;
  suggestedName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  batch: string;
  expirationDate: string;
  category: string;
  confidence: number;
  matchedProductId: string;
  matchStatus: "Encontrado no estoque" | "Possível correspondência" | "Novo item";
}

export interface ExtractedInventoryDoc {
  supplierName: string;
  documentDate: string;
  invoiceNumber: string;
  totalAmount: number;
  items: ExtractedItem[];
}

export const InventoryAIService = {
  async analyzeInventoryDocument({
    clinicId,
    uploadId,
    fileUrl,
    fileType,
    source
  }: {
    clinicId: string;
    uploadId: string;
    fileUrl: string;
    fileType: string;
    source: string;
  }): Promise<ExtractedInventoryDoc> {
    console.log("[INVENTORY_AI] Starting document analysis, source:", source);

    // 1. Fetch current inventory to serve as context for matching
    let currentInventory: any[] = [];
    try {
      const q = collection(db, "clinics", clinicId, "inventory");
      const snap = await getDocs(q);
      currentInventory = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log("[INVENTORY_AI] current inventory loaded:", currentInventory.length);
    } catch (err: any) {
      console.warn("[INVENTORY_AI] failed to fetch current inventory for mapping, proceeding without match database:", err.message);
    }

    // Prepare current inventory list for the prompt
    const currentInventoryText = currentInventory
      .map(item => `ID: ${item.id} | Nome: ${item.name} | Categoria: ${item.category} | Unidade: ${item.unit}`)
      .join("\n");

    // 2. Prepare the base64 content
    let base64Data = "";
    let mime = fileType || "image/jpeg";
    
    if (fileUrl.includes("base64,")) {
      const parts = fileUrl.split("base64,");
      base64Data = parts[1];
      const mimePart = parts[0].split(";")[0];
      if (mimePart.includes("data:")) {
        mime = mimePart.substring(5);
      }
    } else {
      // Fallback
      base64Data = fileUrl;
    }

    console.log("[INVENTORY_AI] base64 details, length:", base64Data.length, "mime:", mime);

    // 3. Setup Gemini API prompt & schema
    const prompt = `
      Você é ELIZA, a mentora operacional de inteligência artificial da clínica odontológica. Seu papel é processar o arquivo anexado (que é uma foto, imagem ou PDF de nota fiscal, orçamento ou lista de compras) e extrair os dados e itens de produtos odontológicos e clínicos.

      INFORMAÇÕES ADICIONAIS DO SEU CONTEXTO:
      - Tipo de documento: ${source}
      - Itens cadastrados no estoque da clínica atualmente:
      === INÍCIO DO ESTOQUE ATUAL ===
      ${currentInventoryText || "Estoque está vazio no momento."}
      === FIM DO ESTOQUE ATUAL ===

      SUAS TAREFAS DE EXTRAÇÃO E PROCESSAMENTO:
      1. Extraia o nome do fornecedor (supplierName), CNPJ (se visível), data do documento (documentDate em formato AAAA-MM-DD ou "") e número da nota/orçamento (invoiceNumber ou "").
      2. Extraia o valor total financeiro do documento (totalAmount).
      3. Extraia todos os itens e produtos presentes na nota fiscal / orçamento / lista.
      4. Para cada item extraído:
         - Identifique o nome original (rawName).
         - Crie um nome sugerido amigável e limpo para o estoque (suggestedName).
         - Extraia a quantidade (quantity) como número, a unidade (unit) e o preço unitário (unitPrice).
         - Calcule o preço total (totalPrice) ou use o valor extraído.
         - Extraia o lote (batch) e a data de validade (expirationDate em formato AAAA-MM-DD ou ""), se disponíveis.
         - Atribua uma categoria (category) como Consumíveis, Descartáveis, Ortodontia, Cirurgia, Equipamentos, Escritório ou similar.
         - Estime o nível de confiança (confidence) de 0.0 a 1.0 para a leitura desse item.
         - Faça uma correspondência inteligente com o estoque atual:
           - Se houver correspondência exata ou quase perfeita com algum item da lista de estoque atual (por exemplo, "Luva Latex Nitrilica" e "Luva Latex"), defina "matchedProductId" com o ID correspondente e defina "matchStatus" como "Encontrado no estoque".
           - Se for similar mas com pequenas variações textuais que necessitam de confirmação pelo usuário, preencha "matchedProductId" com o ID correspondente e defina "matchStatus" como "Possível correspondência".
           - Se for um item totalmente novo não encontrado no estoque, defina "matchedProductId" para uma string vazia ("") e defina "matchStatus" como "Novo item".

      DICA DE CORRESPONDÊNCIA:
      - Compare os itens de maneira inteligente (por similaridade).
      - Retorne estritamente o formato JSON solicitado.
    `;

    try {
      const ai = getGenAI();
      let response;
      try {
        console.log(`[ELIZA_AI] calling primary model: models/${AI_CONFIG.model}:generateContent`);
        response = await ai.models.generateContent({
          model: AI_CONFIG.model,
          contents: [
            {
              inlineData: {
                mimeType: mime,
                data: base64Data
              }
            },
            {
              text: prompt
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                supplierName: { type: Type.STRING, description: "Nome limpo e legível do fornecedor" },
                documentDate: { type: Type.STRING, description: "Data no formato AAAA-MM-DD" },
                invoiceNumber: { type: Type.STRING, description: "Número da nota ou orçamento" },
                totalAmount: { type: Type.NUMBER, description: "Valor total do documento" },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rawName: { type: Type.STRING },
                      suggestedName: { type: Type.STRING },
                      quantity: { type: Type.INTEGER },
                      unit: { type: Type.STRING },
                      unitPrice: { type: Type.NUMBER },
                      totalPrice: { type: Type.NUMBER },
                      batch: { type: Type.STRING },
                      expirationDate: { type: Type.STRING },
                      category: { type: Type.STRING },
                      confidence: { type: Type.NUMBER },
                      matchedProductId: { type: Type.STRING },
                      matchStatus: { 
                        type: Type.STRING, 
                        enum: ["Encontrado no estoque", "Possível correspondência", "Novo item"] 
                      }
                    },
                    required: ["rawName", "suggestedName", "quantity", "unit", "unitPrice", "totalPrice", "matchedProductId", "matchStatus"]
                  }
                }
              },
              required: ["supplierName", "documentDate", "invoiceNumber", "totalAmount", "items"]
            }
          }
        });
      } catch (err) {
        console.error("[ELIZA_AI_MODEL_ERROR] Primary model failed, trying fallback...", err);
        console.log(`[ELIZA_AI] calling fallback model: models/${AI_CONFIG.fallbackModel}:generateContent`);
        response = await ai.models.generateContent({
          model: AI_CONFIG.fallbackModel,
          contents: [
            {
              inlineData: {
                mimeType: mime,
                data: base64Data
              }
            },
            {
              text: prompt
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                supplierName: { type: Type.STRING, description: "Nome limpo e legível do fornecedor" },
                documentDate: { type: Type.STRING, description: "Data no formato AAAA-MM-DD" },
                invoiceNumber: { type: Type.STRING, description: "Número da nota ou orçamento" },
                totalAmount: { type: Type.NUMBER, description: "Valor total do documento" },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rawName: { type: Type.STRING },
                      suggestedName: { type: Type.STRING },
                      quantity: { type: Type.INTEGER },
                      unit: { type: Type.STRING },
                      unitPrice: { type: Type.NUMBER },
                      totalPrice: { type: Type.NUMBER },
                      batch: { type: Type.STRING },
                      expirationDate: { type: Type.STRING },
                      category: { type: Type.STRING },
                      confidence: { type: Type.NUMBER },
                      matchedProductId: { type: Type.STRING },
                      matchStatus: { 
                        type: Type.STRING, 
                        enum: ["Encontrado no estoque", "Possível correspondência", "Novo item"] 
                      }
                    },
                    required: ["rawName", "suggestedName", "quantity", "unit", "unitPrice", "totalPrice", "matchedProductId", "matchStatus"]
                  }
                }
              },
              required: ["supplierName", "documentDate", "invoiceNumber", "totalAmount", "items"]
            }
          }
        });
      }

      const text = response.text;
      if (!text) {
        throw new Error("Resposta da ELIZA AI veio vazia");
      }

      console.log("[INVENTORY_AI] extracted JSON raw:", text);
      const parsed: ExtractedInventoryDoc = JSON.parse(text);
      console.log("[INVENTORY_AI] extracted items count:", parsed.items?.length);
      return parsed;
    } catch (err: any) {
      console.error("[INVENTORY_AI] error analyzing document:", err);
      throw err;
    }
  }
};
