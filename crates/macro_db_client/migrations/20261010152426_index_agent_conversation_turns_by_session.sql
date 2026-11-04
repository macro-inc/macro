-- Claims, recovery and Start fresh look up one session's unfinished turns
-- while holding that session's advisory lock, so the lookup must not scan
-- every conversation's history.
CREATE INDEX agent_conversation_turns_session ON agent_conversation_turns(session_id, state, created_at, source_message_id);
