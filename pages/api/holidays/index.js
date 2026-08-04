import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM holidays ORDER BY holiday_date ASC`;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { holiday_date, label } = req.body;
    if (!holiday_date || !label) return res.status(400).json({ error: 'holiday_date and label required' });
    const { rows } = await sql`
      INSERT INTO holidays (holiday_date, label) VALUES (${holiday_date}, ${label})
      ON CONFLICT (holiday_date) DO UPDATE SET label = EXCLUDED.label
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  }

  return res.status(405).end();
}
