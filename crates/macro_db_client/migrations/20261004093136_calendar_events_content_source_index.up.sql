-- no-transaction
-- Deleting a calendar_event_sources row nulls this column through its foreign key, and the
-- calendar-list read-only refresh joins on it. Without this index both scan calendar_events.
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_events_content_source_idx
    ON calendar_events (content_source_id);
