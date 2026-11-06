-- Tag definitions: per-owner label sets (user1 personal, Team 1, user2 personal).
-- Kept separate from properties.sql so definition-count assertions stay valid.
INSERT INTO property_definitions (id, team_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES
    ('aa111111-1111-1111-1111-111111111111', NULL, 'macro|user1@test.com', 'Tags', 'TAG', true, NULL),
    ('aa222222-2222-2222-2222-222222222222', '0e000000-0000-0000-0000-000000000001', NULL, 'Tags', 'TAG', true, NULL),
    ('aa333333-3333-3333-3333-333333333333', NULL, 'macro|user2@test.com', 'Tags', 'TAG', true, NULL)
ON CONFLICT (id) DO NOTHING;

-- Tag options (labels). Ids match the option ids referenced by tagdoc1 below.
INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value, color)
VALUES
    ('0aa11111-1111-1111-1111-111111111111', 'aa111111-1111-1111-1111-111111111111', 0, NULL, 'bug-report', '#ff0000'),
    ('0aa11111-1111-1111-1111-111111111112', 'aa111111-1111-1111-1111-111111111111', 1, NULL, 'mobile', NULL),
    ('0aa22222-2222-2222-2222-222222222222', 'aa222222-2222-2222-2222-222222222222', 0, NULL, 'urgent', NULL),
    ('0aa33333-3333-3333-3333-333333333333', 'aa333333-3333-3333-3333-333333333333', 0, NULL, 'user2-private', NULL)
ON CONFLICT (id) DO NOTHING;

-- tagdoc1 carries a regular select plus one tag application per owner above.
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    ('e0777777-7777-7777-7777-777777777771', 'tagdoc1', 'DOCUMENT', '11111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["10111111-1111-1111-1111-111111111113"]}'),
    ('e0777777-7777-7777-7777-777777777772', 'tagdoc1', 'DOCUMENT', 'aa111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["0aa11111-1111-1111-1111-111111111111"]}'),
    ('e0777777-7777-7777-7777-777777777773', 'tagdoc1', 'DOCUMENT', 'aa222222-2222-2222-2222-222222222222', '{"type": "SelectOption", "value": ["0aa22222-2222-2222-2222-222222222222"]}'),
    ('e0777777-7777-7777-7777-777777777774', 'tagdoc1', 'DOCUMENT', 'aa333333-3333-3333-3333-333333333333', '{"type": "SelectOption", "value": ["0aa33333-3333-3333-3333-333333333333"]}');
