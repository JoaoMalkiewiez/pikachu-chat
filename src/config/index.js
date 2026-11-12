const fs = require('node:fs');
function loadConfig(env = process.env) {
  for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SECRET', 'APP_ORIGIN']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  if (env.APP_SECRET.length < 32) throw new Error('APP_SECRET must contain at least 32 characters');
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN || (env.NODE_ENV === 'production' && origin.protocol !== 'https:')) throw new Error('Invalid APP_ORIGIN');
  if (env.SUPABASE_URL !== 'https://ebmxdnuyboarhmcigkcu.supabase.co') throw new Error('Expected Supabase project V25');
  const database = new URL(env.DATABASE_URL);
  const project = 'ebmxdnuyboarhmcigkcu';
  const direct = database.hostname === `db.${project}.supabase.co`;
  const pooled = database.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(database.username).endsWith('.' + project);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || (!direct && !pooled)) throw new Error('DATABASE_URL must reference Supabase project V25');
  // pg can override the supplied TLS configuration with URL options. Reject insecure overrides.
  if (database.searchParams.has('sslmode') || database.searchParams.has('sslcert') || database.searchParams.has('sslkey') || database.searchParams.has('sslrootcert')) throw new Error('Configure database TLS through DATABASE_CA_FILE, not URL ssl options');
  return {
    host: env.HOST || '0.0.0.0', port: Number(env.PORT || 10000), origin: origin.origin,
    production: env.NODE_ENV === 'production', secret: env.APP_SECRET,
    databaseUrl: env.DATABASE_URL, databaseCa: env.DATABASE_CA_FILE ? fs.readFileSync(env.DATABASE_CA_FILE, 'utf8') : undefined,
    supabaseUrl: env.SUPABASE_URL, storageKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: 'chat-media', trustProxy: env.TRUST_PROXY === '1', sessionMs: 7 * 86400000,
    heartbeatMs: 30000,
  };
}
module.exports = { loadConfig };
