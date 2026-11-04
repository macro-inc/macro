-- Setup failures in a row; setup stops retrying at a cap until the user
-- reconnects.
ALTER TABLE dialpad_sync_connections
    ADD COLUMN setup_attempts INTEGER NOT NULL DEFAULT 0;
