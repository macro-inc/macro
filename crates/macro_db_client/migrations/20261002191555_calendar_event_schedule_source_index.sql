-- no-transaction

-- The schedule reference has the same ON DELETE SET NULL cost as the content
-- reference. Keep concurrent index builds in separate SQLx migrations.
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_events_schedule_source_idx
    ON calendar_events (schedule_source_id)
    WHERE schedule_source_id IS NOT NULL;
