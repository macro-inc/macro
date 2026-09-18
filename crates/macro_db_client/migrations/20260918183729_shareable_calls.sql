-- Calls can exist independently of a channel. Existing channel calls retain their FK.
ALTER TABLE calls ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE call_records ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE call_participants ADD COLUMN display_name TEXT;
ALTER TABLE call_record_participants ADD COLUMN display_name TEXT;

-- Meeting links survive standalone call sessions. Channel links are pinned to one
-- call id and never grant access to channel content or archived call records.
CREATE TABLE call_meetings (
    id UUID PRIMARY KEY,
    share_token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    channel_id UUID REFERENCES comms_channels(id) ON DELETE CASCADE,
    channel_call_id UUID UNIQUE,
    active_call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT meeting_schedule CHECK (
        (scheduled_start IS NULL AND scheduled_end IS NULL)
        OR (scheduled_start IS NOT NULL AND scheduled_end > scheduled_start)
    ),
    CONSTRAINT meeting_channel_call CHECK ((channel_id IS NULL) = (channel_call_id IS NULL))
);
CREATE INDEX call_meetings_user_id_created_at ON call_meetings(user_id, created_at DESC);
