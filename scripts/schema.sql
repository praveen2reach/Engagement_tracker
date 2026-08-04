-- Engagement Task Tracker schema
-- Run once against your Vercel Postgres database (see README for how).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,      -- unused once SSO is wired in, kept for Phase 1 login
  role TEXT NOT NULL DEFAULT 'team', -- 'admin' or 'team'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL,               -- display order
  predecessor_id INTEGER REFERENCES tasks(id),
  dependency_type TEXT DEFAULT 'FS',       -- 'FS' finish-to-start, 'SS' start-to-start (parallel)
  duration_days INTEGER NOT NULL,

  planned_start DATE,
  planned_end DATE,

  baseline_start DATE,                     -- Baseline v1, frozen on first calculation
  baseline_end DATE,

  actual_start DATE,
  actual_end DATE,

  status TEXT DEFAULT 'Not Started',       -- Not Started / In Progress / Completed / On Hold
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  comment_text TEXT NOT NULL,
  entered_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);

-- Added for the weekly status report (Gantt + RAG + Milestones)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS week_override INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_overall TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_schedule TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_scope TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_resource TEXT;
