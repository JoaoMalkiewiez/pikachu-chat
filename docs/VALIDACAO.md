# Evidências de validação — 12/11/2026

## Executado localmente

- Node v24.22.1; instalação limpa `npm ci` com lockfile e versões fixas.
- `npm run lint`: ESLint para backend, frontend, scripts e testes.
- `npm run check`: sintaxe dos entrypoints.
- `npm test`: 10 testes automatizados, sem Supabase/Render de produção.
  Exercitam cadastro válido/inválido/duplicado, scrypt, login correto/incorreto,
  cookie HttpOnly/SameSite/Secure, sessão expirada, logout, servidor recriado com banco preservado,
  CSRF, Origin WS, sessão obrigatória, limites de autenticação/mensagens por conta,
  chat privado, leitura/reply autorizados, colisão de IDs, paginação com timestamps iguais,
  assinatura de arquivo/MIME, tamanho, mídia privada, avatar, limpeza em falha de INSERT,
  WebRTC autorizado/negado, desconexão, reconexão, heartbeat sem pong, health indisponível,
  JSON inválido e validação de configuração V25/TLS.
- Banco dos testes: PGlite, motor PostgreSQL WASM real e isolado. Não é o serviço Supabase;
  o teste de reinício recria o servidor HTTP/WS e preserva o mesmo motor PostgreSQL.
- Storage dos testes: adaptador simulado em memória, com falhas injetadas; não valida rede/SDK Supabase.
- `npm run test:browser`: Chromium real, três contextos isolados e aplicação completa.
  Login, chat privado, texto com payload HTML escapado, recibo de leitura, imagem, avatar,
  gravação com microfone sintético (MediaRecorder), upload de áudio, reload por cookie,
  reconexão WS, logout e ausência de token em localStorage/document.cookie.
  Transporte de objetos Storage interceptado após autorização real da rota.
- WebRTC no navegador: captura sintética de canvas somente após clique, isolamento de tela privada,
  SDP offer/answer reais, metadados de faixa remota e encerramento das tracks/peers.
  **Transporte ICE omitido**: política gerenciada `/etc/chromium/policies/managed/misc.json`
  define `WebRtcIPHandling=disable_non_proxied_udp`. Não houve conexão de mídia validada.
  O teste usa iceServers vazio para isolar sinalização de STUN externo.
- `npm run validate:render`: Blueprint válido contra o JSON Schema público atual (draft 2020-12).
  Não equivale a criação/sync nem validação de serviço/credenciais no Render.
- `npm audit --omit=dev`: zero vulnerabilidades reportadas nas dependências de produção.
- `git diff --check`: sem erros de whitespace.

Os logs `http_request_failed` em testes são esperados nos cenários de indisponibilidade injetada.
Não há build de frontend: HTML/CSS/JS são servidos diretamente. Imagem Docker foi preparada,
mas não foi construída/testada nesta missão. CI foi preparada; seu resultado remoto deve ser conferido no PR.

## Supabase real — somente leitura

Consultadas colunas, constraints, índices, RLS, policies, grants e metadados do bucket V25.
Advisors security/performance/health consultados. Nenhuma leitura de conteúdo de usuários,
nenhuma alteração de dados, RLS, bucket, schema ou histórico de migrations.

## Pendente antes de produção

- Login/registro, sessão persistente e queries usando o driver pg contra o Supabase V25 real.
- Cadeia TLS/CA e conectividade do Session pooler a partir do novo serviço Render.
- Storage real: upload/assinatura/expiração, playback de áudio e limpeza após falha externa.
- Permissões nativas de microfone/tela e navegadores móveis.
- ICE/STUN/TURN e transmissão entre redes/dispositivos diferentes.
- Logs, readiness, suspensão/reinício e shutdown no Render.
- Docker build e smoke test se esse caminho de hospedagem for escolhido.

Os itens pendentes constam de DEPLOY-CHECK.md. Não se afirma validação de produção.
