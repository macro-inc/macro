CREATE TABLE event_ingestion (
    event_id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    event_schema_version INTEGER NOT NULL,
    source TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    ordering_key TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    matched_webhook_count INTEGER NOT NULL DEFAULT 0,
    error_kind TEXT NULL,
    error_message TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX event_ingestion_workspace_event_idx
    ON event_ingestion (workspace_id, event);

CREATE INDEX event_ingestion_ordering_key_idx
    ON event_ingestion (ordering_key);

CREATE TABLE webhook (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NULL,
    owner_bot_id TEXT NULL,
    name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    signing_secret TEXT NOT NULL,
    headers_encrypted JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'enabled',
    is_valid BOOLEAN NOT NULL DEFAULT false,
    paused_at TIMESTAMPTZ NULL,
    pause_reason TEXT NULL,
    last_success_at TIMESTAMPTZ NULL,
    last_failure_at TIMESTAMPTZ NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX webhook_workspace_status_idx
    ON webhook (workspace_id, status, is_valid);

CREATE TABLE webhook_rule (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL UNIQUE REFERENCES webhook(id),
    workspace_id TEXT NOT NULL,
    name TEXT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    rule JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX webhook_rule_workspace_idx
    ON webhook_rule (workspace_id);

CREATE INDEX webhook_rule_events_gin_idx
    ON webhook_rule USING GIN ((rule -> 'events'));

CREATE TABLE webhook_delivery (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhook(id),
    webhook_rule_id TEXT NULL REFERENCES webhook_rule(id),
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event TEXT NOT NULL,
    event_schema_version INTEGER NOT NULL,
    event_occurred_at TIMESTAMPTZ NOT NULL,
    event_entity_type TEXT NOT NULL,
    event_entity_id TEXT NOT NULL,
    event_ordering_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    request_url TEXT NOT NULL,
    request_headers_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_body JSONB NOT NULL,
    next_attempt_at TIMESTAMPTZ NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    first_attempt_at TIMESTAMPTZ NULL,
    last_attempt_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (webhook_id, event_id)
);

CREATE INDEX webhook_delivery_webhook_created_idx
    ON webhook_delivery (webhook_id, created_at);

CREATE INDEX webhook_delivery_status_next_attempt_idx
    ON webhook_delivery (status, next_attempt_at);

CREATE INDEX webhook_delivery_event_ordering_idx
    ON webhook_delivery (event_ordering_key);

CREATE TABLE webhook_delivery_attempt (
    id TEXT PRIMARY KEY,
    webhook_delivery_id TEXT NOT NULL REFERENCES webhook_delivery(id),
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL,
    duration_ms INTEGER NULL,
    response_status INTEGER NULL,
    response_headers_redacted JSONB NULL,
    response_body_preview TEXT NULL,
    error_kind TEXT NULL,
    error_message TEXT NULL
);
