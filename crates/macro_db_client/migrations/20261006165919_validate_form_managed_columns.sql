-- Creation reads the schema before attaching the form. Recheck after taking the
-- schema writer's table lock so a concurrent retype cannot freeze invalid metadata.
CREATE FUNCTION validate_form_managed_columns() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM database_tables WHERE id = NEW.table_id FOR UPDATE;
    -- The table's own deletion cascades the form and may clear its references.
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF NEW.submitted_column_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM database_columns c JOIN property_definitions p ON p.id = c.property_definition_id
        WHERE c.id = NEW.submitted_column_id AND c.table_id = NEW.table_id
        AND p.data_type = 'DATE' AND p.is_multi_select IS NOT TRUE AND c.config IS NULL
    ) THEN
        RAISE EXCEPTION 'Submitted column changed. Refresh the table before creating the form.'
            USING ERRCODE = '23514', CONSTRAINT = 'form_managed_column_schema';
    END IF;
    IF NEW.respondent_column_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM database_columns c JOIN property_definitions p ON p.id = c.property_definition_id
        WHERE c.id = NEW.respondent_column_id AND c.table_id = NEW.table_id
        AND p.data_type = 'ENTITY' AND p.specific_entity_type = 'USER'
        AND p.is_multi_select IS NOT TRUE AND c.config IS NULL
    ) THEN
        RAISE EXCEPTION 'Respondent column changed. Refresh the table before creating the form.'
            USING ERRCODE = '23514', CONSTRAINT = 'form_managed_column_schema';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_form_managed_columns
    BEFORE INSERT OR UPDATE OF submitted_column_id, respondent_column_id, table_id ON forms
    FOR EACH ROW EXECUTE FUNCTION validate_form_managed_columns();
