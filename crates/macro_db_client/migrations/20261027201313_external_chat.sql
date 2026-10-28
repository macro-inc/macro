-- Added WhatsApp chats become generic external chats: the entity, its
-- people, messages, attachments, reactions, poll votes and read state are
-- provider-neutral `external_chat*` tables; the account, pairing, roster,
-- chat list, membership, aliases, observations, receipts and send outbox
-- stay WhatsApp's. Nothing was stored yet, so the tables that hang off an
-- added chat are recreated under their new names instead of renamed.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM whatsapp_group) THEN
        RAISE EXCEPTION 'external_chat rename expects no WhatsApp data';
    END IF;
END
$$;

DROP TABLE whatsapp_group_read_state, whatsapp_group_poll_vote, whatsapp_group_reaction,
    whatsapp_send, whatsapp_participant_receipt, whatsapp_media_blob, whatsapp_group_attachment,
    whatsapp_message_observation, whatsapp_group_message, whatsapp_identity_alias,
    whatsapp_external_person, whatsapp_group_membership, whatsapp_group;
DROP FUNCTION whatsapp_group_can_view(uuid, text);
DROP FUNCTION whatsapp_group_access_level(uuid, text[]);
DROP FUNCTION whatsapp_group_sources(text);
DROP FUNCTION cleanup_whatsapp_group();
DROP FUNCTION whatsapp_attachment_release_file();

-- The account's own view of its joined WhatsApp groups.
ALTER TABLE whatsapp_group_roster RENAME TO whatsapp_roster;
ALTER TABLE whatsapp_roster RENAME CONSTRAINT whatsapp_group_roster_pkey TO whatsapp_roster_pkey;
ALTER TABLE whatsapp_roster RENAME CONSTRAINT whatsapp_group_roster_account_id_fkey TO whatsapp_roster_account_id_fkey;
ALTER TABLE whatsapp_roster RENAME CONSTRAINT whatsapp_group_roster_group_jid_check TO whatsapp_roster_group_jid_check;
ALTER TABLE whatsapp_roster RENAME CONSTRAINT whatsapp_group_roster_metadata_check TO whatsapp_roster_metadata_check;

