-- Per-channel change log. Every transaction that changes a channel's messages
-- bumps the channel's counter once and appends one row per changed message,
-- so a client holding the channel's sequence number can ask for exactly what
-- it missed instead of refetching pages. Timeline activity (renames, joins,
-- ended calls) is appended by the activity consumer after it stores the fact.
--
-- The counter row goes with its channel. A message write already holds a key
-- share lock on the channel row (its own foreign key) when it reaches the
-- counter, so the reference adds no wait, and it is only checked when the
-- channel's first change inserts the row. The log has no reference: a deleted
-- channel's rows are unreachable (reads authorize against the channel first)
-- and retention removes them by age, which keeps channel deletion from
-- cascading through a long log.
CREATE TABLE comms_channel_change_counters (
    channel_id uuid PRIMARY KEY REFERENCES comms_channels (id) ON DELETE CASCADE,
    seq bigint NOT NULL CHECK (seq >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comms_channel_change_log (
    channel_id uuid NOT NULL,
    seq bigint NOT NULL CHECK (seq > 0),
    -- 1 message (created, edited, deleted, reacted to), 2 history imported
    -- (holders of an older sequence number start over), 3 timeline activity
    kind smallint NOT NULL CHECK (kind BETWEEN 1 AND 3),
    message_id uuid,
    -- The message's thread root; the message itself when it is a root.
    root_id uuid,
    activity_id uuid,
    -- clock_timestamp, not now(): rows are inserted after the counter lock is
    -- taken, so creation time follows seq within a channel and retention
    -- always removes a prefix of each channel's log.
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (channel_id, seq),
    CHECK ((kind = 1) = (message_id IS NOT NULL)),
    CHECK ((kind = 1) = (root_id IS NOT NULL)),
    CHECK ((kind = 3) = (activity_id IS NOT NULL))
);

CREATE INDEX comms_channel_change_log_created_idx ON comms_channel_change_log (created_at);
