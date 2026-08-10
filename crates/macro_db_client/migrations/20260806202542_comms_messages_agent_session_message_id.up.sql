-- Placeholder comms rows were keyed per agent-session *turn*
-- ("{agent_session_id}:{turn}"), which collapsed a turn's prompt and its
-- reply onto a single row. A turn's two folded messages have different
-- authors, so one row could only ever carry one sender: the user's prompt had
-- no representation of its own unless it happened to also exist as an
-- ordinary comms message typed into the channel. Sessions whose prompts
-- arrive over ACP rather than through comms - recorded, replayed, or resumed
-- - rendered with the user's side missing entirely.
--
-- The key becomes the folded message id, "{agent_session_id}:{turn}:{author}"
-- where author is 'user' or 'agent', so every folded message gets its own row
-- and its own sender.
--
-- Placeholders carry no content: they are derived from agent_session_log by
-- the fold on every read. Dropping them loses nothing - the service's
-- sync_placeholders rebuilds them from the log.
DELETE FROM comms_messages WHERE agent_session_turn_id IS NOT NULL;

ALTER TABLE comms_messages
    RENAME COLUMN agent_session_turn_id TO agent_session_message_id;

ALTER INDEX comms_messages_agent_session_turn_unique
    RENAME TO comms_messages_agent_session_message_unique;

ALTER TABLE comms_messages
    RENAME CONSTRAINT comms_messages_content_or_turn_check
        TO comms_messages_content_or_message_check;
