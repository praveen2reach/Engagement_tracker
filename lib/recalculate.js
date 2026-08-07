// lib/recalculate.js
const { sql, getPool } = require('./db');
const { cascadeDates } = require('./dateEngine');

/**
 * Recalculates planned_start/planned_end for every task in a project and
 * persists them in a SINGLE bulk UPDATE (rather than one query per task),
 * which matters once an engagement has 20-30+ tasks — a query-per-task loop
 * against a remote Postgres adds real round-trip latency per row.
 */
async function recalculateProject(projectId) {
  const { rows: project } = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (!project[0]) throw new Error('Project not found');

  const { rows: tasks } = await sql`
    SELECT id, sequence, predecessor_id, dependency_type, duration_days,
           baseline_start, baseline_end
    FROM tasks WHERE project_id = ${projectId}
  `;
  if (tasks.length === 0) return;

  const { rows: holidayRows } = await sql`SELECT holiday_date FROM holidays`;
  const holidaySet = new Set(holidayRows.map((h) => h.holiday_date.toISOString().slice(0, 10)));

  const computed = cascadeDates(tasks, project[0].start_date.toISOString().slice(0, 10), holidaySet);

  // Build one UPDATE ... FROM (VALUES ...) statement covering every task.
  const valueRows = [];
  const params = [];
  let i = 1;
  for (const task of tasks) {
    const dates = computed.get(task.id);
    const hasBaseline = !!task.baseline_start;
    const baselineStart = hasBaseline ? task.baseline_start : dates.planned_start;
    const baselineEnd = hasBaseline ? task.baseline_end : dates.planned_end;
    valueRows.push(`($${i}::int, $${i + 1}::date, $${i + 2}::date, $${i + 3}::date, $${i + 4}::date)`);
    params.push(task.id, dates.planned_start, dates.planned_end, baselineStart, baselineEnd);
    i += 5;
  }

  const query = `
    UPDATE tasks AS t
    SET planned_start = v.planned_start,
        planned_end = v.planned_end,
        baseline_start = v.baseline_start,
        baseline_end = v.baseline_end,
        updated_at = now()
    FROM (VALUES ${valueRows.join(', ')}) AS v(id, planned_start, planned_end, baseline_start, baseline_end)
    WHERE t.id = v.id
  `;
  await getPool().query(query, params);
}

module.exports = { recalculateProject };
