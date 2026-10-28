-- no-transaction
-- Keep a single statement: a SQLx simple-query batch with multiple statements
-- gets an implicit transaction, which CONCURRENTLY forbids.
-- An interrupted build can leave an invalid index; inspect pg_index.indisvalid,
-- drop the invalid index concurrently, then retry this migration.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS comms_messages_client_message_id_key
    ON comms_messages (client_message_id)
    WHERE client_message_id IS NOT NULL;
