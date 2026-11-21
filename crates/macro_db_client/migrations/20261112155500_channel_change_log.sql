-- Per-channel message changes. Counter locks are taken last so their order is
-- the commit order; no foreign keys take a channel lock while one is held.
CREATE TABLE channel_change_counters (
    channel_id uuid PRIMARY KEY,
    seq bigint NOT NULL CHECK (seq >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
)
-- Every message write updates one row here; free space keeps those updates
-- on the row's own page.
WITH (fillfactor = 70);

CREATE TABLE channel_change_log (
    channel_id uuid NOT NULL,
    seq bigint NOT NULL CHECK (seq > 0),
    -- 1 message, 2 activity, 3 reset.
    kind smallint NOT NULL CHECK (kind BETWEEN 1 AND 3),
    message_id uuid,
    activity_id uuid,
    -- Retention removes a prefix even when transactions started out of order.
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (channel_id, seq),
    CHECK ((kind = 1) = (message_id IS NOT NULL)),
    CHECK ((kind = 2) = (activity_id IS NOT NULL))
);

CREATE INDEX channel_change_log_created_idx ON channel_change_log (created_at);
