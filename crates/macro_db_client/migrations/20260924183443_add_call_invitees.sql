-- Invitations make a live session discoverable without implying attendance.
-- Ending the session removes this access; a reused meeting link starts fresh.
CREATE TABLE call_invitees (
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    PRIMARY KEY (call_id, user_id)
);

-- Support account deletion without scanning every session's invitees.
CREATE INDEX call_invitees_user_id ON call_invitees(user_id);
