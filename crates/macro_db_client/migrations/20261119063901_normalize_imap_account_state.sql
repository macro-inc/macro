SET LOCAL lock_timeout = '5s';

-- New engine-owned storage. No deployed mailbox state exists before this feature.
CREATE TABLE imap_state_entries (
    link_id uuid NOT NULL REFERENCES imap_accounts(link_id) ON DELETE CASCADE,
    kind text NOT NULL,
    key text NOT NULL,
    folder_id text,
    message_id text,
    sequence bigint,
    received_at timestamptz,
    document jsonb NOT NULL,
    body bytea,
    PRIMARY KEY (link_id, kind, key)
);
CREATE INDEX imap_state_folder_members ON imap_state_entries(link_id, kind, folder_id, message_id);
CREATE INDEX imap_state_message_locations ON imap_state_entries(link_id, kind, message_id);
CREATE INDEX imap_state_folder_changes ON imap_state_entries(link_id, kind, folder_id, sequence);
CREATE INDEX imap_state_recent_messages ON imap_state_entries(link_id, kind, received_at DESC, key);
