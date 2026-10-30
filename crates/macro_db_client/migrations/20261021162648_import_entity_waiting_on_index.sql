-- no-transaction
-- Backs the waiting_on foreign key and the lookup of a row's waiters when it
-- is imported or released.
CREATE INDEX CONCURRENTLY IF NOT EXISTS import_entity_waiting_on_idx
    ON import_entity (waiting_on) WHERE waiting_on IS NOT NULL;
