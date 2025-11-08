INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'private 1', 'private', NULL, 'user1'),
       ('22222222-2222-2222-2222-222222222222', NULL, 'direct_message', NULL, 'user3'),
       ('33333333-3333-3333-3333-333333333333', 'public channel', 'public', NULL, 'user5'),
       ('44444444-4444-4444-4444-444444444444', 'org channel', 'organization', 12345, 'user1'),
       ('55555555-5555-5555-5555-555555555555', 'private 2', 'private', NULL, 'user2'),
       ('66666666-6666-6666-6666-666666666666', NULL, 'direct_message', NULL, 'user1');

INSERT INTO comms_channel_participants (channel_id, role, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'owner', 'user1'),
       ('22222222-2222-2222-2222-222222222222', 'member', 'user4'),
       ('33333333-3333-3333-3333-333333333333', 'owner', 'user5'),
       ('44444444-4444-4444-4444-444444444444', 'owner', 'user1'),
       ('55555555-5555-5555-5555-555555555555', 'owner', 'user2'),
       ('66666666-6666-6666-6666-666666666666', 'member', 'user5');

INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, thread_id)
VALUES ('0dd7bef6-a56d-4605-a22e-62245d14f6b5', '11111111-1111-1111-1111-111111111111', 'user1', 'message 1 content',
        '2024-01-01T12:00:00Z', NULL),
       ('3f91f184-7803-44e2-9a43-7c027b23ff03', '11111111-1111-1111-1111-111111111111', 'user2', 'message 2 content',
        '2024-01-02T12:00:00Z', NULL),
       ('04cec93f-0d53-4f10-80e7-8d56a8d8d706', '22222222-2222-2222-2222-222222222222', 'user3', 'dm msg content',
        '2024-01-03T12:00:00Z', NULL),
       ('0a0a4e2a-af9c-4453-840c-3e9a726af571', '33333333-3333-3333-3333-333333333333', 'user1',
        'Check out this documentation!', '2024-01-04T10:00:00Z', NULL),
       ('2196b3c1-d27b-48c2-8813-89a145869996', '33333333-3333-3333-3333-333333333333', 'user2',
        'I found another version of that doc', '2024-01-04T11:00:00Z', NULL),
       ('f1ee8c4f-bb45-4214-8907-720489b2cb36', '44444444-4444-4444-4444-444444444444', 'user5',
        'Here are multiple docs to review', '2024-01-05T09:00:00Z', NULL),
       ('21460017-031f-4f0c-8450-193eedfb1a49', '55555555-5555-5555-5555-555555555555', 'user2',
        'Internal documentation draft', '2024-01-06T14:00:00Z', NULL),
       ('d4a9a649-b7f4-438d-9dd2-0868cef5ba1c', '66666666-6666-6666-6666-666666666666', 'user5',
        'Your private document for review', '2024-01-07T15:30:00Z', NULL),
       ('85905168-b64d-492d-bad8-91761c0fd860', '33333333-3333-3333-3333-333333333333', 'user3',
        'Starting a thread about this doc', '2024-01-08T08:00:00Z', NULL),
       ('3031a8f8-5855-4540-be67-f44b2c2dbaab', '33333333-3333-3333-3333-333333333333', 'user4',
        'Here are my thoughts on the doc', '2024-01-08T08:30:00Z', '85905168-b64d-492d-bad8-91761c0fd860'),
       ('097c9768-e40b-4eaa-8405-dbf93e20a9e2', '33333333-3333-3333-3333-333333333333', 'user5',
        'I revised the doc with your feedback', '2024-01-08T10:00:00Z', '85905168-b64d-492d-bad8-91761c0fd860'),
       -- extra messages referenced only by attachments
       ('482a19b8-0cbd-490e-812d-252b6f48a611', '11111111-1111-1111-1111-111111111111', 'user1', 'Doc11 discussion',
        '2024-01-09T09:00:00Z', NULL),
       ('9ea88d0a-d88c-4d9a-8690-2b589ce9d185', '33333333-3333-3333-3333-333333333333', 'user5', 'Doc10 follow-up',
        '2024-01-10T10:00:00Z', NULL),
       ('8efccabd-2400-42d5-82a9-5c426db165f9', '33333333-3333-3333-3333-333333333333', 'user3',
        'Deleted message placeholder', '2024-06-12T12:00:00Z', NULL),
       ('5c3fb396-24c6-42d4-b302-20f9b3be4ffc', '33333333-3333-3333-3333-333333333333', 'user4',
        'Thread-specific message', '2024-06-12T12:02:00Z', NULL),
       ('7c2dabd6-175a-4b16-badf-cb39787cc730', '33333333-3333-3333-3333-333333333333', 'user5', 'User-left follow-up',
        '2024-06-12T12:03:00Z', NULL);

INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, created_at)
VALUES ('905105b7-c7f4-4b03-aff6-388a07886f59', '0dd7bef6-a56d-4605-a22e-62245d14f6b5',
        '11111111-1111-1111-1111-111111111111', 'doc', 'doc1', '2024-01-01T12:01:00Z'),
       ('f70b8691-0daf-4a88-a962-95d6ef386079', '04cec93f-0d53-4f10-80e7-8d56a8d8d706',
        '22222222-2222-2222-2222-222222222222', 'doc', 'doc2', '2024-01-03T12:01:00Z'),
       ('982f976c-f2de-4a4a-a2d5-e208616ec4c1', '0a0a4e2a-af9c-4453-840c-3e9a726af571',
        '33333333-3333-3333-3333-333333333333', 'doc', 'doc3', '2024-01-04T10:01:00Z'),
       ('60226329-222b-4e65-8de2-c31d0e6da082', '2196b3c1-d27b-48c2-8813-89a145869996',
        '33333333-3333-3333-3333-333333333333', 'doc', 'doc3-v2', '2024-01-04T11:01:00Z'),
       ('5f857b01-8b06-4129-9062-4d6d1e35e96b', 'f1ee8c4f-bb45-4214-8907-720489b2cb36',
        '44444444-4444-4444-4444-444444444444', 'doc', 'doc4', '2024-01-05T09:01:00Z'),
       ('d7b28a9e-2054-429f-9953-963c1be05d0c', '21460017-031f-4f0c-8450-193eedfb1a49',
        '55555555-5555-5555-5555-555555555555', 'doc', 'doc7', '2024-01-06T14:01:00Z'),
       ('3f7f555d-7319-4069-95e9-bdf0ba2fa0ab', 'd4a9a649-b7f4-438d-9dd2-0868cef5ba1c',
        '66666666-6666-6666-6666-666666666666', 'doc', 'doc8', '2024-01-07T15:31:00Z'),
       ('1a4bfe89-735d-49b3-a8ef-3b9cb0d22068', '85905168-b64d-492d-bad8-91761c0fd860',
        '33333333-3333-3333-3333-333333333333', 'doc', 'doc9', '2024-01-08T08:01:00Z'),
       ('dd07ae5b-c3dc-43e9-bc7d-f23c94b11843', '3031a8f8-5855-4540-be67-f44b2c2dbaab',
        '33333333-3333-3333-3333-333333333333', 'doc', 'doc9', '2024-01-08T08:31:00Z'),
       ('e6fdd2af-2beb-473e-a34c-7f0babcffbcd', '097c9768-e40b-4eaa-8405-dbf93e20a9e2',
        '33333333-3333-3333-3333-333333333333', 'doc', 'doc9-revised', '2024-01-08T10:01:00Z'),
       ('b3df8e02-e61f-425c-8e08-fb240b582991', '9ea88d0a-d88c-4d9a-8690-2b589ce9d185',
        '33333333-3333-3333-3333-333333333333', 'doc', 'doc10', '2024-01-10T10:01:00Z'),
       ('18edd997-340d-4a1e-ac46-1a11386b3ff5', '482a19b8-0cbd-490e-812d-252b6f48a611',
        '11111111-1111-1111-1111-111111111111', 'doc', 'doc11', '2024-01-09T09:01:00Z'),
       ('ce563828-2d9e-43c9-a370-700d4f8c4284', '0dd7bef6-a56d-4605-a22e-62245d14f6b5',
        '11111111-1111-1111-1111-111111111111', 'image', 'image1', '2024-01-01T12:02:00Z'),
       ('43101546-4a4e-470f-b23b-60f45b200f2a', '3f91f184-7803-44e2-9a43-7c027b23ff03',
        '11111111-1111-1111-1111-111111111111', 'pdf', 'pdf1', '2024-01-02T12:02:00Z'),
       ('cdb2c8eb-fd34-401d-ad0d-5bfc74a3385b', '04cec93f-0d53-4f10-80e7-8d56a8d8d706',
        '22222222-2222-2222-2222-222222222222', 'spreadsheet', 'spreadsheet1', '2024-01-03T12:02:00Z'),
       ('7f2153f1-5996-40a4-95dc-b0b5e94f3483', '0a0a4e2a-af9c-4453-840c-3e9a726af571',
        '33333333-3333-3333-3333-333333333333', 'video', 'video1', '2024-01-04T10:02:00Z'),
       ('a501a1eb-3a49-449b-aecd-4f5ca01fae94', '8efccabd-2400-42d5-82a9-5c426db165f9',
        '33333333-3333-3333-3333-333333333333', 'doc', 'deleted_doc', '2024-06-12T12:01:00Z'),
       ('3a70e86f-d148-4131-b279-e496e1e75d6c', '5c3fb396-24c6-42d4-b302-20f9b3be4ffc',
        '33333333-3333-3333-3333-333333333333', 'doc', 'thread_doc', '2024-06-12T12:02:00Z'),
       ('3d81a9c2-5393-43fb-b323-30db6e1b17ac', '7c2dabd6-175a-4b16-badf-cb39787cc730',
        '33333333-3333-3333-3333-333333333333', 'doc', 'leftuser_doc', '2024-06-12T12:03:00Z');

