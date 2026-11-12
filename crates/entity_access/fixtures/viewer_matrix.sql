-- Viewers for the source-list equality tests (`test_viewers::ViewerMatrix`):
-- every membership a source list held, and every source a grant can name.
--
-- matrix-owner   owns team A, is in team A's team channel; owns the items.
-- matrix-member  member of team A; in the private channel, the team channel
--                and bot A's direct conversation; left the left channel.
-- matrix-loner   no team; in the private channel.
-- matrix-other   owns team B.
-- bot A          active in team A; in the private channel, the team channel
--                and its direct conversation; left the left channel.
-- bot gone       deleted from team A; in the private channel.
-- bot B          active in team B; in channel B.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('7a000000-0000-0000-0000-000000000001', 'matrix-owner', 'matrix-owner@example.com', 'matrix-owner'),
('7a000000-0000-0000-0000-000000000002', 'matrix-member', 'matrix-member@example.com', 'matrix-member'),
('7a000000-0000-0000-0000-000000000003', 'matrix-loner', 'matrix-loner@example.com', 'matrix-loner'),
('7a000000-0000-0000-0000-000000000004', 'matrix-other', 'matrix-other@example.com', 'matrix-other');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|matrix-owner@example.com', 'matrix-owner@example.com', '7a000000-0000-0000-0000-000000000001'),
('macro|matrix-member@example.com', 'matrix-member@example.com', '7a000000-0000-0000-0000-000000000002'),
('macro|matrix-loner@example.com', 'matrix-loner@example.com', '7a000000-0000-0000-0000-000000000003'),
('macro|matrix-other@example.com', 'matrix-other@example.com', '7a000000-0000-0000-0000-000000000004');
INSERT INTO team (id, name, owner_id) VALUES
('7a000000-0000-0000-0000-00000000000a', 'Matrix team A', 'macro|matrix-owner@example.com'),
('7a000000-0000-0000-0000-00000000000b', 'Matrix team B', 'macro|matrix-other@example.com');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('7a000000-0000-0000-0000-00000000000a', 'macro|matrix-owner@example.com', 'owner'),
('7a000000-0000-0000-0000-00000000000a', 'macro|matrix-member@example.com', 'member'),
('7a000000-0000-0000-0000-00000000000b', 'macro|matrix-other@example.com', 'owner');
INSERT INTO bots (id, kind, team_id, name, handle, deleted_at) VALUES
('7a000000-0000-0000-0000-0000000000d1', 'owned', '7a000000-0000-0000-0000-00000000000a', 'Matrix bot A', 'matrix-bot-a', NULL),
('7a000000-0000-0000-0000-0000000000d2', 'owned', '7a000000-0000-0000-0000-00000000000a', 'Matrix bot gone', 'matrix-bot-gone', now()),
('7a000000-0000-0000-0000-0000000000d3', 'owned', '7a000000-0000-0000-0000-00000000000b', 'Matrix bot B', 'matrix-bot-b', NULL);
INSERT INTO comms_channels (id, name, channel_type, owner_id, team_id) VALUES
('7a000000-0000-0000-0000-0000000000c1', 'Private', 'private', 'macro|matrix-owner@example.com', NULL),
('7a000000-0000-0000-0000-0000000000c2', 'Left', 'private', 'macro|matrix-owner@example.com', NULL),
('7a000000-0000-0000-0000-0000000000c3', 'Team A', 'team', 'macro|matrix-owner@example.com', '7a000000-0000-0000-0000-00000000000a'),
('7a000000-0000-0000-0000-0000000000c4', 'Direct', 'private', 'macro|matrix-member@example.com', NULL),
('7a000000-0000-0000-0000-0000000000c5', 'Channel B', 'private', 'macro|matrix-other@example.com', NULL);
INSERT INTO comms_channel_agents (channel_id, bot_id, kind, user_id) VALUES
('7a000000-0000-0000-0000-0000000000c4', '7a000000-0000-0000-0000-0000000000d1', 'direct', 'macro|matrix-member@example.com');
INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at) VALUES
('7a000000-0000-0000-0000-0000000000c1', 'macro|matrix-member@example.com', 'member', NULL),
('7a000000-0000-0000-0000-0000000000c1', 'macro|matrix-loner@example.com', 'member', NULL),
('7a000000-0000-0000-0000-0000000000c1', 'bot|7a000000-0000-0000-0000-0000000000d1', 'member', NULL),
('7a000000-0000-0000-0000-0000000000c1', 'bot|7a000000-0000-0000-0000-0000000000d2', 'member', NULL),
('7a000000-0000-0000-0000-0000000000c2', 'macro|matrix-member@example.com', 'member', now()),
('7a000000-0000-0000-0000-0000000000c2', 'bot|7a000000-0000-0000-0000-0000000000d1', 'member', now()),
('7a000000-0000-0000-0000-0000000000c3', 'macro|matrix-owner@example.com', 'owner', NULL),
('7a000000-0000-0000-0000-0000000000c3', 'macro|matrix-member@example.com', 'member', NULL),
('7a000000-0000-0000-0000-0000000000c4', 'macro|matrix-member@example.com', 'owner', NULL),
('7a000000-0000-0000-0000-0000000000c4', 'bot|7a000000-0000-0000-0000-0000000000d1', 'member', NULL),
('7a000000-0000-0000-0000-0000000000c5', 'bot|7a000000-0000-0000-0000-0000000000d3', 'member', NULL);

-- Every source a grant can name, with the level the item fixtures grant it:
-- each user (and one with no rows), team, channel and bot, and a channel id
-- in uppercase, which names no one.
CREATE TABLE matrix_grant_source (
    source_id text PRIMARY KEY,
    source_type entity_access_source_type NOT NULL,
    level "AccessLevel" NOT NULL
);
INSERT INTO matrix_grant_source (source_id, source_type, level) VALUES
('macro|matrix-owner@example.com', 'user', 'owner'),
('macro|matrix-member@example.com', 'user', 'view'),
('macro|matrix-loner@example.com', 'user', 'comment'),
('macro|matrix-other@example.com', 'user', 'edit'),
('macro|matrix-stranger@example.com', 'user', 'view'),
('7a000000-0000-0000-0000-00000000000a', 'team', 'edit'),
('7a000000-0000-0000-0000-00000000000b', 'team', 'comment'),
('7a000000-0000-0000-0000-0000000000c1', 'channel', 'comment'),
('7a000000-0000-0000-0000-0000000000c2', 'channel', 'edit'),
('7a000000-0000-0000-0000-0000000000c3', 'channel', 'view'),
('7a000000-0000-0000-0000-0000000000c4', 'channel', 'edit'),
('7a000000-0000-0000-0000-0000000000c5', 'channel', 'view'),
('7A000000-0000-0000-0000-0000000000C1', 'channel', 'owner'),
('bot|7a000000-0000-0000-0000-0000000000d1', 'bot', 'comment'),
('bot|7a000000-0000-0000-0000-0000000000d2', 'bot', 'edit'),
('bot|7a000000-0000-0000-0000-0000000000d3', 'bot', 'view');

-- The item id a fixture derives for `kind` and a grant source: stable, and
-- distinct per kind so one family's items never collide with another's.
CREATE FUNCTION matrix_item(kind text, source_id text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$ SELECT md5(kind || ':' || source_id)::uuid $$;
