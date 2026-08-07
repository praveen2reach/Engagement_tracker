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
  const [newTask, setNewTask] = useState({ name: '', predecessor_id: '', dependency_type: 'FS', duration_days: 1, is_milestone: false, functional_owner: '', technical_owner: '', integration_owner: '', client_poc: '' });
  const [newHoliday, setNewHoliday] = useState({ holiday_date: '', label: '' });
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'team' });
  const [userMessage, setUserMessage] = useState('');
  const [copySourceId, setCopySourceId] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importMode, setImportMode] = useState('add_update');
  const [importStatus, setImportStatus] = useState(null); // { ok, message, details }
  const [importing, setImporting] = useState(false);

  const loadAll = useCallback(async (pid) => {
    const [pRes, hRes, uRes] = await Promise.all([fetch('/api/projects'), fetch('/api/holidays'), fetch('/api/users')]);
    if (pRes.ok) {
      const data = await pRes.json();
      setProjects(data);
      if (!pid && data.length) pid = data[0].id;
      setProjectId(pid);
    }
    if (hRes.ok) setHolidays(await hRes.json());
    if (uRes.ok) setUsers(await uRes.json());
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
        is_milestone: newTask.is_milestone,
        functional_owner: newTask.functional_owner || null,
        technical_owner: newTask.technical_owner || null,
        integration_owner: newTask.integration_owner || null,
        client_poc: newTask.client_poc || null,
      }),
    });
    setNewTask({ name: '', predecessor_id: '', dependency_type: 'FS', duration_days: 1, is_milestone: false, functional_owner: '', technical_owner: '', integration_owner: '', client_poc: '' });
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

  async function toggleMilestone(id, is_milestone) {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_milestone }),
    });
    loadTasks(projectId);
  }

  async function editTaskField(id, field, value) {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    loadTasks(projectId);
  }

  async function copyTasks() {
    if (!copySourceId) return;
    setCopyStatus('Copying…');
    const res = await fetch('/api/tasks/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_project_id: copySourceId, target_project_id: projectId }),
    });
    const data = await res.json();
    if (res.ok) {
      setCopyStatus(`Copied ${data.copied} task(s).`);
      loadTasks(projectId);
    } else {
      setCopyStatus(data.error || 'Copy failed.');
    }
  }

  async function handleImport() {
    if (!importFile) return;
    if (importMode === 'replace') {
      const confirmed = confirm(
        `This will DELETE all ${tasks.length} existing task(s) in this engagement and replace them with what's in the file. This cannot be undone. Continue?`
      );
      if (!confirmed) return;
    }
    setImporting(true);
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const res = await fetch('/api/tasks/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, mode: importMode, file_base64: base64 }),
      });
      const data = await res.json();
      setImporting(false);
      if (res.ok) {
        setImportStatus({ ok: true, message: `Imported ${data.imported} task(s) (${data.mode === 'replace' ? 'replaced all' : 'added/updated'}).` });
        setImportFile(null);
        loadTasks(projectId);
      } else {
        setImportStatus({ ok: false, message: data.error, details: data.details });
      }
    };
    reader.readAsDataURL(importFile);
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

  async function addUser(e) {
    e.preventDefault();
    if (!newUser.name || !newUser.email) return;
    setUserMessage('');
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser),
    });
    const data = await res.json();
    if (res.ok) {
      setUserMessage(`Added ${data.user.name}. Temporary password: ${data.temp_password} — share this with them directly (it won't be shown again).`);
      setNewUser({ name: '', email: '', role: 'team' });
      loadAll(projectId);
    } else {
      setUserMessage(data.error || 'Could not add user.');
    }
  }

  async function changeRole(id, role) {
    await fetch(`/api/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    loadAll(projectId);
  }

  async function resetPassword(id, name) {
    if (!confirm(`Reset ${name}'s password? They'll need the new temporary password to sign in.`)) return;
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset_password: true }),
    });
    const data = await res.json();
    setUserMessage(`New temporary password for ${name}: ${data.temp_password} — share this with them directly.`);
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">Engagement Task Tracker<small>Admin setup · {session?.user?.name}</small></div>
        <nav>
          <a href="/">Back to tracker</a>
          <a href="/report">Weekly report</a>
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

            {projects.length > 1 && (
              <div className="form-grid" style={{ background: '#f6f7f9', padding: 12, borderRadius: 6, marginBottom: 16 }}>
                <div>
                  <label>Copy tasks from another engagement</label>
                  <select value={copySourceId} onChange={(e) => setCopySourceId(e.target.value)}>
                    <option value="">— Select source engagement —</option>
                    {projects.filter((p) => p.id !== projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ alignSelf: 'end' }}>
                  <button className="secondary" onClick={copyTasks} disabled={!copySourceId}>Copy tasks in</button>
                </div>
                <div style={{ alignSelf: 'end' }} className="subtle">{copyStatus}</div>
              </div>
            )}

            <div style={{ background: '#f6f7f9', padding: 12, borderRadius: 6, marginBottom: 16 }}>
              <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0', display: 'block', marginBottom: 8 }}>Excel template</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                <a href={`/api/tasks/export?project_id=${projectId}`}>
                  <button className="secondary" type="button">Download Excel{tasks.length ? ' (current tasks)' : ' (blank template)'}</button>
                </a>

                <div>
                  <label style={{ fontSize: 11, color: '#7c8aa0' }}>Upload mode</label>
                  <select value={importMode} onChange={(e) => setImportMode(e.target.value)} style={{ width: 220 }}>
                    <option value="add_update">Add / update (match by task name)</option>
                    <option value="replace">Replace all tasks in this engagement</option>
                  </select>
                </div>
                <input type="file" accept=".xlsx" onChange={(e) => setImportFile(e.target.files[0] || null)} style={{ width: 220 }} />
                <button onClick={handleImport} disabled={!importFile || importing}>{importing ? 'Uploading…' : 'Upload'}</button>
              </div>
              {importStatus && (
                <div style={{ marginTop: 10 }}>
                  <div className={importStatus.ok ? 'badge green' : 'badge red'} style={{ padding: '4px 10px' }}>{importStatus.message}</div>
                  {importStatus.details && (
                    <ul style={{ fontSize: 12, color: '#c94a3d', marginTop: 6 }}>
                      {importStatus.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ marginBottom: 16 }}>
              <thead><tr><th>Seq</th><th>Task</th><th>Predecessor</th><th>Type</th><th>Duration (days)</th><th>Functional Owner</th><th>Technical Owner</th><th>Integration Owner</th><th>Client PoC</th><th>Milestone</th><th>Planned</th><th></th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.sequence}</td>
                    <td>{t.name}</td>
                    <td>{tasks.find((x) => x.id === t.predecessor_id)?.name || '— (project start)'}</td>
                    <td>{t.dependency_type}</td>
                    <td><input type="number" min="1" defaultValue={t.duration_days} style={{ width: 70 }} onBlur={(e) => editDuration(t.id, e.target.value)} /></td>
                    <td><input defaultValue={t.functional_owner || ''} style={{ width: 110 }} placeholder="Functional" onBlur={(e) => editTaskField(t.id, 'functional_owner', e.target.value)} /></td>
                    <td><input defaultValue={t.technical_owner || ''} style={{ width: 110 }} placeholder="Technical" onBlur={(e) => editTaskField(t.id, 'technical_owner', e.target.value)} /></td>
                    <td><input defaultValue={t.integration_owner || ''} style={{ width: 110 }} placeholder="Integration" onBlur={(e) => editTaskField(t.id, 'integration_owner', e.target.value)} /></td>
                    <td><input defaultValue={t.client_poc || ''} style={{ width: 110 }} placeholder="Client PoC" onBlur={(e) => editTaskField(t.id, 'client_poc', e.target.value)} /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" defaultChecked={t.is_milestone} onChange={(e) => toggleMilestone(t.id, e.target.checked)} /></td>
                    <td>{t.planned_start?.slice(0, 10)} → {t.planned_end?.slice(0, 10)}</td>
                    <td><button className="secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => deleteTask(t.id)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
              <div><label>Functional Owner</label><input value={newTask.functional_owner} onChange={(e) => setNewTask({ ...newTask, functional_owner: e.target.value })} /></div>
              <div><label>Technical Owner</label><input value={newTask.technical_owner} onChange={(e) => setNewTask({ ...newTask, technical_owner: e.target.value })} /></div>
              <div><label>Integration Owner</label><input value={newTask.integration_owner} onChange={(e) => setNewTask({ ...newTask, integration_owner: e.target.value })} /></div>
              <div><label>Client PoC</label><input value={newTask.client_poc} onChange={(e) => setNewTask({ ...newTask, client_poc: e.target.value })} /></div>
              <div style={{ alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" id="milestone-cb" checked={newTask.is_milestone} onChange={(e) => setNewTask({ ...newTask, is_milestone: e.target.checked })} style={{ width: 'auto' }} />
                <label htmlFor="milestone-cb" style={{ textTransform: 'none', fontSize: 13, color: 'inherit', marginBottom: 0 }}>Show as milestone</label>
              </div>
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

        <div className="panel">
          <h2>Team members</h2>
          <p className="subtle">Add teammates here instead of touching the database directly. They'll sign in with the email and temporary password shown below — share it with them directly (e.g. Slack DM), it won't be shown again after you leave this page.</p>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} style={{ width: 100 }}>
                      <option value="team">Team</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{u.created_at?.slice(0, 10)}</td>
                  <td><button className="secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => resetPassword(u.id, u.name)}>Reset password</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={addUser} className="form-grid">
            <div><label>Name</label><input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></div>
            <div><label>Email</label><input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></div>
            <div>
              <label>Role</label>
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                <option value="team">Team</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ alignSelf: 'end' }}><button type="submit">Add teammate</button></div>
          </form>
          {userMessage && <p style={{ marginTop: 10, fontSize: 13, background: '#fdf3e0', padding: 10, borderRadius: 6 }}>{userMessage}</p>}
        </div>
      </div>
    </>
  );
}
