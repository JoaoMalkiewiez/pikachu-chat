const crypto = require('node:crypto');
const { name, uuid, conversation, allowed, HttpError } = require('../security');
function createChat(db) {
  const one = async (sql, values) => (await db.query(sql, values)).rows[0];
  const user = input => one('select username,bio,status,avatar from users where lower(username)=lower($1)', [name(input) || '']);
  const publicUser = u => ({ username: u.username, bio: u.bio, status: u.status, avatar: u.avatar?.startsWith('avatars/') ? '/api/avatars/' + encodeURIComponent(u.username) : '💬' });
  const message = async id => uuid(id) ? one('select * from messages where id=$1', [id]) : null;
  async function context(me, scope, target) {
    if (scope === 'general') return { key: 'general', recipient: null };
    if (scope !== 'private') throw new HttpError(400, 'Conversa inválida.');
    const other = await user(target);
    if (!other || other.username === me) throw new HttpError(400, 'Destinatário inválido.');
    return { key: conversation(me, other.username), recipient: other.username };
  }
  function wire(row) {
    return { id: row.id, conversation: row.conversation, type: row.kind === 'text' ? (row.recipient ? 'private' : 'message') : row.kind,
      from: row.sender, to: row.recipient, text: row.text, replyTo: row.reply_to, kind: row.kind,
      edited: row.edited, deleted: row.deleted, duration: row.duration, timestamp: row.created_at,
      url: row.media_path ? '/api/media/' + row.id : null, readBy: row.read_by || [] };
  }
  async function history(me, scope, to, cursor) {
    const ctx = await context(me, scope, to);
    if (cursor && !uuid(cursor)) throw new HttpError(400, 'Cursor inválido.');
    const { rows } = await db.query(`select m.*, coalesce((select json_agg(r.username) from reads r where r.message_id=m.id),'[]'::json) as read_by from messages m
      where m.conversation=$1 and (m.conversation='general' or m.sender=$2 or m.recipient=$2)
      and ($3::uuid is null or (m.created_at,m.id)<(select created_at,id from messages where id=$3 and conversation=$1))
      order by m.created_at desc,m.id desc limit 51`, [ctx.key, me, cursor || null]);
    const hasMore = rows.length > 50, page = rows.slice(0, 50);
    return { messages: page.reverse().map(wire), hasMore, nextCursor: page[0]?.id || null, with: ctx.recipient };
  }
  async function save(me, input) {
    const ctx = await context(me, input.scope, input.to);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new HttpError(400, 'Mensagem inválida (1–2000 caracteres).');
    if (input.replyTo) {
      const parent = await message(input.replyTo);
      if (!parent || parent.conversation !== ctx.key || !allowed(parent, me)) throw new HttpError(403, 'Resposta não permitida.');
    }
    if (input.id && !uuid(input.id)) throw new HttpError(400, 'ID inválido.');
    const id = input.id || crypto.randomUUID();
    const { rows } = await db.query(`insert into messages(id,conversation,sender,recipient,text,reply_to,kind) values($1,$2,$3,$4,$5,$6,'text') on conflict(id) do nothing returning *`, [id, ctx.key, me, ctx.recipient, input.text.trim(), input.replyTo || null]);
    if (rows[0]) return { message: wire(rows[0]), fresh: true };
    const existing = await message(id);
    if (!existing || existing.sender !== me || existing.conversation !== ctx.key || existing.text !== input.text.trim() || existing.reply_to !== (input.replyTo || null)) throw new HttpError(409, 'ID já utilizado.');
    return { message: wire(existing), fresh: false };
  }
  async function markRead(me, id) {
    if (!uuid(id)) throw new HttpError(400, 'ID inválido.');
    const result = await db.query(`insert into reads(message_id,username) select id,$2 from messages where id=$1 and (conversation='general' or sender=$2 or recipient=$2) on conflict do nothing returning message_id`, [id, me]);
    if (!result.rows[0]) {
      const row = await message(id);
      if (!row || !allowed(row, me)) throw new HttpError(403, 'Leitura não permitida.');
    }
    return message(id);
  }
  async function directory(me, online) {
    // Two batched queries rather than two queries for every contact.
    const { rows: users } = await db.query('select username,bio,status,avatar from users order by username');
    const { rows: recent } = await db.query(`select distinct on (conversation) conversation,sender,recipient,text,kind,created_at from messages where sender=$1 or recipient=$1 order by conversation,created_at desc,id desc`, [me]);
    const { rows: unread } = await db.query(`select sender,count(*)::int as count from messages m where recipient=$1 and not exists(select 1 from reads r where r.message_id=m.id and r.username=$1) group by sender`, [me]);
    const contacts = users.filter(u => u.username !== me).map(u => {
      const last = recent.find(r => r.conversation === conversation(me, u.username));
      return { ...publicUser(u), online: online.includes(u.username), last: last ? { text: last.text, kind: last.kind, timestamp: last.created_at } : null, unread: unread.find(r => r.sender === u.username)?.count || 0 };
    }).sort((a, b) => new Date(b.last?.timestamp || 0) - new Date(a.last?.timestamp || 0) || a.username.localeCompare(b.username));
    return { users: users.map(publicUser), contacts };
  }
  async function profile(me, input) {
    if (typeof input.bio !== 'string' || input.bio.length > 160 || typeof input.status !== 'string' || input.status.length > 40) throw new HttpError(400, 'Perfil inválido.');
    const row = await one('update users set bio=$1,status=$2,updated_at=now() where username=$3 returning username,bio,status,avatar', [input.bio, input.status, me]);
    return publicUser(row);
  }
  return { user, publicUser, message, wire, context, history, save, markRead, directory, profile };
}
module.exports = { createChat };
