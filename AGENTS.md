# Instruções para o Agente Codificador (AGENTS)

Este arquivo define as diretrizes persistentes e obrigatórias e os bloqueios de segurança para as ferramentas de IA que operam no desenvolvimento deste aplicativo.

## 🚨 [CRÍTICO] BLOQUEIO E MANUTENÇÃO DO BANCO DE DADOS (FIREBASE)
O banco de dados Firebase e a configuração de Firestore atualmente configurados são de produção e clínico ativo e **NÃO DEVEM SER RE-PROVISIONADOS, SUBSTITUÍDOS OU RESETADOS**.

* **PRESERVAÇÃO DO ARQUIVO:** O arquivo no caminho `/firebase-applet-config.json` contém as credenciais oficiais do projeto **`elisa-494703`** e o ID do Firestore **`ai-studio-14f59fa8-d107-42c9-8945-852d4fa75954`**. O conteúdo deste arquivo **nunca deve ser modificado, excluído ou substituído**.
* **PROIBIÇÃO DE RE-PROVISIONAMENTO:** Você está **terminantemente proibido** de rodar a ferramenta `set_up_firebase` ou qualquer utilitário de provisionamento do Firebase, a menos que o usuário dê um comando literal e explícito dizendo "Trocar de banco de dados" ou "Provisionar novo Firebase".
* **PRESERVAÇÃO DAS REGRAS (firestore.rules):** As regras de segurança em `/firestore.rules` já foram otimizadas para proteger os dados sensíveis dos pacientes e garantir que membros da clínica acessem somente seus devidos dados. Não altere as regras para formatos inseguros ou que limitem dados.

## Outras Diretrizes de Desenvolvimento
1. **Responsividade (Mobile First):** O prontuário clínico e a área do paciente devem manter-se compactos e perfeitamente legíveis em dispositivos móveis (ex: iPhone/iPad), minimizando a rolagem excessiva no cabeçalho dos pacientes.
2. **Uso de Ícone do WhatsApp:** Manter o design de destaque do WhatsApp na ficha do paciente. Se a API de mensagens da ELIZA estiver desconectada ou inexistente, abra o `wa.me` como fallback para manter a utilidade imediata dele.
3. **Padrão de Tipografia:** Usar a biblioteca Inter de fontes e ícones `lucide-react`.
