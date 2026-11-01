-- no-transaction
-- The unique (user1, user2) index already serves lookups by user1. Single
-- statement on purpose: see
-- 20261101055556_contacts_connections_user2_user1_index.sql.
DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_connections_user1;
