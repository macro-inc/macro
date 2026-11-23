-- The test user is the fixture documents' owner.
-- A and B are tasks: A assigned to another user, B to the test user.
INSERT INTO document_sub_type (document_id, sub_type) VALUES
('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'task');
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES
('0196c000-0000-7000-8000-000000000001', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK', '00000001-0000-0000-0000-000000000001',
 jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(jsonb_build_object('entity_id', 'macro|other-user', 'entity_type', 'USER')))),
('0196c000-0000-7000-8000-000000000002', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TASK', '00000001-0000-0000-0000-000000000001',
 jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(jsonb_build_object('entity_id', (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'entity_type', 'USER'))));

-- Unseen notifications on B, D and the isolated document, which the test
-- user cannot see; a seen one on C.
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, created_at, metadata) VALUES
('0196c000-0000-7000-8000-000000000011', 'test', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'test', now(), '{}'),
('0196c000-0000-7000-8000-000000000012', 'test', '11111111-dddd-dddd-dddd-dddddddddddd', 'document', 'test', now(), '{}'),
('0196c000-0000-7000-8000-000000000013', 'test', '11111111-9999-9999-9999-999999999999', 'document', 'test', now(), '{}'),
('0196c000-0000-7000-8000-000000000014', 'test', '11111111-cccc-cccc-cccc-cccccccccccc', 'document', 'test', now(), '{}');
INSERT INTO user_notification (user_id, notification_id, state, seen_at, deleted_at)
SELECT (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), notification_id::uuid, state::notification_state, seen_at, NULL
FROM (VALUES
('0196c000-0000-7000-8000-000000000011', 'unseen', NULL::timestamptz),
('0196c000-0000-7000-8000-000000000012', 'unseen', NULL),
('0196c000-0000-7000-8000-000000000013', 'unseen', NULL),
('0196c000-0000-7000-8000-000000000014', 'seen', now())
) notified(notification_id, state, seen_at);

-- The test user has frecency on C.
INSERT INTO frecency_aggregates (entity_id, entity_type, user_id, event_count, frecency_score, first_event) VALUES
('11111111-cccc-cccc-cccc-cccccccccccc', 'document', (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 3, 10.0, '2024-01-01 00:00:00+00');
