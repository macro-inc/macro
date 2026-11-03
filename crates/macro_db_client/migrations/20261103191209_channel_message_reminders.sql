-- One private reminder per user and channel message.
-- The schedule lives on `reminder`; this row is which message it opens.
CREATE TABLE reminder_channel_message (
    reminder_id UUID PRIMARY KEY REFERENCES reminder (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    channel_id UUID NOT NULL,
    message_id UUID NOT NULL,
    thread_id UUID
);

CREATE UNIQUE INDEX reminder_channel_message_user_message
    ON reminder_channel_message (user_id, message_id);
