-- Personal WhatsApp accounts linked as devices, and the WhatsApp chats people
-- add to Macro as their own, independently shared entities.
SET LOCAL lock_timeout = '5s';

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

-- Short-lived, owner-bound pairing transaction. QR and pair codes, and
-- WhatsApp's WebAuthn challenge and the owner's assertion, are cleared when the
-- transaction ends; they are never retained after consumption.
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
    passkey_challenge jsonb CHECK (pg_column_size(passkey_challenge) <= 65536),
    passkey_response jsonb CHECK (pg_column_size(passkey_response) <= 65536),
    CHECK (consumed_at IS NULL OR (qr_code IS NULL AND pair_code IS NULL)),
    CONSTRAINT whatsapp_pairing_passkey_cleared
        CHECK (consumed_at IS NULL OR (passkey_challenge IS NULL AND passkey_response IS NULL))
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

-- An added WhatsApp chat: a group, or a direct chat with one person. The
-- `group`/`group_jid` names cover both; `group_jid` is the chat's JID (a
-- direct chat's other person, by phone number when known). A person's chats
-- go with the person.
CREATE TABLE whatsapp_group (
    id uuid PRIMARY KEY,
    group_jid text NOT NULL,
    name text NOT NULL,
    share_permission_id text NOT NULL REFERENCES "SharePermission"(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Owner, and native content owner of imported files.
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    state text NOT NULL CHECK (state IN ('active', 'detached')),
    adopted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    next_sequence bigint NOT NULL DEFAULT 0,
    -- Importing the chat's earlier messages from the owner's phone after adding
    -- it. 'waiting_for_message': no message of the chat known to start from yet.
    backfill_state text CHECK (backfill_state IN ('waiting_for_message', 'pending', 'running', 'waiting_for_phone', 'done', 'partial')),
    backfill_imported integer NOT NULL DEFAULT 0 CHECK (backfill_imported >= 0),
    -- Oldest message imported so far ({id, at, fromMe, senderJid}); the next
    -- page is requested before it.
    backfill_cursor jsonb CHECK (pg_column_size(backfill_cursor) <= 4096),
    backfill_requested_at timestamptz,
    kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'direct')),
    CONSTRAINT whatsapp_group_group_jid_check CHECK (
        (kind = 'group' AND group_jid ~ '^[0-9-]+@g[.]us$')
        OR (kind = 'direct' AND group_jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'))
);
CREATE UNIQUE INDEX whatsapp_group_active_group ON whatsapp_group(user_id, group_jid) WHERE state <> 'detached';
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

-- Verified phone-number and LID aliases. Names never resolve a person. An
-- alias outlives the account that saw it, so one sender's history is not
-- split in two.
CREATE TABLE whatsapp_identity_alias (
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    jid text NOT NULL CHECK (jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'),
    person_id uuid NOT NULL,
    evidence_account_id uuid REFERENCES whatsapp_linked_account(id) ON DELETE SET NULL,
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
    -- 'system': something that happened in the group (added, left, renamed,
    -- pinned, a call), described by `rich`; never notifies or counts as unread.
    kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
    -- Poll, location, contact cards, event or system line
    -- (`whatsapp_linked::domain::rich::RichContent`).
    rich jsonb CHECK (pg_column_size(rich) <= 65536),
    -- WhatsApp ids the text @-mentions.
    mentions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 256),
    forwarded boolean NOT NULL DEFAULT false,
    -- Sent as view-once in WhatsApp; Macro keeps and shows it like any media.
    view_once boolean NOT NULL DEFAULT false,
    UNIQUE (binding_id, person_id, source_id),
    FOREIGN KEY (person_id, binding_id) REFERENCES whatsapp_external_person(id, binding_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_group_message_notifications ON whatsapp_group_message(notification_retry_at) WHERE published_revision < effect_revision;
CREATE INDEX whatsapp_group_message_source ON whatsapp_group_message(binding_id, source_id);
CREATE INDEX whatsapp_group_message_timeline ON whatsapp_group_message(binding_id, source_at DESC, id DESC) WHERE message_id IS NOT NULL;

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
-- before any bytes exist so replays never create a second document. The
-- locator is sealed by the session service with the observing account's key;
-- Macro never reads it.
CREATE TABLE whatsapp_group_attachment (
    binding_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
    document_id uuid NOT NULL UNIQUE,
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'downloaded', 'ready', 'failed', 'deleted')),
    account_id uuid REFERENCES whatsapp_linked_account(id) ON DELETE SET NULL,
    locator bytea CHECK (octet_length(locator) <= 8192),
    mime text CHECK (octet_length(mime) <= 128),
    filename text CHECK (octet_length(filename) <= 512),
    size bigint CHECK (size >= 0),
    claimed_until timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    retry_at timestamptz NOT NULL DEFAULT now(),
    -- As WhatsApp declared them, so a timeline can reserve the space.
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    duration_seconds integer CHECK (duration_seconds >= 0),
    presentation text CHECK (presentation IN ('sticker', 'gif', 'voice_note')),
    PRIMARY KEY (binding_id, person_id, source_id, ordinal),
    FOREIGN KEY (binding_id, person_id, source_id) REFERENCES whatsapp_group_message(binding_id, person_id, source_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_group_attachment_download ON whatsapp_group_attachment(account_id, retry_at) WHERE state = 'pending';
CREATE INDEX whatsapp_group_attachment_import ON whatsapp_group_attachment(retry_at) WHERE state = 'downloaded';

-- Plaintext bytes between a download (or an upload) and their private Macro
-- document. Deleted once the document holds them; unsent uploads expire.
CREATE TABLE whatsapp_media_blob (
    document_id uuid PRIMARY KEY,
    group_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    -- Owner of the resulting document: the uploader, or the binding's content owner.
    user_id text NOT NULL,
    mime text NOT NULL CHECK (octet_length(mime) <= 128),
    filename text NOT NULL CHECK (octet_length(filename) BETWEEN 1 AND 512),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 33554432),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Read from the file's headers when it was staged.
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    duration_seconds integer CHECK (duration_seconds >= 0)
);
CREATE INDEX whatsapp_media_blob_created ON whatsapp_media_blob(created_at);

-- A receipt by one participant (delivered, read or played), never group-wide
-- delivery or read success. Kept for 30 days.
CREATE TABLE whatsapp_participant_receipt (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    binding_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    source_id text NOT NULL CHECK (octet_length(source_id) <= 256),
    participant_jid text NOT NULL CHECK (octet_length(participant_jid) <= 256),
    receipt_state text NOT NULL CHECK (receipt_state IN ('delivered', 'read', 'played')),
    source_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, binding_id, source_id, participant_jid, receipt_state)
);
CREATE INDEX whatsapp_participant_receipt_source_at ON whatsapp_participant_receipt(source_at);

-- Durable send intent and outcome ledger. 'sending' with dispatch_started_at set
-- means the request may have reached WhatsApp: it becomes 'unknown' if the
-- replica dies, and is never sent again automatically. Sends go with the
-- sender's account and with the chat.
CREATE TABLE whatsapp_send (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 1048576),
    generation bigint NOT NULL,
    group_sequence bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'unknown', 'accepted', 'failed')),
    claimed_epoch bigint,
    dispatch_started_at timestamptz,
    allocated_source_id text CHECK (octet_length(allocated_source_id) <= 256),
    message_id uuid REFERENCES whatsapp_group_message(id) ON DELETE SET NULL,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- W3C trace context of the request that recorded the send; the dispatch
    -- joins that trace.
    traceparent text CHECK (octet_length(traceparent) <= 256),
    CHECK (state <> 'sending' OR claimed_epoch IS NOT NULL),
    CHECK (dispatch_started_at IS NULL OR allocated_source_id IS NOT NULL),
    UNIQUE (group_id, user_id, idempotency_key),
    UNIQUE (group_id, group_sequence)
);
CREATE UNIQUE INDEX whatsapp_send_source ON whatsapp_send(account_id, allocated_source_id) WHERE allocated_source_id IS NOT NULL;
CREATE INDEX whatsapp_send_work ON whatsapp_send(account_id, created_at, id) WHERE state IN ('pending', 'sending');
CREATE INDEX whatsapp_send_message ON whatsapp_send(message_id, user_id, created_at DESC) WHERE message_id IS NOT NULL;

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

