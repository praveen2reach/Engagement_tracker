import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');
const { toStr } = require('../../../lib/dateEngine');
const { computeCriticalPath, generateRecoverySuggestions } = require('../../../lib/criticalPath');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET') {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const { rows: projectRows } = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
    const project = projectRows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { rows: taskRows } = await sql`SELECT * FROM tasks WHERE project_id = ${project_id} ORDER BY sequence ASC`;
    const { rows: holidayRows } = await sql`SELECT holiday_date FROM holidays`;
    const holidaySet = new Set(holidayRows.map((h) => h.holiday_date.toISOString().slice(0, 10)));
    const projectStart = project.start_date.toISOString().slice(0, 10);
    const todayStr = toStr(new Date());

    const tasks = taskRows
      .filter((t) => t.planned_start && t.planned_end)
      .map((t) => ({
        ...t,
        planned_start: t.planned_start.toISOString().slice(0, 10),
        planned_end: t.planned_end.toISOString().slice(0, 10),
        actual_end: t.actual_end ? t.actual_end.toISOString().slice(0, 10) : null,
      }));

    const cpm = computeCriticalPath(tasks, projectStart, holidaySet);
    const floatTable = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      planned_start: t.planned_start,
      planned_end: t.planned_end,
      float_days: cpm.get(t.id)?.float ?? null,
      is_critical: cpm.get(t.id)?.isCritical ?? false,
    }));

    const suggestions = generateRecoverySuggestions(tasks, cpm, holidaySet, todayStr);
    const projectImpactDays = suggestions.reduce((max, s) => Math.max(max, s.late_days), 0);

    const { rows: log } = await sql`
      SELECT r.*, u.name AS user_name
      FROM recovery_notes r JOIN users u ON u.id = r.created_by
      WHERE r.project_id = ${project_id}
      ORDER BY r.created_at DESC
    `;

    return res.status(200).json({
      criticalPath: floatTable.filter((t) => t.is_critical).map((t) => t.name),
      floatTable,
      suggestions,
      projectImpactDays,
      log,
    });
  }

  if (req.method === 'POST') {
    const { project_id, task_id, note_type, note_text } = req.body;
    if (!project_id || !note_text) return res.status(400).json({ error: 'project_id and note_text required' });
    const { rows } = await sql`
      INSERT INTO recovery_notes (project_id, task_id, note_type, note_text, created_by)
      VALUES (${project_id}, ${task_id || null}, ${note_type || 'manual'}, ${note_text}, ${session.user.id})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  }

  return res.status(405).end();
}
