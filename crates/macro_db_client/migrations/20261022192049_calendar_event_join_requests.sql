-- A channel member who sees a calendar event only through a channel share
-- asks the person who shared it to add them as a guest. One request per
-- requester and event: asking again after a decline reopens the same row.
-- Rows go with the shared event and with the requester's account.
CREATE TABLE IF NOT EXISTS calendar_event_join_requests (
    id uuid PRIMARY KEY,
    -- The sharer's projection that was shared with the channel.
    event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    requester_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- The address the sharer invites: the requester's primary calendar inbox,
    -- else their Macro account address.
    requester_email text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    UNIQUE (event_id, requester_id)
);

CREATE INDEX IF NOT EXISTS calendar_event_join_requests_pending_idx
    ON calendar_event_join_requests (event_id, created_at, id)
    WHERE status = 'pending';
