# Checklist para um novo serviço Render — não executado nesta missão

- [ ] Revisar e aprovar o PR; não alterar serviços antigos.
- [ ] Confirmar backup e schema real do Supabase V25; RLS ativo e nenhum grant público.
- [ ] Manter bucket chat-media privado, MIME restrito e limite de 8 MiB.
- [ ] Usar credenciais NOVAS do V25, sem copiar segredos de serviços antigos.
- [ ] Criar apenas `pikachu-chat-v25` quando o deploy for autorizado.
- [ ] Node 24 LTS, `npm ci --omit=dev`, `npm start`, health `/api/health`.
- [ ] Definir APP_ORIGIN com HTTPS, DATABASE_URL do Session pooler V25, SUPABASE_SERVICE_ROLE_KEY e APP_SECRET novo.
- [ ] Configurar CA do PostgreSQL se necessária via DATABASE_CA_FILE; nunca desativar validação TLS.
- [ ] Manter uma instância; autoDeployTrigger off. Rever branch antes do deploy definitivo.
- [ ] Conferir cookies Secure/HttpOnly/SameSite e logout em todas as abas.
- [ ] Testar cadastro/login com duas contas de teste autorizadas, reinício e expiração.
- [ ] Testar mensagens gerais/privadas, paginação, leitura e tentativas de acesso indevido.
- [ ] Testar imagem, avatar, gravação/reprodução de áudio e recuperação de falhas no Storage REAL.
- [ ] Testar permissão nativa de tela e áudio com dois dispositivos/redes diferentes.
- [ ] Avaliar/provisionar TURN e emitir credenciais temporárias por endpoint autenticado antes de prometer cobertura entre redes.
- [ ] Conferir health/readiness, logs e reconexão após suspensão do Render.
- [ ] Definir rotina de retenção para sessões expiradas e inventário de arquivos órfãos, com revisão antes de exclusões.
