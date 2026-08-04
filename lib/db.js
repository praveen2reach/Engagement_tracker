// lib/db.js
//
// Uses the standard `pg` package (plain TCP Postgres wire protocol) rather
// than @vercel/postgres, which routes through Neon's WebSocket proxy layer
// and was throwing "Unexpected server response: 404" in this environment.
// `pg` works identically locally and on Vercel's Node.js serverless
// functions, and is compatible with any Postgres connection string
// (including Neon's).

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('No POSTGRES_URL found in the environment.');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Neon requires TLS; this accepts their cert chain
    });
  }
  return pool;
}

/**
 * Tagged template helper so call sites can keep writing
 *   const { rows } = await sql`SELECT * FROM tasks WHERE id = ${id}`
 * the same way they did with @vercel/postgres.
 */
function sql(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}` + strings[i + 1];
  }
  return getPool().query(text, values);
}

module.exports = { sql, getPool };
