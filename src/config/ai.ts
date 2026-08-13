export const AI_CONFIG = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  fallbackModel: "gemini-2.5-flash-lite",
  apiKey: "" // Offloaded securely to server-side backend proxy
};

export function validateAIConfig() {
  console.log("[ELIZA_AI] provider:", AI_CONFIG.provider);
  console.log("[ELIZA_AI] model:", AI_CONFIG.model);
}