-- A chat from another messaging service a person added to Macro as their own,
-- independently shared entity: a group, or a direct chat with one person. A
-- person's chats go with the person.
CREATE TABLE external_chat (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('whatsapp')),
    -- The chat's id at the provider. WhatsApp: the group's JID, or a direct
    -- chat's other person (by phone number when known).
    remote_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('group', 'direct')),
    name text NOT NULL,
    share_permission_id text NOT NULL REFERENCES "SharePermission"(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Owner, and native content owner of imported files.
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    state text NOT NULL CHECK (state IN ('active', 'detached')),
    adopted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    next_sequence bigint NOT NULL DEFAULT 0,
    -- Importing the chat's earlier messages after adding it.
    -- 'waiting_for_message': no message of the chat known to start from yet.
    backfill_state text CHECK (backfill_state IN ('waiting_for_message', 'pending', 'running', 'waiting_for_phone', 'done', 'partial')),
    backfill_imported integer NOT NULL DEFAULT 0 CHECK (backfill_imported >= 0),
    -- The provider's opaque position of the oldest message imported so far;
    -- the next page is requested before it.
    backfill_cursor jsonb CHECK (pg_column_size(backfill_cursor) <= 4096),
    backfill_requested_at timestamptz,
    CONSTRAINT external_chat_whatsapp_remote_id_check CHECK (
        provider <> 'whatsapp'
        OR (kind = 'group' AND remote_id ~ '^[0-9-]+@g[.]us$')
        OR (kind = 'direct' AND remote_id ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'))
);
CREATE UNIQUE INDEX external_chat_active_remote ON external_chat(user_id, provider, remote_id) WHERE state <> 'detached';
CREATE INDEX external_chat_remote ON external_chat(provider, remote_id);

-- One WhatsApp account's explicit consent to observe and post for one chat.
CREATE TABLE whatsapp_chat_membership (
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    consent_at timestamptz NOT NULL,
    consent_ended_at timestamptz,
    remote_member boolean NOT NULL DEFAULT false,
    can_post boolean NOT NULL DEFAULT false,
    reconciled boolean NOT NULL DEFAULT false,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (chat_id, account_id)
);
CREATE INDEX whatsapp_chat_membership_account ON whatsapp_chat_membership(account_id);

-- Someone who writes in a chat.
CREATE TABLE external_chat_person (
    id uuid PRIMARY KEY,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    -- Verified Macro association for display; never an authentication principal.
    user_id text,
    display_name text CHECK (octet_length(display_name) <= 512),
    UNIQUE (id, chat_id)
);

-- Verified WhatsApp phone-number and LID aliases. Names never resolve a
-- person. An alias outlives the account that saw it, so one sender's history
-- is not split in two.
CREATE TABLE whatsapp_identity_alias (
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    jid text NOT NULL CHECK (jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'),
    person_id uuid NOT NULL,
    evidence_account_id uuid REFERENCES whatsapp_linked_account(id) ON DELETE SET NULL,
    verified_at timestamptz NOT NULL,
    PRIMARY KEY (chat_id, jid),
    FOREIGN KEY (person_id, chat_id) REFERENCES external_chat_person(id, chat_id) ON DELETE CASCADE
);

-- Canonical source identity: (chat, verified person, source id). Every
-- observing account converges on one row and one message.
CREATE TABLE external_chat_message (
    id uuid PRIMARY KEY,
    body text NOT NULL DEFAULT '',
    reply_to uuid REFERENCES external_chat_message(id) ON DELETE SET NULL,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    person_id uuid NOT NULL,
    source_id text NOT NULL CHECK (octet_length(source_id) BETWEEN 1 AND 256),
    message_id uuid UNIQUE,
    -- 'remote': arrived from the provider live; 'macro': sent from Macro;
    -- 'history': imported earlier messages.
    origin text NOT NULL CHECK (origin IN ('remote', 'macro', 'history')),
    source_at timestamptz NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    content_revision bigint NOT NULL DEFAULT 0,
    revision_content text CHECK (octet_length(revision_content) <= 65536),
    revised_at timestamptz,
    deleted_at timestamptz,
    effect_revision bigint NOT NULL DEFAULT 0,
    published_revision bigint NOT NULL DEFAULT 0,
    notification_retry_at timestamptz NOT NULL DEFAULT now(),
    -- 'system': something that happened in the chat (added, left, renamed,
    -- pinned, a call), described by `rich`; never notifies or counts as unread.
    kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
    -- Poll, location, contact cards, event or system line
    -- (`whatsapp_linked::domain::rich::RichContent`).
    rich jsonb CHECK (pg_column_size(rich) <= 65536),
    -- Provider ids of the people the text @-mentions.
    mentions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 256),
    forwarded boolean NOT NULL DEFAULT false,
    -- Sent as view-once; Macro keeps and shows it like any media.
    view_once boolean NOT NULL DEFAULT false,
    UNIQUE (chat_id, person_id, source_id),
    FOREIGN KEY (person_id, chat_id) REFERENCES external_chat_person(id, chat_id) ON DELETE CASCADE
);
CREATE INDEX external_chat_message_notifications ON external_chat_message(notification_retry_at) WHERE published_revision < effect_revision;
CREATE INDEX external_chat_message_source ON external_chat_message(chat_id, source_id);
CREATE INDEX external_chat_message_timeline ON external_chat_message(chat_id, source_at DESC, id DESC) WHERE message_id IS NOT NULL;

-- Which WhatsApp account saw which message.
CREATE TABLE whatsapp_message_observation (
    chat_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (chat_id, person_id, source_id, account_id, generation),
    FOREIGN KEY (chat_id, person_id, source_id) REFERENCES external_chat_message(chat_id, person_id, source_id) ON DELETE CASCADE
);

-- One reservation per source attachment ordinal. The blob id is allocated
-- before any bytes exist (and is the upload id of a file sent from Macro), so
-- replays never stage the bytes twice; the static file id is recorded once
-- the bytes are stored. The account, locator and claim columns are WhatsApp's
-- download state: the locator is sealed by the session service with the
-- observing account's key; Macro never reads it.
CREATE TABLE external_chat_attachment (
    chat_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
    blob_id uuid NOT NULL UNIQUE,
    file_id uuid UNIQUE,
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
    -- As the provider declared them, so a timeline can reserve the space.
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    duration_seconds integer CHECK (duration_seconds >= 0),
    presentation text CHECK (presentation IN ('sticker', 'gif', 'voice_note')),
    CONSTRAINT external_chat_attachment_ready_file CHECK (state <> 'ready' OR file_id IS NOT NULL),
    PRIMARY KEY (chat_id, person_id, source_id, ordinal),
    FOREIGN KEY (chat_id, person_id, source_id) REFERENCES external_chat_message(chat_id, person_id, source_id) ON DELETE CASCADE
);
CREATE INDEX external_chat_attachment_download ON external_chat_attachment(account_id, retry_at) WHERE state = 'pending';
CREATE INDEX external_chat_attachment_import ON external_chat_attachment(retry_at) WHERE state = 'downloaded';

-- Plaintext bytes between a download (or an upload) and their static file.
-- Deleted once the file holds them; unsent uploads expire.
CREATE TABLE external_chat_media_blob (
    id uuid PRIMARY KEY,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    -- Owner of the resulting file: the uploader, or the chat's owner.
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
CREATE INDEX external_chat_media_blob_created ON external_chat_media_blob(created_at);

-- Static files no attachment references any more, until DSS deletes them
-- from the static file service.
ALTER TABLE whatsapp_file_deletion RENAME TO external_chat_file_deletion;
ALTER TABLE external_chat_file_deletion RENAME CONSTRAINT whatsapp_file_deletion_pkey TO external_chat_file_deletion_pkey;
ALTER INDEX whatsapp_file_deletion_retry RENAME TO external_chat_file_deletion_retry;

CREATE FUNCTION external_chat_attachment_release_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.file_id IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.file_id IS DISTINCT FROM OLD.file_id) THEN
        INSERT INTO external_chat_file_deletion (file_id) VALUES (OLD.file_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER external_chat_attachment_release_file AFTER DELETE OR UPDATE OF file_id ON external_chat_attachment
FOR EACH ROW EXECUTE FUNCTION external_chat_attachment_release_file();

-- A receipt by one WhatsApp participant (delivered, read or played), never
-- chat-wide delivery or read success. Kept for 30 days.
CREATE TABLE whatsapp_participant_receipt (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    source_id text NOT NULL CHECK (octet_length(source_id) <= 256),
    participant_jid text NOT NULL CHECK (octet_length(participant_jid) <= 256),
    receipt_state text NOT NULL CHECK (receipt_state IN ('delivered', 'read', 'played')),
    source_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, chat_id, source_id, participant_jid, receipt_state)
);
CREATE INDEX whatsapp_participant_receipt_source_at ON whatsapp_participant_receipt(source_at);

-- WhatsApp's durable send intent and outcome ledger. 'sending' with
-- dispatch_started_at set means the request may have reached WhatsApp: it
-- becomes 'unknown' if the replica dies, and is never sent again
-- automatically. Sends go with the sender's account and with the chat.
CREATE TABLE whatsapp_send (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 1048576),
    generation bigint NOT NULL,
    chat_sequence bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'unknown', 'accepted', 'failed')),
    claimed_epoch bigint,
    dispatch_started_at timestamptz,
    allocated_source_id text CHECK (octet_length(allocated_source_id) <= 256),
    message_id uuid REFERENCES external_chat_message(id) ON DELETE SET NULL,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- W3C trace context of the request that recorded the send; the dispatch
    -- joins that trace.
    traceparent text CHECK (octet_length(traceparent) <= 256),
    CHECK (state <> 'sending' OR claimed_epoch IS NOT NULL),
    CHECK (dispatch_started_at IS NULL OR allocated_source_id IS NOT NULL),
    UNIQUE (chat_id, user_id, idempotency_key),
    UNIQUE (chat_id, chat_sequence)
);
CREATE UNIQUE INDEX whatsapp_send_source ON whatsapp_send(account_id, allocated_source_id) WHERE allocated_source_id IS NOT NULL;
CREATE INDEX whatsapp_send_work ON whatsapp_send(account_id, created_at, id) WHERE state IN ('pending', 'sending');
CREATE INDEX whatsapp_send_message ON whatsapp_send(message_id, user_id, created_at DESC) WHERE message_id IS NOT NULL;

