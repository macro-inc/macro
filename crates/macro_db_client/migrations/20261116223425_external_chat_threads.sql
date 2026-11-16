-- Threads: a reply in a thread names its root message. The chat timeline
-- leaves thread replies out unless they were also sent to the chat
-- (`thread_broadcast`); the thread page lists them. Providers without threads
-- never set either column.
SET lock_timeout = '5s';

ALTER TABLE external_chat_message ADD COLUMN thread_root uuid REFERENCES external_chat_message(id) ON DELETE SET NULL;
ALTER TABLE external_chat_message ADD COLUMN thread_broadcast boolean NOT NULL DEFAULT false;

-- Each viewer's read position in each thread, monotone like the chat's.
CREATE TABLE external_chat_thread_read_state (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    thread_root uuid NOT NULL REFERENCES external_chat_message(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES external_chat_message(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, thread_root)
);
CREATE INDEX external_chat_thread_read_state_chat ON external_chat_thread_read_state(chat_id);
CREATE INDEX external_chat_thread_read_state_root ON external_chat_thread_read_state(thread_root);
CREATE INDEX external_chat_thread_read_state_message ON external_chat_thread_read_state(message_id);
