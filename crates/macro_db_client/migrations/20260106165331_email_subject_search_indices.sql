-- Creates necesary email indices to improve the performance of subject-search

-- Enable trigram extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The search query orders by (thread_id, internal_date_ts ASC) but existing index uses DESC
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_id_internal_date_asc
    ON email_messages (thread_id, internal_date_ts ASC);

-- GIN trigram index allows efficient partial string matching
CREATE INDEX IF NOT EXISTS idx_email_messages_subject_trgm
    ON email_messages USING gin (subject gin_trgm_ops);

-- Optimize the non-ids_only query path that filters by link_id
CREATE INDEX IF NOT EXISTS idx_email_messages_link_id_thread_id_date_asc
    ON email_messages (link_id, thread_id, internal_date_ts ASC);
