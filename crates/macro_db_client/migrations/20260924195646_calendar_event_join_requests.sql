-- A channel member who sees a calendar event only through a channel share
-- asks the event's owner to add them as a guest. One request per requester
-- and event: asking again after a decline reopens the same row.
CREATE TABLE IF NOT EXISTS calendar_event_join_requests (
    id uuid PRIMARY KEY,
    -- The owner's projection that was shared with the channel.
    event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    requester_id text NOT NULL,
    -- The address the owner invites: the requester's primary calendar inbox,
    -- else their Macro account address.
    requester_email text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    UNIQUE (event_id, requester_id)
);

CREATE INDEX IF NOT EXISTS calendar_event_join_requests_pending_idx
    ON calendar_event_join_requests (event_id)
    WHERE status = 'pending';
