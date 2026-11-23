-- Agent permissions: channel administration (creating and deleting channels,
-- their name and picture, who is in them, join links, access requests and
-- channel bots) moved from the registry group `channels` to `channel_admin`,
-- each operation keeping its action. Copying every saved `channels:<action>`
-- rule to `channel_admin:<action>`, all five actions, keeps every moved
-- operation's effective state. The `channels` rows stay: messaging still uses
-- them. Operation (`tool`) rows are keyed by operation and need nothing.
-- The tables are small and used only behind the agent permissions flag.
SET LOCAL lock_timeout = '5s';

INSERT INTO agent_tool_permission (
    bot_id, kind, target, state, updated_by, via_agent, restriction_only, updated_at
)
SELECT
    bot_id,
    kind,
    'channel_admin:' || split_part(target, ':', 2),
    state,
    updated_by,
    via_agent,
    restriction_only,
    updated_at
FROM agent_tool_permission
WHERE kind = 'group_action' AND starts_with(target, 'channels:')
ON CONFLICT DO NOTHING;

INSERT INTO persona_tool_permission (
    user_id, persona_id, kind, target, state, via_agent, restriction_only, updated_at
)
SELECT
    user_id,
    persona_id,
    kind,
    'channel_admin:' || split_part(target, ':', 2),
    state,
    via_agent,
    restriction_only,
    updated_at
FROM persona_tool_permission
WHERE kind = 'group_action' AND starts_with(target, 'channels:')
ON CONFLICT DO NOTHING;

-- A session's restrictions on itself.
INSERT INTO agent_session_tool_permission (
    agent_session_id, kind, target, state, set_by, created_at
)
SELECT
    agent_session_id,
    kind,
    'channel_admin:' || split_part(target, ':', 2),
    state,
    set_by,
    created_at
FROM agent_session_tool_permission
WHERE kind = 'group_action' AND starts_with(target, 'channels:')
ON CONFLICT DO NOTHING;
