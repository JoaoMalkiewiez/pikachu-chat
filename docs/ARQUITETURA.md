# Arquitetura final

- `server.js`: dotenv, validação de configuração, startup, sinais e shutdown (prazo 10 s).
- `src/config`: projeto V25, origem, segredos exclusivamente no servidor, TLS.
- `src/database`: pool PostgreSQL com timeouts; consultas parametrizadas do chat.
- `src/auth`: scrypt assíncrono compatível com hashes antigos, cookie e sessões PostgreSQL.
- `src/security`: validação, limites de corpo e rate limiting por IP/conta.
- `src/storage`: assinatura real de arquivo, upload privado, URL assinada de 5 min e compensação.
- `src/websocket`: ws, Origin, heartbeat, filas limitadas, autorização e sinalização.
- `src/app.js`: rotas HTTP, cabeçalhos de segurança, CSRF por Origin exato, arquivos estáticos permitidos.
- `public`: interface existente, cookie automático, reconexão, deduplicação, paginação, mídia e recibos.
- `tests`: SQL PostgreSQL WASM, HTTP/WS, falhas externas injetadas e navegador Chromium.

## Contratos

Login/cadastro saíram do WS para POST /api/login e /api/register. GET /api/session retoma
por cookie HttpOnly (7 dias); POST /api/logout apaga a sessão e encerra seus sockets.
Cookie SameSite Strict; Secure obrigatório na configuração de produção. APP_ORIGIN obrigatório
para POST e upgrade WS. Tokens aleatórios de 256 bits; somente HMAC-SHA256 persistido.
Cadastro retorna a mesma mensagem para usuário existente e novo; login usa derivação dummy para
nomes ausentes. Cadastro novo exige 12–72 caracteres, login continua aceitando senhas antigas.
Senha/token não vão para localStorage; somente preferência de tema e nome do usuário ficam lá.

Operações WS revalidam sessão no PostgreSQL; heartbeat revalida a cada 30 s. Logout local
fecha imediatamente todos os sockets da sessão. Revogações feitas externamente são percebidas
na próxima operação/heartbeat. Broadcast bloqueia sessões com expiração já atingida.
Limites em memória pressupõem UMA instância. Contas novas não contornam o limite por IP.
TRUST_PROXY=1 confia somente no último salto X-Forwarded-For (Render); não usar em acesso direto.

Histórico usa cursor UUID e ordem (created_at,id), 50 mensagens por página. Cursor é resolvido
na mesma conversa. Reenvio de texto com o mesmo UUID é idempotente. Arquivos têm nomes UUID;
GET /api/media/:id verifica participação antes de redirecionar para URL assinada de 300 s.
Avatares são visíveis para qualquer usuário autenticado (diretório do chat). Perfil não aceita
caminhos arbitrários. Upload inválido é rejeitado antes de chegar ao Storage; falha de INSERT
verifica referências antes de remover o objeto enviado; se o banco estiver indisponível,
conserva o objeto para reconciliação. Troca de avatar tenta remover o antigo. Falhas de remoção geram código
sanitizado no log; não há varredura destrutiva automática.

WebRTC mantém uma transmissão ativa e espectadores inscritos. Ofertas só partem do proprietário;
respostas só partem do espectador inscrito; ICE só trafega nesse par. Transmissão privada é visível
apenas ao proprietário/destinatário. Fechar, sair, desconectar ou expirar encerra vínculos e peers.
Captura só começa após clique e permissão do navegador. Não se retoma captura automaticamente.

## Limitações

- Sem TURN: STUN não garante conectividade em NAT/firewalls restritivos. Provisionar TURN com
  credenciais temporárias autenticadas é uma etapa de produção pendente. O Chromium deste ambiente
  bloqueia UDP WebRTC não proxied; o teste não comprova transporte de vídeo.
- Limites, presença e transmissões são locais ao processo. Escalar exige coordenação/pubsub.
- Arquivos são identificados por assinatura/container, sem antivírus, transcodificação ou sandbox
  de decoder. URLs assinadas são bearer links compartilháveis durante cinco minutos.
- Falha de rede durante commit pode deixar objeto órfão ou exigir reconciliação; não há transação
  distribuída entre PostgreSQL e Storage. Inventariar órfãos antes de apagar qualquer arquivo.
- Diretório inclui todos os usuários autenticados; paginação do diretório será necessária em escala.
- Sessões expiradas ficam inacessíveis mas não são apagadas automaticamente; planejar retenção.
- Não há recuperação de senha por e-mail, edição/exclusão de mensagens ou múltiplas transmissões:
  não existiam contratos funcionais para esses recursos na versão inspecionada.
