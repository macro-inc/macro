-- CRM owns pipeline identity; reusable storage owns columns and cells.
CREATE TABLE crm_pipeline_entities (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    database_id UUID NOT NULL UNIQUE REFERENCES databases(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ,
    table_id UUID NOT NULL UNIQUE REFERENCES database_tables(id) ON DELETE RESTRICT,
    primary_column_id UUID NOT NULL UNIQUE REFERENCES database_columns(id) DEFERRABLE INITIALLY DEFERRED,
    record_type TEXT NOT NULL CHECK (record_type IN ('company', 'contact'))
);
CREATE INDEX crm_pipeline_entities_team ON crm_pipeline_entities(team_id);

CREATE FUNCTION clean_up_crm_pipeline() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM entity_access WHERE entity_id = OLD.id AND entity_type = 'crm_pipeline';
    DELETE FROM database_changes WHERE database_id = OLD.database_id;
    DELETE FROM databases WHERE id = OLD.database_id;
    RETURN NULL;
END $$;
CREATE TRIGGER crm_pipeline_cleanup AFTER DELETE ON crm_pipeline_entities
FOR EACH ROW EXECUTE FUNCTION clean_up_crm_pipeline();