-- Each voter's current choice on a poll message, latest revision wins.
CREATE TABLE whatsapp_group_poll_vote (
    message_id uuid NOT NULL REFERENCES whatsapp_group_message(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES whatsapp_external_person(id) ON DELETE CASCADE,
    -- SHA-256 (hex) of each chosen option's text; empty withdraws the vote.
    selected text[] NOT NULL CHECK (cardinality(selected) <= 64),
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

-- The account's WhatsApp chat list, groups and direct chats, as WhatsApp Web
-- shows it: from history sync, live messages, group events and contact
-- updates. Never message content. The anchor is the newest known message, where
-- importing earlier messages starts. Names are plaintext like the roster: DSS
-- serves them and holds no account data key.
CREATE TABLE whatsapp_chat (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    chat_jid text NOT NULL CHECK (chat_jid ~ '^[0-9-]+@(g[.]us|s[.]whatsapp[.]net|lid)$'),
    kind text NOT NULL CHECK (kind IN ('group', 'direct')),
    name text CHECK (octet_length(name) <= 1024),
    last_activity_at timestamptz,
    archived boolean NOT NULL DEFAULT false,
    pinned boolean NOT NULL DEFAULT false,
    anchor jsonb CHECK (pg_column_size(anchor) <= 4096),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, chat_jid),
    CONSTRAINT whatsapp_chat_kind_jid_check CHECK (
        (kind = 'group' AND chat_jid ~ '^[0-9-]+@g[.]us$')
        OR (kind = 'direct' AND chat_jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'))
);

-- The grant sources a person reaches a chat through: themself, their teams and
-- the channels they are in. entity_access resolves the same list.
CREATE FUNCTION whatsapp_group_sources(viewer text) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT array_append(
        ARRAY(SELECT team_id::text FROM team_user WHERE user_id = viewer)
            || ARRAY(SELECT channel_id::text FROM comms_channel_participants WHERE user_id = viewer AND left_at IS NULL),
        viewer)
$$;

-- The highest level `sources` reach on the chat: its entity_access grants, or
-- its public link, or its team link when a source is one of the owner's teams.
CREATE FUNCTION whatsapp_group_access_level(group_id uuid, sources text[]) RETURNS "AccessLevel"
LANGUAGE sql STABLE AS $$
    SELECT max(level) FROM (
        SELECT ea.access_level AS level FROM entity_access ea
        WHERE ea.entity_id = group_id AND ea.entity_type = 'whatsapp_group' AND ea.source_id = ANY(sources)
        UNION ALL
        SELECT sp."linkShareAccessLevel" FROM whatsapp_group g JOIN "SharePermission" sp ON sp.id = g.share_permission_id
        WHERE g.id = group_id AND sp."linkShareAccessLevel" IS NOT NULL
          AND (sp."linkShare" = 'PUBLIC' OR (sp."linkShare" = 'TEAM' AND EXISTS (
              SELECT 1 FROM team_user owner_team
              WHERE owner_team.user_id = g.user_id AND owner_team.team_id::text = ANY(sources))))
    ) levels
$$;

-- The view rule the set queries use.
CREATE FUNCTION whatsapp_group_can_view(group_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT whatsapp_group_access_level(group_id, whatsapp_group_sources(viewer)) IS NOT NULL
$$;

-- Deleting a chat deletes its grants, its entity record and its sharing settings.
CREATE FUNCTION cleanup_whatsapp_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM entity_access WHERE entity_type = 'whatsapp_group' AND entity_id = OLD.id;
    DELETE FROM entity WHERE entity_type = 'whatsapp_group' AND id = OLD.id;
    DELETE FROM "SharePermission" WHERE id = OLD.share_permission_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER cleanup_whatsapp_group AFTER DELETE ON whatsapp_group
FOR EACH ROW EXECUTE FUNCTION cleanup_whatsapp_group();

-- Validated in the next migration, outside this transaction's lock.
ALTER TABLE entity DROP CONSTRAINT entity_entity_type_check;
ALTER TABLE entity ADD CONSTRAINT entity_entity_type_check
    CHECK (entity_type IN ('project','document','chat','agent_session','scheduled_action','whatsapp_group')) NOT VALID;
