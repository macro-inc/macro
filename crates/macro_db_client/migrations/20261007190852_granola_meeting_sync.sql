-- Sync is explicit and independent of enabling a connector for AI tools.
CREATE TABLE granola_sync_connections (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('personal', 'public', 'all', 'workspace')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    endpoint_id TEXT,
    signing_secret BYTEA,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    CHECK ((endpoint_id IS NULL) = (signing_secret IS NULL))
);

-- The provider delivers at least once. Persist before acknowledging; processing
-- leases recover automatically if a service instance exits mid-import.
CREATE TABLE granola_sync_events (
    connection_id UUID NOT NULL REFERENCES granola_sync_connections(id) ON UPDATE CASCADE ON DELETE CASCADE,
    event_id UUID NOT NULL,
    note_id TEXT NOT NULL CHECK (note_id ~ '^not_[a-zA-Z0-9]{14}$'),
    event_type TEXT NOT NULL CHECK (event_type IN ('note.generated', 'note.edited', 'note.access_granted')),
    occurred_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (connection_id, event_id)
);
CREATE INDEX granola_sync_events_pending_idx ON granola_sync_events(available_at)
    WHERE completed_at IS NULL;
