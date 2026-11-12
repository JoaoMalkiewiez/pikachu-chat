const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { fixture } = require('./helpers.cjs');
const { createChat } = require('../src/database/chat');
const { loadConfig } = require('../src/config');
const { Limiter } = require('../src/security');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');

test('HTTP + PostgreSQL: cadastro, login, cookies, logout, expiração e reinício', async t => {
  const f = await fixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/session')).status, 401);
  assert.equal((await f.request('/api/register', { data: { nickname: 'a', password: '123' } })).status, 400);
  assert.equal((await f.request('/api/register', { data: { nickname: 'Alice', password: 'short' } })).status, 400);
  const cookie = await f.account('Alice');
  const { rows } = await f.db.query('select * from users');
  assert.equal(rows.length, 1); assert.notEqual(rows[0].password_hash, 'test-password-12345'); assert.equal(rows[0].password_hash.length, 128);
  const duplicate = await f.request('/api/register', { data: { nickname: 'ALICE', password: 'test-password-12345' } });
  const unique = await f.request('/api/register', { data: { nickname: 'Other', password: 'test-password-12345' } });
  assert.equal(duplicate.status, unique.status);
  assert.equal((await duplicate.json()).message, (await unique.json()).message);
  const wrong = await f.request('/api/login', { data: { nickname: 'Alice', password: 'bad' } });
  const missing = await f.request('/api/login', { data: { nickname: 'Nobody', password: 'bad' } });
  assert.equal(wrong.status, 401); assert.deepEqual(await wrong.json(), await missing.json());
  const login = await f.request('/api/login', { data: { nickname: 'Alice', password: 'test-password-12345' } });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal('sessionToken' in await login.json(), false);
  const sessions = (await f.db.query('select * from sessions')).rows;
  assert.ok(sessions.every(s => !cookie.includes(s.token_hash)));
  assert.equal((await f.request('/api/session', { cookie })).status, 200);
  await f.restart();
  assert.equal((await f.request('/api/session', { cookie })).status, 200);
  const ws = await f.socket(cookie);
  const closed = once(ws, 'close');
  const out = await f.request('/api/logout', { cookie, data: {} });
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/); await closed;
  assert.equal((await f.request('/api/session', { cookie })).status, 401);
  const otherCookie = login.headers.get('set-cookie').split(';')[0];
  await f.db.query("update sessions set expires_at=now()-interval '1 second'");
  assert.equal((await f.request('/api/session', { cookie: otherCookie })).status, 401);
});

test('CSRF, Origin WS, autenticação e limites de login/cadastro', async t => {
  const f = await fixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/register', { origin: 'https://evil.test', data: {} })).status, 403);
  assert.equal((await f.request('/api/logout', { origin: '', data: {} })).status, 403);
  const cookie = await f.account('OriginUser');
  for (const headers of [{ Origin: f.config.origin }, { Origin: 'https://evil.test', Cookie: cookie }]) {
    const ws = new WebSocket(f.config.origin.replace('http:', 'ws:'), { headers });
    const response = await new Promise((resolve, reject) => { ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); res.resume(); ws.terminate(); }); ws.on('error', () => {}); ws.on('open', () => { ws.close(); reject(new Error('Unexpected WS authentication')); }); });
    assert.ok([401, 403].includes(response));
  }
  let response;
  for (let i = 0; i < 12; i++) response = await f.request('/api/login', { data: { nickname: 'Target', password: 'wrong' } });
  assert.equal(response.status, 429);
  response = await f.request('/api/register', { data: { nickname: 'TARGET', password: 'test-password-12345' } });
  assert.equal(response.status, 429);
});

test('WS + SQL: conversas privadas, recibos, respostas, histórico paginado e deduplicação', async t => {
  const f = await fixture(); t.after(() => f.close());
  const a = await f.socket(await f.account('Alice'));
  const b = await f.socket(await f.account('Bob'));
  const e = await f.socket(await f.account('Eve'));
  const id = crypto.randomUUID(), data = { action: 'private', to: 'Bob', text: 'segredo', id };
  a.sendAction(data); const msg = await b.next('private'); assert.equal(msg.from, 'Alice');
  await a.next('private');
  a.sendAction(data); await a.next('private');
  assert.equal((await f.db.query('select count(*)::int as n from messages')).rows[0].n, 1);
  e.sendAction({ action: 'markRead', id }); assert.equal((await e.next('error')).status, 403);
  assert.equal((await f.db.query('select count(*)::int as n from reads')).rows[0].n, 0);
  b.sendAction({ action: 'markRead', id }); const read = await a.next('read'); assert.equal(read.username, 'Bob');
  e.sendAction({ action: 'general', text: 'reply leak', replyTo: id }); assert.equal((await e.next('error')).status, 403);
  e.sendAction({ action: 'private', to: 'Alice', text: 'collision', id }); assert.equal((await e.next('error')).status, 409);
  e.sendAction({ action: 'openPrivate', to: 'Bob' }); assert.equal((await e.next('privateHistory')).messages.length, 0);
  b.sendAction({ action: 'openPrivate', to: 'Alice' }); const page = await b.next('privateHistory'); assert.equal(page.messages[0].text, 'segredo'); assert.deepEqual(page.messages[0].readBy, ['Bob']);
  const chat = createChat(f.db);
  // Batch fixtures deliberately share timestamps; cursor must use timestamp AND UUID.
  for (let i = 0; i < 61; i++) await f.db.query("insert into messages(id,conversation,sender,text,created_at) values($1,'general','Alice',$2,'2026-01-01T00:00:00Z')", [crypto.randomUUID(), String(i)]);
  const first = await chat.history('Alice', 'general'); const second = await chat.history('Alice', 'general', null, first.nextCursor);
  assert.equal(first.messages.length, 50); assert.equal(first.hasMore, true); assert.equal(second.messages.length, 11);
  assert.equal(new Set([...first.messages, ...second.messages].map(m => m.id)).size, 61);
  const stolenCursor = await chat.history('Eve', 'general', null, id); assert.equal(stolenCursor.messages.length, 0);
  a.sendAction({ action: 'general', text: 'x'.repeat(2001) }); assert.equal((await a.next('error')).status, 400);
  a.sendAction({ action: 'general', text: '<img src=x onerror=alert(1)>' }); assert.equal((await e.next('message')).text, '<img src=x onerror=alert(1)>');
});

