-- Link-preview URLs the sender removed from a message ("remove preview"),
-- hidden for every participant.
ALTER TABLE comms_messages
    ADD COLUMN suppressed_preview_urls TEXT[] NOT NULL DEFAULT '{}';
