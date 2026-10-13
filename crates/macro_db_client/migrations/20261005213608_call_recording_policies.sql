-- Each person's call settings. A missing row records every kind of call,
-- shares each kind with its default audience, and allows being recorded in
-- one-on-ones.
--
-- One-on-ones are 1:1 meetings and huddles in a two-person direct message;
-- huddles are every other call started from a channel.
--
-- A sharing audience says who can open a call's recording, transcript and
-- notes once it ends: 'participants' (the people who joined), 'channel'
-- (everyone in its channel), 'invited' (everyone invited to it) or 'team'
-- (everyone on its host's team).
CREATE TABLE call_preferences (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    record_huddles BOOLEAN NOT NULL DEFAULT TRUE,
    record_one_on_ones BOOLEAN NOT NULL DEFAULT TRUE,
    record_internal_meetings BOOLEAN NOT NULL DEFAULT TRUE,
    record_external_meetings BOOLEAN NOT NULL DEFAULT TRUE,
    share_huddles TEXT NOT NULL DEFAULT 'channel'
        CHECK (share_huddles IN ('channel', 'team')),
    share_one_on_ones TEXT NOT NULL DEFAULT 'participants'
        CHECK (share_one_on_ones IN ('participants', 'team')),
    share_internal_meetings TEXT NOT NULL DEFAULT 'invited'
        CHECK (share_internal_meetings IN ('participants', 'invited', 'team')),
    share_external_meetings TEXT NOT NULL DEFAULT 'team'
        CHECK (share_external_meetings IN ('participants', 'invited', 'team')),
    -- Refuse being recorded or transcribed in one-on-ones, whoever hosts them.
    refuse_one_on_one_recording BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What a team's admins forbid for everyone on the team. A missing row
-- forbids nothing.
CREATE TABLE call_team_policies (
    team_id UUID PRIMARY KEY REFERENCES team (id) ON DELETE CASCADE,
    block_recording_huddles BOOLEAN NOT NULL DEFAULT FALSE,
    block_recording_one_on_ones BOOLEAN NOT NULL DEFAULT FALSE,
    block_recording_internal_meetings BOOLEAN NOT NULL DEFAULT FALSE,
    block_recording_external_meetings BOOLEAN NOT NULL DEFAULT FALSE,
    -- No call the team's members start from a channel, direct messages
    -- included, is shared with the team.
    block_huddle_sharing BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Set once a third person joins a standalone call that only the host's
-- teammates have joined, so it stops counting as a one-on-one.
ALTER TABLE calls ADD COLUMN has_more_than_two_participants BOOLEAN NOT NULL DEFAULT FALSE;

-- Set once someone from outside the host's team joins a standalone call, so the
-- external-meeting recording rules govern the rest of that session.
ALTER TABLE calls ADD COLUMN has_external_participants BOOLEAN NOT NULL DEFAULT FALSE;

-- Set when a standalone call starts its recorder. A call never starts a
-- second one, so a recording stopped for privacy is not resumed.
ALTER TABLE calls ADD COLUMN recorder_claimed BOOLEAN NOT NULL DEFAULT FALSE;

-- Set when a standalone call dispatches its transcriber, so it gets one.
ALTER TABLE calls ADD COLUMN transcriber_claimed BOOLEAN NOT NULL DEFAULT FALSE;

-- People in a live one-on-one who refuse being recorded or transcribed there,
-- so everyone in the call can be told why it is not recording.
ALTER TABLE calls ADD COLUMN one_on_one_recording_refused_by TEXT[] NOT NULL DEFAULT '{}';

-- A live standalone call is shared with everyone invited to it when it ends:
-- the people invited to the session and, among its calendar event's
-- attendees, those with Macro accounts.
ALTER TABLE calls ADD COLUMN share_with_invitees BOOLEAN NOT NULL DEFAULT FALSE;

-- Standalone calls now share with the team when their host's settings say so,
-- decided as people join. Calls already live started under the old rule that
-- they never share, so clear any intent they carry.
UPDATE calls SET share_with_team = FALSE WHERE channel_id IS NULL AND share_with_team;
