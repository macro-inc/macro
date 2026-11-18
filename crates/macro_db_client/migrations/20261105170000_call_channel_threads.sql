-- A channel call's discussion is either its own thread on the call parent or a
-- thread in its channel, decided once when the call is created. Existing calls
-- keep their own thread and are not migrated.
-- Defer validation until this DDL transaction releases its stronger locks.
SET LOCAL lock_timeout = '5s';

ALTER TABLE call_entities
    ADD COLUMN discussion TEXT NOT NULL DEFAULT 'call_chat',
    ADD CONSTRAINT call_entities_discussion_check
        CHECK (discussion IN ('call_chat', 'channel_thread')) NOT VALID;

-- A call root is the message a channel thread hangs from; its row is the call.
ALTER TABLE comms_messages
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'message',
    ADD CONSTRAINT comms_messages_kind_check
        CHECK (kind IN ('message', 'call_root')) NOT VALID;
