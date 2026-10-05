-- Rollback also discards database content; no data is migrated back.
DELETE FROM database_entity;
DELETE FROM database;
DELETE FROM database_changes;
DELETE FROM database_queries;
DELETE FROM database_starter_seeds;
DELETE FROM entity_access WHERE entity_type = 'database';

CREATE TABLE databases (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);
CREATE INDEX idx_databases_owner ON databases(owner_id);

ALTER TABLE database_tables DROP CONSTRAINT database_tables_database_id_fkey;
ALTER TABLE database_tables ADD CONSTRAINT database_tables_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE CASCADE;

ALTER TABLE property_definitions DROP CONSTRAINT property_definitions_database_id_fkey;
ALTER TABLE property_definitions ADD CONSTRAINT property_definitions_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE CASCADE;

ALTER TABLE database_views DROP CONSTRAINT database_views_database_id_fkey;
ALTER TABLE database_views ADD CONSTRAINT database_views_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE CASCADE;

ALTER TABLE database_queries DROP CONSTRAINT database_queries_database_id_fkey;
ALTER TABLE database_queries ADD CONSTRAINT database_queries_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE SET NULL;

ALTER TABLE database_starter_seeds DROP CONSTRAINT database_starter_seeds_database_id_fkey;
ALTER TABLE database_starter_seeds ADD CONSTRAINT database_starter_seeds_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE SET NULL;

DROP TABLE database_entity;
DROP FUNCTION delete_database_entity_storage();
DROP TABLE database;
