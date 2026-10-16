-- Account mappings are retained on disconnect. Reconnecting cannot transfer a
-- provider account to another team, and credentials never grant channel access.
CREATE TABLE meta_messaging_connection (
    id uuid PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('whatsapp', 'instagram')),
    account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 512),
    business_account_id text,
    display_name text NOT NULL,
    credential bytea,
    credential_expires_at timestamptz,
    status text NOT NULL CHECK (status IN ('connecting', 'connected', 'disconnected', 'revoked', 'error')),
    human_agent_approved boolean NOT NULL DEFAULT false,
    developer_account boolean NOT NULL DEFAULT false,
    history_status text NOT NULL DEFAULT 'not_requested'
        CHECK (history_status IN ('not_requested', 'pending', 'syncing', 'complete', 'declined', 'failed')),
    history_progress smallint CHECK (history_progress BETWEEN 0 AND 100),
    health_error text,
    connected_at timestamptz,
    checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider, account_id),
    UNIQUE(id, team_id),
    CHECK (status <> 'connected' OR credential IS NOT NULL)
);
CREATE INDEX meta_messaging_connection_team_idx ON meta_messaging_connection(team_id, id);

CREATE FUNCTION preserve_meta_connection_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.id, NEW.team_id, NEW.provider, NEW.account_id) IS DISTINCT FROM
       (OLD.id, OLD.team_id, OLD.provider, OLD.account_id) THEN
        RAISE EXCEPTION 'messaging account identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_meta_connection_identity BEFORE UPDATE ON meta_messaging_connection
    FOR EACH ROW EXECUTE FUNCTION preserve_meta_connection_identity();

CREATE TABLE meta_messaging_oauth (
    state_sha256 bytea PRIMARY KEY CHECK (octet_length(state_sha256) = 32),
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('whatsapp', 'instagram')),
    reconnect_id uuid REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meta_messaging_oauth_expiry_idx ON meta_messaging_oauth(expires_at);

CREATE TABLE meta_messaging_conversation (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    channel_id uuid NOT NULL UNIQUE REFERENCES comms_channels(id) ON DELETE CASCADE,
    customer_display_name text,
    customer_phone text,
    customer_handle text,
    external_sender_id uuid NOT NULL,
    last_customer_message_at timestamptz,
    standard_window_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id, customer_id)
);

-- Acknowledged webhooks survive restarts. The hash deduplicates exact envelopes;
-- per-message/status keys below arbitrate overlaps across different envelopes.
CREATE TABLE meta_messaging_receipt (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('whatsapp', 'instagram')),
    body_sha256 bytea NOT NULL CHECK (octet_length(body_sha256) = 32),
    payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 4194304),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
    attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider, body_sha256)
);
CREATE INDEX meta_messaging_receipt_work_idx ON meta_messaging_receipt(available_at, id)
    WHERE status IN ('pending', 'processing');

CREATE TABLE meta_messaging_message (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    provider_message_id text NOT NULL,
    message_id uuid NOT NULL UNIQUE REFERENCES comms_messages(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    provenance text NOT NULL CHECK (provenance IN ('customer', 'macro_reply', 'phone_echo', 'onboarding_history')),
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    provider_timestamp timestamptz NOT NULL,
    reply_to_id text,
    delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'sending', 'unknown', 'accepted', 'sent', 'delivered', 'read', 'failed')),
    media_state text NOT NULL DEFAULT 'none' CHECK (media_state IN ('none', 'pending', 'stored', 'missing', 'unsupported', 'failed')),
    provider_type text NOT NULL,
    event_published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id, provider_message_id),
    FOREIGN KEY(connection_id, customer_id) REFERENCES meta_messaging_conversation(connection_id, customer_id) ON DELETE CASCADE
);
CREATE INDEX meta_messaging_message_events_idx ON meta_messaging_message(created_at, message_id)
    WHERE provenance = 'customer' AND event_published_at IS NULL;

-- Statuses may precede the corresponding message/HTTP response. Retain them
-- independently and reconcile by provider ID, never by arrival order.
CREATE TABLE meta_messaging_status (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    provider_message_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('sent', 'delivered', 'read', 'failed')),
    occurred_at timestamptz NOT NULL,
    error_code text,
    PRIMARY KEY(connection_id, provider_message_id, state)
);

CREATE TABLE meta_messaging_send (
    id uuid PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 1048576),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'unknown', 'accepted', 'sent', 'delivered', 'read', 'failed')),
    provider_message_id text,
    message_id uuid REFERENCES comms_messages(id) ON DELETE SET NULL,
    attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(channel_id, user_id, idempotency_key),
    UNIQUE(connection_id, provider_message_id)
);
CREATE INDEX meta_messaging_send_work_idx ON meta_messaging_send(available_at, id)
    WHERE state IN ('pending', 'sending');

