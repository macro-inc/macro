-- The Claude Cloud demo harness is gone. Forget every stored subscription
-- grant, and move agents that ran on it onto Macro's built-in runtime with its
-- default model so they keep answering instead of routing nowhere.
DROP TABLE claude_oauth_grants;

UPDATE agent_configs
SET harness = 'in-memory',
    default_model = 'anthropic/claude-sonnet-5-5',
    updated_at = now()
WHERE harness = 'claude-cloud';

-- The @claude system bot went with it; take it out of every channel it joined.
DELETE FROM comms_channel_participants
WHERE user_id = 'bot|00000000-0000-0000-0000-00000000c1a0';
