-- The account's WhatsApp chat list, and importing a chat's earlier messages
-- after it is added.
SET lock_timeout = '5s';

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
    PRIMARY KEY (account_id, chat_jid)
);

ALTER TABLE whatsapp_group
    -- Importing the chat's earlier messages from the owner's phone after adding
    -- it. NULL: nothing to import (added before backfill existed).
    ADD COLUMN backfill_state text CHECK (backfill_state IN ('pending', 'running', 'waiting_for_phone', 'done', 'partial')),
    ADD COLUMN backfill_imported integer NOT NULL DEFAULT 0 CHECK (backfill_imported >= 0),
    -- Oldest message imported so far ({id, at, fromMe, senderJid}); the next
    -- page is requested before it.
    ADD COLUMN backfill_cursor jsonb CHECK (pg_column_size(backfill_cursor) <= 4096),
    ADD COLUMN backfill_requested_at timestamptz;
