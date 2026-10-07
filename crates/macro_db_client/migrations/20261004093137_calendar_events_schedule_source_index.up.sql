-- no-transaction
-- Deleting a calendar_event_sources row nulls this column through its foreign key, which
-- scans calendar_events once per deleted row without this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_events_schedule_source_idx
    ON calendar_events (schedule_source_id);
