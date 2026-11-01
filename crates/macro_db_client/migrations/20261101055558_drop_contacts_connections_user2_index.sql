-- no-transaction
-- Superseded by idx_contacts_connections_user2_user1, whose leading column is
-- user2. Single statement on purpose: see
-- 20261101055556_contacts_connections_user2_user1_index.sql.
DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_connections_user2;
