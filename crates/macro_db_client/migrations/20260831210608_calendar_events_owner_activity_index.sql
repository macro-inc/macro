-- no-transaction
-- Recency-sorted soup listings now order calendar events by
-- GREATEST(updated_at, last_reminder_fired_at); this mirrors
-- calendar_events_owner_updated_idx for that expression. Must stay a single
-- statement: sqlx sends no-transaction migrations with multiple statements as
-- one batch, which wraps them in an implicit transaction that CONCURRENTLY
-- forbids.
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_events_owner_activity_idx
    ON calendar_events (owner_id, GREATEST(updated_at, last_reminder_fired_at) DESC, id DESC);
