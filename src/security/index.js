const crypto = require('node:crypto');
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const name = value => typeof value === 'string' && /^[A-Za-z0-9À-ÿ _-]{3,24}$/.test(value.trim()) ? value.trim() : null;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const conversation = (a, b) => 'p:' + [a.toLowerCase(), b.toLowerCase()].sort().join(':');
const allowed = (message, user) => message.conversation === 'general' || message.sender === user || message.recipient === user;
const digest = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('hex');
class Limiter {
  constructor(max, windowMs, clock = Date.now) { this.max = max; this.windowMs = windowMs; this.clock = clock; this.entries = new Map(); }
  take(key) {
    const now = this.clock();
    if (this.entries.size > 10000) for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= 20000) throw new HttpError(429, 'Muitas requisições. Aguarde.');
    const entry = previous && previous.until > now ? previous : { count: 0, until: now + this.windowMs };
    this.entries.set(key, entry);
    if (++entry.count > this.max) throw new HttpError(429, 'Muitas requisições. Aguarde.');
  }
}
function clientIp(req, trustProxy) {
  return trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim() : req.socket.remoteAddress;
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req, max = 4096) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new HttpError(413, 'Arquivo excede o limite.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') throw new HttpError(415, 'Use JSON.');
  let value;
  try { value = JSON.parse((await body(req)).toString()); } catch (error) {
    if (error.status) throw error;
    throw new HttpError(400, 'JSON inválido.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Dados inválidos.');
  return value;
}
module.exports = { clientIp, HttpError, name, uuid, conversation, allowed, digest, Limiter, json, body, jsonBody };
