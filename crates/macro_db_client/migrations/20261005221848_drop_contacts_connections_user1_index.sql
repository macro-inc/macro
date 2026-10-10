-- no-transaction

-- The (user1, user2) unique index already serves lookups by user1.
DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_connections_user1;
