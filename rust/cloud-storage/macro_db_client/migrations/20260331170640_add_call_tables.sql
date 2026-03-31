-- Ephemeral tables for active calls (rows deleted when call ends via webhook)

CREATE TABLE calls (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    room_name   TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT calls_one_per_channel UNIQUE (channel_id)
);

CREATE TABLE call_participants (
    call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, user_id)
);

-- Permanent tables for call history (written on room_finished webhook)

CREATE TABLE call_records (
    id            UUID PRIMARY KEY,
    channel_id    UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    room_name     TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms   BIGINT NOT NULL,
    recording_url TEXT
);

CREATE TABLE call_record_participants (
    call_record_id UUID NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL,
    joined_at      TIMESTAMPTZ NOT NULL,
    left_at        TIMESTAMPTZ,
    PRIMARY KEY (call_record_id, user_id)
);

CREATE TABLE call_record_transcripts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_record_id  UUID NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
    speaker_id      TEXT NOT NULL,
    content         TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    sequence_num    INT NOT NULL
);

CREATE INDEX idx_calls_channel_id ON calls(channel_id);
CREATE INDEX idx_call_records_channel_id ON call_records(channel_id);
CREATE INDEX idx_call_record_transcripts_call_record_id ON call_record_transcripts(call_record_id);
