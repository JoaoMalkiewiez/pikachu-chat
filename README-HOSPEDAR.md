# Pikachu Chat V25

Node 24 LTS, PostgreSQL no Supabase V25, Storage privado e WebSocket.
Autenticação própria por username/scrypt e sessões persistentes. Não usa Supabase Auth.
A aparência e os recursos de texto, imagem, áudio, perfil e tela foram preservados.

```sh
npm ci
cp .env.example .env
# Preencha .env localmente; nunca envie segredos ao GitHub ou ao navegador.
npm start
```

Use o endereço exato de APP_ORIGIN. Em produção, HTTPS é obrigatório.
O backend acessa o PostgreSQL e assina arquivos privados após verificar a sessão e a conversa.
Não execute schema.sql no projeto existente: ele é apenas referência para bancos novos isolados.

- [Diagnóstico inicial](docs/DIAGNOSTICO.md)
- [Arquitetura e limitações](docs/ARQUITETURA.md)
- [Evidências de validação](docs/VALIDACAO.md)
- [Preparação para produção](docs/PRODUCAO.md)
- [Checklist de deploy](DEPLOY-CHECK.md)

```sh
npm run lint
npm run check
npm test
npm run test:browser
npm run validate:render
```

Os testes usam PGlite (PostgreSQL WASM isolado), HTTP/WS reais e Storage simulado.
O teste de navegador requer Chromium em `/usr/bin/chromium` e usa mídia sintética.
Não há etapa de build: o frontend é servido diretamente.
