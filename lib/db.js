// lib/db.js
//
// Uses @vercel/postgres's createClient() (a single direct connection) rather
// than the `sql` pooled import. The pooled `sql` import requires a
// connection string that points at a pgBouncer-style pooler endpoint; some
// Neon-via-Vercel integrations only expose the direct connection string
// under POSTGRES_URL, which throws "invalid_connection_string" if you try
// to use it with the pooled API. createClient() works with a direct
// connection string and is fine for this app's traffic level.
//
// If you later want proper connection pooling for higher concurrency, check
// Storage > your database > .env.local tab on Vercel for a pooled URL
// (often POSTGRES_URL with "-pooler" in the hostname), set it explicitly,
// and switch back to `const { sql } = require('@vercel/postgres')`.

const { createClient } = require('@vercel/postgres');

let client = null;
let connectPromise = null;

async function getClient() {
  if (!client) {
    client = createClient({
      connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
    });
  }
  if (!connectPromise) {
    connectPromise = client.connect().catch((err) => {
      // reset so the next call retries instead of reusing a dead promise
      connectPromise = null;
      client = null;
      throw err;
    });
  }
  await connectPromise;
  return client;
}

module.exports = { getClient };
