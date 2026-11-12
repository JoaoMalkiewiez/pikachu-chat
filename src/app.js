const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createAuth } = require('./auth');
const { createChat } = require('./database/chat');
const { createMedia } = require('./storage');
const { createRealtime } = require('./websocket');
const { HttpError, Limiter, json, jsonBody, clientIp } = require('./security');
function createApp({ db, storage, config }) {
  const auth = createAuth(db, config), chat = createChat(db), media = createMedia(db, storage, chat);
  const uploads = new Limiter(12, 60000), requests = new Limiter(300, 60000);
  let stopping = false, realtime;
  const files = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/app.js', ['app.js', 'application/javascript']], ['/style.css', ['style.css', 'text/css']]]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), display-capture=(self)');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https://ebmxdnuyboarhmcigkcu.supabase.co; media-src 'self' blob: https://ebmxdnuyboarhmcigkcu.supabase.co; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (stopping) throw new HttpError(503, 'Serviço encerrando.');
      const url = new URL(req.url, config.origin), route = url.pathname;
      if (route === '/api/health' && req.method === 'GET') {
        await db.query('select 1');
        return json(res, 200, { ok: true, service: 'pikachu-chat-v25' });
      }
      requests.take(clientIp(req, config.trustProxy));
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new HttpError(405, 'Método não permitido.');
      if (req.method === 'POST') {
        if (req.headers.origin !== config.origin) throw new HttpError(403, 'Origem não permitida.');
        if (route === '/api/register') return json(res, 200, await auth.register(req, await jsonBody(req)));
        if (route === '/api/login') {
          const previous = await auth.session(req);
          const result = await auth.login(req, res, await jsonBody(req));
          if (previous) realtime.revoke(previous.token_hash);
          return json(res, 200, result);
        }
        if (route === '/api/logout') { const hash = await auth.logout(req, res); if (hash) realtime.revoke(hash); return json(res, 200, { ok: true }); }
        const session = await auth.requireSession(req);
        if (['/api/audio', '/api/image', '/api/avatar'].includes(route)) {
          uploads.take(session.username);
          const result = await media.upload(req, session.username, route.slice(5));
          if (result.message) realtime.deliver(result.message); else realtime.directory();
          return json(res, 200, { ok: true, url: result.url || result.message?.url, id: result.message?.id });
        }
        throw new HttpError(404, 'Não encontrado.');
      }
      if (route.startsWith('/api/')) {
        const session = await auth.requireSession(req);
        if (route === '/api/session') return json(res, 200, { ok: true, me: chat.publicUser(session) });
        if (route.startsWith('/api/media/') || route.startsWith('/api/avatars/')) {
          const avatar = route.startsWith('/api/avatars/');
          const value = decodeURIComponent(route.slice(avatar ? 13 : 11));
          const location = avatar ? await media.avatarUrl(value) : await media.mediaUrl(session.username, value);
          res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); return res.end();
        }
        throw new HttpError(404, 'Não encontrado.');
      }
      const entry = files.get(route);
      if (!entry) throw new HttpError(404, 'Não encontrado.');
      const bytes = await fs.readFile(path.join(__dirname, '..', 'public', entry[0]));
      res.writeHead(200, { 'Content-Type': entry[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!error.status) console.error('http_request_failed');
      if (!res.headersSent && !res.destroyed) json(res, error.status || 503, { ok: false, message: error.status ? error.message : 'Serviço temporariamente indisponível.' });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  realtime = createRealtime(server, auth, chat, config);
  return { server, close: async () => { stopping = true; await realtime.close(); await new Promise(resolve => server.close(resolve)); server.closeAllConnections(); } };
}
module.exports = { createApp };
