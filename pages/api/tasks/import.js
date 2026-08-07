import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');
const { recalculateProject } = require('../../../lib/recalculate');
const ExcelJS = require('exceljs');

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (req.method !== 'POST') return res.status(405).end();

  const { project_id, mode, file_base64 } = req.body;
  if (!project_id || !mode || !file_base64) {
    return res.status(400).json({ error: 'project_id, mode, and file_base64 required' });
  }
  if (!['replace', 'add_update'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "replace" or "add_update"' });
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(file_base64, 'base64'));
  } catch (err) {
    return res.status(400).json({ error: 'Could not read that file — please upload the .xlsx template.' });
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ error: 'No sheet found in the uploaded file.' });

  // Find the header row (it's row 3 in our template, but be lenient and search)
  let headerRowNum = null;
  sheet.eachRow((row, rowNumber) => {
    if (headerRowNum) return;
    const firstCell = String(row.getCell(1).value || '').trim().toLowerCase();
    if (firstCell === 's.no') headerRowNum = rowNumber;
  });
  if (!headerRowNum) {
    return res.status(400).json({ error: 'Could not find the header row (expected "S.No" in column A). Please use our template.' });
  }

  const parsed = [];
  const errors = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return;
    const cells = row.values; // 1-indexed array, [0] is empty
    const name = String(cells[2] || '').trim();
    if (!name) return; // skip blank rows

    const predecessor = String(cells[3] || '').trim();
    const durationRaw = cells[4];
    const owner = String(cells[5] || '').trim();
    const milestoneRaw = String(cells[6] || '').trim().toLowerCase();
    const depTypeRaw = String(cells[7] || '').trim().toUpperCase();

    const duration = Number(durationRaw);
    if (!durationRaw || Number.isNaN(duration) || duration <= 0) {
      errors.push(`Row ${rowNumber}: "${name}" — Duration (days) must be a positive number.`);
    }
    const dependency_type = depTypeRaw === 'SS' ? 'SS' : 'FS';
    if (depTypeRaw && !['FS', 'SS'].includes(depTypeRaw)) {
      errors.push(`Row ${rowNumber}: "${name}" — Dependency Type must be FS or SS (got "${depTypeRaw}").`);
    }
    const is_milestone = milestoneRaw === 'yes';

    parsed.push({ rowNumber, name, predecessor, duration, owner, is_milestone, dependency_type });
  });

  if (parsed.length === 0) {
    return res.status(400).json({ error: 'No task rows found below the header.' });
  }

  // Duplicate name check within the file (predecessor lookup depends on unique names)
  const nameCounts = {};
  for (const p of parsed) nameCounts[p.name] = (nameCounts[p.name] || 0) + 1;
  for (const [name, count] of Object.entries(nameCounts)) {
    if (count > 1) errors.push(`"${name}" appears ${count} times — Task names must be unique within the file.`);
  }

  // Predecessor references must resolve to another row in the file, or (in add_update mode) an existing task
  const fileNames = new Set(parsed.map((p) => p.name));
  let existingNames = new Set();
  if (mode === 'add_update') {
    const { rows: existingTasks } = await sql`SELECT name FROM tasks WHERE project_id = ${project_id}`;
    existingNames = new Set(existingTasks.map((t) => t.name));
  }
  for (const p of parsed) {
    if (p.predecessor && !fileNames.has(p.predecessor) && !existingNames.has(p.predecessor)) {
      errors.push(`Row ${p.rowNumber}: "${p.name}" — Predecessor "${p.predecessor}" not found in this file${mode === 'add_update' ? ' or in existing tasks' : ''}.`);
    }
    if (p.predecessor === p.name) {
      errors.push(`Row ${p.rowNumber}: "${p.name}" cannot be its own predecessor.`);
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Fix the following and re-upload:', details: errors });
  }

  // Everything validated — now write to the database.
  if (mode === 'replace') {
    await sql`DELETE FROM tasks WHERE project_id = ${project_id}`;
    const nameToId = new Map();
    let seq = 1;
    for (const p of parsed) {
      const { rows } = await sql`
        INSERT INTO tasks (project_id, name, sequence, duration_days, owner, is_milestone, dependency_type)
        VALUES (${project_id}, ${p.name}, ${seq}, ${p.duration}, ${p.owner || null}, ${p.is_milestone}, ${p.dependency_type})
        RETURNING id
      `;
      nameToId.set(p.name, rows[0].id);
      seq += 1;
    }
    for (const p of parsed) {
      if (p.predecessor) {
        await sql`UPDATE tasks SET predecessor_id = ${nameToId.get(p.predecessor)} WHERE id = ${nameToId.get(p.name)}`;
      }
    }
  } else {
    // add_update: match by exact task name
    const { rows: existingTasks } = await sql`SELECT id, name FROM tasks WHERE project_id = ${project_id}`;
    const nameToId = new Map(existingTasks.map((t) => [t.name, t.id]));
    const { rows: maxSeqRows } = await sql`SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM tasks WHERE project_id = ${project_id}`;
    let nextSeq = maxSeqRows[0].max_seq + 1;

    for (const p of parsed) {
      if (nameToId.has(p.name)) {
        await sql`
          UPDATE tasks
          SET duration_days = ${p.duration}, owner = ${p.owner || null}, is_milestone = ${p.is_milestone}, dependency_type = ${p.dependency_type}
          WHERE id = ${nameToId.get(p.name)}
        `;
      } else {
        const { rows } = await sql`
          INSERT INTO tasks (project_id, name, sequence, duration_days, owner, is_milestone, dependency_type)
          VALUES (${project_id}, ${p.name}, ${nextSeq}, ${p.duration}, ${p.owner || null}, ${p.is_milestone}, ${p.dependency_type})
          RETURNING id
        `;
        nameToId.set(p.name, rows[0].id);
        nextSeq += 1;
      }
    }
    for (const p of parsed) {
      if (p.predecessor) {
        await sql`UPDATE tasks SET predecessor_id = ${nameToId.get(p.predecessor)} WHERE id = ${nameToId.get(p.name)}`;
      }
    }
  }

  await recalculateProject(project_id);
  return res.status(200).json({ imported: parsed.length, mode });
}
