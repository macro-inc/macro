-- A database's team share lives in a SharePermission row, created the first
-- time its owner changes sharing; existing databases keep their access.
ALTER TABLE database_entities
    ADD COLUMN share_permission_id TEXT UNIQUE REFERENCES "SharePermission"(id);

-- Deleting the entity deletes its sharing settings with its storage and grants.
CREATE OR REPLACE FUNCTION delete_database_entity_storage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM databases WHERE id = OLD.database_id;
    DELETE FROM database_changes WHERE database_id = OLD.database_id;
    DELETE FROM entity_access WHERE entity_type = 'database' AND entity_id = OLD.database_id;
    DELETE FROM "SharePermission" WHERE id = OLD.share_permission_id;
    RETURN NULL;
END;
$$;
