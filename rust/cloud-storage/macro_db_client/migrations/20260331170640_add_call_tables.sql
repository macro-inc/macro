-- Ephemeral tables for active calls (rows deleted when call ends via webhook)

CREATE TABLE IF NOT EXISTS calls (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    room_name   TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    egress_id   TEXT,
    recording_url TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT calls_one_per_channel UNIQUE (channel_id)
);

CREATE TABLE IF NOT EXISTS call_participants (
    call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at     TIMESTAMPTZ,
    PRIMARY KEY (call_id, user_id)
);

-- Ephemeral transcript segments for active calls (copied to call_record_transcripts on archive)

CREATE TABLE IF NOT EXISTS call_transcripts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id      UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    segment_id   TEXT NOT NULL,
    speaker_id   TEXT NOT NULL,
    content      TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    ended_at     TIMESTAMPTZ,
    sequence_num INT NOT NULL,
    CONSTRAINT call_transcripts_segment_unique UNIQUE (call_id, segment_id)
);

-- Permanent tables for call history (written on room_finished webhook)

CREATE TABLE IF NOT EXISTS call_records (
    id            UUID PRIMARY KEY,
    channel_id    UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    room_name     TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms   BIGINT NOT NULL,
    recording_url TEXT,
    egress_id     TEXT
);

CREATE TABLE IF NOT EXISTS call_record_participants (
    call_record_id UUID NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL,
    joined_at      TIMESTAMPTZ NOT NULL,
    left_at        TIMESTAMPTZ,
    PRIMARY KEY (call_record_id, user_id)
);

CREATE TABLE IF NOT EXISTS call_record_transcripts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_record_id  UUID NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
    segment_id      TEXT,
    speaker_id      TEXT NOT NULL,
    content         TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    sequence_num    INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_channel_id ON calls(channel_id);
CREATE INDEX IF NOT EXISTS idx_calls_room_name ON calls(room_name);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_call_id ON call_transcripts(call_id);
CREATE INDEX IF NOT EXISTS idx_call_records_channel_id ON call_records(channel_id);
CREATE INDEX IF NOT EXISTS idx_call_records_egress_id ON call_records(egress_id);
CREATE INDEX IF NOT EXISTS idx_call_record_transcripts_call_record_id ON call_record_transcripts(call_record_id);