-- Insert entity_mentions for document mentions (separate from direct attachments)
INSERT INTO comms_entity_mentions (source_entity_type, source_entity_id, entity_type, entity_id)
VALUES
    -- doc_mention1 is mentioned in user1's private channel (user1 should see it)
    ('message', '3f91f184-7803-44e2-9a43-7c027b23ff03', 'doc', 'doc_mention1'),
    -- doc_mention2 is mentioned in public channel (user5 should see it)
    ('message', '2196b3c1-d27b-48c2-8813-89a145869996', 'doc', 'doc_mention2'),
    -- doc_mention3 is mentioned in org channel (user1 should see it as owner)
    ('message', 'f1ee8c4f-bb45-4214-8907-720489b2cb36', 'doc', 'doc_mention3'),
    -- doc_mention4 is mentioned in a thread message (user5 should see it)
    ('message', '3031a8f8-5855-4540-be67-f44b2c2dbaab', 'doc', 'doc_mention4'),
    -- doc_mention_no_access is mentioned in private channel user2 owns (user1 should NOT see it)
    ('message', '21460017-031f-4f0c-8450-193eedfb1a49', 'doc', 'doc_mention_no_access'),
    -- doc_mention_deleted is mentioned in a deleted message (should not appear)
    ('message', '8efccabd-2400-42d5-82a9-5c426db165f9', 'doc', 'doc_mention_deleted'),
    -- user mentions (should not appear when searching for documents)
    ('message', '0dd7bef6-a56d-4605-a22e-62245d14f6b5', 'user', 'user123'),

    -- Generic entity mentions (non-message sources) for testing
    -- doc_generic1 is mentioned by document doc_source1 (anyone should see this generic reference)
    ('doc', 'doc_source1', 'doc', 'doc_generic1'),
    -- doc_generic2 is mentioned by user user_source1 (anyone should see this generic reference)
    ('user', 'user_source1', 'doc', 'doc_generic2'),
    -- doc_generic3 is mentioned by chat chat_source1 (anyone should see this generic reference)
    ('chat', 'chat_source1', 'doc', 'doc_generic3'),
    -- doc_generic4 is mentioned by project project_source1 (anyone should see this generic reference)
    ('project', 'project_source1', 'doc', 'doc_generic4');

-- Mark one message as deleted for testing
UPDATE comms_messages
SET deleted_at = '2024-06-12T13:00:00Z'
WHERE id = '8efccabd-2400-42d5-82a9-5c426db165f9';

-- Add a user who left a channel for testing
INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
VALUES ('33333333-3333-3333-3333-333333333333', 'member', 'user7', '2024-06-01T12:00:00Z');

