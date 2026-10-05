-- Database storage is reusable without a Macro entity. The optional entity
-- uses the resource id as its own identity, preserving existing URLs and grants.
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

-- Old binaries still use databases. Keep it as a compatibility projection
-- until all consumers have deployed; removing it is a separate migration.
-- Lock before backfilling so no old writer can miss the synchronization triggers.
LOCK TABLE databases IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO database (id)
SELECT id FROM databases
ON CONFLICT (id) DO NOTHING;

INSERT INTO database_entity (database_id, name, user_id, created_at, updated_at, trashed_at)
SELECT id, name, owner_id, created_at, updated_at, trashed_at FROM databases
ON CONFLICT (database_id) DO NOTHING;

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

CREATE FUNCTION sync_legacy_database_entity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM database_entity WHERE database_id = OLD.id;
        DELETE FROM database WHERE id = OLD.id;
        RETURN OLD;
    END IF;

    INSERT INTO database (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
    INSERT INTO database_entity (database_id, name, user_id, created_at, updated_at, trashed_at)
    VALUES (NEW.id, NEW.name, NEW.owner_id, NEW.created_at, NEW.updated_at, NEW.trashed_at)
    ON CONFLICT (database_id) DO UPDATE SET
        name = EXCLUDED.name,
        user_id = EXCLUDED.user_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        trashed_at = EXCLUDED.trashed_at
    WHERE (database_entity.name, database_entity.user_id, database_entity.created_at,
           database_entity.updated_at, database_entity.trashed_at)
       IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.user_id, EXCLUDED.created_at,
                         EXCLUDED.updated_at, EXCLUDED.trashed_at);
    RETURN NEW;
END;
$$;

CREATE FUNCTION sync_database_entity_legacy()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM databases WHERE id = OLD.database_id;
        RETURN OLD;
    END IF;

    INSERT INTO databases (id, name, owner_id, created_at, updated_at, trashed_at)
    VALUES (NEW.database_id, NEW.name, NEW.user_id, NEW.created_at, NEW.updated_at, NEW.trashed_at)
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        owner_id = EXCLUDED.owner_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        trashed_at = EXCLUDED.trashed_at
    WHERE (databases.name, databases.owner_id, databases.created_at,
           databases.updated_at, databases.trashed_at)
       IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.owner_id, EXCLUDED.created_at,
                         EXCLUDED.updated_at, EXCLUDED.trashed_at);
    RETURN NEW;
END;
$$;

CREATE TRIGGER databases_entity_compatibility
    AFTER INSERT OR UPDATE OR DELETE ON databases
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_database_entity();

CREATE TRIGGER database_entity_legacy_compatibility
    AFTER INSERT OR UPDATE OR DELETE ON database_entity
    FOR EACH ROW EXECUTE FUNCTION sync_database_entity_legacy();

COMMENT ON TABLE database IS 'Reusable database storage identity; no app ownership, display metadata, or trash state.';
COMMENT ON TABLE database_entity IS 'Optional Macro entity for a database resource; its primary key is also the resource foreign key.';
COMMENT ON TABLE databases IS 'Legacy compatibility projection of database_entity. Remove only after all old consumers have deployed.';
