-- no-transaction
-- The attachment-discovery query's `participants` CTE
-- (email_db_client::attachments::provider::upload) joins every message of
-- every attachment-bearing thread by thread_id and projects from_contact_id.
-- The existing (thread_id, internal_date_ts) indexes locate the messages but
-- not the contact, so each row costs a heap fetch; this makes that arm
-- index-only.
-- Single statement: see 20260910144339 for the CONCURRENTLY constraint.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_thread_id_from_contact_id
    ON email_messages (thread_id, from_contact_id);