test('mídia: assinatura real, limites, autorização, avatar e limpeza em falha', async t => {
  const f = await fixture(); t.after(() => f.close());
  const cookie = await f.account('Alice'), bob = await f.account('Bob'), eve = await f.account('Eve');
  assert.equal((await f.request('/api/image', { bytes: PNG, headers: { 'Content-Type': 'image/png' } })).status, 401);
  assert.equal((await f.request('/api/image', { cookie, bytes: Buffer.from('fake png'), headers: { 'Content-Type': 'image/png' } })).status, 400);
  assert.equal((await f.request('/api/image', { cookie, bytes: PNG, headers: { 'Content-Type': 'image/jpeg' } })).status, 400);
  assert.equal((await f.request('/api/avatar', { cookie, bytes: Buffer.alloc(2000001), headers: { 'Content-Type': 'image/png' } })).status, 413);
  assert.equal((await f.request('/api/image', { cookie, bytes: PNG, headers: { 'Content-Type': 'image/png', 'X-Pikachu-Scope': 'private' } })).status, 400);
  assert.equal(f.objects.size, 0);
  const response = await f.request('/api/image', { cookie, bytes: PNG, headers: { 'Content-Type': 'image/png', 'X-Pikachu-Scope': 'private', 'X-Pikachu-To': 'bob' } });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal((await f.request(result.url, { cookie: eve })).status, 404);
  assert.equal((await f.request(result.url, { cookie: bob })).status, 302);
  assert.equal((await f.request(result.url)).status, 401);
  assert.match((await f.request(result.url, { cookie })).headers.get('location'), /object\/sign\/chat-media/);
  assert.equal((await f.request('/api/avatar', { cookie, bytes: PNG, headers: { 'Content-Type': 'image/png' } })).status, 200);
  assert.equal((await f.request('/api/avatars/Alice', { cookie: bob })).status, 302);
  const chat = createChat(f.db); await chat.profile('Alice', { bio: 'bio', status: 'ok', avatar: 'avatars/stolen.png' });
  assert.notEqual((await chat.user('Alice')).avatar, 'avatars/stolen.png');
  const count = f.objects.size, original = f.db.query;
  f.db.query = (sql, params) => sql.startsWith('insert into messages') ? Promise.reject(new Error('database failure')) : original(sql, params);
  assert.equal((await f.request('/api/image', { cookie, bytes: PNG, headers: { 'Content-Type': 'image/png' } })).status, 503);
  assert.equal(f.objects.size, count); f.db.query = original;
  assert.equal((await f.request('/api/audio', { cookie, bytes: PNG, headers: { 'Content-Type': 'audio/webm' } })).status, 400);
  assert.equal((await f.request('/api/audio', { cookie, bytes: PNG, headers: { 'Content-Type': 'audio/webm', 'X-Pikachu-Duration': 'NaN' } })).status, 400);
});

