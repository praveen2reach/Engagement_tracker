import { useEffect, useState, useCallback } from 'react';
import { getServerSession } from 'next-auth/next';
import { useSession, signOut } from 'next-auth/react';
import { authOptions } from '../lib/auth';

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
}

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function deviationBadge(dev) {
  if (dev === null || dev === undefined) return <span className="badge grey">Pending</span>;
  if (dev <= 0) return <span className="badge green">{dev === 0 ? 'On time' : `${Math.abs(dev)}d early`}</span>;
  if (dev <= 2) return <span className="badge amber">{dev}d late</span>;
  return <span className="badge red">{dev}d late</span>;
}

function statusBadge(status) {
  const map = { 'Not Started': 'grey', 'In Progress': 'amber', 'Completed': 'green', 'On Hold': 'red' };
  return <span className={`badge ${map[status] || 'grey'}`}>{status}</span>;
}

function CommentCell({ taskId }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?task_id=${taskId}`);
    if (res.ok) setComments(await res.json());
  }, [taskId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function addComment() {
    if (!text.trim()) return;
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, comment_text: text }),
    });
    setText('');
    load();
  }

  return (
    <div style={{ minWidth: 220 }}>
      <button className="secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setOpen(!open)}>
        {open ? 'Hide log' : `Log${comments.length ? ` (${comments.length})` : ''}`}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div className="comment-log">
            {comments.length === 0 && <div className="subtle">No comments yet.</div>}
            {comments.map((c) => (
              <div className="entry" key={c.id}>
                <b>{c.user_name}</b>
                <span className="date">{fmt(c.entered_on)}</span>
                <div>{c.comment_text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              placeholder="Add today's update…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addComment()}
            />
            <button onClick={addComment} style={{ padding: '7px 12px' }}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { data: session } = useSession();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = session?.user?.role === 'admin';

  const loadTasks = useCallback(async (pid) => {
    if (!pid) return;
    const res = await fetch(`/api/tasks?project_id=${pid}`);
    if (res.ok) setTasks(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        if (data.length) setProjectId(data[0].id);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => { loadTasks(projectId); }, [projectId, loadTasks]);

  async function updateTask(id, field, value) {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    loadTasks(projectId);
  }

  const currentWeekCount = tasks.filter((t) => t.is_current_week).length;
  const delayedCount = tasks.filter((t) => t.deviation_days > 0).length;

  return (
    <>
      <div className="topbar">
        <div className="brand">
          Engagement Task Tracker
          <small>{session?.user?.role === 'admin' ? 'Admin' : 'Team'} · {session?.user?.name}</small>
        </div>
        <nav>
          <a href="/report">Weekly report</a>
          {isAdmin && <a href="/admin">Admin setup</a>}
          <a href="#" onClick={(e) => { e.preventDefault(); signOut({ callbackUrl: '/login' }); }}>Sign out</a>
        </nav>
      </div>

      <div className="container">
        <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0' }}>Engagement</label>
            <select value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))} style={{ minWidth: 220 }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div><div style={{ fontSize: 22, fontWeight: 700, color: '#16324f' }}>{tasks.length}</div><div className="subtle">Total tasks</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 700, color: '#c8952a' }}>⭐ {currentWeekCount}</div><div className="subtle">Active this week</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 700, color: delayedCount ? '#c94a3d' : '#2f8f5b' }}>{delayedCount}</div><div className="subtle">Delayed tasks</div></div>
          </div>
        </div>

        <div className="panel">
          <h2>Full plan</h2>
          <p className="subtle">Rows highlighted ⭐ gold are active in the current week (Mon–Sun). Team members can update Actual Start/End, Status, and comments; only Admin can change durations, sequencing, or dependencies.</p>

          {loading ? <p>Loading…</p> : tasks.length === 0 ? (
            <p className="subtle">No tasks yet{isAdmin ? ' — set them up in Admin setup.' : ' for this engagement.'}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Duration</th>
                    <th>Planned Start</th>
                    <th>Planned End</th>
                    <th>Baseline End (v1)</th>
                    <th>Actual Start</th>
                    <th>Actual End</th>
                    <th>Deviation</th>
                    <th>Status</th>
                    <th>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className={t.is_current_week ? 'current-week' : ''}>
                      <td>{t.is_current_week && <span className="star">⭐</span>}{t.name}</td>
                      <td>{t.duration_days}d</td>
                      <td>{fmt(t.planned_start)}</td>
                      <td>{fmt(t.planned_end)}</td>
                      <td>{fmt(t.baseline_end)}</td>
                      <td>
                        <input
                          type="date"
                          defaultValue={t.actual_start ? t.actual_start.slice(0, 10) : ''}
                          onBlur={(e) => e.target.value && updateTask(t.id, 'actual_start', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          defaultValue={t.actual_end ? t.actual_end.slice(0, 10) : ''}
                          onBlur={(e) => e.target.value && updateTask(t.id, 'actual_end', e.target.value)}
                        />
                      </td>
                      <td>{deviationBadge(t.deviation_days)}</td>
                      <td>
                        <select defaultValue={t.status} onChange={(e) => updateTask(t.id, 'status', e.target.value)}>
                          <option>Not Started</option>
                          <option>In Progress</option>
                          <option>Completed</option>
                          <option>On Hold</option>
                        </select>
                      </td>
                      <td><CommentCell taskId={t.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
