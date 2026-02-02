-- Sessions map 1:1 with wake-sleep cycles
CREATE TABLE sessions (
    session_id        SERIAL PRIMARY KEY,
    agent_id          TEXT NOT NULL DEFAULT 'default',
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at          TIMESTAMPTZ,
    end_reason        TEXT CHECK (end_reason IN ('sleep', 'budget_exhausted')),
    total_tokens_used INTEGER,
    session_summary   TEXT,
    metadata          JSONB DEFAULT '{}'
);

-- Compaction events must be created before messages that reference them
CREATE TABLE compaction_events (
    compaction_id       SERIAL PRIMARY KEY,
    agent_id            TEXT NOT NULL DEFAULT 'default',
    session_id          INTEGER NOT NULL REFERENCES sessions(session_id),
    summary_message_id  INTEGER, -- Will be updated after message is inserted

    range_start_seq     INTEGER NOT NULL,
    range_end_seq       INTEGER NOT NULL,

    source_token_count  INTEGER,
    summary_token_count INTEGER,
    model_used          TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every message ever sent, including compacted ones
CREATE TABLE messages (
    message_id        SERIAL PRIMARY KEY,
    agent_id          TEXT NOT NULL DEFAULT 'default',
    session_id        INTEGER NOT NULL REFERENCES sessions(session_id),
    sequence_num      INTEGER NOT NULL,

    role              TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content           TEXT,
    tool_calls        JSONB,
    tool_call_id      TEXT,

    -- 'active' = in the live context window
    -- 'compacted' = replaced by a summary via compaction
    status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'compacted')),
    compaction_id     INTEGER REFERENCES compaction_events(compaction_id),

    -- Hearth-specific context
    room              TEXT,
    turn_sequence     INTEGER,

    token_count       INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (session_id, sequence_num)
);

-- Add foreign key for summary_message_id now that messages table exists
ALTER TABLE compaction_events
    ADD CONSTRAINT fk_summary_message
    FOREIGN KEY (summary_message_id) REFERENCES messages(message_id);

-- Denormalized summary text — survives if the summary message is itself compacted later
CREATE TABLE compaction_summaries (
    summary_id           SERIAL PRIMARY KEY,
    agent_id             TEXT NOT NULL DEFAULT 'default',
    compaction_id        INTEGER NOT NULL REFERENCES compaction_events(compaction_id),
    message_id           INTEGER NOT NULL REFERENCES messages(message_id),
    summary_text         TEXT NOT NULL,
    parent_compaction_id INTEGER REFERENCES compaction_events(compaction_id),
    depth                INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Turn-level records (mirrors TurnRecord from loop.ts)
CREATE TABLE turns (
    turn_id           SERIAL PRIMARY KEY,
    agent_id          TEXT NOT NULL DEFAULT 'default',
    session_id        INTEGER NOT NULL REFERENCES sessions(session_id),
    sequence          INTEGER NOT NULL,
    room              TEXT NOT NULL,
    input_tokens      INTEGER,
    output_tokens     INTEGER,
    cost              NUMERIC,
    assistant_message TEXT,
    tool_calls        JSONB,
    tool_results      JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (session_id, sequence)
);

-- Indexes
CREATE INDEX idx_messages_active
    ON messages(session_id, sequence_num)
    WHERE status = 'active';

CREATE INDEX idx_messages_session
    ON messages(session_id, sequence_num);

CREATE INDEX idx_compaction_session
    ON compaction_events(session_id);

CREATE INDEX idx_turns_session
    ON turns(session_id, sequence);

-- Agent ID indexes for multi-agent filtering
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_messages_agent ON messages(agent_id);
CREATE INDEX idx_turns_agent ON turns(agent_id);
