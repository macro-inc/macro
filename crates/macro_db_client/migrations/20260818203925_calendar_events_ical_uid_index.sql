-- no-transaction
-- Mention previews resolve a mentioned event to the requester's own
-- projection of the same meeting through the shared iCalendar UID. The
-- existing unique index leads with owner_id, so UID lookups need their own.
-- Must stay a single statement: sqlx sends no-transaction migrations with
-- multiple statements as one batch, which wraps them in an implicit
-- transaction that CONCURRENTLY forbids.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calendar_events_ical_uid_idx"
    ON "calendar_events" ("ical_uid");
