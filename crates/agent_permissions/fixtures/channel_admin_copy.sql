-- Rules saved before channel administration moved to `channel_admin`, one
-- `channel_admin` rule already saved (the copy must not replace it).
INSERT INTO agent_tool_permission (bot_id, kind, target, state, updated_by, via_agent, restriction_only, updated_at) VALUES
('91000000-0000-0000-0000-000000000021', 'group_action', 'channels:send', 'never', 'macro|perm-owner@example.com', false, false, '2026-01-02T03:04:05Z'),
('91000000-0000-0000-0000-000000000021', 'group_action', 'channels:read', 'ask', NULL, true, true, '2026-01-03T00:00:00Z'),
('91000000-0000-0000-0000-000000000021', 'group_action', 'channels:destroy', 'never', NULL, false, false, '2026-01-05T00:00:00Z'),
('91000000-0000-0000-0000-000000000021', 'group_action', 'channel_admin:destroy', 'ask', NULL, false, false, '2026-01-04T00:00:00Z'),
('91000000-0000-0000-0000-000000000021', 'group_action', 'email:send', 'never', NULL, false, false, '2026-01-05T00:00:00Z'),
('91000000-0000-0000-0000-000000000021', 'tool', 'storage.join_channel', 'ask', NULL, false, false, '2026-01-05T00:00:00Z');
INSERT INTO persona_tool_permission (user_id, persona_id, kind, target, state, via_agent, restriction_only, updated_at) VALUES
('macro|perm-owner@example.com', '91000000-0000-0000-0000-0000000000aa', 'group_action', 'channels:update', 'ask', true, true, '2026-02-01T00:00:00Z'),
('macro|perm-owner@example.com', '91000000-0000-0000-0000-0000000000aa', 'group_action', 'documents:destroy', 'never', false, false, '2026-02-01T00:00:00Z');
INSERT INTO agent_session_tool_permission (agent_session_id, kind, target, state, set_by, created_at) VALUES
('91000000-0000-0000-0000-000000000031', 'group_action', 'channels:create', 'never', 'macro|perm-other@example.com', '2026-03-01T00:00:00Z'),
('91000000-0000-0000-0000-000000000031', 'tool', 'storage.delete_channel', 'ask', NULL, '2026-03-01T00:00:00Z');
