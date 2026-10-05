-- A core-only database has no representation in the previous schema. Refuse
-- rollback before changing anything rather than discarding its data.
-- Match app writers' legacy-first ordering and block core allocations before
-- examining the guard, holding these locks until rollback finishes.
LOCK TABLE databases, database, database_entity IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM database d
        WHERE NOT EXISTS (SELECT 1 FROM databases legacy WHERE legacy.id = d.id)
    ) THEN
        RAISE EXCEPTION 'cannot revert database/entity separation while core-only databases exist';
    END IF;
END;
$$;

DROP TRIGGER database_entity_legacy_compatibility ON database_entity;
DROP TRIGGER databases_entity_compatibility ON databases;
DROP FUNCTION sync_database_entity_legacy();
DROP FUNCTION sync_legacy_database_entity();

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
DROP TABLE database;
COMMENT ON TABLE databases IS NULL;
