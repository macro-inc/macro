-- Versions 5 to 7 of the Projects table in rows.sql: two cell writes, then a
-- relabelled option. Version 4 of another table must never show up.
INSERT INTO database_changes (id, database_id, table_id, version, ops, inverse) VALUES
    (101, '10000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 5, '[]', '{}'),
    (102, '10000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 6, '[]', '{}'),
    (103, '10000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 7, '[]', '{}'),
    (104, '10000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000002', 4, '[]', '{}');

INSERT INTO database_change_rows (change_id, row_id, kind, columns) VALUES
    (101, '60000000-0000-7000-8000-000000000002', 'update', '{}'),
    (102, '60000000-0000-7000-8000-000000000001', 'update', '{}'),
    (102, '60000000-0000-7000-8000-000000000002', 'update', '{}'),
    (104, '60000000-0000-7000-8000-000000000003', 'update', '{}');

INSERT INTO database_change_columns (change_id, column_id, kind) VALUES
    (102, '50000000-0000-7000-8000-000000000009', 'rename'),
    (103, '50000000-0000-7000-8000-000000000002', 'update_option');
