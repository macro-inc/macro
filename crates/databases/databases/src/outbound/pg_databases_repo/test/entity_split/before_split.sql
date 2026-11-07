-- The destructive down migration must leave the previous schema empty.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM databases) THEN
        RAISE EXCEPTION 'rollback retained database content';
    END IF;
END;
$$;

INSERT INTO databases (id, name, owner_id) VALUES
('019a0000-0000-7000-8000-000000000001', 'Disposable', 'macro|databases-a@macro.com');
INSERT INTO database_tables (id, database_id, name, position) VALUES
('019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000001', 'Contacts', '80');
INSERT INTO property_definitions (id, database_id, display_name, data_type, is_multi_select) VALUES
('019a0000-0000-7000-8000-000000000003', '019a0000-0000-7000-8000-000000000001', 'Name', 'STRING', false);
INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES
('019a0000-0000-7000-8000-000000000004', '019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000003', '80');
INSERT INTO database_rows (id, table_id, position) VALUES
('019a0000-0000-7000-8000-000000000005', '019a0000-0000-7000-8000-000000000002', '80');
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES
('019a0000-0000-7000-8000-000000000006', '019a0000-0000-7000-8000-000000000005', 'DATABASE_ROW', '019a0000-0000-7000-8000-000000000003', '{"type":"String","value":"Disposable"}');
INSERT INTO database_views (id, database_id, table_id, name, position, query, layout) VALUES
('019a0000-0000-7000-8000-000000000007', '019a0000-0000-7000-8000-000000000001', '019a0000-0000-7000-8000-000000000002', 'Contacts', '80', '{}', '{}');
INSERT INTO database_view_positions (view_id, row_id, lane, position) VALUES
('019a0000-0000-7000-8000-000000000007', '019a0000-0000-7000-8000-000000000005', '', '80');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
('019a0000-0000-7000-8000-000000000001', 'database', 'macro|databases-a@macro.com', 'user', 'owner');
WITH change AS (
    INSERT INTO database_changes (database_id, table_id, version, ops, inverse) VALUES
    ('019a0000-0000-7000-8000-000000000001', '019a0000-0000-7000-8000-000000000002', 1, '[]', '{}')
    RETURNING id
), changed_row AS (
    INSERT INTO database_change_rows (change_id, row_id, kind, columns)
    SELECT id, '019a0000-0000-7000-8000-000000000005', 'insert', '{}' FROM change
)
INSERT INTO database_change_columns (change_id, column_id, kind)
SELECT id, '019a0000-0000-7000-8000-000000000004', 'create' FROM change;
INSERT INTO database_queries (id, database_id, definition) VALUES
('019a0000-0000-7000-8000-000000000008', '019a0000-0000-7000-8000-000000000001', '{"version":1,"query":"SELECT * FROM Contacts"}');
INSERT INTO database_starter_seeds (user_id, database_id) VALUES
('macro|databases-a@macro.com', '019a0000-0000-7000-8000-000000000001');
