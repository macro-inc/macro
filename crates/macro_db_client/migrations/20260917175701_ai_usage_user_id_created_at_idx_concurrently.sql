-- no-transaction
-- Per-user, per-period sums over ai_usage are the hot AI billing query (see
-- crates/ai_billing, PgUsageReader). Built CONCURRENTLY, in its own
-- migration outside a transaction, so completions keep writing while it
-- builds. IF NOT EXISTS makes a re-run after an interrupted build a no-op
-- once the index is valid; an INVALID leftover must be dropped by hand first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_usage_user_id_created_at_idx
    ON ai_usage (user_id, created_at DESC);
