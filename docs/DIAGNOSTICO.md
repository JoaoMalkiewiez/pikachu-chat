# Diagnóstico inicial — Pikachu Chat V25

Inspeção em 12/11/2026, branch `recovery/pikachu-v25`, base `81b69cd`.
Todos os arquivos versionados foram inspecionados antes das alterações.

| Severidade | Evidência | Correção planejada |
|---|---|---|
| Crítica | markRead grava qualquer message_id | INSERT SELECT com autorização da conversa |
| Crítica | shareOffer/Answer/Ice encaminham para qualquer usuário | Vincular sinalização ao proprietário e espectadores inscritos |
| Crítica | schema.sql desativa RLS | Preservar RLS e bloquear acesso pela Data API |
| Alta | Sessões em Map; token no protocolo WS; sem logout/expiração | Cookie HttpOnly e token hash no PostgreSQL, revogação e revalidação |
| Alta | WebSocket artesanal, sem Origin, heartbeat ou limite de buffer | Biblioteca ws, Origin obrigatório, ping/pong e limite de payload |
| Alta | Login/cadastro ilimitados, scrypt síncrono, senha de 4 caracteres | Limites por IP e conta, scrypt assíncrono, mínimo 12 no cadastro |
| Alta | Upload aceita Content-Type sem verificar bytes | Identificação por assinatura, autorização antes do upload, compensação |
| Alta | profile aceita caminhos arbitrários; replyTo sem escopo | Avatar alterado apenas por upload; validar conversa da resposta |
| Alta | PostgreSQL rejectUnauthorized:false | TLS com verificação e CA configurável |
| Média | audio/avatar enviam X-Pikachu-User, backend espera token | Autenticação uniforme por cookie |
| Média | Imagens não tratadas no dispatcher/histórico; funções duplicadas | Renderização unificada, deduplicação e remoção de duplicatas |
| Média | Sem reconexão, paginação ou recibos funcionais | Retomar por cookie, histórico paginado e recibos autorizados |
| Média | Health sempre retorna sucesso; erros logam objetos sensíveis | Consulta ao banco, timeout, logs por códigos e encerramento gracioso |
| Média | Docker sem npm install; docs SQLite; dotenv não carregado | Lockfile, npm ci, Node LTS e documentação atualizada |

## Evidência remota somente leitura

Projeto `ebmxdnuyboarhmcigkcu`, tabelas users/sessions/messages/reads consultadas via MCP.
Sessions já tem id, username, token_hash único, expires_at, created_at e last_seen_at.
Users já possui índice único lower(username). RLS ativo nas quatro tabelas; sem políticas
ou grants anon/authenticated. Modelo intencional: somente backend privilegiado acessa dados.
Bucket chat-media privado, limite 8 MiB, MIME de imagens e áudio já configurados.
Nenhum registro privado, senha ou token foi lido. Nenhuma mutação remota executada.

Advisors: segurança informa quatro tabelas com RLS sem policies (esperado neste modelo);
saúde sem alertas; performance aponta FKs sem índice em messages.sender/recipient e reads.username.
Índices sem uso não serão removidos em um banco novo.
Referências: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
 e https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys.

## Sequência

1. Modularizar infraestrutura, autenticação HTTP e sessões persistentes.
2. Autorizar mensagens, histórico, leituras, mídia e sinalização; atualizar frontend junto.
3. Testar HTTP e WebSocket com PostgreSQL isolado, testar navegador e documentar limites.
4. Preparar Render e PR em rascunho, sem merge/deploy e sem alterar banco existente.
