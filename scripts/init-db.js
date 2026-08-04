/**
 * Run once after setting POSTGRES_URL (from Vercel Postgres) locally:
 *   npm run db:init
 *
 * Creates all tables and one admin user, using ADMIN_EMAIL / ADMIN_PASSWORD
 * from your .env.local (see .env.example).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Fallback loader: if POSTGRES_URL isn't already set (e.g. because
// `node --env-file=.env.local` isn't supported by an older Node version),
// read .env.local ourselves and set the variables manually.
if (!process.env.POSTGRES_URL) {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

const { createClient } = require('@vercel/postgres');

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('No POSTGRES_URL found in the environment. Did you run "vercel env pull .env.local --environment=production"?');
  }
  const client = createClient({ connectionString });
  await client.connect();

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await client.query(stmt);
  }
  console.log('Schema created.');

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Admin';

  if (!email || !password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin user creation.');
  } else {
    const hash = await bcrypt.hash(password, 10);
    await client.sql`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (${name}, ${email}, ${hash}, 'admin')
      ON CONFLICT (email) DO NOTHING;
    `;
    console.log(`Admin user ensured for ${email}.`);
  }

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
