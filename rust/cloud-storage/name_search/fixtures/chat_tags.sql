-- Tag values on chats, keyed to the system Status definition seeded by
-- migrations. Only the option ids inside `values` matter to the tag filter.
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES
    (
        'eeeeeeee-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        'CHAT',
        '00000001-0000-0000-0000-000000000002',
        '{"type": "SelectOption", "value": ["cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002"]}'
    );
