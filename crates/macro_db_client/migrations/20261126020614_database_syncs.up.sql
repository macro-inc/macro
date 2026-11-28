-- Synced tables: a table of a Macro database kept in sync with an outside
-- source (Granola meetings, a Notion data source) by the agent harness's
-- worker. A sync goes with its table, its database entity, and the user who
-- created it, whose access its writes use; deleting a sync leaves its table
-- and rows as they are.
CREATE TABLE database_syncs (
    id UUID PRIMARY KEY,
    database_id UUID NOT NULL REFERENCES database_entities(database_id) ON DELETE CASCADE,
    table_id UUID NOT NULL UNIQUE REFERENCES database_tables(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('granola_meetings', 'notion_data_source')),
    -- What names the source within its kind, such as a Notion data source id.
    source_config JSONB NOT NULL CHECK (jsonb_typeof(source_config) = 'object'),
    -- Which source field each column holds.
    columns JSONB NOT NULL CHECK (jsonb_typeof(columns) = 'array'),
    -- Columns that stopped syncing: deleted, or retyped.
    detached_columns JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(detached_columns) = 'array'),
    last_synced_at TIMESTAMPTZ,
    last_failure TEXT CHECK (last_failure IN (
        'source_disconnected',
        'source_not_found',
        'source_unavailable',
        'creator_lost_access',
        'database_unavailable',
        'internal'
    )),
    -- When the next run is due; 'infinity' while a run holds the lease, so
    -- marking it due meanwhile makes it run again once that run finishes.
    due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    lease_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX database_syncs_due_at_idx ON database_syncs(due_at);
CREATE INDEX database_syncs_database_id_idx ON database_syncs(database_id);
CREATE INDEX database_syncs_created_by_source_idx ON database_syncs(created_by, source);

-- The source rows a sync wrote, by the source's id for them.
CREATE TABLE database_sync_rows (
    sync_id UUID NOT NULL REFERENCES database_syncs(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    -- No foreign key: an id is reserved before its row is inserted, and a
    -- row someone deletes is inserted again under a new id.
    row_id UUID NOT NULL UNIQUE,
    -- SHA-256 of the row's cells as last written; NULL while its insert is
    -- in flight.
    fingerprint BYTEA,
    PRIMARY KEY (sync_id, external_id)
);
