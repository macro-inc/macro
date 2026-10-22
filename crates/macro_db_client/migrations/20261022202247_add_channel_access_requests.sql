-- One row per attempt to join a channel. Attempts are never reused, so each
-- timeline entry keeps showing the outcome of the attempt it announced.
CREATE TABLE comms_channel_access_request (
    id uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    requester_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
    created_at timestamptz NOT NULL,
    resolved_at timestamptz,
    resolved_by text REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- At most one open attempt per person and channel; concurrent submissions converge on it.
CREATE UNIQUE INDEX comms_channel_access_request_pending
    ON comms_channel_access_request (channel_id, requester_id) WHERE status = 'pending';

-- The requester's latest attempt decides cooldowns.
CREATE INDEX comms_channel_access_request_latest
    ON comms_channel_access_request (channel_id, requester_id, created_at DESC);
