-- Stop the deploy if idx_contacts_connections_user2_user1 is missing or
-- INVALID (an interrupted concurrent build), so the next migrations don't drop
-- the indexes it replaces and leave the contacts list without one. The build
-- migration is already recorded by then, so rebuild the index by hand:
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
    ) THEN
        RAISE EXCEPTION 'idx_contacts_connections_user2_user1 is missing or invalid; rebuild it concurrently and re-run migrations';
    END IF;
END
$$;
