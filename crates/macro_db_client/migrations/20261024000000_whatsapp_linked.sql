-- Personal WhatsApp accounts linked as devices. Accounts belong to people;
-- adopted groups are independently shared entities within a workspace.
SET lock_timeout = '5s';

-- One account row per person, reused across reconnects and explicit replacements.
-- generation counts explicit consent; lease_epoch fences the session-service
-- replica that currently runs the account and is bumped on every takeover.
CREATE TABLE whatsapp_linked_account (
    id uuid PRIMARY KEY,
    user_id text NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE CASCADE,
    identity_jid text UNIQUE CHECK (identity_jid ~ '^[0-9]+@s[.]whatsapp[.]net$'),
    state text NOT NULL CHECK (state IN ('pairing', 'connected', 'logged_out', 'disconnected')),
    generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
    lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Short-lived, owner-bound pairing transaction. QR and pair codes are cleared
-- when the transaction ends; they are never retained after consumption.
CREATE TABLE whatsapp_pairing (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    generation bigint NOT NULL,
    state text NOT NULL CHECK (state IN ('waiting', 'qr', 'passkey', 'success', 'expired', 'cancelled', 'failed')),
    qr_code text CHECK (octet_length(qr_code) <= 4096),
    pair_code text CHECK (octet_length(pair_code) <= 64),
    expected_identity_jid text,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (consumed_at IS NULL OR (qr_code IS NULL AND pair_code IS NULL))
);
CREATE UNIQUE INDEX whatsapp_pairing_active_account ON whatsapp_pairing(account_id) WHERE consumed_at IS NULL;

-- The account's own view of its joined groups, kept fresh by the session service.
-- Group discovery and adoption read it; it never grants entity access.
CREATE TABLE whatsapp_group_roster (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    group_jid text NOT NULL CHECK (group_jid ~ '^[0-9-]+@g[.]us$'),
    observed_at timestamptz NOT NULL,
    metadata jsonb NOT NULL CHECK (pg_column_size(metadata) <= 1048576),
    PRIMARY KEY (account_id, group_jid)
);

CREATE TABLE whatsapp_group (
    id uuid PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    group_jid text NOT NULL CHECK (group_jid ~ '^[0-9-]+@g[.]us$'),
    name text NOT NULL,
    share_permission_id text NOT NULL REFERENCES "SharePermission"(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    -- Native content owner for future imported files.
    user_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('active', 'suspended', 'detached')),
    ownership_state text NOT NULL DEFAULT 'active' CHECK (ownership_state IN ('active', 'transfer_required')),
    adopted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    next_sequence bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX whatsapp_group_active_group ON whatsapp_group(team_id, group_jid) WHERE state <> 'detached';
CREATE INDEX whatsapp_group_group ON whatsapp_group(group_jid);

-- One account's explicit consent to observe and post for one binding.
CREATE TABLE whatsapp_group_membership (
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    consent_at timestamptz NOT NULL,
    consent_ended_at timestamptz,
    remote_member boolean NOT NULL DEFAULT false,
    can_post boolean NOT NULL DEFAULT false,
    reconciled boolean NOT NULL DEFAULT false,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (binding_id, account_id)
);
CREATE INDEX whatsapp_group_membership_account ON whatsapp_group_membership(account_id);

CREATE TABLE whatsapp_external_person (
    id uuid PRIMARY KEY,
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    -- Verified Macro association for display; never an authentication principal.
    user_id text,
    display_name text CHECK (octet_length(display_name) <= 512),
    UNIQUE (id, binding_id)
);

-- Verified phone-number and LID aliases. Names never resolve a person.
CREATE TABLE whatsapp_identity_alias (
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    jid text NOT NULL CHECK (jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'),
    person_id uuid NOT NULL,
    evidence_account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    verified_at timestamptz NOT NULL,
    PRIMARY KEY (binding_id, jid),
    FOREIGN KEY (person_id, binding_id) REFERENCES whatsapp_external_person(id, binding_id) ON DELETE CASCADE
);

-- Canonical source identity: (binding, verified person, source id). Every
-- observing account converges on one row and one group message.
CREATE TABLE whatsapp_group_message (
    id uuid PRIMARY KEY,
    body text NOT NULL DEFAULT '',
    reply_to uuid REFERENCES whatsapp_group_message(id) ON DELETE SET NULL,
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    person_id uuid NOT NULL,
    source_id text NOT NULL CHECK (octet_length(source_id) BETWEEN 1 AND 256),
    message_id uuid UNIQUE,
    origin text NOT NULL CHECK (origin IN ('whatsapp', 'macro', 'history')),
    source_at timestamptz NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    content_revision bigint NOT NULL DEFAULT 0,
    revision_content text CHECK (octet_length(revision_content) <= 65536),
    revised_at timestamptz,
    deleted_at timestamptz,
    effect_revision bigint NOT NULL DEFAULT 0,
    published_revision bigint NOT NULL DEFAULT 0,
    notification_retry_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (binding_id, person_id, source_id),
    FOREIGN KEY (person_id, binding_id) REFERENCES whatsapp_external_person(id, binding_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_group_message_notifications ON whatsapp_group_message(notification_retry_at) WHERE published_revision < effect_revision;
CREATE INDEX whatsapp_group_message_source ON whatsapp_group_message(binding_id, source_id);

CREATE TABLE whatsapp_message_observation (
    binding_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (binding_id, person_id, source_id, account_id, generation),
    FOREIGN KEY (binding_id, person_id, source_id) REFERENCES whatsapp_group_message(binding_id, person_id, source_id) ON DELETE CASCADE
);

-- Deferred (target not yet known) and quarantined (ambiguous identity) events
-- for adopted groups only. Applied events are not retained.
CREATE TABLE whatsapp_inbound_event (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    generation bigint NOT NULL,
    payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 1048576),
    state text NOT NULL CHECK (state IN ('pending', 'quarantined')),
    attempts integer NOT NULL DEFAULT 0,
    retry_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, event_id)
);
CREATE INDEX whatsapp_inbound_event_retry ON whatsapp_inbound_event(account_id, retry_at);

-- One reservation per source attachment ordinal; the document id is allocated
-- before any bytes exist so replays never create a second document. Media
-- import is not implemented yet: reservations stay 'pending'.
CREATE TABLE whatsapp_group_attachment (
    binding_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
    document_id uuid NOT NULL UNIQUE,
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed', 'deleted')),
    PRIMARY KEY (binding_id, person_id, source_id, ordinal),
    FOREIGN KEY (binding_id, person_id, source_id) REFERENCES whatsapp_group_message(binding_id, person_id, source_id) ON DELETE CASCADE
);

-- A receipt by one participant, never group-wide delivery or read success.
CREATE TABLE whatsapp_participant_receipt (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    source_id text NOT NULL CHECK (octet_length(source_id) <= 256),
    participant_jid text NOT NULL CHECK (octet_length(participant_jid) <= 256),
    receipt_state text NOT NULL CHECK (octet_length(receipt_state) <= 64),
    source_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, binding_id, source_id, participant_jid, receipt_state)
);

-- Durable send intent and outcome ledger. 'sending' with dispatch_started_at set
-- means the request may have reached WhatsApp: it becomes 'unknown' if the
-- replica dies, and is never sent again automatically.
CREATE TABLE whatsapp_send (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE RESTRICT,
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE RESTRICT,
    group_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 1048576),
    generation bigint NOT NULL,
    group_sequence bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'unknown', 'accepted', 'sent', 'delivered', 'read', 'failed')),
    claimed_epoch bigint,
    dispatch_started_at timestamptz,
    allocated_source_id text CHECK (octet_length(allocated_source_id) <= 256),
    message_id uuid REFERENCES whatsapp_group_message(id) ON DELETE SET NULL,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (state <> 'sending' OR claimed_epoch IS NOT NULL),
    CHECK (dispatch_started_at IS NULL OR allocated_source_id IS NOT NULL),
    UNIQUE (group_id, user_id, idempotency_key),
    UNIQUE (binding_id, group_sequence)
);
CREATE UNIQUE INDEX whatsapp_send_source ON whatsapp_send(account_id, allocated_source_id) WHERE allocated_source_id IS NOT NULL;
CREATE INDEX whatsapp_send_work ON whatsapp_send(account_id, created_at, id) WHERE state IN ('pending', 'sending');

