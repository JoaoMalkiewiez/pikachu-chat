const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createApp } = require('../src/app');
async function fixture(options = {}) {
  const pg = new PGlite(options.dataDir);
  await pg.waitReady;
  await pg.exec(await fs.readFile(require.resolve('../supabase/schema.sql'), 'utf8'));
  const db = { query: (sql, values) => pg.query(sql, values) };
  const objects = new Map();
  const storage = {
    upload: async (path, data, type) => { objects.set(path, { data, type }); },
    sign: async path => { if (!objects.has(path)) throw new Error('missing_object'); return 'https://ebmxdnuyboarhmcigkcu.supabase.co/storage/v1/object/sign/chat-media/' + path + '?token=test-only'; },
    remove: async path => objects.delete(path),
  };
  const config = { origin: 'http://127.0.0.1', secret: 'test-secret-32-characters-minimum-only', production: false, sessionMs: 86400000, heartbeatMs: 30000, ...options.config };
  let app;
  async function start(port = 0) {
    app = createApp({ db, storage, config });
    app.server.listen(port, '127.0.0.1'); await once(app.server, 'listening');
    config.origin = `http://127.0.0.1:${app.server.address().port}`;
    return app;
  }
  await start();
  async function request(route, { cookie, data, bytes, headers = {}, method = data || bytes ? 'POST' : 'GET', origin = config.origin, redirect = 'manual' } = {}) {
    return fetch(config.origin + route, { method, headers: { Connection: 'close', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: bytes || (data ? JSON.stringify(data) : undefined), redirect });
  }
  async function account(nickname, password = 'test-password-12345') {
    const registered = await request('/api/register', { data: { nickname, password } });
    if (!registered.ok) throw new Error('register ' + registered.status);
    const response = await request('/api/login', { data: { nickname, password } });
    if (!response.ok) throw new Error('login ' + response.status);
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function socket(cookie, origin = config.origin) {
    const ws = new WebSocket(config.origin.replace('http:', 'ws:'), { headers: { Cookie: cookie, Origin: origin } });
    const queue = [], waiters = [];
    ws.on('message', bytes => {
      const value = JSON.parse(bytes.toString());
      const index = waiters.findIndex(w => w.match(value));
      if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(value); } else queue.push(value);
    });
    ws.next = (type, predicate = () => true) => new Promise((resolve, reject) => {
      const match = v => v.type === type && predicate(v);
      const index = queue.findIndex(match);
      if (index >= 0) return resolve(queue.splice(index, 1)[0]);
      const waiter = { resolve, match };
      waiter.timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timeout waiting for ' + type)); }, 5000);
      waiters.push(waiter);
    });
    ws.sendAction = value => ws.send(JSON.stringify(value));
    await once(ws, 'open');
    await ws.next('welcome');
    return ws;
  }
  return { pg, db, storage, objects, config, request, account, socket, get app() { return app; },
    restart: async () => { const port = app.server.address().port; await app.close(); await start(port); },
    close: async () => { await app.close(); await pg.close(); },
  };
}
module.exports = { fixture };
