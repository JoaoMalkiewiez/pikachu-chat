# Estado de produção e migrações

Projeto autorizado: `ebmxdnuyboarhmcigkcu` (sa-east-1). Bucket `chat-media`, privado.
Não houve mudança remota, criação de projeto, serviço Render, merge ou deploy.

## Migrações

Nenhuma migração é necessária para a implementação: o schema real já contém sessões, índices
únicos de token_hash e lower(username), messages e reads compatíveis. Não há pasta de migrações
com DDL especulativo. `supabase/schema.sql` foi corrigido como referência para bancos novos
isolados, incluindo sessões e RLS; NÃO é um script de atualização do V25.

Os advisors sugerem índices em messages.sender/recipient e reads.username. São otimizações
opcionais, não dependências funcionais deste PR. Antes de criá-los: rever volume, planos de
consulta, nomes existentes e locks; criar migração incremental e rollback só desses índices.
Nenhum índice existente foi removido. Não foi lido conteúdo privado das tabelas.

RLS sem políticas é intencional para auth própria: Data API não deve permitir anon/authenticated.
O usuário PostgreSQL do backend precisa das permissões privadas adequadas (e bypass de RLS
quando usado). Credenciais privilegiadas nunca chegam ao frontend. Não criar policies auth.uid()
como solução para a autenticação própria. Rever permissões com menor privilégio antes do deploy.

## Configuração

- DATABASE_URL: Session pooler do projeto V25 para IPv4, com senha nova configurada por canal seguro.
- TLS: validação ligada. Se a cadeia exigir CA, disponibilizar PEM por Secret File do Render e
  DATABASE_CA_FILE. URLs com opções sslmode/sslrootcert/sslkey/sslcert são rejeitadas para não
  sobrepor a configuração segura do driver. Não usar sslmode=no-verify.
- APP_SECRET: aleatório, novo, >=32 caracteres, estável entre reinícios. Rotação revoga todas as sessões.
- APP_ORIGIN: origem HTTPS exata, sem barra final. Origin incorreto bloqueia POST/WS.
- SUPABASE_URL fixo no V25; SUPABASE_SERVICE_ROLE_KEY exclusivamente no backend.
- HOST=0.0.0.0; PORT fornecido pelo Render; TRUST_PROXY=1 somente no Render.

Health consulta o PostgreSQL e retorna 503 na falha; não testa Storage a cada chamada.
O pool tenta novas conexões após falhas; não repete escritas automaticamente para evitar duplicação.
Startup exige tabela sessions acessível e não executa DDL. Logs contêm códigos de falha, sem objetos
de erro do driver, URLs de banco, dados de usuários ou signed URLs.

Render Blueprint foi preparado para um novo serviço e precisa de revisão manual antes de criar/sincronizar.
Auto-deploy desligado não impede o PRIMEIRO deploy durante criação: não executar sem autorização.
