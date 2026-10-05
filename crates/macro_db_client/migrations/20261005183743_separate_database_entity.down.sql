-- Rollback also discards database content; no data is migrated back.
DELETE FROM database_entities;
DELETE FROM databases;
DELETE FROM database_changes;
DELETE FROM database_queries;
DELETE FROM database_starter_seeds;
DELETE FROM entity_access WHERE entity_type = 'database';

ALTER TABLE databases
    ADD COLUMN name TEXT NOT NULL,
    ADD COLUMN owner_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN trashed_at TIMESTAMPTZ;
CREATE INDEX idx_databases_owner ON databases(owner_id);

ALTER TABLE database_starter_seeds DROP CONSTRAINT database_starter_seeds_database_id_fkey;
ALTER TABLE database_starter_seeds ADD CONSTRAINT database_starter_seeds_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE SET NULL;

DROP TABLE database_entities;
DROP FUNCTION delete_database_entity_storage();
COMMENT ON TABLE databases IS NULL;
