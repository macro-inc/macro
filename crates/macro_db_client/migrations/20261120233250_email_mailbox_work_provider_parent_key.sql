-- no-transaction
-- Required as the target of provider-aware foreign keys, rather than for id
-- lookups. PostgreSQL's referential-integrity cascades also handle concurrent
-- inserts outside a provider-changing transaction's repeatable-read snapshot.
-- Keep the primary id index and existing keys for old readers and writers.
CREATE UNIQUE INDEX CONCURRENTLY email_links_id_provider_queue_key
    ON public.email_links (id, provider);
