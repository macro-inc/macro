-- no-transaction
-- The contacts list selects user1 by user2. Keying user1 too lets that branch
-- be answered from the index without visiting the table.
--
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. No IF NOT EXISTS: if an
-- interrupted build leaves an INVALID index, the next run fails on it instead
-- of recording success, so the indexes this one replaces are never dropped
-- without it; drop it with DROP INDEX CONCURRENTLY and re-run.
CREATE INDEX CONCURRENTLY idx_contacts_connections_user2_user1
    ON contacts_connections (user2, user1);
