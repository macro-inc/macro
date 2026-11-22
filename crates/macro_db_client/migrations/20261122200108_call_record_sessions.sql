-- A scheduled meeting that empties and is rejoined before its scheduled end
-- stays one call. The record's own columns describe its first RTC session;
-- each later session is one row here.
SET LOCAL lock_timeout = '5s';

CREATE TABLE call_record_sessions (
    -- The session's RTC room: a UUID that is not the call id.
    room_name TEXT PRIMARY KEY,
    call_record_id UUID NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    egress_id TEXT,
    recording_key TEXT,
    preview_url TEXT,
    recording_started_at TIMESTAMPTZ,
    CHECK (ended_at >= started_at)
);

-- A record's sessions in order.
CREATE INDEX call_record_sessions_call_record_id
    ON call_record_sessions (call_record_id, started_at);

-- Late egress webhooks and the preview handler find a session by these.
CREATE INDEX call_record_sessions_egress_id
    ON call_record_sessions (egress_id) WHERE egress_id IS NOT NULL;
CREATE INDEX call_record_sessions_recording_key
    ON call_record_sessions (recording_key) WHERE recording_key IS NOT NULL;
