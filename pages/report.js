import { useEffect, useState, useCallback } from 'react';
import { getServerSession } from 'next-auth/next';
import { useSession, signOut } from 'next-auth/react';
import { authOptions } from '../lib/auth';

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  return { props: {} };
}

const RAG_LABEL = { G: 'Green', A: 'Amber', R: 'Red' };

function RagBox({ label, ragKey, data, isAdmin, onChange }) {
  return (
    <div className={`rag-box ${data.value} ${data.isOverride ? '' : 'auto'}`}>
      <div className="rag-label">{label}</div>
      <div className="rag-value">{RAG_LABEL[data.value]}</div>
      {isAdmin && (
        <select
          className="no-print"
          value={data.isOverride ? data.value : 'auto'}
          onChange={(e) => onChange(ragKey, e.target.value === 'auto' ? null : e.target.value)}
        >
          <option value="auto">Auto ({RAG_LABEL[data.suggested]})</option>
          <option value="G">Green</option>
          <option value="A">Amber</option>
          <option value="R">Red</option>
        </select>
      )}
    </div>
  );
}

export default function Report() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [report, setReport] = useState(null);
  const [weekInput, setWeekInput] = useState('');

  const loadReport = useCallback(async (pid) => {
    if (!pid) return;
    const res = await fetch(`/api/report?project_id=${pid}`);
    if (res.ok) {
      const data = await res.json();
      setReport(data);
      setWeekInput(data.project.week_override || '');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        if (data.length) setProjectId(data[0].id);
      }
    })();
  }, []);

  useEffect(() => { loadReport(projectId); }, [projectId, loadReport]);

  async function updateRag(ragKey, value) {
    const fieldMap = { schedule: 'rag_schedule', scope: 'rag_scope', resource: 'rag_resource', overall: 'rag_overall' };
    await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [fieldMap[ragKey]]: value }),
    });
    loadReport(projectId);
  }

  async function saveWeekOverride() {
    await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_override: weekInput ? Number(weekInput) : null }),
    });
    loadReport(projectId);
  }

  const weeks = report ? Array.from({ length: report.totalWeeks }, (_, i) => i + 1) : [];

  return (
    <>
      <div className="topbar">
        <div className="brand">Engagement Task Tracker<small>Weekly Status Report · {session?.user?.name}</small></div>
        <nav>
          <a href="/">Tracker</a>
          {isAdmin && <a href="/admin">Admin setup</a>}
          <a href="#" onClick={(e) => { e.preventDefault(); signOut({ callbackUrl: '/login' }); }}>Sign out</a>
        </nav>
      </div>

      <div className="container">
        <div className="panel no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0' }}>Engagement</label>
            <select value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))} style={{ minWidth: 220 }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0', display: 'block' }}>Weeks to show</label>
                <input type="number" min="1" placeholder="auto" value={weekInput} onChange={(e) => setWeekInput(e.target.value)} style={{ width: 90 }} />
              </div>
              <button className="secondary" onClick={saveWeekOverride}>Set</button>
            </div>
          )}
          <button onClick={() => window.print()}>Download / Print PDF</button>
        </div>

        {report && (
          <div className="panel">
            <div className="report-header">
              <h1>{report.project.name}</h1>
              <div className="subtle">Week 1 starts {report.project.start_date}</div>
            </div>

            <div className="rag-row">
              <RagBox label="Overall" ragKey="overall" data={report.rag.overall} isAdmin={isAdmin} onChange={updateRag} />
              <RagBox label="Schedule" ragKey="schedule" data={report.rag.schedule} isAdmin={isAdmin} onChange={updateRag} />
              <RagBox label="Scope" ragKey="scope" data={report.rag.scope} isAdmin={isAdmin} onChange={updateRag} />
              <RagBox label="Resource" ragKey="resource" data={report.rag.resource} isAdmin={isAdmin} onChange={updateRag} />
            </div>

            <h2>Timeline</h2>
            <p className="subtle">Shaded cells = planned working weeks. ✕ = milestone week.</p>
            <div className="gantt-wrap">
              <table className="gantt-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Owner</th>
                    <th>Start</th>
                    <th>Due</th>
                    {weeks.map((w) => <th className="week-col" key={w}>W{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.tasks.map((t) => (
                    <tr key={t.id} className={t.is_milestone ? 'milestone-row' : ''}>
                      <td>{t.name}</td>
                      <td>{t.owner || '—'}</td>
                      <td>{t.planned_start}</td>
                      <td>{t.planned_end}</td>
                      {weeks.map((w) => {
                        const inRange = w >= t.week_start && w <= t.week_end;
                        if (!inRange) return <td className="week-col" key={w}></td>;
                        return (
                          <td className={`week-col gantt-cell ${t.is_milestone ? 'milestone' : 'filled'}`} key={w}>
                            {t.is_milestone ? '✕' : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 style={{ marginTop: 24 }}>Key Milestones</h2>
            {report.milestones.length === 0 ? (
              <p className="subtle">No tasks marked as milestones yet — check "Show as milestone" on a task in Admin setup.</p>
            ) : (
              <table className="milestone-table">
                <thead><tr><th>Milestone</th><th>Status</th><th>Due Date</th><th>Owner</th></tr></thead>
                <tbody>
                  {report.milestones.map((m, i) => (
                    <tr key={i}>
                      <td>{m.name}</td>
                      <td>{m.status}</td>
                      <td>{m.due}</td>
                      <td>{m.owner || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  );
}
