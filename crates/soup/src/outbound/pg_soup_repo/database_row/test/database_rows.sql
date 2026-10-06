-- Three people: the owner of the CRM database, a viewer it was shared
-- with, and a stranger who owns a database of their own.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('d0000000-0000-0000-0000-000000000001', 'owner@databases.test', 'owner@databases.test', 'stripe_owner'),
('d0000000-0000-0000-0000-000000000002', 'viewer@databases.test', 'viewer@databases.test', 'stripe_viewer'),
('d0000000-0000-0000-0000-000000000003', 'stranger@databases.test', 'stranger@databases.test', 'stripe_stranger');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|owner@databases.test', 'owner@databases.test', 'd0000000-0000-0000-0000-000000000001'),
('macro|viewer@databases.test', 'viewer@databases.test', 'd0000000-0000-0000-0000-000000000002'),
('macro|stranger@databases.test', 'stranger@databases.test', 'd0000000-0000-0000-0000-000000000003');

INSERT INTO databases (id) VALUES
('db000000-0000-0000-0000-000000000001'),
('db000000-0000-0000-0000-000000000002');
INSERT INTO database_entities (database_id, name, user_id) VALUES
('db000000-0000-0000-0000-000000000001', 'CRM', 'macro|owner@databases.test'),
('db000000-0000-0000-0000-000000000002', 'Private', 'macro|stranger@databases.test');
INSERT INTO database_tables (id, database_id, name, position) VALUES
('7ab00000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'Deals', 'a'),
('7ab00000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000001', 'Contacts', 'b'),
('7ab00000-0000-0000-0000-000000000003', 'db000000-0000-0000-0000-000000000002', 'Notes', 'a');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
('db000000-0000-0000-0000-000000000001', 'database', 'macro|owner@databases.test', 'user', 'owner'),
('db000000-0000-0000-0000-000000000001', 'database', 'macro|viewer@databases.test', 'user', 'view'),
('db000000-0000-0000-0000-000000000002', 'database', 'macro|stranger@databases.test', 'user', 'owner');

-- Deals.Stage: a single select owned by the CRM database.
INSERT INTO property_definitions (id, display_name, data_type, is_multi_select, database_id) VALUES
('5e1ec700-0000-0000-0000-000000000001', 'Stage', 'SELECT_STRING', false, 'db000000-0000-0000-0000-000000000001');
INSERT INTO property_options (id, property_definition_id, display_order, string_value) VALUES
('0e000000-0000-0000-0000-000000000001', '5e1ec700-0000-0000-0000-000000000001', 0, 'Won'),
('0e000000-0000-0000-0000-000000000002', '5e1ec700-0000-0000-0000-000000000001', 1, 'Lost');
INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES
('c0000000-0000-0000-0000-000000000001', '7ab00000-0000-0000-0000-000000000001', '5e1ec700-0000-0000-0000-000000000001', 'a');

-- Three deals, one contact, one private note.
INSERT INTO database_rows (id, table_id, position, created_by, created_at, updated_at) VALUES
('70000000-0000-0000-0000-000000000001', '7ab00000-0000-0000-0000-000000000001', 'a', 'macro|owner@databases.test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
('70000000-0000-0000-0000-000000000002', '7ab00000-0000-0000-0000-000000000001', 'b', 'macro|owner@databases.test', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
('70000000-0000-0000-0000-000000000003', '7ab00000-0000-0000-0000-000000000001', 'c', NULL, '2026-01-03T00:00:00Z', '2026-01-05T00:00:00Z'),
('70000000-0000-0000-0000-000000000004', '7ab00000-0000-0000-0000-000000000002', 'a', 'macro|owner@databases.test', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z'),
('70000000-0000-0000-0000-000000000005', '7ab00000-0000-0000-0000-000000000003', 'a', 'macro|stranger@databases.test', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z');
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES
('e0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'DATABASE_ROW', '5e1ec700-0000-0000-0000-000000000001', '{"type":"SelectOption","value":["0e000000-0000-0000-0000-000000000001"]}'),
('e0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'DATABASE_ROW', '5e1ec700-0000-0000-0000-000000000001', '{"type":"SelectOption","value":["0e000000-0000-0000-0000-000000000002"]}'),
('e0000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 'DATABASE_ROW', '5e1ec700-0000-0000-0000-000000000001', '{"type":"SelectOption","value":["0e000000-0000-0000-0000-000000000001"]}');
