import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { getClient } = require('../../../lib/db');
const { recalculateProject } = require('../../../lib/recalculate');

const ADMIN_FIELDS = ['name', 'sequence', 'predecessor_id', 'dependency_type', 'duration_days'];
const TEAM_FIELDS = ['actual_start', 'actual_end', 'status'];

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  const client = await getClient();
  const { id } = req.query;

  if (req.method === 'PATCH') {
    const { rows: existingRows } = await client.sql`SELECT * FROM tasks WHERE id = ${id}`;
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const isAdmin = session.user.role === 'admin';
    const allowedFields = isAdmin ? [...ADMIN_FIELDS, ...TEAM_FIELDS] : TEAM_FIELDS;

    const updates = {};
    for (const field of allowedFields) {
      if (field in req.body) updates[field] = req.body[field];
    }

    const attemptedAdminField = ADMIN_FIELDS.some((f) => f in req.body);
    if (!isAdmin && attemptedAdminField) {
      return res.status(403).json({
        error: 'Only an admin can change task name, sequence, predecessor, dependency type, or duration.',
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No permitted fields in request body' });
    }

    const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = Object.values(updates);
    await client.query(
      `UPDATE tasks SET ${setClauses}, updated_at = now() WHERE id = $1`,
      [id, ...values]
    );

    const needsRecalc = ['predecessor_id', 'dependency_type', 'duration_days'].some((f) => f in updates);
    if (needsRecalc) {
      await recalculateProject(existing.project_id);
    }

    const { rows: updated } = await client.sql`SELECT * FROM tasks WHERE id = ${id}`;
    return res.status(200).json(updated[0]);
  }

  if (req.method === 'DELETE') {
    if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { rows: existingRows } = await client.sql`SELECT * FROM tasks WHERE id = ${id}`;
    const existing = existingRows[0];
    await client.sql`DELETE FROM tasks WHERE id = ${id}`;
    if (existing) await recalculateProject(existing.project_id);
    return res.status(204).end();
  }

  return res.status(405).end();
}
