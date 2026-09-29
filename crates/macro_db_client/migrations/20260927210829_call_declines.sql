-- Per-user declines of a ringing channel call. A row means the user declined
-- the call on one of their devices, so their other devices should stop
-- ringing. Rows live only as long as the active call: archiving deletes the
-- `calls` row and cascades here.

CREATE TABLE IF NOT EXISTS call_declines (
    call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    declined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, user_id)
);
