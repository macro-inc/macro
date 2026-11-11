SET LOCAL lock_timeout = '5s';

-- The app tab the person typed the running (or last) turn's prompt in, so
-- what the turn shows them reaches that tab only. Null for turns nobody
-- typed in a tab: routines, triggers, channel mentions and API prompts.
ALTER TABLE agent_session ADD COLUMN turn_prompter_client UUID;
