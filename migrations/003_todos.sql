-- Migration 004: Drop plans, create todos
-- WARNING: This is a breaking change. Existing plan/task data will be lost.

DROP TABLE IF EXISTS plan_tasks;
DROP TABLE IF EXISTS plans;

CREATE TABLE todos (
  todo_id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 999 CHECK (priority >= 1 AND priority <= 999),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  resolved_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_todos_agent ON todos(agent_id);
CREATE INDEX idx_todos_list ON todos(agent_id, status, priority, created_at);
CREATE INDEX idx_todos_resolved ON todos(agent_id, resolved_at);
