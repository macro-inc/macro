-- no-transaction
-- Latest own activity per entity for the work feed: one probe per feed
-- candidate instead of a scan of the viewer's whole activity history (the
-- subject index) or of the entity's history across every user (the entity
-- index).
-- Must stay a single statement: sqlx sends no-transaction migrations as
-- one batch, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_subject_entity
  ON activity_events (subject_id, entity_type, entity_id, occurred_at DESC);
