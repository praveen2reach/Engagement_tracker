import { useEffect, useState, useCallback } from 'react';
import { getServerSession } from 'next-auth/next';
import { useSession, signOut } from 'next-auth/react';
import { authOptions } from '../lib/auth';

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  if (session.user.role !== 'admin') return { redirect: { destination: '/', permanent: false } };
  return { props: {} };
}

export default function Admin() {
  const { data: session } = useSession();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [holidays, setHolidays] = useState([]);

  const [newProject, setNewProject] = useState({ name: '', start_date: '' });
  const [newTask, setNewTask] = useState({ name: '', predecessor_id: '', dependency_type: 'FS', duration_days: 1 });
  const [newHoliday, setNewHoliday] = useState({ holiday_date: '', label: '' });

  const loadAll = useCallback(async (pid) => {
    const [pRes, hRes] = await Promise.all([fetch('/api/projects'), fetch('/api/holidays')]);
    if (pRes.ok) {
      const data = await pRes.json();
      setProjects(data);
      if (!pid && data.length) pid = data[0].id;
      setProjectId(pid);
    }
    if (hRes.ok) setHolidays(await hRes.json());
  }, []);

  const loadTasks = useCallback(async (pid) => {
    if (!pid) return;
    const res = await fetch(`/api/tasks?project_id=${pid}`);
    if (res.ok) setTasks(await res.json());
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadTasks(projectId); }, [projectId, loadTasks]);

  async function createProject(e) {
    e.preventDefault();
    if (!newProject.name || !newProject.start_date) return;
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProject),
    });
    if (res.ok) {
      const p = await res.json();
      setNewProject({ name: '', start_date: '' });
      await loadAll(p.id);
    }
  }

  async function createTask(e) {
    e.preventDefault();
    if (!newTask.name || !newTask.duration_days) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        name: newTask.name,
        sequence: tasks.length + 1,
        predecessor_id: newTask.predecessor_id || null,
        dependency_type: newTask.dependency_type,
        duration_days: Number(newTask.duration_days),
      }),
    });
    setNewTask({ name: '', predecessor_id: '', dependency_type: 'FS', duration_days: 1 });
    loadTasks(projectId);
  }

  async function deleteTask(id) {
    if (!confirm('Remove this task? Downstream dates will recalculate.')) return;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    loadTasks(projectId);
  }

  async function editDuration(id, duration_days) {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_days: Number(duration_days) }),
    });
    loadTasks(projectId);
  }

  async function addHoliday(e) {
    e.preventDefault();
    if (!newHoliday.holiday_date || !newHoliday.label) return;
    await fetch('/api/holidays', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newHoliday),
    });
    setNewHoliday({ holiday_date: '', label: '' });
    loadAll(projectId);
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">Engagement Task Tracker<small>Admin setup · {session?.user?.name}</small></div>
        <nav>
          <a href="/">Back to tracker</a>
          <a href="#" onClick={(e) => { e.preventDefault(); signOut({ callbackUrl: '/login' }); }}>Sign out</a>
        </nav>
      </div>

      <div className="container">
        <div className="panel">
          <h2>Engagements</h2>
          <p className="subtle">One engagement per client project (e.g. Synlab ORC, POT OTL). Each has its own start date and holiday-aware plan.</p>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Name</th><th>Start date</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer', background: p.id === projectId ? '#f6f7f9' : 'transparent' }} onClick={() => setProjectId(p.id)}>
                  <td>{p.name}</td><td>{p.start_date?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={createProject} className="form-grid">
            <div><label>New engagement name</label><input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} placeholder="e.g. Synlab ORC Phase 2" /></div>
            <div><label>Start date</label><input type="date" value={newProject.start_date} onChange={(e) => setNewProject({ ...newProject, start_date: e.target.value })} /></div>
            <div style={{ alignSelf: 'end' }}><button type="submit">Add engagement</button></div>
          </form>
        </div>

        {projectId && (
          <div className="panel">
            <h2>Task setup</h2>
            <p className="subtle">Set dependency to a predecessor task. FS = starts after predecessor ends. SS = runs in parallel, starting the same day as the predecessor.</p>
            <table style={{ marginBottom: 16 }}>
              <thead><tr><th>Seq</th><th>Task</th><th>Predecessor</th><th>Type</th><th>Duration (days)</th><th>Planned</th><th></th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.sequence}</td>
                    <td>{t.name}</td>
                    <td>{tasks.find((x) => x.id === t.predecessor_id)?.name || '— (project start)'}</td>
                    <td>{t.dependency_type}</td>
                    <td><input type="number" min="1" defaultValue={t.duration_days} style={{ width: 70 }} onBlur={(e) => editDuration(t.id, e.target.value)} /></td>
                    <td>{t.planned_start?.slice(0, 10)} → {t.planned_end?.slice(0, 10)}</td>
                    <td><button className="secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => deleteTask(t.id)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form onSubmit={createTask} className="form-grid">
              <div><label>Task name</label><input value={newTask.name} onChange={(e) => setNewTask({ ...newTask, name: e.target.value })} /></div>
              <div>
                <label>Predecessor</label>
                <select value={newTask.predecessor_id} onChange={(e) => setNewTask({ ...newTask, predecessor_id: e.target.value })}>
                  <option value="">— Project start —</option>
                  {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label>Dependency type</label>
                <select value={newTask.dependency_type} onChange={(e) => setNewTask({ ...newTask, dependency_type: e.target.value })}>
                  <option value="FS">Finish-to-Start (sequential)</option>
                  <option value="SS">Start-to-Start (parallel)</option>
                </select>
              </div>
              <div><label>Duration (days)</label><input type="number" min="1" value={newTask.duration_days} onChange={(e) => setNewTask({ ...newTask, duration_days: e.target.value })} /></div>
              <div style={{ alignSelf: 'end' }}><button type="submit">Add task</button></div>
            </form>
          </div>
        )}

        <div className="panel">
          <h2>India holiday calendar</h2>
          <p className="subtle">Maintained manually — refresh once a year. These dates are skipped by the planned-date engine in addition to weekends.</p>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Date</th><th>Label</th></tr></thead>
            <tbody>{holidays.map((h) => <tr key={h.id}><td>{h.holiday_date?.slice(0, 10)}</td><td>{h.label}</td></tr>)}</tbody>
          </table>
          <form onSubmit={addHoliday} className="form-grid">
            <div><label>Date</label><input type="date" value={newHoliday.holiday_date} onChange={(e) => setNewHoliday({ ...newHoliday, holiday_date: e.target.value })} /></div>
            <div><label>Label</label><input value={newHoliday.label} onChange={(e) => setNewHoliday({ ...newHoliday, label: e.target.value })} placeholder="e.g. Diwali" /></div>
            <div style={{ alignSelf: 'end' }}><button type="submit">Add holiday</button></div>
          </form>
        </div>
      </div>
    </>
  );
}
