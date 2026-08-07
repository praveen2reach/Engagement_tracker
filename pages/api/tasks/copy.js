import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');
const { recalculateProject } = require('../../../lib/recalculate');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (req.method !== 'POST') return res.status(405).end();

  const { source_project_id, target_project_id } = req.body;
  if (!source_project_id || !target_project_id) {
    return res.status(400).json({ error: 'source_project_id and target_project_id required' });
  }
  if (String(source_project_id) === String(target_project_id)) {
    return res.status(400).json({ error: 'Source and target must be different engagements' });
  }

  const { rows: sourceTasks } = await sql`
    SELECT * FROM tasks WHERE project_id = ${source_project_id} ORDER BY sequence ASC
  `;
  if (sourceTasks.length === 0) {
    return res.status(400).json({ error: 'Source engagement has no tasks to copy' });
  }

  const idMap = new Map(); // old task id -> new task id
  let copiedCount = 0;

  for (const t of sourceTasks) {
    const newPredecessorId = t.predecessor_id ? idMap.get(t.predecessor_id) || null : null;
    const { rows } = await sql`
      INSERT INTO tasks (project_id, name, sequence, predecessor_id, dependency_type, duration_days, is_milestone, owner)
      VALUES (${target_project_id}, ${t.name}, ${t.sequence}, ${newPredecessorId}, ${t.dependency_type}, ${t.duration_days}, ${t.is_milestone}, ${t.owner})
      RETURNING id
    `;
    idMap.set(t.id, rows[0].id);
    copiedCount += 1;
  }

  await recalculateProject(target_project_id);

  return res.status(200).json({ copied: copiedCount });
}
