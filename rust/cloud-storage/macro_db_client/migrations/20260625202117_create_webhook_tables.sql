-- Webhooks V1: configuration tables only (`webhook` + `webhook_rule`).
--
-- Event ingestion, delivery, and delivery-attempt tables (`event_ingestion`,
-- `webhook_delivery`, `webhook_delivery_attempt`) are deferred to later phases
-- (see webhooks_plan.md). This migration only supports configuring a webhook
-- and its single rule.
--
-- IDs are prefixed, time-sortable TEXT (`wh_`/`whr_` over a uuid v7 body), so
-- they sort by creation time and are stored as TEXT everywhere.
--
-- The signing secret and any user-supplied custom headers are stored encrypted
-- at rest (AES-256-GCM, nonce-prefixed) in BYTEA columns and are never logged.

CREATE TABLE webhook (
    id                 TEXT        NOT NULL,
    -- Tenant boundary. Sourced from the authenticated user's organization and
    -- mirrors the `workspace_id` carried on the event envelope.
    workspace_id       TEXT        NOT NULL,

    owner_user_id      TEXT,
    owner_bot_id       TEXT,

    name               TEXT        NOT NULL,
    endpoint_url       TEXT        NOT NULL,

    -- AES-256-GCM ciphertext (12-byte nonce prefixed). Always present: a secret
    -- is generated when the webhook is created.
    secret_encrypted   BYTEA       NOT NULL,
    -- AES-256-GCM ciphertext of a JSON object of custom outbound headers.
    -- NULL when the webhook has no custom headers.
    headers_encrypted  BYTEA,

    status             TEXT        NOT NULL DEFAULT 'enabled',

    -- Auto-pause is evaluated from a rolling window of deliveries (future work);
    -- these columns record the current pause state for the API / support tools.
    paused_at          TIMESTAMPTZ,
    pause_reason       TEXT,

    last_success_at    TIMESTAMPTZ,
    last_failure_at    TIMESTAMPTZ,

    created_by_user_id TEXT        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ,

    CONSTRAINT webhook_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_status_check
        CHECK (status IN ('enabled', 'disabled', 'paused_due_to_failures', 'deleted'))
);

-- Lists/filters a workspace's live webhooks.
CREATE INDEX webhook_workspace_status_idx
    ON webhook (workspace_id, status)
    WHERE deleted_at IS NULL;

CREATE TABLE webhook_rule (
    id            TEXT        NOT NULL,
    -- One rule per webhook in V1 (enforced by the unique constraint below).
    webhook_id    TEXT        NOT NULL,
    workspace_id  TEXT        NOT NULL,

    name          TEXT,
    enabled       BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Typed rule definition, validated into Rust before being written. The
    -- subscribed event names live at `rule -> 'events'` and the filter tree at
    -- `rule -> 'filters'`; there is no separate event_types column.
    rule          JSONB       NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,

    CONSTRAINT webhook_rule_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_rule_webhook_id_unique UNIQUE (webhook_id),
    CONSTRAINT webhook_rule_webhook_id_fkey
        FOREIGN KEY (webhook_id) REFERENCES webhook (id) ON DELETE CASCADE
);

-- Event lookup on the (future) ingestion hot path. Event names live in
-- `rule -> 'events'`; query with: rule -> 'events' @> '["channel.message.created"]'::jsonb
CREATE INDEX webhook_rule_events_gin_idx
    ON webhook_rule USING GIN ((rule -> 'events'))
    WHERE enabled = TRUE AND deleted_at IS NULL;

CREATE INDEX webhook_rule_workspace_idx
    ON webhook_rule (workspace_id)
    WHERE enabled = TRUE AND deleted_at IS NULL;
