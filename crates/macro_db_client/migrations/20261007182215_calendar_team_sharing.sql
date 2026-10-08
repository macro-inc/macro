-- Sharing is a Macro read entitlement, independent of provider write access.
-- Missing rows deliberately mean busy_only, including existing users.
CREATE TABLE calendar_team_sharing (
    user_id text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    sharing text NOT NULL DEFAULT 'busy_only'
        CHECK (sharing IN ('all', 'busy_only', 'none')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- This controls personal availability, never which synced calendars are shared.
-- It is viewer-specific because a delegated calendar is not automatically personal.
CREATE TABLE calendar_availability_preferences (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    contributes_to_availability boolean NOT NULL,
    PRIMARY KEY (user_id, calendar_id)
);
