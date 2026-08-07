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
  const [tab, setTab] = useState('status'); // 'status' | 'recovery'
  const [recovery, setRecovery] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({}); // task_id -> draft text
  const [generalNote, setGeneralNote] = useState('');

  const loadRecovery = useCallback(async (pid) => {
    if (!pid) return;
    const res = await fetch(`/api/recovery?project_id=${pid}`);
    if (res.ok) setRecovery(await res.json());
  }, []);

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

  useEffect(() => { loadReport(projectId); loadRecovery(projectId); }, [projectId, loadReport, loadRecovery]);

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

  async function saveRecoveryNote(task_id, note_type, text) {
    if (!text || !text.trim()) return;
    await fetch('/api/recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, task_id: task_id || null, note_type, note_text: text }),
    });
    if (task_id) setNoteDrafts((d) => ({ ...d, [task_id]: '' }));
    else setGeneralNote('');
    loadRecovery(projectId);
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
          {isAdmin && tab === 'status' && (
            <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0', display: 'block' }}>Weeks to show</label>
                <input type="number" min="1" placeholder="auto" value={weekInput} onChange={(e) => setWeekInput(e.target.value)} style={{ width: 90 }} />
              </div>
              <button className="secondary" onClick={saveWeekOverride}>Set</button>
            </div>
          )}
          {tab === 'status' && <button onClick={() => window.print()}>Download / Print PDF</button>}
        </div>

        <div className="panel no-print" style={{ display: 'flex', gap: 8, padding: 10 }}>
          <button className={tab === 'status' ? '' : 'secondary'} onClick={() => setTab('status')}>Status Report</button>
          <button className={tab === 'recovery' ? '' : 'secondary'} onClick={() => setTab('recovery')}>Impact &amp; Recovery</button>
        </div>

        {tab === 'status' && report && (
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
                    {weeks.map((w) => (
                      <th className={`week-col${w === report.currentWeek ? ' current-week-col' : ''}`} key={w}>
                        {w === report.currentWeek ? '⭐ ' : ''}W{w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.tasks.map((t) => (
                    <tr key={t.id} className={t.is_milestone ? 'milestone-row' : ''}>
                      <td>{t.name}</td>
                      <td>{t.functional_owner || '—'}</td>
                      <td>{t.planned_start}</td>
                      <td>{t.planned_end}</td>
                      {weeks.map((w) => {
                        const inRange = w >= t.week_start && w <= t.week_end;
                        const currentCls = w === report.currentWeek ? ' current-week-col' : '';
                        if (!inRange) return <td className={`week-col${currentCls}`} key={w}></td>;
                        return (
                          <td className={`week-col${currentCls} gantt-cell ${t.is_milestone ? 'milestone' : 'filled'}`} key={w}>
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

        {tab === 'recovery' && recovery && (
          <div className="panel">
            <h2>Impact on deadline</h2>
            {recovery.projectImpactDays > 0 ? (
              <div className="badge red" style={{ fontSize: 14, padding: '6px 14px', marginBottom: 12, display: 'inline-block' }}>
                {recovery.projectImpactDays} working day{recovery.projectImpactDays > 1 ? 's' : ''} of slip on the critical path
              </div>
            ) : (
              <div className="badge green" style={{ fontSize: 14, padding: '6px 14px', marginBottom: 12, display: 'inline-block' }}>
                No slip on the critical path — deadline unaffected right now
              </div>
            )}
            <p className="subtle">
              Only tasks on the Critical Path (zero float) actually push out the deadline. A task can run late without
              affecting Go-Live if it has spare float — this calculation accounts for that.
            </p>

            <h2 style={{ marginTop: 20 }}>Critical Path</h2>
            <p className="subtle">{recovery.criticalPath.length ? recovery.criticalPath.join(' → ') : 'Not enough data yet.'}</p>

            <h2 style={{ marginTop: 20 }}>Float by task</h2>
            <table style={{ marginBottom: 20 }}>
              <thead><tr><th>Task</th><th>Planned</th><th>Float (working days)</th><th>Critical?</th></tr></thead>
              <tbody>
                {recovery.floatTable.map((t) => (
                  <tr key={t.id} style={t.is_critical ? { background: '#fbeae7' } : {}}>
                    <td>{t.name}</td>
                    <td>{t.planned_start} → {t.planned_end}</td>
                    <td>{t.float_days}</td>
                    <td>{t.is_critical ? <span className="badge red">Critical</span> : <span className="badge grey">Has slack</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2>Recovery suggestions</h2>
            {recovery.suggestions.length === 0 ? (
              <p className="subtle">No critical-path tasks are currently running late — nothing to recover from right now.</p>
            ) : (
              recovery.suggestions.map((s) => (
                <div key={s.task_id} className="panel" style={{ background: '#f6f7f9', marginBottom: 12 }}>
                  <h3 style={{ marginBottom: 6 }}>{s.task_name} — {s.late_days}d late, on critical path</h3>
                  <ul style={{ marginTop: 0, paddingLeft: 18, fontSize: 13 }}>
                    {s.options.map((opt, i) => <li key={i} style={{ marginBottom: 4 }}>{opt}</li>)}
                  </ul>
                  <textarea
                    rows={2}
                    placeholder="Edit a suggestion above (or write your own) before logging it as the agreed plan…"
                    value={noteDrafts[s.task_id] ?? ''}
                    onChange={(e) => setNoteDrafts((d) => ({ ...d, [s.task_id]: e.target.value }))}
                  />
                  <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                    <button onClick={() => saveRecoveryNote(s.task_id, 'manual', noteDrafts[s.task_id])}>Log to Recovery Log</button>
                    <button className="secondary" onClick={() => saveRecoveryNote(s.task_id, 'auto-suggested', s.options.join(' | '))}>Log all suggestions as-is</button>
                  </div>
                </div>
              ))
            )}

            <h2 style={{ marginTop: 20 }}>Add a general note</h2>
            <textarea
              rows={2}
              placeholder="e.g. Agreed with client to phase Requirement X to Release 2 to protect Go-Live date…"
              value={generalNote}
              onChange={(e) => setGeneralNote(e.target.value)}
            />
            <div style={{ marginTop: 6 }}>
              <button onClick={() => saveRecoveryNote(null, 'manual', generalNote)}>Log to Recovery Log</button>
            </div>

            <h2 style={{ marginTop: 24 }}>Recovery Log</h2>
            <p className="subtle">Full history — always available, never edited after the fact.</p>
            {recovery.log.length === 0 ? (
              <p className="subtle">No entries yet.</p>
            ) : (
              <table>
                <thead><tr><th>Date</th><th>By</th><th>Type</th><th>Note</th></tr></thead>
                <tbody>
                  {recovery.log.map((l) => (
                    <tr key={l.id}>
                      <td>{new Date(l.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td>{l.user_name}</td>
                      <td><span className={`badge ${l.note_type === 'auto-suggested' ? 'amber' : 'grey'}`}>{l.note_type}</span></td>
                      <td>{l.note_text}</td>
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
