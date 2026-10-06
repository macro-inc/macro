-- Destructive cutover: existing databases are disposable. Deploy this schema
-- with the updated service; old binaries are not supported.
DELETE FROM entity_access WHERE entity_type = 'database';
DELETE FROM database_changes;
DELETE FROM database_queries;
DELETE FROM database_starter_seeds;
-- Existing cascades remove tables, definitions, rows and their cells.
DELETE FROM databases;

-- Database storage is reusable without a Macro entity.
ALTER TABLE databases
    DROP COLUMN name,
    DROP COLUMN owner_id,
    DROP COLUMN created_at,
    DROP COLUMN updated_at,
    DROP COLUMN trashed_at;

CREATE TABLE database_entities (
    database_id UUID PRIMARY KEY REFERENCES databases(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);

CREATE INDEX database_entities_user_id_idx ON database_entities(user_id);

-- Starter provisioning is an app concern, so it points at the entity.
ALTER TABLE database_starter_seeds DROP CONSTRAINT database_starter_seeds_database_id_fkey;
ALTER TABLE database_starter_seeds ADD CONSTRAINT database_starter_seeds_database_id_fkey
    FOREIGN KEY (database_id) REFERENCES database_entities(database_id) ON DELETE SET NULL;

-- An app entity owns its resource, including when its owner is deleted.
CREATE FUNCTION delete_database_entity_storage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM databases WHERE id = OLD.database_id;
    DELETE FROM database_changes WHERE database_id = OLD.database_id;
    DELETE FROM entity_access WHERE entity_type = 'database' AND entity_id = OLD.database_id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER database_entities_storage_cleanup
    AFTER DELETE ON database_entities
    FOR EACH ROW EXECUTE FUNCTION delete_database_entity_storage();

COMMENT ON TABLE databases IS 'Reusable database storage identity; no app ownership, display metadata, or trash state.';
COMMENT ON TABLE database_entities IS 'Optional Macro entity for a database resource; its primary key is also the resource foreign key.';
