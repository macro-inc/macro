-- no-transaction
-- The composite (user_id, created_at) index created by the previous
-- migration covers the old single-column user_id index (CS-06), so drop it,
-- CONCURRENTLY so readers of ai_usage are not blocked while it goes.
DROP INDEX CONCURRENTLY IF EXISTS ai_usage_user_id_idx;
