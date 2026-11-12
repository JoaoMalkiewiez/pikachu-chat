# Deploy V25 — preparação

Siga [o checklist](DEPLOY-CHECK.md) e [o guia de produção](docs/PRODUCAO.md).
Use somente o Supabase existente `ebmxdnuyboarhmcigkcu` e bucket privado `chat-media`.
Não crie outro banco nem execute schema.sql sobre o banco V25.
O Blueprint define um NOVO serviço `pikachu-chat-v25`, auto-deploy desativado.
Criar ou sincronizar o Blueprint pode fazer o primeiro deploy; esta missão não executa essa etapa.
Render Free pode suspender o serviço: a interface retoma a sessão por cookie e reconecta.
Chamadas WebRTC precisam ser reiniciadas pelo usuário após desconexão.
