INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Public Channel', 'public', NULL, 'owner1');

INSERT INTO comms_messages (id, channel_id, sender_id, content, thread_id)
VALUES ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'user1', 'Test message 1',
        NULL);

INSERT INTO comms_entity_mentions (source_entity_type, source_entity_id, entity_id, entity_type)
VALUES ('message', '11111111-1111-1111-1111-111111111111', 'user1', 'user');