CREATE TABLE external_chat_reaction (
    message_id uuid NOT NULL REFERENCES external_chat_message(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES external_chat_person(id) ON DELETE CASCADE,
    emoji text NOT NULL CHECK (octet_length(emoji) <= 128),
    user_id text,
    source_id text NOT NULL,
    revision bigint NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (message_id, person_id)
);

-- Each voter's current choice on a poll message, latest revision wins.
CREATE TABLE external_chat_poll_vote (
    message_id uuid NOT NULL REFERENCES external_chat_message(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES external_chat_person(id) ON DELETE CASCADE,
    -- SHA-256 (hex) of each chosen option's text; empty withdraws the vote.
    selected text[] NOT NULL CHECK (cardinality(selected) <= 64),
    user_id text,
    source_id text NOT NULL,
    revision bigint NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (message_id, person_id)
);

CREATE TABLE external_chat_read_state (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES external_chat_message(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, chat_id)
);
CREATE INDEX external_chat_read_state_chat ON external_chat_read_state(chat_id);

-- The grant sources a person reaches a chat through: themself, their teams and
-- the channels they are in. entity_access resolves the same list.
CREATE FUNCTION external_chat_sources(viewer text) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT array_append(
        ARRAY(SELECT team_id::text FROM team_user WHERE user_id = viewer)
            || ARRAY(SELECT channel_id::text FROM comms_channel_participants WHERE user_id = viewer AND left_at IS NULL),
        viewer)
$$;

-- The highest level `sources` reach on the chat: its entity_access grants, or
-- its public link, or its team link when a source is one of the owner's teams.
CREATE FUNCTION external_chat_access_level(chat_id uuid, sources text[]) RETURNS "AccessLevel"
LANGUAGE sql STABLE AS $$
    SELECT max(level) FROM (
        SELECT ea.access_level AS level FROM entity_access ea
        WHERE ea.entity_id = chat_id AND ea.entity_type = 'external_chat' AND ea.source_id = ANY(sources)
        UNION ALL
        SELECT sp."linkShareAccessLevel" FROM external_chat c JOIN "SharePermission" sp ON sp.id = c.share_permission_id
        WHERE c.id = chat_id AND sp."linkShareAccessLevel" IS NOT NULL
          AND (sp."linkShare" = 'PUBLIC' OR (sp."linkShare" = 'TEAM' AND EXISTS (
              SELECT 1 FROM team_user owner_team
              WHERE owner_team.user_id = c.user_id AND owner_team.team_id::text = ANY(sources))))
    ) levels
$$;

-- The view rule the set queries use.
CREATE FUNCTION external_chat_can_view(chat_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT external_chat_access_level(chat_id, external_chat_sources(viewer)) IS NOT NULL
$$;

-- Deleting a chat deletes its grants, its entity record and its sharing settings.
CREATE FUNCTION cleanup_external_chat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM entity_access WHERE entity_type = 'external_chat' AND entity_id = OLD.id;
    DELETE FROM entity WHERE entity_type = 'external_chat' AND id = OLD.id;
    DELETE FROM "SharePermission" WHERE id = OLD.share_permission_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER cleanup_external_chat AFTER DELETE ON external_chat
FOR EACH ROW EXECUTE FUNCTION cleanup_external_chat();

UPDATE user_notification_type_preference
SET notification_event_type = 'external_chat_message'
WHERE notification_event_type = 'whatsapp_group_message';

-- Validated in the next migration, outside this transaction's lock.
ALTER TABLE entity DROP CONSTRAINT entity_entity_type_check;
ALTER TABLE entity ADD CONSTRAINT entity_entity_type_check
    CHECK (entity_type IN ('project','document','chat','agent_session','scheduled_action','external_chat')) NOT VALID;
