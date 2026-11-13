-- Guard for the next migration, which drops ai_usage_user_id_created_at_idx.
-- If the CONCURRENTLY build of ai_usage_user_id_created_at_total_idx was cut
-- off, it left an INVALID index that IF NOT EXISTS skipped on the retry, and
-- dropping the old index would leave ai_usage with no usable (user_id,
-- created_at) index. Stop here instead. To recover, run
--   DROP INDEX CONCURRENTLY ai_usage_user_id_created_at_total_idx;
--   CREATE INDEX CONCURRENTLY ai_usage_user_id_created_at_total_idx
--       ON ai_usage (user_id, created_at DESC) INCLUDE (total);
-- and run the migrations again. Reads the catalog only; takes no table lock.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_index
        WHERE indexrelid = to_regclass('ai_usage_user_id_created_at_total_idx')
          AND indisvalid
    ) THEN
        RAISE EXCEPTION 'ai_usage_user_id_created_at_total_idx is missing or INVALID; rebuild it before dropping ai_usage_user_id_created_at_idx';
    END IF;
END
$$;
