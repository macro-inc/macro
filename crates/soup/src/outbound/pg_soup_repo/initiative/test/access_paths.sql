-- Every way the initiative listing policy can show, or must not show, an
-- initiative. Initiative N is updated N hours into 2026, so listings return
-- them in descending N.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('a1000000-0000-0000-0000-000000000001', 'viewer', 'viewer@paths.test', 'paths-stripe-1'),
('a1000000-0000-0000-0000-000000000002', 'teammate', 'teammate@paths.test', 'paths-stripe-2'),
('a1000000-0000-0000-0000-000000000003', 'outsider', 'outsider@paths.test', 'paths-stripe-3'),
('a1000000-0000-0000-0000-000000000004', 'loner', 'loner@paths.test', 'paths-stripe-4');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|viewer@paths.test', 'viewer@paths.test', 'a1000000-0000-0000-0000-000000000001'),
('macro|teammate@paths.test', 'teammate@paths.test', 'a1000000-0000-0000-0000-000000000002'),
('macro|outsider@paths.test', 'outsider@paths.test', 'a1000000-0000-0000-0000-000000000003'),
('macro|loner@paths.test', 'loner@paths.test', 'a1000000-0000-0000-0000-000000000004');

-- The viewer and teammate share a team; the outsider has their own; the loner has none.
INSERT INTO team (id, name, owner_id) VALUES
('a6000000-0000-0000-0000-000000000001', 'viewer team', 'macro|teammate@paths.test'),
('a6000000-0000-0000-0000-000000000002', 'other team', 'macro|outsider@paths.test');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('a6000000-0000-0000-0000-000000000001', 'macro|teammate@paths.test', 'owner'),
('a6000000-0000-0000-0000-000000000001', 'macro|viewer@paths.test', 'member'),
('a6000000-0000-0000-0000-000000000002', 'macro|outsider@paths.test', 'owner');

-- A bot of the viewer's team. Bots take part in channels but are never team members.
INSERT INTO bots (id, kind, team_id, name, handle) VALUES
('a4000000-0000-0000-0000-000000000001', 'owned', 'a6000000-0000-0000-0000-000000000001', 'paths bot', 'paths-bot');

-- Channels: one the viewer is in (with the bot), one the viewer left, the
-- outsider's, and one only the bot is in.
INSERT INTO comms_channels (id, channel_type, name, owner_id) VALUES
('a5000000-0000-0000-0000-000000000001', 'private', 'joined', 'macro|teammate@paths.test'),
('a5000000-0000-0000-0000-000000000002', 'private', 'left', 'macro|teammate@paths.test'),
('a5000000-0000-0000-0000-000000000003', 'private', 'other', 'macro|outsider@paths.test'),
('a5000000-0000-0000-0000-000000000004', 'private', 'bot only', 'macro|teammate@paths.test');
INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at) VALUES
('a5000000-0000-0000-0000-000000000001', 'member', 'macro|viewer@paths.test', NULL),
('a5000000-0000-0000-0000-000000000001', 'member', 'bot|a4000000-0000-0000-0000-000000000001', NULL),
('a5000000-0000-0000-0000-000000000002', 'member', 'macro|viewer@paths.test', '2026-01-01'),
('a5000000-0000-0000-0000-000000000003', 'member', 'macro|outsider@paths.test', NULL),
('a5000000-0000-0000-0000-000000000004', 'member', 'bot|a4000000-0000-0000-0000-000000000001', NULL);

INSERT INTO "Project" (id, name, "userId") VALUES
('a3000000-0000-0000-0000-000000000001', 'folder', 'macro|teammate@paths.test');

-- Initiatives 9, 10, 16 and 17 share a link with the owner's team; 11 is public.
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT 'paths-share-' || n,
    CASE WHEN n IN (9, 10, 16, 17) THEN 'TEAM' WHEN n = 11 THEN 'PUBLIC' END,
    CASE WHEN n IN (9, 10, 11, 16, 17) THEN 'view'::"AccessLevel" END
FROM generate_series(1, 18) n;
INSERT INTO initiative (id, name, owner_user_id, share_permission_id, created_at, updated_at)
SELECT ('a7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Path ' || n,
    CASE WHEN n IN (2, 17) THEN 'macro|viewer@paths.test'
        WHEN n = 10 THEN 'macro|outsider@paths.test'
        ELSE 'macro|teammate@paths.test' END,
    'paths-share-' || n, '2026-01-01', '2026-01-01'::timestamptz + n * interval '1 hour'
FROM generate_series(1, 18) n;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
-- 1 direct grant, 2 the viewer's owner grant, 3 inherited from a folder.
('a7000000-0000-0000-0000-000000000001', 'initiative', 'macro|viewer@paths.test', 'user', 'view', NULL),
('a7000000-0000-0000-0000-000000000002', 'initiative', 'macro|viewer@paths.test', 'user', 'owner', NULL),
('a7000000-0000-0000-0000-000000000003', 'initiative', 'macro|viewer@paths.test', 'user', 'view', 'a3000000-0000-0000-0000-000000000001'),
-- 4 the viewer's channel, 5 a channel the viewer left, 6 the outsider's channel.
('a7000000-0000-0000-0000-000000000004', 'initiative', 'a5000000-0000-0000-0000-000000000001', 'channel', 'view', NULL),
('a7000000-0000-0000-0000-000000000005', 'initiative', 'a5000000-0000-0000-0000-000000000002', 'channel', 'view', NULL),
('a7000000-0000-0000-0000-000000000006', 'initiative', 'a5000000-0000-0000-0000-000000000003', 'channel', 'view', NULL),
-- 7 the viewer's team, 8 the outsider's team.
('a7000000-0000-0000-0000-000000000007', 'initiative', 'a6000000-0000-0000-0000-000000000001', 'team', 'edit', NULL),
('a7000000-0000-0000-0000-000000000008', 'initiative', 'a6000000-0000-0000-0000-000000000002', 'team', 'edit', NULL),
-- 12 a bot grant, 13 the bot's principal as a user source, 14 a channel only the bot is in.
('a7000000-0000-0000-0000-000000000012', 'initiative', 'bot|a4000000-0000-0000-0000-000000000001', 'bot', 'owner', NULL),
('a7000000-0000-0000-0000-000000000013', 'initiative', 'bot|a4000000-0000-0000-0000-000000000001', 'user', 'view', NULL),
('a7000000-0000-0000-0000-000000000014', 'initiative', 'a5000000-0000-0000-0000-000000000004', 'channel', 'view', NULL),
-- 15 a grant to the viewer on another entity type with the same id.
('a7000000-0000-0000-0000-000000000015', 'document', 'macro|viewer@paths.test', 'user', 'view', NULL),
-- 16 every path at once: it must take one row.
('a7000000-0000-0000-0000-000000000016', 'initiative', 'macro|viewer@paths.test', 'user', 'view', NULL),
('a7000000-0000-0000-0000-000000000016', 'initiative', 'a5000000-0000-0000-0000-000000000001', 'channel', 'view', NULL),
('a7000000-0000-0000-0000-000000000016', 'initiative', 'a6000000-0000-0000-0000-000000000001', 'team', 'view', NULL),
-- The loner's only grant, on the outsider's team-linked initiative.
('a7000000-0000-0000-0000-000000000010', 'initiative', 'macro|loner@paths.test', 'user', 'view', NULL);
-- 9, 10 and 17 have no grant to the viewer: only the owner's team link can show them.
-- 11 (public link) and 18 (nothing) are never listed.
