-- Test-local grants only; mixed_items_expanded supplies entities and the caller.
INSERT INTO comms_channels (id, channel_type, name, owner_id) VALUES
('ac000000-0000-0000-0000-000000000001', 'private', 'active', 'macro|user-1@test.com'),
('ac000000-0000-0000-0000-000000000002', 'private', 'left', 'macro|user-1@test.com');
INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at) VALUES
('ac000000-0000-0000-0000-000000000001', 'member', 'macro|user-1@test.com', NULL),
('ac000000-0000-0000-0000-000000000002', 'member', 'macro|user-1@test.com', now());
INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|other@test.com', 'other@test.com', 'a1111111-1111-1111-1111-111111111111') ON CONFLICT DO NOTHING;
INSERT INTO team (id, name, owner_id) VALUES
('ac000000-0000-0000-0000-000000000003', 'member', 'macro|user-1@test.com'),
('ac000000-0000-0000-0000-000000000004', 'nonmember', 'macro|other@test.com');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('ac000000-0000-0000-0000-000000000003', 'macro|user-1@test.com', 'member');

-- B is channel-only, C is team-only, for each entity kind. A retains inherited
-- user grants; B retains direct plus inherited grants through its channel.
UPDATE entity_access SET source_type = 'channel', source_id = 'ac000000-0000-0000-0000-000000000001'
WHERE entity_id::text LIKE '%bbbb%';
UPDATE entity_access SET source_type = 'team', source_id = 'ac000000-0000-0000-0000-000000000003'
WHERE entity_id::text LIKE '%cccc%';

-- Simultaneous direct, channel and team grants must not consume page slots.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT entity_id, entity_type, source_id, source_type::entity_access_source_type, 'view'
FROM (VALUES
('ac000000-0000-0000-0000-000000000001', 'channel'),
('ac000000-0000-0000-0000-000000000003', 'team')
) sources(source_id, source_type)
CROSS JOIN (VALUES
('11111111-0000-0000-0000-000000000000'::uuid, 'document'),
('22222222-0000-0000-0000-000000000000'::uuid, 'chat'),
('aaaaaaaa-ffff-ffff-ffff-ffffffffffff'::uuid, 'project')
) entities(entity_id, entity_type)
ON CONFLICT DO NOTHING;

-- The isolated entities are owned by the caller but have only unusable grants.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT entity_id, entity_type, source_id, source_type::entity_access_source_type, 'view'
FROM (VALUES
('ac000000-0000-0000-0000-000000000002', 'channel'),
('ac000000-0000-0000-0000-000000000004', 'team'),
('macro|other@test.com', 'user')
) sources(source_id, source_type)
CROSS JOIN (VALUES
('11111111-9999-9999-9999-999999999999'::uuid, 'document'),
('22222222-9999-9999-9999-999999999999'::uuid, 'chat'),
('99999999-ffff-ffff-ffff-ffffffffffff'::uuid, 'project')
) entities(entity_id, entity_type)
ON CONFLICT DO NOTHING;

INSERT INTO document_sub_type (document_id, sub_type)
VALUES ('11111111-0000-0000-0000-000000000000', 'task');
