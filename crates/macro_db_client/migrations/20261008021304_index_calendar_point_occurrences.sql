-- no-transaction
-- Point spans stay empty for busy-time queries; this index supports browsing them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_event_occurrences_points_idx
    ON calendar_event_occurrences (owner_id, starts_at, event_id, occurrence_key)
    WHERE NOT is_cancelled AND starts_at = ends_at;
