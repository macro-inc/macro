SET LOCAL lock_timeout = '1s';

-- A person's own color for a calendar they can see, shown instead of the
-- provider's. Viewer-specific like calendar_availability_preferences: a
-- delegate and the inbox owner each choose their own. Provider sync writes only
-- calendars.color, so it never overwrites a choice made here.
CREATE TABLE calendar_color_preferences (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    color text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, calendar_id)
);

-- Removing an inbox deletes its calendars, and each delete cascades here.
CREATE INDEX calendar_color_preferences_calendar_id_idx
    ON calendar_color_preferences (calendar_id);
