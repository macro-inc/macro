-- What a finished turn's reply shows, saved with its outcome so any replica
-- can post the reply again exactly, including after the one that watched the
-- turn has lost it.
ALTER TABLE agent_conversation_turns ADD COLUMN reply_segments JSONB;
