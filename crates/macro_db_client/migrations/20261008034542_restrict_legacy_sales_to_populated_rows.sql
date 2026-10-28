-- Correct the one-time Sales copy without changing an already-applied checksum.
-- SQLx inserts its ledger entry in the same transaction as the copy: installed_on
-- and the imported entities' created_at therefore have the same now() value.
-- This identifies the imported pipelines even after a rename, without touching
-- a user-created pipeline named Sales. Legacy companies/properties stay intact.
SELECT pg_advisory_xact_lock(1413824845, 1);
LOCK TABLE crm_pipeline_entities, database_tables, database_rows, entity_properties,
    database_view_positions IN SHARE ROW EXCLUSIVE MODE;

-- The copy wrote Stage, Owner, and Revenue only when set, so a copied row with
-- no populated cell besides Company had none of them. Empty selections are
-- empty; revenue 0 is a value. Rows added later or placed on a board survive.
CREATE TEMP TABLE empty_legacy_sales_rows ON COMMIT DROP AS
SELECT r.id, r.table_id
FROM _sqlx_migrations migration
JOIN crm_pipeline_entities pipeline ON pipeline.created_at = migration.installed_on
JOIN database_rows r ON r.table_id = pipeline.table_id AND r.created_at = pipeline.created_at
JOIN database_columns primary_column ON primary_column.id = pipeline.primary_column_id
WHERE migration.version = 20261007172435 AND migration.success
    AND pipeline.record_type = 'company'
    AND NOT EXISTS (SELECT 1 FROM database_view_positions position WHERE position.row_id = r.id)
    AND NOT EXISTS (
        SELECT 1 FROM entity_properties cell
        WHERE cell.entity_type = 'DATABASE_ROW' AND cell.entity_id = r.id::text
            AND cell.property_definition_id <> primary_column.property_definition_id
            AND cell.values -> 'value' NOT IN ('null'::jsonb, '[]'::jsonb, '""'::jsonb)
    );

-- Row cleanup triggers delete only the copied cells, never their CRM companies.
-- Publish a new version and deletion journal so open editors/caches observe the
-- correction. This data migration is deliberately not an undoable user action.
WITH deleted AS (
    DELETE FROM database_rows r USING empty_legacy_sales_rows empty
    WHERE r.id = empty.id RETURNING r.table_id
), changed AS (
    UPDATE database_tables SET version = version + 1
    WHERE id IN (SELECT table_id FROM deleted)
    RETURNING id, database_id, version
), journal AS (
    INSERT INTO database_changes (database_id, table_id, version, ops, inverse)
    SELECT changed.database_id, changed.id, changed.version,
        jsonb_build_array(jsonb_build_object('kind', 'rows', 'table', changed.id,
            'change', jsonb_build_object('kind', 'delete', 'rows', jsonb_agg(empty.id ORDER BY empty.id)))),
        '{"formatVersion":1,"incomplete":true,"ops":[],"before":{"cells":{}},"after":{"cells":{}}}'::jsonb
    FROM changed JOIN empty_legacy_sales_rows empty ON empty.table_id = changed.id
    GROUP BY changed.database_id, changed.id, changed.version
    RETURNING id, table_id
)
INSERT INTO database_change_rows (change_id, row_id, kind, columns)
SELECT journal.id, empty.id, 'delete', ARRAY[]::uuid[]
FROM journal JOIN empty_legacy_sales_rows empty ON empty.table_id = journal.table_id;
