-- Tag definitions: per-owner label sets (user1 personal, Team 1, user2 personal).
-- Kept separate from properties.sql so definition-count assertions stay valid.
INSERT INTO property_definitions (id, team_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES
    ('aa111111-1111-1111-1111-111111111111', NULL, 'user1', 'Tags', 'TAG', true, NULL),
    ('aa222222-2222-2222-2222-222222222222', '0e000000-0000-0000-0000-000000000001', NULL, 'Tags', 'TAG', true, NULL),
    ('aa333333-3333-3333-3333-333333333333', NULL, 'user2', 'Tags', 'TAG', true, NULL)
ON CONFLICT (id) DO NOTHING;

-- tagdoc1 carries a regular select plus one tag application per owner above.
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    ('e0777777-7777-7777-7777-777777777771', 'tagdoc1', 'DOCUMENT', '11111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["10111111-1111-1111-1111-111111111113"]}'),
    ('e0777777-7777-7777-7777-777777777772', 'tagdoc1', 'DOCUMENT', 'aa111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["0aa11111-1111-1111-1111-111111111111"]}'),
    ('e0777777-7777-7777-7777-777777777773', 'tagdoc1', 'DOCUMENT', 'aa222222-2222-2222-2222-222222222222', '{"type": "SelectOption", "value": ["0aa22222-2222-2222-2222-222222222222"]}'),
    ('e0777777-7777-7777-7777-777777777774', 'tagdoc1', 'DOCUMENT', 'aa333333-3333-3333-3333-333333333333', '{"type": "SelectOption", "value": ["0aa33333-3333-3333-3333-333333333333"]}');
