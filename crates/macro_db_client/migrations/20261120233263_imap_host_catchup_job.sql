SET LOCAL lock_timeout = '5s';

-- Constant fast defaults: existing stream rows require no backfill or rewrite.
ALTER TABLE email_sync_streams
    ADD COLUMN notification_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN leased_notification_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN provider_retry_at TIMESTAMPTZ;

-- One worker-owned catch-up cursor for the fleet. No user/link FK is needed:
-- deleted and stale streams are skipped without retaining mailbox identifiers.
CREATE TABLE email_imap_host_catchup (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'startup' CHECK (mode IN ('startup', 'pending')),
    stream_after UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    startup_requested_at TIMESTAMPTZ DEFAULT now(),
    last_startup_completed_at TIMESTAMPTZ,
    cycle_started_at TIMESTAMPTZ,
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    batches BIGINT NOT NULL DEFAULT 0 CHECK (batches >= 0),
    streams_scanned BIGINT NOT NULL DEFAULT 0 CHECK (streams_scanned >= 0),
    streams_woken BIGINT NOT NULL DEFAULT 0 CHECK (streams_woken >= 0),
    streams_deferred BIGINT NOT NULL DEFAULT 0 CHECK (streams_deferred >= 0),
    streams_failed BIGINT NOT NULL DEFAULT 0 CHECK (streams_failed >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);

INSERT INTO email_imap_host_catchup (id) VALUES (1);
