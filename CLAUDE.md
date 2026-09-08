# Eliza — instruções do projeto

## Deploy de produção — SEMPRE use exatamente isto

```
gcloud run deploy eliza-next --source . --region us-east1 --project elisa-494703
```

**Região correta: `us-east1`.** Existe um segundo serviço, também chamado `eliza-next`, em `southamerica-east1` — esse é **órfão, sem tráfego real, não usar**. `app.elizaclinic.com.br` está mapeado (via `gcloud beta run domain-mappings list`) só ao serviço em `us-east1`. Publicar no serviço errado não dá erro nenhum — o comando "funciona" normalmente, só não afeta o que o usuário vê. Incidente real: em 2026-08-28/29, 3 deploys seguidos foram parar no serviço errado antes de isso ser percebido.

Antes de confiar que um deploy "pegou", confirmar contra a URL pública real:
```
curl -s https://app.elizaclinic.com.br/api/health
```

Regras do Firestore são globais (não têm região) — publicar separadamente quando `firestore.rules` mudar:
```
npx firebase-tools deploy --only firestore:rules --project elisa-494703
```

## Projeto

- Projeto GCP: `elisa-494703`
- Firestore: mesmo projeto, banco padrão
- Ver `01 Projetos/Eliza.md` no cofre CEREBRO (`C:\Users\ACER\OneDrive\Documents\CEREBRO`) para stack completa, decisões e histórico de atividades.