CREATE TABLE whatsapp_group_reaction (
    message_id uuid NOT NULL REFERENCES whatsapp_group_message(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES whatsapp_external_person(id) ON DELETE CASCADE,
    emoji text NOT NULL CHECK (octet_length(emoji) <= 128),
    user_id text,
    source_id text NOT NULL,
    revision bigint NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (message_id, person_id)
);
CREATE TABLE whatsapp_group_read_state (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES whatsapp_group_message(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, group_id)
);
CREATE INDEX whatsapp_group_read_state_group ON whatsapp_group_read_state(group_id);
CREATE INDEX whatsapp_group_message_timeline ON whatsapp_group_message(binding_id, source_at DESC, id DESC) WHERE message_id IS NOT NULL;

CREATE FUNCTION whatsapp_group_can_view(group_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM entity_access ea
        WHERE ea.entity_id = group_id AND ea.entity_type = 'whatsapp_group'
          AND (ea.source_id = viewer OR ea.source_id IN (SELECT team_id::text FROM team_user WHERE user_id = viewer))
    ) OR EXISTS (
        SELECT 1 FROM whatsapp_group g JOIN "SharePermission" sp ON sp.id = g.share_permission_id
        WHERE g.id = group_id AND sp."linkShareAccessLevel" IS NOT NULL
          AND (sp."linkShare" = 'PUBLIC' OR (sp."linkShare" = 'TEAM' AND EXISTS (
              SELECT 1 FROM team_user mine JOIN team_user owner_team ON owner_team.team_id = mine.team_id
              WHERE mine.user_id = viewer AND owner_team.user_id = g.user_id)))
    )
$$;

ALTER TABLE entity DROP CONSTRAINT entity_entity_type_check;
ALTER TABLE entity ADD CONSTRAINT entity_entity_type_check
    CHECK (entity_type IN ('project','document','chat','agent_session','scheduled_action','whatsapp_group')) NOT VALID;
ALTER TABLE entity VALIDATE CONSTRAINT entity_entity_type_check;

CREATE INDEX whatsapp_send_message ON whatsapp_send(message_id,user_id,created_at DESC)
    WHERE message_id IS NOT NULL;
