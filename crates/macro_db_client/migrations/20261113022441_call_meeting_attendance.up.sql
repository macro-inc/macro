SET LOCAL lock_timeout = '5s';

-- Older native sessions never imply complete RTC participation evidence.
ALTER TABLE call_entities ADD COLUMN attendance_tracked BOOLEAN NOT NULL DEFAULT false;

-- Provider connection sessions, not token issuance or imported attendance artifacts.
CREATE TABLE call_rtc_attendance (
    call_id UUID NOT NULL REFERENCES call_entities(id) ON DELETE CASCADE,
    participant_sid TEXT NOT NULL CHECK (length(participant_sid) BETWEEN 1 AND 128),
    user_id TEXT,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ,
    PRIMARY KEY (call_id, participant_sid),
    CHECK (left_at >= joined_at)
);
