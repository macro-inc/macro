-- no-transaction
-- The contacts list selects user1 by user2. Keying user1 too lets that branch
-- be answered from the index without visiting the table.
--
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. An interrupted build leaves an
-- INVALID index that IF NOT EXISTS will not rebuild; the next migration stops
-- the deploy in that case, before the indexes this one replaces are dropped.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_connections_user2_user1
    ON contacts_connections (user2, user1);
