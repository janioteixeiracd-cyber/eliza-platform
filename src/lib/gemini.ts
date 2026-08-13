export function getGenAI(): any {
  return {
    models: {
      async generateContent(options: any) {
        console.log("[ELIZA_AI_CLIENT] Routing generateContent call through secure server-side proxy...");
        const response = await fetch("/api/ai/generateContent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            contents: options.contents,
            config: options.config,
            taskType: options.taskType,
            preferredProvider: options.preferredProvider,
            clinicId: options.clinicId
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          console.error("[ELIZA_AI_CLIENT_ERROR] Proxy request failed:", errData);
          throw new Error(errData.error || "A ELIZA AI não conseguiu gerar a análise agora. Verifique a configuração do modelo de IA.");
        }

        const data = await response.json();
        return data;
      }
    }
  };
}
