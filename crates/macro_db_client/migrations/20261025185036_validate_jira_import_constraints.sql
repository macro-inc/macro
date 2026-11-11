SET LOCAL lock_timeout = '5s';
ALTER TABLE import_entity VALIDATE CONSTRAINT import_entity_source_check;
ALTER TABLE import_entity VALIDATE CONSTRAINT import_entity_kind_check;
ALTER TABLE import_run VALIDATE CONSTRAINT import_run_source_check;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_index WHERE indexrelid = 'import_entity_jira_team_object_key'::regclass
            AND indisvalid
    ) THEN
        RAISE EXCEPTION 'import_entity_jira_team_object_key is invalid; rebuild it concurrently';
    END IF;
END $$;
