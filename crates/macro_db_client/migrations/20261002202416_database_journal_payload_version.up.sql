-- Format of the ops and inverse JSON payloads; independent of table version.
-- Existing rows and older writers use the original format (1). Its JSON shape
-- is unchanged, so older readers remain compatible during rolling deployment.
ALTER TABLE database_changes
    ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 1
    CHECK (payload_version > 0);
