-- Slack as an external chat provider: a person's own Slack web sessions (one
-- account per workspace) and the Slack Connect conversations they add to
-- Macro. See docs/architecture/slack-linked.md.
SET LOCAL lock_timeout = '5s';

-- Installed NOT VALID; the next migration validates them without holding
-- this migration's exclusive lock.
ALTER TABLE external_chat DROP CONSTRAINT external_chat_provider_check;
ALTER TABLE external_chat ADD CONSTRAINT external_chat_provider_check
    CHECK (provider IN ('whatsapp', 'slack')) NOT VALID;

-- A Slack conversation id: a channel (C, or G for an old private one) or a
-- direct message (D). Ids are unique across Slack.
ALTER TABLE external_chat ADD CONSTRAINT external_chat_slack_remote_id_check CHECK (
    provider <> 'slack'
    OR (kind = 'group' AND remote_id ~ '^[CG][A-Z0-9]{6,}$')
    OR (kind = 'direct' AND remote_id ~ '^D[A-Z0-9]{6,}$')) NOT VALID;

-- A person's Slack session in one workspace. generation counts consent
-- (sign-in, disconnect, session end) and fences memberships and sends;
-- lease_epoch fences the session-service replica running the account.
-- credentials: the sealed {token, d, d-s} (kms_envelope blob under the
-- account's data key); present while the session may be used, and until a
-- requested sign-out ran.
CREATE TABLE slack_account (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    team_id text NOT NULL CHECK (team_id ~ '^[TE][A-Z0-9]{6,}$'),
    enterprise_id text CHECK (enterprise_id ~ '^E[A-Z0-9]{6,}$'),
    team_name text NOT NULL CHECK (octet_length(team_name) <= 512),
    team_domain text NOT NULL CHECK (octet_length(team_domain) <= 256),
    team_icon_url text CHECK (octet_length(team_icon_url) <= 2048),
    slack_user_id text CHECK (slack_user_id ~ '^[UW][A-Z0-9]{6,}$'),
    display_name text CHECK (octet_length(display_name) <= 512),
    state text NOT NULL CHECK (state IN ('connecting', 'connected', 'logged_out', 'disconnected')),
    ended_reason text CHECK (ended_reason IN (
        'revoked', 'expired', 'account_inactive', 'team_disabled',
        'removed_from_team', 'enterprise_restricted', 'unreadable')),
    generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
    lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    credentials bytea CHECK (octet_length(credentials) <= 16384),
    data_key_ciphertext bytea CHECK (octet_length(data_key_ciphertext) <= 1024),
    kms_key_id text CHECK (octet_length(kms_key_id) <= 512),
    encryption_version smallint,
    last_connected_at timestamptz,
    -- The owner disconnected with "sign out of Slack": the replica signs the
    -- session out, then wipes the credentials.
    sign_out_requested boolean NOT NULL DEFAULT false,
    -- Last time DSS asked for a catalogue refresh (rate limit).
    catalogue_requested_at timestamptz,
    -- The generation whose end DSS told the owner about (once per ended
    -- generation; NULL until the first).
    ended_notified_generation bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, team_id),
    CHECK (state NOT IN ('connecting', 'connected') OR credentials IS NOT NULL),
    CHECK (state IN ('connecting', 'connected') OR credentials IS NULL OR sign_out_requested),
    CHECK ((credentials IS NULL) = (data_key_ciphertext IS NULL)),
    CHECK ((credentials IS NULL) = (kms_key_id IS NULL)),
    CHECK ((credentials IS NULL) = (encryption_version IS NULL)),
    CHECK ((state = 'logged_out') = (ended_reason IS NOT NULL))
);

-- A sign-in in progress. DSS creates it and stores each step's input; a
-- session replica claims it, calls Slack and writes the next step.
-- input: one-time inputs in plaintext (email, captcha solution, codes, chosen
-- teams), cleared when consumed. sealed_input: a pasted or desktop-captured
-- session, sealed by DSS under its own data key (purpose slack-login-input);
-- nulled once the replica has moved it into accounts. sealed_state: the
-- replica's private state between steps (Slack's sign-in cookies, magic-login
-- codes), sealed under the attempt's data key (purpose slack-login).
CREATE INDEX slack_account_ended_unnotified ON slack_account(updated_at)
    WHERE state = 'logged_out' AND ended_notified_generation IS DISTINCT FROM generation;
