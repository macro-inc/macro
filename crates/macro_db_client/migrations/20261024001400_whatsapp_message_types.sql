-- Every WhatsApp message type Macro imports: attachment size, length and
-- presentation; mentions, polls, cards and group system lines.
SET lock_timeout = '5s';

ALTER TABLE whatsapp_group_attachment
    -- As WhatsApp declared them, so a timeline can reserve the space.
    ADD COLUMN width integer CHECK (width > 0),
    ADD COLUMN height integer CHECK (height > 0),
    ADD COLUMN duration_seconds integer CHECK (duration_seconds >= 0),
    ADD COLUMN presentation text CHECK (presentation IN ('sticker', 'gif', 'voice_note'));

ALTER TABLE whatsapp_group_message
    -- 'system': something that happened in the group (added, left, renamed,
    -- pinned, a call), described by `rich`; never notifies or counts as unread.
    ADD COLUMN kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
    -- Poll, location, contact cards, event or system line
    -- (`whatsapp_linked::domain::rich::RichContent`).
    ADD COLUMN rich jsonb CHECK (pg_column_size(rich) <= 65536),
    -- WhatsApp ids the text @-mentions.
    ADD COLUMN mentions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 256),
    ADD COLUMN forwarded boolean NOT NULL DEFAULT false;

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
