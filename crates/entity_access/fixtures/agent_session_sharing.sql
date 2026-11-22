INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
    ('session-private', NULL, NULL),
    ('session-public', 'PUBLIC', 'view'),
    ('session-public-no-level', 'PUBLIC', NULL),
    ('session-team', 'TEAM', 'comment');

INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, share_permission_id) VALUES
    ('60000000-0000-0000-0000-000000000001', 'macro|owner@team.com', '00000000-0000-0000-0000-00000000a9e7', 'model', 'harness', '/workspace', NULL),
    ('60000000-0000-0000-0000-000000000002', 'macro|owner@team.com', '00000000-0000-0000-0000-00000000a9e7', 'model', 'harness', '/workspace', 'session-private'),
    ('60000000-0000-0000-0000-000000000003', 'macro|owner@team.com', '00000000-0000-0000-0000-00000000a9e7', 'model', 'harness', '/workspace', 'session-public'),
    ('60000000-0000-0000-0000-000000000004', 'macro|owner@team.com', '00000000-0000-0000-0000-00000000a9e7', 'model', 'harness', '/workspace', 'session-public-no-level'),
    ('60000000-0000-0000-0000-000000000005', 'macro|owner@team.com', '00000000-0000-0000-0000-00000000a9e7', 'model', 'harness', '/workspace', 'session-team');

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
    ('60000000-0000-0000-0000-000000000003', 'agent_session', 'macro|owner@team.com', 'user', 'owner'),
    ('60000000-0000-0000-0000-000000000003', 'agent_session', '00000000-0000-0000-0000-0000000ec001', 'channel', 'edit');

-- Viewers: a member of the owner's team, a member of the other team, and a
-- user in no team who is in the channel holding the edit grant above.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-0000-0000-0000000ec0a1', 'session_teammate', 'session-teammate@example.com', 'cus_session_teammate'),
    ('00000000-0000-0000-0000-0000000ec0a2', 'session_other_team', 'session-other-team@example.com', 'cus_session_other_team'),
    ('00000000-0000-0000-0000-0000000ec0a3', 'session_channel_member', 'session-channel-member@example.com', 'cus_session_channel_member');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|session-teammate@example.com', 'session-teammate@example.com', '00000000-0000-0000-0000-0000000ec0a1'),
    ('macro|session-other-team@example.com', 'session-other-team@example.com', '00000000-0000-0000-0000-0000000ec0a2'),
    ('macro|session-channel-member@example.com', 'session-channel-member@example.com', '00000000-0000-0000-0000-0000000ec0a3');
INSERT INTO team_user (user_id, team_id, team_role) VALUES
    ('macro|session-teammate@example.com', '00000000-0000-0000-0000-0000000ea001', 'member'),
    ('macro|session-other-team@example.com', '00000000-0000-0000-0000-0000000ea002', 'member');
INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES
    ('00000000-0000-0000-0000-0000000ec001', 'Session channel', 'private', 'macro|session-channel-member@example.com');
INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES
    ('00000000-0000-0000-0000-0000000ec001', 'macro|session-channel-member@example.com', 'member');
