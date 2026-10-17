-- no-transaction

-- The contacts list selects user1 by user2. Keying user1 too lets that branch
-- be answered from the index without visiting the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_connections_user2_user1
    ON contacts_connections (user2, user1);
