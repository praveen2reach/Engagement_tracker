import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');
const ExcelJS = require('exceljs');

const HEADERS = ['S.No', 'Task', 'Predecessor', 'Duration (days)', 'Owner', 'Milestone (Yes/No)', 'Dependency Type (FS/SS)'];

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  if (req.method !== 'GET') return res.status(405).end();

  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const { rows: projectRows } = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
  const project = projectRows[0];
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { rows: tasks } = await sql`SELECT * FROM tasks WHERE project_id = ${project_id} ORDER BY sequence ASC`;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tasks');

  sheet.addRow(['This is the Engagement Task Tracker upload template. Keep the header row exactly as-is. Predecessor must exactly match another row\'s Task text (case-sensitive), or be left blank.']);
  sheet.mergeCells(1, 1, 1, HEADERS.length);
  sheet.getRow(1).font = { italic: true, size: 10, color: { argb: 'FF7C8AA0' } };
  sheet.addRow([]);

  const headerRow = sheet.addRow(HEADERS);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16324F' } };
  });
  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  if (tasks.length === 0) {
    sheet.addRow([1, 'Requirement Gathering', '', 5, 'Consultant Name', 'No', 'FS']);
    sheet.addRow([2, 'Solution Design', 'Requirement Gathering', 8, 'Consultant Name', 'No', 'FS']);
  } else {
    for (const t of tasks) {
      const predName = t.predecessor_id ? byId.get(t.predecessor_id)?.name || '' : '';
      sheet.addRow([
        t.sequence,
        t.name,
        predName,
        t.duration_days,
        t.owner || '',
        t.is_milestone ? 'Yes' : 'No',
        t.dependency_type || 'FS',
      ]);
    }
  }

  sheet.columns = [
    { width: 6 },
    { width: 34 },
    { width: 30 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 20 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${project.name.replace(/[^a-z0-9]+/gi, '_')}_tasks.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(Buffer.from(buffer));
}
