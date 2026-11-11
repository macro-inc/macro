-- no-transaction
-- Backs the parent_id foreign key: deleting an import row looks up its
-- children, which is a full scan without this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS import_entity_parent_idx
    ON import_entity (parent_id) WHERE parent_id IS NOT NULL;
