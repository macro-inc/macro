INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|initiative-owner@test.com', 'initiative-owner@test.com', 'a1111111-1111-1111-1111-111111111111');
INSERT INTO team (id, name, owner_id) VALUES ('ae000000-0000-0000-0000-000000000001', 'initiative team', 'macro|initiative-owner@test.com');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('ae000000-0000-0000-0000-000000000001', 'macro|initiative-owner@test.com', 'owner'),
('ae000000-0000-0000-0000-000000000001', 'macro|user-1@test.com', 'member');
INSERT INTO comms_channels (id, channel_type, name, owner_id) VALUES
('ae000000-0000-0000-0000-000000000002', 'private', 'active', 'macro|initiative-owner@test.com'),
('ae000000-0000-0000-0000-000000000003', 'private', 'left', 'macro|initiative-owner@test.com');
INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at) VALUES
('ae000000-0000-0000-0000-000000000002', 'member', 'macro|user-1@test.com', NULL),
('ae000000-0000-0000-0000-000000000003', 'member', 'macro|user-1@test.com', now());
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT 'soup-initiative-share-' || n, CASE WHEN n = 4 THEN 'TEAM' ELSE NULL END, CASE WHEN n = 4 THEN 'view'::"AccessLevel" ELSE NULL END
FROM generate_series(1, 6) n;
INSERT INTO initiative (id, name, owner_user_id, share_permission_id, created_at, updated_at)
SELECT ('ad000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Launch ' || n,
'macro|initiative-owner@test.com', 'soup-initiative-share-' || n, '2026-01-01', '2026-01-02'
FROM generate_series(1, 6) n;
-- Individual, active-channel and explicit-team grants. Row 4 uses the team link.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
('ad000000-0000-0000-0000-000000000001', 'initiative', 'macro|user-1@test.com', 'user', 'view'),
('ad000000-0000-0000-0000-000000000002', 'initiative', 'ae000000-0000-0000-0000-000000000002', 'channel', 'view'),
('ad000000-0000-0000-0000-000000000003', 'initiative', 'ae000000-0000-0000-0000-000000000001', 'team', 'edit'),
-- Duplicate source must not consume an extra page slot.
('ad000000-0000-0000-0000-000000000003', 'initiative', 'macro|user-1@test.com', 'user', 'view'),
-- Left-channel grants and an inaccessible row must never leak.
('ad000000-0000-0000-0000-000000000005', 'initiative', 'ae000000-0000-0000-0000-000000000003', 'channel', 'view');
-- Row 7 is owned by the viewer; row 8 is granted through a shared folder.
-- Both sort after rows 1-4.
INSERT INTO "SharePermission" (id) VALUES ('soup-initiative-share-7'), ('soup-initiative-share-8');
INSERT INTO initiative (id, name, owner_user_id, share_permission_id, created_at, updated_at) VALUES
('ad000000-0000-0000-0000-000000000007', 'Launch 7', 'macro|user-1@test.com', 'soup-initiative-share-7', '2026-01-01', '2026-01-01'),
('ad000000-0000-0000-0000-000000000008', 'Launch 8', 'macro|initiative-owner@test.com', 'soup-initiative-share-8', '2026-01-01', '2026-01-01');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
('ad000000-0000-0000-0000-000000000007', 'initiative', 'macro|user-1@test.com', 'user', 'owner', NULL),
('ad000000-0000-0000-0000-000000000008', 'initiative', 'macro|user-1@test.com', 'user', 'view', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff');
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT replace(id::text, 'ad000000', 'ab000000')::uuid, id::text, 'INITIATIVE', '00000001-0000-0000-0000-000000000002',
'{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000001"]}'::jsonb
FROM initiative WHERE id::text LIKE 'ad000000%';
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES
('ac000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000002', 'INITIATIVE', '00000001-0000-0000-0000-000000000004', '{"type":"Date","value":"2026-02-10T00:00:00Z"}');
