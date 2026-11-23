SET LOCAL lock_timeout = '5s';

-- One global maintenance cursor, retained after completion for rollout evidence.
-- Cursor ids intentionally have no user/link foreign keys: deleted links are
-- skipped, and completed work clears the bounded pending list and current id.
CREATE TABLE email_reconciliation_provider_backfill (
    name TEXT PRIMARY KEY CHECK (name = 'v1'),
    phase TEXT NOT NULL DEFAULT 'scanning'
        CHECK (phase IN ('scanning', 'complete')),
    link_after UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    pending_links UUID[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(pending_links) <= 1000),
    current_link UUID,
    generation_after BIGINT NOT NULL DEFAULT -9223372036854775808,
    provider_id_after TEXT NOT NULL DEFAULT '',
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    link_rows_scanned BIGINT NOT NULL DEFAULT 0 CHECK (link_rows_scanned >= 0),
    message_rows_scanned BIGINT NOT NULL DEFAULT 0 CHECK (message_rows_scanned >= 0),
    rows_repaired BIGINT NOT NULL DEFAULT 0 CHECK (rows_repaired >= 0),
    batches BIGINT NOT NULL DEFAULT 0 CHECK (batches >= 0),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
    CHECK ((phase = 'complete') = (completed_at IS NOT NULL))
);

INSERT INTO email_reconciliation_provider_backfill (name)
VALUES ('v1')
ON CONFLICT (name) DO NOTHING;
