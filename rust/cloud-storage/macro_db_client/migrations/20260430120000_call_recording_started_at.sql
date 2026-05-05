-- Capture when the egress recording actually began so the frontend can
-- anchor transcript-to-audio sync against the real recording start (which
-- lags call creation by the LiveKit egress bootstrap window) rather than
-- against `started_at` (call creation time).

ALTER TABLE calls         ADD COLUMN recording_started_at TIMESTAMPTZ;
ALTER TABLE call_records  ADD COLUMN recording_started_at TIMESTAMPTZ;