-- Resolves a sender who is one of the person's own Slack accounts.
CREATE INDEX slack_account_slack_user ON slack_account(slack_user_id) WHERE slack_user_id IS NOT NULL;

CREATE TABLE slack_login_attempt (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    step text NOT NULL CHECK (step IN (
        'working', 'captcha', 'email_code', 'pick_workspaces', 'two_factor',
        'finish_on_desktop', 'done', 'failed', 'cancelled')),
    -- What the web shows for the step (SlackLoginStep minus `kind`).
    step_data jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(step_data) <= 65536),
    input jsonb CHECK (pg_column_size(input) <= 8192),
    sealed_input bytea CHECK (octet_length(sealed_input) <= 65536),
    sealed_input_key bytea CHECK (octet_length(sealed_input_key) <= 1024),
    sealed_state bytea CHECK (octet_length(sealed_state) <= 262144),
    sealed_state_key bytea CHECK (octet_length(sealed_state_key) <= 1024),
    kms_key_id text CHECK (octet_length(kms_key_id) <= 512),
    encryption_version smallint,
    -- A replica works on it until then; another may take it over after.
    claimed_until timestamptz,
    traceparent text CHECK (octet_length(traceparent) <= 256),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((sealed_input IS NULL) = (sealed_input_key IS NULL)),
    CHECK ((sealed_state IS NULL) = (sealed_state_key IS NULL)),
    CHECK (step NOT IN ('done', 'failed', 'cancelled')
        OR (input IS NULL AND sealed_input IS NULL AND sealed_state IS NULL))
);
CREATE UNIQUE INDEX slack_login_attempt_open ON slack_login_attempt(user_id)
    WHERE step NOT IN ('done', 'failed', 'cancelled');
CREATE INDEX slack_login_attempt_work ON slack_login_attempt(updated_at)
    WHERE step = 'working';
CREATE INDEX slack_login_attempt_expiry ON slack_login_attempt(expires_at)
    WHERE step NOT IN ('done', 'failed', 'cancelled');
CREATE INDEX slack_login_attempt_user ON slack_login_attempt(user_id);

