-- The foreign key briefly locks its referenced table; fail fast rather than
-- queue writers behind a long transaction.
SET LOCAL lock_timeout = '3s';

-- A user's own notification settings for one Chat sidebar section, applied
-- at send time to every channel the section holds for that user, including
-- channels added later. A custom section (channel_label) is shared by its team
-- but these settings are personal. Built-in sections have no table of their
-- own, so they are named here. A channel notifies for a type when any of its
-- sections allows it, and is muted by its sections only when all of them are
-- muted; a section without a row allows everything and is unmuted.
CREATE TABLE user_channel_section_notification_setting (
    user_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    label_id UUID REFERENCES channel_label (id) ON DELETE CASCADE,
    built_in_section TEXT
        CHECK (built_in_section IN ('favorites', 'direct_messages', 'team_channels')),
    section_key TEXT GENERATED ALWAYS AS (
        COALESCE('label:' || label_id::text, built_in_section)
    ) STORED,
    disabled_event_types TEXT[] NOT NULL DEFAULT '{}',
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    snoozed_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_channel_section_notification_setting_one_section
        CHECK ((label_id IS NULL) <> (built_in_section IS NULL)),
    PRIMARY KEY (user_id, section_key)
);

-- Deleting a section cascades through this index.
CREATE INDEX user_channel_section_notification_setting_label_idx
    ON user_channel_section_notification_setting (label_id)
    WHERE label_id IS NOT NULL;

COMMENT ON COLUMN user_channel_section_notification_setting.disabled_event_types IS
    'Notification event types this section does not allow for its channels.';
COMMENT ON COLUMN user_channel_section_notification_setting.muted IS
    'TRUE mutes the section, until snoozed_until when that is set.';
