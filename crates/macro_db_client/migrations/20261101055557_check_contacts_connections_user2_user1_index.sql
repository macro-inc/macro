-- Stop the deploy unless idx_contacts_connections_user2_user1 exists, is
-- valid, and indexes (user2, user1). An interrupted concurrent build leaves it
-- INVALID, and IF NOT EXISTS accepts any index of that name; either way the
-- next migrations would drop the indexes it replaces and leave the contacts
-- list without one. The build migration is already recorded by then, so
-- rebuild the index by hand:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_connections_user2_user1;
--   CREATE INDEX CONCURRENTLY idx_contacts_connections_user2_user1
--       ON contacts_connections (user2, user1);
-- then re-run migrations.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_index
        WHERE indexrelid = to_regclass('public.idx_contacts_connections_user2_user1')
          AND indisvalid
          AND indisready
          AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_contacts_connections_user2_user1 ON public.contacts_connections USING btree (user2, user1)'
    ) THEN
        RAISE EXCEPTION 'idx_contacts_connections_user2_user1 is missing, invalid, or not on (user2, user1); rebuild it concurrently and re-run migrations';
    END IF;
END
$$;
