-- Before reverting service code, restore visibility of DM contexts that were
-- hidden after the default-off rollout gate was explicitly enabled.
UPDATE agent_session s SET list_hidden = FALSE
FROM agent_conversation_sessions c
JOIN comms_channel_agents a ON a.channel_id = c.channel_id AND a.bot_id = c.bot_id AND a.kind = 'direct'
WHERE s.id = c.session_id;
DROP TRIGGER agent_session_legacy_warm_write ON agent_session;
DROP FUNCTION agent_session_legacy_warm_write();
ALTER TABLE agent_session DROP COLUMN for_warming;
