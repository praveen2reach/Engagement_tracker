import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql, getPool } = require('../../../lib/db');
const { recalculateProject } = require('../../../lib/recalculate');
const ExcelJS = require('exceljs');

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

// Cells Excel users hand-edit can come back as plain strings, numbers,
// Dates, or — commonly, once a cell has been reformatted or pasted from
// elsewhere — a "rich text" object ({ richText: [{text: '...'}, ...] }).
// Treating that object as a plain string (String(cell)) produces the
// literal text "[object Object]", which silently breaks name-matching.
// This normalizes any of those shapes down to plain text.
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text || '').join('').trim();
    }
    if ('text' in value) return String(value.text).trim();
    if ('result' in value) return cellText(value.result);
  }
  return String(value).trim();
}

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

  let headerRowNum = null;
  sheet.eachRow((row, rowNumber) => {
    if (headerRowNum) return;
    const firstCell = cellText(row.getCell(1).value).toLowerCase();
    if (firstCell === 's.no') headerRowNum = rowNumber;
  });
  if (!headerRowNum) {
    return res.status(400).json({ error: 'Could not find the header row (expected "S.No" in column A). Please use our template.' });
  }

  const parsed = [];
  const errors = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return;
    const cells = row.values;
    const name = cellText(cells[2]);
    if (!name) return;

    const predecessor = cellText(cells[3]);
    const durationRaw = cells[4];
    const functional_owner = cellText(cells[5]);
    const technical_owner = cellText(cells[6]);
    const integration_owner = cellText(cells[7]);
    const client_poc = cellText(cells[8]);
    const milestoneRaw = cellText(cells[9]).toLowerCase();
    const depTypeRaw = cellText(cells[10]).toUpperCase();

    const duration = Number(durationRaw && durationRaw.result !== undefined ? durationRaw.result : durationRaw);
    if (!durationRaw || Number.isNaN(duration) || duration <= 0) {
      errors.push(`Row ${rowNumber}: "${name}" — Duration (days) must be a positive number.`);
    }
    const dependency_type = depTypeRaw === 'SS' ? 'SS' : 'FS';
    if (depTypeRaw && !['FS', 'SS'].includes(depTypeRaw)) {
      errors.push(`Row ${rowNumber}: "${name}" — Dependency Type must be FS or SS (got "${depTypeRaw}").`);
    }
    const is_milestone = milestoneRaw === 'yes';

    parsed.push({ rowNumber, name, predecessor, duration, functional_owner, technical_owner, integration_owner, client_poc, is_milestone, dependency_type });
  });

  if (parsed.length === 0) {
    return res.status(400).json({ error: 'No task rows found below the header.' });
  }

  const nameCounts = {};
  for (const p of parsed) nameCounts[p.name] = (nameCounts[p.name] || 0) + 1;
  for (const [name, count] of Object.entries(nameCounts)) {
    if (count > 1) errors.push(`"${name}" appears ${count} times — Task names must be unique within the file.`);
  }

  const fileNames = new Set(parsed.map((p) => p.name));
  let existingNames = new Set();
  if (mode === 'add_update') {
    const { rows: existingTasks } = await sql`SELECT name FROM tasks WHERE project_id = ${project_id}`;
    existingNames = new Set(existingTasks.map((t) => t.name.trim()));
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

  const pool = getPool();

  // Bulk-insert helper: one round trip for any number of new rows, RETURNING
  // ids in the same order the rows were given (guaranteed for a plain
  // multi-row INSERT ... VALUES ... RETURNING, no ON CONFLICT reordering).
  async function bulkInsert(rowsToInsert, startSeq) {
    if (rowsToInsert.length === 0) return [];
    const valueRows = [];
    const params = [];
    let i = 1;
    let seq = startSeq;
    for (const p of rowsToInsert) {
      valueRows.push(`($${i}, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8})`);
      params.push(project_id, p.name, seq, p.duration, p.functional_owner || null, p.technical_owner || null, p.integration_owner || null, p.client_poc || null);
      params.push(p.is_milestone);
      i += 9;
      seq += 1;
    }
    const query = `
      INSERT INTO tasks (project_id, name, sequence, duration_days, functional_owner, technical_owner, integration_owner, client_poc, is_milestone)
      VALUES ${valueRows.join(', ')}
      RETURNING id
    `;
    // Note: dependency_type isn't in this insert list (defaults to 'FS'); set per-row after, in the same bulk update pass as predecessor linking.
    const { rows } = await pool.query(query, params);
    return rows.map((r) => r.id);
  }

  async function bulkUpdateDependenciesAndFields(entries) {
    // entries: [{ id, predecessor_id, dependency_type, duration, functional_owner, technical_owner, integration_owner, client_poc, is_milestone }]
    if (entries.length === 0) return;
    const valueRows = [];
    const params = [];
    let i = 1;
    for (const e of entries) {
      valueRows.push(`($${i}::int, $${i + 1}::int, $${i + 2}::text, $${i + 3}::int, $${i + 4}::text, $${i + 5}::text, $${i + 6}::text, $${i + 7}::text, $${i + 8}::boolean)`);
      params.push(e.id, e.predecessor_id, e.dependency_type, e.duration, e.functional_owner, e.technical_owner, e.integration_owner, e.client_poc, e.is_milestone);
      i += 9;
    }
    const query = `
      UPDATE tasks AS t
      SET predecessor_id = v.predecessor_id,
          dependency_type = v.dependency_type,
          duration_days = v.duration_days,
          functional_owner = v.functional_owner,
          technical_owner = v.technical_owner,
          integration_owner = v.integration_owner,
          client_poc = v.client_poc,
          is_milestone = v.is_milestone
      FROM (VALUES ${valueRows.join(', ')}) AS v(id, predecessor_id, dependency_type, duration_days, functional_owner, technical_owner, integration_owner, client_poc, is_milestone)
      WHERE t.id = v.id
    `;
    await pool.query(query, params);
  }

  if (mode === 'replace') {
    await sql`DELETE FROM tasks WHERE project_id = ${project_id}`;
    const ids = await bulkInsert(parsed, 1);
    const nameToId = new Map(parsed.map((p, idx) => [p.name, ids[idx]]));
    const entries = parsed.map((p) => ({
      id: nameToId.get(p.name),
      predecessor_id: p.predecessor ? nameToId.get(p.predecessor) : null,
      dependency_type: p.dependency_type,
      duration: p.duration,
      functional_owner: p.functional_owner || null,
      technical_owner: p.technical_owner || null,
      integration_owner: p.integration_owner || null,
      client_poc: p.client_poc || null,
      is_milestone: p.is_milestone,
    }));
    await bulkUpdateDependenciesAndFields(entries);
  } else {
    const { rows: existingTasks } = await sql`SELECT id, name FROM tasks WHERE project_id = ${project_id}`;
    const nameToId = new Map(existingTasks.map((t) => [t.name.trim(), t.id]));
    const { rows: maxSeqRows } = await sql`SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM tasks WHERE project_id = ${project_id}`;
    const startSeq = maxSeqRows[0].max_seq + 1;

    const toInsert = parsed.filter((p) => !nameToId.has(p.name));
    const newIds = await bulkInsert(toInsert, startSeq);
    toInsert.forEach((p, idx) => nameToId.set(p.name, newIds[idx]));

    const entries = parsed.map((p) => ({
      id: nameToId.get(p.name),
      predecessor_id: p.predecessor ? nameToId.get(p.predecessor) : null,
      dependency_type: p.dependency_type,
      duration: p.duration,
      functional_owner: p.functional_owner || null,
      technical_owner: p.technical_owner || null,
      integration_owner: p.integration_owner || null,
      client_poc: p.client_poc || null,
      is_milestone: p.is_milestone,
    }));
    await bulkUpdateDependenciesAndFields(entries);
  }

  await recalculateProject(project_id);
  return res.status(200).json({ imported: parsed.length, mode });
}
