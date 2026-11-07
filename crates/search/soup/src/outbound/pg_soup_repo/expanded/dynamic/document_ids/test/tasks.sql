-- Applied after mixed_items_expanded: its documents in A, C, and D are tasks,
-- and the task in C is in progress.
INSERT INTO public.document_sub_type (document_id, sub_type)
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
       ('11111111-cccc-cccc-cccc-cccccccccccc', 'task'),
       ('11111111-dddd-dddd-dddd-dddddddddddd', 'task');

INSERT INTO public.entity_properties (id, entity_id, entity_type, property_definition_id, values)
VALUES ('e0000000-0000-0000-0000-0000000000c1', '11111111-cccc-cccc-cccc-cccccccccccc', 'TASK',
        '00000001-0000-0000-0000-000000000002',
        '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000002"]}');
