import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { getClient } = require('../../../lib/db');
const { recalculateProject } = require('../../../lib/recalculate');
const { deviationDays, isCurrentWeekTask } = require('../../../lib/dateEngine');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  const client = await getClient();

  if (req.method === 'GET') {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const { rows: tasks } = await client.sql`
      SELECT * FROM tasks WHERE project_id = ${project_id} ORDER BY sequence ASC
    `;
    const { rows: holidayRows } = await client.sql`SELECT holiday_date FROM holidays`;
    const holidaySet = new Set(holidayRows.map((h) => h.holiday_date.toISOString().slice(0, 10)));

    const enriched = tasks.map((t) => {
      const plannedEnd = t.planned_end ? t.planned_end.toISOString().slice(0, 10) : null;
      const actualEnd = t.actual_end ? t.actual_end.toISOString().slice(0, 10) : null;
      return {
        ...t,
        deviation_days: plannedEnd ? deviationDays(plannedEnd, actualEnd, holidaySet) : null,
        is_current_week: isCurrentWeekTask({
          planned_start: t.planned_start && t.planned_start.toISOString().slice(0, 10),
          planned_end: plannedEnd,
          actual_start: t.actual_start && t.actual_start.toISOString().slice(0, 10),
          actual_end: actualEnd,
        }),
      };
    });

    return res.status(200).json(enriched);
  }

  if (req.method === 'POST') {
    if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { project_id, name, sequence, predecessor_id, dependency_type, duration_days } = req.body;
    if (!project_id || !name || !duration_days) {
      return res.status(400).json({ error: 'project_id, name, duration_days required' });
    }
    const { rows } = await client.sql`
      INSERT INTO tasks (project_id, name, sequence, predecessor_id, dependency_type, duration_days)
      VALUES (${project_id}, ${name}, ${sequence || 0}, ${predecessor_id || null}, ${dependency_type || 'FS'}, ${duration_days})
      RETURNING *
    `;
    await recalculateProject(project_id);
    return res.status(201).json(rows[0]);
  }

  return res.status(405).end();
}
