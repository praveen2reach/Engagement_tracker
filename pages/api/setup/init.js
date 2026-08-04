// pages/api/setup/init.js
//
// One-time setup: visit this URL once in your browser after deploying, e.g.
//   https://your-app.vercel.app/api/setup/init?secret=YOUR_ADMIN_PASSWORD
//
// This runs directly on Vercel's server, where the real database connection
// details are available (they can't be downloaded to a local computer when
// marked "Sensitive" in Vercel's dashboard — this endpoint sidesteps that).
//
// It's safe to visit more than once: table creation and the admin user
// insert are both written so repeating this does nothing destructive.
//
// The `secret` is just your ADMIN_PASSWORD value, reused here so you don't
// need to set up yet another variable — anyone hitting this URL without
// knowing that password gets rejected.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'team',
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    label TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    predecessor_id INTEGER REFERENCES tasks(id),
    dependency_type TEXT DEFAULT 'FS',
    duration_days INTEGER NOT NULL,
    planned_start DATE,
    planned_end DATE,
    baseline_start DATE,
    baseline_end DATE,
    actual_start DATE,
    actual_end DATE,
    status TEXT DEFAULT 'Not Started',
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    comment_text TEXT NOT NULL,
    entered_on DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id)`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN DEFAULT false`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS week_override INTEGER`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_overall TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_schedule TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_scope TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_resource TEXT`,
];

export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.ADMIN_PASSWORD || secret !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Wrong or missing ?secret= in the URL.' });
  }

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    return res.status(500).json({ error: 'No POSTGRES_URL available on the server. Is a database attached under Storage?' });
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await pool.query(stmt);
    }

    let adminMessage = 'ADMIN_EMAIL/ADMIN_NAME not set — skipped admin user creation.';
    if (process.env.ADMIN_EMAIL) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const name = process.env.ADMIN_NAME || 'Admin';
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [name, process.env.ADMIN_EMAIL, hash]
      );
      adminMessage = `Admin user ensured for ${process.env.ADMIN_EMAIL}.`;
    }

    await pool.end();
    return res.status(200).json({ status: 'ok', schema: 'created (or already existed)', admin: adminMessage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
