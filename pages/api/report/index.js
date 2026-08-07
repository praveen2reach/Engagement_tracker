import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');
const { weekIndexForDate, deviationDays, suggestScheduleRag, worstRag, toStr } = require('../../../lib/dateEngine');

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  if (req.method !== 'GET') return res.status(405).end();

  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const { rows: projectRows } = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
  const project = projectRows[0];
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { rows: tasks } = await sql`
    SELECT * FROM tasks WHERE project_id = ${project_id} ORDER BY sequence ASC
  `;
  const { rows: holidayRows } = await sql`SELECT holiday_date FROM holidays`;
  const holidaySet = new Set(holidayRows.map((h) => h.holiday_date.toISOString().slice(0, 10)));
  const projectStart = project.start_date.toISOString().slice(0, 10);
  const todayStr = toStr(new Date());

  let maxWeek = 1;
  const ganttTasks = tasks
    .filter((t) => t.planned_start && t.planned_end)
    .map((t) => {
      const plannedStart = t.planned_start.toISOString().slice(0, 10);
      const plannedEnd = t.planned_end.toISOString().slice(0, 10);
      const weekStart = weekIndexForDate(plannedStart, projectStart);
      const weekEnd = weekIndexForDate(plannedEnd, projectStart);
      if (weekEnd > maxWeek) maxWeek = weekEnd;
      const actualEnd = t.actual_end ? t.actual_end.toISOString().slice(0, 10) : null;
      return {
        id: t.id,
        name: t.name,
        owner: t.owner,
        is_milestone: t.is_milestone,
        status: t.status,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        week_start: weekStart,
        week_end: weekEnd,
        deviation_days: deviationDays(plannedEnd, actualEnd, holidaySet),
      };
    });

  const totalWeeks = project.week_override || maxWeek;
  const currentWeek = weekIndexForDate(todayStr, projectStart);

  const scheduleSuggested = suggestScheduleRag(tasks.map((t) => ({
    planned_end: t.planned_end ? t.planned_end.toISOString().slice(0, 10) : null,
    actual_end: t.actual_end ? t.actual_end.toISOString().slice(0, 10) : null,
    status: t.status,
  })), holidaySet, todayStr);
  const scopeSuggested = 'G'; // no data source in this tool — always defaults Green until set manually
  const resourceSuggested = 'G'; // same
  const overallSuggested = worstRag(scheduleSuggested, scopeSuggested, resourceSuggested);

  const rag = {
    schedule: { suggested: scheduleSuggested, value: project.rag_schedule || scheduleSuggested, isOverride: !!project.rag_schedule },
    scope: { suggested: scopeSuggested, value: project.rag_scope || scopeSuggested, isOverride: !!project.rag_scope },
    resource: { suggested: resourceSuggested, value: project.rag_resource || resourceSuggested, isOverride: !!project.rag_resource },
    overall: { suggested: overallSuggested, value: project.rag_overall || overallSuggested, isOverride: !!project.rag_overall },
  };

  const milestones = ganttTasks
    .filter((t) => t.is_milestone)
    .map((t) => ({ name: t.name, status: t.status, due: t.planned_end, owner: t.owner }));

  return res.status(200).json({
    project: { id: project.id, name: project.name, start_date: projectStart, week_override: project.week_override },
    totalWeeks,
    currentWeek,
    tasks: ganttTasks,
    milestones,
    rag,
  });
}
