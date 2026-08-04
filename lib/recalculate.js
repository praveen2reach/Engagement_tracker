// lib/recalculate.js
const { getClient } = require('./db');
const { cascadeDates } = require('./dateEngine');

/**
 * Recalculates planned_start/planned_end for every task in a project and
 * persists them. If a task has no baseline yet, the freshly computed dates
 * are also written as its Baseline v1 (frozen from then on).
 */
async function recalculateProject(projectId) {
  const client = await getClient();
  const { rows: project } = await client.sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (!project[0]) throw new Error('Project not found');

  const { rows: tasks } = await client.sql`
    SELECT id, sequence, predecessor_id, dependency_type, duration_days,
           baseline_start, baseline_end
    FROM tasks WHERE project_id = ${projectId}
  `;
  const { rows: holidayRows } = await client.sql`SELECT holiday_date FROM holidays`;
  const holidaySet = new Set(holidayRows.map((h) => h.holiday_date.toISOString().slice(0, 10)));

  const computed = cascadeDates(tasks, project[0].start_date.toISOString().slice(0, 10), holidaySet);

  for (const task of tasks) {
    const dates = computed.get(task.id);
    const hasBaseline = !!task.baseline_start;
    await client.sql`
      UPDATE tasks
      SET planned_start = ${dates.planned_start},
          planned_end = ${dates.planned_end},
          baseline_start = ${hasBaseline ? task.baseline_start : dates.planned_start},
          baseline_end = ${hasBaseline ? task.baseline_end : dates.planned_end},
          updated_at = now()
      WHERE id = ${task.id}
    `;
  }
}

module.exports = { recalculateProject };
