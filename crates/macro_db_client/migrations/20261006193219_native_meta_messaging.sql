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
    whatsapp_mode text CHECK (whatsapp_mode IN ('coexistence','platform')),
    registration_status text CHECK (registration_status IN ('required','unconfirmed','registered','rate_limited','unavailable')),
    registration_attempted_at timestamptz,
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
    kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct','group')),
    group_status text CHECK (group_status IN ('active','suspended','deleted')),
    group_status_at timestamptz,
    group_subject_at timestamptz,
    group_invite_link text,
    channel_id uuid NOT NULL UNIQUE REFERENCES comms_channels(id) ON DELETE CASCADE,
    customer_display_name text,
    customer_phone text,
    customer_phone_at timestamptz,
    customer_handle text,
    external_sender_id uuid NOT NULL,
    last_customer_message_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id, kind, customer_id),
    CHECK ((kind='direct' AND group_status IS NULL AND group_invite_link IS NULL) OR (kind='group' AND group_status IS NOT NULL))
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
    decode_failures integer NOT NULL DEFAULT 0 CHECK (decode_failures >= 0),
    completed_at timestamptz,
    payload_cleared_at timestamptz,
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
    conversation_kind text NOT NULL DEFAULT 'direct',
    sender_customer_id text,
    provenance text NOT NULL CHECK (provenance IN ('customer', 'macro_reply', 'phone_echo', 'onboarding_history')),
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'sending', 'unknown', 'accepted', 'sent', 'delivered', 'read', 'failed')),
    media_state text NOT NULL DEFAULT 'none' CHECK (media_state IN ('none', 'pending', 'stored', 'missing', 'unsupported', 'failed')),
    effect_revision bigint NOT NULL DEFAULT 1,
    published_revision bigint NOT NULL DEFAULT 0,
    native_retry_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id, provider_message_id),
    FOREIGN KEY(connection_id, conversation_kind, customer_id) REFERENCES meta_messaging_conversation(connection_id, kind, customer_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Statuses may precede the corresponding message/HTTP response. Retain them
-- independently and reconcile by provider ID, never by arrival order.
CREATE TABLE meta_messaging_status (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    provider_message_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('sent', 'delivered', 'read', 'failed')),
    PRIMARY KEY(connection_id, provider_message_id, state)
);

CREATE TABLE meta_messaging_send (
    id uuid PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    idempotency_key uuid NOT NULL,
    dispatch_started_at timestamptz,
    native_retry_at timestamptz NOT NULL DEFAULT now(),
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
    CHECK (state <> 'sending' OR (lease_id IS NOT NULL AND lease_until IS NOT NULL)),
    UNIQUE(channel_id, user_id, idempotency_key),
    UNIQUE(connection_id, provider_message_id)
);
CREATE INDEX meta_messaging_send_work_idx ON meta_messaging_send(available_at, id)
    WHERE state IN ('pending', 'sending');


CREATE TABLE meta_messaging_attachment (
    connection_id uuid NOT NULL,
    provider_message_id text NOT NULL,
    ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
    document_id uuid NOT NULL UNIQUE,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','stored')),
    lease_id uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id,provider_message_id,ordinal),
    FOREIGN KEY(connection_id,provider_message_id)
        REFERENCES meta_messaging_message(connection_id,provider_message_id) ON DELETE CASCADE
);

CREATE TABLE meta_messaging_history_import (
    connection_id uuid PRIMARY KEY REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    connected_at timestamptz NOT NULL,
    user_id text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL CHECK (status IN ('pending','syncing','complete','declined','failed')),
    step text NOT NULL CHECK (step IN ('contacts','contacts_requested','messages','waiting','instagram')),
    cursor text,
    progress smallint CHECK (progress BETWEEN 0 AND 100),
    error_code text,
    unavailable_media boolean NOT NULL DEFAULT false,
    attempts smallint NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meta_messaging_history_import_work ON meta_messaging_history_import(available_at)
    WHERE status IN ('pending','syncing') AND step <> 'waiting';

CREATE INDEX meta_messaging_connection_business_idx
    ON meta_messaging_connection (provider, business_account_id)
    WHERE business_account_id IS NOT NULL;


CREATE INDEX meta_messaging_native_effect_retry_idx
    ON meta_messaging_message(native_retry_at, created_at, message_id)
    WHERE published_revision < effect_revision;
CREATE INDEX meta_messaging_native_send_retry_idx
    ON meta_messaging_send(native_retry_at, id)
    WHERE provider_message_id IS NOT NULL
        AND state IN ('accepted', 'sent', 'delivered', 'read', 'failed');

CREATE TABLE meta_messaging_revision (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    provider_message_id text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    edit_number bigint NOT NULL DEFAULT 0 CHECK (edit_number BETWEEN 0 AND 4294967295),
    content text CHECK (octet_length(content) <= 65536),
    edited_at timestamptz,
    deleted_at timestamptz,
    PRIMARY KEY (connection_id, customer_id, provider_message_id)
);

CREATE INDEX meta_messaging_send_conversation_order_idx
    ON meta_messaging_send (connection_id, channel_id, created_at, id)
    WHERE state IN ('pending', 'sending');
CREATE INDEX meta_messaging_send_active_lease_idx
    ON meta_messaging_send (lease_until, id) WHERE state = 'sending';


CREATE INDEX meta_messaging_send_expiry_idx ON meta_messaging_send(created_at,id)
    WHERE state='pending' OR (state='sending' AND dispatch_started_at IS NULL);

CREATE INDEX meta_messaging_receipt_retention_idx ON meta_messaging_receipt(created_at,id)
    WHERE payload_cleared_at IS NULL;
CREATE INDEX meta_messaging_receipt_completed_retention_idx ON meta_messaging_receipt(completed_at,id)
    WHERE status='complete' AND decode_failures=0 AND payload_cleared_at IS NULL;
CREATE INDEX meta_messaging_receipt_metadata_retention_idx ON meta_messaging_receipt(created_at,id)
    WHERE payload_cleared_at IS NOT NULL;

CREATE TABLE meta_messaging_customer_alias (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    identifier text NOT NULL,
    customer_id text NOT NULL,
    PRIMARY KEY (connection_id, identifier)
);

-- Native policy marker is owned/read by channels, messages and calls. Creation
-- sets it in the same transaction as the private channel and pending binding.
ALTER TABLE comms_channels ADD COLUMN messaging_binding text NOT NULL DEFAULT 'native'
    CHECK (messaging_binding IN ('native','whatsapp_direct','instagram_direct','whatsapp_group'));

-- Only the current unbound attempt is retained. No operation history or tombstone.
CREATE TABLE meta_messaging_group_setup (
    channel_id uuid PRIMARY KEY REFERENCES comms_channels(id) ON DELETE CASCADE,
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    subject text NOT NULL,
    state text NOT NULL CHECK (state IN ('creating','pending','failed','unknown')),
    attempt_id uuid NOT NULL,
    generation timestamptz,
    request_id text,
    error_code text,
    started_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id,request_id)
);

-- Keep departed people for stable authorship; membership facts use source time.
CREATE TABLE meta_messaging_group_participant (
    channel_id uuid NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    external_sender_id uuid NOT NULL,
    display_name text,
    username text,
    phone text,
    active boolean NOT NULL,
    membership_at timestamptz NOT NULL,
    profile_at timestamptz NOT NULL,
    PRIMARY KEY(channel_id,customer_id)
);
