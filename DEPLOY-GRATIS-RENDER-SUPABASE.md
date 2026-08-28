# Pikachu Chat — Deploy gratuito

Arquitetura:
- Render Free: Node.js + WebSocket.
- Supabase Free: PostgreSQL + Storage privado.
- HTTPS termina no Render.
- Os arquivos não ficam no disco local do Render.

## 1. Supabase
Crie um projeto Free.
Abra SQL Editor e execute `supabase/schema.sql`.
Em Storage, crie um bucket `chat-media` e deixe PRIVADO.
Copie:
- Project URL
- Service Role Key
- Connection string de PostgreSQL.

Para Render, prefira o Shared Pooler (Session mode) se necessário para IPv4.

## 2. GitHub
Crie um repositório e envie todo o conteúdo desta pasta.
Não envie `.env` nem chaves.

## 3. Render
New -> Web Service -> conecte o repositório.

Build:
npm ci

Start:
npm start

Environment:
DATABASE_URL=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
STORAGE_BUCKET=chat-media
APP_SECRET=uma-string-secreta-forte

O `render.yaml` já contém os nomes necessários.

## 4. URL
O Render fornecerá:
https://SEU-NOME.onrender.com

O WebSocket do navegador usa automaticamente `wss://` quando a página estiver em HTTPS.

## 5. Persistência
SQLite/local files NÃO são usados em produção.
Usuários e mensagens ficam no Postgres.
Fotos, imagens e áudios ficam no Storage.

## 6. Limites gratuitos
Render Free pode suspender o serviço após 15 minutos sem tráfego e acorda no próximo acesso/novo WebSocket.
Supabase Free tem limites de banco/storage/egress; acompanhe a página de uso.

## 7. Deploy/saúde
Health:
GET /api/health

Logs:
Render -> Logs

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` no frontend.
