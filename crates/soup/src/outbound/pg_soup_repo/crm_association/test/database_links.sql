INSERT INTO property_definitions
            (id, display_name, data_type, is_multi_select, database_id)
        VALUES
            ('51000000-0000-0000-0000-000000000001', 'Account', 'ENTITY', true,
             'db000000-0000-0000-0000-000000000001'),
            ('51000000-0000-0000-0000-000000000002', 'Person', 'ENTITY', true,
             'db000000-0000-0000-0000-000000000001');

INSERT INTO database_columns (id, table_id, property_definition_id, position)
        VALUES
            ('c1000000-0000-0000-0000-000000000001',
             '7ab00000-0000-0000-0000-000000000001',
             '51000000-0000-0000-0000-000000000001', 'b'),
            ('c1000000-0000-0000-0000-000000000002',
             '7ab00000-0000-0000-0000-000000000001',
             '51000000-0000-0000-0000-000000000002', 'c');

INSERT INTO entity_properties
            (id, entity_id, entity_type, property_definition_id, values)
        VALUES
            ('e1000000-0000-0000-0000-000000000001',
             '70000000-0000-0000-0000-000000000001', 'DATABASE_ROW',
             '51000000-0000-0000-0000-000000000001',
             '{"type":"EntityReference","value":[{"entity_id":"00000000-0000-0000-0000-0000000000c0","entity_type":"COMPANY"}]}'),
            ('e1000000-0000-0000-0000-000000000002',
             '70000000-0000-0000-0000-000000000001', 'DATABASE_ROW',
             '51000000-0000-0000-0000-000000000002',
             '{"type":"EntityReference","value":[{"entity_id":"00000000-0000-0000-0000-0000000000c1","entity_type":"CONTACT"}]}'),
            ('e1000000-0000-0000-0000-000000000003',
             '70000000-0000-0000-0000-000000000002', 'DATABASE_ROW',
             '51000000-0000-0000-0000-000000000002',
             '{"type":"EntityReference","value":[{"entity_id":"00000000-0000-0000-0000-0000000000c1","entity_type":"CONTACT"}]}'),
            ('e1000000-0000-0000-0000-000000000004',
             '70000000-0000-0000-0000-000000000003', 'DATABASE_ROW',
             '51000000-0000-0000-0000-000000000001',
             '{"type":"EntityReference","value":[{"entity_id":"00000000-0000-0000-0000-0000000000c0","entity_type":"CONTACT"}]}');
