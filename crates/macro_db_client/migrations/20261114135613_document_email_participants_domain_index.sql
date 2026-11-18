-- no-transaction

-- The Files tab looks documents up by participant domain, or by domain and
-- address; document_id keeps the lookup an index-only scan. An interrupted
-- build leaves an INVALID index that IF NOT EXISTS would keep: check
-- pg_index.indisvalid and drop it before rerunning.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_email_participants_domain
    ON document_email_participants (split_part(address, '@', 2), address, document_id);
