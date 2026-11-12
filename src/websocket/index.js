const { WebSocketServer, WebSocket } = require('ws');
const { HttpError, Limiter, name, clientIp } = require('../security');
function createRealtime(server, auth, chat, config) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const operations = new Limiter(100, 5000), messages = new Limiter(12, 5000), upgrades = new Limiter(60, 60000);
  const peers = new Map(); // socket -> authenticated PostgreSQL session
  let share = null, closing = false, directoryPending = null;
  const online = () => [...new Set([...peers.values()].map(s => s.username))];
  function send(socket, value) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const session = peers.get(socket);
    if (session && new Date(session.expires_at).getTime() <= Date.now()) { socket.close(4401, 'Session expired'); return; }
    if (socket.bufferedAmount > 1024 * 1024) return socket.terminate();
    socket.send(JSON.stringify(value));
  }
  function sendTo(user, value) { for (const [s, p] of peers) if (p.username === user) send(s, value); }
  function broadcast(value) { for (const s of peers.keys()) send(s, value); }
  function deliver(message) {
    if (message.to) { sendTo(message.from, message); sendTo(message.to, message); }
    else broadcast(message);
    scheduleDirectory();
  }
  function shareFor(user) {
    if (!share || (share.scope === 'private' && user !== share.owner && user !== share.target)) return null;
    return { owner: share.owner, scope: share.scope, target: share.target, startedAt: share.startedAt, self: user === share.owner };
  }
  async function directory() {
    for (const [socket, session] of peers) {
      const data = await chat.directory(session.username, online());
      send(socket, { type: 'directory', ...data, share: shareFor(session.username) });
    }
  }
  function scheduleDirectory() {
    if (directoryPending || closing) return;
    directoryPending = setTimeout(() => { directoryPending = null; directory().catch(() => console.error('directory_failed')); }, 100);
    directoryPending.unref();
  }
  function announceShare() { for (const [s, p] of peers) send(s, { type: 'shareAvailable', share: shareFor(p.username) }); }
  function stopShare() {
    if (!share) return;
    for (const [s, p] of peers) if (shareFor(p.username)) send(s, { type: 'shareStopped', from: share.owner });
    share = null;
  }
  function closePeer(socket) {
    const p = peers.get(socket);
    if (!p) return;
    if (share?.ownerSocket === socket) stopShare();
    if (share?.viewers.has(socket)) { send(share.ownerSocket, { type: 'sharePeerLeft', from: p.username }); share.viewers.delete(socket); }
    peers.delete(socket);
    broadcast({ type: 'presence', online: online() }); scheduleDirectory();
  }
  async function operation(socket, input) {
    const session = await auth.session(socket.request);
    if (!session) { closePeer(socket); socket.close(4401, 'Session expired'); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dados inválidos.');
    const me = session.username;
    operations.take(session.username);
    if (input.action === 'ping') return send(socket, { type: 'pong' });
    if (input.action === 'openGeneral' || input.action === 'openPrivate') {
      const scope = input.action === 'openGeneral' ? 'general' : 'private';
      const page = await chat.history(me, scope, input.to, input.cursor);
      return send(socket, { type: scope === 'general' ? 'generalHistory' : 'privateHistory', ...page, prepend: !!input.cursor });
    }
    if (input.action === 'general' || input.action === 'private') {
      messages.take(me);
      const saved = await chat.save(me, { ...input, scope: input.action });
      if (saved.fresh) deliver(saved.message); else send(socket, saved.message);
      return;
    }
    if (input.action === 'markRead') {
      const row = await chat.markRead(me, input.id);
      const event = { type: 'read', id: row.id, username: me };
      if (row.conversation === 'general') broadcast(event); else { sendTo(row.sender, event); sendTo(row.recipient, event); }
      scheduleDirectory(); return;
    }
    if (input.action === 'profile') {
      send(socket, { type: 'profile', me: await chat.profile(me, input) }); scheduleDirectory(); return;
    }
    if (input.action === 'typing') {
      const ctx = await chat.context(me, input.scope, input.to);
      const event = { type: 'typing', from: me, scope: input.scope, active: input.active === true };
      if (ctx.recipient) sendTo(ctx.recipient, event); else for (const [s, p] of peers) if (p.username !== me) send(s, event);
      return;
    }
    if (input.action === 'shareStart') {
      if (share) throw new HttpError(409, 'Já existe uma transmissão ativa.');
      const ctx = await chat.context(me, input.scope, input.to);
      if (ctx.recipient && !online().includes(ctx.recipient)) throw new HttpError(400, 'O usuário precisa estar online.');
      if (share) throw new HttpError(409, 'Já existe uma transmissão ativa.');
      share = { owner: me, ownerSocket: socket, scope: input.scope, target: ctx.recipient, startedAt: new Date().toISOString(), viewers: new Map() };
      announceShare(); return;
    }
    if (input.action === 'shareRequest') {
      if (!share || name(input.owner) !== share.owner || !shareFor(me) || me === share.owner) throw new HttpError(403, 'Transmissão indisponível.');
      // A username identifies one viewer peer in the legacy UI. Replace earlier tabs explicitly.
      for (const [s, user] of share.viewers) if (user === me && s !== socket) { share.viewers.delete(s); send(s, { type: 'shareStopped', from: share.owner }); }
      share.viewers.set(socket, me);
      send(share.ownerSocket, { type: 'shareRequest', from: me, to: share.owner }); return;
    }
    if (['shareOffer', 'shareAnswer', 'shareIce'].includes(input.action)) {
      if (!share) throw new HttpError(403, 'Sinalização não permitida.');
      const target = name(input.to);
      const owner = share.ownerSocket === socket;
      const dest = owner ? [...share.viewers].find(([, u]) => u === target)?.[0] : target === share.owner && share.viewers.has(socket) ? share.ownerSocket : null;
      if (!dest || (input.action === 'shareOffer' && !owner) || (input.action === 'shareAnswer' && owner)) throw new HttpError(403, 'Sinalização não permitida.');
      const field = input.action === 'shareOffer' ? 'offer' : input.action === 'shareAnswer' ? 'answer' : 'candidate';
      const value = input[field];
      if (!value || typeof value !== 'object' || JSON.stringify(value).length > 48000 || (field !== 'candidate' && (typeof value.sdp !== 'string' || value.type !== field))) throw new HttpError(400, 'Sinalização inválida.');
      send(dest, { type: input.action, from: me, to: target, [field]: value }); return;
    }
    if (input.action === 'shareLeave') {
      if (share?.viewers.has(socket)) { share.viewers.delete(socket); send(share.ownerSocket, { type: 'sharePeerLeft', from: me }); }
      return;
    }
    if (input.action === 'shareStop') { if (share?.ownerSocket === socket) stopShare(); return; }
    throw new HttpError(400, 'Ação inválida.');
  }
  server.on('upgrade', (req, socket, head) => {
    const reject = code => { if (!socket.destroyed) socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\n\r\n`); };
    socket.on('error', () => {});
    (async () => {
      if (closing || req.headers.origin !== config.origin || req.url !== '/') return reject(403);
      upgrades.take(clientIp(req, config.trustProxy));
      const session = await auth.requireSession(req);
      if (peers.size >= 500 || [...peers.values()].filter(p => p.username === session.username).length >= 5) return reject(429);
      wss.handleUpgrade(req, socket, head, ws => {
        ws.request = req; ws.alive = true; peers.set(ws, session);
        ws.on('pong', () => { ws.alive = true; });
        ws.on('close', () => closePeer(ws)); ws.on('error', () => closePeer(ws));
        // Serialize operations and bound the queue; no races between shareStart and offers.
        let queue = Promise.resolve(), pending = 0;
        ws.on('message', (data, binary) => {
          if (binary || ++pending > 32) return ws.close(1008, 'Too many pending operations');
          let input;
          queue = queue.then(async () => {
            if (!peers.has(ws)) return;
            try { input = JSON.parse(data.toString()); } catch { throw new HttpError(400, 'JSON inválido.'); }
            await operation(ws, input);
          }).catch(error => {
            send(ws, { type: 'error', code: 'OPERATION', id: input?.id, status: error.status || 503, message: error.status ? error.message : 'Serviço temporariamente indisponível.' });
            if (!error.status) console.error('websocket_operation_failed');
          }).finally(() => pending--);
        });
        queue = (async () => {
          const data = await chat.directory(session.username, online());
          const page = await chat.history(session.username, 'general');
          send(ws, { type: 'welcome', self: session.username, me: chat.publicUser(session), online: online(), contacts: data.contacts, general: page.messages, hasMore: page.hasMore, nextCursor: page.nextCursor, share: shareFor(session.username) });
          broadcast({ type: 'presence', online: online() }); scheduleDirectory();
        })().catch(() => ws.close(1011, 'Unavailable'));
      });
    })().catch(error => reject(error.status || 503));
  });
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking) return; checking = true;
    try {
      for (const [socket] of peers) {
        if (!socket.alive) { closePeer(socket); socket.terminate(); continue; }
        if (!await auth.session(socket.request)) { closePeer(socket); socket.close(4401, 'Session expired'); continue; }
        socket.alive = false; socket.ping();
      }
    } catch { console.error('websocket_heartbeat_failed'); for (const s of peers.keys()) { closePeer(s); s.terminate(); } }
    finally { checking = false; }
  }, config.heartbeatMs);
  heartbeat.unref();
  return {
    deliver, directory: scheduleDirectory,
    revoke: hash => { for (const [s, p] of peers) if (p.token_hash === hash) { closePeer(s); s.close(4401, 'Logged out'); } },
    close: async () => { closing = true; clearInterval(heartbeat); clearTimeout(directoryPending); stopShare(); for (const s of peers.keys()) { closePeer(s); s.terminate(); } await new Promise(resolve => wss.close(resolve)); },
  };
}
module.exports = { createRealtime };
