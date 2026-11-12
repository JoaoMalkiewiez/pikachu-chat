const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { body, allowed, HttpError } = require('../security');
function createStorage(config) {
  const sb = createClient(config.supabaseUrl, config.storageKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) } });
  const bucket = sb.storage.from(config.bucket);
  return {
    upload: async (path, bytes, type) => { const { error } = await bucket.upload(path, bytes, { contentType: type, upsert: false }); if (error) throw new Error('storage_upload_failed'); },
    remove: async path => { const { error } = await bucket.remove([path]); if (error) throw new Error('storage_remove_failed'); },
    sign: async path => { const { data, error } = await bucket.createSignedUrl(path, 300); if (error) throw new Error('storage_sign_failed'); return data.signedUrl; },
  };
}
async function detect(bytes, declared, kind) {
  const { fileTypeFromBuffer } = await import('file-type');
  let type;
  try { type = await fileTypeFromBuffer(bytes); } catch { throw new HttpError(400, 'Arquivo inválido.'); }
  const supported = kind === 'audio' ? ['audio/ogg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'video/webm'] : ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!type || !supported.includes(type.mime)) throw new HttpError(400, 'Formato de arquivo inválido.');
  let mime = type.mime;
  if (mime === 'video/webm') {
    if (!(bytes.includes(Buffer.from('A_OPUS')) || bytes.includes(Buffer.from('A_VORBIS'))) || bytes.includes(Buffer.from('V_VP'))) throw new HttpError(400, 'Use um arquivo de áudio.');
    mime = 'audio/webm';
  }
  if (mime === 'audio/x-m4a') mime = 'audio/mp4';
  if (mime !== declared) throw new HttpError(400, 'O conteúdo não corresponde ao tipo informado.');
  return { mime, ext: mime === 'image/jpeg' ? 'jpg' : type.ext };
}
function createMedia(db, storage, chat) {
  async function remove(path) { try { await storage.remove(path); } catch { console.error('storage_cleanup_failed'); } }
  async function upload(req, me, kind) {
    const ctx = kind === 'avatar' ? null : await chat.context(me, req.headers['x-pikachu-scope'] || 'general', req.headers['x-pikachu-to']);
    const duration = Number(req.headers['x-pikachu-duration'] || 0);
    if (!Number.isFinite(duration) || duration < 0 || duration > 180) throw new HttpError(400, 'Duração inválida.');
    const bytes = await body(req, kind === 'avatar' ? 2000000 : kind === 'audio' ? 5000000 : 8000000);
    const type = await detect(bytes, String(req.headers['content-type'] || '').split(';')[0], kind);
    const path = `${kind === 'avatar' ? 'avatars' : kind === 'image' ? 'images' : 'audio'}/${crypto.randomUUID()}.${type.ext}`;
    await storage.upload(path, bytes, type.mime);
    let saved;
    try {
      if (kind === 'avatar') {
        const previous = await chat.user(me);
        await db.query('update users set avatar=$1,updated_at=now() where username=$2', [path, me]);
        if (previous.avatar?.startsWith('avatars/')) await remove(previous.avatar);
        return { ok: true, url: '/api/avatars/' + encodeURIComponent(me) };
      }
      const { rows } = await db.query(`insert into messages(id,conversation,sender,recipient,text,kind,media_path,duration) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [crypto.randomUUID(), ctx.key, me, ctx.recipient, kind === 'image' ? '[Imagem]' : '[Áudio]', kind, path, duration]);
      saved = rows[0];
    } catch (error) {
      // A network error can happen after PostgreSQL committed. Never delete a referenced object.
      let referenced = true;
      try {
        const { rows } = await db.query(kind === 'avatar' ? 'select username from users where avatar=$1 limit 1' : 'select id from messages where media_path=$1 limit 1', [path]);
        referenced = rows.length > 0;
      } catch { console.error('storage_reconciliation_required'); }
      if (!referenced) await remove(path);
      throw error;
    }
    return { ok: true, message: chat.wire(saved) };
  }
  async function mediaUrl(me, id) {
    const row = await chat.message(id);
    if (!row || !row.media_path || row.deleted || !allowed(row, me)) throw new HttpError(404, 'Arquivo indisponível.');
    return storage.sign(row.media_path);
  }
  async function avatarUrl(username) {
    const row = await chat.user(username);
    if (!row?.avatar?.startsWith('avatars/')) throw new HttpError(404, 'Avatar indisponível.');
    return storage.sign(row.avatar);
  }
  return { upload, mediaUrl, avatarUrl };
}
module.exports = { createStorage, createMedia, detect };
