CREATE TABLE call_meeting_preparations (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    meeting_id UUID UNIQUE REFERENCES call_meetings(id) ON DELETE CASCADE
);
CREATE INDEX call_meeting_preparations_expiry ON call_meeting_preparations(expires_at);
