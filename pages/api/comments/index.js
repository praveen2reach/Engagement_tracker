import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET') {
    const { task_id } = req.query;
    if (!task_id) return res.status(400).json({ error: 'task_id required' });
    const { rows } = await sql`
      SELECT c.*, u.name AS user_name
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ${task_id}
      ORDER BY c.entered_on DESC, c.created_at DESC
    `;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { task_id, comment_text, entered_on } = req.body;
    if (!task_id || !comment_text) return res.status(400).json({ error: 'task_id and comment_text required' });
    const { rows } = await sql`
      INSERT INTO comments (task_id, user_id, comment_text, entered_on)
      VALUES (${task_id}, ${session.user.id}, ${comment_text}, ${entered_on || new Date().toISOString().slice(0, 10)})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  }

  return res.status(405).end();
}
