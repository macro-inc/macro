-- Disappearing-message and community groups, direct chats and view-once
-- media. A group no longer has a suspended state.
SET lock_timeout = '5s';

ALTER TABLE whatsapp_group DROP CONSTRAINT whatsapp_group_state_check;
ALTER TABLE whatsapp_group ADD CONSTRAINT whatsapp_group_state_check CHECK (state IN ('active', 'detached'));

ALTER TABLE whatsapp_media_blob
    -- Read from the file's headers when it was staged.
    ADD COLUMN width integer CHECK (width > 0),
    ADD COLUMN height integer CHECK (height > 0),
    ADD COLUMN duration_seconds integer CHECK (duration_seconds >= 0);

-- An added WhatsApp chat: a group, or a direct chat with one person. The
-- `group`/`group_jid` names predate direct chats; `group_jid` is the chat's JID
-- (a direct chat's other person, by phone number when known).
ALTER TABLE whatsapp_group ADD COLUMN kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'direct'));
ALTER TABLE whatsapp_group DROP CONSTRAINT whatsapp_group_group_jid_check;
ALTER TABLE whatsapp_group ADD CONSTRAINT whatsapp_group_group_jid_check CHECK (
    (kind = 'group' AND group_jid ~ '^[0-9-]+@g[.]us$')
    OR (kind = 'direct' AND group_jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$'));

-- Sent as view-once in WhatsApp; Macro keeps and shows it like any media.
ALTER TABLE whatsapp_group_message ADD COLUMN view_once boolean NOT NULL DEFAULT false;
