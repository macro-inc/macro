-- A follow-up waiting to be sent in a new user's support channel. The
-- authentication service writes one after posting the welcome, sends it once
-- it knows which message fits, and then deletes the row. `message_id` is
-- minted with the row so a retried send reuses it. `gmail_attempted_at` and
-- `checkout_opened_at` are set when the user starts connecting Gmail or opens
-- a checkout, so the follow-up knows what they tried without asking Google or
-- Stripe. Rows live about an hour, so the table stays small and needs no index
-- beyond its key.
CREATE TABLE support_follow_ups (
    channel_id         UUID PRIMARY KEY REFERENCES comms_channels (id) ON DELETE CASCADE,
    user_id            TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    message_id         UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_until      TIMESTAMPTZ,
    gmail_attempted_at TIMESTAMPTZ,
    checkout_opened_at TIMESTAMPTZ
);
