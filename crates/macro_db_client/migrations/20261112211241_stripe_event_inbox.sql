-- The Stripe event inbox (crates/stripe_inbox): every verified webhook event,
-- per-consumer cursors that apply them in order per customer, the newest
-- snapshot held of each subscription and customer, and the daily audit.
-- All tables are new, so nothing here locks an existing one.

CREATE TYPE stripe_consumer AS ENUM (
    'personal_plan',
    'team_subscription',
    'ai_credits',
    'computers',
    'analytics',
    'gtm'
);

CREATE TYPE stripe_cursor_state AS ENUM ('idle', 'dirty', 'failing', 'dead');

CREATE TYPE stripe_object_kind AS ENUM ('subscription', 'customer');

CREATE TYPE stripe_audit_mismatch_kind AS ENUM (
    'missing_event',
    'unconsumed_event_type',
    'stale_snapshot',
    'team_billing',
    'personal_plan'
);

-- One row per received event; the primary key dedupes redeliveries.
CREATE TABLE stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    api_version TEXT NOT NULL,
    livemode BOOLEAN NOT NULL,
    -- event.created, whole seconds
    created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- the customer (cus_…), or the object id when the event names none
    ordering_key TEXT NOT NULL,
    object_id TEXT NOT NULL,
    -- the verified body; cleared after 30 days
    payload JSONB,
    -- the webhook span, so applying links to its trace
    traceparent TEXT
);

CREATE INDEX stripe_events_ordering_idx ON stripe_events (ordering_key, created_at, id);
CREATE INDEX stripe_events_object_idx ON stripe_events (object_id, created_at, id);
CREATE INDEX stripe_events_created_idx ON stripe_events (created_at);
-- Retention clears payloads older than 30 days; this keeps it off the rows
-- it already cleared.
CREATE INDEX stripe_events_payload_idx ON stripe_events (created_at) WHERE payload IS NOT NULL;

-- How far each consumer has got for one ordering key: the unit of ordering,
-- leasing and retry.
CREATE TABLE stripe_event_cursor (
    consumer stripe_consumer NOT NULL,
    ordering_key TEXT NOT NULL,
    applied_at TIMESTAMPTZ,
    applied_event_id TEXT,
    state stripe_cursor_state NOT NULL DEFAULT 'dirty',
    -- bumped by every received event, so a release can tell one arrived
    generation BIGINT NOT NULL DEFAULT 0,
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by UUID,
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    dead_event_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, ordering_key)
);

CREATE INDEX stripe_event_cursor_ready_idx ON stripe_event_cursor (next_attempt_at)
    WHERE state IN ('dirty', 'failing');

-- The newest snapshot held of each Stripe object, from an event or an API
-- read; replaces per-event retrieves.
CREATE TABLE stripe_objects (
    id TEXT PRIMARY KEY,
    kind stripe_object_kind NOT NULL,
    customer_id TEXT,
    snapshot JSONB NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT false,
    -- null when it came from an API read
    source_event_id TEXT,
    -- event.created, or the time of the API read
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stripe_objects_customer_idx ON stripe_objects (customer_id, kind);

-- Customers whose subscriptions were all listed from Stripe once, so the
-- snapshots also hold subscriptions older than the inbox.
CREATE TABLE stripe_customer_listing (
    customer_id TEXT PRIMARY KEY,
    listed_at TIMESTAMPTZ NOT NULL
);

-- The daily audit's lease: one row, claimed by one replica per run.
CREATE TABLE stripe_audit_run (
    name TEXT PRIMARY KEY,
    run_id UUID,
    locked_by UUID,
    locked_until TIMESTAMPTZ,
    last_started_at TIMESTAMPTZ,
    last_finished_at TIMESTAMPTZ
);

INSERT INTO stripe_audit_run (name) VALUES ('daily');

-- Audit findings, kept as long as events. Never acted on automatically.
CREATE TABLE stripe_audit_mismatch (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    kind stripe_audit_mismatch_kind NOT NULL,
    object_id TEXT NOT NULL,
    stripe_value JSONB,
    macro_value JSONB,
    found_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stripe_audit_mismatch_run_idx ON stripe_audit_mismatch (run_id);
CREATE INDEX stripe_audit_mismatch_found_idx ON stripe_audit_mismatch (found_at);
