-- A closed stream keeps its row for a short grace period so a client that
-- reconnects right after the stream ended still gets the tail replayed.
-- NULL means the stream is still being written to.
ALTER TABLE active_streams ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
