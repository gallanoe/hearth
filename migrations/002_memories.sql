CREATE TABLE memories (
    memory_id       SERIAL PRIMARY KEY,
    content         TEXT NOT NULL,
    tags            TEXT[] DEFAULT '{}',

    -- Context: when and where this was created
    session_id      INTEGER REFERENCES sessions(session_id),
    room            TEXT,

    -- Search and ranking
    access_count    INTEGER DEFAULT 0,
    last_accessed   TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ  -- Soft delete via forget tool
);

-- Full-text search on content
CREATE INDEX idx_memories_content_fts ON memories USING GIN (to_tsvector('english', content));

-- Tag filtering
CREATE INDEX idx_memories_tags ON memories USING GIN (tags);

-- Active memories (not deleted)
CREATE INDEX idx_memories_active ON memories (created_at DESC) WHERE deleted_at IS NULL;
