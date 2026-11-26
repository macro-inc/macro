-- Backfill progress within a page, given-up notes, and deferral backoff.
ALTER TABLE granola_sync_connections
    -- Notes of the current page already imported; a retried page skips them.
    ADD COLUMN backfill_handled TEXT[] NOT NULL DEFAULT '{}',
    -- Checks in a row that found the user not opted in; deferrals back off.
    ADD COLUMN backfill_deferrals INTEGER NOT NULL DEFAULT 0,
    -- Notes given up on after their page's last attempt: [{note_id, reason}].
    ADD COLUMN backfill_skipped JSONB NOT NULL DEFAULT '[]',
    -- Why a backfill stopped before Granola's last page, if it did.
    ADD COLUMN backfill_gave_up TEXT;
