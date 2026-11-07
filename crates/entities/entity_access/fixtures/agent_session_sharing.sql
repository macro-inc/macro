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
    ('60000000-0000-0000-0000-000000000003', 'agent_session', 'channel', 'channel', 'edit');