test('WebRTC: somente participantes inscritos podem sinalizar; isolamento privado e limpeza', async t => {
  const f = await fixture(); t.after(() => f.close());
  const a = await f.socket(await f.account('Alice')), b = await f.socket(await f.account('Bob')), e = await f.socket(await f.account('Eve'));
  a.sendAction({ action: 'shareStart', scope: 'private', to: 'Bob' });
  assert.equal((await a.next('shareAvailable')).share.self, true); assert.equal((await b.next('shareAvailable')).share.owner, 'Alice'); assert.equal((await e.next('shareAvailable')).share, null);
  e.sendAction({ action: 'shareRequest', owner: 'Alice' }); assert.equal((await e.next('error')).status, 403);
  b.sendAction({ action: 'shareAnswer', to: 'Alice', answer: { type: 'answer', sdp: 'before request' } }); assert.equal((await b.next('error')).status, 403);
  b.sendAction({ action: 'shareRequest', owner: 'Alice' }); await a.next('shareRequest');
  a.sendAction({ action: 'shareOffer', to: 'Eve', offer: { type: 'offer', sdp: 'forbidden' } }); assert.equal((await a.next('error')).status, 403);
  a.sendAction({ action: 'shareOffer', to: 'Bob', offer: { type: 'offer', sdp: 'valid signaling fixture' } }); assert.equal((await b.next('shareOffer')).from, 'Alice');
  b.sendAction({ action: 'shareAnswer', to: 'Alice', answer: { type: 'answer', sdp: 'answer fixture' } }); await a.next('shareAnswer');
  e.sendAction({ action: 'shareIce', to: 'Bob', candidate: { candidate: 'forbidden' } }); assert.equal((await e.next('error')).status, 403);
  b.sendAction({ action: 'shareIce', to: 'Alice', candidate: { candidate: 'candidate fixture' } }); await a.next('shareIce');
  b.sendAction({ action: 'shareLeave' }); await a.next('sharePeerLeft');
  a.sendAction({ action: 'shareOffer', to: 'Bob', offer: { type: 'offer', sdp: 'after leave' } }); assert.equal((await a.next('error')).status, 403);
  b.sendAction({ action: 'shareRequest', owner: 'Alice' }); await a.next('shareRequest');
  a.close(); await b.next('shareStopped');
  b.sendAction({ action: 'shareStart', scope: 'general' }); assert.equal((await b.next('shareAvailable', x => x.share?.owner === 'Bob')).share.scope, 'general');
});

test('reconexão WS restaura sessão e histórico, heartbeat encerra cliente sem pong', async t => {
  const f = await fixture({ config: { heartbeatMs: 100 } }); t.after(() => f.close());
  const cookie = await f.account('Reconnect');
  const a = await f.socket(cookie); a.sendAction({ action: 'general', text: 'persistente' }); await a.next('message');
  a.terminate(); await f.restart();
  const b = await f.socket(cookie); b.sendAction({ action: 'openGeneral' }); assert.equal((await b.next('generalHistory')).messages[0].text, 'persistente');
  const silent = new WebSocket(f.config.origin.replace('http:', 'ws:'), { autoPong: false, headers: { Cookie: cookie, Origin: f.config.origin } });
  await once(silent, 'open'); await once(silent, 'close');
  await f.db.query("update sessions set expires_at=now()-interval '1 second'");
  const [code] = await once(b, 'close'); assert.equal(code, 4401);
});

test('health detecta banco indisponível; erros não expõem detalhes', async t => {
  const f = await fixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/health')).status, 200);
  const original = f.db.query;
  f.db.query = () => Promise.reject(new Error('postgres://secret:password@host'));
  const res = await f.request('/api/health'); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /secret|password/);
  f.db.query = original;
});

test('configuração exige projeto V25, origem HTTPS e TLS verificado', () => {
  const env = { DATABASE_URL: 'postgresql://postgres.ebmxdnuyboarhmcigkcu:pass@aws-0-sa-east-1.pooler.supabase.com:5432/postgres', SUPABASE_URL: 'https://ebmxdnuyboarhmcigkcu.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', APP_SECRET: 'x'.repeat(32), APP_ORIGIN: 'https://chat.example.test', NODE_ENV: 'production' };
  assert.equal(loadConfig(env).production, true);
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: 'postgresql://postgres.other:pass@aws-0-sa-east-1.pooler.supabase.com/postgres' }));
  assert.throws(() => loadConfig({ ...env, SUPABASE_URL: 'https://other.supabase.co' }));
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: env.DATABASE_URL + '?sslmode=no-verify' }));
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: 'http://chat.example.test' }));
});

test('limiter expira janelas sem conservar bloqueio indefinido', () => {
  let time = 0; const limiter = new Limiter(1, 10, () => time);
  limiter.take('key'); assert.throws(() => limiter.take('key'), { status: 429 }); time = 11; limiter.take('key');
});

test('limite de mensagens WS é por conta; cookie Secure e conteúdo JSON inválido', async t => {
  const f = await fixture({ config: { production: true } }); t.after(() => f.close());
  const cookie = await f.account('Limited');
  const login = await f.request('/api/login', { data: { nickname: 'Limited', password: 'test-password-12345' } });
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  const a = await f.socket(cookie), b = await f.socket(cookie);
  for (let i = 0; i < 12; i++) { a.sendAction({ action: 'general', text: String(i) }); await a.next('message'); }
  b.sendAction({ action: 'general', text: 'above limit' }); assert.equal((await b.next('error')).status, 429);
  assert.equal((await f.db.query('select count(*)::int as n from messages')).rows[0].n, 12);
  a.send('not json'); assert.equal((await a.next('error')).status, 400);
  assert.equal((await f.request('/api/login', { bytes: Buffer.from('invalid'), headers: { 'Content-Type': 'application/json' } })).status, 400);
});
