-- Deleted users left enabled Pipedream connections behind, and Granola sync
-- retried setting them up forever. Connections now follow their user, like
-- granola_sync_connections. The table is small; the lock on "User" is brief.
SET LOCAL lock_timeout = '1s';

DELETE FROM pipedream_mcp_connections c
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = c.user_id);

ALTER TABLE pipedream_mcp_connections
    ADD CONSTRAINT pipedream_mcp_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
