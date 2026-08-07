// pages/api/cron/daily-digest.js
//
// Triggered daily by Vercel Cron (see vercel.json). Can also be triggered
// manually by visiting this URL with ?secret=YOUR_ADMIN_PASSWORD, e.g. to
// test the email before waiting for the schedule.
//
// Sends ONE email to everyone in ALERT_RECIPIENTS (comma-separated env var)
// summarizing, across every engagement: tasks that are overdue, milestones
// due in the next 7 days, and comments logged in the last 24 hours. Kept as
// a single daily digest rather than an email-per-event, since per-comment
// emails would be noisy for an 8+ person team.

const { sql } = require('../../../lib/db');
const { toStr, deviationDays } = require('../../../lib/dateEngine');
const { sendDigestEmail } = require('../../../lib/email');

export default async function handler(req, res) {
  const cronAuth = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const manualAuth = process.env.ADMIN_PASSWORD && req.query.secret === process.env.ADMIN_PASSWORD;
  if (!cronAuth && !manualAuth) {
    return res.status(403).json({ error: 'Not authorized.' });
  }

  const recipients = (process.env.ALERT_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    return res.status(200).json({ skipped: 'No ALERT_RECIPIENTS configured.' });
  }

  const { rows: projects } = await sql`SELECT * FROM projects ORDER BY name ASC`;
  const { rows: holidayRows } = await sql`SELECT holiday_date FROM holidays`;
  const holidaySet = new Set(holidayRows.map((h) => h.holiday_date.toISOString().slice(0, 10)));
  const todayStr = toStr(new Date());
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const sevenDaysOutStr = toStr(sevenDaysOut);

  let sections = '';
  let anythingToReport = false;

  for (const project of projects) {
    const { rows: tasks } = await sql`SELECT * FROM tasks WHERE project_id = ${project.id} ORDER BY sequence ASC`;
    const { rows: recentComments } = await sql`
      SELECT c.*, u.name AS user_name, t.name AS task_name
      FROM comments c
      JOIN users u ON u.id = c.user_id
      JOIN tasks t ON t.id = c.task_id
      WHERE t.project_id = ${project.id} AND c.created_at > now() - interval '24 hours'
      ORDER BY c.created_at DESC
    `;

    const overdue = tasks.filter((t) => {
      if (!t.planned_end || t.status === 'Completed') return false;
      const plannedEnd = t.planned_end.toISOString().slice(0, 10);
      return plannedEnd < todayStr;
    }).map((t) => {
      const plannedEnd = t.planned_end.toISOString().slice(0, 10);
      const lateDays = deviationDays(plannedEnd, todayStr, holidaySet);
      return { name: t.name, owner: t.owner, lateDays };
    });

    const upcomingMilestones = tasks.filter((t) => {
      if (!t.is_milestone || !t.planned_end) return false;
      const plannedEnd = t.planned_end.toISOString().slice(0, 10);
      return plannedEnd >= todayStr && plannedEnd <= sevenDaysOutStr;
    }).map((t) => ({ name: t.name, due: t.planned_end.toISOString().slice(0, 10), owner: t.owner }));

    if (overdue.length === 0 && upcomingMilestones.length === 0 && recentComments.length === 0) continue;
    anythingToReport = true;

    sections += `<h2 style="color:#16324f;margin-top:24px;">${project.name}</h2>`;

    if (overdue.length) {
      sections += `<p><b>Overdue tasks (${overdue.length})</b></p><ul>`;
      for (const t of overdue) {
        sections += `<li>${t.name}${t.owner ? ` (${t.owner})` : ''} — ${t.lateDays} working day${t.lateDays > 1 ? 's' : ''} late</li>`;
      }
      sections += `</ul>`;
    }
    if (upcomingMilestones.length) {
      sections += `<p><b>Milestones due within 7 days</b></p><ul>`;
      for (const m of upcomingMilestones) {
        sections += `<li>${m.name}${m.owner ? ` (${m.owner})` : ''} — due ${m.due}</li>`;
      }
      sections += `</ul>`;
    }
    if (recentComments.length) {
      sections += `<p><b>Comments logged in the last 24 hours (${recentComments.length})</b></p><ul>`;
      for (const c of recentComments) {
        sections += `<li><b>${c.user_name}</b> on "${c.task_name}": ${c.comment_text}</li>`;
      }
      sections += `</ul>`;
    }
  }

  if (!anythingToReport) {
    return res.status(200).json({ skipped: 'Nothing to report today — no email sent.' });
  }

  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#1b2430;">
      <h1 style="color:#16324f;">Daily Engagement Digest</h1>
      <p style="color:#7c8aa0;">${todayStr}</p>
      ${sections}
    </div>
  `;

  try {
    await sendDigestEmail({ to: recipients, subject: `Engagement Tracker — Daily Digest (${todayStr})`, html });
    return res.status(200).json({ sent: true, recipients: recipients.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
