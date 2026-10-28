-- Per-email-link calendar change log. Every calendar write transaction bumps
-- its link's counter once and appends one row per changed event or calendar,
-- so clients holding a per-link watermark can replay exactly what they missed.
--
-- Neither table references email_links: the counter row is locked last in
-- every write transaction, and a foreign key check would make that flush wait
-- on a link row a concurrent disconnect holds FOR UPDATE. Rows for a deleted
-- link are invisible (visibility is resolved through email_links at read
-- time) and the retention job removes them.
CREATE TABLE calendar_change_counters (
    link_id uuid PRIMARY KEY,
    seq bigint NOT NULL CHECK (seq >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_change_log (
    link_id uuid NOT NULL,
    seq bigint NOT NULL CHECK (seq > 0),
    -- 1 upsert_event, 2 delete_event, 3 upsert_calendar, 4 delete_calendar
    kind smallint NOT NULL CHECK (kind BETWEEN 1 AND 4),
    event_id uuid,
    calendar_id uuid,
    -- clock_timestamp, not now(): rows are inserted after the counter lock is
    -- taken, so creation time follows seq within a link and retention always
    -- removes a prefix of each link's log.
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (link_id, seq),
    CHECK ((kind IN (1, 2)) = (event_id IS NOT NULL)),
    CHECK ((kind IN (3, 4)) = (calendar_id IS NOT NULL))
);

CREATE INDEX calendar_change_log_created_idx ON calendar_change_log (created_at);
