-- Durable work ledger for CRM contact population.
--
-- A row is one mailbox's outstanding request to reconcile one correspondent
-- into its team's CRM. Mail ingestion and consent seeds upsert rows, and a
-- repeat request for the same pair merges into the pending row instead of
-- queueing again. A dedicated worker claims rows under a lease, taking turns
-- between mailboxes, so the work never enters the email backfill queue.

-- Both tables are new; their foreign keys briefly lock `email_links`.
SET LOCAL lock_timeout = '5s';

CREATE TABLE crm_population_requests (
    link_id UUID NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    contact_email TEXT NOT NULL,
    contact_name TEXT,
    first_at TIMESTAMPTZ NOT NULL,
    last_at TIMESTAMPTZ NOT NULL,
    is_sent BOOLEAN NOT NULL,
    -- Bumped by every request. A finished attempt deletes the row only while it
    -- still holds the generation it claimed, so a request that arrives during
    -- an attempt is never lost.
    generation BIGINT NOT NULL DEFAULT 1,
    -- First request since the row was last settled; bounds how long further
    -- requests may postpone the attempt.
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Earliest next attempt: the settling delay, a retry backoff, or the lease
    -- of the attempt in flight.
    due_at TIMESTAMPTZ NOT NULL,
    -- Lease of the attempt in flight, and the token its outcome must present.
    claimed_until TIMESTAMPTZ,
    attempts SMALLINT NOT NULL DEFAULT 0,
    -- Set once the attempts are spent; a parked row is never claimed.
    parked_at TIMESTAMPTZ,
    last_error TEXT,
    traceparent TEXT,
    PRIMARY KEY (link_id, contact_email)
);

-- Finds each mailbox's next due row, and the mailboxes that have pending rows.
CREATE INDEX crm_population_requests_due_idx
    ON crm_population_requests (link_id, due_at)
    WHERE parked_at IS NULL;

-- Counts one mailbox's attempts in flight.
CREATE INDEX crm_population_requests_claimed_idx
    ON crm_population_requests (link_id, claimed_until)
    WHERE claimed_until IS NOT NULL;

-- Counts the attempts in flight across all mailboxes: it reads the leases
-- that end after now, not every lease left in the index.
CREATE INDEX crm_population_requests_claimed_until_idx
    ON crm_population_requests (claimed_until)
    WHERE claimed_until IS NOT NULL;

-- A mailbox whose populations are failing. The row exists only while they
-- fail: the mailbox takes no work until `paused_until`, then one probe
-- attempt at a time, and its first success deletes the row.
CREATE TABLE crm_population_pauses (
    link_id UUID PRIMARY KEY REFERENCES email_links (id) ON DELETE CASCADE,
    failures INTEGER NOT NULL,
    paused_until TIMESTAMPTZ NOT NULL,
    last_error TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
