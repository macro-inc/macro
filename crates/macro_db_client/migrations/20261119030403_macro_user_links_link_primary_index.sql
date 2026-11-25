-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Whether an account has an inbox delegated to it is one probe on
-- (link_id, primary_macro_id), however many accounts share that inbox; the
-- index also serves every lookup by link_id alone, so the next migration drops
-- macro_user_links_link_idx. No IF NOT EXISTS on purpose: an interrupted build
-- leaves an INVALID index, and the retry must fail until it is dropped by hand
-- (DROP INDEX CONCURRENTLY macro_user_links_link_primary_idx), so the old index
-- is never dropped while this one is unusable.
CREATE INDEX CONCURRENTLY macro_user_links_link_primary_idx
    ON macro_user_links (link_id, primary_macro_id);
