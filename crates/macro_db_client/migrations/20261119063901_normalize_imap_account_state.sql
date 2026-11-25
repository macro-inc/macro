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
    fingerprint bytea CHECK (fingerprint IS NULL OR octet_length(fingerprint) = 32),
    document jsonb NOT NULL,
    body bytea,
    CHECK (kind <> 'location' OR fingerprint IS NOT NULL),
    PRIMARY KEY (link_id, kind, key)
);
CREATE INDEX imap_state_folder_members ON imap_state_entries(link_id, folder_id, message_id)
WHERE kind = 'location';
-- Draft hydration and cleanup also use the message-id column for children.
CREATE INDEX imap_state_message_locations ON imap_state_entries(link_id, kind, message_id)
WHERE kind IN ('location', 'attachment', 'upload');
CREATE INDEX imap_state_folder_changes ON imap_state_entries(link_id, folder_id, sequence)
WHERE kind = 'change';
CREATE INDEX imap_state_recent_messages ON imap_state_entries(link_id, received_at DESC, key)
WHERE kind = 'message';

-- This unpublished table starts empty. Every location writer supplies its digest;
-- non-location rows have no fingerprint. No legacy-data cutover is performed.
CREATE INDEX imap_state_location_fingerprints ON imap_state_entries(link_id, fingerprint)
WHERE kind = 'location';
