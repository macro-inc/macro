CREATE TABLE webhook (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NULL,
    owner_bot_id TEXT NULL,
    name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    signing_secret TEXT NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    rule JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CONSTRAINT webhook_status CHECK (status IN ('active', 'paused', 'disabled')),
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

CREATE INDEX webhook_events_gin_idx
    ON webhook USING GIN ((rule -> 'events'));

CREATE TABLE webhook_delivery (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhook(id),
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
    UNIQUE (webhook_id, event_id),
    CONSTRAINT webhook_delivery_attempt_count_non_negative CHECK (attempt_count >= 0),
    CONSTRAINT webhook_delivery_attempt_window_valid CHECK (
        first_attempt_at IS NULL
        OR last_attempt_at IS NULL
        OR last_attempt_at >= first_attempt_at
    )
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
    error_message TEXT NULL,
    UNIQUE (webhook_delivery_id, attempt_number),
    CONSTRAINT webhook_delivery_attempt_number_non_negative CHECK (attempt_number >= 0),
    CONSTRAINT webhook_delivery_attempt_duration_non_negative CHECK (
        duration_ms IS NULL OR duration_ms >= 0
    ),
    CONSTRAINT webhook_delivery_attempt_completed_after_started CHECK (
        completed_at IS NULL OR completed_at >= started_at
    )
);
