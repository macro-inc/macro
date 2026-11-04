-- A failing backfill backs off and moves behind the others, so it never
-- holds up anyone else's import of past calls.
ALTER TABLE dialpad_sync_connections
    ADD COLUMN backfill_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN backfill_due_at TIMESTAMPTZ NOT NULL DEFAULT now();
