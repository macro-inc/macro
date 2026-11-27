-- History backfill: webhooks deliver only new activity, so each sync pages
-- through the notes Granola already holds. The cursor is saved after every
-- imported page so a restart resumes there; a completed backfill is not
-- repeated until the user connects Granola again.
ALTER TABLE granola_sync_connections
    ADD COLUMN backfill_cursor TEXT,
    ADD COLUMN backfill_completed_at TIMESTAMPTZ,
    ADD COLUMN backfill_available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN backfill_lease_id UUID,
    ADD COLUMN backfill_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX granola_sync_connections_backfill_idx
    ON granola_sync_connections(backfill_available_at)
    WHERE enabled AND backfill_completed_at IS NULL;
