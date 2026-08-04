import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../lib/auth');
const { sql } = require('../../lib/db');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { name, start_date } = req.body;
    if (!name || !start_date) return res.status(400).json({ error: 'name and start_date required' });
    const { rows } = await sql`
      INSERT INTO projects (name, start_date, created_by)
      VALUES (${name}, ${start_date}, ${session.user.id})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  }

  return res.status(405).end();
}
