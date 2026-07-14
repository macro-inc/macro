-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ecsi_link_thread
ON email_contact_search_index (link_id, thread_id);
