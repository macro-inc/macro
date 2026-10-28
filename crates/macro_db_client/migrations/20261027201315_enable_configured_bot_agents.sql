-- Configured agents must be eligible for mention dispatch, regardless of harness.
UPDATE bots
SET has_agent = true
WHERE NOT has_agent
  AND EXISTS (SELECT 1 FROM agent_configs WHERE bot_id = bots.id);
