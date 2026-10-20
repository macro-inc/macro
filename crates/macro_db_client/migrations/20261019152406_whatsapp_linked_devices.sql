-- Linked devices are personal accounts; bindings and grants belong to workspaces.
-- This migration is additive. No business account or existing payload is rewritten.
SET lock_timeout = '5s';
CREATE TABLE whatsapp_linked_account (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    identity_jid text UNIQUE,
    state text NOT NULL DEFAULT 'connecting' CHECK (state IN ('connecting','connected','offline','reconnect','disconnected')),
    authorization_generation bigint NOT NULL DEFAULT 1 CHECK (authorization_generation > 0),
    store_ref uuid NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_linked_account_active_user ON whatsapp_linked_account(user_id) WHERE state <> 'disconnected';
CREATE TABLE whatsapp_session_owner (
    account_id uuid PRIMARY KEY REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    worker_id uuid NOT NULL,
    epoch bigint NOT NULL CHECK (epoch > 0),
    state text NOT NULL CHECK (state IN ('starting','running','retiring','terminated')),
    lease_until timestamptz NOT NULL,
    terminated_at timestamptz,
    CHECK ((state='terminated') = (terminated_at IS NOT NULL))
);
CREATE TABLE whatsapp_pairing (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    authorization_generation bigint NOT NULL,
    state text NOT NULL CHECK (state IN ('created','displayed','passkey','confirmation','verified','connected','cancelled','expired','error')),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    handoff_sha256 bytea UNIQUE CHECK (handoff_sha256 IS NULL OR octet_length(handoff_sha256)=32),
    handoff_expires_at timestamptz,
    expected_identity_jid text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_pairing_active_account ON whatsapp_pairing(account_id) WHERE consumed_at IS NULL;
CREATE TABLE whatsapp_group_binding (
    id uuid PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    group_jid text NOT NULL CHECK (group_jid ~ '^[0-9-]+@g[.]us$'),
    channel_id uuid NOT NULL UNIQUE REFERENCES comms_channels(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('active','suspended','detached')),
    ownership_state text NOT NULL DEFAULT 'active' CHECK (ownership_state IN ('active','transfer_required')),
    adopted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    next_sequence bigint NOT NULL DEFAULT 0,
    UNIQUE(id, channel_id)
);
CREATE UNIQUE INDEX whatsapp_group_binding_active_group ON whatsapp_group_binding(team_id,group_jid) WHERE state <> 'detached';
CREATE TABLE whatsapp_group_membership (
    binding_id uuid NOT NULL REFERENCES whatsapp_group_binding(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    authorization_generation bigint NOT NULL,
    consent_at timestamptz NOT NULL,
    consent_ended_at timestamptz,
    remote_member boolean NOT NULL DEFAULT false,
    can_post boolean NOT NULL DEFAULT false,
    observed_at timestamptz NOT NULL,
    metadata_version bigint NOT NULL CHECK (metadata_version >= 0),
    reconciled boolean NOT NULL DEFAULT false,
    PRIMARY KEY(binding_id, account_id)
);
-- Access is a separate grant. Disconnect ends consent, not established native access.
CREATE TABLE whatsapp_group_audience (
    binding_id uuid NOT NULL REFERENCES whatsapp_group_binding(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    identity_jid text NOT NULL,
    history_granted_at timestamptz NOT NULL,
    remote_member boolean NOT NULL DEFAULT false,
    reconciled boolean NOT NULL DEFAULT false,
    membership_version bigint NOT NULL DEFAULT 0,
    observed_at timestamptz NOT NULL,
    revoked_at timestamptz,
    PRIMARY KEY(binding_id,user_id)
);
CREATE TABLE whatsapp_external_person (
    id uuid PRIMARY KEY,
    binding_id uuid NOT NULL REFERENCES whatsapp_group_binding(id) ON DELETE CASCADE,
    user_id text,
    display_name text CHECK (octet_length(display_name) <= 512),
    UNIQUE(id,binding_id)
);
CREATE TABLE whatsapp_identity_alias (
    binding_id uuid NOT NULL REFERENCES whatsapp_group_binding(id) ON DELETE CASCADE,
    jid text NOT NULL CHECK (jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'),
    person_id uuid NOT NULL,
    evidence_account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE RESTRICT,
    verified_at timestamptz NOT NULL,
    PRIMARY KEY(binding_id,jid),
    FOREIGN KEY(person_id,binding_id) REFERENCES whatsapp_external_person(id,binding_id) ON DELETE CASCADE
);
CREATE TABLE whatsapp_external_message (
    binding_id uuid NOT NULL REFERENCES whatsapp_group_binding(id) ON DELETE CASCADE,
    person_id uuid NOT NULL,
    source_id text NOT NULL CHECK (octet_length(source_id) BETWEEN 1 AND 256),
    message_id uuid UNIQUE REFERENCES comms_messages(id) ON DELETE SET NULL,
    origin text NOT NULL CHECK (origin IN ('whatsapp','macro','history')),
    source_at timestamptz NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    content_revision bigint NOT NULL DEFAULT 0,
    deleted_at timestamptz,
    effect_revision bigint NOT NULL DEFAULT 0,
    published_revision bigint NOT NULL DEFAULT 0,
    native_retry_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(binding_id,person_id,source_id),
    FOREIGN KEY(person_id,binding_id) REFERENCES whatsapp_external_person(id,binding_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_external_message_publication ON whatsapp_external_message(native_retry_at) WHERE published_revision < effect_revision;
CREATE TABLE whatsapp_message_observation (
    binding_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    authorization_generation bigint NOT NULL,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY(binding_id,person_id,source_id,account_id,authorization_generation),
    FOREIGN KEY(binding_id,person_id,source_id) REFERENCES whatsapp_external_message(binding_id,person_id,source_id) ON DELETE CASCADE
);
CREATE TABLE whatsapp_inbound_event (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    authorization_generation bigint NOT NULL,
    owner_epoch bigint NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version=1),
    payload jsonb NOT NULL CHECK (pg_column_size(payload)<=1048576),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','applied','quarantined')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(account_id,event_id)
);
CREATE TABLE whatsapp_attachment (
    binding_id uuid NOT NULL,
    person_id uuid NOT NULL,
    source_id text NOT NULL,
    ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
    document_id uuid NOT NULL UNIQUE,
    sha256 bytea NOT NULL CHECK (octet_length(sha256)=32),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','failed','deleted')),
    lease_id uuid,
    lease_until timestamptz,
    PRIMARY KEY(binding_id,person_id,source_id,ordinal),
    FOREIGN KEY(binding_id,person_id,source_id) REFERENCES whatsapp_external_message(binding_id,person_id,source_id) ON DELETE CASCADE
);
-- Use the existing human intent/dispatch/recovery state machine for both transports.
ALTER TABLE meta_messaging_send ALTER COLUMN connection_id DROP NOT NULL;
ALTER TABLE meta_messaging_send
    ADD COLUMN linked_account_id uuid REFERENCES whatsapp_linked_account(id) ON DELETE RESTRICT,
    ADD COLUMN linked_binding_id uuid REFERENCES whatsapp_group_binding(id) ON DELETE RESTRICT,
    ADD COLUMN authorization_generation bigint,
    ADD COLUMN owner_epoch bigint,
    ADD COLUMN group_sequence bigint,
    ADD COLUMN allocated_source_id text,
    ADD CONSTRAINT messaging_send_transport CHECK (
        (connection_id IS NOT NULL AND linked_account_id IS NULL AND linked_binding_id IS NULL) OR
        (connection_id IS NULL AND linked_account_id IS NOT NULL AND linked_binding_id IS NOT NULL
         AND authorization_generation IS NOT NULL AND owner_epoch IS NOT NULL AND group_sequence IS NOT NULL)
    ) NOT VALID;
ALTER TABLE meta_messaging_send VALIDATE CONSTRAINT messaging_send_transport;
CREATE UNIQUE INDEX whatsapp_send_sequence ON meta_messaging_send(linked_binding_id,group_sequence) WHERE linked_binding_id IS NOT NULL;
CREATE UNIQUE INDEX whatsapp_send_source ON meta_messaging_send(linked_account_id,allocated_source_id) WHERE allocated_source_id IS NOT NULL;
-- Native binding stays explicit when the rollout switch is disabled or detached.
ALTER TABLE comms_channels DROP CONSTRAINT comms_channels_messaging_binding_check;
ALTER TABLE comms_channels ADD CONSTRAINT comms_channels_messaging_binding_check
    CHECK (messaging_binding IN ('native','whatsapp_direct','instagram_direct','whatsapp_group','whatsapp_linked_group')) NOT VALID;
ALTER TABLE comms_channels VALIDATE CONSTRAINT comms_channels_messaging_binding_check;

SET lock_timeout='5s';
ALTER TABLE whatsapp_external_message ADD COLUMN revision_content text CHECK(octet_length(revision_content)<=65536), ADD COLUMN revised_at timestamptz;
-- The native source marker guards every call: ordinary channels never resolve a
-- linked account/binding. Independent native grants do not bypass this audience.
CREATE FUNCTION whatsapp_linked_can_view(channel uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM whatsapp_group_binding b
    JOIN whatsapp_group_audience a ON a.binding_id=b.id
    JOIN team_user tu ON tu.team_id=b.team_id AND tu.user_id=a.user_id
    JOIN comms_channel_participants cp ON cp.channel_id=b.channel_id AND cp.user_id=a.user_id
    WHERE b.channel_id=channel AND a.user_id=viewer
      AND a.revoked_at IS NULL AND a.remote_member AND a.reconciled AND cp.left_at IS NULL
  )
$$;
-- External reaction actors belong to messages, not synthetic Macro users.
CREATE TABLE comms_external_reactions (
    message_id uuid NOT NULL REFERENCES comms_messages(id) ON DELETE CASCADE,
    sender_id text NOT NULL CHECK(sender_id LIKE 'external|%'),
    display_name text,
    emoji text NOT NULL CHECK(octet_length(emoji)<=128),
    revision bigint NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY(message_id,sender_id)
);

SET lock_timeout='5s';
ALTER TABLE whatsapp_inbound_event ADD COLUMN retry_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN attempts integer NOT NULL DEFAULT 0;
CREATE INDEX whatsapp_inbound_event_retry ON whatsapp_inbound_event(retry_at,account_id,event_id) WHERE state IN ('pending','quarantined');
-- Group-derived access ends with membership. Existing owner/direct/team and
-- independently granted channel access retain their ordinary native meaning.
-- Public links alone never expose a privately imported original.
CREATE FUNCTION whatsapp_linked_can_read_document(document uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM whatsapp_attachment a WHERE a.document_id=document)
 OR EXISTS(SELECT 1 FROM whatsapp_attachment a JOIN whatsapp_group_binding b ON b.id=a.binding_id
   WHERE a.document_id=document AND a.state<>'deleted' AND whatsapp_linked_can_view(b.channel_id,viewer))
 OR EXISTS(SELECT 1 FROM "Document" d WHERE d.id=document::text AND d.owner=viewer)
 OR EXISTS(SELECT 1 FROM entity_access ea WHERE ea.entity_type='document' AND ea.entity_id=document AND (
   (ea.source_type='user' AND ea.source_id=viewer)
   OR (ea.source_type='team' AND EXISTS(SELECT 1 FROM team_user tu WHERE tu.team_id::text=ea.source_id AND tu.user_id=viewer))
   OR (ea.source_type='channel' AND EXISTS(SELECT 1 FROM comms_channel_participants cp JOIN comms_channels c ON c.id=cp.channel_id
      WHERE cp.channel_id::text=ea.source_id AND cp.user_id=viewer AND cp.left_at IS NULL
       AND CASE WHEN c.messaging_binding='whatsapp_linked_group' THEN whatsapp_linked_can_view(c.id,viewer) ELSE true END))))
$$;
SET lock_timeout='5s';
CREATE TABLE whatsapp_group_roster (
    binding_id uuid PRIMARY KEY REFERENCES whatsapp_group_binding(id) ON DELETE CASCADE,
    observed_at timestamptz NOT NULL,
    metadata jsonb NOT NULL CHECK(pg_column_size(metadata)<=1048576)
);
ALTER TABLE comms_external_reactions ADD COLUMN user_id text, ADD COLUMN source_id text NOT NULL DEFAULT '';
-- A verified WhatsApp identity has one stable Macro owner across explicit
-- replacements. Retired account rows retain their historical source attribution.
CREATE TABLE whatsapp_verified_identity (
    jid text PRIMARY KEY,
    user_id text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO whatsapp_verified_identity(jid,user_id) SELECT identity_jid,user_id FROM whatsapp_linked_account WHERE identity_jid IS NOT NULL;
ALTER TABLE whatsapp_linked_account DROP CONSTRAINT whatsapp_linked_account_identity_jid_key;
CREATE UNIQUE INDEX whatsapp_linked_account_active_identity ON whatsapp_linked_account(identity_jid) WHERE identity_jid IS NOT NULL AND state<>'disconnected';

-- The transport identity can write only this outcome ledger plus session ownership.
-- No credentials, payloads or recipient addresses survive generation retirement here.
CREATE TABLE whatsapp_transport_outcome (
 account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id),
 authorization_generation bigint NOT NULL CHECK(authorization_generation>0),
 command_id uuid NOT NULL,
 source_id text NOT NULL CHECK(octet_length(source_id)<=256),
 state text NOT NULL CHECK(state IN ('prepared','dispatching','accepted','unknown','rejected')),
 retained_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,authorization_generation,command_id)
);
CREATE TABLE whatsapp_participant_receipt (
 account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id),
 binding_id uuid NOT NULL REFERENCES whatsapp_group_binding(id),
 source_id text NOT NULL CHECK(octet_length(source_id)<=256),
 participant_jid text NOT NULL CHECK(octet_length(participant_jid)<=256),
 receipt_state text NOT NULL CHECK(octet_length(receipt_state)<=64),
 source_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,binding_id,source_id,participant_jid,receipt_state)
);
-- Gate notification list/retry/final delivery with the native channel marker.
-- Ordinary notifications do not query personal accounts or linked audiences.
CREATE FUNCTION whatsapp_linked_notification_allowed(notification_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 WITH n AS (SELECT event_item_id,event_item_type,secondary_event_item_id,secondary_event_item_type FROM notification WHERE id=notification_id),
 candidates AS (
   SELECT event_item_id AS channel FROM n WHERE event_item_type='channel'
   UNION ALL SELECT secondary_event_item_id FROM n WHERE secondary_event_item_type='channel'
   UNION ALL SELECT m.parent_entity_id FROM n JOIN comms_messages m ON m.id=CASE
      WHEN n.event_item_type='channel_message' AND n.event_item_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN n.event_item_id::uuid END
      WHERE m.parent_entity_type='channel'
 )
 SELECT NOT EXISTS(SELECT 1 FROM candidates t JOIN comms_channels c ON c.id=CASE
   WHEN t.channel ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN t.channel::uuid END
   WHERE CASE WHEN c.messaging_binding='whatsapp_linked_group' THEN NOT whatsapp_linked_can_view(c.id,viewer) ELSE false END)
$$;
