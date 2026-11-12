const { Pool } = require('pg');
function createDatabase(config) {
  const pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true, ca: config.databaseCa }, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000 });
  pool.on('error', () => console.error('database_pool_error'));
  return { query: (text, params) => pool.query(text, params), close: () => pool.end() };
}
module.exports = { createDatabase };
