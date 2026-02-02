-- Plans: hierarchical persistent storage for the agent.
-- Plans contain tasks. Both survive across sessions.

CREATE TABLE plans (
    plan_id           SERIAL PRIMARY KEY,
    title             TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed')),
    is_active         BOOLEAN NOT NULL DEFAULT false,

    created_session   INTEGER REFERENCES sessions(session_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_tasks (
    task_id           SERIAL PRIMARY KEY,
    plan_id           INTEGER NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    content           TEXT NOT NULL,
    notes             TEXT,
    status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'done')),
    sort_order        INTEGER NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plans_open ON plans (created_at DESC)
    WHERE status = 'open';

CREATE INDEX idx_plan_tasks ON plan_tasks (plan_id, sort_order);
