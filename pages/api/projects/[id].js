import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');

const EDITABLE_FIELDS = ['week_override', 'rag_overall', 'rag_schedule', 'rag_scope', 'rag_resource'];

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  const { id } = req.query;

  if (req.method === 'PATCH') {
    if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in req.body) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No permitted fields in request body' });
    }

    const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = Object.values(updates);

    const { getPool } = require('../../../lib/db');
    await getPool().query(`UPDATE projects SET ${setClauses} WHERE id = $1`, [id, ...values]);

    const { rows: updated } = await sql`SELECT * FROM projects WHERE id = ${id}`;
    return res.status(200).json(updated[0]);
  }

  return res.status(405).end();
}
