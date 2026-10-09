-- Keep existing form bindings and column types stable from preflight through
-- protection registration. SQLx retains these locks for the migration transaction.
LOCK TABLE forms, database_columns, property_definitions IN SHARE ROW EXCLUSIVE MODE;

-- One form per table, even while trashed. Refuse legacy ambiguity rather than
-- silently deleting forms or changing which table holds their responses.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM forms GROUP BY table_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Multiple forms reference one table. Resolve those forms before applying one-form-per-table.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM forms f
        LEFT JOIN database_columns c ON c.id = f.submitted_column_id
        LEFT JOIN property_definitions p ON p.id = c.property_definition_id
        WHERE f.submitted_column_id IS NOT NULL
        AND (c.table_id IS DISTINCT FROM f.table_id OR p.data_type IS DISTINCT FROM 'DATE'
             OR p.is_multi_select IS TRUE OR c.config IS NOT NULL)
    ) OR EXISTS (
        SELECT 1 FROM forms f
        LEFT JOIN database_columns c ON c.id = f.respondent_column_id
        LEFT JOIN property_definitions p ON p.id = c.property_definition_id
        WHERE f.respondent_column_id IS NOT NULL
        AND (c.table_id IS DISTINCT FROM f.table_id OR p.data_type IS DISTINCT FROM 'ENTITY'
             OR p.specific_entity_type IS DISTINCT FROM 'USER'
             OR p.is_multi_select IS TRUE OR c.config IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'Forms have invalid managed columns. Restore Submitted to a single date and Respondent to a single user before applying column protections.';
    END IF;
END;
$$;

ALTER TABLE forms ADD CONSTRAINT forms_one_per_table UNIQUE (table_id);
DROP INDEX idx_forms_table;

-- Protections belong to a column. They are internal capabilities, not editable
-- properties. No owner identity is needed: each table has one form.
CREATE TABLE database_column_protections (
    column_id UUID NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    capability TEXT NOT NULL CHECK (capability IN ('delete', 'change_type')),
    PRIMARY KEY (column_id, capability)
);

-- Serialize registration/removal with the table locks used by schema writes.
CREATE FUNCTION lock_database_column_protection() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM database_tables
    WHERE id = (SELECT table_id FROM database_columns WHERE id = COALESCE(NEW.column_id, OLD.column_id))
    FOR UPDATE;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER lock_database_column_protection
    BEFORE INSERT OR DELETE ON database_column_protections
    FOR EACH ROW EXECUTE FUNCTION lock_database_column_protection();

-- Keep the relational dependency and its protections in the same transaction.
-- Trashing keeps the dependency; permanently deleting a form releases it without
-- deleting its columns, table, database, or answer rows.
CREATE FUNCTION maintain_form_column_protections() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE managed UUID;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        DELETE FROM database_column_protections
        WHERE column_id IN (OLD.submitted_column_id, OLD.respondent_column_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
        PERFORM 1 FROM database_tables WHERE id = NEW.table_id FOR UPDATE;
        FOREACH managed IN ARRAY ARRAY[NEW.submitted_column_id, NEW.respondent_column_id] LOOP
            IF managed IS NULL THEN CONTINUE; END IF;
            IF NOT EXISTS (SELECT 1 FROM database_columns WHERE id = managed AND table_id = NEW.table_id) THEN
                RAISE EXCEPTION 'A form managed column must belong to its response table' USING ERRCODE = '23514';
            END IF;
            INSERT INTO database_column_protections (column_id, capability)
            VALUES (managed, 'delete'), (managed, 'change_type')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER form_column_protections
    AFTER INSERT OR UPDATE OF submitted_column_id, respondent_column_id, table_id OR DELETE ON forms
    FOR EACH ROW EXECUTE FUNCTION maintain_form_column_protections();

INSERT INTO database_column_protections (column_id, capability)
SELECT managed.column_id, capability
FROM forms
CROSS JOIN LATERAL (VALUES (submitted_column_id), (respondent_column_id)) managed(column_id)
CROSS JOIN (VALUES ('delete'), ('change_type')) protections(capability)
WHERE managed.column_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Defense in depth for direct SQL, property-definition changes, and cascades.
-- Deleting the containing table/database remains allowed; it deletes the form too.
CREATE FUNCTION enforce_database_column_protection() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE blocked TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM database_tables t JOIN databases d ON d.id = t.database_id
        WHERE t.id = OLD.table_id
    ) THEN RETURN COALESCE(NEW, OLD); END IF;
    PERFORM 1 FROM database_tables WHERE id = OLD.table_id FOR UPDATE;
    IF TG_OP = 'DELETE' THEN blocked := 'delete';
    ELSIF NEW.property_definition_id IS DISTINCT FROM OLD.property_definition_id
       OR NEW.config IS DISTINCT FROM OLD.config THEN blocked := 'change_type';
    ELSE RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM database_column_protections WHERE column_id = OLD.id AND capability = blocked) THEN
        RAISE EXCEPTION 'Column is protected against %', blocked
            USING ERRCODE = '23514', CONSTRAINT = 'database_column_protected';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER database_column_protection
    BEFORE DELETE OR UPDATE OF property_definition_id, config ON database_columns
    FOR EACH ROW EXECUTE FUNCTION enforce_database_column_protection();

CREATE FUNCTION enforce_database_property_type_protection() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.data_type IS NOT DISTINCT FROM OLD.data_type
       AND NEW.is_multi_select IS NOT DISTINCT FROM OLD.is_multi_select
       AND NEW.specific_entity_type IS NOT DISTINCT FROM OLD.specific_entity_type THEN RETURN NEW; END IF;
    PERFORM 1 FROM database_tables WHERE id IN (
        SELECT table_id FROM database_columns WHERE property_definition_id = OLD.id
    ) ORDER BY id FOR UPDATE;
    IF EXISTS (
        SELECT 1 FROM database_columns c JOIN database_column_protections p ON p.column_id = c.id
        WHERE c.property_definition_id = OLD.id AND p.capability = 'change_type'
    ) THEN
        RAISE EXCEPTION 'Column is protected against type changes'
            USING ERRCODE = '23514', CONSTRAINT = 'database_column_protected';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER database_property_type_protection
    BEFORE UPDATE OF data_type, is_multi_select, specific_entity_type ON property_definitions
    FOR EACH ROW EXECUTE FUNCTION enforce_database_property_type_protection();