-- A Slack team seen from a conversation: a workspace of the person, or an
-- organization a Slack Connect conversation is shared with.
CREATE TABLE slack_team (
    team_id text PRIMARY KEY CHECK (team_id ~ '^[TE][A-Z0-9]{6,}$'),
    name text NOT NULL CHECK (octet_length(name) <= 512),
    domain text CHECK (octet_length(domain) <= 256),
    icon_url text CHECK (octet_length(icon_url) <= 2048),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A Slack user as Slack last described them.
CREATE TABLE slack_user (
    slack_user_id text PRIMARY KEY CHECK (slack_user_id ~ '^[UWB][A-Z0-9]{6,}$'),
    team_id text CHECK (team_id ~ '^[TE][A-Z0-9]{6,}$'),
    display_name text CHECK (octet_length(display_name) <= 512),
    real_name text CHECK (octet_length(real_name) <= 512),
    avatar_url text CHECK (octet_length(avatar_url) <= 2048),
    is_bot boolean NOT NULL DEFAULT false,
    deleted boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Each account's Slack Connect conversations, as the session service last
-- read them: the catalogue the person adds chats from. Never holds messages.
CREATE TABLE slack_conversation (
    account_id uuid NOT NULL REFERENCES slack_account(id) ON DELETE CASCADE,
    conversation_id text NOT NULL CHECK (conversation_id ~ '^[CGD][A-Z0-9]{6,}$'),
    kind text NOT NULL CHECK (kind IN ('group', 'direct')),
    name text NOT NULL CHECK (octet_length(name) <= 512),
    topic text CHECK (octet_length(topic) <= 2048),
    is_private boolean NOT NULL DEFAULT false,
    is_archived boolean NOT NULL DEFAULT false,
    is_member boolean NOT NULL DEFAULT true,
    frozen_reason text CHECK (octet_length(frozen_reason) <= 128),
    connected_team_ids text[] NOT NULL DEFAULT '{}' CHECK (cardinality(connected_team_ids) <= 256),
    direct_user_id text CHECK (direct_user_id ~ '^[UWB][A-Z0-9]{6,}$'),
    last_activity_at timestamptz,
    unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
    last_read_ts text CHECK (last_read_ts ~ '^[0-9]+[.][0-9]+$'),
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, conversation_id),
    CHECK ((kind = 'direct') = (conversation_id LIKE 'D%'))
);
CREATE INDEX slack_conversation_id ON slack_conversation(conversation_id);

-- One Slack account's consent to observe and post for one added chat. A
-- conversation reached from several of the person's workspaces has one row
-- per account. latest_ts: the newest message ingested, where catch-up resumes.
CREATE TABLE slack_chat_membership (
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES slack_account(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    consent_at timestamptz NOT NULL,
    consent_ended_at timestamptz,
    remote_member boolean NOT NULL DEFAULT true,
    can_post boolean NOT NULL DEFAULT true,
    latest_ts text CHECK (latest_ts ~ '^[0-9]+[.][0-9]+$'),
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (chat_id, account_id)
);
CREATE INDEX slack_chat_membership_account ON slack_chat_membership(account_id);

-- The external_chat_person behind a Slack user in a chat. Slack user ids are
-- stable, so this is the only way a sender resolves; names never do.
CREATE TABLE slack_user_alias (
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    slack_user_id text NOT NULL CHECK (slack_user_id ~ '^[UWB][A-Z0-9]{6,}$'),
    person_id uuid NOT NULL,
    PRIMARY KEY (chat_id, slack_user_id),
    FOREIGN KEY (person_id, chat_id) REFERENCES external_chat_person(id, chat_id) ON DELETE CASCADE
);
CREATE INDEX slack_user_alias_person ON slack_user_alias(person_id, chat_id);

-- A deliberate send from Macro, as whatsapp_send. allocated_source_id is the
-- client_msg_id given to Slack at dispatch; remote_ts the message's Slack ts
-- once accepted.
CREATE TABLE slack_send (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES slack_account(id) ON DELETE CASCADE,
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
    remote_ts text CHECK (remote_ts ~ '^[0-9]+[.][0-9]+$'),
    message_id uuid REFERENCES external_chat_message(id) ON DELETE SET NULL,
    error_code text,
    traceparent text CHECK (octet_length(traceparent) <= 256),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (state <> 'sending' OR claimed_epoch IS NOT NULL),
    CHECK (dispatch_started_at IS NULL OR allocated_source_id IS NOT NULL),
    UNIQUE (chat_id, user_id, idempotency_key),
    UNIQUE (chat_id, chat_sequence)
);
CREATE UNIQUE INDEX slack_send_source ON slack_send(account_id, allocated_source_id) WHERE allocated_source_id IS NOT NULL;
CREATE INDEX slack_send_work ON slack_send(account_id, created_at, id) WHERE state IN ('pending', 'sending');
CREATE INDEX slack_send_account ON slack_send(account_id);
CREATE INDEX slack_send_message ON slack_send(message_id, user_id, created_at DESC) WHERE message_id IS NOT NULL;

-- Websocket events kept before they are ingested, so a crash between
-- receiving and ingesting loses nothing. Deleted once ingested.
CREATE TABLE slack_inbound (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES slack_account(id) ON DELETE CASCADE,
    lease_epoch bigint NOT NULL,
    event jsonb NOT NULL CHECK (pg_column_size(event) <= 1048576),
    received_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX slack_inbound_account ON slack_inbound(account_id, id);

-- The owner's read position to send to Slack, coalesced per chat, account and
-- thread ('' for the conversation itself).
CREATE TABLE slack_read_mark (
    chat_id uuid NOT NULL REFERENCES external_chat(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES slack_account(id) ON DELETE CASCADE,
    thread_ts text NOT NULL DEFAULT '' CHECK (thread_ts = '' OR thread_ts ~ '^[0-9]+[.][0-9]+$'),
    ts text NOT NULL CHECK (ts ~ '^[0-9]+[.][0-9]+$'),
    traceparent text CHECK (octet_length(traceparent) <= 256),
    requested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, account_id, thread_ts)
);
CREATE INDEX slack_read_mark_account ON slack_read_mark(account_id);
