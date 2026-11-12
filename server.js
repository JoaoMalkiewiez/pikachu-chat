require('dotenv').config({ quiet: true });
const { loadConfig } = require('./src/config');
const { createDatabase } = require('./src/database');
const { createStorage } = require('./src/storage');
const { createApp } = require('./src/app');
async function main() {
  const config = loadConfig(), db = createDatabase(config);
  // Fail startup when the persisted-session schema is unavailable. Never mutate schema at startup.
  await db.query('select id,username,token_hash,expires_at from sessions limit 0');
  const app = createApp({ db, storage: createStorage(config), config });
  app.server.listen(config.port, config.host, () => console.log('pikachu_chat_ready'));
  let stopping = false;
  async function shutdown() {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    try { await app.close(); await db.close(); clearTimeout(deadline); } catch { console.error('shutdown_failed'); process.exitCode = 1; }
  }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch(() => { console.error('startup_failed_check_configuration_and_database'); process.exit(1); });
