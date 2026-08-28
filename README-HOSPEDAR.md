# Pikachu Chat — Hospedagem

## Produção
O app está preparado para rodar sem .bat.

### Docker
docker compose up -d --build

O app escuta na porta 3000. Em produção, coloque um proxy HTTPS (Nginx, Caddy ou a própria hospedagem) na frente da aplicação.

### Sem Docker
Defina as variáveis:
PORT=3000
USE_TLS=0
DATA_DIR=/caminho/persistente

Depois execute:
npm start

## Dados persistentes
O banco SQLite e os uploads ficam em DATA_DIR:
- pikachu.db
- audio/
- avatars/
- images/

Não use armazenamento efêmero para DATA_DIR, ou usuários e arquivos poderão desaparecer após um redeploy.

## Compartilhamento de tela
WebRTC exige contexto seguro para captura de tela. Na hospedagem use HTTPS real. O app pode rodar internamente em HTTP atrás de um proxy HTTPS.

## Variáveis
Veja .env.example.
