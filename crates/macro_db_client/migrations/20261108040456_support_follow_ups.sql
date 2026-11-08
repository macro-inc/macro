-- A follow-up waiting to be sent in a new user's support channel. The
-- authentication service writes one after posting the welcome, sends it once
-- the user finishes onboarding or five minutes have passed, and then deletes
-- the row. `message_id` is minted with the row so a retried send reuses it.
CREATE TABLE support_follow_ups (
    channel_id    UUID PRIMARY KEY REFERENCES comms_channels (id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    message_id    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_until TIMESTAMPTZ
);
