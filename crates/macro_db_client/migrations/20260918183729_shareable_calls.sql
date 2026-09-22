-- Calls can exist independently of a channel. Existing channel calls retain their FK.
ALTER TABLE calls ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE call_records ALTER COLUMN channel_id DROP NOT NULL;

-- Non-account guests are their own rows, never entries in the participant
-- tables: call_participants.user_id stays a Macro user id everywhere. A
-- guest's id doubles as its LiveKit participant identity.
CREATE TABLE call_guests (
    id UUID PRIMARY KEY,
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ
);
CREATE INDEX call_guests_call_id ON call_guests(call_id);

-- Archived copy, written once when the call archives.
CREATE TABLE call_record_guests (
    call_record_id UUID NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    display_name TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ,
    PRIMARY KEY (call_record_id, id)
);

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
        OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
    ),
    CONSTRAINT meeting_channel_call CHECK ((channel_id IS NULL) = (channel_call_id IS NULL))
);
CREATE INDEX call_meetings_user_id_created_at ON call_meetings(user_id, created_at DESC);
