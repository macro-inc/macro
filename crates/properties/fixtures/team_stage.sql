-- One Deal Stage definition per team, shaped like the CRM stage service creates them.
-- company1 has a value on both, so a viewer must only see their own team's.
INSERT INTO property_definitions (id, team_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES
    ('dd111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000001', NULL, 'Deal Stage', 'SELECT_STRING', false, NULL),
    ('dd222222-2222-2222-2222-222222222222', '0e000000-0000-0000-0000-000000000002', NULL, 'Deal Stage', 'SELECT_STRING', false, NULL),
    -- Same shape, different name: must not be picked up.
    ('dd333333-3333-3333-3333-333333333333', '0e000000-0000-0000-0000-000000000001', NULL, 'Region', 'SELECT_STRING', false, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value, color)
VALUES
    ('0dd11111-1111-1111-1111-111111111111', 'dd111111-1111-1111-1111-111111111111', 0, NULL, 'Lead', NULL),
    ('0dd11111-1111-1111-1111-111111111112', 'dd111111-1111-1111-1111-111111111111', 1, NULL, 'Customer', NULL),
    ('0dd22222-2222-2222-2222-222222222222', 'dd222222-2222-2222-2222-222222222222', 0, NULL, 'Prospect', NULL),
    ('0dd33333-3333-3333-3333-333333333333', 'dd333333-3333-3333-3333-333333333333', 0, NULL, 'EMEA', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    ('e0888888-8888-8888-8888-888888888881', 'company1', 'COMPANY', 'dd111111-1111-1111-1111-111111111111', '{"type": "SelectOption", "value": ["0dd11111-1111-1111-1111-111111111112"]}'),
    ('e0888888-8888-8888-8888-888888888882', 'company1', 'COMPANY', 'dd222222-2222-2222-2222-222222222222', '{"type": "SelectOption", "value": ["0dd22222-2222-2222-2222-222222222222"]}'),
    ('e0888888-8888-8888-8888-888888888883', 'company1', 'COMPANY', 'dd333333-3333-3333-3333-333333333333', '{"type": "SelectOption", "value": ["0dd33333-3333-3333-3333-333333333333"]}');
