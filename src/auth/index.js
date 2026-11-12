const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError, name, digest, Limiter, clientIp } = require('../security');
const scrypt = promisify(crypto.scrypt);
const cookieName = 'pikachu_session';
function createAuth(db, config) {
  const byIp = new Limiter(20, 15 * 60000), byName = new Limiter(10, 15 * 60000);
  const dummySalt = crypto.randomBytes(16).toString('hex');
  const dummyHash = crypto.randomBytes(64);
  const hashToken = token => digest(token, config.secret);
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.production ? '; Secure' : ''}`;
  function tokenFrom(req) {
    const values = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName + '='));
    return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0].slice(cookieName.length + 1)) ? values[0].slice(cookieName.length + 1) : null;
  }
  async function session(req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const result = await db.query(`select s.id,s.username,s.token_hash,s.expires_at,u.bio,u.status,u.avatar from sessions s join users u on u.username=s.username where s.token_hash=$1 and s.expires_at>now()`, [hashToken(token)]);
    return result.rows[0] || null;
  }
  async function requireSession(req) {
    const value = await session(req);
    if (!value) throw new HttpError(401, 'Sessão inválida ou expirada.');
    return value;
  }
  function limit(req, nickname) {
    const ip = clientIp(req, config.trustProxy);
    byIp.take(ip);
    byName.take(digest(String(nickname || '').trim().toLowerCase(), config.secret));
  }
  async function register(req, input) {
    limit(req, input.nickname);
    const username = name(input.nickname), password = input.password;
    if (!username || typeof password !== 'string' || password.length < 12 || password.length > 72) throw new HttpError(400, 'Usuário 3–24 caracteres e senha 12–72.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hashed = await scrypt(password, salt, 64);
    // Same response for existing and new usernames; unique lower(username) prevents races.
    await db.query('insert into users(username,salt,password_hash) values($1,$2,$3) on conflict do nothing', [username, salt, hashed.toString('hex')]);
    return { ok: true, message: 'Solicitação processada. Tente entrar com suas credenciais.', nickname: username };
  }
  async function login(req, res, input) {
    limit(req, input.nickname);
    const username = name(input.nickname);
    const password = typeof input.password === 'string' && input.password.length <= 72 ? input.password : '';
    const { rows } = await db.query('select username,salt,password_hash from users where lower(username)=lower($1)', [username || '']);
    const user = rows[0];
    const actual = await scrypt(password, user?.salt || dummySalt, 64);
    const expected = user ? Buffer.from(user.password_hash, 'hex') : dummyHash;
    if (!user || expected.length !== actual.length || !crypto.timingSafeEqual(actual, expected)) throw new HttpError(401, 'Usuário ou senha incorretos.');
    const old = tokenFrom(req);
    if (old) await db.query('delete from sessions where token_hash=$1', [hashToken(old)]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('insert into sessions(id,username,token_hash,expires_at) values($1,$2,$3,$4)', [crypto.randomUUID(), user.username, hashToken(token), new Date(Date.now() + config.sessionMs)]);
    res.setHeader('Set-Cookie', cookie(token, Math.floor(config.sessionMs / 1000)));
    return { ok: true };
  }
  async function logout(req, res) {
    const token = tokenFrom(req);
    if (token) await db.query('delete from sessions where token_hash=$1', [hashToken(token)]);
    res.setHeader('Set-Cookie', cookie('', 0));
    return token ? hashToken(token) : null;
  }
  return { register, login, logout, session, requireSession };
}
module.exports = { createAuth };
