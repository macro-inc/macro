-- no-transaction
-- ai_usage_user_id_created_at_total_idx, built by the previous migration, has
-- the same keys and serves every query this index did (CS-06), so drop it,
-- CONCURRENTLY so readers of ai_usage are not blocked while it goes.
DROP INDEX CONCURRENTLY IF EXISTS ai_usage_user_id_created_at_idx;
