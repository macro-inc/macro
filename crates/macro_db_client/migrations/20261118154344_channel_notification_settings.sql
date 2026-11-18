-- A user's own notification choices for one channel. Each notification event
-- type is turned off, turned on (over the channel's sections), or follows the
-- sections; with no section setting either, it is on. Only channels with a
-- choice keep a row; a write that clears every choice deletes it, so code
-- that never reads this table behaves the same.
-- Mute and snooze stay in user_notification_item_unsubscribe; the two are
-- independent, so resuming a muted channel keeps these choices.
CREATE TABLE user_channel_notification_setting (
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES comms_channels (id) ON DELETE CASCADE,
    disabled_event_types TEXT[] NOT NULL DEFAULT '{}',
    enabled_event_types TEXT[] NOT NULL DEFAULT '{}',
    section_mute_override BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

-- Deleting a channel cascades through this index.
CREATE INDEX user_channel_notification_setting_channel_idx
    ON user_channel_notification_setting (channel_id);

COMMENT ON COLUMN user_channel_notification_setting.disabled_event_types IS
    'Notification event types this user does not receive for this channel, whatever its sections allow.';
COMMENT ON COLUMN user_channel_notification_setting.enabled_event_types IS
    'Notification event types this user receives for this channel, whatever its sections turn off.';
COMMENT ON COLUMN user_channel_notification_setting.section_mute_override IS
    'TRUE keeps the channel notifying while every section holding it is muted. Muting the channel itself still silences it.';
