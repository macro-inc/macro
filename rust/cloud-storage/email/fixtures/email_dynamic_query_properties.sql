-- A tag definition and one applied tag on inbox thread 1, so property-filter
-- tests can assert threads are narrowed by entity_properties conditions.
-- Owned by the user created in email_dynamic_query.sql.
INSERT INTO property_definitions (id, team_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES
    ('bb111111-1111-1111-1111-111111111111', NULL, 'macro|user1@test.com', 'Tags', 'TAG', true, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    ('e0888888-8888-8888-8888-888888888881', '20000001-0000-0000-0000-000000000001', 'THREAD', 'bb111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["0bb11111-1111-1111-1111-111111111111"]}');
