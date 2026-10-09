-- Additive: old Gmail readers/writers continue to work during deployment.
ALTER TYPE email_user_provider_enum ADD VALUE 'OUTLOOK';

ALTER TABLE microsoft_oauth_grants
    ADD COLUMN grant_id uuid UNIQUE,
    ADD COLUMN generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
    ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    ADD COLUMN tenant_id text,
    ADD COLUMN subject_id text,
    ADD COLUMN mailbox_id text,
    ADD COLUMN scopes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN revoked_at timestamptz,
    ADD COLUMN refresh_lease_id uuid,
    ADD COLUMN refresh_lease_until timestamptz;

-- Old pending Google links retain their meaning. Microsoft attempts are also
-- bound to the initiating principal, redirect, PKCE verifier, and OIDC nonce.
ALTER TABLE in_progress_user_link
    ADD COLUMN email_provider email_user_provider_enum NOT NULL DEFAULT 'GMAIL';

CREATE TABLE microsoft_link_attempts (
    id uuid PRIMARY KEY REFERENCES in_progress_user_link(id) ON DELETE CASCADE,
    identity_provider_id text NOT NULL,
    redirect_uri text NOT NULL,
    return_uri text,
    pkce_verifier text NOT NULL,
    oidc_nonce text NOT NULL,
    expires_at timestamptz NOT NULL,
    claimed_at timestamptz,
    completed_at timestamptz
);

ALTER TABLE email_links
    ADD COLUMN grant_id uuid,
    ADD COLUMN grant_generation bigint NOT NULL DEFAULT 0,
    ADD COLUMN sync_generation bigint NOT NULL DEFAULT 1 CHECK (sync_generation > 0);

CREATE TABLE email_mailbox_folders (
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    parent_id text,
    display_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('inbox','sent','drafts','archive','trash','junk','other')),
    catalog_generation bigint NOT NULL,
    deleted_at timestamptz,
    PRIMARY KEY (link_id, provider_id)
);

-- Lease fences prevent an expired worker from advancing a newer worker's cursor.
-- A page and the reconciliation work it describes are committed together.
CREATE TABLE email_sync_streams (
    id uuid PRIMARY KEY,
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('mail_folder','gmail_history','gmail_backfill','contacts','calendar')),
    scope_id text NOT NULL,
    position text,
    initial_complete boolean NOT NULL DEFAULT false,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    last_completed_at timestamptz,
    lease_id uuid,
    lease_until timestamptz,
    fence bigint NOT NULL DEFAULT 0,
    UNIQUE (link_id, generation, kind, scope_id)
);
CREATE INDEX email_sync_streams_due ON email_sync_streams (next_run_at);

CREATE TABLE email_message_reconciliation (
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    provider_id text NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    is_import boolean NOT NULL,
    available_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    lease_id uuid,
    lease_until timestamptz,
    PRIMARY KEY (link_id, generation, provider_id)
);
CREATE INDEX email_message_reconciliation_due ON email_message_reconciliation (available_at);

ALTER TABLE email_messages
    ADD COLUMN provider_folder_id text,
    ADD COLUMN provider_version text,
    ADD COLUMN mailbox_state jsonb,
    ADD COLUMN remote_draft_revision text;

CREATE TABLE email_provider_subscriptions (
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    provider_id text NOT NULL,
    client_state_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (link_id, generation),
    UNIQUE (provider_id)
);

-- A command's targets and send payload are frozen before any provider write.
CREATE TABLE email_mailbox_commands (
    id uuid PRIMARY KEY,
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    actor_id text NOT NULL,
    intent jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','running','confirming','succeeded','conflict','failed','unknown','cancelled')),
    provider_draft_id text,
    result jsonb,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_mailbox_commands_due ON email_mailbox_commands (available_at)
    WHERE status IN ('pending','running','confirming');
CREATE TABLE email_mailbox_command_targets (
    command_id uuid NOT NULL REFERENCES email_mailbox_commands(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','conflict','failed')),
    PRIMARY KEY (command_id, provider_id)
);

CREATE TABLE email_projection_outbox (
    id uuid PRIMARY KEY,
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    payload jsonb NOT NULL,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX email_projection_outbox_due ON email_projection_outbox (available_at);
