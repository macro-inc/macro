-- no-transaction
-- The Focus sweep asks which contacts an inbox's owner wrote to within a
-- look-back (`stale_threads` in the email crate's outbound/focus_pg.rs). By
-- `link_id` alone the only sent-mail index holds every message the owner ever
-- sent, and each one costs a table read to find its date. Keyed by date and
-- holding the id, this reads only the look-back, from the index alone. Only
-- sent mail that is not a draft has an entry.
--
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and CONCURRENTLY cannot run inside a transaction. No IF
-- NOT EXISTS: if an interrupted build leaves an INVALID index, the next run
-- fails on it instead of recording success. Check with
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and drop it with DROP INDEX CONCURRENTLY before running this again.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_link_id_sent_date;
CREATE INDEX CONCURRENTLY idx_email_messages_link_id_sent_date
    ON email_messages (link_id, internal_date_ts)
    INCLUDE (id)
    WHERE is_sent AND NOT is_draft;
