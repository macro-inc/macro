-- The foreign keys briefly lock their referenced tables; fail fast rather than
-- queue writers behind a long transaction.
SET LOCAL lock_timeout = '3s';

-- A user's own notification settings for one channel. A channel either
-- follows its Chat sections for every notification event type, or has its
-- own settings for all of them, replacing its sections'. Only channels with a
-- setting keep a row; a write that clears every setting deletes it, so code
-- that never reads this table behaves the same.
-- Mute and snooze stay in user_notification_item_unsubscribe; the two are
-- independent, so resuming a muted channel keeps these choices.
CREATE TABLE user_channel_notification_setting (
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES comms_channels (id) ON DELETE CASCADE,
    disabled_event_types TEXT[],
    section_mute_override BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

-- Deleting a channel cascades through this index.
CREATE INDEX user_channel_notification_setting_channel_idx
    ON user_channel_notification_setting (channel_id);

COMMENT ON COLUMN user_channel_notification_setting.disabled_event_types IS
    'NULL: the channel follows its sections. Otherwise the channel''s own settings: these event types are off and every other is on, whatever its sections say.';
COMMENT ON COLUMN user_channel_notification_setting.section_mute_override IS
    'TRUE keeps the channel notifying while every section holding it is muted. Muting the channel itself still silences it.';
