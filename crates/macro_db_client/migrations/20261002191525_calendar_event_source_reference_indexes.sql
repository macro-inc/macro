-- no-transaction

-- Deleting a calendar source sets this reference to NULL. Without an index,
-- disconnecting an account scans all events once for every deleted source,
-- holding the inbox's grant lock and blocking a concurrent reconnect.
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_events_content_source_idx
    ON calendar_events (content_source_id)
    WHERE content_source_id IS NOT NULL;
