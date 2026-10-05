-- Destructive cutover: existing databases are disposable. Deploy this schema
-- with the updated service; old binaries are not supported.
DELETE FROM entity_access WHERE entity_type = 'database';
DELETE FROM database_changes;
DELETE FROM database_queries;
DELETE FROM database_starter_seeds;
-- Existing cascades remove tables, definitions, rows and their cells.
DELETE FROM databases;

-- Database storage is reusable without a Macro entity.
CREATE TABLE database (
    id UUID PRIMARY KEY
);

CREATE TABLE database_entity (
    database_id UUID PRIMARY KEY REFERENCES database(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);

CREATE INDEX database_entity_user_id_idx ON database_entity(user_id);

-- Storage belongs to the core resource. Its existence requires no app owner.
ALTER TABLE database_tables DROP CONSTRAINT database_tables_database_id_fkey;
ALTER TABLE database_tables ADD CONSTRAINT database_tables_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES database(id) ON DELETE CASCADE;

ALTER TABLE property_definitions DROP CONSTRAINT property_definitions_database_id_fkey;
ALTER TABLE property_definitions ADD CONSTRAINT property_definitions_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES database(id) ON DELETE CASCADE;

ALTER TABLE database_views DROP CONSTRAINT database_views_database_id_fkey;
ALTER TABLE database_views ADD CONSTRAINT database_views_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES database(id) ON DELETE CASCADE;

ALTER TABLE database_queries DROP CONSTRAINT database_queries_database_id_fkey;
ALTER TABLE database_queries ADD CONSTRAINT database_queries_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES database(id) ON DELETE SET NULL;

-- Starter provisioning is an app concern, so it points at the entity.
ALTER TABLE database_starter_seeds DROP CONSTRAINT database_starter_seeds_database_id_fkey;
ALTER TABLE database_starter_seeds ADD CONSTRAINT database_starter_seeds_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES database_entity(database_id) ON DELETE SET NULL;

DROP TABLE databases;

-- An app entity owns its resource, including when its owner is deleted.
CREATE FUNCTION delete_database_entity_storage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM database WHERE id = OLD.database_id;
    DELETE FROM database_changes WHERE database_id = OLD.database_id;
    DELETE FROM entity_access WHERE entity_type = 'database' AND entity_id = OLD.database_id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER database_entity_storage_cleanup
    AFTER DELETE ON database_entity
    FOR EACH ROW EXECUTE FUNCTION delete_database_entity_storage();

COMMENT ON TABLE database IS 'Reusable database storage identity; no app ownership, display metadata, or trash state.';
COMMENT ON TABLE database_entity IS 'Optional Macro entity for a database resource; its primary key is also the resource foreign key.';
