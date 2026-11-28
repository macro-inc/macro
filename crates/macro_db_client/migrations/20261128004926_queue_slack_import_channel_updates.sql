-- One pending snapshot hint per channel. A deleted channel has an empty
-- audience and is drained normally, so this needs no lock on comms_channels.
CREATE TABLE slack_import_channel_updates (
    channel_id uuid PRIMARY KEY,
    revision uuid NOT NULL,
    next_attempt_at timestamptz NOT NULL
);

CREATE INDEX idx_slack_import_channel_updates_due
    ON slack_import_channel_updates (next_attempt_at, channel_id);

-- Default false keeps already-running workers and completed old jobs on the
-- existing browser reconciliation while the new producer rolls out.
SET LOCAL lock_timeout = '1s';
ALTER TABLE slack_import_conversation
    ADD COLUMN channel_updates_queued boolean NOT NULL DEFAULT false;
